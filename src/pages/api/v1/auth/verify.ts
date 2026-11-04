import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { apiError, consumeLoginLink, cookieForSession, IdentityError, requireSameOrigin } from '../../../../core/identity';
export const POST: APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))
      throw new IdentityError('EXPECTED_FORM',415);
    const data=await request.formData();
    const raw=data.get('token');
    if (typeof raw!=='string') return new Response('Invalid link',{status:400});
    const prefix=data.get('lang')==='es'?'/es':'';
    let opaque:string;
    try {opaque=await consumeLoginLink(env.DB,raw);}
    catch(e) {
      // A person following a stale link gets the sign-in page, not a JSON body.
      if (e instanceof IdentityError&&e.code==='INVALID_OR_EXPIRED_LINK'&&request.headers.get('accept')?.includes('text/html'))
        return new Response(null,{status:303,headers:{'Location':`${prefix}/login?expired=1`,'Cache-Control':'no-store'}});
      throw e;
    }
    return new Response(null,{status:303,headers:{'Location':`${prefix}/mi-cuenta`,
      'Set-Cookie':cookieForSession(opaque),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  } catch(e) {return apiError(e);}
};
