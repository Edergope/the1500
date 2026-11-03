/// <reference types="astro/client" />
// Cloudflare runtime bindings. Secrets are set with `wrangler secret put`, never committed.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SNAPSHOTS?: R2Bucket;
    RESEND_API_KEY?: string;
    RESEND_API_BASE?: string;
    MAIL_FROM?: string;
    PUBLIC_BASE_URL?: string;
    PAYMENTS_ENABLED?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    STRIPE_API_BASE?: string;
    AI_PROVIDER?: string;
    AI_API_KEY?: string;
    AI_MODEL?: string;
    AI_BASE_URL?: string;
  }
}
interface Env extends Cloudflare.Env {}

