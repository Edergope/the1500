import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,json,parseLocale} from '../../../../core/identity';
import {listPublishedCompanies} from '../../../../core/directory';
export const GET:APIRoute=async({request})=>{
  try{
    const u=new URL(request.url);const page=Number(u.searchParams.get('page')||'1');
    const country=u.searchParams.get('country')?.toUpperCase();
    const result=await listPublishedCompanies(env.DB,{page,country,q:u.searchParams.get('query')||undefined,
      industry:u.searchParams.get('industry')||undefined,service:u.searchParams.get('service')||undefined,language:parseLocale(u.searchParams.get('lang'))});
    return json(200,result);
  }catch(e){return apiError(e);}
};
