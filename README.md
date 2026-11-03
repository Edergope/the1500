# THE1500 — Sprint 0 code bootstrap

**Status:** initial code, NOT the product MVP and NOT ready for production payments. This is a coordinated starting point for Claude (core) and Antigravity (UX).

## Product
A maximum of 1,500 lifetime positions for authorized, public semantic business profiles. The main domain homepage `/` is the public directory and `/unirse` is the marketing page. Default language: **English**; Spanish: `/es/`. The contractual publication commitment is **12 months from first publication**; 10 years is a technical aspiration only. External AI platform indexing, citation and recommendation are **not guaranteed**.

## Stack
Astro 6, Cloudflare Workers, D1, TypeScript; React islands for interactive components, R2 for future approved JSON-LD snapshots. This bootstrap deliberately does not include React screens or Stripe processing: Claude and Antigravity own those modules.

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
npm run test:db
npm run build
```
The database tests use Python 3 `sqlite3` and are intentionally limited to schema invariants, not business-process security. The Astro build requires installation of npm dependencies; until it succeeds, treat the runtime scaffold as unverified.

## Handoff
- Backend: `docs/START_HERE_CLAUDE.md`.
- Frontend: `docs/START_HERE_ANTIGRAVITY.md`.
- Acceptance: `docs/LAUNCH_GATE.md`.
- Original docs: `docs/source/` (may have outdated parameters; decisions in living Google Doc prevail).
- Living decision register: https://docs.google.com/document/d/1DwUAgNaIVRbWoqYJ64yeMxINt7pAXulcQ-esIGb0ZBQ/edit

**Important:** The first developer action is a code audit, not deployment. Do not enable checkout before selecting the selling entity and verifying required legal/technical prerequisites.

## CORE-001 coding increment (2026-11-03)
Programming has started on a separate, additive migration and a private inventory reservation service. This remains a **partial** implementation; see `docs/CORE001_EXECUTION_ORDER.md`, `docs/API_CONTRACT.md`, and `db/migrations/0002_core001.sql`.

Run local tests:
```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Full build remains unverified until `npm install && npm run build` can run with network/package access. Do not deploy or turn on payment collection based solely on SQLite tests. The project is not yet in a dedicated GitHub repository.

## CORE-002/003 source increment — identity, reserved inventory, semantic publishing

The next code iteration adds `0003_core002_identity.sql` and `0004_core003_profiles.sql`, auth and registration APIs, a protected hold API, draft/approval/publication endpoints, an HTML public company profile and machine-readable JSON-LD. It **does not** enable payment collection or AI enrichment. See `docs/CORE002_003_IMPLEMENTATION.md` and `docs/API_CONTRACT.md`.

Local checks (no npm dependency installation needed for these two isolated checks):

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm run test:types:isolated
```

Staging setup requires a real Cloudflare D1 binding and migrations, Resend email configuration in secure Worker secrets, and a successful full Astro build. At first access the app should send a real one-use link via `/login`; it must return a service-unavailable error rather than falsely reporting an email was sent when no provider is configured.

The company registration / profile APIs are backend functionality; the preliminary `/login` and `/mi-cuenta` pages will be redesigned by Antigravity. Current English and Spanish content routes are incomplete until frontend integration.


## CORE-004 source increment — administration, founder award and searchable corpus

- `db/migrations/0005_core004_admin_and_search.sql`: admin grants, 7-day founder invitations, case audit and public-only FTS5.
- `src/core/admin.ts` and `/api/v1/admin/*`: admin-only review and founder invitation; invited owners accept through `/api/v1/me/founder-invitations`. **No founder email automatically sent yet.**
- `src/core/search.ts` and `/api/v1/public/{search,ask}`: full-text search and auditable citation-style retrieval of approved, published businesses; generative LLM is not integrated.
- `src/core/profiles.ts`: keeps the search index in sync with approved publication, and withdraw removes it.

Validation (Node 22+ with experimental SQLite for runtime test):

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -q
npm run test:types:isolated
npm run test:core:runtime
```

See `docs/CORE004_IMPLEMENTATION.md` for limitations and staging directions. Full Astro build, remote D1 runtime and frontend are not verified.
