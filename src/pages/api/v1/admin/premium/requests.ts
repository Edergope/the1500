import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,adminPost,numberParam} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {listPremiumRequests,updatePremiumRequest} from '../../../../../core/admin';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>listPremiumRequests(db,numberParam(url,'limit',50))) as unknown as APIRoute;
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.requestId!=='string') throw new IdentityError('REQUEST_NOT_FOUND',404);
  return updatePremiumRequest(db,user.id,body.requestId,String(body.status),body.reasonCode,body.evidenceReference);
}) as unknown as APIRoute;
