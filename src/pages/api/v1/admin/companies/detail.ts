import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet} from '../../../../../core/http';
import {getCompanyDossier} from '../../../../../core/admin-console';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>getCompanyDossier(db,url.searchParams.get('companyId')||'')) as unknown as APIRoute;
