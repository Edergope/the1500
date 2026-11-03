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
    const opaque=await consumeLoginLink(env.DB,raw);
    return new Response(null,{status:303,headers:{'Location':'/mi-cuenta',
      'Set-Cookie':cookieForSession(opaque),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  } catch(e) {return apiError(e);}
};
