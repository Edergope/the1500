import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {runtimeEnv} from '../../../../core/integrations';
import {apiError,json} from '../../../../core/identity';
import {handleStripeWebhook} from '../../../../core/payments';
/** Server-to-server: authenticated by signature over the raw body, so no origin check applies. */
export const POST:APIRoute=async({request})=>{
  try {
    const raw=await request.text();
    return json(200,await handleStripeWebhook(env.DB,await runtimeEnv(env,{stripe:true,mail:true}),raw,request.headers.get('Stripe-Signature')));
  } catch(e){return apiError(e);}
};
