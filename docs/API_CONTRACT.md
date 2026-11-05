# THE1500 API Contract v1.2 (CORE-008)

**Owner:** Claude (core). **Consumer:** Antigravity. **Types to import:** `src/lib/contracts/api.ts`.
**Verified by:** `tests/integration/*`, `tests/e2e/journey.cjs`. A test fails if a route exists without being listed here, or the reverse.
Business rules live on the server. The frontend never computes price, position, availability or permission.

> **Changes in v1.2:** additive. Final notice and case resolution, refund deadline and alternative method, chargeback regularization, third-party payer review.
>
> **Changes in v1.1:** reactivation is now requested and then decided by administration (new onboarding states). Premium has a portal form. `legalBasis` on requests. Late payments need a documented human decision. `requestId` is required to execute a withdrawal.
>
> **Breaking changes from v0.2:** `hold.slotNumber` removed (a number is assigned on confirmation, Decision 30). `PUT /me/company/profile` body changed (`description`, `consent` required). Founder accept requires `acceptTerms`, `termsVersion` and no longer assigns a position: an admin awards it. JSON-LD is now `@graph`.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base | Same origin. All paths below start with `/api/v1`. |
| Auth | `__Host-the1500_session` cookie, HttpOnly, Secure, SameSite=Lax. Set by `/auth/verify`. JS cannot read it. |
| CSRF | Every POST/PUT requires a same-origin `Origin` header (the browser sends it). Exception: `/webhooks/stripe`, authenticated by signature. |
| Body | `Content-Type: application/json`, except `/auth/verify` (form). 4 KB limit unless noted. |
| Idempotency | `POST /orders/hold` and `/orders/checkout` require `Idempotency-Key`: 16–128 of `[a-zA-Z0-9_-]`. Generate once per user intent; reuse on retry. |
| Language | Errors follow `?lang=`, then `X-Locale`, then `Accept-Language`. Default `en` (en-US). Spanish: `es`. |
| Money | Integer cents. Base prices are before tax (Decision 09); always show `taxStatus`. |
| Dates | ISO 8601 UTC strings. |

**Permissions.** `public`: no session. `user`: any session. `member`: owner or editor of that company. `owner`: owner only. `admin`: `platform_admins` entry.

**Error shape, on every non-2xx:**
```json
{"error":{"code":"HOLD_EXPIRED","message":"This reservation has expired.","locale":"en"}}
```
Branch on `code`. Show `message`. Status: 400 invalid · 401 no session · 403 not allowed · 404 not found · 409 state conflict · 413 too large · 415 wrong type · 429 rate limited · 503 unavailable, retry later. Full code list with EN/ES text: `src/lib/i18n/messages.ts`.

## 2. Auth

| Method, path | Perm | Body | Success |
|---|---|---|---|
| POST `/auth/request-link` | public | `RequestLinkBody` | 202 `{status:"link_requested"}`. Same reply whether or not the address exists or was rate limited. 503 `MAIL_NOT_CONFIGURED` / `MAIL_DELIVERY_UNAVAILABLE`. |
| POST `/auth/verify` | public | form `token`, `lang?` | 303 to `/mi-cuenta` (`/es/mi-cuenta` with `lang=es`) with cookie. 401 `INVALID_OR_EXPIRED_LINK`; a browser navigation gets 303 to `/login?expired=1`. Used by the existing `/auth/verify` page. Links last 15 minutes and work once; opening the page does not consume them. |
| GET `/auth/me` | user | | `MeResponse` |
| POST `/auth/logout` | user | | `{status:"signed_out"}` |
| POST `/auth/logout-all` | user | | `{status:"signed_out_everywhere",sessionsRevoked}` |

## 3. Company

