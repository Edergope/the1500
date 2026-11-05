import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {criticalAdminPost} from '../../../../../core/http';
import {saveCredential} from '../../../../../core/integrations';
export const POST:APIRoute=criticalAdminPost(()=>env.DB,async({user,body})=>saveCredential(env,user.id,body)) as unknown as APIRoute;
