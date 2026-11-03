import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { apiError, json, readJsonObject, requireSameOrigin, requestLoginLink } from '../../../../core/identity';
export const POST: APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);
    const payload=await readJsonObject(request);
    if (typeof payload.email!=='string') return json(400,{error:{code:'INVALID_EMAIL'}});
    await requestLoginLink(env,payload.email,request.headers.get('CF-Connecting-IP'));
    return json(202,{status:'link_requested'});
  } catch (e) {return apiError(e);}
};
