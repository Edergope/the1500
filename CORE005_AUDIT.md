# CORE-005A — Technical audit of THE1500 CORE-004 v0.3.0

**Date:** 2026-11-03 · **Auditor:** Claude (Opus 5.5) · **Baseline:** commit `59e1119` on local git, SHA-256 manifest verified (100/100 files OK).
**Environment:** macOS (Darwin 25.6), Node 22.23.2, npm 10.9.8, Python 3.9.6, Wrangler 4.157, workerd via Wrangler `getPlatformProxy` and `wrangler dev`.

> Scope of this document: state of the code **as delivered**. What was later fixed is tracked in the last section and in `CORE005_STATUS.md`.
> No remote Cloudflare, real Stripe, real LLM or real e-mail was exercised: no credentials were provided (see "External blockers").

## 1. Commands actually run on the delivered code

| Command | Result on delivered code | Evidence |
|---|---|---|
| `npm install` | **FAIL** — `ERESOLVE`: `astro@^6` vs `@astrojs/cloudflare@^14` (peer `astro@^7.4`); then `workers-types@^4` vs `wrangler` peer `^5` | The package manifest could never have installed. Earlier QA recorded "NOT EXECUTED". |
| `npm run test:db` | PASS, 42 tests | Schema only, via Python `sqlite3`, not D1. |
| `npm run test:types:isolated` | Could not run (no `tsc`) until install was fixed; then PASS | Uses hand-written D1 stubs, not real `workers-types`. |
| `npm run test:core:runtime` | Could not run until install was fixed; then PASS, 24 checks | Node SQLite adapter, not workerd. |
| `npm run build` | **FAIL** — `wrangler.jsonc` `main` points to a non-existent `dist/_worker.js/index.js` (Astro ≤5 layout). On Astro 6 also `Syntax error "$"` in `src/pages/empresas/index.astro` | Fixed by correcting `main` and moving to Astro 7. |
| `npm audit` (with Astro 6.4.8) | **1 critical, 1 high, 1 moderate, 1 low** — Astro RCE via AVIF optimisation, XSS, authorisation bypass; only fixed in `astro>=7.3.2` | Moved to `astro@^7.4`, audit: 0 vulnerabilities. |
| `wrangler d1 migrations apply DB --local` | PASS for 0001–0005 | First evidence on the D1 engine. |
| `wrangler dev` + curl of `/`, `/unirse`, `/empresas`, `/es/`, `/api/v1/public/{stats,search,companies}` | 200; `stats` real from D1 | `request-link` returns 503 correctly when no mail provider exists. |

## 2. Findings

Severity: **C** critical · **H** high · **M** medium · **L** low. Probe = reproduced with a script against the real D1 engine.

### Security and integrity

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| A-01 | C | Dependencies did not install; the critical Astro advisories applied to the documented "Astro 6" stack. | §1 |
| A-02 | H | **Domain self-verification bypass.** `x@foo.co.uk` registering `https://co.uk` and `x@gmail.com` registering `gmail.com` both become `self_declared` and `checkoutEligible=true`. Breaks Decision 13 ("corporate email"). | Probe |
| A-03 | H | **Founder identity leak.** Founders are hard-reserved to numbers 1–100, so any public position ≤100 reveals founder status, contradicting Decision 35 (no public signal) and Decisions 31–32 (ascending by confirmation inside the 600). See §4. | `inventory.ts`, `0005` trigger |
| A-04 | H | No withdrawal implementation at all: the only "withdrawal" is a test running raw SQL. Slot is never moved to `retired`; Decisions 17 and 29 not implemented. | `grep`; runtime test line 86 |
| A-05 | H | No irreversible first-publication marker on `slots` (Decisions 17, 30). Nothing at DB level prevents returning a published slot to `available`. | `0001`–`0005` |
| A-06 | M | `reviewCompany` on a duplicate website surfaces raw `D1_ERROR` → generic 503 instead of a conflict. | Probe |
| A-07 | M | Older approved versions can be published after newer ones: public HTML uses `MAX(version)` while FTS gets the older text → index and page disagree. | Code review |
| A-08 | M | Approved content is not immutable: no trigger stops `canonical_json`/`public_jsonld` changing after approval, so "approved digest" does not bind what is published. `publishProfile` does not re-check it. | Code review |
| A-09 | M | No correction window (Decision 06): new versions can be published forever. | Code review |
| A-10 | M | `/public/ask` and login have no shared rate limiter usable for LLM cost control. | Code review |
| A-11 | M | No security headers beyond JSON routes; no `apiError` logging, so production failures are invisible. | Code review |
| A-12 | L | Stray auto-provisioned `SESSION` KV and `IMAGES` bindings on deploy, unused by the core. | Build log |

