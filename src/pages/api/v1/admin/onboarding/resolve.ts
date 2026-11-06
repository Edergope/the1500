import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {runtimeEnv} from '../../../../../core/integrations';
import {adminPost,criticalAdminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {resolveCase} from '../../../../../core/cases';
/** Irreversible or touches a position or money: the session must have re-authenticated in the last 15 minutes. */
export const POST:APIRoute=criticalAdminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
  return resolveCase(db,await runtimeEnv(env,{stripe:true,mail:true}),user.id,body.companyId,{decision:body.decision,reasonCode:body.reasonCode,evidence:body.evidenceReference});
}) as unknown as APIRoute;
