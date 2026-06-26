import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Set MOCK_API=false to hit the real (billed) Anthropic proxy instead of the
// local mock, e.g. `MOCK_API=false npm run dev`.
const MOCK_API = process.env.MOCK_API !== 'false'

// Dev-only mock of POST /api/grade. Returns the same `{ text: "<json string>" }`
// shape the real serverless function does, so the UI behaves normally but makes
// NO network calls and costs nothing. It recognizes the two prompt shapes the
// app sends (see src/MoodCast.jsx): the "items" grader and the "answer" Q&A.
function mockApiPlugin() {
  // Stable-but-varied pseudo-score per string so a subject reads the same on
  // refresh but different subjects differ.
  const hash = (s) => {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
    return Math.abs(h)
  }
  const scoreFor = (s) => ((hash(s) % 161) - 80) // -80..80

  const gradeMock = (system, user) => {
    const subject = (user.match(/Subject:\s*(.+?)\.\s/)?.[1] || 'the subject').trim()
    const n = Number(system.match(/exactly (\d+) items/)?.[1] || 4)
    const outlets = ['The Daily Ledger', 'Northwind Post', 'Civic Wire', 'Beacon News', 'Meridian Times', 'Harbor Report']
    const items = Array.from({ length: n }, (_, i) => {
      const score = Math.max(-100, Math.min(100, scoreFor(subject + i) + (i % 2 ? 12 : -12)))
      return {
        title: `[MOCK] ${subject} update ${i + 1}: developments draw mixed reaction`,
        source: outlets[(hash(subject) + i) % outlets.length],
        url: `https://example.com/mock/${encodeURIComponent(subject.toLowerCase())}/${i + 1}`,
        summary: `Sample paraphrase #${i + 1} about ${subject} for local UI testing.`,
        score,
      }
    })
    return JSON.stringify({ items })
  }

  const answerMock = (system, user) => {
    const subject = user.trim().replace(/\?+$/, '')
    const score = scoreFor(subject)
    return JSON.stringify({
      answer: `[MOCK] This is a sample local answer about "${subject.slice(0, 60)}". No API was called, so nothing was billed.`,
      subject: subject.slice(0, 40),
      score,
    })
  }

  // In-memory stand-in for the shared board (api/board.js). Lives for the dev
  // session only — good enough to exercise the publish/hydrate flow locally.
  let boardLatest = null

  const readBody = (req) => new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => { try { resolve(JSON.parse(raw)) } catch { resolve({}) } })
  })

  return {
    name: 'mock-api',
    configureServer(server) {
      // Added in the hook body → runs BEFORE Vite's internal proxy middleware,
      // so the proxy never sees these requests when mocking is enabled.
      server.middlewares.use('/api/grade', (req, res, next) => {
        if (req.method !== 'POST') return next()
        let raw = ''
        req.on('data', (c) => { raw += c })
        req.on('end', () => {
          let body = {}
          try { body = JSON.parse(raw) } catch {}
          const system = String(body.system || '')
          const user = String(body.user || '')
          const text = system.includes('"items"') ? gradeMock(system, user) : answerMock(system, user)
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ text, mocked: true }))
        })
      })

      let boardSunny = null
      server.middlewares.use('/api/board', async (req, res, next) => {
        res.setHeader('content-type', 'application/json')
        if (req.method === 'GET') {
          res.end(JSON.stringify({ latest: boardLatest, sunny: boardSunny, mocked: true }))
          return
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          if (body.results) boardLatest = { results: body.results, overall: body.overall ?? null, t: Date.now() }
          if (body.sunny) boardSunny = { ...body.sunny, t: Date.now() }
          res.end(JSON.stringify({ ok: true, t: Date.now(), mocked: true }))
          return
        }
        next()
      })

      // In-memory Yay/Boo votes: tallies[id] = {yay,boo}; voters[id][voter] = dir
      const tallies = {}
      const voters = {}
      server.middlewares.use('/api/vote', async (req, res, next) => {
        res.setHeader('content-type', 'application/json')
        const url = new URL(req.url, 'http://localhost')
        if (req.method === 'GET') {
          const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean)
          const voter = url.searchParams.get('voter') || ''
          const votes = {}, mine = {}
          for (const id of ids) {
            votes[id] = tallies[id] || { yay: 0, boo: 0 }
            mine[id] = (voters[id] && voters[id][voter]) || null
          }
          res.end(JSON.stringify({ votes, mine, mocked: true }))
          return
        }
        if (req.method === 'POST') {
          const { id, dir, voter } = await readBody(req)
          if (!id || !voter || (dir !== 'yay' && dir !== 'boo')) { res.statusCode = 400; res.end('{"error":"bad"}'); return }
          tallies[id] = tallies[id] || { yay: 0, boo: 0 }
          voters[id] = voters[id] || {}
          const prev = voters[id][voter] || null
          let mine = dir
          if (prev === dir) { tallies[id][dir] = Math.max(0, tallies[id][dir] - 1); delete voters[id][voter]; mine = null }
          else { tallies[id][dir]++; if (prev) tallies[id][prev] = Math.max(0, tallies[id][prev] - 1); voters[id][voter] = dir }
          res.end(JSON.stringify({ id, mine, votes: tallies[id], mocked: true }))
          return
        }
        next()
      })

      // In-memory Today's Chatter: threads[id] = [ {cid,text,name,ts,author} ]
      const threads = {}
      let cseq = 0
      server.middlewares.use('/api/comments', async (req, res, next) => {
        res.setHeader('content-type', 'application/json')
        const url = new URL(req.url, 'http://localhost')
        if (req.method === 'GET') {
          if (url.searchParams.get('ids') != null) {
            const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean)
            const counts = {}
            for (const id of ids) counts[id] = (threads[id] || []).length
            res.end(JSON.stringify({ counts, mocked: true }))
            return
          }
          const id = url.searchParams.get('id') || ''
          const voter = url.searchParams.get('voter') || ''
          const comments = (threads[id] || []).slice().reverse()
            .map((c) => ({ cid: c.cid, text: c.text, name: c.name || 'Anonymous', ts: c.ts, mine: voter && c.author === voter }))
          res.end(JSON.stringify({ comments, count: comments.length, mocked: true }))
          return
        }
        if (req.method === 'POST') {
          const b = await readBody(req)
          const id = b.id || ''
          if (b.action === 'delete') { threads[id] = (threads[id] || []).filter((c) => c.cid !== b.cid); res.end('{"ok":true}'); return }
          if (b.action === 'report') { res.end('{"ok":true}'); return }
          const text = String(b.text || '').replace(/\s+/g, ' ').trim()
          if (!text) { res.statusCode = 400; res.end('{"error":"Say something first."}'); return }
          if (/(https?:\/\/|www\.)/i.test(text)) { res.statusCode = 400; res.end('{"error":"Links aren\'t allowed here."}'); return }
          const c = { cid: 'm' + (++cseq), text: text.slice(0, 280), name: String(b.name || '').slice(0, 24) || 'Anonymous', ts: Date.now(), author: b.voter || '' }
          threads[id] = threads[id] || []; threads[id].push(c)
          res.end(JSON.stringify({ ok: true, comment: { cid: c.cid, text: c.text, name: c.name, ts: c.ts, mine: true }, mocked: true }))
          return
        }
        next()
      })

      // In-memory weather reactions: rx[id] = {emoji:count}; rxer[id][voter] = Set(emoji)
      const rx = {}, rxer = {}
      const EMO = ['☀️', '🌤️', '⛈️', '🌈']
      server.middlewares.use('/api/react', async (req, res, next) => {
        res.setHeader('content-type', 'application/json')
        const url = new URL(req.url, 'http://localhost')
        const empty = () => ({ '☀️': 0, '🌤️': 0, '⛈️': 0, '🌈': 0 })
        if (req.method === 'GET') {
          const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean)
          const voter = url.searchParams.get('voter') || ''
          const reactions = {}, mine = {}
          for (const id of ids) {
            reactions[id] = rx[id] || empty()
            mine[id] = [...((rxer[id] && rxer[id][voter]) || [])]
          }
          res.end(JSON.stringify({ reactions, mine, mocked: true }))
          return
        }
        if (req.method === 'POST') {
          const { id, emoji, voter } = await readBody(req)
          if (!id || !voter || !EMO.includes(emoji)) { res.statusCode = 400; res.end('{"error":"bad"}'); return }
          rx[id] = rx[id] || empty(); rxer[id] = rxer[id] || {}
          const set = rxer[id][voter] || (rxer[id][voter] = new Set())
          if (set.has(emoji)) { set.delete(emoji); rx[id][emoji] = Math.max(0, rx[id][emoji] - 1) }
          else { set.add(emoji); rx[id][emoji]++ }
          res.end(JSON.stringify({ id, reactions: rx[id], mine: [...set], mocked: true }))
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(MOCK_API ? [mockApiPlugin()] : [])],
  // Dev-only: proxy /api calls to the deployed serverless function so local
  // readings work without running `vercel dev`. Has NO effect on `vite build`
  // / production — the proxy only runs under `npm run dev`. When MOCK_API is
  // enabled (the default), the mock above intercepts /api/grade first and this
  // proxy only handles any other /api paths.
  server: {
    proxy: {
      '/api': { target: 'https://moodcast-livid.vercel.app', changeOrigin: true },
    },
  },
})
