import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {apiError, authenticatedPrincipal,json} from '../../../../core/identity';
export const GET: APIRoute=async({request})=>{
  try {
    const u=await authenticatedPrincipal(env.DB,request);
    const rows=await env.DB.prepare(`SELECT c.id,c.display_name AS displayName,c.slug,c.identity_state AS identityState,
      c.publication_status AS publicationStatus,m.role
      FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=?`).bind(u.id).all();
    return json(200,{user:u,companies:rows.results});
  } catch(e){return apiError(e);}
};
