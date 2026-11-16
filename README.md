# FORGE

Paste a messy startup idea, get one honest, grounded reality-check report:
a 0–100 score with breakdown, SWOT, competitors backed by live search
sources, a blueprint, a business-plan sketch, and an explicit list of what
could not be verified.

## Run it

Requires Node 22.18+ and a Gemini API key.

```bash
npm install
cp .env.example .env   # then set GEMINI_API_KEY
npm run dev            # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

`GET /api/health` reports the configured model and whether a key is set.

## How it works

- `server.ts` — Express server. `POST /api/analyze` streams progress over
  SSE and makes up to three Gemini calls: a clarity check (may return one
  clarifying question), Google-Search-grounded research, then a structured
  JSON report. Competitors are only kept if they point at a source the
  search actually returned.
- `src/` — React + Tailwind UI: input, working, and report screens.
  Reports are stored in the browser's `localStorage` (last 5).

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | Gemini API key |
| `GEMINI_MODEL` | no | Override the model (default set in `server.ts`) |
| `RATE_LIMIT_MAX` | no | Analyses per IP per 10 minutes (default 10) |
| `PORT` | no | Listen port (default 3000) |
