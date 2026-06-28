// Vercel serverless function — a shared, recent feed of mood questions people
// have asked and the app's answers, so visitors can browse and enjoy them.
//
// Storage: Upstash Redis (shared MoodCast DB). A capped list:
//   moodcast:asks   newest-first JSON { q, answer, mood, t }

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

const LIST_KEY = 'moodcast:asks';
const KEEP = 40;
const RATE_LIMIT = 20, RATE_WINDOW_S = 60;
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const parse = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
async function overLimit(ip) {
  const k = `moodcast:rl:asks:${ip}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, RATE_WINDOW_S);
  return n > RATE_LIMIT;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-moodcast-pass');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ error: 'asks not configured' });

  try {
    if (req.method === 'GET') {
      const raw = await redis.lrange(LIST_KEY, 0, KEEP - 1);
      const asks = (raw || []).map(parse).filter(Boolean);
      return res.status(200).json({ asks });
    }

    if (req.method === 'POST') {
      const passcode = process.env.MOODCAST_PASSCODE;
      if (passcode && req.headers['x-moodcast-pass'] !== passcode) {
        return res.status(401).json({ error: 'Invalid or missing passcode.' });
      }
      if (await overLimit(clientIp(req))) return res.status(429).json({ error: 'Slow down.' });

      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const q = str(body?.q, 160);
      const answer = str(body?.answer, 360);
      const moodNum = Math.round(Number(body?.mood));
      const mood = Number.isFinite(moodNum) ? Math.max(0, Math.min(100, moodNum)) : null;
      if (q.length < 5 || !answer) return res.status(400).json({ error: 'Expected q and answer.' });

      // Dedup against the most recent entries (same question text).
      const recent = (await redis.lrange(LIST_KEY, 0, 12) || []).map(parse).filter(Boolean);
      if (recent.some((a) => (a.q || '').toLowerCase() === q.toLowerCase())) {
        return res.status(200).json({ ok: true, dup: true });
      }
      await redis.lpush(LIST_KEY, JSON.stringify({ q, answer, mood, t: Date.now() }));
      await redis.ltrim(LIST_KEY, 0, KEEP - 1);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'server error', detail: String((err && err.message) || err).slice(0, 300) });
  }
}
