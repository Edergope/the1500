/** Passwordless identity. Raw tokens exist only in-memory until the email provider accepts them. */
import {loginEmail} from '../lib/i18n/comms';
import {mailConfigured,sendMail,type MailEnv} from './mail';

const MAGIC_LINK_MS = 15 * 60 * 1000;
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = '__Host-the1500_session';
const enc = new TextEncoder();

export interface IdentityEnv extends MailEnv {
  DB: D1Database;
  PUBLIC_BASE_URL?: string;
}

export class IdentityError extends Error {
  constructor(public code: string, public httpStatus = 400) {
    super(code);
    this.name = 'IdentityError';
  }
}

function token(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    throw new IdentityError('INVALID_EMAIL');
  }
  return email;
}
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  const expected = new URL(request.url).origin;
  // Reject cross-site POSTs and originless requests rather than relying on SameSite alone.
  if (origin !== expected || (site && !['same-origin', 'none'].includes(site))) {
    throw new IdentityError('INVALID_ORIGIN', 403);
  }
}
export async function readJsonObject(request: Request, maxBytes=4096): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new IdentityError('EXPECTED_JSON', 415);
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new IdentityError('BODY_TOO_LARGE', 413);
  const payload = await request.text();
  if (enc.encode(payload).length > maxBytes) throw new IdentityError('BODY_TOO_LARGE', 413);
  let parsed: unknown;
  try { parsed=JSON.parse(payload); } catch { throw new IdentityError('INVALID_JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new IdentityError('INVALID_JSON');
  return parsed as Record<string,unknown>;
}
export function json(status: number, body: Record<string,unknown>, headers: Record<string,string>={}) {
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}
export function apiError(e: unknown): Response {
  if (e instanceof IdentityError) return json(e.httpStatus,{error:{code:e.code}});
  // Unknown failures are logged for operators; clients never see internal details.
  console.error('unhandled_api_error',e instanceof Error?e.message:String(e));
  return json(503,{error:{code:'REQUEST_UNAVAILABLE'}});
}
export function parseLocale(value:unknown):'en'|'es' {return value==='es'?'es':'en';}

/** Email requests deliberately have a uniform response, irrespective of membership. */
export async function requestLoginLink(env: IdentityEnv, emailInput: string, ip: string|null, now=new Date(), locale:'en'|'es'='en'): Promise<void> {
  if (!mailConfigured(env) || !env.PUBLIC_BASE_URL) throw new IdentityError('MAIL_NOT_CONFIGURED',503);
  const email=normalizeEmail(emailInput);
  const publicOrigin=new URL(env.PUBLIC_BASE_URL).origin;
  if ((!publicOrigin.startsWith('https://') && !publicOrigin.startsWith('http://localhost')) || new URL(publicOrigin).hostname.endsWith('.invalid')) throw new IdentityError('INVALID_BASE_URL',503);
  const since=new Date(now.getTime()-15*60_000).toISOString();
  const ipDigest=ip?await sha256(ip):null;
  const limits=await env.DB.prepare(`SELECT
    SUM(CASE WHEN email=? THEN 1 ELSE 0 END) AS email_count,
    SUM(CASE WHEN ? IS NOT NULL AND ip_digest=? THEN 1 ELSE 0 END) AS ip_count
    FROM login_challenges WHERE requested_at>=?`).bind(email,ipDigest,ipDigest,since).first<{email_count:number|null;ip_count:number|null}>();
  // Consistent successful response: do not expose which limit blocked the email.
  if ((limits?.email_count??0)>=3 || (limits?.ip_count??0)>=8) return;
  const raw=token(); const digest=await sha256(raw);
  const id=crypto.randomUUID(); const requestedAt=now.toISOString();
  const expiresAt=new Date(now.getTime()+MAGIC_LINK_MS).toISOString();
  await env.DB.prepare(`INSERT INTO login_challenges(id,email,token_digest,ip_digest,requested_at,expires_at,locale)
      VALUES (?,?,?,?,?,?,?)`).bind(id,email,digest,ipDigest,requestedAt,expiresAt,locale).run();
  const url=new URL('/auth/verify',publicOrigin);url.searchParams.set('token',raw);
  const message=loginEmail(locale,url.toString());
  const sent=await sendMail(env,{to:email,...message});
  if (!sent.accepted) {
    // Do not leave a valid unused token if the mail service failed to accept it.
    await env.DB.prepare(`DELETE FROM login_challenges WHERE id=? AND consumed_at IS NULL`).bind(id).run();
    // A refused address (a suppressed one, say) gets the usual reply, so this route cannot be used to probe addresses.
    if (sent.failure==='rejected') {
      await env.DB.prepare(`INSERT OR IGNORE INTO incidents(id,kind,severity,dedupe_key,details_json,created_at) VALUES(?,'login_mail_rejected','warning',?,?,?)`)
        .bind(crypto.randomUUID(),`login_mail_rejected:${email}:${requestedAt.slice(0,10)}`,JSON.stringify({email,provider:sent.provider,code:sent.code}),requestedAt).run();
      return;
    }
    throw new IdentityError('MAIL_DELIVERY_UNAVAILABLE',503);
  }
}

export async function consumeLoginLink(db:D1Database, raw:string, now=new Date()):Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(raw)) throw new IdentityError('INVALID_OR_EXPIRED_LINK',401);
  const digest=await sha256(raw);
  const sid=crypto.randomUUID();const opaque=token();const sessionDigest=await sha256(opaque);
  const at=now.toISOString();const expiresAt=new Date(now.getTime()+SESSION_MS).toISOString();
  // Conditional consumption and user/session creation must be one atomic D1 batch.
  // A replay sees zero UPDATE changes and creates no new session.
  const result=await db.batch([
    db.prepare(`UPDATE login_challenges SET consumed_at=?,session_id=?
      WHERE token_digest=? AND consumed_at IS NULL AND expires_at>?`).bind(at,sid,digest,at),
    db.prepare(`INSERT INTO users(id,email,locale) SELECT ?,email,locale FROM login_challenges
      WHERE session_id=? ON CONFLICT(email) DO NOTHING`).bind(crypto.randomUUID(),sid),
    db.prepare(`INSERT INTO sessions(id,user_id,token_digest,expires_at)
      SELECT ?,u.id,?,? FROM login_challenges c JOIN users u ON u.email=c.email
      WHERE c.session_id=?`).bind(sid,sessionDigest,expiresAt,sid),
    db.prepare(`INSERT INTO auth_audit(id,user_id,kind,occurred_at)
      SELECT ?,u.id,'login_completed',? FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=?`).bind(crypto.randomUUID(),at,sid)
  ]);
  // Guard against a no-op update; if the SQL driver accepts a no-op batch,
  // authentication must still fail for old links.
  if (!result[0]?.meta?.changes) throw new IdentityError('INVALID_OR_EXPIRED_LINK',401);
  return opaque;
}
export function cookieForSession(opaque:string, maxAge=SESSION_MS/1000):string {
  return `${SESSION_COOKIE}=${opaque}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(maxAge)}`;
}
export function cookieForLogout():string {return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;}
export function extractSessionCookie(request:Request):string|null {
  const all=request.headers.get('cookie')||'';
  const match=all.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${SESSION_COOKIE}=`));
  const value=match?.slice(SESSION_COOKIE.length+1)||'';
  return /^[a-f0-9]{64}$/.test(value)?value:null;
}
export interface Principal {id:string;email:string;}
export async function authenticatedPrincipal(db:D1Database,request:Request,now=new Date()):Promise<Principal> {
  const cookie=extractSessionCookie(request);
  if (!cookie) throw new IdentityError('UNAUTHORIZED',401);
  const digest=await sha256(cookie);
  const principal=await db.prepare(`SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_digest=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND u.status='active'`).bind(digest,now.toISOString()).first<Principal>();
  if (!principal) throw new IdentityError('UNAUTHORIZED',401);
  return principal;
}
export async function requireOwner(db:D1Database,userId:string,companyId:string):Promise<void> {
  const found=await db.prepare(`SELECT 1 AS ok FROM memberships m JOIN companies c ON c.id=m.company_id
    WHERE m.user_id=? AND m.company_id=? AND m.role='owner' AND c.identity_state<>'rejected'`)
    .bind(userId,companyId).first<{ok:number}>();
  if (!found) throw new IdentityError('NOT_COMPANY_OWNER',403);
}
/** Owners approve, publish and withdraw; editors may only work on declarations and drafts. */
export async function requireMember(db:D1Database,userId:string,companyId:string):Promise<'owner'|'editor'> {
  const found=await db.prepare(`SELECT m.role FROM memberships m JOIN companies c ON c.id=m.company_id
    WHERE m.user_id=? AND m.company_id=? AND c.identity_state<>'rejected'`)
    .bind(userId,companyId).first<{role:'owner'|'editor'}>();
  if (!found) throw new IdentityError('NOT_COMPANY_MEMBER',403);
  return found.role;
}
export async function revokeAllSessions(db:D1Database,userId:string,now=new Date()):Promise<number> {
  const result=await db.prepare(`UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`)
    .bind(now.toISOString(),userId).run();
  return result.meta.changes;
}
export async function logout(db:D1Database,request:Request,now=new Date()):Promise<void> {
  const raw=extractSessionCookie(request);
  if (raw) {
    const digest=await sha256(raw),at=now.toISOString();
    await db.batch([
      db.prepare(`UPDATE sessions SET revoked_at=? WHERE token_digest=? AND revoked_at IS NULL`)
        .bind(at,digest),
      db.prepare(`INSERT INTO auth_audit(id,user_id,kind,occurred_at)
        SELECT ?,user_id,'logout',? FROM sessions WHERE token_digest=? AND revoked_at=?`)
        .bind(crypto.randomUUID(),at,digest,at)
    ]);
  }
}