| Method, path | Perm | Body / query | Success · key errors |
|---|---|---|---|
| POST `/registrations` | user | `RegistrationBody` | 201 `RegistrationResponse` · `INVALID_REGISTRATION`, `INVALID_WEBSITE`, `COMPANY_CONFLICT`, `REGISTRATION_LIMIT` |
| GET `/me/company?companyId=` | member | | `CompanyStatusResponse`: drives `/mi-cuenta` |
| POST `/me/company/members` | owner | `{companyId,email,action:"add"\|"remove"}` | `{companyId,email,role}` · `MEMBER_NOT_REGISTERED` |
| POST `/me/company/requests` | owner | `{companyId,kind:"withdrawal"\|"cancellation",reason,legalBasis?:"data_protection"\|"illicit_content"}` | 201 `{requestId,kind,status,legalBasis,requestedAt,structuringStartedAt}` · `REQUEST_ALREADY_OPEN`. Administration decides and executes it. `legalBasis` only on withdrawals. |
| POST `/me/company/reactivate` | owner | `{companyId}` | `{companyId,status:"reactivation_requested",reactivationRequestedAt}`. Valid until day 45 · `INVALID_ACTION`. Does not reopen the form: see §8. |
| POST `/me/company/final-notice-response` | owner | `{companyId,message}` | `{companyId,finalNoticeResponseAt}` · `INVALID_ACTION`. Available once `onboarding.finalNoticeSentAt` is set. `message` 3–1000 chars. |
| POST `/me/company/premium-request` | owner | `{companyId,message,contactPreference?:"email"\|"meeting"\|"no_preference"}` | 201 `{requestId,companyId,status:"received",contactPreference,createdAt}` · `PREMIUM_NOT_OPEN`, `REQUEST_ALREADY_OPEN`, `COMPANY_ALREADY_ASSIGNED`. `message` 10–2000 chars. |
| GET `/me/founder-invitations` | user | | `{invitations:[{invitationId,companyId,companyName,expiresAt}]}` |
| POST `/me/founder-invitations/accept` | owner | `{invitationId,acceptTerms:true,termsVersion}` | `{invitationId,companyId,status:"accepted",acceptedAt}`. **No position yet**: show "pending award" until `GET /me/company` returns `position`. · `TERMS_REQUIRED`, `INVITATION_EXPIRED` |

`identityState`: `self_declared` (corporate email matched the website, can buy) · `pending_review` (show "under review", cannot buy) · `admin_verified` (can buy) · `rejected`.

## 4. Purchase

```
POST /orders/hold → POST /orders/checkout → redirect to checkoutUrl → Stripe → webhook assigns the position
```
| Method, path | Perm | Body | Success · key errors |
|---|---|---|---|
| POST `/orders/hold` + `Idempotency-Key` | owner | `{companyId}` | 201 `HoldResponse` · `COMPANY_REVIEW_REQUIRED`, `ALREADY_ALLOCATED`, `ACTIVE_HOLD_EXISTS`, `PHASE_PENDING`, `PAID_CAPACITY_PENDING_FOUNDERS`, `PREMIUM_ADMISSION_REQUIRED`, `SALES_CLOSED`, `HOLD_EXPIRED`, `TOO_MANY_REQUESTS` |
| POST `/orders/checkout` + `Idempotency-Key` | owner | `CheckoutBody` | 201 `CheckoutResponse` · `TERMS_REQUIRED`, `HOLD_NOT_FOUND`, `HOLD_EXPIRED`, 503 `PAYMENTS_DISABLED`, 503 `CHECKOUT_PROVIDER_UNAVAILABLE`, 403 `LIVE_PAYMENTS_NOT_AUTHORIZED` |
| POST `/webhooks/stripe` | signature | raw Stripe event | server-to-server only. Not for the frontend. |

Frontend rules:
1. **Returning from Stripe proves nothing.** On `/mi-cuenta?checkout=returned`, poll `GET /me/company` until `position` is set. If it takes long, say the payment is being confirmed.
2. Show a countdown to `reservationExpiresAt` (20 minutes). The Stripe page can stay open up to about 31 minutes because Stripe's minimum is 30. A payment after the reservation ends is reconciled by staff and may be refunded, so warn about this.
3. Show `amount.taxStatus`. While `not_determined`, this is sandbox only.
4. `hold` carries no number. Show a position only from `GET /me/company`.
5. `stats.checkoutOpen` is about the sale (is this tier on sale), not about the payment provider. Disable buying when it is false. A hold response with `checkoutEnabled:false` means payments are off in this environment, as on staging today: say so and do not send the user to pay.

## 5. Semantic profile

| Method, path | Perm | Body / query | Success · key errors |
|---|---|---|---|
| PUT `/me/company/profile` (20 KB) | member | `DeclarationBody` | 201 `DraftResponse`, may take up to ~1 min with AI on · `CONSENT_REQUIRED`, `INVALID_DECLARATION`, `NO_CONFIRMED_SLOT`, `ONBOARDING_SUSPENDED`, `CORRECTION_WINDOW_CLOSED`, `PUBLICATION_BLOCKED`, `TOO_MANY_REQUESTS` |
| GET `/me/company/profile?companyId=&version=` | member | | `{companyId,version,canonical,preview,previewEs,approvedAt,publishedAt,reviewStatus,generation,contentDigest}` |
| POST `/me/company/approve` | owner | `ApproveBody` | `ApproveResponse` · `EXPLICIT_APPROVAL_REQUIRED`, `STALE_PROFILE_PREVIEW`, `ALREADY_APPROVED` |
| POST `/me/company/publish` | owner | `{companyId,version}` | `PublishResponse` · `PROFILE_NOT_APPROVED`, `PROFILE_REQUIRES_REVIEW`, `COMPANY_REVIEW_REQUIRED`, `PUBLICATION_BLOCKED`, `NO_CONFIRMED_SLOT` |
| GET `/me/company/export?companyId=` | owner | | Exportable profile: `{exportedFormat:"the1500.semantic-profile.v2",...}` |

