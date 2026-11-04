import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {authorizeThirdPartyPayer} from '../../../../../core/payments';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.attemptId!=='string') throw new IdentityError('ATTEMPT_NOT_FOUND',404);
  return authorizeThirdPartyPayer(db,user.id,body.attemptId,body.reasonCode,body.evidenceReference);
}) as unknown as APIRoute;
