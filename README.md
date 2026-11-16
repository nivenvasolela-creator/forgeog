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

## Accounts and saved workspaces (Supabase)

Without Supabase, FORGE runs with no sign-in and keeps ideas in the
browser. To give each user an account and their own saved ideas:

1. Create a project at supabase.com.
2. In the SQL editor, run the files in `supabase/migrations/` in order (`0000` only matters if the project has tables from an older prototype).
3. From Project Settings > API, copy the project URL and the `anon` public
   key into `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Rebuild and restart. The app now shows a sign-in screen, and
   `/api/analyze` rejects requests without a valid session.

Row level security in the migration keeps every user's ideas and reports
private to them.

## How it works

- Each idea is a workspace. Re-running a revised idea adds a new report
  version, and the score change against the previous version is shown.
- `server.ts` — Express server. `POST /api/analyze` streams progress over
  SSE and makes up to three Gemini calls: a clarity check (may return one
  clarifying question), Google-Search-grounded research, then a structured
  JSON report. Competitors are only kept if they point at a source the
  search actually returned.
- `src/` — React + Tailwind UI: input, working, and report screens.
  `src/lib/store.ts` saves ideas to Supabase when configured, otherwise to
  the browser's `localStorage`.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | Gemini API key |
| `GEMINI_MODEL` | no | Override the model (default set in `server.ts`) |
| `RATE_LIMIT_MAX` | no | Analyses per IP per 10 minutes (default 10) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | no | Turn on sign-in and per-user storage |
| `PORT` | no | Listen port (default 3000) |
