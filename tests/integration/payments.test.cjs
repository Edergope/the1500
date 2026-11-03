const {test,describe,before,after,beforeEach}=require('node:test');const assert=require('node:assert/strict');
const {freshDb,seedCompany,fillPaid,fillFounder}=require('../support/d1.cjs');
const {createUpstreams,signedEvent,WEBHOOK_SECRET}=require('../support/upstreams.cjs');
const core=p=>require(`../../.core-js-tests/core/${p}.js`);
const inv=core('inventory'),pay=core('payments'),adm=core('admin'),stripe=core('stripe');
const key=n=>`idempotency_key_${String(n).padStart(6,'0')}`;
let up,envBase;
before(async()=>{up=await createUpstreams();envBase={PAYMENTS_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_local',STRIPE_WEBHOOK_SECRET:WEBHOOK_SECRET,STRIPE_API_BASE:up.base,PUBLIC_BASE_URL:'http://localhost:8799'};});
after(()=>up.close());
beforeEach(()=>{up.state.stripe.fail=false;up.state.stripe.refundStatus='succeeded';});
let n=0;
async function checkout(h,opts={}){
  const s=await seedCompany(h.db);const now=opts.now||new Date();
  const hold=await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(++n),now);
  const c=await pay.createCheckout(h.db,envBase,{id:s.userId,email:s.email},{companyId:s.companyId,holdId:hold.holdId,termsVersion:'t1',idempotencyKey:key(++n),locale:'en'},now);
  const row=await h.db.prepare(`SELECT provider_session_id sid FROM purchase_attempts WHERE id=?`).bind(c.attemptId).first();
  return {...s,hold,checkout:c,sessionId:row.sid};
}
const deliver=(h,ev,now)=>pay.handleStripeWebhook(h.db,envBase,ev.body,ev.signature,now);
const completed=(session)=>signedEvent('checkout.session.completed',session);
describe('checkout',()=>{
  let h;before(async()=>{h=await freshDb();});after(()=>h.dispose());
  test('price comes from the server, session accepted by the provider limits despite the 20-minute hold',async()=>{
    const b=await checkout(h);
    assert.equal(b.checkout.amount.totalMinor,10000);assert.equal(b.checkout.amount.currency,'usd');
    assert.equal(b.checkout.paymentMode,'test');
    const s=up.state.stripe.sessions.get(b.sessionId);
    assert.equal(s.amount_total,10000);
    assert.ok(s.expires_at-Date.now()/1000>=1800,'Stripe minimum is 30 minutes');
    assert.equal(new Date(b.checkout.reservationExpiresAt)-new Date(b.hold.createdAt),20*60000,'reservation stays 20 minutes');
  });
  test('a live key is refused whatever the configuration says',async()=>{
    assert.deepEqual(stripe.paymentsGate({...envBase,STRIPE_SECRET_KEY:'sk_live_x'}),{ok:false,code:'LIVE_PAYMENTS_NOT_AUTHORIZED'});
    assert.deepEqual(stripe.paymentsGate({...envBase,PAYMENTS_ENABLED:'false'}),{ok:false,code:'PAYMENTS_DISABLED'});
    const s=await seedCompany(h.db);const hold=await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(++n));
    await assert.rejects(pay.createCheckout(h.db,{...envBase,STRIPE_SECRET_KEY:'sk_live_x'},{id:s.userId,email:s.email},{companyId:s.companyId,holdId:hold.holdId,termsVersion:'t',idempotencyKey:key(++n),locale:'en'}),e=>e.code==='LIVE_PAYMENTS_NOT_AUTHORIZED');
  });
  test('cannot pay another company\'s hold; idempotent replay returns the same session',async()=>{
    const a=await checkout(h);const other=await seedCompany(h.db);
    await assert.rejects(pay.createCheckout(h.db,envBase,{id:other.userId,email:other.email},{companyId:other.companyId,holdId:a.hold.holdId,termsVersion:'t',idempotencyKey:key(++n),locale:'en'}),e=>e.code==='HOLD_NOT_FOUND');
    const k=key(++n);const s=await seedCompany(h.db);const hold=await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(++n));
    const args={companyId:s.companyId,holdId:hold.holdId,termsVersion:'t',idempotencyKey:k,locale:'en'};
    const c1=await pay.createCheckout(h.db,envBase,{id:s.userId,email:s.email},args);
    const c2=await pay.createCheckout(h.db,envBase,{id:s.userId,email:s.email},args);
    assert.equal(c1.attemptId,c2.attemptId);assert.equal(c1.checkoutUrl,c2.checkoutUrl);
  });
});
describe('T06 webhooks',()=>{
  let h;before(async()=>{h=await freshDb();});after(()=>h.dispose());
  test('signature is verified; tampering, a wrong secret and an old timestamp are rejected',async()=>{
    const b=await checkout(h);const session=up.pay(b.sessionId);const ev=completed(session);
    await assert.rejects(pay.handleStripeWebhook(h.db,envBase,ev.body+' ',ev.signature),e=>e.code==='INVALID_WEBHOOK_SIGNATURE');
    const forged=signedEvent('checkout.session.completed',session,{secret:'whsec_wrong'});
    await assert.rejects(deliver(h,forged),e=>e.code==='INVALID_WEBHOOK_SIGNATURE');
    const stale=signedEvent('checkout.session.completed',session,{timestamp:Math.floor(Date.now()/1000)-3600});
    await assert.rejects(deliver(h,stale),e=>e.code==='INVALID_WEBHOOK_SIGNATURE');
    await assert.rejects(pay.handleStripeWebhook(h.db,envBase,ev.body,null),e=>e.code==='INVALID_WEBHOOK_SIGNATURE');
    assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM slots WHERE status='assigned'`).first()).n,0);
  });
  test('a browser redirect assigns nothing: only a verified payment does',async()=>{
    const b=await checkout(h);
    const r=await h.db.prepare(`SELECT status FROM purchase_attempts WHERE id=?`).bind(b.checkout.attemptId).first();
    assert.equal(r.status,'pending');
    assert.equal(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=?`).bind(b.companyId).first(),null);
  });
  test('duplicate deliveries, sequential and simultaneous, give one purchase',async()=>{
    const b=await checkout(h);const session=up.pay(b.sessionId);const ev=completed(session);
    const results=await Promise.all(Array.from({length:6},()=>deliver(h,ev)));
    assert.ok(results.some(r=>r.outcome==='assigned'));
    assert.equal((await deliver(h,ev)).duplicate,true);
    // A different event id for the same payment must not buy again either.
    assert.equal((await deliver(h,completed(session))).outcome,'already_processed');
    const slots=await h.db.prepare(`SELECT COUNT(*) n FROM slots WHERE company_id=?`).bind(b.companyId).first();
    assert.equal(slots.n,1);
    const a=await h.db.prepare(`SELECT status,assigned_slot_number,provider_payment_intent FROM purchase_attempts WHERE id=?`).bind(b.checkout.attemptId).first();
    assert.equal(a.status,'paid');assert.ok(a.assigned_slot_number>0);assert.ok(a.provider_payment_intent);
    const audit=await h.db.prepare(`SELECT COUNT(*) n FROM slot_audit WHERE action='assign_paid' AND company_id=?`).bind(b.companyId).first();
    assert.equal(audit.n,1);
    assert.ok(await h.db.prepare(`SELECT 1 FROM onboarding_cases WHERE company_id=?`).bind(b.companyId).first(),'15-day clock started');
    assert.ok(await h.db.prepare(`SELECT 1 FROM notifications WHERE kind='purchase_confirmed' AND company_id=?`).bind(b.companyId).first());
  });
  test('wrong amount or currency never assigns; goes to review with an incident',async()=>{
    const b=await checkout(h);
    await deliver(h,completed(up.pay(b.sessionId,{amount_total:100})));
    assert.equal((await h.db.prepare(`SELECT status FROM purchase_attempts WHERE id=?`).bind(b.checkout.attemptId).first()).status,'amount_review');
    assert.equal(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=?`).bind(b.companyId).first(),null);
    assert.ok(await h.db.prepare(`SELECT 1 FROM incidents WHERE kind='payment_amount_mismatch' AND attempt_id=?`).bind(b.checkout.attemptId).first());
    const c=await checkout(h);
    await deliver(h,completed(up.pay(c.sessionId,{currency:'eur'})));
    assert.equal((await h.db.prepare(`SELECT status FROM purchase_attempts WHERE id=?`).bind(c.checkout.attemptId).first()).status,'amount_review');
  });
  test('unpaid completion assigns nothing; unknown attempts raise an incident',async()=>{
    const b=await checkout(h);const s=up.state.stripe.sessions.get(b.sessionId);
    assert.equal((await deliver(h,completed(s))).outcome,'not_paid');
    const u=await deliver(h,completed({...s,id:'cs_ghost',payment_status:'paid',metadata:{attempt_id:'ghost'}}));
    assert.equal(u.outcome,'unknown_attempt');
    assert.ok(await h.db.prepare(`SELECT 1 FROM incidents WHERE kind='payment_unknown_attempt'`).first());
  });
  test('an expired session ends the attempt and frees the reservation',async()=>{
    const b=await checkout(h);const s=up.state.stripe.sessions.get(b.sessionId);s.status='expired';
    assert.equal((await deliver(h,signedEvent('checkout.session.expired',s))).outcome,'expired');
    assert.equal((await h.db.prepare(`SELECT status FROM slot_holds WHERE id=?`).bind(b.hold.holdId).first()).status,'released');
  });
});
describe('T05 late payments (Decision 42)',()=>{
  test('payment after the hold ends takes no position; admin assigns in the same tier at the original price or refunds',async()=>{
    const h=await freshDb();try{
      const t0=new Date();const b=await checkout(h,{now:t0});
      const later=new Date(t0.getTime()+25*60000); // Session still open (31 min), reservation over (20 min).
      await inv.expireStaleHolds(h.db,later);
      const session=up.pay(b.sessionId);
      const out=await pay.applyPaidSession(h.db,envBase,session,later);
      assert.equal(out.outcome,'late_review');
      assert.equal(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=?`).bind(b.companyId).first(),null);
      assert.ok(await h.db.prepare(`SELECT 1 FROM incidents WHERE kind='payment_after_hold_expiry'`).first());
      const r=await pay.resolveLatePayment(h.db,b.checkout.attemptId,later);
      assert.equal(r.status,'paid');assert.equal(r.position,1);
      assert.equal((await h.db.prepare(`SELECT phase,price_usd_cents p,assignment_kind k FROM slots WHERE company_id=?`).bind(b.companyId).first()).k,'paid');
      await assert.rejects(pay.resolveLatePayment(h.db,b.checkout.attemptId,later),e=>e.code==='PAYMENT_STATE_CONFLICT');
    }finally{await h.dispose();}
  });
  test('with no capacity left in that tier it can only be refunded; no number is displaced and no tier opens early',async()=>{
    const h=await freshDb();try{
      const t0=new Date();const b=await checkout(h,{now:t0});const later=new Date(t0.getTime()+25*60000);
      await inv.expireStaleHolds(h.db,later);
      await pay.applyPaidSession(h.db,envBase,up.pay(b.sessionId),later);
      await fillFounder(h.db,1,100);await fillPaid(h.db,101,600);
      const r=await pay.resolveLatePayment(h.db,b.checkout.attemptId,later);
      assert.equal(r.position,null);assert.equal(r.refundRequired,true);
      assert.equal((await pay.requestRefund(h.db,envBase,b.checkout.attemptId,'no capacity in tier',later)).status,'refunded');
    }finally{await h.dispose();}
  });
  test('sweep expires the provider session when the reservation ends and recovers a missed webhook',async()=>{
    const h=await freshDb();try{
      const t0=new Date();const open=await checkout(h,{now:t0});const paidMissed=await checkout(h,{now:t0});
      up.pay(paidMissed.sessionId);
      const later=new Date(t0.getTime()+21*60000);
      const r=await pay.sweepPayments(h.db,envBase,later);
      assert.equal(r.expired,1);assert.equal(r.reconciled,1);
      assert.equal(up.state.stripe.sessions.get(open.sessionId).status,'expired');
      assert.equal((await h.db.prepare(`SELECT status FROM purchase_attempts WHERE id=?`).bind(open.checkout.attemptId).first()).status,'expired');
      assert.equal((await h.db.prepare(`SELECT status FROM purchase_attempts WHERE id=?`).bind(paidMissed.checkout.attemptId).first()).status,'late_review');
    }finally{await h.dispose();}
  });
  test('admin reconciliation recovers a payment whose webhook never came, inside the reservation',async()=>{
    const h=await freshDb();try{
      const b=await checkout(h);up.pay(b.sessionId);
      const r=await pay.reconcileAttempt(h.db,envBase,b.checkout.attemptId);
      assert.equal(r.outcome,'assigned');assert.equal(r.localStatus,'paid');assert.equal(r.providerStatus,'paid');
    }finally{await h.dispose();}
  });
});
describe('refunds and disputes (Decisions 17, 18, 27)',()=>{
  test('position stays out of inventory until the refund is confirmed, then returns',async()=>{
    const h=await freshDb();try{
      up.state.stripe.refundStatus='pending';
      const b=await checkout(h);const session=up.pay(b.sessionId);await deliver(h,completed(session));
      const r=await pay.requestRefund(h.db,envBase,b.checkout.attemptId,'customer cancelled before structuring');
      assert.equal(r.status,'refund_pending');
      const held=await h.db.prepare(`SELECT status FROM slots WHERE company_id=?`).bind(b.companyId).first();
      assert.equal(held.status,'assigned');
      await deliver(h,signedEvent('charge.refunded',{id:'ch_1',payment_intent:session.payment_intent,refunded:true}));
      assert.equal(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=?`).bind(b.companyId).first(),null);
      assert.equal((await h.db.prepare(`SELECT status FROM purchase_attempts WHERE id=?`).bind(b.checkout.attemptId).first()).status,'refunded');
      assert.equal((await h.db.prepare(`SELECT status FROM slots WHERE number=1`).first()).status,'available');
      assert.ok(await h.db.prepare(`SELECT 1 FROM slot_audit WHERE action='refund_release' AND slot_number=1`).first());
    }finally{await h.dispose();}
  });
  test('a published position is never released, even by a full refund; the database itself refuses',async()=>{
    const h=await freshDb();try{
      const b=await checkout(h);await deliver(h,completed(up.pay(b.sessionId)));
      await h.db.prepare(`UPDATE slots SET first_published_at='2026-11-03T00:00:00.000Z' WHERE company_id=?`).bind(b.companyId).run();
      assert.equal((await pay.requestRefund(h.db,envBase,b.checkout.attemptId,'legal refund')).status,'refunded');
      assert.equal((await h.db.prepare(`SELECT status FROM slots WHERE company_id=?`).bind(b.companyId).first()).status,'assigned');
      await assert.rejects(h.db.prepare(`UPDATE slots SET status='available',company_id=NULL WHERE company_id=?`).bind(b.companyId).run(),/published position cannot be released/);
    }finally{await h.dispose();}
  });
  test('a dispute pauses what has not happened yet; the position stays; a win lifts it',async()=>{
    const h=await freshDb();try{
      const b=await checkout(h);const session=up.pay(b.sessionId);await deliver(h,completed(session));
      await deliver(h,signedEvent('charge.dispute.created',{id:'dp_1',payment_intent:session.payment_intent,reason:'fraudulent'}));
      assert.equal((await h.db.prepare(`SELECT publication_block b FROM companies WHERE id=?`).bind(b.companyId).first()).b,'payment_dispute');
      assert.ok(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=? AND status='assigned'`).bind(b.companyId).first());
      await deliver(h,signedEvent('charge.dispute.closed',{id:'dp_1',payment_intent:session.payment_intent,status:'won'}));
      assert.equal((await h.db.prepare(`SELECT publication_block b FROM companies WHERE id=?`).bind(b.companyId).first()).b,null);
      assert.equal((await h.db.prepare(`SELECT status FROM purchase_attempts WHERE id=?`).bind(b.checkout.attemptId).first()).status,'paid');
    }finally{await h.dispose();}
  });
});
describe('T15 provider failure keeps state intact',()=>{
  test('Stripe down: no charge, attempt failed, reservation intact, retry works',async()=>{
    const h=await freshDb();try{
      const s=await seedCompany(h.db);const hold=await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(++n));
      up.state.stripe.fail=true;
      const args=()=>({companyId:s.companyId,holdId:hold.holdId,termsVersion:'t',idempotencyKey:key(++n),locale:'en'});
      await assert.rejects(pay.createCheckout(h.db,envBase,{id:s.userId,email:s.email},args()),e=>e.code==='CHECKOUT_PROVIDER_UNAVAILABLE'&&e.httpStatus===503);
      assert.equal((await h.db.prepare(`SELECT status FROM slot_holds WHERE id=?`).bind(hold.holdId).first()).status,'active');
      assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM slots WHERE status='assigned'`).first()).n,0);
      up.state.stripe.fail=false;
      const ok=await pay.createCheckout(h.db,envBase,{id:s.userId,email:s.email},args());
      assert.equal(ok.status,'pending');
    }finally{await h.dispose();}
  });
  test('refund provider failure keeps the position out of inventory and raises an incident',async()=>{
    const h=await freshDb();try{
      const b=await checkout(h);await deliver(h,completed(up.pay(b.sessionId)));
      up.state.stripe.fail=true;
      await assert.rejects(pay.requestRefund(h.db,envBase,b.checkout.attemptId,'x y z'),e=>e.code==='CHECKOUT_PROVIDER_UNAVAILABLE');
      assert.equal((await h.db.prepare(`SELECT status FROM purchase_attempts WHERE id=?`).bind(b.checkout.attemptId).first()).status,'refund_pending');
      assert.ok(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=? AND status='assigned'`).bind(b.companyId).first());
      assert.ok(await h.db.prepare(`SELECT 1 FROM incidents WHERE kind='refund_provider_failure'`).first());
    }finally{await h.dispose();}
  });
});
describe('Premium stays human (Question 64 open)',()=>{
  test('assignment needs admin acceptance, evidence and tier 4 being open',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);const s=await seedCompany(h.db);
      const r=await adm.recordPremiumRequest(h.db,admin.userId,s.companyId,'recorded by staff');
      await assert.rejects(adm.assignPremium(h.db,admin.userId,r.requestId,'funds_ok','bank-ref'),e=>e.code==='REQUEST_NOT_FOUND');
      await adm.updatePremiumRequest(h.db,admin.userId,r.requestId,'accepted','reviewed','case-1');
      await assert.rejects(adm.assignPremium(h.db,admin.userId,r.requestId,'funds_ok',''),e=>e.code==='REVIEW_EVIDENCE_REQUIRED');
      await assert.rejects(adm.assignPremium(h.db,admin.userId,r.requestId,'funds_ok','bank-ref'),e=>e.code==='PAYMENT_STATE_CONFLICT');
      await fillPaid(h.db,1,1350);
      const done=await adm.assignPremium(h.db,admin.userId,r.requestId,'funds_ok','bank-ref');
      assert.equal(done.position,1351);
      assert.ok(await h.db.prepare(`SELECT 1 FROM admin_events WHERE action='premium_assigned'`).first());
    }finally{await h.dispose();}
  });
});
