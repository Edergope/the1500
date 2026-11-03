import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {setUserBlocked} from '../../../../../core/admin';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.userId!=='string'||typeof body.blocked!=='boolean') throw new IdentityError('INVALID_REQUEST');
  return setUserBlocked(db,user.id,body.userId,body.blocked,body.reasonCode,body.evidenceReference);
},200) as unknown as APIRoute;
