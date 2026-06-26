// Vercel serverless function — Yay/Boo votes for MoodCast cards.
//
// The crowd reacts to a card (a category, the overall mood, a saved subject, a
// story) by voting Yay ☀️ or Boo ⛈️. Counts render as a live "tug-of-war" bar.
// Votes are scoped to the UTC day so the board feels fresh daily and old keys
// expire on their own. A voter may switch their vote (Yay->Boo) but only counts
// once per card per day.
//
// Storage: Upstash Redis (same dedicated MoodCast DB as api/board.js). Keys:
//   moodcast:votes:<day>:<id>   hash { yay, boo }            — the tallies
//   moodcast:voters:<day>:<id>  hash { <voterId>: 'yay'|'boo' } — dedup/switch
//   moodcast:rl:vote:<ip>       per-IP write counter (sliding 60s window)

import { Redis } from '@upstash/redis';

// Resolve Upstash creds under any provisioning scheme (direct UPSTASH_*, or
// Vercel's KV_*/STORAGE_* integration names), never a READ_ONLY token.
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

const KEY_TTL_S = 60 * 60 * 48; // votes live 48h, covering "today" plus slack
const VOTE_LIMIT = 60;          // max vote writes per IP per window
const VOTE_WINDOW_S = 60;
const MAX_IDS = 60;             // cap batch GET size

// Card ids and voter ids are client-supplied; constrain them hard.
const cleanId = (v) => String(v == null ? '' : v).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 64);
const cleanVoter = (v) => String(v == null ? '' : v).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

// UTC day stamp (YYYYMMDD). Date.now() is allowed here (plain serverless fn).
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
  const key = `moodcast:rl:vote:${ip}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, VOTE_WINDOW_S);
  return n > VOTE_LIMIT;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-moodcast-pass');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ error: 'votes not configured' });

  const day = dayStamp();

  const RANK_KEY = `moodcast:artrank:${day}`;   // sorted set: net score (yay-boo) per article
  const META_KEY = `moodcast:artmeta:${day}`;   // hash: artId -> {title,source,url}

  try {
    // ---- crowd's sunniest / cloudiest article today -----------------------
    if (req.method === 'GET' && req.query.top != null) {
      const pickEnd = async (rev) => {
        const arr = await redis.zrange(RANK_KEY, 0, 0, { rev, withScores: true });
        if (!arr || !arr.length) return null;
        const artId = arr[0]; const score = Number(arr[1]);
        const info = await redis.hget(META_KEY, artId);
        const m = info && typeof info === 'object' ? info : (() => { try { return JSON.parse(info); } catch { return null; } })();
        const tally = await redis.hgetall(`moodcast:votes:${day}:${artId}`);
        return { id: artId, score, yay: num(tally?.yay), boo: num(tally?.boo), ...(m || {}) };
      };
      const sunny = await pickEnd(true);   // highest net
      const cloudy = await pickEnd(false); // lowest net
      return res.status(200).json({
        sunny: sunny && sunny.score > 0 ? sunny : null,
        cloudy: cloudy && cloudy.score < 0 ? cloudy : null,
      });
    }

    // ---- batch read tallies for the visible cards -------------------------
    if (req.method === 'GET') {
      const ids = String(req.query.ids || '').split(',').map(cleanId).filter(Boolean).slice(0, MAX_IDS);
      const voter = cleanVoter(req.query.voter);
      const votes = {};
      const mine = {};
      await Promise.all(ids.map(async (id) => {
        const tally = await redis.hgetall(`moodcast:votes:${day}:${id}`);
        votes[id] = { yay: num(tally?.yay), boo: num(tally?.boo) };
        if (voter) {
          const choice = await redis.hget(`moodcast:voters:${day}:${id}`, voter);
          mine[id] = choice === 'yay' || choice === 'boo' ? choice : null;
        }
      }));
      return res.status(200).json({ votes, mine, day });
    }

    // ---- cast or switch a vote --------------------------------------------
    if (req.method === 'POST') {
      const passcode = process.env.MOODCAST_PASSCODE;
      if (passcode && req.headers['x-moodcast-pass'] !== passcode) {
        return res.status(401).json({ error: 'Invalid or missing passcode.' });
      }
      if (await overLimit(clientIp(req))) return res.status(429).json({ error: 'Too many votes, slow down.' });

      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const id = cleanId(body?.id);
      const voter = cleanVoter(body?.voter);
      const dir = body?.dir === 'yay' || body?.dir === 'boo' ? body.dir : null;
      if (!id || !voter || !dir) return res.status(400).json({ error: 'Expected id, voter, dir(yay|boo).' });

      const votesKey = `moodcast:votes:${day}:${id}`;
      const votersKey = `moodcast:voters:${day}:${id}`;
      const prev = await redis.hget(votersKey, voter); // 'yay' | 'boo' | null

      let mine = dir;
      if (prev === dir) {
        // Same button again → toggle the vote off.
        await redis.hdel(votersKey, voter);
        await redis.hincrby(votesKey, dir, -1);
        mine = null;
      } else {
        await redis.hset(votersKey, { [voter]: dir });
        await redis.hincrby(votesKey, dir, 1);
        if (prev === 'yay' || prev === 'boo') await redis.hincrby(votesKey, prev, -1);
      }
      await redis.expire(votesKey, KEY_TTL_S);
      await redis.expire(votersKey, KEY_TTL_S);

      const tally = await redis.hgetall(votesKey);
      const yay = Math.max(0, num(tally?.yay)), boo = Math.max(0, num(tally?.boo));

      // Articles (id "art:…") feed the daily sunniest/cloudiest ranking. The
      // client sends lightweight meta so the home card can render the winner.
      if (id.startsWith('art:')) {
        await redis.zadd(RANK_KEY, { score: yay - boo, member: id });
        const meta = body?.meta;
        if (meta && typeof meta === 'object') {
          const clean = {
            title: String(meta.title || '').slice(0, 160),
            source: String(meta.source || '').slice(0, 50),
            url: typeof meta.url === 'string' && /^https?:\/\//.test(meta.url) ? meta.url.slice(0, 400) : '',
          };
          if (clean.title) await redis.hset(META_KEY, { [id]: JSON.stringify(clean) });
        }
        await redis.expire(RANK_KEY, KEY_TTL_S);
        await redis.expire(META_KEY, KEY_TTL_S);
      }
      return res.status(200).json({ id, mine, votes: { yay, boo } });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'server error', detail: String((err && err.message) || err).slice(0, 300) });
  }
}
