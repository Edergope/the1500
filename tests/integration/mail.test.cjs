// CORE-007: the provider sits behind one adapter. Cloudflare's binding is a local stand-in or the local simulator here:
// real delivery needs Workers Paid and a sending domain.
const {test,describe,before,after}=require('node:test');const assert=require('node:assert/strict');
const {freshDb,seedCompany}=require('../support/d1.cjs');
const {createUpstreams}=require('../support/upstreams.cjs');
const core=p=>require(`../../.core-js-tests/core/${p}.js`);
const mail=core('mail'),ops=core('ops'),id=core('identity'),adm=core('admin');
const FROM='THE1500 <signin@mail.the1500.test>';
const binding=(fail)=>{const sent=[];return {sent,send:async m=>{if(fail){const e=new Error(fail);e.code=fail;throw e;}sent.push(m);return {messageId:'cf-'+sent.length};}};};
const cf=(fail)=>({MAIL_PROVIDER:'cloudflare',MAIL_FROM:FROM,EMAIL:binding(fail)});
const msg={to:'a@b.test',subject:'s',text:'t'};
describe('provider selection',()=>{
  test('Cloudflare is the default, needs the binding and a sender, and no key',()=>{
    assert.equal(mail.mailConfigured({MAIL_FROM:FROM,EMAIL:binding()}),true);
    assert.equal(mail.mailConfigured({MAIL_FROM:FROM}),false);
    assert.equal(mail.mailConfigured({EMAIL:binding()}),false);
    assert.equal(mail.mailConfigured({MAIL_FROM:FROM,RESEND_API_KEY:'re_x'}),false,'a Resend key does not switch provider by itself');
  });
  test('Resend stays selectable; an unknown provider is not configured, and nothing is sent',async()=>{
    assert.equal(mail.mailConfigured({MAIL_PROVIDER:'resend',MAIL_FROM:FROM,RESEND_API_KEY:'re_x'}),true);
    assert.equal(mail.mailConfigured({MAIL_PROVIDER:'resned',MAIL_FROM:FROM,RESEND_API_KEY:'re_x',EMAIL:binding()}),false);
    assert.deepEqual(await mail.sendMail({},msg),{accepted:false,provider:'cloudflare',failure:'blocked',code:'MAIL_NOT_CONFIGURED'});
  });
  test('the status report names the provider and never a value',()=>{
    const s=adm.integrationStatus({MAIL_PROVIDER:'resend',MAIL_FROM:FROM,RESEND_API_KEY:'re_supersecret'}).mail;
    assert.deepEqual(s,{provider:'resend',configured:true,bindingPresent:false,keyPresent:true,from:FROM});
    assert.equal(JSON.stringify(s).includes('supersecret'),false);
  });
});
describe('Cloudflare adapter',()=>{
  test('sends text from the parsed sender and returns the message id',async()=>{
    const env=cf();const out=await mail.sendMail(env,msg);
    assert.deepEqual(out,{accepted:true,provider:'cloudflare',messageId:'cf-1'});
    assert.deepEqual(env.EMAIL.sent[0],{from:{name:'THE1500',email:'signin@mail.the1500.test'},to:'a@b.test',subject:'s',text:'t'});
    assert.equal(mail.parseSender('plain@x.test'),'plain@x.test');
    assert.deepEqual(mail.parseSender('"THE 1500" <a@x.test>'),{name:'THE 1500',email:'a@x.test'});
  });
  test('documented errors map to rejected, blocked or transient; unknown ones are retried',async()=>{
    const cases={E_RECIPIENT_SUPPRESSED:'rejected',E_RECIPIENT_NOT_ALLOWED:'rejected',E_SENDER_NOT_VERIFIED:'blocked',E_DAILY_LIMIT_EXCEEDED:'blocked',E_RATE_LIMIT_EXCEEDED:'blocked',E_ACCOUNT_SUSPENDED:'blocked',E_DELIVERY_FAILED:'transient',E_INTERNAL_SERVER_ERROR:'transient',E_NEW_THING:'transient'};
    for (const [code,failure] of Object.entries(cases)) assert.deepEqual(await mail.sendMail(cf(code),msg),{accepted:false,provider:'cloudflare',failure,code},code);
  });
  test('the local Workers simulator accepts the exact message the adapter builds',async()=>{
    const h=await freshDb();try{
      assert.ok(h.email,'EMAIL binding from wrangler.jsonc');
      const out=await mail.sendMail({MAIL_PROVIDER:'cloudflare',MAIL_FROM:FROM,EMAIL:h.email},msg);
      assert.equal(out.accepted,true,JSON.stringify(out));
    }finally{await h.dispose();}
  });
});
describe('flows through the adapter',()=>{
  let h,up;before(async()=>{h=await freshDb();up=await createUpstreams();});after(async()=>{await up.close();await h.dispose();});
  const envOf=(fail)=>({DB:h.db,PUBLIC_BASE_URL:'http://localhost:8799',...cf(fail)});
  test('one-use sign-in link on Cloudflare',async()=>{
    const env=envOf();await id.requestLoginLink(env,'Person@Acme.example',null,new Date(),'en');
    const token=env.EMAIL.sent[0].text.match(/token=([a-f0-9]{64})/)[1];
    assert.equal(env.EMAIL.sent[0].to,'person@acme.example');
    await id.consumeLoginLink(h.db,token);
    await assert.rejects(id.consumeLoginLink(h.db,token),e=>e.code==='INVALID_OR_EXPIRED_LINK');
  });
  test('without a provider sign-in says 503; a blocked provider says 503 and leaves no usable token',async()=>{
    await assert.rejects(id.requestLoginLink({DB:h.db,PUBLIC_BASE_URL:'http://localhost:8799'},'x@acme.example',null),e=>e.code==='MAIL_NOT_CONFIGURED');
    await assert.rejects(id.requestLoginLink(envOf('E_DAILY_LIMIT_EXCEEDED'),'quota@acme.example',null),e=>e.code==='MAIL_DELIVERY_UNAVAILABLE');
    assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM login_challenges WHERE email='quota@acme.example'`).first()).n,0);
  });
  test('a suppressed address gets the usual reply, no token, and an incident for administration',async()=>{
    await id.requestLoginLink(envOf('E_RECIPIENT_SUPPRESSED'),'gone@acme.example',null);
    assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM login_challenges WHERE email='gone@acme.example'`).first()).n,0);
    const row=await h.db.prepare(`SELECT details_json d FROM incidents WHERE kind='login_mail_rejected'`).first();assert.match(row.d,/gone@acme.example/);
  });
  const queue=async(kind='purchase_confirmed',company=null)=>{const k=crypto.randomUUID();await ops.queueNotification(h.db,kind,`${k}@acme.example`,'en',{subject:'s',text:'t'},k,company).run();return k;};
  const statusOf=k=>h.db.prepare(`SELECT status,attempts,provider,provider_message_id m,failure_code c FROM notifications WHERE dedupe_key=?`).bind(k).first();
  test('accepted notifications record provider and id',async()=>{
    const k=await queue();const r=await ops.flushNotifications(h.db,cf());assert.ok(r.sent>=1);
    const s=await statusOf(k);assert.equal(s.status,'sent');assert.equal(s.provider,'cloudflare');assert.match(s.m,/^cf-/);
  });
  test('a blocked provider stops the queue without spending attempts, and raises one incident',async()=>{
    const k=await queue();const k2=await queue();
    const r=await ops.flushNotifications(h.db,cf('E_DAILY_LIMIT_EXCEEDED'));assert.deepEqual(r,{sent:0,failed:0,skipped:false,blocked:true});
    await ops.flushNotifications(h.db,cf('E_DAILY_LIMIT_EXCEEDED'));
    assert.equal((await statusOf(k)).attempts,0);assert.equal((await statusOf(k2)).attempts,0);assert.equal((await statusOf(k)).status,'pending');
    assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM incidents WHERE kind='mail_provider_blocked'`).first()).n,1);
    assert.equal((await ops.flushNotifications(h.db,cf())).blocked,false);assert.equal((await statusOf(k)).status,'sent');
  });
  test('a refused address fails at once with its reason; a temporary failure keeps retrying up to the limit',async()=>{
    const k=await queue();await ops.flushNotifications(h.db,cf('E_RECIPIENT_SUPPRESSED'));
    const s=await statusOf(k);assert.equal(s.status,'failed');assert.equal(s.c,'E_RECIPIENT_SUPPRESSED');assert.equal(s.attempts,1);
    const t=await queue();await ops.flushNotifications(h.db,cf('E_INTERNAL_SERVER_ERROR'));assert.equal((await statusOf(t)).status,'pending');
    for(let i=0;i<4;i++)await ops.flushNotifications(h.db,cf('E_INTERNAL_SERVER_ERROR'));
    assert.equal((await statusOf(t)).status,'failed');
  });
  test('a reactivation notice that was refused does not start the 15 days',async()=>{
    const s=await seedCompany(h.db);const start=new Date('2026-11-04T00:00:00Z');
    await h.db.prepare(`INSERT INTO onboarding_cases(company_id,origin,status,started_at,form_due_at,extension_due_at,reactivation_due_at) VALUES(?,'paid','reactivation_approved',?,?,?,?)`).bind(s.companyId,start.toISOString(),start.toISOString(),start.toISOString(),start.toISOString()).run();
    const k=await queue('reactivation_approved',s.companyId);
    await ops.flushNotifications(h.db,cf('E_RECIPIENT_SUPPRESSED'));
    assert.equal((await statusOf(k)).status,'failed');
    assert.equal((await h.db.prepare(`SELECT status FROM onboarding_cases WHERE company_id=?`).bind(s.companyId).first()).status,'reactivation_approved');
  });
  test('switching to Resend needs no change in the flows',async()=>{
    const env={DB:h.db,PUBLIC_BASE_URL:'http://localhost:8799',MAIL_PROVIDER:'resend',RESEND_API_KEY:'re_test',MAIL_FROM:FROM,RESEND_API_BASE:up.base};
    await id.requestLoginLink(env,'res@acme.example',null);
    assert.match(up.state.emails.at(-1).text,/token=[a-f0-9]{64}/);
  });
});
