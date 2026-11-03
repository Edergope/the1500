import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,json} from '../../../../core/identity';
import {getCompanyReviewQueue,requirePlatformAdmin} from '../../../../core/admin';
export const GET:APIRoute=async({request})=>{
  try {const user=await authenticatedPrincipal(env.DB,request);
    await requirePlatformAdmin(env.DB,user.id);
    const limit=Number(new URL(request.url).searchParams.get('limit')||'30');
    return json(200,await getCompanyReviewQueue(env.DB,limit));
  } catch(e){return apiError(e);}
};
