import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {recordAlternativeRefund} from '../../../../../core/payments';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.attemptId!=='string') throw new IdentityError('ATTEMPT_NOT_FOUND',404);
  return recordAlternativeRefund(db,user.id,body.attemptId,{impossibility:body.impossibility,authorizationRef:body.authorizationRef,beneficiaryValidationRef:body.beneficiaryValidationRef,operationRef:body.operationRef,reasonCode:body.reasonCode});
}) as unknown as APIRoute;
