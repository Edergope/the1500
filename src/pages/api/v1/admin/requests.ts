import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,adminPost,numberParam} from '../../../../core/http';
import {IdentityError} from '../../../../core/identity';
import {listServiceRequests,parseLegalBasis,recordLegalRequest} from '../../../../core/admin';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>listServiceRequests(db,url.searchParams.get('status')||'requested',numberParam(url,'limit',50))) as unknown as APIRoute;
/** Records a legal request that reached administration from outside the owner's account. */
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  const legalBasis=parseLegalBasis(body.legalBasis);
  if (!legalBasis||typeof body.companyId!=='string'||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000||typeof body.channelNote!=='string'||!body.channelNote.trim()||body.channelNote.length>400) throw new IdentityError('INVALID_REQUEST');
  return recordLegalRequest(db,user.id,body.companyId,legalBasis,body.reason.trim(),body.channelNote.trim());
},201) as unknown as APIRoute;
