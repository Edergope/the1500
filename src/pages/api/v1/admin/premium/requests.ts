import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,adminPost,numberParam} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {listPremiumRequests,recordPremiumRequest,updatePremiumRequest} from '../../../../../core/admin';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>listPremiumRequests(db,numberParam(url,'limit',50))) as unknown as APIRoute;
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.requestId==='string') return updatePremiumRequest(db,user.id,body.requestId,String(body.status),body.reasonCode,body.evidenceReference);
  if (typeof body.companyId!=='string'||typeof body.channelNote!=='string'||!body.channelNote.trim()||body.channelNote.length>500) throw new IdentityError('INVALID_REQUEST');
  return recordPremiumRequest(db,user.id,body.companyId,body.channelNote.trim());
}) as unknown as APIRoute;
