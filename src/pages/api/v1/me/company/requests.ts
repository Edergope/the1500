import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireOwner,requireSameOrigin} from '../../../../../core/identity';
import {parseLegalBasis,requestService} from '../../../../../core/admin';
/** Records a withdrawal or cancellation request with its timestamp. Decisions 10, 17, 29. Administration executes it. */
export const POST:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const p=await readJsonObject(request);
    if (typeof p.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
    if ((p.kind!=='withdrawal'&&p.kind!=='cancellation')||typeof p.reason!=='string'||p.reason.trim().length<3||p.reason.length>1000) throw new IdentityError('INVALID_REQUEST');
    const legalBasis=parseLegalBasis(p.legalBasis);
    if (legalBasis&&p.kind!=='withdrawal') throw new IdentityError('INVALID_REQUEST');
    await requireOwner(env.DB,user.id,p.companyId);
    return json(201,await requestService(env.DB,p.companyId,user.id,p.kind,p.reason.trim(),new Date(),legalBasis));
  } catch(e){return apiError(e);}
};
