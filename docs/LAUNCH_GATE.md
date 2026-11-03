# THE1500 — Product contract and launch gates

## What is promised (must be testable)
- Exactly 1,500 numbered historical positions; no double sale, no overselling.
- 100 founder positions allocated by invitation inside the first 600; ordinary price bands $100/$400/$1,000/$5,066 USD.
- Final 150 Premium positions require human admission and manual close.
- Authorized company information -> provenance -> semantic draft -> owner approval -> published company HTML and valid public Schema.org JSON-LD with export link.
- Search plus retrieval-augmented chat limited to published authorized records with links; abstain on insufficient evidence.
- 12 months publication guarantee after first actual publication, subject to approved terms; 10 years is aspiration only.
- English primary; complete Spanish second; no claims of guaranteed external AI indexing, recommendation or training.
- Live inventory counters derive from database, no placeholder masquerading as real.

## Status of this Sprint 0 archive
- DONE: repository bootstrap; SQL initial schema and exactly 1500 seeded slots; SQL unit tests; English/Spanish routes with truthful empty states; read-only statistics API and server-rendered counters when D1 binding exists.
- NOT DONE: production auth, atomic holds, checkout, Stripe integration, real registration, owner approvals, profile generation, JSON-LD exports, search, RAG chatbot, admin UI, deployment, legal publication, end-to-end tests.
- BLOCKED BEFORE LIVE PAYMENTS: selected legal seller (LLC vs SAS), Stripe account, D1 Cloudflare resource IDs, published legal terms, privacy authorizations, callback/webhook proofs, security review.

## Launch policy
Never interpret passing the SQL tests as proof the product is ready for payments. Launch commercial payments only after end-to-end security, webhook, 1,500-position concurrency, pricing, publication and legal acceptance are verified.
