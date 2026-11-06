import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {runtimeEnv} from '../../../../../core/integrations';
import {adminGet,adminPost,criticalAdminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {latePaymentFacts,resolveLatePayment} from '../../../../../core/payments';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>latePaymentFacts(db,url.searchParams.get('attemptId')||'')) as unknown as APIRoute;
/** Irreversible or touches a position or money: the session must have re-authenticated in the last 15 minutes. */
export const POST:APIRoute=criticalAdminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.attemptId!=='string') throw new IdentityError('ATTEMPT_NOT_FOUND',404);
  return resolveLatePayment(db,await runtimeEnv(env,{stripe:true,mail:true}),user.id,body.attemptId,{decision:body.decision,reasonCode:body.reasonCode,evidence:body.evidenceReference});
}) as unknown as APIRoute;
