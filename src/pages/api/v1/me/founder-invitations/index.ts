import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,json} from '../../../../../core/identity';
import {listOwnerFounderInvitations} from '../../../../../core/admin';
export const GET:APIRoute=async({request})=>{
  try {const user=await authenticatedPrincipal(env.DB,request);
    return json(200,await listOwnerFounderInvitations(env.DB,user.id));
  } catch(e){return apiError(e);}
};
