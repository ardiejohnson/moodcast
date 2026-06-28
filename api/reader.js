// Vercel serverless function — in-app article reader.
//   GET  ?id=<artId>&url=<url> → { reader, digest }
//        Returns shared cached reader text if present; otherwise fetches the
//        article server-side and extracts its main text (works for sites that
//        don't block server fetches; many do, hence the AI-digest fallback on
//        the client). Caches the extracted text so the first reader pays the
//        fetch and everyone after gets it free.
//   POST { id, digest } → stores a client-generated AI digest in the shared
//        cache (first-writer-wins) so it's reused for everyone.
//
// Storage: Upstash Redis hash moodcast:reader  field <artId> -> {reader,digest,t}

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
const redisOk = !!(REDIS_URL && REDIS_TOKEN);
const redis = redisOk ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;

const KEY = 'moodcast:reader';
const TTL_S = 60 * 60 * 24 * 30;       // 30 days
const MAX_READER = 7000;
const RATE_LIMIT = 30, RATE_WINDOW_S = 60;
const cleanId = (v) => String(v == null ? '' : v).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80);
const parse = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&rsquo;/g, '’')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(+n); } catch { return ''; } });
}
const strip = (s) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function extractText(html) {
  let h = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const pick = (tag) => { const m = h.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i')); return m ? m[1] : null; };
  const scope = pick('article') || pick('main') || h;
  const ps = [...scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1])).filter((t) => t.length > 45);
  return ps.join('\n\n');
}
async function fetchArticle(url) {
  if (!/^https?:\/\//i.test(url)) return null;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml' },
    });
    clearTimeout(to);
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('html')) return null;
    const text = extractText(await res.text());
    return text && text.length > 500 ? text.slice(0, MAX_READER) : null;
  } catch { clearTimeout(to); return null; }
}
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
async function overLimit(ip) {
  if (!redisOk) return false;
  const k = `moodcast:rl:reader:${ip}`; const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, RATE_WINDOW_S);
  return n > RATE_LIMIT;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-moodcast-pass');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const id = cleanId(req.query.id);
      const url = String(req.query.url || '');
      let entry = (redisOk && id) ? parse(await redis.hget(KEY, id)) : null;
      if (entry?.reader) return res.status(200).json({ reader: entry.reader, digest: entry.digest || null });
      if (url) {
        if (await overLimit(clientIp(req))) return res.status(200).json({ reader: null, digest: entry?.digest || null, limited: true });
        const text = await fetchArticle(url);
        if (text) {
          if (redisOk && id) { await redis.hset(KEY, { [id]: JSON.stringify({ ...(entry || {}), reader: text, t: Date.now() }) }); await redis.expire(KEY, TTL_S); }
          return res.status(200).json({ reader: text, digest: entry?.digest || null });
        }
      }
      return res.status(200).json({ reader: null, digest: entry?.digest || null });
    }

    if (req.method === 'POST') {
      const passcode = process.env.MOODCAST_PASSCODE;
      if (passcode && req.headers['x-moodcast-pass'] !== passcode) return res.status(401).json({ error: 'Invalid or missing passcode.' });
      if (!redisOk) return res.status(200).json({ ok: true, stored: false });
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const id = cleanId(body?.id);
      const digest = String(body?.digest || '').slice(0, 2000);
      if (!id || !digest) return res.status(400).json({ error: 'Expected id and digest.' });
      const entry = parse(await redis.hget(KEY, id)) || {};
      if (!entry.digest) { await redis.hset(KEY, { [id]: JSON.stringify({ ...entry, digest, t: Date.now() }) }); await redis.expire(KEY, TTL_S); }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'server error', detail: String((err && err.message) || err).slice(0, 300) });
  }
}
