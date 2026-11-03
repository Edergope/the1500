import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,numberParam} from '../../../../core/http';
import {getInventoryDetail} from '../../../../core/admin';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>getInventoryDetail(db,numberParam(url,'limit',100),numberParam(url,'offset',0))) as unknown as APIRoute;
