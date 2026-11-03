import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireOwner,requireSameOrigin} from '../../../../../core/identity';
import {approveProfile} from '../../../../../core/profiles';
export const POST: APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const p=await readJsonObject(request);
    const version=Number(p.version);
    if (typeof p.companyId!=='string'||!Number.isSafeInteger(version)||version<1||
      typeof p.contentDigest!=='string'||!/^[a-f0-9]{64}$/.test(p.contentDigest)||p.acceptPublicDisclosure!==true)
      throw new IdentityError('EXPLICIT_APPROVAL_REQUIRED');
    await requireOwner(env.DB,user.id,p.companyId);
    return json(200,await approveProfile(env.DB,p.companyId,version,user.id,p.contentDigest));
  } catch(e){return apiError(e);}
};
