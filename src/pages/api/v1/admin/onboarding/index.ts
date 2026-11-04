import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,numberParam} from '../../../../../core/http';
import {listCases} from '../../../../../core/cases';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>listCases(db,url.searchParams.get('status')||'admin_review',numberParam(url,'limit',50))) as unknown as APIRoute;
