import {sha256} from './identity';
/**
 * Minimal Stripe client over fetch. Test mode only until the owner authorizes production:
 * a live key is refused here, whatever other configuration says.
 */
const API_VERSION='2026-10-28.endive';
export const SIGNATURE_TOLERANCE_SECONDS=300;
export interface StripeEnv {STRIPE_SECRET_KEY?:string;STRIPE_WEBHOOK_SECRET?:string;STRIPE_API_BASE?:string;PAYMENTS_ENABLED?:string;PUBLIC_BASE_URL?:string;}
export class StripeApiError extends Error {constructor(public status:number,public code:string|undefined,message:string){super(message);this.name='StripeApiError';}}
export type PaymentsGate={ok:true;mode:'test'}|{ok:false;code:'PAYMENTS_DISABLED'|'LIVE_PAYMENTS_NOT_AUTHORIZED'};
export function paymentsGate(env:StripeEnv):PaymentsGate {
  if (env.PAYMENTS_ENABLED!=='true'||!env.STRIPE_SECRET_KEY||!env.STRIPE_WEBHOOK_SECRET||!env.PUBLIC_BASE_URL) return {ok:false,code:'PAYMENTS_DISABLED'};
  if (!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) return {ok:false,code:'LIVE_PAYMENTS_NOT_AUTHORIZED'};
  return {ok:true,mode:'test'};
}
function formEncode(value:unknown,prefix='',out=new URLSearchParams()):URLSearchParams {
  if (Array.isArray(value)) value.forEach((v,i)=>formEncode(v,`${prefix}[${i}]`,out));
  else if (value&&typeof value==='object') for (const [k,v] of Object.entries(value)) formEncode(v,prefix?`${prefix}[${k}]`:k,out);
  else if (value!==undefined&&value!==null) out.append(prefix,String(value));
  return out;
}
async function call<T>(env:StripeEnv,method:'GET'|'POST',path:string,body?:Record<string,unknown>,idempotencyKey?:string):Promise<T> {
  let response:Response;
  try {
    response=await fetch(`${env.STRIPE_API_BASE||'https://api.stripe.com'}${path}`,{method,signal:AbortSignal.timeout(15_000),
      headers:{'Authorization':`Bearer ${env.STRIPE_SECRET_KEY}`,'Stripe-Version':API_VERSION,
        ...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},
      ...(body?{body:formEncode(body).toString()}:{})});
  } catch (error) {throw new StripeApiError(0,'network',error instanceof Error?error.message:'network failure');}
  const data=await response.json().catch(()=>({})) as {error?:{code?:string;message?:string}};
  if (!response.ok) throw new StripeApiError(response.status,data.error?.code,data.error?.message||`stripe ${response.status}`);
  return data as T;
}
export interface StripeSession {id:string;url:string|null;status:string;payment_status:string;amount_total:number|null;currency:string|null;
  payment_intent:string|null;metadata:Record<string,string>|null;livemode:boolean;expires_at:number;customer_details?:{email?:string|null}|null;}
export function createCheckoutSession(env:StripeEnv,params:{attemptId:string;companyId:string;description:string;amountMinor:number;expiresAt:number;customerEmail:string;locale:'en'|'es';baseUrl:string},idempotencyKey:string) {
  return call<StripeSession>(env,'POST','/v1/checkout/sessions',{
    mode:'payment',payment_method_types:['card'],client_reference_id:params.attemptId,customer_email:params.customerEmail,locale:params.locale,
    expires_at:params.expiresAt,
    success_url:`${params.baseUrl}${params.locale==='es'?'/es':''}/mi-cuenta?checkout=returned`,cancel_url:`${params.baseUrl}${params.locale==='es'?'/es':''}/mi-cuenta?checkout=cancelled`,
    line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:params.amountMinor,product_data:{name:params.description}}}],
    metadata:{attempt_id:params.attemptId,company_id:params.companyId},
    payment_intent_data:{metadata:{attempt_id:params.attemptId,company_id:params.companyId}},
  },idempotencyKey);
}
export const retrieveSession=(env:StripeEnv,id:string)=>call<StripeSession>(env,'GET',`/v1/checkout/sessions/${encodeURIComponent(id)}`);
/** When the card was actually charged, according to the provider. */
export const retrieveChargeTime=async(env:StripeEnv,paymentIntent:string)=>
  (await call<{latest_charge?:{created?:number}|string|null}>(env,'GET',`/v1/payment_intents/${encodeURIComponent(paymentIntent)}?expand[]=latest_charge`)).latest_charge;
export const expireSession=(env:StripeEnv,id:string)=>call<StripeSession>(env,'POST',`/v1/checkout/sessions/${encodeURIComponent(id)}/expire`,{});
export const createRefund=(env:StripeEnv,paymentIntent:string,attemptId:string)=>
  call<{id:string;status:string}>(env,'POST','/v1/refunds',{payment_intent:paymentIntent,metadata:{attempt_id:attemptId}},`refund:${attemptId}`);

function hex(buffer:ArrayBuffer):string {return Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');}
function safeEqual(a:string,b:string):boolean {
  if (a.length!==b.length) return false;
  let diff=0;for (let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
export async function computeSignature(secret:string,timestamp:string|number,payload:string):Promise<string> {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${payload}`)));
}
/** Stripe's scheme: HMAC-SHA256 of "t.payload" against any v1 value, within a replay window. Must use the raw body. */
export async function verifyStripeSignature(payload:string,header:string|null,secret:string,now=new Date()):Promise<boolean> {
  if (!header) return false;
  const parts=header.split(',').map(p=>p.trim().split('='));
  const t=parts.find(p=>p[0]==='t')?.[1];
  const signatures=parts.filter(p=>p[0]==='v1').map(p=>p[1]||'');
  if (!t||!/^\d+$/.test(t)||!signatures.length) return false;
  if (Math.abs(now.getTime()/1000-Number(t))>SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected=await computeSignature(secret,t,payload);
  return signatures.some(s=>safeEqual(s,expected));
}
export const payloadDigest=sha256;
