import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireSameOrigin} from '../../../../core/identity';
import {inviteFounder,requirePlatformAdmin} from '../../../../core/admin';
export const POST:APIRoute=async({request})=>{
  try {requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    await requirePlatformAdmin(env.DB,user.id);const data=await readJsonObject(request);
    if(typeof data.companyId!=='string'||data.companyId.length>80) throw new IdentityError('INVALID_COMPANY');
    return json(201,await inviteFounder(env.DB,user.id,data.companyId));
  } catch(e){return apiError(e);}
};
