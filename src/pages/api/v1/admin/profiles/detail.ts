import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,numberParam} from '../../../../../core/http';
import {getProfileDossier} from '../../../../../core/admin-console';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>getProfileDossier(db,url.searchParams.get('companyId')||'',numberParam(url,'version',0))) as unknown as APIRoute;
