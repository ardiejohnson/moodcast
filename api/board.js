// Vercel serverless function — the shared MoodCast "board": a single latest
// crowd reading that every visitor sees, plus the time it was read.
//
// Storage: Upstash Redis (same stack as the arcade leaderboard, ~/Documents/
// arcade/api/scores.js). MoodCast uses its OWN dedicated Upstash database so its
// keyspace, rate limits, and quota are isolated from other apps. Env vars:
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//
// Keys (all namespaced under `moodcast:`):
//   moodcast:latest        -> JSON { results, overall, t } — the shared reading
//   moodcast:rl:<ip>       -> per-IP write counter (sliding 60s window)
//
// This is feature (a) of the shared-engagement work. Yay/Boo votes and comments
// (feature b/c) will be added as separate keys/handlers later.

import { Redis } from '@upstash/redis';

// Resolve the Upstash REST credentials regardless of how they were provisioned.
// A direct Upstash console DB uses UPSTASH_REDIS_REST_*; Vercel's Storage
// integration may name them KV_REST_API_* or apply a custom prefix
// (e.g. STORAGE_*). We try the known names, then fall back to scanning env for
// any matching pair — never picking a READ_ONLY token (we need write access).
function resolveRedisEnv() {
  const env = process.env;
  const known = (suffixes) => {
    for (const name of suffixes) if (env[name]) return env[name];
    return undefined;
  };
  let url = known([
    'UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL',
    'STORAGE_REST_API_URL', 'STORAGE_KV_REST_API_URL', 'REDIS_REST_API_URL',
  ]);
  let token = known([
    'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN',
    'STORAGE_REST_API_TOKEN', 'STORAGE_KV_REST_API_TOKEN', 'REDIS_REST_API_TOKEN',
  ]);
  if (!url) {
    const k = Object.keys(env).find((x) => /REST_API_URL$|REDIS_REST_URL$/.test(x) && env[x]);
    if (k) url = env[k];
  }
  if (!token) {
    const k = Object.keys(env).find(
      (x) => /REST_API_TOKEN$|REDIS_REST_TOKEN$/.test(x) && !/READ_ONLY/.test(x) && env[x]
    );
    if (k) token = env[k];
  }
  return { url, token };
}

const { url: REDIS_URL, token: REDIS_TOKEN } = resolveRedisEnv();
const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

const LATEST_KEY = 'moodcast:latest';
const SUNNY_KEY = 'moodcast:sunny';
const WRITE_LIMIT = 30;        // max writes per IP per window
const WRITE_WINDOW_S = 60;     // window length in seconds

// ---- sanitization ----------------------------------------------------------
// The reading is client-supplied, so we never trust its shape. Clamp counts and
// string lengths and coerce numbers, the same defensive posture as scores.js.
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const clampScore = (v) => Math.max(-100, Math.min(100, Math.round(Number(v) || 0)));
const clampMood = (v) => {
  const m = Math.round(Number(v));
  return Number.isFinite(m) ? Math.max(0, Math.min(100, m)) : null;
};

function cleanItem(it) {
  if (!it || typeof it !== 'object') return null;
  return {
    title: str(it.title, 160),
    source: str(it.source, 50),
    url: typeof it.url === 'string' && /^https?:\/\//.test(it.url) ? it.url.slice(0, 400) : '',
    summary: str(it.summary, 160),
    score: clampScore(it.score),
  };
}

function cleanReading(body) {
  const rawResults = body && body.results && typeof body.results === 'object' ? body.results : {};
  const results = {};
  let count = 0;
  for (const id of Object.keys(rawResults)) {
    if (count >= 50) break;                 // cap number of entries
    const r = rawResults[id];
    if (!r || typeof r !== 'object') continue;
    const mood = clampMood(r.mood);
    const items = Array.isArray(r.items)
      ? r.items.slice(0, 8).map(cleanItem).filter(Boolean)
      : [];
    if (mood == null && items.length === 0) continue;
    results[str(id, 64)] = { mood, items };  // series is per-device; intentionally dropped
    count++;
  }
  const overall = clampMood(body && body.overall);
  return { results, overall };
}

// The Sunny Side card: { item: {title,source,url,summary,score}, mood, t }.
function cleanSunny(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const item = cleanItem(raw.item);
  if (!item || !item.title) return null;
  return { item, mood: clampMood(raw.mood), t: Date.now() };
}

// ---- helpers ---------------------------------------------------------------
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

async function overWriteLimit(ip) {
  const key = `moodcast:rl:${ip}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, WRITE_WINDOW_S);
  return n > WRITE_LIMIT;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-moodcast-pass');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: 'board not configured' });
  }

  try {
    if (req.method === 'GET') {
      const [latest, sunny] = await Promise.all([
        redis.get(LATEST_KEY), // @upstash/redis auto-parses JSON
        redis.get(SUNNY_KEY),
      ]);
      return res.status(200).json({ latest: latest || null, sunny: sunny || null });
    }

    if (req.method === 'POST') {
      // Same optional passcode gate as api/grade.js — writes require it when set.
      const passcode = process.env.MOODCAST_PASSCODE;
      if (passcode && req.headers['x-moodcast-pass'] !== passcode) {
        return res.status(401).json({ error: 'Invalid or missing passcode.' });
      }

      if (await overWriteLimit(clientIp(req))) {
        return res.status(429).json({ error: 'Too many writes, slow down.' });
      }

      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};

      // A write may carry the full reading, the Sunny Side card, or both —
      // readSunny() publishes the card on its own, separate from a full read.
      const sunny = 'sunny' in body ? cleanSunny(body.sunny) : undefined;
      const { results, overall } = cleanReading(body);
      const hasReading = Object.keys(results).length > 0;
      if (!hasReading && !sunny) {
        return res.status(400).json({ error: 'Nothing to publish.' });
      }

      const t = Date.now();
      const writes = [];
      if (hasReading) writes.push(redis.set(LATEST_KEY, JSON.stringify({ results, overall, t })));
      if (sunny) writes.push(redis.set(SUNNY_KEY, JSON.stringify(sunny)));
      await Promise.all(writes);
      return res.status(200).json({ ok: true, t });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'server error', detail: String((err && err.message) || err).slice(0, 300) });
  }
}
