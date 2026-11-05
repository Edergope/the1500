import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {parseLocale} from '../../../../../core/identity';
import {requestReauth,runtimeEnv} from '../../../../../core/integrations';
export const POST:APIRoute=adminPost(()=>env.DB,async({user,body})=>requestReauth(await runtimeEnv(env,{mail:true}),user,parseLocale(body.locale))) as unknown as APIRoute;
