import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,IdentityError,json,readJsonObject,requireSameOrigin} from '../../../../core/identity';
import {answerFromPublishedProfiles} from '../../../../core/search';
export const POST:APIRoute=async({request})=>{
  try {
    requireSameOrigin(request);const p=await readJsonObject(request,1200);
    if(typeof p.question!=='string') throw new IdentityError('QUESTION_REQUIRED');
    const lang=p.language==='es'?'es':'en';
    return json(200,await answerFromPublishedProfiles(env.DB,p.question,lang));
  } catch(e){return apiError(e);}
};
