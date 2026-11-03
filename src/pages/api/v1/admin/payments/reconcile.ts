import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {reconcileAttempt} from '../../../../../core/payments';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,body})=>{
  if (typeof body.attemptId!=='string') throw new IdentityError('ATTEMPT_NOT_FOUND',404);
  return reconcileAttempt(db,env,body.attemptId);
}) as unknown as APIRoute;
