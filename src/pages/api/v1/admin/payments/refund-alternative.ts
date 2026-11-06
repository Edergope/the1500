import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost,criticalAdminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {recordAlternativeRefund} from '../../../../../core/payments';
/** Irreversible or touches a position or money: the session must have re-authenticated in the last 15 minutes. */
export const POST:APIRoute=criticalAdminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.attemptId!=='string') throw new IdentityError('ATTEMPT_NOT_FOUND',404);
  return recordAlternativeRefund(db,user.id,body.attemptId,{impossibility:body.impossibility,authorizationRef:body.authorizationRef,beneficiaryValidationRef:body.beneficiaryValidationRef,operationRef:body.operationRef,reasonCode:body.reasonCode});
}) as unknown as APIRoute;
