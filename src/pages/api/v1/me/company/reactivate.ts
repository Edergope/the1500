import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireOwner,requireSameOrigin} from '../../../../../core/identity';
/** Decision 21. Status 'reactivated' leaves any later deadline to administration: none has been approved. */
export const POST:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const p=await readJsonObject(request);
    if (typeof p.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
    await requireOwner(env.DB,user.id,p.companyId);
    const at=new Date().toISOString();
    const r=await env.DB.prepare(`UPDATE onboarding_cases SET status='reactivated',reactivation_requested_at=? WHERE company_id=? AND status='suspended' AND reactivation_due_at>?`).bind(at,p.companyId,at).run();
    if (r.meta.changes!==1) throw new IdentityError('INVALID_ACTION',409);
    return json(200,{companyId:p.companyId,status:'reactivated',reactivationRequestedAt:at});
  } catch(e){return apiError(e);}
};
