# THE1500

**Status:** core v0.5.0, verified on workerd with local D1 and local stand-ins for Stripe, LLM and email. **Not production-ready and not cleared to take payments.** Start with `CORE005_STATUS.md`, `CORE005_AUDIT.md` and `docs/API_CONTRACT.md`.

## Product
A maximum of 1,500 lifetime positions for authorized, public semantic business profiles. The main domain homepage `/` is the public directory and `/unirse` is the marketing page. Default language: **English**; Spanish: `/es/`. The contractual publication commitment is **12 months from first publication**; 10 years is a technical aspiration only. External AI platform indexing, citation and recommendation are **not guaranteed**.

## Stack
Astro 7 (Astro 6 has unpatched critical advisories), Cloudflare Workers with cron, D1, R2, TypeScript, React islands. Server-side swappable LLM adapter and Stripe over fetch, test mode only.

## Local development
```
node --version                 # recent Node 22+ recommended
npm install
npm run db:migrate:local
npm run dev
```
Open `/` (English directory), `/unirse` (English commercial), `/es/` and `/es/unirse` (Spanish). For initial DB setup Wrangler uses the placeholder database ID for local-only development. **Replace it with a real D1 database ID before any remote deployment.**

## Tests
```
npm run test:db              # schema, Python sqlite3
npm run test:types:isolated  # TypeScript with real Cloudflare types
npm run test:core:runtime    # integration on the real D1 engine, including concurrency
npm run test:e2e             # acceptance journey over HTTP on the built Worker
```
Stripe, the LLM and email are local stand-ins in these tests (`tests/support/upstreams.cjs`).

## Handoff
- Backend: `docs/START_HERE_CLAUDE.md`.
- Frontend: `docs/START_HERE_ANTIGRAVITY.md`.
- Acceptance: `docs/LAUNCH_GATE.md`.
- Original docs: `docs/source/` (may have outdated parameters; decisions in living Google Doc prevail).
- Living decision register: https://docs.google.com/document/d/1DwUAgNaIVRbWoqYJ64yeMxINt7pAXulcQ-esIGb0ZBQ/edit

**Important:** The first developer action is a code audit, not deployment. Do not enable checkout before selecting the selling entity and verifying required legal/technical prerequisites.

History of earlier increments: `docs/CORE001_EXECUTION_ORDER.md`, `docs/CORE002_003_IMPLEMENTATION.md`, `docs/CORE004_IMPLEMENTATION.md`.
