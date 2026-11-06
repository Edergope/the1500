import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost,criticalAdminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {executeWithdrawal} from '../../../../../core/admin';
/** Irreversible or touches a position or money: the session must have re-authenticated in the last 15 minutes. */
export const POST:APIRoute=criticalAdminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.companyId!=='string'||body.companyId.length>80) throw new IdentityError('INVALID_COMPANY');
  if (typeof body.requestId!=='string') throw new IdentityError('REQUEST_NOT_FOUND',404);
  return executeWithdrawal(db,user.id,body.companyId,body.requestId,body.reasonCode,body.evidenceReference);
}) as unknown as APIRoute;
