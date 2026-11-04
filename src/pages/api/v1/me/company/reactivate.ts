import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireOwner,requireSameOrigin} from '../../../../../core/identity';
import {requestReactivation} from '../../../../../core/admin';
/** Decision 21: available until day 45. Administration decides; the 15 days start once approval is notified. */
export const POST:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const p=await readJsonObject(request);
    if (typeof p.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
    await requireOwner(env.DB,user.id,p.companyId);
    return json(200,await requestReactivation(env.DB,p.companyId));
  } catch(e){return apiError(e);}
};
