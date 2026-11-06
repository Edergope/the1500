import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost,criticalAdminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {assignPremium} from '../../../../../core/admin';
/** Irreversible or touches a position or money: the session must have re-authenticated in the last 15 minutes. */
export const POST:APIRoute=criticalAdminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.requestId!=='string') throw new IdentityError('REQUEST_NOT_FOUND',404);
  return assignPremium(db,user.id,body.requestId,body.reasonCode,body.evidenceReference);
}) as unknown as APIRoute;
