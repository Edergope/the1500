import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireOwner,requireSameOrigin} from '../../../../../core/identity';
import {respondFinalNotice} from '../../../../../core/cases';
export const POST:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const p=await readJsonObject(request);
    if (typeof p.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
    if (typeof p.message!=='string'||p.message.trim().length<3||p.message.length>1000) throw new IdentityError('INVALID_REQUEST');
    await requireOwner(env.DB,user.id,p.companyId);
    return json(200,await respondFinalNotice(env.DB,p.companyId,p.message.trim()));
  } catch(e){return apiError(e);}
};
