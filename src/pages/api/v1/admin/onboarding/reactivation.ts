import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {decideReactivation} from '../../../../../core/admin';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
  return decideReactivation(db,user.id,body.companyId,body.decision,body.reasonCode,body.evidenceReference,new Date(),env.PUBLIC_BASE_URL||'');
}) as unknown as APIRoute;
