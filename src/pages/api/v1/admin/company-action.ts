import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../core/http';
import {IdentityError} from '../../../../core/identity';
import {companyAdminAction} from '../../../../core/admin';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.companyId!=='string'||body.companyId.length>80) throw new IdentityError('INVALID_COMPANY');
  return companyAdminAction(db,user.id,body.companyId,String(body.action),body.reasonCode,body.evidenceReference);
},200) as unknown as APIRoute;
