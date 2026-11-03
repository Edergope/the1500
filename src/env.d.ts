/// <reference types="astro/client" />
// Cloudflare runtime bindings (Astro 6: import env from cloudflare:workers).
interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  PUBLIC_BASE_URL?: string;
  PAYMENTS_ENABLED?: string;
}
