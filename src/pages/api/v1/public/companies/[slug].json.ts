import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError} from '../../../../../core/identity';
import {findPublicProfile} from '../../../../../core/directory';
export const GET: APIRoute=async({params,request})=>{
  try{
    const row=await findPublicProfile(env.DB,params.slug||'');
    if(!row||!row.public_jsonld) return new Response(null,{status:404});
    const locale=new URL(request.url).searchParams.get('lang');
    const json=locale==='es'&&row.public_jsonld_es?row.public_jsonld_es:row.public_jsonld;
    return new Response(json,{headers:{'Content-Type':'application/ld+json; charset=utf-8',
      'Cache-Control':'public,max-age=300','X-Content-Type-Options':'nosniff'}});
  }catch(e){return apiError(e);}
};
