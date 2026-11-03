# THE1500 — CORE ARCHITECTURE v1.0

**Status:** approved architecture baseline for implementation review, **not** production-ready code.  
**Date:** 2026-11-03  
**Business decisions source of truth:** [THE1500 — Registro de decisiones comerciales y legales](https://docs.google.com/document/d/1DwUAgNaIVRbWoqYJ64yeMxINt7pAXulcQ-esIGb0ZBQ/edit). Decisions 01–63 confirmed. Question 64 pending. The latest strategic note supersedes earlier assumptions on seller, payment provider, and language.  
**Technical reference:** `docs/source/00_INDICE_MAESTRO_v1_1.md`, `01_PRODUCTO_Y_STORYTELLING.md`, `02_ARQUITECTURA_CONTRATOS.md`, `08_CONTRATO_DE_DATOS_SEMANTICOS.md`, `docs/LAUNCH_GATE.md`.

## 1. Product contract: what a business buys

THE1500 provides a bounded historical business registry containing **no more than 1,500 globally numbered positions**. The paid deliverable is an approved, public, exportable semantic company profile, with:

1. A discoverable, publicly accessible HTML profile at a stable URL.
2. A machine-readable, Schema.org-conformant JSON-LD representation and JSON export, with no requirement to embed it on the client's website.
3. Inclusion in THE1500's own searchable corpus and eligible retrieval by its internal grounded assistant.
4. Evidenced prior approval by the business representative, versioned provenance and controlled corrections.
5. A contractual **12-month publication commitment from actual first publication**, subject to legal terms and exceptions; technical preservation beyond this period is an ambition, not a ten-year guarantee.

All paid tiers and the free-founder cohort receive the same core technical deliverable; price differences reflect scarcity and sequence, not superior search ranking or a different semantic-profile service. The primary acquisition market is the United States, followed by Colombia and other eligible global markets.

The product does **not** guarantee any external model will train on, rank, cite, ingest or recommend a company. An AI suggestion is not independently verified evidence. There is **no recurring editorial update included** after the approved correction window (15 calendar days), except legally required rectifications and safety measures.

## 2. Platform boundary and deployment

**One codebase; modular monolith.** Astro 7 SSR/hybrid on Cloudflare Workers (updated by CORE-005: Astro 6 has unpatched critical advisories); React islands only for interactive UX; TypeScript contracts in `src/lib/contracts`; Cloudflare D1/SQLite for relational source of truth, full-text search via FTS5; R2 for versioned immutable public JSON/JSON-LD snapshots and approved assets; server-side LLM adapter; Stripe payment adapter disabled outside sandbox until the seller is decided and approved.

- Public root `/` = company directory, never the acquisition landing.
- `/unirse` = marketing and acquisition, English-first copy routed as canonical `/join` or `/unirse` according to an explicit routing decision; **preserve `/unirse` and add English copy now** instead of breaking existing paths.
- `/es/` and `/es/unirse` = Spanish routes; core schema is language-neutral, primary editorial language English.
- Browser calls public/authenticated HTTP API; no direct browser access to D1/R2 private objects, Stripe secret or LLM API.
- No Supabase, second backend, standalone vector database or custom knowledge graph for MVP.
- Dev/staging/prod environments isolated, including databases, webhook secrets and asset buckets.

```text
Browser (EN/ES)
  ├─ Directory / Profiles / Join / Account / Admin
  └─ API /v1 (Workers runtime)
        ├─ Identity & authorization
        ├─ Company + provenance + approval
        ├─ Slots / inventory / reservations / orders
        ├─ Payments adapter (Stripe sandbox first)
        ├─ Semantic generation + publication
        ├─ Published-only FTS5 retrieval + grounded Q&A
        └─ Administrative controls + audit log
             ├─ D1: canonical structured data, transactions, index
             ├─ R2: immutable, approved public snapshots
             └─ LLM provider: server-only, non-authoritative drafts
```

## 3. Bounded contexts and ownership

| Context | Owns | Does not own |
|---|---|---|
| `identity` | user accounts, authenticated session, corporate authorization, roles | public business content |
| `companies` | legal identity, brand, service declaration, provenance, ownership | slot numbering or price |
| `inventory` | fixed slots, allocation policy, phase progression, temporary holds, assignment ledger | payment status from browser |
| `commerce` | seller configuration, offers, orders, Stripe reconciliation, credit notes/refunds | public profile approval |
| `semantic` | normalized content, AI draft, source citations, deterministic public JSON-LD mapping | final owner consent |
| `publishing` | approval, immutable public versions, HTML/JSON-LD and 12-month clock | billing taxes |
| `discovery` | published-only filtering, FTS5 and RAG answer with references | third-party ranking guarantees |
| `operations` | founder invitations, Premium applications, audit, metrics, moderation, archival | owner-self publication without authorization |

**Implementation owners:** Claude = D1 schemas, `src/core`, shared schemas, `src/pages/api`, payment, auth, tests; Antigravity = page layout, React islands, styles and UI; assistant = contract coordination, acceptance and consistency review.

## 4. Canonical data model

### Entity definitions (conceptual, Claude must produce final SQL migrations)

- `users(id,email,status,created_at)` and `sessions(id,user_id,expires_at,revoked_at)`; authorized via server-side signed/opaque session with cookie protections.
- `companies(id,legal_name,display_name,slug,country,region,city,website,industry,status,owner_id,created_at)`; **company ≠ user ≠ payer ≠ legal issuer**.
- `memberships(user_id,company_id,role)`; unique business ownership permissions. Corporate email + declaration for ordinary accounts; documents/review for higher-risk cases.
- `company_declarations(company_id,version,original_json,locale,submitted_at,authorized_at)`; raw declaration retained privately.
- `source_evidence(id,company_id,version,claim_path,source_type,source_uri,visibility,verified_by,approved_at)`; differentiates owner declaration and independent verification.
- `profile_versions(id,company_id,version,canonical_json,content_en,content_es,public_jsonld_en,public_jsonld_es,status,created_at)`; immutable after publication.
- `profile_approvals(id,profile_version_id,user_id,disclosure_digest,approved_at)`; never infer approval from mere profile preview.
- `published_snapshots(id,profile_version_id,html_url,json_url,jsonld_url,r2_key,sha256,published_at,unpublished_at)`.
- `slots(number PRIMARY KEY CHECK 1..1500,phase,price_usd_cents,status,assigned_company_id,assignment_kind,assigned_at)`; **exactly 1,500 seeded rows**, no runtime row creation.
- `slot_holds(id,slot_number,company_id,hold_kind,expires_at,status,created_at)`; checkout 20 minutes; bank transfer 5 business days; tax review maximum 24 hours. Expiration never adjudicates a slot.
- `slot_history(id,slot_number,event_type,related_order_id,actor_id,created_at)`; append-only historical sequence, including releases and withdrawals.
- `orders(id,company_id,slot_number,seller_entity_id,payer_id,quoted_price_usd_cents,charged_currency,charged_amount_minor,tax_amount_minor,status,idempotency_key,created_at)`; **do not set `slot_number` globally UNIQUE on historical orders**, as expirations and retries must remain auditable.
- `payment_events(provider_event_id PRIMARY KEY,provider,order_id,payload_digest,event_type,verified_at,result)`; signature verification and idempotent reconciliation.
- `founder_invitations(id,company_id,email,invited_at,expires_at,status,approved_by)`; exactly 100 complimentary founder positions within phase I, by controlled invitation.
- `premium_applications(id,company_id,status,reviewed_by,reviewed_at)`; manual admission and manual closing only for numbers 1351–1500.
- `tax_reviews(id,order_id,status,opened_at,completed_at,hold_id)`; exceptions only; seller tax obligations remain in its control.
- `audit_events(id,actor,action,target,details_hash,occurred_at)`; no payment secrets or raw personal documents in logs.
- `system_settings(key,value,changed_at)` and `legal_entities` / `merchant_accounts`; seller remains configurable pending LLC vs SAS decision, never hardcoded across code.

### Required indexes/invariants

1. One active assignment per slot; one primary active slot per company unless a later explicit business decision allows otherwise.
2. Unique `slug`, `users.email`, payment provider event ID, internal idempotency key and company/profile version combination.
3. One active hold per slot enforced through conditional inventory write and an appropriate partial uniqueness constraint; **timestamp alone cannot enforce exclusivity**.
4. Public queries must filter `status=published` and explicit `visibility=public`; withdrawing must remove from indexes immediately.
5. Snapshots are immutable; new corrections create new versions, never silently mutate an approved publication.
6. The distinction between `occupied`, `temporarily_held`, `published`, `retired` and `available` must be maintained in stats.

## 5. Inventory and price engine

| Position numbers | Band | Price USD | Access |
|---|---|---:|---|
| 1–100 | Founder subset of Phase I | $0 | invite and admin approval only |
| 101–600 | Phase I paid | $100 | automatic checkout |
| 601–1050 | Phase II | $400 | automatic checkout |
| 1051–1350 | Phase III | $1,000 | automatic checkout |
| 1351–1500 | Premium | $5,066 | human admission; no automatic checkout |

**Founders:** 100 of the first 600, not added to the cap; no public "free" badge. The allocation strategy for the 1–100 pool must not allow paid customers to consume founder-only slots. Approvals and assignment audited. Invitation expires seven calendar days.

**Sequential phase rule:** later paid tiers become available only after all positions in prior commercial tiers are assigned/confirmed (not merely held). If a prepublication slot is legally released after a new phase opened, temporarily reopen the original tier at its original price and pause only *new* higher-tier checkouts; honor already-valid higher-tier checkouts. Administrative correction cannot mint extra slots.

**State machine:**

```text
available -> held -> assigned/paid -> profile-published -> retired-withdrawn
               \-> available (hold expiry)
assigned/pre-publication -> available ONLY after lawful refund/confirmed cancellation
assigned/post-publication -> retired (position permanently consumed)
```

`published` is a *profile* state rather than a standalone slot lifecycle state. A public retired position displays only the number and neutral unavailable marker; no withdrawn company's identity.

**Concurrency design:** reserve with conditional SQL (`UPDATE slots ... WHERE status='available' ... RETURNING number` or equivalent safely tested atomic compare-and-swap), create hold/order in the same transactional batch, and check affected rows. Correctness test must run simultaneous claims for the last slot. Never use `SELECT available` followed by an unguarded `UPDATE`.

**Important Stripe integration constraint:** Hosted Stripe Checkout session `expires_at` is configurable between **30 minutes and 24 hours**, while THE1500's ordinary hold policy is **20 minutes**. Do not pretend these timers are the same. On hold expiry, expire the Stripe session server-side when possible; reconcile race conditions/late completed payments with an explicit exception/refund or same-tier reassignment policy. Webhook must check order/hold state again, never assign a released slot. A separate Payment Element implementation may be evaluated if tighter client payment timing is essential. Proof required in sandbox, including simultaneous expiry and payment.

## 6. Company enrollment and verification

1. Minimize registration fields: business name, corporate email, country, website and authorized representative declaration; request billing/tax data when needed to legally calculate and issue seller documents.
2. Verify email ownership through server-side magic link; keep human corporate verification risk-based, not universal.
3. Reject obvious duplicates and queue ambiguous brand/legal-entity duplicates for review.
4. Acquiring a slot and publishing a profile are separate states. Purchase does not authorize public publication.
5. After payment or founder adjudication, business has 15 calendar days to submit its profile; 15-day extension; 15-day reactivation request after suspension; final notice and admin decision follow recorded policies. Scheduling and reminders are backend jobs, not browser timers.

## 7. Semantic pipeline — the actual deliverable

```text
Owner's private declaration + authorized evidence
    -> schema validation + claim/source map
    -> AI-assisted suggested semantic draft (NO invented facts)
    -> deterministic normalized canonical company data
    -> bilingual presentation draft (English primary, Spanish secondary)
    -> owner reviews both public renderings and explicitly approves version
    -> publisher creates HTML + valid Schema.org JSON-LD + JSON export
    -> snapshot in R2, searchable published-only index in D1
    -> internal assistant may cite this version when relevant
```

**Canonical content example (illustrative, not a real company):**

```json
{
  "entity_id": "c_01J_EXAMPLE",
  "legal_name": "Example Co LLC",
  "brand_name": "Example Co",
  "headquarters": {"country": "US", "region": "FL", "city": "Miami"},
  "industry_verticals": ["Logistics"],
  "services": ["Freight coordination"],
  "problems_solved": [{"problem": "Shipment visibility", "solution": "Tracking dashboards"}],
  "audiences": ["Importers"],
  "trust_signals": {"human_verified": false, "source_refs": ["owner_declaration"]}
}
```

**Public JSON-LD uses standard Schema.org fields** such as `@context`, `@type`, `@id`, `name`, `description`, `url`, `address`, `areaServed`, `knowsAbout`/`industry`, `hasOfferCatalog` where warranted. `ai_semantic_embedding` (descriptive text in the internal contract) is **not** a vector and is not a standardized Schema.org field. Proprietary metadata stays out of the public JSON-LD unless mapped to a valid vocabulary. Never expose personal identity documents, private emails, unapproved statements or secrets.

**Language policy:** editable canonical company data remains structured/language-neutral; English is primary and Spanish is a separately generated, reviewable view. Translate factual content without inventing facts. Publish `hreflang` and localized routes when translation exists; show a clearly labeled fallback when it does not. Public claims in both languages must correspond to the owner-approved version.

**SEO and external accessibility:** server-rendered HTML, canonical links, sitemap and accessible JSON-LD are provided to enable discovery; do not promise external crawler behavior, third-party LLM indexing or recommendations.

**Quality fail-closed:** if AI generation fails, preserve draft and allow retry; do not publish unapproved AI text. Flag unverifiable exclusivity/certifications. If no sources match a user query, abstain.

## 8. Published-only search and AI assistant

- First pass: D1 FTS5 + structured filters (sector, service, country, audiences, problems) limited to `published` profiles.
- Retrieval returns deterministic identifiers, snippets and approved source references.
- Second pass optional: provider-independent server-side LLM produces natural-language answers constrained to retrieved snippets; every company claim is linked to its active public profile.
- For zero matches or insufficient evidence, return an explicit **no result / insufficient evidence** response; no invented businesses.
- Guard against prompt injection embedded in business descriptions; treat all company content as *untrusted data*, never as system instructions.
- Implement rate limit, budget ceiling, per-request token bound and response caching where safe.
- Search ranking is relevance-based; payment tier does **not** purchase a higher rank unless a future explicit policy says otherwise.

## 9. Public and authenticated API contract (v1 proposal)

| Method | Endpoint | Permissions | Purpose |
|---|---|---|---|
| GET | `/api/v1/public/stats` | public | real inventory counts; no invented metrics |
| GET | `/api/v1/public/companies` | public | paginated, published-only cards/filters |
| GET | `/api/v1/public/companies/:slug` | public | approved public company profile |
| GET | `/api/v1/public/companies/:slug/jsonld` | public | validated snapshot or 404 |
| GET | `/api/v1/public/industries` | public | actual represented sectors |
| POST | `/api/v1/public/ask` | public, rate-limited | grounded answer and citations |
| POST | `/api/v1/auth/start` / `verify` / `logout` | public/auth | email access with anti-abuse protection |
| POST | `/api/v1/registrations` | authenticated | company registration and ownership declaration |
| GET, PUT | `/api/v1/me/company` | owner | draft data; optimistic version control |
| POST | `/api/v1/me/profile/generate` | owner | semantic draft with claim provenance |
| GET | `/api/v1/me/profile/preview` | owner | EN/ES preview |
| POST | `/api/v1/me/profile/approve` | owner | version-bound informed approval |
| POST | `/api/v1/me/profile/publish` | owner or admin per policy | publish only approved version |
| POST | `/api/v1/orders/hold` | authenticated | conditional 20-min hold |
| POST | `/api/v1/payments/checkout` | authenticated | Stripe test checkout or blocked outside live approval |
| POST | `/api/v1/payments/webhook/stripe` | signature-verified | idempotent payment decision |
| POST | `/api/v1/premium/apply` | authenticated | manual Premium application; no checkout |
| GET | `/api/v1/admin/overview` | admin | inventory, review queues, exceptions |
| POST | `/api/v1/admin/founders/assign` | admin | founder invitation/allocation |
| POST | `/api/v1/admin/review` | admin | human checks and legal withdrawals |

**API discipline:** shared Zod DTOs, error envelopes (`code`, `message`, `requestId`), pagination, idempotency keys on mutating commerce calls, request authorization server-side, structured rate limiting. Publish `API_CONTRACT.md` and generated types before Antigravity connects transactional UX.

## 10. Payments and legal seller configuration

- Define `sellerEntityId`, `paymentProvider`, `currency`, `jurisdictionSettings` through administrative configuration; current seller choice **Aurea Investment Capital SAS vs potentially Modular Home Company LLC is unresolved**. No hardcoded legal seller across email, receipts and terms.
- Stripe sandbox payment intent/session created server-side; price derived from server-owned slots; no client-authored amount.
- Validate actual Stripe account onboarding and merchant banking before live mode.
- Webhook signature verification using raw body, reconciliation of paid/failed/asynchronous outcomes, idempotency, delayed events and chargebacks.
- Operational tax calculation reflects the seller's legal obligations. Collect buyer data proportionally; use approved automated rules/provider, with risk-based manual exception handling, and show a lawful total before payment. Do not build a general tax-compliance service for client companies.
- Distinguish payer, contracting buyer, owner of company profile and tax invoice recipient when relevant.
- The last 150 Premium positions always require an administrative admission/application and manual commercial close.

## 11. Security and data governance

- HttpOnly + Secure + SameSite sessions, CSRF protection for state changes, session revocation and owner/admin checks at API and DB query boundaries.
- `owner` may edit only their company and preview/approve only their version; `admin` can review/audit, not impersonate owner consent.
- Public disclosure allowlist; encrypt/protect sensitive private evidence; log without secrets; access-based R2 media handling.
- Signed, verified Stripe events, replay protection and atomic idempotent state transitions.
- External LLM receives only approved/minimized business data for the selected workflow; no private billing secrets or unrelated user data.
- Separate staging and production; backing up D1/R2 and executing a restoration rehearsal is mandatory before real publication promises.
- A profile withdrawal immediately removes public and search access, but keeps its historical slot unavailable when already published.

## 12. Order of implementation: four acceptance milestones

### CORE-001 — Correct inventory and identity
Deliver: `API_CONTRACT.md`, Zod schemas, migration v2 (do **not** silently edit deployed migration v1), real auth and company memberships, append-only slot ledger, atomic holds, founder admission, read-only stats. Tests: concurrent last-slot claims; 100 founder and tier boundaries; phase reopening; never >1,500 assignments; authorization; 20-minute timeout handling.

### CORE-002 — Semantic publication end to end
Deliver: company declaration, provenance, AI draft, user approval, bilingual preview, valid public JSON-LD and JSON export, immutable R2 snapshots and HTML company profile. Tests: rejects unverifiable claims, no private data, no publication without approval, versions stable, withdrawals remove publicly accessible content, guarantees start at first publication.

### CORE-003 — Discovery and assistant
Deliver: published-only FTS5, country/service filters, relevant search results, grounded `/ask` with public citations and abstention, rate limiting. Tests: unpublished never leaks; no-source abstention; adversarial prompt injections ignored; citations resolve.

### CORE-004 — Checkout and hardening
Deliver: Stripe sandbox checkout/webhooks, idempotency, reconciliation, refund and chargeback states, Premium human admissions, admin audit, backup/restoration, EN/ES interface integration. Tests: payment failure/retry/late webhook; last-slot races; seller config; no live charges until legal/technical gates are met.

## 13. Existing Sprint 0 code audit and necessary fixes

1. **Keep** `/`, `/unirse`, `/es`, initial D1 setup, capacity seeding, public stats, English-first UI bootstrapping.
2. **Refactor** `db/migrations/0001_init.sql`: `orders.slot_number UNIQUE` prohibits clean historical attempts/retries; model separate holds, event ledger, time-limited payment events and seller configuration. Never rely on a stateless webhook.
3. **Refactor** inventory phase calculation: `MIN(phase)` across *held* and available slots can be wrong; phase policy must use confirmed assignments, reserved eligibility, and reopened earlier tiers.
4. **Add** actual auth, corporate authorization, immutable approvals and private/public data separation. `profile_versions` is currently insufficient for provenance and bilingual content.
5. **Add** indexes/search and workflows. Astro pages and `GET /stats` are not proof that a profile can be generated or published.
6. **Verify** Astro build and Cloudflare Worker runtime before staging; previous Sprint 0 only tested SQL invariants.
7. **Reconcile** Stripe hosted checkout expiry minimum (30 minutes) against the business-approved 20-minute hold, using tested session expiration/late-payment logic.
8. **Reconcile** older v1.0 docs that describe 50–100 founders, 15-minute hold, Wompi primary, and multilingual support out of scope: superseded by 100 founders, 20-minute checkout, Stripe under evaluation, and bilingual EN/ES as core requirement.

## 14. Acceptance tests mapped to promises

| Promise | Verification |
|---|---|
| 1,500 lifetime positions | exactly 1,500 seeded; duplicate and out-of-range rejected; 1,501st never sold |
| Tier scarcity | 1/100/101/600/601/1050/1051/1350/1351/1500 boundaries; phase reopening compliant |
| Founder inclusion | 100 founder positions consume inventory; public visibility doesn't reveal free status |
| No oversale | hundreds of concurrent reservations, including expiry and late payments |
| Owner's consent | test fails to publish without version-bound approval and publication authorization |
| Semantic value | meaningful service/problem/solution facts extracted; unsupported claims flagged |
| Public structured profile | HTML + Schema.org JSON-LD passes schema validation; JSON export downloadable |
| Published-only discovery | only authorized active versions show in search and RAG sources |
| Honest AI | zero matches => no fabricated answer; malicious profile data can't hijack model |
| Bilingual experience | navigation, transactional emails, profile content, metadata and error states EN/ES |
| 12-month contract promise | publication clock set to first actual publication date, not purchase date |
| Safe commercial launch | Stripe sandbox signed webhook, tax review, legal seller, terms, privacy, backups and QA |
| Permanent archive | after 1,500th allocation, selling closes, directory still readable |

## 15. Go / no-go checkpoints

**Proceed now:** implementation of the core schema, inventory, identity, profile creation, semantic generation, publishing, and internal discovery in local/staging environments. Do not wait for a new LLC to exist.

**No live charging until:** seller decision and entity verification, Stripe account and test mode evidence, domain, legally reviewed sales/consent/privacy documents, tax treatment, webhook proofs, concurrent inventory tests, security review, database backups and a real staging demonstration.

**No false milestones:** source code != deployed product; passing SQL schema tests != concurrency tested; an AI-generated draft != a published approved profile; exposing JSON-LD != guaranteed ChatGPT/Gemini visibility.

## Official references reviewed

- Astro 6 Cloudflare adapter: https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- Cloudflare Workers with Astro: https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/
- Cloudflare D1 batch transaction and rollback: https://developers.cloudflare.com/d1/worker-api/d1-database/
- D1 FTS5: https://developers.cloudflare.com/d1/sql-api/sql-statements/
- Stripe create Checkout Session (`expires_at`): https://docs.stripe.com/api/checkout/sessions/create
- Stripe checkout async events: https://docs.stripe.com/payments/existing-customers?platform=web&ui=stripe-hosted
