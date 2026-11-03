import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireOwner,requireSameOrigin} from '../../../../../core/identity';
import {publishProfile} from '../../../../../core/profiles';
export const POST:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const p=await readJsonObject(request);
    const version=Number(p.version);
    if (typeof p.companyId!=='string'||!Number.isSafeInteger(version)||version<1)
      throw new IdentityError('INVALID_PROFILE');
    await requireOwner(env.DB,user.id,p.companyId);
    return json(200,await publishProfile(env.DB,p.companyId,version,new Date(),env));
  } catch(e){return apiError(e);}
};
