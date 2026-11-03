import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,numberParam} from '../../../../../core/http';
import {listIncidents} from '../../../../../core/admin';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>listIncidents(db,url.searchParams.get('status')||'open',numberParam(url,'limit',50))) as unknown as APIRoute;
