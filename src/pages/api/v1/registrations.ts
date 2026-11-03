import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,json,readJsonObject,requireSameOrigin} from '../../../core/identity';
import {parseRegistration,registerCompany} from '../../../core/companies';
export const POST: APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);
    const user=await authenticatedPrincipal(env.DB,request);
    const data=parseRegistration(await readJsonObject(request));
    const result=await registerCompany(env.DB,user,data);
    return json(201,result);
  } catch(e){return apiError(e);}
};
