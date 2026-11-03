import {defineMiddleware} from 'astro:middleware';
import {errorMessage,negotiateLocale} from './lib/i18n/messages';
/** Adds localized messages to API errors in one place, plus baseline headers for every response. */
export const onRequest=defineMiddleware(async({request},next)=>{
  const response=await next();
  const path=new URL(request.url).pathname;
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('Referrer-Policy',response.headers.get('Referrer-Policy')??'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options','DENY');
  if (!path.startsWith('/api/')||response.status<400) return response;
  if (!response.headers.get('content-type')?.includes('application/json')) return response;
  const body=await response.clone().json().catch(()=>null) as {error?:{code?:string}}|null;
  if (!body?.error?.code) return response;
  const locale=negotiateLocale(request);
  const headers=new Headers(response.headers);headers.set('Content-Language',locale==='es'?'es':'en-US');
  return new Response(JSON.stringify({error:{code:body.error.code,message:errorMessage(body.error.code,locale),locale}}),{status:response.status,headers});
});
