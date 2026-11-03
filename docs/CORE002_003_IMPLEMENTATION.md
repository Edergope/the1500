# THE1500 · CORE-002 / CORE-003 implementation report

**Date:** 2026-11-03  
**State:** implemented source code, SQLite contract tests passing, isolated TypeScript check passing. **Not deployed or end-to-end verified.**  
**GitHub:** no project-specific THE1500 repository found among the connected repositories. Local source ZIP only.

## What this increment introduces

1. `db/migrations/0003_core002_identity.sql`: passwordless one-use email challenges, secure/revocable session persistence, company website + identity review, owner membership, idempotency for holds, audit log.
2. `src/core/identity.ts`: random 256-bit tokens, SHA-256 token digests, one-time consumption using an atomic D1 batch, 14-day sessions, `__Host-` secure HttpOnly cookie, same-origin checks, per-email and per-IP request throttling, Resend email provider (disabled without secrets).
3. `src/core/companies.ts` + API `/api/v1/registrations`: register a company from an authenticated account, require representative declaration; domain-matching corporate email permits ordinary `self_declared` onboarding; exceptions go to `pending_review` and **cannot reserve/pay** until an administrative process is built.
4. `src/core/inventory.ts` + API `/api/v1/orders/hold`: authenticate owner; conditional atomic 20-minute reservation; authenticated idempotency; rate limit; no duplicate active hold, no already-assigned company; protect founder-only positions 1–100; all pricing server-side. **This is a reservation API only, not Stripe checkout.**
5. `db/migrations/0004_core003_profiles.sql` + `src/core/profiles.ts`: owner-declared semantic content, English primary and optional Spanish description, Schema.org JSON-LD, explicit version/digest-bound owner approval, publication only with a confirmed assigned slot and verified eligibility, immutable publication snapshots.
6. `/api/v1/public/companies`, `/:slug`, `/:slug.json` and `/empresas/:slug`: read-only profiles; only published versions are visible. Company descriptions are owner-declared, not independently verified.
7. Astro 6 runtime correction: Cloudflare D1 bindings are imported from `cloudflare:workers`, not from the removed `locals.runtime.env` property.

## Exact route inventory (auth and profile)

| Route | Method | Auth | Result |
|---|---|---|---|
| `/login` | GET | public | Temporary email sign-in form |
| `/auth/verify?token=...` | GET | public | Confirmation page with no state change; avoids scanner-initiated login |
| `/api/v1/auth/request-link` | POST | same origin | 202 when mail requested; 503 without configured mail |
| `/api/v1/auth/verify` | POST form | same origin, one-use token | 303; secure session cookie |
| `/api/v1/auth/me` | GET | session | Current user + company memberships |
| `/api/v1/auth/logout` | POST | same origin | Revokes DB session + expires cookie |
| `/api/v1/registrations` | POST JSON | session | New company + ownership membership |
| `/api/v1/orders/hold` | POST JSON | owner + Idempotency-Key | 20-minute hold, payment not started |
| `/api/v1/me/company/profile` | PUT JSON / GET | owner | Draft, canonical data and preview digest |
| `/api/v1/me/company/approve` | POST JSON | owner + explicit consent + digest | Immutable approval of specified version |
| `/api/v1/me/company/publish` | POST JSON | owner + confirmed assignment | Published profile version |
| `/api/v1/public/companies` | GET | public | Paginated published-only companies |
| `/api/v1/public/companies/:slug` | GET | public | Public company record |
| `/api/v1/public/companies/:slug.json` | GET | public | Schema.org JSON-LD export |
| `/empresas/:slug` | GET | public | Plain initial HTML profile, for Antigravity to redesign |

### Example hold request (never assume payment succeeded)

```http
POST /api/v1/orders/hold
Content-Type: application/json
Idempotency-Key: acb07b23f9de45a6bfb42e6889daca35
Cookie: __Host-the1500_session=[opaque-secret]
Origin: https://your-staging-domain.example

{"companyId":"authenticated-company-id"}
```

Returns `hold`, `paymentStatus: "not_started"`, `checkoutEnabled: false`. A reserved slot is not a paid/adjudicated slot.

### Example draft → approve

```json
{
  "companyId":"company-id",
  "descriptionEn":"We provide ocean freight coordination and shipment visibility for importers and logistics teams.",
  "descriptionEs":"Prestamos servicios de coordinación de carga marítima y visibilidad de embarques para importadores y equipos logísticos.",
  "services":["Freight coordination","Shipment visibility"],
  "audiences":["Importers","Freight forwarders"],
  "problemSolutions":[{"problem":"Limited shipment status visibility","solution":"Consolidated shipment updates"}],
  "advantages":[],
  "serviceCountries":["US","CO"]
}
```

`PUT /api/v1/me/company/profile` accepts this JSON. It returns `version`, a JSON-LD preview and `contentDigest`. Owner must review content and explicitly POST `{companyId,version,contentDigest,acceptPublicDisclosure:true}` to `/api/v1/me/company/approve`. Publishing is a separate step and requires a confirmed assigned slot. **No AI generation was falsely simulated**: this increment does deterministic Schema.org mapping of owner-declared data; AI text enrichment is not connected.

## Test evidence and limits

- `python3 -m unittest discover -s tests -p 'test_*.py' -v` — **31 tests passed** in SQLite, including baseline, schema, token replay, hold indexes, founder number exclusion and publication visibility.
- `npm run test:types:isolated` — checked core and TS API sources with a self-contained minimal D1/Astro signature shim. This is *not* framework or Cloudflare adapter compilation.
- `npm install` / `npm run build` — **not verified** because the environment cannot resolve/download npm packages. No claims of successful Astro build.
- Live D1 concurrency, endpoint/browser integration, real email delivery, Stripe test payment flow, LLM retrieval, and full security tests — **not executed**.
- The SQL migration 0003/0004 is additive and tested on a new SQLite DB. Existing deployed DBs have not been discovered or reconciled.

## Unimplemented / blocking

**Required next, in order:**

1. Cloudflare staging D1 deployment, actual Astro 6 build and browser tests; use real D1 binding and environment secrets.
2. Admin invitation/assignment of the 100 free founder positions; verified payment/webhook state transitions before paid slot assignment. Premium remains manual.
3. Company draft editor + preview/approval UI in English and Spanish, built by Antigravity against existing owner API.
4. Email provider configuration and mail delivery tests; audit/capture failed deliverability, bounce and abuse.
5. R2 immutable snapshots, content provenance UI, corrections/withdrawal and 12-month publication monitoring.
6. Grounded internal query `/public/ask` with citation-based retrieval; AI enrichment only from owner-authorized facts, no external AI ranking guarantees.
7. Stripe test + settlement after the LLC/SAS seller decision, compliant legal docs and company onboarding; paywall remains disabled now.
8. Comprehensive D1 concurrency and recovery tests for hold expiry, idempotent webhooks, refunds and account abuse.

## Business promise safeguard

Only published, owner-approved company facts can become public. The 1,500 cap is historical. The site must not promise external LLM indexing or ranking, a ten-year contractual lifetime, or automatic verification of customer-provided claims. The 12-month commitment starts on first actual publication and requires monitoring plus contractual text before launch.
