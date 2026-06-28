// Vercel serverless function — a shared, crowd-built set of explained points on
// the Public-mood-over-time chart. Each time a visitor queries a year, its short
// title + explanation is saved here, so a dot appears on that country's line for
// everyone and nobody re-spends tokens to regenerate it.
//
// Storage: Upstash Redis (shared MoodCast DB). One hash per scope:
//   moodcast:why:<scope>   field "<t>" -> JSON { title, text }
// scope is "us" or a country code. Historical facts don't change → no expiry,
// first-writer-wins.

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

const RATE_LIMIT = 120, RATE_WINDOW_S = 60;
const cleanScope = (v) => String(v == null ? 'us' : v).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'us';
const cleanT = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? String(n) : ''; };
const key = (scope) => `moodcast:why:${scope}`;
const parse = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
async function overLimit(ip) {
  const k = `moodcast:rl:note:${ip}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, RATE_WINDOW_S);
  return n > RATE_LIMIT;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-moodcast-pass');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ error: 'notes not configured' });

  try {
    if (req.method === 'GET') {
      const scope = cleanScope(req.query.scope);
      const t = cleanT(req.query.t);
      if (t) { // one full entry
        const raw = await redis.hget(key(scope), t);
        const v = parse(raw) || {};
        return res.status(200).json({ title: v.title || null, text: v.text || null, mood: (typeof v.mood === 'number') ? v.mood : null });
      }
      // list of points (title + corrected mood) for rendering dots
      const all = await redis.hgetall(key(scope));
      const points = Object.entries(all || {}).map(([ts, v]) => { const p = parse(v) || {}; return { t: Number(ts), title: p.title || '', mood: (typeof p.mood === 'number') ? p.mood : null }; }).filter((p) => Number.isFinite(p.t));
      return res.status(200).json({ points });
    }

    if (req.method === 'POST') {
      const passcode = process.env.MOODCAST_PASSCODE;
      if (passcode && req.headers['x-moodcast-pass'] !== passcode) {
        return res.status(401).json({ error: 'Invalid or missing passcode.' });
      }
      if (await overLimit(clientIp(req))) return res.status(429).json({ error: 'Slow down.' });

      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const scope = cleanScope(body?.scope);
      const t = cleanT(body?.t);
      const title = String(body?.title || '').slice(0, 48);
      const text = String(body?.text || '').slice(0, 2000);
      const moodNum = Math.round(Number(body?.mood));
      const mood = Number.isFinite(moodNum) ? Math.max(0, Math.min(100, moodNum)) : null;
      if (!t || !text) return res.status(400).json({ error: 'Expected t and text.' });
      const exists = await redis.hget(key(scope), t); // first writer wins (no drift)
      if (!exists) await redis.hset(key(scope), { [t]: JSON.stringify({ title, text, ...(mood != null ? { mood } : {}) }) });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'server error', detail: String((err && err.message) || err).slice(0, 300) });
  }
}
