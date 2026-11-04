// Owner decisions of 2026-11-04: withdrawal, reactivation, late card payments, Premium form.
const {test,describe,before,after}=require('node:test');const assert=require('node:assert/strict');
const {freshDb,seedCompany,fillUpTo,fillPaid,fillFounder}=require('../support/d1.cjs');
const {createUpstreams}=require('../support/upstreams.cjs');
const core=p=>require(`../../.core-js-tests/core/${p}.js`);
const pro=core('profiles'),adm=core('admin'),ops=core('ops'),inv=core('inventory'),pay=core('payments'),dir=core('directory'),srch=core('search');
const DAY=86400000;
const DECL={language:'en',description:'We coordinate ocean freight and shipment visibility for US importers and logistics teams across the Atlantic.',
  descriptionEs:'Coordinamos fletes marítimos y visibilidad de envíos para importadores de Estados Unidos.',services:['Ocean freight'],audiences:['Importers'],
  problemSolutions:[{problem:'Importers lack status visibility',solution:'Consolidated tracking'}],serviceCountries:['US'],consent:{processingAuthorized:true,documentVersion:'c1'}};
let up,payEnv,mailEnv,n=500;
before(async()=>{up=await createUpstreams();
  payEnv={PAYMENTS_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_local',STRIPE_WEBHOOK_SECRET:'whsec_x',STRIPE_API_BASE:up.base,PUBLIC_BASE_URL:'http://localhost:8799'};
  mailEnv={MAIL_PROVIDER:'resend',RESEND_API_KEY:'re_test',MAIL_FROM:'x@y.test',RESEND_API_BASE:up.base};});
after(()=>up.close());
const key=()=>`idempotency_key_${String(++n).padStart(6,'0')}`;
async function publishedCompany(h,opts={}){
  const s=await seedCompany(h.db,opts);const num=++n;
  await h.db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind='paid' WHERE number=?`).bind(s.companyId,num).run();
  const d=await pro.submitDeclaration(h.db,{},s.companyId,s.userId,pro.parseDeclaration(DECL));
  await pro.approveProfile(h.db,s.companyId,d.version,s.userId,d.contentDigest);
  await pro.publishProfile(h.db,s.companyId,d.version,new Date(),{PUBLIC_BASE_URL:'https://x.test'});
  return {...s,position:num};
}
describe('withdrawal: holder asks, administration decides, both on record',()=>{
  let h,admin;before(async()=>{h=await freshDb();admin=await seedCompany(h.db);});after(()=>h.dispose());
  test('execution leaves request and decision; the company leaves every public surface; the number stays retired',async()=>{
    const c=await publishedCompany(h,{slug:'gone-co',name:'Gone Co'});
    const r=await adm.requestService(h.db,c.companyId,c.userId,'withdrawal','Closing the line');
    await adm.executeWithdrawal(h.db,admin.userId,c.companyId,r.requestId,'owner_request','ticket-1');
    const row=await h.db.prepare(`SELECT status,resolved_by,resolution_code,resolution_evidence,requested_by FROM service_requests WHERE id=?`).bind(r.requestId).first();
    assert.deepEqual(row,{status:'completed',resolved_by:admin.userId,resolution_code:'owner_request',resolution_evidence:'ticket-1',requested_by:c.userId});
    assert.ok(await h.db.prepare(`SELECT 1 FROM admin_events WHERE action='withdrawal' AND subject_id=?`).bind(c.companyId).first());
    assert.equal(await dir.findPublicProfile(h.db,'gone-co'),null);
    assert.equal((await srch.answerFromPublishedProfiles(h.db,'Gone Co ocean freight','en',{})).citations.some(x=>x.slug==='gone-co'),false);
    assert.equal((await dir.listRetiredPositions(h.db)).items.find(i=>i.position===c.position).labelEs,'Cupo retirado — No disponible');
    await assert.rejects(h.db.prepare(`UPDATE slots SET status='available',company_id=NULL WHERE number=?`).bind(c.position).run(),/cannot be released/);
    assert.ok(await h.db.prepare(`SELECT 1 FROM notifications WHERE kind='service_request_decision' AND company_id=?`).bind(c.companyId).first());
  });
  test('rejection needs evidence, stays on record, and a withdrawal cannot be closed as completed without executing it',async()=>{
    const c=await publishedCompany(h,{slug:'stay-co'});
    const r=await adm.requestService(h.db,c.companyId,c.userId,'withdrawal','Maybe later');
    await assert.rejects(adm.resolveServiceRequest(h.db,admin.userId,r.requestId,'completed','x12','y'),e=>e.code==='INVALID_ACTION');
    await assert.rejects(adm.resolveServiceRequest(h.db,admin.userId,r.requestId,'rejected','x12',''),e=>e.code==='REVIEW_EVIDENCE_REQUIRED');
    await adm.resolveServiceRequest(h.db,admin.userId,r.requestId,'rejected','not_authorized','case-9');
    assert.equal((await h.db.prepare(`SELECT status FROM service_requests WHERE id=?`).bind(r.requestId).first()).status,'rejected');
    assert.ok(await dir.findPublicProfile(h.db,'stay-co'),'still public');
  });
  test('legal requests: recorded from outside the account, first in the queue, not blocked by a voluntary one, overdue terms raise an alert',async()=>{
    const c=await publishedCompany(h,{slug:'legal-co'});
    const voluntary=await adm.requestService(h.db,c.companyId,c.userId,'withdrawal','Voluntary');
    const legal=await adm.recordLegalRequest(h.db,admin.userId,c.companyId,'data_protection','Affected person asks for removal','email of 2026-11-04');
    await assert.rejects(adm.recordLegalRequest(h.db,admin.userId,c.companyId,'data_protection','Again','x'),e=>e.code==='REQUEST_ALREADY_OPEN');
    const queue=await adm.listServiceRequests(h.db);assert.equal(queue.requests[0].id,legal.requestId);assert.equal(queue.requests[0].origin,'recorded_by_admin');
    assert.ok(await h.db.prepare(`SELECT 1 FROM incidents WHERE kind='legal_request_received' AND severity='critical' AND company_id=?`).bind(c.companyId).first());
    // No term is assumed in code: it is empty until administration sets it.
    assert.equal(queue.requests[0].legalDueAt,null);
    const due=new Date(Date.now()+DAY);await adm.setLegalDeadline(h.db,admin.userId,legal.requestId,due.toISOString(),'term_set','counsel-1');
    assert.equal((await ops.sweepLegalRequests(h.db,new Date(due.getTime()-1000))).overdue,0);
    assert.equal((await ops.sweepLegalRequests(h.db,new Date(due.getTime()+1000))).overdue,1);
    assert.ok(await h.db.prepare(`SELECT 1 FROM incidents WHERE kind='legal_request_overdue' AND company_id=?`).bind(c.companyId).first());
    await adm.executeWithdrawal(h.db,admin.userId,c.companyId,legal.requestId,'legal_duty','counsel-2');
    assert.equal((await h.db.prepare(`SELECT status FROM service_requests WHERE id=?`).bind(voluntary.requestId).first()).status,'completed');
    assert.equal(await dir.findPublicProfile(h.db,'legal-co'),null);
  });
});
describe('reactivation: 15 calendar days from approval notified, once',()=>{
  const start=new Date('2026-11-04T00:00:00Z');const at=d=>new Date(start.getTime()+d*DAY+1000);
  let h,admin;before(async()=>{h=await freshDb();admin=await seedCompany(h.db);});after(()=>h.dispose());
  const status=(c)=>h.db.prepare(`SELECT status,reactivation_notified_at nt,reactivation_form_due_at due FROM onboarding_cases WHERE company_id=?`).bind(c).first();
  async function suspended(){
    const s=await seedCompany(h.db);const num=++n;
    await h.db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind='paid' WHERE number=?`).bind(s.companyId,num).run();
    await inv.onboardingStart(h.db,s.companyId,'paid',start).run();
    await ops.sweepOnboarding(h.db,'http://x',at(15));await ops.sweepOnboarding(h.db,'http://x',at(30));
    assert.equal((await status(s.companyId)).status,'suspended');return s;
  }
  test('request until day 45 only; asking alone does not reopen the form',async()=>{
    const s=await suspended();
    await adm.requestReactivation(h.db,s.companyId,at(40));
    assert.equal((await status(s.companyId)).status,'reactivation_requested');
    await assert.rejects(pro.submitDeclaration(h.db,{},s.companyId,s.userId,pro.parseDeclaration(DECL),at(41)),e=>e.code==='ONBOARDING_SUSPENDED');
    const late=await suspended();
    await assert.rejects(adm.requestReactivation(h.db,late.companyId,at(46)),e=>e.code==='INVALID_ACTION');
  });
  test('the clock starts when the notice is delivered, not at approval; missing it goes to individual review with position kept',async()=>{
    const s=await suspended();await adm.requestReactivation(h.db,s.companyId,at(40));
    const r=await adm.decideReactivation(h.db,admin.userId,s.companyId,'approved','approved','case-r1',at(41),'http://x');
    assert.equal(r.status,'reactivation_approved');assert.equal(r.reactivationFormDueAt,null);
    assert.equal((await ops.flushNotifications(h.db,{},at(42))).skipped,true);
    assert.equal((await status(s.companyId)).due,null,'undelivered: the term has not started');
    await ops.flushNotifications(h.db,mailEnv,at(43));
    const c=await status(s.companyId);assert.equal(c.status,'reactivated');
    assert.equal(c.nt,at(43).toISOString());assert.equal(c.due,new Date(at(43).getTime()+15*DAY).toISOString());
    await ops.sweepOnboarding(h.db,'http://x',at(57));assert.equal((await status(s.companyId)).status,'reactivated');
    await ops.sweepOnboarding(h.db,'http://x',at(58));assert.equal((await status(s.companyId)).status,'admin_review');
    assert.ok(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=? AND status='assigned'`).bind(s.companyId).first(),'position kept');
    assert.ok(await h.db.prepare(`SELECT 1 FROM incidents WHERE kind='onboarding_reactivation_lapsed' AND company_id=?`).bind(s.companyId).first());
    await ops.sweepOnboarding(h.db,'http://x',at(90));assert.equal((await status(s.companyId)).status,'admin_review','no automatic loss or extension');
  });
  test('a form submitted in time completes the case; notice by other means needs evidence; rejection goes to review',async()=>{
    const s=await suspended();await adm.requestReactivation(h.db,s.companyId,at(40));
    await adm.decideReactivation(h.db,admin.userId,s.companyId,'approved','approved','case-r2',at(41),'http://x');
    await assert.rejects(adm.decideReactivation(h.db,admin.userId,s.companyId,'notified_by_other_means','phoned','',at(42)),e=>e.code==='REVIEW_EVIDENCE_REQUIRED');
    const m=await adm.decideReactivation(h.db,admin.userId,s.companyId,'notified_by_other_means','phoned','call-log-7',at(42));
    assert.equal(m.status,'reactivated');assert.equal(m.reactivationNotifiedAt,at(42).toISOString());
    await pro.submitDeclaration(h.db,{},s.companyId,s.userId,pro.parseDeclaration(DECL),at(43));
    assert.equal((await status(s.companyId)).status,'completed');
    const x=await suspended();await adm.requestReactivation(h.db,x.companyId,at(40));
    assert.equal((await adm.decideReactivation(h.db,admin.userId,x.companyId,'rejected','unjustified','case-r3',at(41))).status,'admin_review');
    assert.ok(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=? AND status='assigned'`).bind(x.companyId).first());
  });
});
describe('late card payments: human reconciliation with the facts',()=>{
  async function latePaid(h,t0,over={}){
    const s=await seedCompany(h.db);const hold=await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(),t0);
    const c=await pay.createCheckout(h.db,payEnv,{id:s.userId,email:s.email},{companyId:s.companyId,holdId:hold.holdId,termsVersion:'t',idempotencyKey:key(),locale:'en'},t0);
    const later=new Date(t0.getTime()+25*60000);await inv.expireStaleHolds(h.db,later);
    const row=await h.db.prepare(`SELECT provider_session_id sid FROM purchase_attempts WHERE id=?`).bind(c.attemptId).first();
    const out=await pay.applyPaidSession(h.db,payEnv,up.pay(row.sid),later,over.eventCreated);assert.equal(out.outcome,'late_review');
    return {...s,attemptId:c.attemptId,later};
  }
  test('effective payment time comes from the provider charge, then the event, and is labelled; a charge inside the reservation is shown as such',async()=>{
    const h=await freshDb();try{
      const t0=new Date();
      up.state.stripe.chargeCreated=Math.floor(t0.getTime()/1000)+60;
      const a=await latePaid(h,t0);const fa=await pay.latePaymentFacts(h.db,a.attemptId,a.later);
      assert.equal(fa.paidAtSource,'provider_charge');assert.equal(fa.paidWithinReservation,true);
      up.state.stripe.chargeCreated=null;
      const ev=Math.floor(t0.getTime()/1000)+22*60;
      const b=await latePaid(h,t0,{eventCreated:ev});const fb=await pay.latePaymentFacts(h.db,b.attemptId,b.later);
      assert.equal(fb.paidAtSource,'provider_event');assert.equal(fb.paidWithinReservation,false);
      const c=await latePaid(h,t0);assert.equal((await pay.latePaymentFacts(h.db,c.attemptId,c.later)).paidAtSource,'processing_time');
      assert.equal(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=?`).bind(a.companyId).first(),null,'nothing assigned automatically');
    }finally{up.state.stripe.chargeCreated=null;await h.dispose();}
  });
  test('assigning needs documentation and never displaces: the reserved number already taken stays with its holder',async()=>{
    const h=await freshDb();try{
      const t0=new Date();const admin=await seedCompany(h.db);const a=await latePaid(h,t0);
      const reserved=(await pay.latePaymentFacts(h.db,a.attemptId,a.later)).reservedPosition.number;
      const other=await seedCompany(h.db);
      await h.db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind='paid' WHERE number=?`).bind(other.companyId,reserved).run();
      const f=await pay.latePaymentFacts(h.db,a.attemptId,a.later);
      assert.equal(f.reservedPosition.takenByAnotherCompany,true);assert.deepEqual(f.allowedDecisions,['assign','refund']);
      await assert.rejects(pay.resolveLatePayment(h.db,payEnv,admin.userId,a.attemptId,{decision:'assign',reasonCode:'x12',evidence:''},a.later),e=>e.code==='REVIEW_EVIDENCE_REQUIRED');
      const r=await pay.resolveLatePayment(h.db,payEnv,admin.userId,a.attemptId,{decision:'assign',reasonCode:'paid_in_time',evidence:'stripe-log-1'},a.later);
      assert.notEqual(r.position,reserved);
      assert.equal((await h.db.prepare(`SELECT company_id c FROM slots WHERE number=?`).bind(reserved).first()).c,other.companyId);
      const row=await h.db.prepare(`SELECT late_resolution r,late_resolved_by b,late_resolution_evidence e FROM purchase_attempts WHERE id=?`).bind(a.attemptId).first();
      assert.deepEqual(row,{r:'assigned',b:admin.userId,e:'stripe-log-1'});
      assert.ok(await h.db.prepare(`SELECT 1 FROM admin_events WHERE action='late_payment_resolved' AND subject_id=? AND details_json LIKE '%paidAtSource%'`).bind(a.attemptId).first());
      assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM incidents WHERE kind='payment_after_hold_expiry' AND status='open' AND attempt_id=?`).bind(a.attemptId).first()).n,0);
    }finally{await h.dispose();}
  });
  test('no real availability means refund only: the tier never oversells, and two late payers cannot share the last number',async()=>{
    const h=await freshDb();try{
      const t0=new Date();const admin=await seedCompany(h.db);const a=await latePaid(h,t0),b=await latePaid(h,t0);
      await fillFounder(h.db,1,100);await fillPaid(h.db,101,599);
      const go=x=>pay.resolveLatePayment(h.db,payEnv,admin.userId,x.attemptId,{decision:'assign',reasonCode:'review',evidence:'case'},a.later);
      const [ra,rb]=await Promise.all([go(a),go(b)]);
      assert.equal([ra.position,rb.position].filter(Boolean).length,1);
      const loser=ra.position?b:a;
      assert.deepEqual((await pay.latePaymentFacts(h.db,loser.attemptId,a.later)).allowedDecisions,['refund']);
      assert.equal((await pay.resolveLatePayment(h.db,payEnv,admin.userId,loser.attemptId,{decision:'refund',reasonCode:'no_capacity',evidence:'case'},a.later)).status,'refunded');
      assert.equal((await h.db.prepare(`SELECT late_resolution r FROM purchase_attempts WHERE id=?`).bind(loser.attemptId).first()).r,'refund');
      assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM slots WHERE status='assigned'`).first()).n,600);
    }finally{await h.dispose();}
  });
});
describe('Premium, Decision 64: portal form, human evaluation, no checkout',()=>{
  test('form opens with the Premium tier; holds no position; one open application; a meeting is optional',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);const s=await seedCompany(h.db);
      const form={message:'We would like to apply for a Premium position.',contactPreference:'no_preference'};
      await assert.rejects(adm.submitPremiumRequest(h.db,s.companyId,s.userId,form),e=>e.code==='PREMIUM_NOT_OPEN');
      await fillUpTo(h.db,1350);
      const r=await adm.submitPremiumRequest(h.db,s.companyId,s.userId,form);assert.equal(r.status,'received');
      await assert.rejects(adm.submitPremiumRequest(h.db,s.companyId,s.userId,form),e=>e.code==='REQUEST_ALREADY_OPEN');
      assert.equal(await h.db.prepare(`SELECT 1 FROM slots WHERE company_id=?`).bind(s.companyId).first(),null);
      const q=await adm.listPremiumRequests(h.db);assert.equal(q.requests[0].message,form.message);assert.equal(q.requests[0].applicantEmail,s.email);
      await adm.updatePremiumRequest(h.db,admin.userId,r.requestId,'in_review','evaluating','email-thread-3');
      await adm.updatePremiumRequest(h.db,admin.userId,r.requestId,'accepted','accepted','meeting-note-1');
      assert.ok(await h.db.prepare(`SELECT 1 FROM notifications WHERE kind='premium_decision' AND company_id=?`).bind(s.companyId).first());
      await assert.rejects(inv.createCheckoutHold(h.db,s.companyId,s.userId,key()),e=>e.code==='PREMIUM_ADMISSION_REQUIRED');
      assert.equal((await adm.assignPremium(h.db,admin.userId,r.requestId,'funds_ok','bank-ref')).position,1351);
    }finally{await h.dispose();}
  });
});
describe('integration status',()=>{
  test('reports presence and mode without exposing any value',()=>{
    const out=adm.integrationStatus({MAIL_PROVIDER:'resend',RESEND_API_KEY:'re_supersecret',MAIL_FROM:'a@b.test',PAYMENTS_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_supersecret',STRIPE_WEBHOOK_SECRET:'whsec_supersecret',PUBLIC_BASE_URL:'https://x.test',AI_API_KEY:'k_supersecret',AI_PROVIDER:'anthropic'});
    assert.equal(JSON.stringify(out).includes('supersecret'),false);
    assert.equal(out.stripe.gate,'open_test_mode');assert.equal(out.stripe.keyIsTestMode,true);assert.equal(out.ai.configured,true);
    assert.equal(adm.integrationStatus({STRIPE_SECRET_KEY:'sk_live_x',STRIPE_WEBHOOK_SECRET:'w',PAYMENTS_ENABLED:'true',PUBLIC_BASE_URL:'https://x.test'}).stripe.gate,'LIVE_PAYMENTS_NOT_AUTHORIZED');
  });
});