### Functional correctness

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| B-01 | H | **Concurrency:** N=20 simultaneous valid holds → **1 success, 19 `SLOT_CONFLICT`**, because all race for one precomputed number and the loser gets no retry. No oversale, but it fails legitimate buyers under exactly the launch scenario. | Probe |
| B-02 | H | **Paid path does not exist:** no `assign_paid`, no checkout, no webhook. Holds can never convert. Only founders can ever obtain a slot. | `grep` |
| B-03 | H | **No AI flow:** "profile" is a deterministic copy of the owner's fields. No declaration record, consent, provenance or processing-start event (Decisions 11, 12). | `profiles.ts` |
| B-04 | H | JSON-LD uses properties not valid for `Organization` (`inLanguage`, `industry`); `@id` is a URN, not a resolvable URL; omits problems/solutions it claims to publish; no provenance. | `buildJsonLd` |
| B-05 | M | Search has no `industry`/`service` filters and no `country` filter on FTS; `ask` treats any single-keyword hit as evidence, never abstains on partial matches, and citations carry no verifiable quote or digest. | `search.ts` |
| B-06 | M | No archive mode: `currentPhase=null` only produces a generic error. No `salesMode` for the frontend. No admin endpoints for payments, incidents, withdrawals, Premium, full company management. | Code review |
| B-07 | M | Onboarding deadlines (Decisions 19–23, 34) absent. | `grep` |
| B-08 | M | No i18n of errors or communications; only ad-hoc strings in `ask`. Founder invitations are never e-mailed. | Code review |
| B-09 | M | No revocation beyond single logout; no admin block; `editor` role exists in schema but no route honours it. | Code review |
| B-10 | L | `orders`/`payment_events` from Sprint 0 are dead tables next to `purchase_attempts`. `purchase_attempts` status CHECK lacks states needed by Decisions 18/42. | Migrations |
| B-11 | L | Provider-side constraint unmodelled: Stripe Checkout `expires_at` must be **30 min–24 h** after creation ([docs](https://docs.stripe.com/api/checkout/sessions/create)), so a 20-minute Stripe session is impossible. | Stripe API reference, checked 2026-11-03 |

### Documentation vs code

| Doc | Claims | Reality |
|---|---|---|
| README, `CORE_ARCHITECTURE_v1.md` | "Astro 6" | Not installable with that adapter; unsafe per audit. |
| `API_CONTRACT.md` v0.2 | Says no founder awards and no RAG in one section, describes them in another | Two contradictory sections; no DTOs, no error catalogue. |
| `README.md` | "Run `npm run build`" | Failed. |
| `CORE_ARCHITECTURE_v1.md` | Zod contracts, R2 snapshots, Stripe adapter | None present. |
| `LAUNCH_GATE.md` | Status block still "Sprint 0" | Out of date. |

## 3. What was verified as working in the delivered code

D1 migrations 0001–0005 on the real engine · exactly 1,500 slots and tier CHECKs · tier sequencing via `MIN(phase)` (handles Decision 40 reopening) · 20-minute hold TTL and sweep · magic-link one-use consumption and digest-only storage · session revocation on logout · same-origin enforcement · founder invitation/acceptance with audit · explicit approval with content digest · FTS withdrawal trigger.

## 4. Decision conflicts found

| # | Conflict | Treatment |
|---|---|---|
| 1 | **Decision 05** says founders occupy "los primeros 100 de los 600". **Decisions 31, 32, 35** (later and more specific) say numbers ascend by order of confirmation/award within the tier, and founder status must never be publicly revealed. A fixed 1–100 range makes every position ≤100 identifiably a founder. | Implemented the later decisions: shared ascending pool in 1–600, capped at 100 founders and 500 paid, with the 100 founder places protected from paid holds. **Requires the owner's confirmation.** One function and one trigger to revert. |
| 2 | Decision 01 names Aurea Investment Capital SAS; the strategic note reopens it. | Seller is configuration (`legal_seller_configuration`, `unapproved` by default). No entity name in code. Blocks live mode. |
| 3 | Decisions 50–63 (tax review, revised offers) vs strategic note point 4–5 ("simplify", "suspend expansion of tax micro-decisions"). | Not implemented; live payments stay blocked behind a gate until the owner resolves it. Recorded as a launch risk. |
| 4 | Decision 38 (strict sequence) + Decision 32 (founders by invitation only): if paid places sell out but founder invitations stay unaccepted, tier 2 can never open. | Implemented as written, surfaced as `salesMode:"awaiting_founder_allocation"`. **Commercial risk for the owner to decide.** |

## 5. External blockers

| Dependency | Blocks | Needed from |
|---|---|---|
| Cloudflare login / real D1 and R2 IDs | Remote D1 proof, staging deploy, cron in production | Owner |
| Stripe test keys (`sk_test_…`, `whsec_…`) | Real sandbox round-trip | Owner, after seller decision |
| LLM API key | Real AI generation and grounded answers | Owner |
| Resend key + verified domain | Real e-mail | Owner |
| Seller entity decision | Live mode, terms, invoices | Owner |
| Question 64 | Premium intake channel | Owner |
| Tax rules (Decisions 50–63) | Live checkout totals | Owner / counsel |

## 6. Launch risks

1. Cloudflare D1 remote has not been exercised: latency and replication behaviour unproven. Writes are serialised by D1, so the atomic SQL should hold, but this needs staging evidence.
2. Founder allocation can stall tier opening (conflict 4).
3. No tax engine: live checkout must remain closed.
4. LLM claim checks are heuristic guardrails, not proof. Owner approval remains the real control.
5. FTS5 is lexical, English-stemmed retrieval: Spanish recall is weaker, synonyms are not matched. Must not be sold as semantic search.
6. D1 cannot export databases with virtual tables without dropping FTS first: backup runbook needed.
