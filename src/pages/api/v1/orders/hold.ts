import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {apiError,authenticatedPrincipal,IdentityError,json,readJsonObject,requireOwner,requireSameOrigin} from '../../../../core/identity';
import {createCheckoutHold,InventoryError} from '../../../../core/inventory';
export const POST: APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);
    const user=await authenticatedPrincipal(env.DB,request);
    const data=await readJsonObject(request);
    if (typeof data.companyId!=='string'||data.companyId.length>80) throw new IdentityError('INVALID_COMPANY');
    const idempotencyKey=request.headers.get('Idempotency-Key')||'';
    await requireOwner(env.DB,user.id,data.companyId);
    const hold=await createCheckoutHold(env.DB,data.companyId,user.id,idempotencyKey);
    return json(201,{hold,paymentStatus:'not_started',checkoutEnabled:false});
  } catch(e) {
    if (e instanceof InventoryError) {
      const status=e.code==='UNAUTHORIZED'?401:e.code==='TOO_MANY_REQUESTS'?429:
        e.code==='INVALID_COMPANY'||e.code==='INVALID_IDEMPOTENCY_KEY'?400:409;
      return json(status,{error:{code:e.code}});
    }
    return apiError(e);
  }
};
