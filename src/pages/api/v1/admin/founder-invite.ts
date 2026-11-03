import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../core/http';
import {IdentityError} from '../../../../core/identity';
import {inviteFounder} from '../../../../core/admin';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if(typeof body.companyId!=='string'||body.companyId.length>80) throw new IdentityError('INVALID_COMPANY');
  return inviteFounder(db,user.id,body.companyId,new Date(),env.PUBLIC_BASE_URL||'');
},201) as unknown as APIRoute;
