import Anthropic from '@anthropic-ai/sdk';
import {AdminError,adminEvent} from './admin';
import {IdentityError,extractSessionCookie,sha256,type Principal} from './identity';
import {sendMail,type MailEnv} from './mail';
import {credentialAad,masterKeyState,openSecret,sealSecret,SecretsError,type Sealed,type SecretsEnv} from './secrets';
import {paymentsGate,StripeApiError,stripeGet,type StripeEnv} from './stripe';

/**
 * External providers managed from the panel (ADMIN-002, migration 0012).
 * A provider with a row in provider_settings is governed by the panel; one without keeps the Worker configuration,
 * so nothing changes until the administrator acts. Credentials are sealed (secrets.ts), opened only inside the
 * request that uses them, and never returned, logged or written to the audit trail.
 * The core keeps every business decision: providers only report, and positions are still assigned by the core alone.
 */
export type ProviderId='anthropic'|'openai'|'gemini'|'stripe'|'mercadopago'|'cloudflare_email'|'resend';
export type CredentialName='api_key'|'secret_key'|'webhook_secret'|'access_token'|'public_key';
export type AiFunction='profile_generation'|'assistant';
type Kind='ai'|'payments'|'mail';
interface CredentialSpec {name:CredentialName;pattern:RegExp;required:boolean;}
interface CatalogEntry {
  id:ProviderId;kind:Kind;
  /** An adapter that the core can actually call. A provider without one is listed, never shown as working. */
  adapter:boolean;
  /** Whether the panel can hold its credentials today. */
  acceptsCredentials:boolean;
  /** Whether it can be switched on. Mercado Pago cannot until PAY-002 builds checkout and reconciliation. */
  canEnable:boolean;
  environment:'default'|'test';
  credentials:CredentialSpec[];
}
const NO_SPACE=/^\S+$/;
export const CATALOG:Record<ProviderId,CatalogEntry>={
  anthropic:{id:'anthropic',kind:'ai',adapter:true,acceptsCredentials:true,canEnable:true,environment:'default',
    credentials:[{name:'api_key',pattern:/^sk-ant-[A-Za-z0-9_-]{20,}$/,required:true}]},
  openai:{id:'openai',kind:'ai',adapter:false,acceptsCredentials:false,canEnable:false,environment:'default',credentials:[]},
  gemini:{id:'gemini',kind:'ai',adapter:false,acceptsCredentials:false,canEnable:false,environment:'default',credentials:[]},
  stripe:{id:'stripe',kind:'payments',adapter:true,acceptsCredentials:true,canEnable:true,environment:'test',
    credentials:[{name:'secret_key',pattern:/^(sk|rk)_test_[A-Za-z0-9]{10,}$/,required:true},{name:'webhook_secret',pattern:/^whsec_[A-Za-z0-9]{10,}$/,required:true}]},
  mercadopago:{id:'mercadopago',kind:'payments',adapter:false,acceptsCredentials:true,canEnable:false,environment:'test',
    credentials:[{name:'access_token',pattern:/^(TEST|APP_USR)-[A-Za-z0-9-]{20,}$/,required:true},{name:'public_key',pattern:/^(TEST|APP_USR)-[A-Za-z0-9-]{10,}$/,required:true},
      {name:'webhook_secret',pattern:/^[A-Za-z0-9_-]{16,256}$/,required:false}]},
  cloudflare_email:{id:'cloudflare_email',kind:'mail',adapter:true,acceptsCredentials:false,canEnable:false,environment:'default',credentials:[]},
  resend:{id:'resend',kind:'mail',adapter:true,acceptsCredentials:true,canEnable:false,environment:'default',
    credentials:[{name:'api_key',pattern:/^re_[A-Za-z0-9_]{10,}$/,required:true}]},
};
export const PROVIDERS=Object.keys(CATALOG) as ProviderId[];
/** Models the Anthropic adapter is written for (structured JSON output). The connection check confirms the key can use the chosen one. */
export const ANTHROPIC_MODELS=['claude-opus-5-5','claude-sonnet-5-5'] as const;
export const AI_FUNCTIONS:AiFunction[]=['profile_generation','assistant'];
/** One Mercado Pago account per country, in its own currency (ADMIN_CONTROL_CENTER_PLAN.md, section 7). */
export const MERCADOPAGO_COUNTRIES:Record<string,{currency:string;siteId:string}>={
  CO:{currency:'COP',siteId:'MCO'},MX:{currency:'MXN',siteId:'MLM'},AR:{currency:'ARS',siteId:'MLA'},BR:{currency:'BRL',siteId:'MLB'},
  CL:{currency:'CLP',siteId:'MLC'},PE:{currency:'PEN',siteId:'MPE'},UY:{currency:'UYU',siteId:'MLU'},
};
/** What THE1500 needs Stripe to send, from the cases handled in payments.ts. */
export const STRIPE_WEBHOOK_EVENTS=['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired',
  'checkout.session.async_payment_failed','charge.refunded','charge.dispute.created','charge.dispute.closed'];
export const STRIPE_WEBHOOK_PATH='/api/v1/webhooks/stripe';
export const REAUTH_MS=15*60_000;
const MAIL_TEST_VALID_MS=24*60*60_000;

