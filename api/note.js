// Vercel serverless function — a shared cache of "why was the mood like this?"
// explanations for points on the Public-mood-over-time chart. Historical facts
// don't change, so the FIRST visitor to query a year pays the model tokens and
// everyone after reads it free from here.
//
// Storage: Upstash Redis (shared MoodCast DB). Key:
//   moodcast:why   hash { "<scope>:<t>": "<explanation text>" }

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

const WHY_KEY = 'moodcast:why';
const RATE_LIMIT = 120, RATE_WINDOW_S = 60;

const cleanKey = (v) => String(v == null ? '' : v).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80);

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
      const key = cleanKey(req.query.key);
      if (!key) return res.status(400).json({ error: 'Missing key.' });
      const text = await redis.hget(WHY_KEY, key);
      return res.status(200).json({ text: typeof text === 'string' ? text : null });
    }

    if (req.method === 'POST') {
      const passcode = process.env.MOODCAST_PASSCODE;
      if (passcode && req.headers['x-moodcast-pass'] !== passcode) {
        return res.status(401).json({ error: 'Invalid or missing passcode.' });
      }
      if (await overLimit(clientIp(req))) return res.status(429).json({ error: 'Slow down.' });

      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const key = cleanKey(body?.key);
      const text = String(body?.text || '').slice(0, 2000);
      if (!key || !text) return res.status(400).json({ error: 'Expected key and text.' });
      // Don't overwrite an existing fact (first writer wins; avoids drift).
      const exists = await redis.hget(WHY_KEY, key);
      if (!exists) await redis.hset(WHY_KEY, { [key]: text });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'server error', detail: String((err && err.message) || err).slice(0, 300) });
  }
}
