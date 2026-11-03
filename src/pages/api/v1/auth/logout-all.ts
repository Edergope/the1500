import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,cookieForLogout,json,requireSameOrigin,revokeAllSessions} from '../../../../core/identity';
export const POST:APIRoute=async({request})=>{
  try {requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const revoked=await revokeAllSessions(env.DB,user.id);
    return json(200,{status:'signed_out_everywhere',sessionsRevoked:revoked},{'Set-Cookie':cookieForLogout()});
  } catch(e){return apiError(e);}
};