export interface IntegrationsEnv extends SecretsEnv,MailEnv,StripeEnv {
  DB:D1Database;AI_PROVIDER?:string;AI_API_KEY?:string;AI_MODEL?:string;AI_BASE_URL?:string;MERCADOPAGO_API_BASE?:string;
}
interface SettingsRow {provider:ProviderId;enabled:number;settings:Record<string,string>;lastCheckAt:string|null;lastCheckOk:number|null;lastCheckCode:string|null;lastCheckDetail:string|null;updatedAt:string;}
interface CredentialRow extends Sealed {provider:ProviderId;environment:string;name:CredentialName;version:number;last4:string;createdAt:string;}
interface State {settings:Map<ProviderId,SettingsRow>;credentials:CredentialRow[];functions:Map<AiFunction,{provider:ProviderId;model:string}>;mail:ProviderId|null;}

const missingSchema=(e:unknown)=>/no such (table|column)/i.test(e instanceof Error?e.message:String(e));
async function loadState(db:D1Database):Promise<State|null> {
  try {
    const [s,c,f,m]=await db.batch([
      db.prepare(`SELECT provider,enabled,settings_json,last_check_at,last_check_ok,last_check_code,last_check_detail,updated_at FROM provider_settings`),
      db.prepare(`SELECT provider,environment,name,version,ciphertext,iv,wrapped_key,wrap_iv,master_key_version,last4,created_at FROM provider_credentials WHERE status='active'`),
      db.prepare(`SELECT function,provider,model FROM ai_function_config`),
      db.prepare(`SELECT provider FROM integration_choices WHERE kind='mail'`),
    ]);
    type R=Record<string,unknown>;
    return {
      settings:new Map((s!.results as R[]).map(r=>[r.provider as ProviderId,{provider:r.provider as ProviderId,enabled:r.enabled as number,settings:JSON.parse(r.settings_json as string),
        lastCheckAt:r.last_check_at as string|null,lastCheckOk:r.last_check_ok as number|null,lastCheckCode:r.last_check_code as string|null,lastCheckDetail:r.last_check_detail as string|null,updatedAt:r.updated_at as string}])),
      credentials:(c!.results as R[]).map(r=>({provider:r.provider as ProviderId,environment:r.environment as string,name:r.name as CredentialName,version:r.version as number,
        ciphertext:r.ciphertext as string,iv:r.iv as string,wrappedKey:r.wrapped_key as string,wrapIv:r.wrap_iv as string,masterKeyVersion:r.master_key_version as number,last4:r.last4 as string,createdAt:r.created_at as string})),
      functions:new Map((f!.results as R[]).map(r=>[r.function as AiFunction,{provider:r.provider as ProviderId,model:r.model as string}])),
      mail:((m!.results as R[])[0]?.provider as ProviderId|undefined)??null,
    };
  } catch (e) {
    // Before migration 0012 the Worker configuration simply stays in charge.
    if (missingSchema(e)) return null;
    throw e;
  }
}
/** Only the sealed state is cached, briefly, so public pages do not read these tables on every request. Values are opened per use. */
let cached:{at:number;state:State|null}|null=null;
const CACHE_MS=30_000;
export function forgetIntegrationsCache() {cached=null;}
async function currentState(db:D1Database):Promise<State|null> {
  if (cached&&Date.now()-cached.at<CACHE_MS) return cached.state;
  const state=await loadState(db);cached={at:Date.now(),state};return state;
}
async function reveal(env:SecretsEnv,state:State,provider:ProviderId,name:CredentialName):Promise<string|undefined> {
  const row=state.credentials.find(c=>c.provider===provider&&c.name===name);
  if (!row) return undefined;
  try {return await openSecret(env,credentialAad(provider,row.environment,name,row.version),row);}
  catch (e) {
    // Names only: the value, sealed or not, never goes to a log.
    console.error('integration_credential_unreadable',provider,name,e instanceof SecretsError?e.code:'error');
    return undefined;
  }
}
const mailBindingName=(p:ProviderId)=>p==='cloudflare_email'?'cloudflare':'resend';

export interface RuntimeUses {ai?:AiFunction;mail?:boolean;stripe?:boolean;}
/**
 * The configuration a request runs with: the Worker's, with whatever the panel governs laid over it.
 * Ask only for what the request uses, so no other credential is opened.
 */
