import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminPost} from '../../../../../core/http';
import {IdentityError} from '../../../../../core/identity';
import {issueFinalNotice,recordFinalNoticeByOtherMeans} from '../../../../../core/cases';
/** Without channel: queues the email. With channel and recipient: records a notice already given by another means. */
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.companyId!=='string') throw new IdentityError('INVALID_COMPANY');
  if (body.channel!==undefined) return recordFinalNoticeByOtherMeans(db,user.id,body.companyId,{channel:body.channel,recipient:body.recipient,reasonCode:body.reasonCode,evidence:body.evidenceReference});
  return issueFinalNotice(db,user.id,body.companyId,{reasonCode:body.reasonCode,evidence:body.evidenceReference},new Date(),env.PUBLIC_BASE_URL||'');
}) as unknown as APIRoute;
