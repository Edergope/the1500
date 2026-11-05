import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {runtimeEnv} from '../../../../../core/integrations';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {resolveCase} from '../../../../../core/cases';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
  return resolveCase(db,await runtimeEnv(env,{stripe:true,mail:true}),user.id,body.companyId,{decision:body.decision,reasonCode:body.reasonCode,evidence:body.evidenceReference});
}) as unknown as APIRoute;
