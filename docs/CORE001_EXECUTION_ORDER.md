# THE1500 — CORE-001 Implementation Handoff

**Date:** 2026-11-03  
**Status:** programming started; **NOT** production-ready.
**Technical owner:** Claude (core). **UI owner:** Antigravity. **Business owner:** project promoter.

## Implemented here (initial foundation)

1. `db/migrations/0002_core001.sql`: additive schema, no destructive changes to legacy `orders`. New purchase attempts are distinct from historic slot ownership. Includes membership/session structure, 20-minute holds, founder quota constraints, append-only slot audit and seller payment-mode gate.
2. `src/core/inventory.ts`: internal-only conditional D1 batch reservation, 20-minute expiry, priority for reopened earlier price bands and refusal to automate Premium reservations.
3. `src/lib/contracts/inventory.ts`: shared typed inventory response/error and hold receipt.
4. `docs/API_CONTRACT.md`: integration boundary and no-live-payment invariants.
5. `tests/test_core001_inventory.py`: migration invariants and a **SQLite-backed**, not D1-backed, concurrency simulation.

## Verified locally
- Python SQLite unittest: **16/16 passed** (original 7 + 9 CORE-001 tests).
- Isolated TypeScript checking for `src/core/inventory.ts` and contract: **passed** with temporary minimal D1 interface shims.
- npm package installation: **NOT verified** — npm registry DNS unavailable (`EAI_AGAIN`); Astro/Cloudflare build and adapter checks remain blocked in this environment.
- Cloudflare D1 integration/staging: **NOT executed**.

## Immediate next tasks (Claude)

1. Audit `db/migrations/0001_init.sql` and `0002_core001.sql` against the current live Google Drive decision log. Confirm all existing deployments (if any) before migration.
2. Create `src/core/identity/**` authentication with secure session cookies, email verification, membership authorization and audit. No public hold route until the caller's membership/eligibility is verified server-side.
3. Add authenticated `POST /api/v1/orders/hold` with CSRF defense, rate limits, idempotency, no double active holds and safe conflict retries. Reconcile eventual duplicate Stripe events separately.
4. Implement founder allocation and revocation with atomic slot state transitions and founder-award records. Free founder company identity must not leak through public labels.
5. Strengthen expiration with a scheduled sweep; test reallocation of an expired hold and correct late payment handling. Record expiry events.
6. Add **real Cloudflare D1 integration tests** for 12+ parallel hold requests competing for last slot, phase exhaustion, mid-flight cancellation and reopening. Use staging D1, not the SQLite race test as production evidence.
7. Establish actual Astro + Workers build and deployment in staging; remove placeholder D1 ID only when project owner supplies a real binding.
8. Define Stripe test-mode adapter only after the legal seller and merchant account are confirmed; do not turn on payments automatically.

## Immediate next tasks (Antigravity)

1. Read `docs/API_CONTRACT.md` and `docs/CORE_ARCHITECTURE_v1.md`.
2. Produce English-first directory `/` and sales `/unirse`, and full Spanish `/es/` experience, using backend-owned inventory numbers exclusively.
3. No fabricated customers, sector occupancy or external AI rankings; demo data must be clearly marked.
4. Do not expose a production checkout CTA while seller/payment gate is pending.

## Promised core functionality that is **not implemented** in this commit
- Verified login / user-company membership permissions.
- A secured publicly reachable hold API or slot-to-order assignment after verified payment.
- Stripe checkout/webhooks, payment settlement or refunds.
- Company form, AI semantic generation, provenance validation or explicit owner approval.
- Public company profile HTML, JSON-LD snapshots, export and approved-content FTS5.
- Grounded assistant with verifiable citations.
- Production QA, security audit, terms, tax review and final seller onboarding.

## Go/no-go
This package is **CORE-001 / starter increment only**. Never advertise paid memberships or grant a paid/assigned slot from a browser redirect. Follow the complete `docs/LAUNCH_GATE.md` before live collection.
