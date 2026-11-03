import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,numberParam} from '../../../../core/http';
import {listServiceRequests} from '../../../../core/admin';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>listServiceRequests(db,url.searchParams.get('status')||'requested',numberParam(url,'limit',50))) as unknown as APIRoute;
