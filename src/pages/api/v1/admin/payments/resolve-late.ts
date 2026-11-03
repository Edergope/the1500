import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {adminEvent} from '../../../../../core/admin';
import {resolveLatePayment} from '../../../../../core/payments';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.attemptId!=='string') throw new IdentityError('ATTEMPT_NOT_FOUND',404);
  const result=await resolveLatePayment(db,body.attemptId);
  await adminEvent(db,user.id,'late_payment_resolved','payment',body.attemptId,null,null,result,new Date()).run();
  return result;
},200) as unknown as APIRoute;
