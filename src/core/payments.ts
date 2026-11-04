import {IdentityError,sha256,type Principal} from './identity';
import {assignFreeSlotInPhase,convertHold,getHold,getSalesState,InventoryError,releaseAssignmentStatements,releaseHold} from './inventory';
import {adminEvent,requireEvidence} from './admin';
import {expireStaleHolds} from './inventory';
import {notifyOwners,openIncident} from './ops';
import {latePaymentEmail,latePaymentResolvedEmail,purchaseConfirmedEmail} from '../lib/i18n/comms';
import {createCheckoutSession,createRefund,expireSession,paymentsGate,retrieveChargeTime,retrieveSession,StripeApiError,verifyStripeSignature,type StripeEnv,type StripeSession} from './stripe';

/**
 * Stripe's Checkout expires_at cannot be under 30 minutes, while the approved reservation lasts 20.
 * The session therefore outlives the hold by design. The hold, not the session, decides assignment:
 * sweeping expires the session early when possible, and any payment after the hold ends goes to
 * reconciliation (Decision 42) instead of taking a position.
 */
const SESSION_LIFETIME_S=31*60;
export class PaymentError extends IdentityError {constructor(code:string,status=409){super(code,status);}}
export interface PurchaseAttempt {id:string;company_id:string;user_id:string;hold_id:string;phase:number;assigned_slot_number:number|null;provider_session_id:string|null;
  provider_payment_intent:string|null;amount_usd_cents:number;total_minor:number;charged_currency:string;status:string;hold_expires_at:string;checkout_expires_at:string|null;paid_at:string|null;refund_reason:string|null;}