export async function runtimeEnv<E extends IntegrationsEnv>(env:E,uses:RuntimeUses):Promise<E> {
  let state:State|null;
  try {state=await currentState(env.DB);}
  catch (e) {console.error('integrations_state_unavailable',e instanceof Error?e.message:String(e));return env;}
  if (!state) return env;
  const out:E={...env};
  if (uses.ai) {
    const fn=state.functions.get(uses.ai);
    const provider=fn?.provider??(state.settings.has('anthropic')?'anthropic':null);
    const s=provider?state.settings.get(provider):undefined;
    if (provider&&s) {
      out.AI_PROVIDER=provider;
      out.AI_MODEL=fn?.model??s.settings.model??env.AI_MODEL;
      out.AI_API_KEY=s.enabled&&CATALOG[provider].adapter?await reveal(env,state,provider,'api_key'):undefined;
    }
  }
  if (uses.mail&&state.mail) {
    out.MAIL_PROVIDER=mailBindingName(state.mail);
    out.MAIL_FROM=state.settings.get(state.mail)?.settings.from??env.MAIL_FROM;
    if (state.mail==='resend') out.RESEND_API_KEY=await reveal(env,state,'resend','api_key');
  }
  if (uses.stripe) {
    const s=state.settings.get('stripe');
    if (s) {
      out.STRIPE_SECRET_KEY=await reveal(env,state,'stripe','secret_key');
      out.STRIPE_WEBHOOK_SECRET=await reveal(env,state,'stripe','webhook_secret');
      out.PAYMENTS_ENABLED=s.enabled?'true':'false';
    }
  }
  return out;
}

// ---------- Re-authentication ----------
interface SessionFacts {id:string;userId:string;reauthenticatedAt:string|null;}
export async function sessionFacts(db:D1Database,request:Request):Promise<SessionFacts> {
  const cookie=extractSessionCookie(request);
  if (!cookie) throw new IdentityError('UNAUTHORIZED',401);
  let row:SessionFacts|null;
  try {
    row=await db.prepare(`SELECT id,user_id AS userId,reauthenticated_at AS reauthenticatedAt FROM sessions WHERE token_digest=? AND revoked_at IS NULL`)
      .bind(await sha256(cookie)).first<SessionFacts>();
  } catch (e) {if (missingSchema(e)) throw new AdminError('INTEGRATIONS_NOT_MIGRATED',503);throw e;}
  if (!row) throw new IdentityError('UNAUTHORIZED',401);
  return row;
}
export const reauthFresh=(at:string|null,now=new Date())=>!!at&&now.getTime()-Date.parse(at)<REAUTH_MS;
export async function requireRecentReauth(db:D1Database,request:Request,now=new Date()):Promise<SessionFacts> {
  const session=await sessionFacts(db,request);
  if (!reauthFresh(session.reauthenticatedAt,now)) throw new AdminError('REAUTH_REQUIRED',403);
  return session;
}
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
/** A one-time link to the administrator's own mailbox, valid for 15 minutes. Opening it confirms the session that opens it. */
export async function requestReauth(env:IntegrationsEnv,user:Principal,locale:'en'|'es',now=new Date()):Promise<{sentTo:string;expiresAt:string}> {
  if (!env.PUBLIC_BASE_URL) throw new AdminError('MAIL_NOT_CONFIGURED',503);
  const db=env.DB,at=now.toISOString();
  const recent=await db.prepare(`SELECT COUNT(*) AS n FROM reauth_challenges WHERE user_id=? AND requested_at>?`).bind(user.id,new Date(now.getTime()-REAUTH_MS).toISOString()).first<{n:number}>()
    .catch(e=>{if (missingSchema(e)) throw new AdminError('INTEGRATIONS_NOT_MIGRATED',503);throw e;});
  if ((recent?.n??0)>=3) throw new AdminError('TOO_MANY_REQUESTS',429);
  const raw=randomToken(),id=crypto.randomUUID(),expiresAt=new Date(now.getTime()+REAUTH_MS).toISOString();
  await db.prepare(`INSERT INTO reauth_challenges(id,user_id,token_digest,requested_at,expires_at) VALUES(?,?,?,?,?)`).bind(id,user.id,await sha256(raw),at,expiresAt).run();
  const url=new URL(`${locale==='es'?'/es':''}/admin/reautenticar`,new URL(env.PUBLIC_BASE_URL).origin);url.searchParams.set('token',raw);
  const subject=locale==='es'?'THE1500: confirma que eres tú':'THE1500: confirm it is you';
  const text=locale==='es'
    ?`Alguien con tu sesión pidió confirmar tu identidad para hacer cambios críticos en THE1500.\n\nSi fuiste tú, abre este enlace en el mismo navegador antes de 15 minutos:\n${url}\n\nSi no fuiste tú, no lo abras y cierra tus sesiones desde Mi cuenta.`
    :`Someone using your session asked to confirm your identity for critical changes in THE1500.\n\nIf it was you, open this link in the same browser within 15 minutes:\n${url}\n\nIf it was not you, do not open it and sign out of your sessions from My account.`;
  const sent=await sendMail(env,{to:user.email,subject,text});
  if (!sent.accepted) {
    await db.prepare(`DELETE FROM reauth_challenges WHERE id=? AND consumed_at IS NULL`).bind(id).run();
    throw new AdminError(sent.code==='MAIL_NOT_CONFIGURED'?'MAIL_NOT_CONFIGURED':'MAIL_DELIVERY_UNAVAILABLE',503);
  }
  return {sentTo:user.email,expiresAt};
}
export async function confirmReauth(db:D1Database,request:Request,user:Principal,raw:unknown,now=new Date()):Promise<{reauthenticatedUntil:string}> {
  if (typeof raw!=='string'||!/^[0-9a-f]{64}$/.test(raw)) throw new AdminError('INVALID_OR_EXPIRED_LINK',401);
  const session=await sessionFacts(db,request);
  if (session.userId!==user.id) throw new IdentityError('UNAUTHORIZED',401);
  const digest=await sha256(raw),at=now.toISOString();
  const result=await db.batch([
    db.prepare(`UPDATE reauth_challenges SET consumed_at=?,session_id=? WHERE token_digest=? AND user_id=? AND consumed_at IS NULL AND expires_at>?`).bind(at,session.id,digest,user.id,at),
    db.prepare(`UPDATE sessions SET reauthenticated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM reauth_challenges WHERE token_digest=? AND session_id=? AND consumed_at=?)`).bind(at,session.id,digest,session.id,at),
    db.prepare(`INSERT INTO admin_events(id,admin_id,action,subject_type,subject_id,details_json,occurred_at)
      SELECT ?,?,'admin_reauthenticated','integration','reauth','{}',? WHERE EXISTS(SELECT 1 FROM reauth_challenges WHERE token_digest=? AND session_id=? AND consumed_at=?)`)
      .bind(crypto.randomUUID(),user.id,at,digest,session.id,at),
  ]);
  if (!result[0]?.meta?.changes) throw new AdminError('INVALID_OR_EXPIRED_LINK',401);
  return {reauthenticatedUntil:new Date(now.getTime()+REAUTH_MS).toISOString()};
}

