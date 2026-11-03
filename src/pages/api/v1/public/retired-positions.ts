import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {apiError,json} from '../../../../core/identity';
import {listRetiredPositions} from '../../../../core/directory';
export const GET:APIRoute=async()=>{
  try{return json(200,await listRetiredPositions(env.DB));}catch(e){return apiError(e);}
};
