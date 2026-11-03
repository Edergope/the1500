import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,json} from '../../../../core/identity';
import {getAdminOverview,requirePlatformAdmin} from '../../../../core/admin';
export const GET:APIRoute=async({request})=>{
  try {const user=await authenticatedPrincipal(env.DB,request);await requirePlatformAdmin(env.DB,user.id);
    return json(200,await getAdminOverview(env.DB));
  } catch(e){return apiError(e);}
};
