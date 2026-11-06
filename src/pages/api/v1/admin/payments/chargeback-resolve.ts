import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost,criticalAdminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {resolveChargeback} from '../../../../../core/payments';
/** Irreversible or touches a position or money: the session must have re-authenticated in the last 15 minutes. */
export const POST:APIRoute=criticalAdminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.attemptId!=='string') throw new IdentityError('ATTEMPT_NOT_FOUND',404);
  return resolveChargeback(db,user.id,body.attemptId,{decision:body.decision,reasonCode:body.reasonCode,evidence:body.evidenceReference});
}) as unknown as APIRoute;
