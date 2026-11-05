import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {runtimeEnv} from '../../../../core/integrations';
import {apiError,authenticatedPrincipal,IdentityError,json,parseLocale,readJsonObject,requireOwner,requireSameOrigin} from '../../../../core/identity';
import {createCheckout} from '../../../../core/payments';
export const POST:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);
    const user=await authenticatedPrincipal(env.DB,request);
    const data=await readJsonObject(request);
    if (typeof data.companyId!=='string'||data.companyId.length>80) throw new IdentityError('INVALID_COMPANY');
    if (typeof data.holdId!=='string'||data.holdId.length>80) throw new IdentityError('HOLD_NOT_FOUND',404);
    if (data.acceptTerms!==true||typeof data.termsVersion!=='string'||!data.termsVersion||data.termsVersion.length>60) throw new IdentityError('TERMS_REQUIRED');
    await requireOwner(env.DB,user.id,data.companyId);
    return json(201,await createCheckout(env.DB,await runtimeEnv(env,{stripe:true,mail:true}),user,{companyId:data.companyId,holdId:data.holdId,termsVersion:data.termsVersion,
      idempotencyKey:request.headers.get('Idempotency-Key')||'',locale:parseLocale(data.locale)}));
  } catch(e) {return apiError(e);}
};