export async function getSellerConfiguration(db:D1Database) {
  const row=await db.prepare(`SELECT seller_entity_id,seller_legal_name,seller_country,status,payment_mode FROM legal_seller_configuration WHERE id=1`)
    .first<{seller_entity_id:string|null;seller_legal_name:string|null;seller_country:string|null;status:string;payment_mode:string}>();
  return {sellerEntityId:row?.seller_entity_id??null,legalName:row?.seller_legal_name??null,country:row?.seller_country??null,status:row?.status??'unapproved',paymentMode:row?.payment_mode??'test'};
}
export async function createCheckout(db:D1Database,env:StripeEnv,user:Principal,input:{companyId:string;holdId:string;termsVersion:string;idempotencyKey:string;locale:'en'|'es'},now=new Date()) {
  const gate=paymentsGate(env);
  if (!gate.ok) throw new PaymentError(gate.code,gate.code==='PAYMENTS_DISABLED'?503:403);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(input.idempotencyKey)) throw new InventoryError('INVALID_IDEMPOTENCY_KEY');
  const prior=await db.prepare(`SELECT * FROM purchase_attempts WHERE idempotency_key=?`).bind(`${user.id}:${input.idempotencyKey}`).first<PurchaseAttempt>();
  if (prior) {
    if (prior.company_id!==input.companyId||prior.hold_id!==input.holdId) throw new InventoryError('IDEMPOTENCY_MISMATCH');
    if (prior.status==='pending'&&prior.provider_session_id) {
      const session=await retrieveSession(env,prior.provider_session_id).catch(()=>null);
      if (session?.url) return checkoutReply(prior,session.url,await getSellerConfiguration(db));
    }
    throw new PaymentError('PAYMENT_STATE_CONFLICT');
  }
  const hold=await getHold(db,input.holdId);
  if (!hold||hold.company_id!==input.companyId) throw new InventoryError('HOLD_NOT_FOUND');
  if (hold.status!=='active'||hold.expires_at<=now.toISOString()) throw new InventoryError('HOLD_EXPIRED');
  if (hold.phase===4) throw new InventoryError('PREMIUM_ADMISSION_REQUIRED');
  const seller=await getSellerConfiguration(db);
  const id=crypto.randomUUID(),at=now.toISOString();
  // The price comes from the slot row: the client sends none. Tax is not determined yet (Decisions 50-53),
  // which is one of the reasons this path is limited to test mode.
  const amount=hold.price_usd_cents;
  try {
    await db.batch([
      db.prepare(`INSERT INTO purchase_attempts(id,company_id,user_id,hold_id,phase,provider,amount_usd_cents,total_minor,seller_entity_id,status,idempotency_key,hold_expires_at,created_at,updated_at)
        VALUES(?,?,?,?,?,'stripe',?,?,?,'creating',?,?,?,?)`).bind(id,input.companyId,user.id,hold.id,hold.phase,amount,amount,seller.sellerEntityId,`${user.id}:${input.idempotencyKey}`,hold.expires_at,at,at),
      db.prepare(`INSERT INTO consent_records(id,company_id,user_id,kind,document_version,accepted_at) VALUES(?,?,?,'purchase_terms',?,?)`)
        .bind(crypto.randomUUID(),input.companyId,user.id,input.termsVersion,at),
    ]);
  } catch {throw new PaymentError('PAYMENT_STATE_CONFLICT');}
  const expiresAt=Math.floor(now.getTime()/1000)+SESSION_LIFETIME_S;
  let session:StripeSession;
  try {
    session=await createCheckoutSession(env,{attemptId:id,companyId:input.companyId,description:`THE1500 position (tier ${hold.phase})`,amountMinor:amount,expiresAt,
      customerEmail:user.email,locale:input.locale,baseUrl:env.PUBLIC_BASE_URL!.replace(/\/$/,'')},`checkout:${id}`);
  } catch {
    // Nothing was charged and inventory is untouched: the hold stays until it expires so the buyer can retry.
    await db.batch([
      db.prepare(`UPDATE purchase_attempts SET status='failed',updated_at=? WHERE id=? AND status='creating'`).bind(at,id),
      openIncident(db,'checkout_provider_unavailable','warning',{attemptId:id,companyId:input.companyId},{},now),
    ]);
    throw new PaymentError('CHECKOUT_PROVIDER_UNAVAILABLE',503);
  }
  if (session.livemode) {
    // Unreachable with a test key. Kept as a last line of defence against a misconfigured upstream.
    await db.prepare(`UPDATE purchase_attempts SET status='failed',updated_at=? WHERE id=?`).bind(at,id).run();
    throw new PaymentError('LIVE_PAYMENTS_NOT_AUTHORIZED',403);
  }
  await db.prepare(`UPDATE purchase_attempts SET status='pending',provider_session_id=?,checkout_expires_at=?,updated_at=? WHERE id=? AND status='creating'`)
    .bind(session.id,new Date(expiresAt*1000).toISOString(),at,id).run();
  const attempt=await db.prepare(`SELECT * FROM purchase_attempts WHERE id=?`).bind(id).first<PurchaseAttempt>();
  return checkoutReply(attempt!,session.url,seller);
}
function checkoutReply(a:PurchaseAttempt,url:string|null,seller:{legalName:string|null;status:string}) {
  return {attemptId:a.id,checkoutUrl:url,status:a.status,reservationExpiresAt:a.hold_expires_at,
    amount:{baseUsdCents:a.amount_usd_cents,taxMinor:0,taxStatus:'not_determined',totalMinor:a.total_minor,currency:a.charged_currency},
    seller:{legalName:seller.legalName,status:seller.status},paymentMode:'test'};
}
type SessionOutcome='assigned'|'already_processed'|'amount_review'|'late_review'|'not_paid'|'unknown_attempt';
/** Single path for webhooks and reconciliation; every transition is a compare-and-swap, so repeats are harmless. */
/** Best evidence of when the payment happened, and which evidence it was. The reconciler sees both. */
async function effectivePaymentTime(env:StripeEnv,paymentIntent:string|null,eventCreated:number|undefined,now:Date) {
  if (paymentIntent&&env.STRIPE_SECRET_KEY) {
    const charge=await retrieveChargeTime(env,paymentIntent).catch(()=>null);
    if (charge&&typeof charge==='object'&&typeof charge.created==='number') return {at:new Date(charge.created*1000).toISOString(),source:'provider_charge'};
  }
  if (typeof eventCreated==='number') return {at:new Date(eventCreated*1000).toISOString(),source:'provider_event'};
  return {at:now.toISOString(),source:'processing_time'};
}
export async function applyPaidSession(db:D1Database,env:StripeEnv,session:StripeSession,now=new Date(),eventCreated?:number):Promise<{outcome:SessionOutcome;attemptId?:string;slotNumber?:number}> {
  const attemptId=session.metadata?.attempt_id;
  const attempt=attemptId?await db.prepare(`SELECT * FROM purchase_attempts WHERE id=?`).bind(attemptId).first<PurchaseAttempt>():null;
  if (!attempt) {
    await openIncident(db,'payment_unknown_attempt','critical',{dedupeKey:`unknown:${session.id}`},{sessionId:session.id,amount:session.amount_total},now).run();
    return {outcome:'unknown_attempt'};
  }
  if (session.payment_status!=='paid') return {outcome:'not_paid',attemptId:attempt.id};
  if (!['creating','pending','expired','failed'].includes(attempt.status)) return {outcome:'already_processed',attemptId:attempt.id,slotNumber:attempt.assigned_slot_number??undefined};
  const at=now.toISOString();
  const paymentIntent=typeof session.payment_intent==='string'?session.payment_intent:null;
  const payerEmail=session.customer_details?.email??null;
  // Server-side price check. The stored attempt, never the event, says what was owed.
  if (session.amount_total!==attempt.total_minor||session.currency?.toLowerCase()!==attempt.charged_currency||session.livemode) {
    await db.batch([
      db.prepare(`UPDATE purchase_attempts SET status='amount_review',provider_payment_intent=COALESCE(?,provider_payment_intent),provider_session_id=COALESCE(provider_session_id,?),updated_at=? WHERE id=?`)
        .bind(paymentIntent,session.id,at,attempt.id),
      openIncident(db,'payment_amount_mismatch','critical',{attemptId:attempt.id,companyId:attempt.company_id,dedupeKey:`amount:${attempt.id}`},
        {expected:attempt.total_minor,received:session.amount_total,currency:session.currency,livemode:session.livemode},now),
    ]);
    return {outcome:'amount_review',attemptId:attempt.id};
  }
  const result=await convertHold(db,attempt.id,now,{paymentIntent,payerEmail});
  if (result.outcome==='assigned') {
    const company=await db.prepare(`SELECT display_name FROM companies WHERE id=?`).bind(attempt.company_id).first<{display_name:string}>();
    await notifyOwners(db,attempt.company_id,'purchase_confirmed',l=>purchaseConfirmedEmail(l,company?.display_name??'',result.slotNumber!,env.PUBLIC_BASE_URL||''),`purchase:${attempt.id}`,now);
    return {outcome:'assigned',attemptId:attempt.id,slotNumber:result.slotNumber};
  }
  if (result.outcome==='already_processed'&&attempt.status!=='expired'&&attempt.status!=='failed')
    return {outcome:'already_processed',attemptId:attempt.id};
  // Decision 42: a payment confirmed after the reservation ended takes nothing automatically.
  const paid=await effectivePaymentTime(env,paymentIntent,eventCreated,now);
  const moved=await db.batch([
    db.prepare(`UPDATE purchase_attempts SET status='late_review',paid_at=?,paid_at_source=?,provider_payment_intent=COALESCE(?,provider_payment_intent),provider_session_id=COALESCE(provider_session_id,?),payer_email=COALESCE(?,payer_email),updated_at=?
      WHERE id=? AND status IN('creating','pending','expired','failed')`).bind(paid.at,paid.source,paymentIntent,session.id,payerEmail,at,attempt.id),
    openIncident(db,'payment_after_hold_expiry','critical',{attemptId:attempt.id,companyId:attempt.company_id,dedupeKey:`late:${attempt.id}`},
      {holdExpiresAt:attempt.hold_expires_at,paidAt:paid.at,paidAtSource:paid.source,phase:attempt.phase},now),
  ]);
  if (moved[0]?.meta?.changes===1) {
    const company=await db.prepare(`SELECT display_name FROM companies WHERE id=?`).bind(attempt.company_id).first<{display_name:string}>();
    await notifyOwners(db,attempt.company_id,'late_payment',l=>latePaymentEmail(l,company?.display_name??''),`late:${attempt.id}`,now);
  }
  return {outcome:'late_review',attemptId:attempt.id};
}
async function attemptByPaymentIntent(db:D1Database,id:string|null|undefined) {
  if (!id) return null;
  return db.prepare(`SELECT * FROM purchase_attempts WHERE provider_payment_intent=?`).bind(id).first<PurchaseAttempt>();
}
/** Completes a refund and only then frees an unpublished position. Decisions 17-18. */
async function finalizeRefund(db:D1Database,attempt:PurchaseAttempt,now:Date):Promise<'refunded'|'already_processed'> {
  const at=now.toISOString();
  const moved=await db.prepare(`UPDATE purchase_attempts SET status='refunded',refund_confirmed_at=?,updated_at=? WHERE id=? AND status<>'refunded'`).bind(at,at,attempt.id).run();
  if (moved.meta.changes!==1) return 'already_processed';
  if (attempt.assigned_slot_number) await db.batch(releaseAssignmentStatements(db,attempt.assigned_slot_number,attempt.company_id,'refund_release',attempt.id,now));
  return 'refunded';
}
interface StripeEvent {id:string;type:string;created?:number;livemode?:boolean;data:{object:Record<string,unknown>};}
export async function handleStripeWebhook(db:D1Database,env:StripeEnv,rawBody:string,signature:string|null,now=new Date()) {
  if (!env.STRIPE_WEBHOOK_SECRET||!await verifyStripeSignature(rawBody,signature,env.STRIPE_WEBHOOK_SECRET,now)) throw new PaymentError('INVALID_WEBHOOK_SIGNATURE',400);
  let event:StripeEvent;
  try {event=JSON.parse(rawBody) as StripeEvent;} catch {throw new PaymentError('INVALID_JSON',400);}
  if (!event?.id||!event.type||!event.data?.object) throw new PaymentError('INVALID_JSON',400);
  const at=now.toISOString();
  const digest=await sha256(rawBody);
  const first=await db.prepare(`INSERT INTO webhook_events(provider_event_id,provider,event_type,payload_digest,received_at) VALUES(?,'stripe',?,?,?)
    ON CONFLICT(provider_event_id) DO NOTHING`).bind(event.id,event.type,digest,at).run();
  if (first.meta.changes===0) {
    const seen=await db.prepare(`SELECT processed_at,outcome FROM webhook_events WHERE provider_event_id=?`).bind(event.id).first<{processed_at:string|null;outcome:string|null}>();
    if (seen?.processed_at) return {received:true,duplicate:true,outcome:seen.outcome};
    // Earlier delivery died before finishing: fall through. Transitions below are compare-and-swap.
  }
  const outcome=await applyEvent(db,env,event,now);
  await db.prepare(`UPDATE webhook_events SET processed_at=?,outcome=?,attempt_id=? WHERE provider_event_id=?`).bind(at,outcome.outcome,outcome.attemptId??null,event.id).run();
  return {received:true,duplicate:false,outcome:outcome.outcome};
}
async function applyEvent(db:D1Database,env:StripeEnv,event:StripeEvent,now:Date):Promise<{outcome:string;attemptId?:string}> {
  const object=event.data.object;const at=now.toISOString();
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return applyPaidSession(db,env,object as unknown as StripeSession,now,event.created);
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const attemptId=(object.metadata as Record<string,string>|null)?.attempt_id;
      if (!attemptId) return {outcome:'ignored'};
      const status=event.type==='checkout.session.expired'?'expired':'failed';
      const attempt=await db.prepare(`SELECT hold_id FROM purchase_attempts WHERE id=? AND status IN('creating','pending')`).bind(attemptId).first<{hold_id:string}>();
      if (!attempt) return {outcome:'already_processed',attemptId};
      await db.prepare(`UPDATE purchase_attempts SET status=?,updated_at=? WHERE id=? AND status IN('creating','pending')`).bind(status,at,attemptId).run();
      await releaseHold(db,attempt.hold_id,now);
      return {outcome:status,attemptId};
    }
    case 'charge.refunded': {
      const attempt=await attemptByPaymentIntent(db,object.payment_intent as string);
      if (!attempt) return {outcome:'ignored'};
      if (object.refunded!==true) return {outcome:'partial_refund_ignored',attemptId:attempt.id};
      return {outcome:await finalizeRefund(db,attempt,now),attemptId:attempt.id};
    }
    case 'charge.dispute.created': {
      const attempt=await attemptByPaymentIntent(db,object.payment_intent as string);
      if (!attempt) return {outcome:'ignored'};
      // Decision 27: precautionary hold on what has not happened yet. Not treated as proven fraud; the position stays.
      await db.batch([
        db.prepare(`UPDATE purchase_attempts SET status='disputed',updated_at=? WHERE id=? AND status='paid'`).bind(at,attempt.id),
        db.prepare(`UPDATE companies SET publication_block='payment_dispute' WHERE id=?`).bind(attempt.company_id),
        openIncident(db,'payment_dispute','critical',{attemptId:attempt.id,companyId:attempt.company_id,dedupeKey:`dispute:${object.id}`},{disputeId:object.id,reason:object.reason},now),
      ]);
      return {outcome:'disputed',attemptId:attempt.id};
    }
    case 'charge.dispute.closed': {
      const attempt=await attemptByPaymentIntent(db,object.payment_intent as string);
      if (!attempt) return {outcome:'ignored'};
      const won=object.status==='won';
      await db.batch([
        db.prepare(`UPDATE purchase_attempts SET status=?,updated_at=? WHERE id=? AND status='disputed'`).bind(won?'paid':'chargeback_lost',at,attempt.id),
        ...(won?[db.prepare(`UPDATE companies SET publication_block=NULL WHERE id=? AND publication_block='payment_dispute'`).bind(attempt.company_id)]:
          // Decision 28: 15 days to regularize, then a reasoned admin decision. Never automatic.
          [openIncident(db,'chargeback_lost','critical',{attemptId:attempt.id,companyId:attempt.company_id,dedupeKey:`chargeback:${object.id}`},{disputeId:object.id},now)]),
      ]);
      return {outcome:won?'dispute_won':'chargeback_lost',attemptId:attempt.id};
    }
    default: return {outcome:'ignored'};
  }
}
/** Closes open sessions whose reservation ended, and recovers payments whose webhook never arrived. */
export async function sweepPayments(db:D1Database,env:StripeEnv,now=new Date()) {
  const gate=paymentsGate(env);
  if (!gate.ok) return {expired:0,reconciled:0,skipped:true};
  const at=now.toISOString();let expired=0,reconciled=0;
  const open=await db.prepare(`SELECT * FROM purchase_attempts WHERE status='pending' AND hold_expires_at<=? ORDER BY hold_expires_at LIMIT 25`).bind(at).all<PurchaseAttempt>();
  for (const attempt of open.results) {
    if (!attempt.provider_session_id) continue;
    try {
      const session=await retrieveSession(env,attempt.provider_session_id);
      if (session.payment_status==='paid') {await applyPaidSession(db,env,session,now);reconciled++;continue;}
      if (session.status==='open') await expireSession(env,attempt.provider_session_id);
      await db.prepare(`UPDATE purchase_attempts SET status='expired',updated_at=? WHERE id=? AND status='pending'`).bind(at,attempt.id).run();
      expired++;
    } catch (error) {
      // A paid session cannot be expired; the provider's refusal is resolved on the next pass.
      if (!(error instanceof StripeApiError)) throw error;
    }
  }
  return {expired,reconciled,skipped:false};
}
export async function reconcileAttempt(db:D1Database,env:StripeEnv,attemptId:string,now=new Date()) {
  const gate=paymentsGate(env);
  if (!gate.ok) throw new PaymentError(gate.code,gate.code==='PAYMENTS_DISABLED'?503:403);
  const attempt=await db.prepare(`SELECT * FROM purchase_attempts WHERE id=?`).bind(attemptId).first<PurchaseAttempt>();
  if (!attempt) throw new IdentityError('ATTEMPT_NOT_FOUND',404);
  if (!attempt.provider_session_id) return {attemptId,providerStatus:null,localStatus:attempt.status,outcome:'no_provider_session'};
  const session=await retrieveSession(env,attempt.provider_session_id).catch(()=>{throw new PaymentError('CHECKOUT_PROVIDER_UNAVAILABLE',503);});
  const result=await applyPaidSession(db,env,session,now);
  const after=await db.prepare(`SELECT status FROM purchase_attempts WHERE id=?`).bind(attemptId).first<{status:string}>();
  return {attemptId,providerStatus:session.payment_status,localStatus:after?.status,outcome:result.outcome};
}
/** What a human must weigh: when it was paid, when the reservation ended, what happened to that number, what is really free. */
export async function latePaymentFacts(db:D1Database,attemptId:string,now=new Date()) {
  await expireStaleHolds(db,now);
  const attempt=await db.prepare(`SELECT a.*,a.paid_at_source AS source,h.slot_number AS reserved FROM purchase_attempts a JOIN slot_holds h ON h.id=a.hold_id WHERE a.id=?`).bind(attemptId)
    .first<PurchaseAttempt&{source:string|null;reserved:number|null}>();
  if (!attempt) throw new IdentityError('ATTEMPT_NOT_FOUND',404);
  const [reserved,free,own,sales]=await Promise.all([
    attempt.reserved?db.prepare(`SELECT status,company_id FROM slots WHERE number=?`).bind(attempt.reserved).first<{status:string;company_id:string|null}>():null,
    db.prepare(`SELECT COUNT(*) AS n FROM slots WHERE phase=? AND number>=101 AND status='available'`).bind(attempt.phase).first<{n:number}>(),
    db.prepare(`SELECT number FROM slots WHERE company_id=? AND status IN('assigned','retired')`).bind(attempt.company_id).first<{number:number}>(),
    getSalesState(db),
  ]);
  const tierOpen=sales.currentPhase!==null&&attempt.phase<=sales.currentPhase;
  const freeInTier=free?.n??0;
  const assignable=attempt.status==='late_review'&&tierOpen&&freeInTier>0&&!own;
  return {attemptId,companyId:attempt.company_id,status:attempt.status,phase:attempt.phase,paidAt:attempt.paid_at,paidAtSource:attempt.source,holdExpiresAt:attempt.hold_expires_at,
    paidWithinReservation:!!attempt.paid_at&&attempt.paid_at<=attempt.hold_expires_at,
    reservedPosition:attempt.reserved?{number:attempt.reserved,status:reserved?.status??null,takenByAnotherCompany:!!reserved?.company_id&&reserved.company_id!==attempt.company_id}:null,
    tierOpen,freeInTier,companyAlreadyHasPosition:own?.number??null,assignable,allowedDecisions:assignable?['assign','refund']:['refund']};
}
/** Owner decision 2026-11-04: always a human decision, documented. Only a free number is ever taken, so nothing is displaced. */
export async function resolveLatePayment(db:D1Database,env:StripeEnv,adminId:string,attemptId:string,input:{decision:unknown;reasonCode:unknown;evidence:unknown},now=new Date()) {
  requireEvidence(input.reasonCode,input.evidence);
  if (input.decision!=='assign'&&input.decision!=='refund') throw new IdentityError('INVALID_ACTION',400);
  const facts=await latePaymentFacts(db,attemptId,now);
  if (facts.status!=='late_review') throw new PaymentError('PAYMENT_STATE_CONFLICT');
  const at=now.toISOString(),evidence=(input.evidence as string).trim();
  const record=(resolution:'assigned'|'refund',position:number|null)=>db.batch([
    db.prepare(`UPDATE purchase_attempts SET late_resolution=?,late_resolved_at=?,late_resolved_by=?,late_resolution_evidence=?,updated_at=? WHERE id=?`).bind(resolution,at,adminId,evidence,at,attemptId),
    adminEvent(db,adminId,'late_payment_resolved','payment',attemptId,input.reasonCode as string,evidence,{decision:input.decision,position,facts},now),
    db.prepare(`UPDATE incidents SET status='resolved',resolved_at=?,resolved_by=?,resolution_code=? WHERE attempt_id=? AND kind='payment_after_hold_expiry' AND status='open'`).bind(at,adminId,input.reasonCode as string,attemptId),
  ]);
  const notify=async(position:number|null)=>{
    const company=await db.prepare(`SELECT display_name FROM companies WHERE id=?`).bind(facts.companyId).first<{display_name:string}>();
    await notifyOwners(db,facts.companyId,'late_payment_resolved',l=>latePaymentResolvedEmail(l,company?.display_name??'',position),`late_resolved:${attemptId}`,now);
  };
  if (input.decision==='assign') {
    const position=facts.assignable?await assignFreeSlotInPhase(db,attemptId,facts.companyId,facts.phase,now).catch(()=>null):null;
    if (!position) return {attemptId,status:'late_review',position:null,refundRequired:true,facts};
    await record('assigned',position);await notify(position);
    return {attemptId,status:'paid',position,refundRequired:false,facts};
  }
  await record('refund',null);await notify(null);
  const refund=await requestRefund(db,env,attemptId,input.reasonCode as string,now);
  return {...refund,position:null,refundRequired:false,facts};
}
export async function requestRefund(db:D1Database,env:StripeEnv,attemptId:string,reason:string,now=new Date()) {
  const attempt=await db.prepare(`SELECT * FROM purchase_attempts WHERE id=?`).bind(attemptId).first<PurchaseAttempt>();
  if (!attempt) throw new IdentityError('ATTEMPT_NOT_FOUND',404);
  const at=now.toISOString();
  // Decision 18: the position stays out of inventory while the refund is pending.
  const moved=await db.prepare(`UPDATE purchase_attempts SET status='refund_pending',refund_reason=?,refund_requested_at=COALESCE(refund_requested_at,?),updated_at=?
    WHERE id=? AND status IN('paid','late_review','amount_review','refund_pending')`).bind(reason,at,at,attemptId).run();
  if (moved.meta.changes!==1) throw new PaymentError('PAYMENT_STATE_CONFLICT');
  if (!attempt.provider_payment_intent) {
    await openIncident(db,'refund_needs_manual_action','critical',{attemptId,companyId:attempt.company_id,dedupeKey:`refund_manual:${attemptId}`},{},now).run();
    return {attemptId,status:'refund_pending',providerRefundId:null};
  }
  const gate=paymentsGate(env);
  if (!gate.ok) throw new PaymentError(gate.code,gate.code==='PAYMENTS_DISABLED'?503:403);
  try {
    const refund=await createRefund(env,attempt.provider_payment_intent,attemptId);
    await db.prepare(`UPDATE purchase_attempts SET provider_refund_id=?,updated_at=? WHERE id=?`).bind(refund.id,at,attemptId).run();
    if (refund.status==='succeeded') await finalizeRefund(db,{...attempt,status:'refund_pending'},now);
    const after=await db.prepare(`SELECT status FROM purchase_attempts WHERE id=?`).bind(attemptId).first<{status:string}>();
    return {attemptId,status:after?.status,providerRefundId:refund.id};
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    await openIncident(db,'refund_provider_failure','critical',{attemptId,companyId:attempt.company_id,dedupeKey:`refund_failed:${attemptId}`},{},now).run();
    throw new PaymentError('CHECKOUT_PROVIDER_UNAVAILABLE',503);
  }
}
