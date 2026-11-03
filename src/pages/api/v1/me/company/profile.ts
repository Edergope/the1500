import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireOwner,requireSameOrigin} from '../../../../../core/identity';
import {createProfileDraft,getOwnerProfile,parseProfile} from '../../../../../core/profiles';
export const PUT: APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const payload=await readJsonObject(request,14000);
    if (typeof payload.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
    await requireOwner(env.DB,user.id,payload.companyId);
    const data=parseProfile(payload);
    return json(201,await createProfileDraft(env.DB,payload.companyId,user.id,data));
  } catch(e){return apiError(e);}
};
export const GET: APIRoute=async({request})=>{
  try {
    const user=await authenticatedPrincipal(env.DB,request);
    const url=new URL(request.url);const companyId=url.searchParams.get('companyId')||'';
    const version=Number(url.searchParams.get('version'));
    if (!companyId || !Number.isSafeInteger(version)||version<1) throw new IdentityError('INVALID_PROFILE');
    await requireOwner(env.DB,user.id,companyId);
    return json(200,await getOwnerProfile(env.DB,companyId,version));
  } catch(e){return apiError(e);}
};
