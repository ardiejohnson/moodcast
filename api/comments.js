// Vercel serverless function — "Today's Chatter": short, daily comment threads
// attached to any MoodCast card (overall, a category, a saved subject, the
// Sunny Side). Threads are scoped to the UTC day and expire after 48h, so the
// conversation feels current and low-stakes and never accumulates indefinitely.
//
// Storage: Upstash Redis (shared MoodCast DB). Keys:
//   moodcast:cmts:<day>:<id>   hash { commentId: JSON{text,name,ts,author,reports,hidden} }
//   moodcast:rl:cmt:<ip>       per-IP write counter (sliding 60s window)
//   moodcast:cmtlast:<author>  author's last text (dedupe double-posts), TTL 1h
//
// Moderation (solid from the start): hard length/shape limits, a profanity
// mask, no links, per-IP rate limiting, double-post dedupe, author self-delete,
// and community reports that auto-hide a comment at a threshold.

import { Redis } from '@upstash/redis';

function resolveRedisEnv() {
  const env = process.env;
  const known = (names) => { for (const n of names) if (env[n]) return env[n]; return undefined; };
  let url = known(['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'STORAGE_REST_API_URL', 'STORAGE_KV_REST_API_URL', 'REDIS_REST_API_URL']);
  let token = known(['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN', 'STORAGE_REST_API_TOKEN', 'STORAGE_KV_REST_API_TOKEN', 'REDIS_REST_API_TOKEN']);
  if (!url) { const k = Object.keys(env).find((x) => /REST_API_URL$|REDIS_REST_URL$/.test(x) && env[x]); if (k) url = env[k]; }
  if (!token) { const k = Object.keys(env).find((x) => /REST_API_TOKEN$|REDIS_REST_TOKEN$/.test(x) && !/READ_ONLY/.test(x) && env[x]); if (k) token = env[k]; }
  return { url, token };
}
const { url: REDIS_URL, token: REDIS_TOKEN } = resolveRedisEnv();
const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

const TTL_S = 60 * 60 * 48;   // threads live 48h
const MAX_KEEP = 120;         // newest comments kept per card/day
const MAX_LEN = 280;          // comment length cap
const RATE_LIMIT = 8;         // comments per IP per window
const RATE_WINDOW_S = 60;
const REPORT_HIDE = 3;        // auto-hide at this many reports
const MAX_IDS = 60;

const cleanId = (v) => String(v == null ? '' : v).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 64);
const cleanAuthor = (v) => String(v == null ? '' : v).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
const cleanName = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, 24);

// Small profanity mask — keeps it kind without rejecting the whole comment.
const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'nigger', 'faggot', 'retard'];
function maskProfanity(s) {
  let out = s;
  for (const w of BAD) out = out.replace(new RegExp(w, 'gi'), (m) => m[0] + '*'.repeat(Math.max(1, m.length - 1)));
  return out;
}
const hasLink = (s) => /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|gg|xyz|ru|info)\b)/i.test(s);

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
async function overLimit(ip) {
  const key = `moodcast:rl:cmt:${ip}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, RATE_WINDOW_S);
  return n > RATE_LIMIT;
}
function dayStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
const parse = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-moodcast-pass');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ error: 'comments not configured' });

  const day = dayStamp();
  const key = (id) => `moodcast:cmts:${day}:${id}`;

  try {
    if (req.method === 'GET') {
      // Batch counts for card badges: ?ids=a,b,c
      if (req.query.ids != null) {
        const ids = String(req.query.ids).split(',').map(cleanId).filter(Boolean).slice(0, MAX_IDS);
        const counts = {};
        await Promise.all(ids.map(async (id) => { counts[id] = await redis.hlen(key(id)); }));
        return res.status(200).json({ counts });
      }
      // Full thread for one card: ?id=x&voter=v
      const id = cleanId(req.query.id);
      if (!id) return res.status(400).json({ error: 'Missing id.' });
      const voter = cleanAuthor(req.query.voter);
      const all = await redis.hgetall(key(id));
      const list = Object.entries(all || {})
        .map(([cid, v]) => ({ cid, ...(parse(v) || {}) }))
        .filter((c) => c.text && !c.hidden)
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, MAX_KEEP)
        .map((c) => ({ cid: c.cid, text: c.text, name: c.name || 'Anonymous', ts: c.ts, mine: voter && c.author === voter }));
      return res.status(200).json({ comments: list, count: list.length });
    }

    if (req.method === 'POST') {
      const passcode = process.env.MOODCAST_PASSCODE;
      if (passcode && req.headers['x-moodcast-pass'] !== passcode) {
        return res.status(401).json({ error: 'Invalid or missing passcode.' });
      }
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};
      const id = cleanId(body.id);
      const author = cleanAuthor(body.voter);
      if (!id || !author) return res.status(400).json({ error: 'Missing id or voter.' });

      // --- moderation actions on an existing comment ---
      if (body.action === 'report' || body.action === 'delete') {
        const cid = cleanId(body.cid);
        if (!cid) return res.status(400).json({ error: 'Missing cid.' });
        const existing = parse(await redis.hget(key(id), cid));
        if (!existing) return res.status(404).json({ error: 'Not found.' });
        if (body.action === 'delete') {
          if (existing.author !== author) return res.status(403).json({ error: 'Not your comment.' });
          await redis.hdel(key(id), cid);
          return res.status(200).json({ ok: true, deleted: cid });
        }
        existing.reports = (existing.reports || 0) + 1;
        if (existing.reports >= REPORT_HIDE) existing.hidden = true;
        await redis.hset(key(id), { [cid]: JSON.stringify(existing) });
        await redis.expire(key(id), TTL_S);
        return res.status(200).json({ ok: true, reported: cid, hidden: !!existing.hidden });
      }

      // --- add a comment ---
      if (await overLimit(clientIp(req))) return res.status(429).json({ error: 'Slow down a moment.' });
      let text = String(body.text || '').replace(/\s+/g, ' ').trim();
      if (!text) return res.status(400).json({ error: 'Say something first.' });
      if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);
      if (hasLink(text)) return res.status(400).json({ error: "Links aren't allowed here." });
      text = maskProfanity(text);

      const dedupeKey = `moodcast:cmtlast:${author}`;
      const last = await redis.get(dedupeKey);
      if (last && String(last) === text) return res.status(409).json({ error: 'You just said that.' });

      const cid = newId();
      const comment = { text, name: cleanName(body.name) || 'Anonymous', ts: Date.now(), author, reports: 0 };
      await redis.hset(key(id), { [cid]: JSON.stringify(comment) });
      await redis.expire(key(id), TTL_S);
      await redis.set(dedupeKey, text, { ex: 3600 });

      // Trim to the newest MAX_KEEP to bound growth.
      const all = await redis.hgetall(key(id));
      const entries = Object.entries(all || {}).map(([k, v]) => [k, parse(v)]).filter(([, v]) => v);
      if (entries.length > MAX_KEEP) {
        entries.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
        const drop = entries.slice(0, entries.length - MAX_KEEP).map(([k]) => k);
        if (drop.length) await redis.hdel(key(id), ...drop);
      }
      return res.status(200).json({ ok: true, comment: { cid, text: comment.text, name: comment.name, ts: comment.ts, mine: true } });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'server error', detail: String((err && err.message) || err).slice(0, 300) });
  }
}
