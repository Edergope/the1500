import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {adminGet,adminPost} from '../../../../core/http';
import {IdentityError} from '../../../../core/identity';
import {updateSeller} from '../../../../core/admin';
import {getSellerConfiguration} from '../../../../core/payments';
import {paymentsGate} from '../../../../core/stripe';
export const GET:APIRoute=adminGet(()=>env.DB,async({db})=>({...await getSellerConfiguration(db),paymentsGate:paymentsGate(env)})) as unknown as APIRoute;
export const POST:APIRoute=adminPost(()=>env.DB,async({db,user,body})=>{
  if (typeof body.sellerEntityId!=='string'||typeof body.legalName!=='string'||typeof body.country!=='string'||!/^[A-Z]{2}$/.test(body.country)||!body.legalName.trim()||body.legalName.length>200||!body.sellerEntityId||body.sellerEntityId.length>80) throw new IdentityError('INVALID_REQUEST');
  return updateSeller(db,user.id,{sellerEntityId:body.sellerEntityId,legalName:body.legalName.trim(),country:body.country},body.reasonCode,body.evidenceReference);
}) as unknown as APIRoute;
