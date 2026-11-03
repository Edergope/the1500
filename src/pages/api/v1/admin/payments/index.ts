import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,numberParam} from '../../../../../core/http';
import {listPayments} from '../../../../../core/admin';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>listPayments(db,url.searchParams.get('status'),numberParam(url,'limit',50))) as unknown as APIRoute;