// ---------- The panel's view ----------
const parseDetail=(text:string|null)=>{if (!text) return null;try {return JSON.parse(text) as Record<string,unknown>;} catch {return null;}};
export async function getIntegrationsView(env:IntegrationsEnv,request:Request|null,now=new Date()) {
  const state=await loadState(env.DB);
  const masterKey=masterKeyState(env);
  let reauth={fresh:false,until:null as string|null};
  if (state&&request) {
    const session=await sessionFacts(env.DB,request).catch(()=>null);
    if (session&&reauthFresh(session.reauthenticatedAt,now)) reauth={fresh:true,until:new Date(Date.parse(session.reauthenticatedAt!)+REAUTH_MS).toISOString()};
  }
  const workerHas:Partial<Record<ProviderId,boolean>>={
    anthropic:env.AI_PROVIDER==='anthropic'&&!!env.AI_API_KEY,stripe:!!env.STRIPE_SECRET_KEY,resend:!!env.RESEND_API_KEY,cloudflare_email:!!env.EMAIL,
  };
  const providers=PROVIDERS.map(id=>{
    const entry=CATALOG[id],s=state?.settings.get(id);
    const credentials=entry.credentials.map(spec=>{
      const row=state?.credentials.find(c=>c.provider===id&&c.name===spec.name);
      return {name:spec.name,required:spec.required,present:!!row,last4:row?.last4??null,version:row?.version??null,createdAt:row?.createdAt??null};
    });
    return {id,kind:entry.kind,adapter:entry.adapter,acceptsCredentials:entry.acceptsCredentials,canEnable:entry.canEnable,environment:entry.environment,
      managed:!!s,enabled:!!s?.enabled,settings:s?.settings??{},credentials,complete:credentials.every(c=>!c.required||c.present),
      lastCheck:s?.lastCheckAt?{at:s.lastCheckAt,ok:s.lastCheckOk===1,code:s.lastCheckCode,detail:parseDetail(s.lastCheckDetail)}:null,
      source:s?'panel':workerHas[id]?'worker':'none'};
  });
  const ai=AI_FUNCTIONS.map(fn=>{
    const row=state?.functions.get(fn);
    return {function:fn,provider:row?.provider??(state?.settings.has('anthropic')?'anthropic':env.AI_PROVIDER??null),model:row?.model??state?.settings.get('anthropic')?.settings.model??env.AI_MODEL??null,
      source:row?'panel':state?.settings.has('anthropic')?'panel_default':'worker'};
  });
  const history=state?(await env.DB.prepare(`SELECT e.action,e.subject_id AS subject,e.reason_code AS reasonCode,e.evidence_reference AS evidence,e.details_json AS details,e.occurred_at AS at,u.email AS actor
    FROM admin_events e LEFT JOIN users u ON u.id=e.admin_id WHERE e.subject_type='integration' ORDER BY e.occurred_at DESC LIMIT 30`).all<{details:string}>())
    .results.map(r=>({...r,details:parseDetail(r.details)})):[];
  const stripeGate=paymentsGate(await runtimeEnv(env,{stripe:true}));
  return {migration:state?'applied':'pending',masterKey,reauth,providers,ai,models:[...ANTHROPIC_MODELS],
    mail:{selected:state?.mail??null,workerProvider:env.MAIL_PROVIDER||'cloudflare',workerFrom:env.MAIL_FROM??null,bindingPresent:!!env.EMAIL},
    stripe:{gate:stripeGate.ok?'open_test_mode':stripeGate.code,webhookUrl:env.PUBLIC_BASE_URL?`${new URL(env.PUBLIC_BASE_URL).origin}${STRIPE_WEBHOOK_PATH}`:null,events:STRIPE_WEBHOOK_EVENTS},
    mercadopago:{countries:MERCADOPAGO_COUNTRIES},history};
}

