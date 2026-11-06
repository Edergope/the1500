import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {runtimeEnv} from '../../../../../core/integrations';
import {adminPost,criticalAdminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {adminEvent} from '../../../../../core/admin';
import {requestRefund} from '../../../../../core/payments';
/** Irreversible or touches a position or money: the session must have re-authenticated in the last 15 minutes. */
export const POST:APIRoute=criticalAdminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.attemptId!=='string') throw new IdentityError('ATTEMPT_NOT_FOUND',404);
  if (typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>500) throw new IdentityError('REVIEW_EVIDENCE_REQUIRED');
  const result=await requestRefund(db,await runtimeEnv(env,{stripe:true,mail:true}),body.attemptId,body.reason.trim());
  await adminEvent(db,user.id,'refund_requested','payment',body.attemptId,null,body.reason.trim(),result,new Date()).run();
  return result;
}) as unknown as APIRoute;
