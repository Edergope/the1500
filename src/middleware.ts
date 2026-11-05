import {defineMiddleware} from 'astro:middleware';
import {env} from 'cloudflare:workers';
import {errorMessage,negotiateLocale} from './lib/i18n/messages';
import {authenticatedPrincipal} from './core/identity';
import {requirePlatformAdmin} from './core/admin';
const ADMIN_PAGE=/^\/(es\/)?admin(\/|$)/;
/** Every page of the panel passes here, so none can forget it. Someone without the permission cannot tell the panel exists. */
async function guardAdminPage(request:Request,locals:App.Locals,es:boolean):Promise<Response|null> {
  const closed=(location:string|null)=>new Response(location?null:'Not found',{status:location?302:404,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow',...(location?{Location:location}:{})}});
  let user;
  try {user=await authenticatedPrincipal(env.DB,request);} catch {return closed(`${es?'/es':''}/login?required=1`);}
  try {await requirePlatformAdmin(env.DB,user.id);} catch {return closed(null);}
  locals.admin=user;
  return null;
}
/** Adds localized messages to API errors in one place, plus baseline headers for every response. */
export const onRequest=defineMiddleware(async({request,locals},next)=>{
  const path=new URL(request.url).pathname;
  const adminPage=ADMIN_PAGE.exec(path);
  if (adminPage) {
    const refused=await guardAdminPage(request,locals,!!adminPage[1]);
    if (refused) return refused;
  }
  const response=await next();
  if (adminPage) {
    response.headers.set('Cache-Control','no-store');
    response.headers.set('X-Robots-Tag','noindex, nofollow');
  }
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('Referrer-Policy',response.headers.get('Referrer-Policy')??'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options','DENY');
  // Shell.astro changes the navigation for a signed-in visitor, so no page may land in a shared cache.
  if (!response.headers.has('Cache-Control')&&response.headers.get('content-type')?.includes('text/html')) response.headers.set('Cache-Control','private, no-cache');
  if (!path.startsWith('/api/')||response.status<400) return response;
  if (!response.headers.get('content-type')?.includes('application/json')) return response;
  const body=await response.clone().json().catch(()=>null) as {error?:{code?:string}}|null;
  if (!body?.error?.code) return response;
  const locale=negotiateLocale(request);
  const headers=new Headers(response.headers);headers.set('Content-Language',locale==='es'?'es':'en-US');
  return new Response(JSON.stringify({error:{code:body.error.code,message:errorMessage(body.error.code,locale),locale}}),{status:response.status,headers});
});