Preview screen must:
- Show which text is `ai_generated` / `ai_translated`, `owner_declared` or `corroborated`, from `canonical.provenance`.
- Show `generation.mode`. `deterministic` means no AI text is present (`reason`: `ai_disabled`, `ai_failed:*`, `ai_output_rejected:*`). Never call it AI-generated.
- List `unsupportedClaims`. If `reviewStatus:"pending"`, say a person must review it before publication.
- Send the unmodified `contentDigest` with a positive act (`acceptPublicDisclosure:true`). Inactivity is never approval (Decision 12).
- Corrections before approval: PUT again with `correctionNote`, then review the new version.

`clients` and `advantages`/`certifications` (unless `publish` opts in) never appear publicly.

## 6. Public

| Method, path | Query / body | Success |
|---|---|---|
| GET `/public/stats` | | `InventorySummary`; `phases` lists only phases already open or finished |
| GET `/public/companies` | `page,query,country,industry,service,lang` | `DirectoryResponse` (ascending position, 24 per page) |
| GET `/public/companies/:slug` | `lang` | `PublicProfile`; 404 `PROFILE_NOT_FOUND`, also when withdrawn |
| GET `/public/companies/:slug.json` | `lang` | Schema.org JSON-LD (`application/ld+json`); 404 with empty body |
| GET `/public/search` | `query` (≤220), `limit` (1–12), `country`, `industry`, `lang` | `SearchResponse` |
| POST `/public/ask` (1.2 KB, same origin, 20/hour per client) | `AskBody` | `AskResponse` |
| GET `/public/retired-positions` | | `RetiredPositionsResponse` |

HTML at `/empresas/:slug` and `/es/empresas/:slug` is rendered by the page; use `PublicProfile` in redesigns and keep the `<script type="application/ld+json">` from `public_jsonld`.

`salesMode` decides what `/unirse` shows:
| Value | Meaning | UI |
|---|---|---|
| `selling` | Automatic checkout open at `currentPriceUsdCents` | Buy |
| `awaiting_founder_allocation` | 101-600 sold out; tier 2 opens only when all 600 are definitively awarded (Decisions 38-39) | No buy; say the next tier is not open yet |
| `premium_admission` | Last 150. Human admission (Decision 64) | Application form posting to `/me/company/premium-request`. No checkout. Never present a meeting as a requirement. Applying holds no position. Show progress from `premiumRequest` in `GET /me/company` |
| `closed_archive` | All positions consumed | Sold out; directory stays fully available |

Search is **lexical** (`retrieval.semantic:false`): do not call it semantic or AI search. Ask: label `llm_grounded`, `retrieval_only` and `abstained` differently; always render `citations` with links and `limitations`. Retired positions show **only** the number and the exact label: `labelEs` is Decision 29's text, `label` is an English rendering pending the owner's approval. Never display fictitious numbers or a founder badge. Positions 1-100 are founders' and 101-600 paid (Decision 05, confirmed 2026-11-03), and sales of 101-600 run while founders join: do not build any UI that points this out.

## 7. Administration (all `admin`; mutations need `reasonCode` `[a-zA-Z0-9_-]{3,64}` and `evidenceReference` ≤400 chars unless noted)

