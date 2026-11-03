# THE1500 API Contract v0.2 — CORE-001/002/003

**Status:** source implemented, integration and payment flows unfinished. Seller identity pending. The living Google Drive decision register supersedes older archived prompts.

## Common rules
- **Origin:** POST/PUT require an exact same-origin `Origin` header (plus Fetch Metadata check); `GET` is read-only.
- **Authentication:** `__Host-the1500_session` opaque HttpOnly Secure SameSite=Lax cookie; D1 stores only digest, expiration and revocation.
- **Authorization:** `owner` membership required for holds and profile mutations. Owner's corporate email domain matching the website + explicit declaration qualifies ordinary onboarding; mismatches require administrative review before holds.
- **Errors:** `{"error":{"code":"ERROR_CODE"}}`, never raw DB errors or tokens.
- **Idempotency:** `Idempotency-Key` header required on holds, 16–128 ASCII letters/numbers/_/-; repeated active key returns the original hold, expired key cannot reopen a hold.
- **Public data:** never query non-published versions or unapproved content.

## Authentication
| Endpoint | Method | Input | Response |
|---|---|---|---|
| `/api/v1/auth/request-link` | POST | `{email}` | 202 `{status:"link_requested"}` or 503 if mail provider absent |
| `/api/v1/auth/verify` | POST form | `token` | 303 `/mi-cuenta` + cookie |
| `/api/v1/auth/me` | GET | cookie | `{user,companies}` |
| `/api/v1/auth/logout` | POST | cookie | 200 `{status:"signed_out"}` |

## Company + inventory
| Endpoint | Method | Input | Response |
|---|---|---|---|
| `/api/v1/registrations` | POST | `displayName,country,industry,website,declareAuthority:true` | `{id,slug,identityState,checkoutEligible}` |
| `/api/v1/orders/hold` | POST | `{companyId}` + Idempotency-Key | `{hold:{holdId,slotNumber,phase,priceUsdCents,createdAt,expiresAt,status},paymentStatus:"not_started",checkoutEnabled:false}` |
| `/api/v1/public/stats` | GET | — | `{capacity:1500,occupied,held,available,published,sectorsRepresented,currentPhase}` |

## Profile
| Endpoint | Method | Input | Response |
|---|---|---|---|
| `/api/v1/me/company/profile` | PUT | `{companyId,descriptionEn,descriptionEs?,services,audiences,problemSolutions,advantages,serviceCountries}` | `{companyId,version,status:"draft",preview,contentDigest,...}` |
| `/api/v1/me/company/profile?companyId=&version=` | GET | query | `{companyId,version,canonical,preview,previewEs,contentDigest,...}` |
| `/api/v1/me/company/approve` | POST | `{companyId,version,contentDigest,acceptPublicDisclosure:true}` | `{status:"owner_approved",approvedAt}` |
| `/api/v1/me/company/publish` | POST | `{companyId,version}` | `{status:"published",slotNumber,...}`; requires assigned slot |
| `/api/v1/public/companies?page=&country=&query=` | GET | filters | `{items,page,pageSize,total}` (24/page) |
| `/api/v1/public/companies/:slug` | GET | slug | public company metadata, approved version |
| `/api/v1/public/companies/:slug.json` | GET | slug, optional `lang=es` | public Schema.org JSON-LD, HTTP 404 if not published |
| `/empresas/:slug` | GET | slug | HTML profile plus JSON-LD script |

## Explicit non-features in this version
- **No Stripe checkout or payment confirmation.** Hold API never allocates a paid slot and cannot charge.
- **No LLM writer or RAG assistant.** Structured content uses deterministic transformation of owner-declared data; no automatic fact checking.
- **No admin founder awards, R2 archive or D1 staging evidence.**
- **No real email delivery until provider secrets are set.**

## Integration owners
Claude owns server code and API contracts. Antigravity owns UX and forms; it must use the endpoints above without bypassing session, membership or consent checks.


## CORE-004 — Admin/founders and public search (implemented source, no deployment)

See `docs/CORE004_IMPLEMENTATION.md` for new route inventory and auth. Founders are manually invited by admins, accepted by logged-in business owners, and assigned exclusively from slot numbers 1..100. `GET /api/v1/public/search` and `POST /api/v1/public/ask` return only approved/published profiles. `ask.mode="retrieval_only"` means **no generative LLM is enabled yet**; provide honest UI labeling.
