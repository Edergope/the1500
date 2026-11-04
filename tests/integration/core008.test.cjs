// Decisions 22-25, 28, 34, 45: administrative case handling. Stripe here is the local stand-in.
const {test,describe,before,after}=require('node:test');const assert=require('node:assert/strict');
const {freshDb,seedCompany}=require('../support/d1.cjs');
const {createUpstreams,signedEvent,WEBHOOK_SECRET}=require('../support/upstreams.cjs');
const core=p=>require(`../../.core-js-tests/core/${p}.js`);
const ops=core('ops'),cases=core('cases'),adm=core('admin'),inv=core('inventory'),pay=core('payments'),pro=core('profiles'),dir=core('directory');
const DAY=86400000;
const DECL={language:'en',description:'We coordinate ocean freight and shipment visibility for US importers and logistics teams across the Atlantic.',descriptionEs:'Coordinamos fletes marítimos y visibilidad de envíos.',services:['Ocean freight'],audiences:['Importers'],problemSolutions:[{problem:'Importers lack status visibility',solution:'Consolidated tracking'}],serviceCountries:['US'],consent:{processingAuthorized:true,documentVersion:'c1'}};
let up,env,n=700;
const key=()=>`idempotency_key_${String(++n).padStart(6,'0')}`;
before(async()=>{up=await createUpstreams();env={PAYMENTS_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_local',STRIPE_WEBHOOK_SECRET:WEBHOOK_SECRET,STRIPE_API_BASE:up.base,PUBLIC_BASE_URL:'http://localhost:8799',MAIL_PROVIDER:'resend',RESEND_API_KEY:'re_test',MAIL_FROM:'x@y.test',RESEND_API_BASE:up.base};});
after(()=>up.close());
async function bought(h,now,email){
  const s=await seedCompany(h.db,email?{email}:{});const hold=await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(),now);
  const c=await pay.createCheckout(h.db,env,{id:s.userId,email:s.email},{companyId:s.companyId,holdId:hold.holdId,termsVersion:'t',idempotencyKey:key(),locale:'en'},now);
  const row=await h.db.prepare(`SELECT provider_session_id sid FROM purchase_attempts WHERE id=?`).bind(c.attemptId).first();
  return {...s,attemptId:c.attemptId,sessionId:row.sid};
}
const caseOf=(h,c)=>h.db.prepare(`SELECT * FROM onboarding_cases WHERE company_id=?`).bind(c).first();
async function inReview(h,start){
  const s=await bought(h,start);const session=up.pay(s.sessionId);
  await pay.applyPaidSession(h.db,env,session,start);
  const at=d=>new Date(start.getTime()+d*DAY+1000);
  for(const d of [15,30,45])await ops.sweepOnboarding(h.db,'http://x',at(d));
  assert.equal((await caseOf(h,s.companyId)).status,'admin_review');
  return {...s,at};
}
const incident=(h,kind,c)=>h.db.prepare(`SELECT severity,status FROM incidents WHERE kind=? AND company_id=?`).bind(kind,c).first();
describe('final notice and resolution (Decisions 22, 23)',()=>{
  const start=new Date(); // The Stripe stand-in, like Stripe, refuses a session that already expired.
  test('notice starts at delivery, gives 7 days; silence alone sets a 5-business-day decision term and cancels nothing',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);const s=await inReview(h,start);
      await assert.rejects(cases.resolveCase(h.db,env,admin.userId,s.companyId,{decision:'cancel',reasonCode:'silence',evidence:'case-1'},s.at(46)),e=>e.code==='FINAL_NOTICE_REQUIRED');
      await assert.rejects(cases.issueFinalNotice(h.db,admin.userId,s.companyId,{reasonCode:'day45',evidence:''},s.at(46)),e=>e.code==='REVIEW_EVIDENCE_REQUIRED');
      await cases.issueFinalNotice(h.db,admin.userId,s.companyId,{reasonCode:'day45',evidence:'case-1'},s.at(46),'http://x');
      assert.equal((await caseOf(h,s.companyId)).final_notice_due_at,null,'not delivered yet');
      await ops.flushNotifications(h.db,env,s.at(47));
      const c=await caseOf(h,s.companyId);
      assert.equal(c.final_notice_sent_at,s.at(47).toISOString());assert.equal(c.final_notice_channel,'email');assert.ok(c.final_notice_recipient);
      assert.equal(c.final_notice_due_at,new Date(s.at(47).getTime()+7*DAY).toISOString());
      await assert.rejects(cases.resolveCase(h.db,env,admin.userId,s.companyId,{decision:'cancel',reasonCode:'silence',evidence:'case-1'},s.at(50)),e=>e.code==='FINAL_NOTICE_REQUIRED');
      await ops.sweepCaseDeadlines(h.db,s.at(55));
      const d=await caseOf(h,s.companyId);assert.ok(d.resolution_due_at);assert.equal(d.status,'admin_review');
      assert.ok(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=? AND status='assigned'`).bind(s.companyId).first(),'position kept');
      const weekdays=(new Date(d.resolution_due_at).getTime()-new Date(d.final_notice_due_at).getTime())/DAY;assert.ok(weekdays>=5&&weekdays<=7);
      await ops.sweepCaseDeadlines(h.db,new Date(new Date(d.resolution_due_at).getTime()+1000));
      assert.equal((await incident(h,'onboarding_resolution_overdue',s.companyId)).severity,'critical');
    }finally{await h.dispose();}
  });
  test('cancelling orders the full refund to the original method and frees the position only when confirmed',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);const s=await inReview(h,start);
      await cases.recordFinalNoticeByOtherMeans(h.db,admin.userId,s.companyId,{channel:'x',recipient:'y',reasonCode:'phone',evidence:'log'},s.at(46)).catch(e=>assert.equal(e.code,'INVALID_ACTION'));
      await cases.issueFinalNotice(h.db,admin.userId,s.companyId,{reasonCode:'day45',evidence:'c'},s.at(46),'http://x');
      const m=await cases.recordFinalNoticeByOtherMeans(h.db,admin.userId,s.companyId,{channel:'certified_mail',recipient:'Registered address',reasonCode:'mail',evidence:'receipt-9'},s.at(47));assert.ok(m.finalNoticeDueAt);
      up.state.stripe.refundStatus='pending';
      const r=await cases.resolveCase(h.db,env,admin.userId,s.companyId,{decision:'cancel',reasonCode:'no_response',evidence:'case-2'},s.at(55));
      assert.equal(r.refund.status,'refund_pending');
      const held=await h.db.prepare(`SELECT number FROM slots WHERE company_id=?`).bind(s.companyId).first();assert.ok(held,'stays out of inventory until confirmed (Decision 18)');
      const a=await h.db.prepare(`SELECT refund_method,refund_order_due_at due,provider_refund_id ref FROM purchase_attempts WHERE id=?`).bind(s.attemptId).first();
      assert.equal(a.refund_method,'original');assert.ok(a.due);assert.ok(a.ref);
      assert.ok(await h.db.prepare(`SELECT 1 FROM notifications WHERE kind='case_resolution' AND company_id=?`).bind(s.companyId).first());
      const ev=signedEvent('charge.refunded',{id:'ch_1',payment_intent:(await h.db.prepare(`SELECT provider_payment_intent p FROM purchase_attempts WHERE id=?`).bind(s.attemptId).first()).p,refunded:true});
      await pay.handleStripeWebhook(h.db,env,ev.body,ev.signature);
      assert.equal(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=?`).bind(s.companyId).first(),null);
      assert.equal((await caseOf(h,s.companyId)).status,'cancelled');
    }finally{up.state.stripe.refundStatus='succeeded';await h.dispose();}
  });
  test('an answer lets administration decide; continuing grants the 15 days from the new notice, and a second lapse reopens review',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);const s=await inReview(h,start);
      await cases.issueFinalNotice(h.db,admin.userId,s.companyId,{reasonCode:'day45',evidence:'c'},s.at(46),'http://x');
      await assert.rejects(cases.respondFinalNotice(h.db,s.companyId,'We want to go on',s.at(46)),e=>e.code==='INVALID_ACTION');
      await ops.flushNotifications(h.db,env,s.at(46));
      await cases.respondFinalNotice(h.db,s.companyId,'We want to go on',s.at(48));
      assert.equal((await caseOf(h,s.companyId)).final_notice_response,'We want to go on');assert.ok(await incident(h,'final_notice_answered',s.companyId));
      assert.deepEqual(await cases.resolveCase(h.db,env,admin.userId,s.companyId,{decision:'continue',reasonCode:'answered',evidence:'case-3'},s.at(49)),{companyId:s.companyId,resolution:'continue',status:'reactivation_approved'});
      assert.equal((await caseOf(h,s.companyId)).resolution,'continue');
      await ops.flushNotifications(h.db,env,s.at(50));assert.equal((await caseOf(h,s.companyId)).status,'reactivated');
      await ops.sweepOnboarding(h.db,'http://x',s.at(66));
      const c=await caseOf(h,s.companyId);assert.equal(c.status,'admin_review');assert.equal(c.resolved_at,null);
      assert.equal((await cases.listCases(h.db,'admin_review')).cases[0].companyId,s.companyId);
    }finally{await h.dispose();}
  });
  test('a lapsed reactivation needs no second notice; a founder is revoked with no refund (Decision 34)',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);const f=await seedCompany(h.db);
      await h.db.prepare(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,'test')`).bind(admin.userId,start.toISOString()).run();
      const inv1=await adm.inviteFounder(h.db,admin.userId,f.companyId,start);
      await adm.acceptFounderInvitation(h.db,inv1.invitationId,f.userId,start,'f1');
      await adm.awardFounder(h.db,admin.userId,inv1.invitationId,'selected','case',start);
      const at=d=>new Date(start.getTime()+d*DAY+1000);
      for(const d of [15,30,45])await ops.sweepOnboarding(h.db,'http://x',at(d));
      await adm.decideReactivation(h.db,admin.userId,f.companyId,'approved','rev1','e1',at(46));
      await adm.decideReactivation(h.db,admin.userId,f.companyId,'notified_by_other_means','rev2','e2',at(47));
      await ops.sweepOnboarding(h.db,'http://x',at(63));
      const r=await cases.resolveCase(h.db,env,admin.userId,f.companyId,{decision:'cancel',reasonCode:'lapsed',evidence:'case-4'},at(64));
      assert.equal(r.refund,null);assert.equal(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=?`).bind(f.companyId).first(),null);
      assert.equal((await caseOf(h,f.companyId)).status,'cancelled');
    }finally{await h.dispose();}
  });
});
describe('refund order deadline and alternative method (Decisions 24, 25)',()=>{
  test('an unordered refund raises an alert after 5 business days; the alternative needs its evidence and stores no financial data',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);const start=new Date('2026-11-04T12:00:00Z');const s=await bought(h,new Date());
      await pay.applyPaidSession(h.db,env,up.pay(s.sessionId),new Date());
      await h.db.prepare(`UPDATE purchase_attempts SET provider_payment_intent=NULL WHERE id=?`).bind(s.attemptId).run();
      const r=await pay.requestRefund(h.db,env,s.attemptId,'approved',start);assert.equal(r.status,'refund_pending');
      const due=(await h.db.prepare(`SELECT refund_order_due_at d FROM purchase_attempts WHERE id=?`).bind(s.attemptId).first()).d;
      assert.equal(due,'2026-11-11T12:00:00.000Z','5 business days skips the weekend');
      assert.equal((await ops.sweepCaseDeadlines(h.db,new Date('2026-11-11T11:00:00Z'))).refundOrdersOverdue,0);
      assert.equal((await ops.sweepCaseDeadlines(h.db,new Date('2026-11-11T13:00:00Z'))).refundOrdersOverdue,1);
      const body={impossibility:'Card closed',authorizationRef:'auth-1',beneficiaryValidationRef:'id-check-1',operationRef:'op-77',reasonCode:'card_closed'};
      await assert.rejects(pay.recordAlternativeRefund(h.db,admin.userId,s.attemptId,{...body,authorizationRef:''}),e=>e.code==='INVALID_REQUEST');
      assert.deepEqual(await pay.recordAlternativeRefund(h.db,admin.userId,s.attemptId,body),{attemptId:s.attemptId,status:'refunded',refundMethod:'alternative'});
      assert.equal(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=?`).bind(s.companyId).first(),null);
      assert.equal((await h.db.prepare(`SELECT refund_operation_ref o FROM purchase_attempts WHERE id=?`).bind(s.attemptId).first()).o,'op-77');
    }finally{await h.dispose();}
  });
});
describe('lost chargeback on a published profile (Decision 28)',()=>{
  test('15 days to regularize; unpublishing is never automatic and keeps the position consumed',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);const start=new Date();
      const s=await bought(h,start);const session=up.pay(s.sessionId);await pay.applyPaidSession(h.db,env,session,start);
      const d=await pro.submitDeclaration(h.db,{},s.companyId,s.userId,pro.parseDeclaration(DECL));await pro.approveProfile(h.db,s.companyId,d.version,s.userId,d.contentDigest);await pro.publishProfile(h.db,s.companyId,d.version,start,{PUBLIC_BASE_URL:'https://x.test'});
      const pi=(await h.db.prepare(`SELECT provider_payment_intent p FROM purchase_attempts WHERE id=?`).bind(s.attemptId).first()).p;
      for(const [type,status] of [['charge.dispute.created','needs_response'],['charge.dispute.closed','lost']]){const ev=signedEvent(type,{id:'dp_1',payment_intent:pi,status,reason:'fraudulent'});await pay.handleStripeWebhook(h.db,env,ev.body,ev.signature,start);}
      const a=await h.db.prepare(`SELECT status,regularization_due_at due FROM purchase_attempts WHERE id=?`).bind(s.attemptId).first();
      assert.equal(a.status,'chargeback_lost');assert.equal(new Date(a.due)-start,15*DAY);
      assert.ok(await h.db.prepare(`SELECT 1 FROM notifications WHERE kind='chargeback_regularization' AND company_id=?`).bind(s.companyId).first());
      const slug=(await h.db.prepare(`SELECT slug FROM companies WHERE id=?`).bind(s.companyId).first()).slug;
      const go=(decision,at)=>pay.resolveChargeback(h.db,admin.userId,s.attemptId,{decision,reasonCode:'review',evidence:'case-5'},at);
      await assert.rejects(go('unpublished',new Date(start.getTime()+14*DAY)),e=>e.code==='REGULARIZATION_WINDOW_OPEN');
      const later=new Date(start.getTime()+16*DAY);await ops.sweepCaseDeadlines(h.db,later);
      assert.ok(await incident(h,'chargeback_regularization_expired',s.companyId));
      assert.ok(await dir.findPublicProfile(h.db,slug),'still public after the term');
      const r=await go('unpublished',later);assert.equal(r.positionStatus,'retired');
      assert.equal(await dir.findPublicProfile(h.db,slug),null);
      await assert.rejects(go('kept',later),e=>e.code==='PAYMENT_STATE_CONFLICT');
    }finally{await h.dispose();}
  });
});
describe('third-party payer (Decision 45)',()=>{
  test('the position stays with the company; a different payer is flagged until authorization is documented',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);const start=new Date();const s=await bought(h,start);
      const session={...up.pay(s.sessionId),customer_details:{email:'accounting@other.example'}};
      assert.equal((await pay.applyPaidSession(h.db,env,session,start)).outcome,'assigned');
      assert.ok(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=?`).bind(s.companyId).first());
      assert.equal((await h.db.prepare(`SELECT payer_review r FROM purchase_attempts WHERE id=?`).bind(s.attemptId).first()).r,'required');
      assert.equal((await incident(h,'third_party_payer_review',s.companyId)).status,'open');
      await pay.authorizeThirdPartyPayer(h.db,admin.userId,s.attemptId,'documented','letter-3');
      assert.equal((await incident(h,'third_party_payer_review',s.companyId)).status,'resolved');
      await assert.rejects(pay.authorizeThirdPartyPayer(h.db,admin.userId,s.attemptId,'documented','letter-3'),e=>e.code==='PAYMENT_STATE_CONFLICT');
      const same=await bought(h,start);await pay.applyPaidSession(h.db,env,{...up.pay(same.sessionId),customer_details:{email:same.email}},start);
      assert.equal((await h.db.prepare(`SELECT payer_review r FROM purchase_attempts WHERE id=?`).bind(same.attemptId).first()).r,null);
    }finally{await h.dispose();}
  });
});
