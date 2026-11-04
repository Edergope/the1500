import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {resolveCase} from '../../../../../core/cases';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
  return resolveCase(db,env,user.id,body.companyId,{decision:body.decision,reasonCode:body.reasonCode,evidence:body.evidenceReference});
}) as unknown as APIRoute;