// ---------- Changes ----------
/** The panel's dialog sends `evidenceReference`, as every other administrative action does. */
export interface Change {reasonCode?:unknown;evidence?:unknown;evidenceReference?:unknown;}
function reason(change:Change):{reasonCode:string;evidence:string|null} {
  if (typeof change.reasonCode!=='string'||!/^[a-zA-Z0-9_-]{3,64}$/.test(change.reasonCode)) throw new AdminError('REVIEW_EVIDENCE_REQUIRED',400);
  const given=change.evidence??change.evidenceReference;
  if (given!==undefined&&given!==null&&(typeof given!=='string'||given.length>400)) throw new AdminError('REVIEW_EVIDENCE_REQUIRED',400);
  const evidence=typeof given==='string'&&given.trim()?given.trim():null;
  return {reasonCode:change.reasonCode,evidence};
}
function provider(id:unknown):CatalogEntry {
  if (typeof id!=='string'||!(id in CATALOG)) throw new AdminError('UNKNOWN_PROVIDER',400);
  return CATALOG[id as ProviderId];
}
async function requireState(db:D1Database):Promise<State> {
  const state=await loadState(db);
  if (!state) throw new AdminError('INTEGRATIONS_NOT_MIGRATED',503);
  return state;
}
const ensureSettings=(db:D1Database,id:ProviderId,adminId:string,at:string)=>db.prepare(`INSERT INTO provider_settings(provider,enabled,settings_json,updated_at,updated_by) VALUES(?,0,'{}',?,?) ON CONFLICT(provider) DO NOTHING`).bind(id,at,adminId);
const done=<T>(value:T)=>{forgetIntegrationsCache();return value;};

