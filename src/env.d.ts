/// <reference types="astro/client" />
// Cloudflare runtime bindings. Secrets are set with `wrangler secret put`, never committed.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SNAPSHOTS?: R2Bucket;
    MAIL_PROVIDER?: string;
    EMAIL?: SendEmail;
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
    /** ADMIN-002: 32 random bytes, base64. Seals the credentials kept in D1. Never in D1, never in the repository. */
    SECRETS_MASTER_KEY?: string;
    SECRETS_MASTER_KEY_VERSION?: string;
    MERCADOPAGO_API_BASE?: string;
  }
}
interface Env extends Cloudflare.Env {}
declare namespace App {
  interface Locals {
    /** Set only by the middleware, after checking the session and platform_admins. */
    admin?: {id:string;email:string};
  }
}

