import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet} from '../../../../../core/http';
import {getIntegrationsView} from '../../../../../core/integrations';
export const GET:APIRoute=adminGet(()=>env.DB,async({request})=>getIntegrationsView(env,request)) as unknown as APIRoute;
