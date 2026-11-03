import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {resolveIncident} from '../../../../../core/admin';
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.incidentId!=='string') throw new IdentityError('INVALID_REQUEST');
  return resolveIncident(db,user.id,body.incidentId,body.reasonCode,body.evidenceReference);
},200) as unknown as APIRoute;
