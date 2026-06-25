# MoodCast

A weather app for *public mood*. MoodCast reads recent headlines across topics and grades their emotional tone into a single 0–100 index — like a weather forecast for how the world feels today. Hero index, 7 categories with drill-down, open search & natural-language questions, saveable subjects, per-entity trend graphs, and a shareable mood card.

Built with React + Vite. Mood readings come from Claude (`claude-sonnet-4-6`) with live web search, called through a serverless proxy so the API key never reaches the browser.

## Architecture

- **`src/MoodCast.jsx`** — the whole app (single component). Persists history, follows, and settings in `localStorage`.
- **`api/grade.js`** — Vercel serverless function. Proxies model calls to the Anthropic Messages API with the `web_search` tool. Reads the key from `ANTHROPIC_API_KEY`.

## Local development

```bash
npm install
# run the SPA + the /api function together (requires the Vercel CLI):
ANTHROPIC_API_KEY=sk-ant-... npx vercel dev
```

`npm run dev` runs the front-end alone, but `/api/grade` (and therefore any mood reading) only works under `vercel dev` or a Vercel deployment, where the function and the env var are available.

## Deploy

Hosted on Vercel. Set `ANTHROPIC_API_KEY` in the Vercel project's Environment Variables. The `/api` function is detected automatically; framework preset is **Vite**.

## Note

Scores are AI estimates of recent news, not a precise measurement — a playful read on the mood of the headlines.
