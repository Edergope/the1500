import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {apiError,cookieForLogout,json,logout,requireSameOrigin} from '../../../../core/identity';
export const POST: APIRoute=async({request})=>{
  try {requireSameOrigin(request);await logout(env.DB,request);
    return json(200,{status:'signed_out'},{'Set-Cookie':cookieForLogout()});
  } catch(e){return apiError(e);}
};
