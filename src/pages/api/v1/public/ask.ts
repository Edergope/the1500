import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {runtimeEnv} from '../../../../core/integrations';
import {apiError,IdentityError,json,parseLocale,readJsonObject,requireSameOrigin,sha256} from '../../../../core/identity';
import {hitRateLimit} from '../../../../core/ops';
import {answerFromPublishedProfiles} from '../../../../core/search';
export const POST:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const p=await readJsonObject(request,1200);
    if(typeof p.question!=='string') throw new IdentityError('QUESTION_REQUIRED');
    // Model calls cost money per request, so anonymous use is limited per client address.
    const client=await sha256(request.headers.get('CF-Connecting-IP')||'unknown');
    if(!await hitRateLimit(env.DB,`ask:${client}`,20,3600)) throw new IdentityError('TOO_MANY_REQUESTS',429);
    return json(200,await answerFromPublishedProfiles(env.DB,p.question,parseLocale(p.language),await runtimeEnv(env,{ai:'assistant'})));
  } catch(e){return apiError(e);}
};
