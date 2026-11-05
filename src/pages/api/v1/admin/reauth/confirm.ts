import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {confirmReauth} from '../../../../../core/integrations';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,request,body})=>confirmReauth(db,request,user,body.token)) as unknown as APIRoute;
