# FORGE

A founder operating system: test an idea, get a clear decision, and start
executing this week. In English or Kiswahili.

- **Validate.** Paste a messy idea and get an honest report: a 0–100 score
  with breakdown, SWOT, competitors backed by live search sources, a
  blueprint, a business-plan sketch, and a list of what could not be verified.
- **Decide.** Every report ends in one call, Go, Pivot or Kill, with sharper
  alternative ideas you can test in one click.
- **Execute.** A 7-day launch sprint: small daily tasks with step-by-step
  guidance and ready-to-copy messages and scripts, ticked off as you go.
- **Remember.** A founder profile (skills, time, money, location, goal) that
  every report and plan is tailored to.

## Run it

Requires Node 22.18+ and a key for a model provider (see "Choosing a model").

```bash
npm install
cp .env.example .env   # then set your model provider
npm run dev            # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

`GET /api/health` reports the provider, model, and whether a key is set.

## Hosting for free

The hosted setup has two parts, both free and neither goes to sleep:

- **Site:** GitHub Pages. `.github/workflows/deploy.yml` builds the app on
  every push and publishes it to the `gh-pages` branch. Turn it on once in
  the repo under Settings > Pages > Deploy from a branch > `gh-pages`.
- **API:** the Supabase Edge Function in `supabase/functions/analyze`. It
  runs the same pipeline as `server.ts` (shared code is in
  `supabase/functions/_shared`). Deploy with
  `supabase functions deploy analyze`, and set the secrets `LLM_API_KEY`
  (and optionally `TAVILY_API_KEY`) in the Supabase dashboard under
  Edge Functions > Secrets. Without other settings it uses a free NVIDIA
  Nemotron model on OpenRouter.

## Choosing a model

FORGE can use several providers at once and falls back between them; the
code is in `supabase/functions/_shared/llm.ts`.

- **Gemini (recommended first, free).** Set `GEMINI_API_KEY` (free from
  Google AI Studio, no card). Without `GEMINI_MODEL`, FORGE picks the newest
  stable Flash-Lite model the key can use, the family with the largest free
  daily allowance. Free-tier prompts may be used by Google to improve its
  products.
- **Open models through any OpenAI-compatible API, free.** Set `LLM_API_KEY`
  (and optionally `LLM_BASE_URL` and `LLM_MODEL`; the hosted function
  defaults to NVIDIA Nemotron on OpenRouter). FORGE asks for strict JSON and
  steps down automatically for models that do not support it.
- **Fallback.** With both configured, Gemini is tried first. When a
  provider runs out of quota or is overloaded, the next one serves the
  request, and the exhausted one is skipped for 10 minutes. The health check
  (`GET` on the API) lists the configured providers.
- **Web search.** Set `TAVILY_API_KEY` (free plan) to ground competitors in
  real pages; otherwise reports say plainly that nothing was checked against
  the web.

Groq's free tier was considered and left out: its per-minute token cap is
smaller than one full FORGE report.

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

- The founder profile (`profiles` table) and the UI language are sent with
  every request; the model judges founder fit against the profile and writes
  its output in the chosen language. UI strings live in `src/lib/i18n.tsx`.
- `supabase/functions/_shared/sprint.ts` builds the 7-day sprint (request
  body `mode: "sprint"`); the sprint and its ticked tasks are kept in the
  `sprints` table, one per idea.
- Each idea has a validation plan. A new idea's suggested tests become
  experiments; mark them done with a result and notes, and the next re-run
  sends those results to the model so the score reflects real evidence.
- Each idea is a workspace. Re-running a revised idea adds a new report
  version, and the score change against the previous version is shown.
- `supabase/functions/_shared/analysis.ts` — the pipeline: a clarity check
  (may return one clarifying question), web research, then a structured
  JSON report, streamed to the browser as server-sent events. `server.ts`
  (Node) and the edge function are thin hosts around it. Competitors are only kept if they point at a source the
  search actually returned.
- `src/` — React + Tailwind UI: sign-in, profile, input, working and report
  screens (decision card and sprint panel included).
  `src/lib/store.ts` saves ideas to Supabase when configured, otherwise to
  the browser's `localStorage`.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | one provider | OpenAI-compatible provider for open models |
| `GEMINI_API_KEY` | one provider | Gemini API key, used when `LLM_BASE_URL` is unset |
| `GEMINI_MODEL` | no | Override the Gemini model |
| `RATE_LIMIT_MAX` | no | Analyses per IP per 10 minutes (default 10) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | no | Turn on sign-in and per-user storage |
| `TAVILY_API_KEY` | no | Live web search for grounded competitors |
| `PORT` | no | Listen port (default 3000) |
