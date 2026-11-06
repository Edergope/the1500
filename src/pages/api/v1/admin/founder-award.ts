import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,adminPost,numberParam,criticalAdminPost} from '../../../../core/http';
import {IdentityError} from '../../../../core/identity';
import {awardFounder,listAcceptedFounderInvitations} from '../../../../core/admin';
export const GET:APIRoute=adminGet(()=>env.DB,async({db,url})=>listAcceptedFounderInvitations(db,numberParam(url,'limit',50))) as unknown as APIRoute;
/** Irreversible or touches a position or money: the session must have re-authenticated in the last 15 minutes. */
export const POST:APIRoute=criticalAdminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.invitationId!=='string'||body.invitationId.length>80) throw new IdentityError('INVALID_INVITATION');
  return awardFounder(db,user.id,body.invitationId,body.reasonCode,body.evidenceReference,new Date(),env.PUBLIC_BASE_URL||'');
}) as unknown as APIRoute;
