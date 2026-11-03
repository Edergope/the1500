import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireMember,requireSameOrigin} from '../../../../../core/identity';
import {getOwnerProfile,parseDeclaration,submitDeclaration} from '../../../../../core/profiles';
export const PUT:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const payload=await readJsonObject(request,20000);
    if (typeof payload.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
    await requireMember(env.DB,user.id,payload.companyId);
    return json(201,await submitDeclaration(env.DB,env,payload.companyId,user.id,parseDeclaration(payload)));
  } catch(e){return apiError(e);}
};
export const GET:APIRoute=async({request})=>{
  try {
    const user=await authenticatedPrincipal(env.DB,request);
    const url=new URL(request.url);const companyId=url.searchParams.get('companyId')||'';
    const version=Number(url.searchParams.get('version'));
    if (!companyId || !Number.isSafeInteger(version)||version<1) throw new IdentityError('INVALID_PROFILE');
    await requireMember(env.DB,user.id,companyId);
    return json(200,await getOwnerProfile(env.DB,companyId,version));
  } catch(e){return apiError(e);}
};
