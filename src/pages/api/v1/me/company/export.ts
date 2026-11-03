import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,requireOwner} from '../../../../../core/identity';
import {exportProfile} from '../../../../../core/profiles';
export const GET:APIRoute=async({request})=>{
  try {
    const user=await authenticatedPrincipal(env.DB,request);
    const companyId=new URL(request.url).searchParams.get('companyId')||'';
    if (!companyId) throw new IdentityError('INVALID_COMPANY');
    await requireOwner(env.DB,user.id,companyId);
    return json(200,await exportProfile(env.DB,companyId));
  } catch(e){return apiError(e);}
};