/** Registers or replaces one credential. The value is sealed before it touches D1 and is never returned. */
export async function saveCredential(env:IntegrationsEnv,adminId:string,input:{provider?:unknown;name?:unknown;value?:unknown}&Change,now=new Date()) {
  const entry=provider(input.provider);const why=reason(input);
  if (!entry.acceptsCredentials) throw new AdminError('ADAPTER_NOT_AVAILABLE',409);
  const spec=entry.credentials.find(c=>c.name===input.name);
  if (!spec) throw new AdminError('UNKNOWN_CREDENTIAL',400);
  const value=typeof input.value==='string'?input.value.trim():'';
  if (entry.id==='stripe'&&/_live_/.test(value)) throw new AdminError('LIVE_KEY_REFUSED',400);
  if (!value||value.length>400||!NO_SPACE.test(value)||!spec.pattern.test(value)) throw new AdminError('CREDENTIAL_FORMAT_INVALID',400);
  // The reason goes to the audit trail, which is permanent: it must not carry the value.
  if (why.evidence?.includes(value)||why.evidence?.includes(value.slice(-12))) throw new AdminError('SECRET_IN_EVIDENCE',400);
  if (masterKeyState(env)!=='ready') throw new AdminError('MASTER_KEY_MISSING',503);
  const db=env.DB;await requireState(db);
  const at=now.toISOString();
  const last=await db.prepare(`SELECT MAX(version) AS v FROM provider_credentials WHERE provider=? AND environment=? AND name=?`).bind(entry.id,entry.environment,spec.name).first<{v:number|null}>();
  const version=(last?.v??0)+1;
  const sealed=await sealSecret(env,credentialAad(entry.id,entry.environment,spec.name,version),value);
  const results=await db.batch([
    db.prepare(`UPDATE provider_credentials SET status='replaced',retired_at=?,retired_by=? WHERE provider=? AND environment=? AND name=? AND status='active'`).bind(at,adminId,entry.id,entry.environment,spec.name),
    db.prepare(`INSERT INTO provider_credentials(id,provider,environment,name,version,ciphertext,iv,wrapped_key,wrap_iv,master_key_version,last4,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(),entry.id,entry.environment,spec.name,version,sealed.ciphertext,sealed.iv,sealed.wrappedKey,sealed.wrapIv,sealed.masterKeyVersion,value.slice(-4),at,adminId),
    ensureSettings(db,entry.id,adminId,at),
    // A new value has not been checked yet.
    db.prepare(`UPDATE provider_settings SET last_check_at=NULL,last_check_ok=NULL,last_check_code=NULL,last_check_detail=NULL,updated_at=?,updated_by=? WHERE provider=?`).bind(at,adminId,entry.id),
    adminEvent(db,adminId,'integration_credential_saved','integration',entry.id,why.reasonCode,why.evidence,{credential:spec.name,version},now),
  ]);
  return done({provider:entry.id,credential:spec.name,version,last4:value.slice(-4),replaced:!!results[0]?.meta?.changes});
}
export async function disableCredential(env:IntegrationsEnv,adminId:string,input:{provider?:unknown;name?:unknown}&Change,now=new Date()) {
  const entry=provider(input.provider);const why=reason(input);
  const spec=entry.credentials.find(c=>c.name===input.name);
  if (!spec) throw new AdminError('UNKNOWN_CREDENTIAL',400);
  const db=env.DB;await requireState(db);const at=now.toISOString();
  const results=await db.batch([
    db.prepare(`UPDATE provider_credentials SET status='disabled',retired_at=?,retired_by=? WHERE provider=? AND environment=? AND name=? AND status='active'`).bind(at,adminId,entry.id,entry.environment,spec.name),
    // A provider cannot stay on without a value it needs.
    db.prepare(`UPDATE provider_settings SET enabled=CASE WHEN ? THEN 0 ELSE enabled END,last_check_at=NULL,last_check_ok=NULL,last_check_code=NULL,last_check_detail=NULL,updated_at=?,updated_by=? WHERE provider=?`).bind(spec.required?1:0,at,adminId,entry.id),
    adminEvent(db,adminId,'integration_credential_disabled','integration',entry.id,why.reasonCode,why.evidence,{credential:spec.name},now),
  ]);
  if (!results[0]?.meta?.changes) throw new AdminError('CREDENTIAL_NOT_FOUND',404);
  return done({provider:entry.id,credential:spec.name,status:'disabled'});
}
/** Switching a provider on needs its adapter, every required credential and a passed check of those same values. */
export async function setProviderEnabled(env:IntegrationsEnv,adminId:string,input:{provider?:unknown;enabled?:unknown}&Change,now=new Date()) {
  const entry=provider(input.provider);const why=reason(input);
  if (typeof input.enabled!=='boolean') throw new AdminError('INVALID_ACTION',400);
  if (entry.kind==='mail') throw new AdminError('USE_MAIL_SELECTION',409);
  const db=env.DB;const state=await requireState(db);const at=now.toISOString();
  if (input.enabled) {
    if (!entry.adapter||!entry.canEnable) throw new AdminError('ADAPTER_NOT_AVAILABLE',409);
    const s=state.settings.get(entry.id);
    const creds=state.credentials.filter(c=>c.provider===entry.id);
    if (!entry.credentials.every(spec=>!spec.required||creds.some(c=>c.name===spec.name))) throw new AdminError('CREDENTIALS_INCOMPLETE',409);
    if (!s?.lastCheckOk||!s.lastCheckAt||creds.some(c=>c.createdAt>s.lastCheckAt!)) throw new AdminError('CONNECTION_NOT_VERIFIED',409);
    if (entry.id==='anthropic'&&!ANTHROPIC_MODELS.includes(s.settings.model as typeof ANTHROPIC_MODELS[number])) throw new AdminError('MODEL_NOT_SELECTED',409);
  }
  await db.batch([
    ensureSettings(db,entry.id,adminId,at),
    db.prepare(`UPDATE provider_settings SET enabled=?,updated_at=?,updated_by=? WHERE provider=?`).bind(input.enabled?1:0,at,adminId,entry.id),
    adminEvent(db,adminId,input.enabled?'integration_enabled':'integration_disabled','integration',entry.id,why.reasonCode,why.evidence,{},now),
  ]);
  return done({provider:entry.id,enabled:input.enabled});
}
const SENDER=/^\s*(?:"?[^"<>]{1,80}"?\s*<[^<>\s@]+@[^<>\s@]+\.[a-z]{2,}>|[^<>\s@]+@[^<>\s@]+\.[a-z]{2,})\s*$/i;
/** Plain settings, validated per provider. Nothing here is secret. */
export async function saveProviderSettings(env:IntegrationsEnv,adminId:string,input:{provider?:unknown;settings?:unknown}&Change,now=new Date()) {
  const entry=provider(input.provider);const why=reason(input);
  const given=input.settings&&typeof input.settings==='object'&&!Array.isArray(input.settings)?input.settings as Record<string,unknown>:null;
  if (!given) throw new AdminError('INVALID_SETTINGS',400);
  let settings:Record<string,string>;
  if (entry.id==='anthropic') {
    if (!ANTHROPIC_MODELS.includes(given.model as typeof ANTHROPIC_MODELS[number])) throw new AdminError('MODEL_NOT_SUPPORTED',400);
    settings={model:given.model as string};
  } else if (entry.id==='mercadopago') {
    const country=typeof given.country==='string'?given.country.toUpperCase():'';
    if (!MERCADOPAGO_COUNTRIES[country]) throw new AdminError('COUNTRY_NOT_SUPPORTED',400);
    // The currency follows the country; it is not a separate choice.
    settings={country,currency:MERCADOPAGO_COUNTRIES[country]!.currency};
  } else if (entry.kind==='mail') {
    if (typeof given.from!=='string'||given.from.length>160||!SENDER.test(given.from)) throw new AdminError('INVALID_SENDER',400);
    settings={from:given.from.trim()};
  } else throw new AdminError('INVALID_SETTINGS',400);
  const db=env.DB;const state=await requireState(db);const at=now.toISOString();
  const previous=state.settings.get(entry.id)?.settings??{};
  // A different country means the account was checked against another one.
  const recheck=entry.id==='mercadopago'&&previous.country!==settings.country;
  await db.batch([
    ensureSettings(db,entry.id,adminId,at),
    db.prepare(`UPDATE provider_settings SET settings_json=?,updated_at=?,updated_by=?${recheck?',last_check_at=NULL,last_check_ok=NULL,last_check_code=NULL,last_check_detail=NULL':''} WHERE provider=?`).bind(JSON.stringify(settings),at,adminId,entry.id),
    adminEvent(db,adminId,'integration_settings_saved','integration',entry.id,why.reasonCode,why.evidence,{before:previous,after:settings},now),
  ]);
  return done({provider:entry.id,settings});
}
export async function setAiFunction(env:IntegrationsEnv,adminId:string,input:{function?:unknown;provider?:unknown;model?:unknown}&Change,now=new Date()) {
  if (!AI_FUNCTIONS.includes(input.function as AiFunction)) throw new AdminError('UNKNOWN_FUNCTION',400);
  const entry=provider(input.provider);const why=reason(input);
  if (entry.kind!=='ai') throw new AdminError('UNKNOWN_PROVIDER',400);
  if (!entry.adapter) throw new AdminError('ADAPTER_NOT_AVAILABLE',409);
  if (!ANTHROPIC_MODELS.includes(input.model as typeof ANTHROPIC_MODELS[number])) throw new AdminError('MODEL_NOT_SUPPORTED',400);
  const db=env.DB;const state=await requireState(db);const at=now.toISOString();
  const previous=state.functions.get(input.function as AiFunction)??null;
  await db.batch([
    db.prepare(`INSERT INTO ai_function_config(function,provider,model,updated_at,updated_by) VALUES(?,?,?,?,?)
      ON CONFLICT(function) DO UPDATE SET provider=excluded.provider,model=excluded.model,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(input.function,entry.id,input.model,at,adminId),
    adminEvent(db,adminId,'integration_ai_function_saved','integration',entry.id,why.reasonCode,why.evidence,{function:input.function,before:previous,after:{provider:entry.id,model:input.model}},now),
  ]);
  return done({function:input.function,provider:entry.id,model:input.model});
}
/** The login link travels by this provider, so it is chosen only after a test message it accepted in the last day. */
export async function selectMailProvider(env:IntegrationsEnv,adminId:string,input:{provider?:unknown}&Change,now=new Date()) {
  const entry=provider(input.provider);const why=reason(input);
  if (entry.kind!=='mail') throw new AdminError('UNKNOWN_PROVIDER',400);
  const db=env.DB;const state=await requireState(db);const at=now.toISOString();
  const s=state.settings.get(entry.id);
  if (!s?.lastCheckOk||!s.lastCheckAt||now.getTime()-Date.parse(s.lastCheckAt)>MAIL_TEST_VALID_MS) throw new AdminError('MAIL_TEST_REQUIRED',409);
  if (state.credentials.some(c=>c.provider===entry.id&&c.createdAt>s.lastCheckAt!)) throw new AdminError('MAIL_TEST_REQUIRED',409);
  await db.batch([
    db.prepare(`INSERT INTO integration_choices(kind,provider,updated_at,updated_by) VALUES('mail',?,?,?)
      ON CONFLICT(kind) DO UPDATE SET provider=excluded.provider,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(entry.id,at,adminId),
    adminEvent(db,adminId,'integration_mail_selected','integration',entry.id,why.reasonCode,why.evidence,{before:state.mail},now),
  ]);
  return done({mail:entry.id});
}

// ---------- Explicit checks ----------
interface Check {ok:boolean;code:string;detail:Record<string,unknown>;}
async function recordCheck(db:D1Database,adminId:string,id:ProviderId,check:Check,now:Date,action:string) {
  const at=now.toISOString();
  await db.batch([
    ensureSettings(db,id,adminId,at),
    db.prepare(`UPDATE provider_settings SET last_check_at=?,last_check_ok=?,last_check_code=?,last_check_detail=? WHERE provider=?`).bind(at,check.ok?1:0,check.code,JSON.stringify(check.detail),id),
    adminEvent(db,adminId,action,'integration',id,null,null,{ok:check.ok,code:check.code},now),
  ]);
  forgetIntegrationsCache();
  return {provider:id,checkedAt:at,...check};
}
const httpCode=(status:number)=>status?`HTTP_${status}`:'NETWORK';
async function checkAnthropic(env:IntegrationsEnv,key:string,model:string):Promise<Check> {
  // authToken:null keeps any ambient credential out: the check proves this key and no other.
  const client=new Anthropic({apiKey:key,authToken:null,timeout:15_000,maxRetries:0,...(env.AI_BASE_URL?{baseURL:env.AI_BASE_URL}:{})});
  try {
    const found=await client.models.retrieve(model);
    return {ok:true,code:'OK',detail:{model:found.id}};
  } catch (e) {
    // Only the status: a provider's message is not shown or stored.
    return {ok:false,code:httpCode(e instanceof Anthropic.APIError?e.status??0:0),detail:{model}};
  }
}
async function checkStripe(env:IntegrationsEnv,key:string):Promise<Check> {
  const stripe={...env,STRIPE_SECRET_KEY:key};
  try {
    const balance=await stripeGet<{livemode?:boolean}>(stripe,'/v1/balance');
    if (balance.livemode!==false) return {ok:false,code:'LIVE_MODE',detail:{}};
    const endpoints=await stripeGet<{data?:{url:string;status:string;enabled_events:string[]}[]}>(stripe,'/v1/webhook_endpoints?limit=100');
    const expected=env.PUBLIC_BASE_URL?`${new URL(env.PUBLIC_BASE_URL).origin}${STRIPE_WEBHOOK_PATH}`:null;
    const endpoint=expected?endpoints.data?.find(e=>e.url===expected):undefined;
    if (!endpoint) return {ok:false,code:'WEBHOOK_MISSING',detail:{key:'ok',expected}};
    if (endpoint.status!=='enabled') return {ok:false,code:'WEBHOOK_DISABLED',detail:{key:'ok',expected}};
    const missing=endpoint.enabled_events.includes('*')?[]:STRIPE_WEBHOOK_EVENTS.filter(e=>!endpoint.enabled_events.includes(e));
    if (missing.length) return {ok:false,code:'WEBHOOK_EVENTS_MISSING',detail:{key:'ok',expected,missing}};
    // Stripe does not return an existing endpoint's signing secret, so whether it matches is proven by the first signed event.
    return {ok:true,code:'OK',detail:{key:'ok',webhook:'ok',expected,secretMatch:'unverifiable'}};
  } catch (e) {
    return {ok:false,code:httpCode(e instanceof StripeApiError?e.status:0),detail:{}};
  }
}
async function checkMercadoPago(env:IntegrationsEnv,token:string,country:string|undefined):Promise<Check> {
  try {
    const response=await fetch(`${env.MERCADOPAGO_API_BASE||'https://api.mercadopago.com'}/users/me`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15_000)});
    if (!response.ok) return {ok:false,code:httpCode(response.status),detail:{}};
    const me=await response.json().catch(()=>({})) as {site_id?:string};
    const expected=country?MERCADOPAGO_COUNTRIES[country]?.siteId:undefined;
    if (!expected) return {ok:false,code:'COUNTRY_NOT_SELECTED',detail:{siteId:me.site_id??null}};
    if (me.site_id!==expected) return {ok:false,code:'COUNTRY_MISMATCH',detail:{siteId:me.site_id??null,expected}};
    return {ok:true,code:'OK',detail:{siteId:me.site_id,transactional:'pending_pay_002'}};
  } catch {return {ok:false,code:'NETWORK',detail:{}};}
}
/** One explicit check against the provider. It never charges, sends or changes anything there. */
export async function testConnection(env:IntegrationsEnv,adminId:string,input:{provider?:unknown},now=new Date()) {
  const entry=provider(input.provider);
  if (entry.kind==='mail') throw new AdminError('USE_MAIL_TEST',409);
  if (!entry.acceptsCredentials) throw new AdminError('ADAPTER_NOT_AVAILABLE',409);
  if (masterKeyState(env)!=='ready') throw new AdminError('MASTER_KEY_MISSING',503);
  const db=env.DB;const state=await requireState(db);
  const key=await reveal(env,state,entry.id,entry.id==='mercadopago'?'access_token':entry.id==='stripe'?'secret_key':'api_key');
  if (!key) throw new AdminError('CREDENTIALS_INCOMPLETE',409);
  const s=state.settings.get(entry.id)?.settings??{};
  let check:Check;
  if (entry.id==='anthropic') {
    if (!ANTHROPIC_MODELS.includes(s.model as typeof ANTHROPIC_MODELS[number])) throw new AdminError('MODEL_NOT_SELECTED',409);
    check=await checkAnthropic(env,key,s.model!);
  } else if (entry.id==='stripe') {
    if (!await reveal(env,state,'stripe','webhook_secret')) throw new AdminError('CREDENTIALS_INCOMPLETE',409);
    check=await checkStripe(env,key);
  } else check=await checkMercadoPago(env,key,s.country);
  return recordCheck(db,adminId,entry.id,check,now,'integration_checked');
}
/** A message to the administrator's own address through one provider. "Accepted" is all a provider can tell; delivery is not confirmed. */
export async function sendTestEmail(env:IntegrationsEnv,admin:Principal,input:{provider?:unknown},now=new Date()) {
  const entry=provider(input.provider);
  if (entry.kind!=='mail') throw new AdminError('UNKNOWN_PROVIDER',400);
  const db=env.DB;const state=await requireState(db);
  const from=state.settings.get(entry.id)?.settings.from??env.MAIL_FROM;
  const mailEnv:MailEnv={...env,MAIL_PROVIDER:mailBindingName(entry.id),MAIL_FROM:from};
  if (entry.id==='resend') mailEnv.RESEND_API_KEY=(await reveal(env,state,'resend','api_key'))??undefined;
  const outcome=await sendMail(mailEnv,{to:admin.email,subject:'THE1500: integration test message',
    text:`This message checks the ${entry.id} configuration of THE1500 (${now.toISOString()}).\nEste mensaje comprueba la configuración ${entry.id} de THE1500.`});
  const check:Check=outcome.accepted
    ?{ok:true,code:'ACCEPTED',detail:{to:admin.email,from:from??null,messageId:outcome.messageId,delivery:'not_confirmed'}}
    :{ok:false,code:outcome.code,detail:{to:admin.email,from:from??null,failure:outcome.failure}};
  return recordCheck(db,admin.id,entry.id,check,now,'integration_mail_tested');
}
