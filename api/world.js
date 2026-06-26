// Vercel serverless function — the Mood Map. Stores a shared mood (and a few
// headlines) per country/region so every visitor sees the same colored map.
//
// Storage: Upstash Redis (shared MoodCast DB). Key:
//   moodcast:world   hash { <countryCode>: JSON{mood,items,t,label} }
// Refreshed in place; the whole key expires 7 days after the last write so a
// long-abandoned map fades rather than showing year-old moods.

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

const WORLD_KEY = 'moodcast:world';
const TTL_S = 60 * 60 * 24 * 7; // 7 days
const WRITE_LIMIT = 60, WRITE_WINDOW_S = 60;

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const code = (v) => String(v == null ? '' : v).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12);
const clampMood = (v) => { const m = Math.round(Number(v)); return Number.isFinite(m) ? Math.max(0, Math.min(100, m)) : null; };
const clampScore = (v) => Math.max(-100, Math.min(100, Math.round(Number(v) || 0)));

function cleanItem(it) {
  if (!it || typeof it !== 'object') return null;
  return {
    title: str(it.title, 160), source: str(it.source, 50),
    url: typeof it.url === 'string' && /^https?:\/\//.test(it.url) ? it.url.slice(0, 400) : '',
    summary: str(it.summary, 160), score: clampScore(it.score),
  };
}
const parse = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
async function overLimit(ip) {
  const k = `moodcast:rl:world:${ip}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, WRITE_WINDOW_S);
  return n > WRITE_LIMIT;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-moodcast-pass');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ error: 'mood map not configured' });

  try {
    if (req.method === 'GET') {
      const all = await redis.hgetall(WORLD_KEY);
      const countries = {};
      for (const [k, v] of Object.entries(all || {})) { const c = parse(v); if (c) countries[k] = c; }
      return res.status(200).json({ countries });
    }

    if (req.method === 'POST') {
      const passcode = process.env.MOODCAST_PASSCODE;
      if (passcode && req.headers['x-moodcast-pass'] !== passcode) {
        return res.status(401).json({ error: 'Invalid or missing passcode.' });
      }
      if (await overLimit(clientIp(req))) return res.status(429).json({ error: 'Too many writes, slow down.' });

      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};
      const c = code(body.code);
      const mood = clampMood(body.mood);
      if (!c || mood == null) return res.status(400).json({ error: 'Expected code and mood.' });
      const items = Array.isArray(body.items) ? body.items.slice(0, 4).map(cleanItem).filter(Boolean) : [];
      const entry = { mood, items, t: Date.now(), label: str(body.label, 60) };

      await redis.hset(WORLD_KEY, { [c]: JSON.stringify(entry) });
      await redis.expire(WORLD_KEY, TTL_S);
      return res.status(200).json({ ok: true, code: c, entry });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'server error', detail: String((err && err.message) || err).slice(0, 300) });
  }
}