| Method, path | Body / query | Purpose |
|---|---|---|
| GET `/admin/overview` | | Occupancy, founders, queues, payment totals |
| GET `/admin/companies/detail` | `companyId` | Control center: company, owner, process, versions, requests, incidents, attempts, merged history |
| GET `/admin/profiles/detail` | `companyId,version` | Control center: declaration, canonical JSON, JSON-LD EN and ES, generation record, approval, publication, integrity checks |
| GET `/admin/audit` | `action,subject,actor,limit,offset` | Control center: administrative events, newest first. `total` is null without filters (counting would read every row); `hasMore` says whether a next page exists |
| GET `/admin/companies` | default: review queue, `limit`. `scope=all`: `query,status,limit,offset` | Queue (flags `duplicateOfVerifiedCompany`) or all companies |
| POST `/admin/review-company` | `{companyId,decision:"approved"\|"rejected",reasonCode,evidenceReference}` | Identity review |
| POST `/admin/company-action` | `{companyId,action:"block_publication"\|"clear_block"\|"grant_rectification",reasonCode,evidenceReference}` | Holds and legal rectification |
| POST `/admin/users/block` | `{userId,blocked,reasonCode,evidenceReference}` | Block and revoke sessions |
| GET `/admin/inventory` | `limit,offset` | Positions with kind and company, live holds |
| POST `/admin/founder-invite` | `{companyId}` | 7-day invitation; queues email |
| GET, POST `/admin/founder-award` | POST `{invitationId,reasonCode,evidenceReference}` | Accepted invitations awaiting award; formal award of the next number in 1-100 · `INVITATION_NOT_ACCEPTED`, `FOUNDER_INVENTORY_EXHAUSTED` |
| POST `/admin/founder-revoke` | `{companyId,reasonCode,evidenceReference}` | Only before first publication |
| GET `/admin/profiles` | `limit` | Profiles pending review, with claims |
| POST `/admin/profiles/review` | `{companyId,version,decision:"cleared"\|"rejected",reasonCode,evidenceReference}` | Exceptional profile decision |
| GET, POST `/admin/requests` | GET `status,limit`. POST 201 `{companyId,legalBasis,reason,channelNote}` | Withdrawal and cancellation queue, legal requests first. POST records a legal request that arrived outside the owner's account (no `reasonCode` needed; `channelNote` is the source) |
| POST `/admin/requests/resolve` | `{requestId,decision:"rejected"\|"completed",reasonCode,evidenceReference}` | Documented decision. `completed` only for cancellations: a withdrawal completes by executing it |
| POST `/admin/requests/legal-deadline` | `{requestId,legalDueAt,reasonCode,evidenceReference}` | Administration sets the applicable term. Passing it with the request open raises a critical incident |
| POST `/admin/withdrawals/execute` | `{companyId,requestId,reasonCode,evidenceReference}` | Definitive and irreversible. Closes every open withdrawal request of that company |
| GET `/admin/onboarding` | `status` (default `admin_review`), `limit` | Cases with final notice and resolution dates, most urgent first |
| POST `/admin/onboarding/final-notice` | `{companyId,reasonCode,evidenceReference}` queues the email. Adding `{channel,recipient}` records a notice given by other means | 7 calendar days from delivery · `INVALID_ACTION` |
| POST `/admin/onboarding/resolve` | `{companyId,decision:"continue"\|"cancel",reasonCode,evidenceReference}` | `continue` grants 15 days from the notice. `cancel` orders a full refund, or revokes a founder · `FINAL_NOTICE_REQUIRED`, `POSITION_ALREADY_CONSUMED` |
| POST `/admin/onboarding/reactivation` | `{companyId,decision:"approved"\|"rejected"\|"notified_by_other_means",reasonCode,evidenceReference}` | Decides a request or a case in review. Returns `{companyId,status,reactivationApprovedAt,reactivationNotifiedAt,reactivationFormDueAt}` |
| GET `/admin/incidents` | `status,limit` | Open incidents |
| POST `/admin/incidents/resolve` | `{incidentId,reasonCode,evidenceReference}` | Close with reason |
| GET `/admin/payments` | `status,limit` | Operations |
| POST `/admin/payments/reconcile` | `{attemptId}` | Compare with Stripe and apply |
| GET, POST `/admin/payments/resolve-late` | GET `attemptId`. POST `{attemptId,decision:"assign"\|"refund",reasonCode,evidenceReference}` | GET returns `LatePaymentFacts`. POST is the documented human decision. `assign` takes only a free number in the same tier and price, or returns `refundRequired:true` |
| POST `/admin/payments/refund` | `{attemptId,reason}` | Position returns only after confirmed refund, and never if published |
| POST `/admin/payments/refund-alternative` | `{attemptId,impossibility,authorizationRef,beneficiaryValidationRef,operationRef,reasonCode}` | Only when the original method is impossible. References only: never send bank or card data |
| POST `/admin/payments/chargeback-resolve` | `{attemptId,decision:"regularized"\|"unpublished"\|"kept",reasonCode,evidenceReference}` | `unpublished` and `kept` only after `regularizationDueAt` · `REGULARIZATION_WINDOW_OPEN` |
| POST `/admin/payments/payer-authorization` | `{attemptId,reasonCode,evidenceReference}` | Documents a payer other than the account holder (`payerReview:"required"`) |
| GET, POST `/admin/premium/requests` | POST `{requestId,status:"in_review"\|"accepted"\|"rejected",reasonCode,evidenceReference}` | Applications from the portal form. Email or meeting notes go in the evidence reference |
| POST `/admin/premium/assign` | `{requestId,reasonCode,evidenceReference}` | Accepted request, tier 4 open, funds evidence |
| GET `/admin/integrations` | | Which mail provider is selected, and whether mail, Stripe (test mode) and AI are configured. Presence and mode only, never a value |
| GET `/admin/integrations/state` | | ADMIN-002. Every provider: adapter availability, settings, credentials by name with last 4 characters and version, last check, source (panel or Worker), AI function models, history. Never a value |
| POST `/admin/integrations/credential` | `provider,name,value,reasonCode,evidenceReference?` | Seals and stores a credential, retiring the previous one. Requires re-authentication in the last 15 minutes. Live Stripe keys refused |
| POST `/admin/integrations/credential-disable` | `provider,name,reasonCode,evidenceReference?` | Disables a credential; a required one switches its provider off. Re-authentication |
| POST `/admin/integrations/enable` | `provider,enabled,reasonCode,evidenceReference?` | Needs an adapter, all required credentials and a passed check of those values. Mercado Pago refuses until PAY-002. Re-authentication |
| POST `/admin/integrations/settings` | `provider,settings,reasonCode,evidenceReference?` | Anthropic `{model}`, Mercado Pago `{country}` (currency follows), mail `{from}`. Re-authentication |
| POST `/admin/integrations/ai-function` | `function,provider,model,reasonCode,evidenceReference?` | Model for `profile_generation` or `assistant`. Re-authentication |
| POST `/admin/integrations/mail-select` | `provider,reasonCode,evidenceReference?` | Only after a test message accepted in the last 24 hours. Re-authentication |
| POST `/admin/integrations/test` | `provider` | Explicit read-only check against Anthropic, Stripe or Mercado Pago; stores the result code |
| POST `/admin/integrations/mail-test` | `provider` | One message to the administrator's own address. Reports "accepted", never "delivered" |
| POST `/admin/reauth/request` | `locale` | Emails a one-time link, valid 15 minutes. At most 3 per 15 minutes |
| POST `/admin/reauth/confirm` | `token` | Confirms the link in the session that sends it; the link's owner must be the signed-in administrator |
| GET, POST `/admin/seller` | POST `{sellerEntityId,legalName,country,reasonCode,evidenceReference}` | Seller is configuration. Does not enable live payments. |

