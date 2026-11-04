import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireOwner,requireSameOrigin} from '../../../../../core/identity';
import {submitPremiumRequest} from '../../../../../core/admin';
/** Decision 64. A meeting is never required to apply; contactPreference only says how the applicant prefers to be reached. */
export const POST:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const p=await readJsonObject(request);
    if (typeof p.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
    const pref=p.contactPreference??'no_preference';
    if (typeof p.message!=='string'||p.message.trim().length<10||p.message.length>2000||(pref!=='email'&&pref!=='meeting'&&pref!=='no_preference')) throw new IdentityError('INVALID_REQUEST');
    await requireOwner(env.DB,user.id,p.companyId);
    return json(201,await submitPremiumRequest(env.DB,p.companyId,user.id,{message:p.message.trim(),contactPreference:pref}));
  } catch(e){return apiError(e);}
};
