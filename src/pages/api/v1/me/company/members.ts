import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,normalizeEmail,readJsonObject,requireSameOrigin} from '../../../../../core/identity';
import {setCompanyMember} from '../../../../../core/companies';
export const POST:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const p=await readJsonObject(request);
    if (typeof p.companyId!=='string'||typeof p.email!=='string'||(p.action!=='add'&&p.action!=='remove')) throw new IdentityError('INVALID_REQUEST');
    return json(200,await setCompanyMember(env.DB,user.id,p.companyId,normalizeEmail(p.email),p.action));
  } catch(e){return apiError(e);}
};
