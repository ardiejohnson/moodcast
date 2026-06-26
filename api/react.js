// Vercel serverless function — lightweight weather-emoji reactions for MoodCast.
// A no-typing way to engage: tap ☀️🌤️⛈️🌈 on a card or article. One toggle per
// voter per emoji per card, scoped to the UTC day (expires after 48h).
//
// Storage: Upstash Redis (shared MoodCast DB). Keys:
//   moodcast:rx:<day>:<id>     hash { emoji: count }
//   moodcast:rxer:<day>:<id>   hash { "<voter>|<emoji>": 1 } — dedup/toggle
//   moodcast:rl:rx:<ip>        per-IP write counter (sliding 60s window)

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

const EMOJIS = ['☀️', '🌤️', '⛈️', '🌈']; // the only accepted reactions
const TTL_S = 60 * 60 * 48;
const RATE_LIMIT = 80;
const RATE_WINDOW_S = 60;
const MAX_IDS = 60;

const cleanId = (v) => String(v == null ? '' : v).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 64);
const cleanVoter = (v) => String(v == null ? '' : v).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

function dayStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
async function overLimit(ip) {
  const key = `moodcast:rl:rx:${ip}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, RATE_WINDOW_S);
  return n > RATE_LIMIT;
}
const countsFrom = (hash) => { const out = {}; for (const e of EMOJIS) out[e] = num(hash?.[e]); return out; };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-moodcast-pass');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ error: 'reactions not configured' });

  const day = dayStamp();
  const rxKey = (id) => `moodcast:rx:${day}:${id}`;
  const erKey = (id) => `moodcast:rxer:${day}:${id}`;

  try {
    if (req.method === 'GET') {
      const ids = String(req.query.ids || '').split(',').map(cleanId).filter(Boolean).slice(0, MAX_IDS);
      const voter = cleanVoter(req.query.voter);
      const reactions = {};
      const mine = {};
      await Promise.all(ids.map(async (id) => {
        reactions[id] = countsFrom(await redis.hgetall(rxKey(id)));
        if (voter) {
          const fields = EMOJIS.map((e) => `${voter}|${e}`);
          const got = await redis.hmget(erKey(id), ...fields);
          mine[id] = EMOJIS.filter((e, i) => got && got[i]);
        }
      }));
      return res.status(200).json({ reactions, mine });
    }

    if (req.method === 'POST') {
      const passcode = process.env.MOODCAST_PASSCODE;
      if (passcode && req.headers['x-moodcast-pass'] !== passcode) {
        return res.status(401).json({ error: 'Invalid or missing passcode.' });
      }
      if (await overLimit(clientIp(req))) return res.status(429).json({ error: 'Too many reactions.' });

      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const id = cleanId(body?.id);
      const voter = cleanVoter(body?.voter);
      const emoji = body?.emoji;
      if (!id || !voter || !EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Expected id, voter, valid emoji.' });

      const field = `${voter}|${emoji}`;
      const had = await redis.hget(erKey(id), field);
      if (had) { await redis.hdel(erKey(id), field); await redis.hincrby(rxKey(id), emoji, -1); }
      else { await redis.hset(erKey(id), { [field]: 1 }); await redis.hincrby(rxKey(id), emoji, 1); }
      await redis.expire(rxKey(id), TTL_S);
      await redis.expire(erKey(id), TTL_S);

      const counts = countsFrom(await redis.hgetall(rxKey(id)));
      for (const e of EMOJIS) counts[e] = Math.max(0, counts[e]);
      const fields = EMOJIS.map((e) => `${voter}|${e}`);
      const got = await redis.hmget(erKey(id), ...fields);
      const mine = EMOJIS.filter((e, i) => got && got[i]);
      return res.status(200).json({ id, reactions: counts, mine });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'server error', detail: String((err && err.message) || err).slice(0, 300) });
  }
}