Admin bootstrap is by SQL on verified user IDs only: `docs/CORE004_IMPLEMENTATION.md` §3.

## 8. States

```
Slot:     available → held → assigned ─ first publication (irreversible) → retired on withdrawal
                 ↑______|        |
                 └ expiry/fail   └ refund confirmed, founder revoked: back to available, only if never published
Payment:  creating → pending → paid → refund_pending → refunded
                        ├→ expired / failed                     paid ⇄ disputed → chargeback_lost
                        ├→ late_review → paid | refund_pending  (paid after reservation ended)
                        └→ amount_review → refund_pending       (amount or currency mismatch)
Company:  draft → generated → owner_approved → published → withdrawn
Withdrawal request: requested → completed (executed) | rejected. Both keep who, when, reason and evidence.
Profile:  version created → approved by owner → published. Approved content is immutable.
Onboarding: active → extended (day 15) → suspended (day 30) → admin_review (day 45, if nothing was requested)
          suspended → reactivation_requested (until day 45) → reactivation_approved → reactivated → completed
                                  └→ admin_review (rejected)                             └→ admin_review (form not sent in 15 days)
          completed on form submission. admin_review can return to reactivation_approved only by a new human approval.
```

Final notice on screen: when `finalNoticeSentAt` is set and `finalNoticeResponseAt` is empty, show the reply form and the date `finalNoticeDueAt`. Say that silence alone does not cancel the service or lose the money.

Reactivation on screen: while `reactivation_requested`, say the request is being reviewed and keep the form closed. From `reactivation_approved` the form opens. Once `reactivated`, count down to `reactivationFormDueAt`: 15 calendar days from the notice, no automatic extension. Failing to submit never means losing the position or the money: say it goes to individual review.

## 9. Not available yet

No real Stripe/LLM/email has been exercised. No tax calculation, invoicing or bank transfers. See `CORE006_STATUS.md`.
