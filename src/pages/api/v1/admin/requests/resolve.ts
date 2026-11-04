import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {resolveServiceRequest} from '../../../../../core/admin';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.requestId!=='string') throw new IdentityError('REQUEST_NOT_FOUND',404);
  return resolveServiceRequest(db,user.id,body.requestId,body.decision,body.reasonCode,body.evidenceReference);
}) as unknown as APIRoute;
