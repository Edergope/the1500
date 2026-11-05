import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {runtimeEnv,sendTestEmail} from '../../../../../core/integrations';
/** Only to the administrator's own address, so it needs no re-authentication. */
export const POST:APIRoute=adminPost(()=>env.DB,async({user,body})=>sendTestEmail(await runtimeEnv(env,{mail:true}),user,body)) as unknown as APIRoute;
