import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireSameOrigin} from '../../../../core/identity';
import {requirePlatformAdmin,reviewCompany} from '../../../../core/admin';
export const POST:APIRoute=async({request})=>{
  try {requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    await requirePlatformAdmin(env.DB,user.id);const data=await readJsonObject(request);
    if(typeof data.companyId!=='string'||!['approved','rejected'].includes(String(data.decision))||
      typeof data.reasonCode!=='string'||typeof data.evidenceReference!=='string')
      throw new IdentityError('INVALID_REVIEW');
    const result=await reviewCompany(env.DB,data.companyId,user.id,data.decision as 'approved'|'rejected',
      data.reasonCode,data.evidenceReference);
    return json(200,result);
  } catch(e){return apiError(e);}
};
