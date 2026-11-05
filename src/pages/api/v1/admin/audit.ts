import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,numberParam} from '../../../../core/http';
import {listAuditEvents} from '../../../../core/admin-console';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>listAuditEvents(db,{action:url.searchParams.get('action')||undefined,subject:url.searchParams.get('subject')||undefined,
  actor:url.searchParams.get('actor')||undefined,limit:numberParam(url,'limit',50),offset:numberParam(url,'offset',0)})) as unknown as APIRoute;
