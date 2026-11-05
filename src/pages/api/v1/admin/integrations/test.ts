import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {testConnection} from '../../../../../core/integrations';
/** A check changes nothing, so it needs no re-authentication. */
export const POST:APIRoute=adminPost(()=>env.DB,async({user,body})=>testConnection(env,user.id,body)) as unknown as APIRoute;
