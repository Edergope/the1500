import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,requireMember} from '../../../../../core/identity';
import {getOwnerCompanyStatus} from '../../../../../core/companies';
export const GET:APIRoute=async({request})=>{
  try {
    const user=await authenticatedPrincipal(env.DB,request);
    const companyId=new URL(request.url).searchParams.get('companyId')||'';
    if (!companyId) throw new IdentityError('INVALID_COMPANY');
    const role=await requireMember(env.DB,user.id,companyId);
    return json(200,{role,...await getOwnerCompanyStatus(env.DB,companyId)});
  } catch(e){return apiError(e);}
};
