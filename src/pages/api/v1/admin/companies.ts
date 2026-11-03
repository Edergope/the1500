import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,numberParam} from '../../../../core/http';
import {getCompanyReviewQueue,listCompanies} from '../../../../core/admin';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>url.searchParams.get('scope')==='all'?
  listCompanies(db,{q:url.searchParams.get('query')||undefined,status:url.searchParams.get('status')||undefined,limit:numberParam(url,'limit',50),offset:numberParam(url,'offset',0)}):
  getCompanyReviewQueue(db,numberParam(url,'limit',30))) as unknown as APIRoute;
