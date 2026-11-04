import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,json,parseLocale} from '../../../../core/identity';
import {searchPublishedProfiles} from '../../../../core/search';
export const GET:APIRoute=async({request})=>{
  try {const url=new URL(request.url);
    return json(200,{...await searchPublishedProfiles(env.DB,url.searchParams.get('query')||'',
      Number(url.searchParams.get('limit')||'6'),{country:url.searchParams.get('country')?.toUpperCase()||undefined,industry:url.searchParams.get('industry')||undefined,language:parseLocale(url.searchParams.get('lang'))})});
  } catch(e){return apiError(e);}
};
