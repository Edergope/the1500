import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,json,parseLocale} from '../../../../../core/identity';
import {findPublicProfile,publicProfileDto} from '../../../../../core/directory';
export const GET:APIRoute=async({params,request})=>{
  try{
    const row=await findPublicProfile(env.DB,params.slug||'');
    if(!row)return json(404,{error:{code:'PROFILE_NOT_FOUND'}});
    return json(200,publicProfileDto(row,parseLocale(new URL(request.url).searchParams.get('lang'))));
  }catch(e){return apiError(e);}
};
