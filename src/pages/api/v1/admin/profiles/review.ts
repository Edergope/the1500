import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {reviewProfile} from '../../../../../core/admin';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.companyId!=='string'||body.companyId.length>80) throw new IdentityError('INVALID_COMPANY');
  const version=Number(body.version);
  if (!Number.isSafeInteger(version)||version<1||(body.decision!=='cleared'&&body.decision!=='rejected')) throw new IdentityError('INVALID_REVIEW');
  return reviewProfile(db,user.id,body.companyId,version,body.decision,body.reasonCode,body.evidenceReference);
},200) as unknown as APIRoute;
