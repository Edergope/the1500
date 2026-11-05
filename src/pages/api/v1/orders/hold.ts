import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {runtimeEnv} from '../../../../core/integrations';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireOwner,requireSameOrigin} from '../../../../core/identity';
import {createCheckoutHold} from '../../../../core/inventory';
import {paymentsGate} from '../../../../core/stripe';
export const POST:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);
    const user=await authenticatedPrincipal(env.DB,request);
    const data=await readJsonObject(request);
    if (typeof data.companyId!=='string'||data.companyId.length>80) throw new IdentityError('INVALID_COMPANY');
    const idempotencyKey=request.headers.get('Idempotency-Key')||'';
    await requireOwner(env.DB,user.id,data.companyId);
    const hold=await createCheckoutHold(env.DB,data.companyId,user.id,idempotencyKey);
    return json(201,{hold,paymentStatus:'not_started',checkoutEnabled:paymentsGate(await runtimeEnv(env,{stripe:true})).ok});
  } catch(e) {return apiError(e);}
};
