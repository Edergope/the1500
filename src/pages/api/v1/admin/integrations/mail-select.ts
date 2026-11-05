import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {criticalAdminPost} from '../../../../../core/http';
import {selectMailProvider} from '../../../../../core/integrations';
export const POST:APIRoute=criticalAdminPost(()=>env.DB,async({user,body})=>selectMailProvider(env,user.id,body)) as unknown as APIRoute;
