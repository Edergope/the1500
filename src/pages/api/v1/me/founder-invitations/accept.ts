import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireSameOrigin} from '../../../../../core/identity';
import {acceptFounderInvitation} from '../../../../../core/admin';
export const POST:APIRoute=async({request})=>{
  try {requireSameOrigin(request);const user=await authenticatedPrincipal(env.DB,request);
    const data=await readJsonObject(request);
    if(typeof data.invitationId!=='string'||data.invitationId.length>80)
      throw new IdentityError('INVALID_INVITATION');
    return json(200,await acceptFounderInvitation(env.DB,data.invitationId,user.id));
  } catch(e){return apiError(e);}
};
