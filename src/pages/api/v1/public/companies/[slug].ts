import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,json} from '../../../../../core/identity';
import {findPublicProfile} from '../../../../../core/directory';
export const GET: APIRoute=async({params})=>{
  try{
    const row=await findPublicProfile(env.DB,params.slug||'');
    if(!row)return json(404,{error:{code:'PROFILE_NOT_FOUND'}});
    return json(200,{id:row.id,slug:row.slug,name:row.display_name,country:row.country,
      industry:row.industry,summary:row.public_summary,website:row.website,
      version:row.version,html:`/empresas/${row.slug}`,jsonld:`/api/v1/public/companies/${row.slug}.json`});
  }catch(e){return apiError(e);}
};
