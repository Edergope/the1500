// ADMIN-002: provider credentials sealed in D1, the panel's controls and their limits. Local D1 with migration 0012.
const {test,describe,before,after}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const crypto=require('node:crypto');
const {freshDb,seedCompany,ROOT}=require('../support/d1.cjs');
const core=p=>require(`../../.core-js-tests/core/${p}.js`);
const sec=core('secrets'),int=core('integrations'),llm=core('llm'),stripe=core('stripe'),mail=core('mail');
const NOW=new Date('2026-11-06T10:00:00.000Z');
const later=ms=>new Date(NOW.getTime()+ms);
const MASTER=crypto.randomBytes(32).toString('base64');
// 0012 waited in db/pending until its own deploy (DEPLOY-002, phase C); the tests work with it in either place.
const MIGRATED=fs.existsSync(path.join(ROOT,'db/migrations/0012_admin002_integrations.sql'));
const PENDING=fs.readFileSync(path.join(ROOT,MIGRATED?'db/migrations':'db/pending','0012_admin002_integrations.sql'),'utf8').replace(/--.*$/gm,'');
// Fictitious values in each provider's format. None of them works anywhere.
const KEYS={anthropic:'sk-ant-test0000fictitious0000value9f3a',stripe:'sk_test_fictitious0000value0000b7c2',whsec:'whsec_fictitious0000value0000d41e',
  mp:'TEST-0000000000000000-110600-fictitious00000000000000000000-111111111',mpPublic:'TEST-fictitious-0000-0000-public',resend:'re_fictitious0000value_e5f1'};
const apply0012=async db=>{
  if (await db.prepare(`SELECT 1 FROM sqlite_master WHERE name='provider_settings'`).first()) return;
  await db.batch(PENDING.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
};
/** A database as it was before 0012, to check that the Worker configuration stays in charge there. */
const without0012=db=>db.batch(['DROP TABLE IF EXISTS integration_choices','DROP TABLE IF EXISTS ai_function_config','DROP TABLE IF EXISTS provider_settings',
  'DROP TABLE IF EXISTS provider_credentials','DROP TABLE IF EXISTS reauth_challenges'].map(s=>db.prepare(s)));
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');

/** A signed-in administrator with a session cookie, as the browser would send it. */
async function admin(db,email='owner@the1500.test'){
  const s=await seedCompany(db,{email});const opaque=crypto.randomBytes(32).toString('hex');const sid=crypto.randomUUID();
  await db.batch([db.prepare(`INSERT INTO sessions(id,user_id,token_digest,expires_at) VALUES(?,?,?,?)`).bind(sid,s.userId,sha(opaque),later(864e5).toISOString()),
    db.prepare(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,'test')`).bind(s.userId,NOW.toISOString())]);
  const request=()=>new Request('https://the1500.test/api/v1/admin/integrations/credential',{method:'POST',headers:{cookie:`__Host-the1500_session=${opaque}`}});
  return {id:s.userId,email,sid,request};
}
/** One fake upstream for Anthropic, Stripe and Mercado Pago. Records every request it receives. */
function upstream(){
  const seen=[];let behaviour={};
  const server=http.createServer((req,res)=>{
    seen.push({method:req.method,url:req.url,auth:req.headers['x-api-key']||req.headers.authorization||null,bearer:req.headers.authorization||null});
    const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
    if (req.url.startsWith('/v1/models/')) return behaviour.anthropic===401?send(401,{type:'error',error:{type:'authentication_error',message:`bad key ${req.headers['x-api-key']}`}})
      :send(200,{type:'model',id:decodeURIComponent(req.url.slice(11)),display_name:'Model',created_at:'2026-01-01T00:00:00Z'});
    if (req.url==='/v1/balance') return send(200,{object:'balance',livemode:behaviour.live??false});
    if (req.url.startsWith('/v1/webhook_endpoints')) return send(200,{data:behaviour.endpoints??[]});
    if (req.url==='/users/me') return send(200,{id:1,site_id:behaviour.site??'MCO'});
    send(404,{});
  });
  return new Promise(r=>server.listen(0,'127.0.0.1',()=>r({base:`http://127.0.0.1:${server.address().port}`,seen,set:b=>{behaviour=b;},close:()=>new Promise(c=>server.close(c))})));
}
function mailbox(){const sent=[];return {sent,EMAIL:{send:async m=>{sent.push(m);return {messageId:`m${sent.length}`};}}};}
/** Everything in the database as text, to look for a value that must not be there. */
async function everything(db){
  const tables=(await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '%fts%'`).all()).results.map(r=>r.name);
  let out='';for (const t of tables) out+=JSON.stringify((await db.prepare(`SELECT * FROM "${t}"`).all()).results);return out;
}
const reasons={reasonCode:'initial_setup',evidence:'Owner request in chat'};

describe('envelope encryption',()=>{
  const env={SECRETS_MASTER_KEY:MASTER};
  test('a sealed value opens only with its master key and its own row',async()=>{
    const aad=sec.credentialAad('anthropic','default','api_key',1);
    const a=await sec.sealSecret(env,aad,KEYS.anthropic),b=await sec.sealSecret(env,aad,KEYS.anthropic);
    assert.equal(await sec.openSecret(env,aad,a),KEYS.anthropic);
    assert.notEqual(a.ciphertext,b.ciphertext,'a fresh key and IV on every write');assert.notEqual(a.iv,b.iv);
    assert.ok(!JSON.stringify(a).includes(KEYS.anthropic.slice(8)));
    await assert.rejects(sec.openSecret(env,sec.credentialAad('anthropic','default','api_key',2),a),e=>e.code==='CREDENTIAL_UNREADABLE','another version');
    await assert.rejects(sec.openSecret(env,sec.credentialAad('resend','default','api_key',1),a),e=>e.code==='CREDENTIAL_UNREADABLE','another provider');
    await assert.rejects(sec.openSecret({SECRETS_MASTER_KEY:crypto.randomBytes(32).toString('base64')},aad,a),e=>e.code==='CREDENTIAL_UNREADABLE','another master key');
    const tampered={...a,ciphertext:Buffer.from(Buffer.from(a.ciphertext,'base64').map((x,i)=>i===0?x^1:x)).toString('base64')};
    await assert.rejects(sec.openSecret(env,aad,tampered),e=>e.code==='CREDENTIAL_UNREADABLE','tampering is detected');
  });
  test('without a valid master key nothing is sealed',async()=>{
    assert.equal(sec.masterKeyState({}),'missing');assert.equal(sec.masterKeyState({SECRETS_MASTER_KEY:'c2hvcnQ='}),'invalid');
    await assert.rejects(sec.sealSecret({},'x','v'),e=>e.code==='MASTER_KEY_MISSING');
    await assert.rejects(sec.sealSecret({SECRETS_MASTER_KEY:'c2hvcnQ='},'x','v'),e=>e.code==='MASTER_KEY_INVALID');
  });
});

describe('before migration 0012',()=>{
  let h;before(async()=>{h=await freshDb();await without0012(h.db);int.forgetIntegrationsCache();});after(()=>h.dispose());
  test('the Worker configuration stays in charge and the panel says the migration is pending',async()=>{
    const env={DB:h.db,AI_PROVIDER:'anthropic',AI_API_KEY:'worker-key',AI_MODEL:'claude-opus-5-5',SECRETS_MASTER_KEY:MASTER};
    assert.deepEqual(await int.runtimeEnv(env,{ai:'profile_generation',mail:true,stripe:true}),env);
    const view=await int.getIntegrationsView(env,null,NOW);
    assert.equal(view.migration,'pending');assert.equal(view.providers.find(p=>p.id==='anthropic').source,'worker');
    const a=await admin(h.db);
    await assert.rejects(int.saveCredential(env,a.id,{provider:'anthropic',name:'api_key',value:KEYS.anthropic,...reasons},NOW),e=>e.code==='INTEGRATIONS_NOT_MIGRATED');
  });
  test('0012 lives in exactly one place, so it is applied once',()=>{
    assert.notEqual(fs.existsSync(path.join(ROOT,'db/migrations/0012_admin002_integrations.sql')),fs.existsSync(path.join(ROOT,'db/pending/0012_admin002_integrations.sql')));
  });
});

describe('credentials from the panel',()=>{
  let h,a,env,box,up;
  before(async()=>{h=await freshDb();await apply0012(h.db);int.forgetIntegrationsCache();a=await admin(h.db);box=mailbox();up=await upstream();
    env={DB:h.db,SECRETS_MASTER_KEY:MASTER,PUBLIC_BASE_URL:'https://the1500.test',MAIL_PROVIDER:'cloudflare',MAIL_FROM:'THE1500 <no-reply@the1500.test>',EMAIL:box.EMAIL,
      AI_BASE_URL:up.base,STRIPE_API_BASE:up.base,MERCADOPAGO_API_BASE:up.base,PAYMENTS_ENABLED:'false'};});
  after(async()=>{await up.close();await h.dispose();});

  test('a credential is stored sealed, shown only by its last four characters, and never in the audit trail',async()=>{
    const saved=await int.saveCredential(env,a.id,{provider:'anthropic',name:'api_key',value:KEYS.anthropic,...reasons},NOW);
    assert.deepEqual({v:saved.version,l:saved.last4},{v:1,l:KEYS.anthropic.slice(-4)});
    const view=await int.getIntegrationsView(env,a.request(),NOW);
    const p=view.providers.find(x=>x.id==='anthropic');
    assert.equal(p.credentials[0].last4,KEYS.anthropic.slice(-4));assert.equal(p.enabled,false,'saving does not switch it on');
    assert.ok(!JSON.stringify(view).includes(KEYS.anthropic),'the view never carries the value');
    const all=await everything(h.db);
    assert.ok(!all.includes(KEYS.anthropic),'no table holds the value in clear');
    assert.ok(!all.includes(KEYS.anthropic.slice(7,-4)),'nor a recognisable part of it');
    const events=(await h.db.prepare(`SELECT action,details_json FROM admin_events WHERE subject_type='integration'`).all()).results;
    assert.deepEqual(events.map(e=>e.action),['integration_credential_saved']);
  });
  test('replacing keeps one active value; the old one is retired, not reused',async()=>{
    const second='sk-ant-test1111fictitious1111value7e2b';
    const saved=await int.saveCredential(env,a.id,{provider:'anthropic',name:'api_key',value:second,...reasons},later(1000));
    assert.equal(saved.version,2);assert.equal(saved.replaced,true);
    const rows=(await h.db.prepare(`SELECT version,status FROM provider_credentials WHERE provider='anthropic' ORDER BY version`).all()).results;
    assert.deepEqual(rows,[{version:1,status:'replaced'},{version:2,status:'active'}]);
    await assert.rejects(h.db.prepare(`UPDATE provider_credentials SET status='active' WHERE version=1 AND provider='anthropic'`).run(),'two active values are impossible');
  });
  test('formats, live keys, notes that carry the value, and providers without an adapter are refused',async()=>{
    const refuse=(input,code)=>assert.rejects(int.saveCredential(env,a.id,{...reasons,...input},NOW),e=>e.code===code,code);
    await refuse({provider:'stripe',name:'secret_key',value:'sk_live_0000000000000000000000'},'LIVE_KEY_REFUSED');
    await refuse({provider:'stripe',name:'secret_key',value:'pk_test_0000000000000000'},'CREDENTIAL_FORMAT_INVALID');
    await refuse({provider:'anthropic',name:'api_key',value:'sk-ant-has space 0000000000000000000'},'CREDENTIAL_FORMAT_INVALID');
    await refuse({provider:'openai',name:'api_key',value:'sk-0000000000000000000000'},'ADAPTER_NOT_AVAILABLE');
    await refuse({provider:'gemini',name:'api_key',value:'AIza000000000000000000000'},'ADAPTER_NOT_AVAILABLE');
    await refuse({provider:'anthropic',name:'secret_key',value:KEYS.anthropic},'UNKNOWN_CREDENTIAL');
    await refuse({provider:'anthropic',name:'api_key',value:KEYS.anthropic,evidence:`rotated ${KEYS.anthropic}`},'SECRET_IN_EVIDENCE');
    await refuse({provider:'anthropic',name:'api_key',value:KEYS.anthropic,reasonCode:'x'},'REVIEW_EVIDENCE_REQUIRED');
    await assert.rejects(int.saveCredential({...env,SECRETS_MASTER_KEY:undefined},a.id,{provider:'anthropic',name:'api_key',value:KEYS.anthropic,...reasons},NOW),e=>e.code==='MASTER_KEY_MISSING');
  });

  test('Anthropic: model, explicit check, then on; the AI functions run on what the panel chose',async()=>{
    await assert.rejects(int.setProviderEnabled(env,a.id,{provider:'anthropic',enabled:true,...reasons},NOW),e=>e.code==='CONNECTION_NOT_VERIFIED');
    await assert.rejects(int.testConnection(env,a.id,{provider:'anthropic'},NOW),e=>e.code==='MODEL_NOT_SELECTED');
    await assert.rejects(int.saveProviderSettings(env,a.id,{provider:'anthropic',settings:{model:'gpt-5'},...reasons},NOW),e=>e.code==='MODEL_NOT_SUPPORTED');
    await int.saveProviderSettings(env,a.id,{provider:'anthropic',settings:{model:'claude-sonnet-5-5'},...reasons},NOW);
    up.set({anthropic:401});
    const bad=await int.testConnection(env,a.id,{provider:'anthropic'},NOW);
    assert.deepEqual({ok:bad.ok,code:bad.code},{ok:false,code:'HTTP_401'});
    assert.ok(!JSON.stringify(bad).includes('bad key'),'the provider message is not echoed');
    await assert.rejects(int.setProviderEnabled(env,a.id,{provider:'anthropic',enabled:true,...reasons},NOW),e=>e.code==='CONNECTION_NOT_VERIFIED');
    up.set({});
    const good=await int.testConnection(env,a.id,{provider:'anthropic'},later(2000));
    assert.equal(good.ok,true);assert.equal(up.seen.at(-1).url,'/v1/models/claude-sonnet-5-5');
    // SDK 1.x sends the key as a bearer token; it must be the active, decrypted one and nothing else.
    assert.equal(up.seen.at(-1).bearer,'Bearer sk-ant-test1111fictitious1111value7e2b');
    let run=await int.runtimeEnv({...env,AI_API_KEY:'worker-key',AI_PROVIDER:'anthropic'},{ai:'profile_generation'});
    assert.equal(run.AI_API_KEY,undefined,'governed by the panel and still off: no AI, not the Worker key');
    assert.equal(llm.getLlmProvider(run),null);
    await int.setProviderEnabled(env,a.id,{provider:'anthropic',enabled:true,...reasons},later(3000));
    await int.setAiFunction(env,a.id,{function:'assistant',provider:'anthropic',model:'claude-opus-5-5',...reasons},later(3000));
    await assert.rejects(int.setAiFunction(env,a.id,{function:'assistant',provider:'openai',model:'claude-opus-5-5',...reasons},NOW),e=>e.code==='ADAPTER_NOT_AVAILABLE');
    await assert.rejects(int.setAiFunction(env,a.id,{function:'translation',provider:'anthropic',model:'claude-opus-5-5',...reasons},NOW),e=>e.code==='UNKNOWN_FUNCTION');
    run=await int.runtimeEnv(env,{ai:'profile_generation'});
    const profile=llm.getLlmProvider(run);assert.equal(profile.name,'anthropic');assert.equal(profile.model,'claude-sonnet-5-5','profiles use the provider default');
    assert.equal(llm.getLlmProvider(await int.runtimeEnv(env,{ai:'assistant'})).model,'claude-opus-5-5','the assistant uses its own model');
    assert.equal((await int.runtimeEnv(env,{mail:true})).AI_API_KEY,undefined,'a request opens only what it uses');
    await int.setProviderEnabled(env,a.id,{provider:'anthropic',enabled:false,...reasons},later(4000));
    assert.equal(llm.getLlmProvider(await int.runtimeEnv(env,{ai:'profile_generation'})),null,'off means off');
    await int.setProviderEnabled(env,a.id,{provider:'anthropic',enabled:true,...reasons},later(4500));
    await int.disableCredential(env,a.id,{provider:'anthropic',name:'api_key',...reasons},later(5000));
    assert.equal((await int.getIntegrationsView(env,null,NOW)).providers.find(p=>p.id==='anthropic').enabled,false,'no key, so it switches off');
  });

  test('Stripe: test keys only, webhook checked, sandbox switched on, and no live charge possible',async()=>{
    await int.saveCredential(env,a.id,{provider:'stripe',name:'secret_key',value:KEYS.stripe,...reasons},NOW);
    await assert.rejects(int.testConnection(env,a.id,{provider:'stripe'},NOW),e=>e.code==='CREDENTIALS_INCOMPLETE');
    await int.saveCredential(env,a.id,{provider:'stripe',name:'webhook_secret',value:KEYS.whsec,...reasons},NOW);
    up.set({endpoints:[]});
    assert.equal((await int.testConnection(env,a.id,{provider:'stripe'},later(1000))).code,'WEBHOOK_MISSING');
    const url='https://the1500.test/api/v1/webhooks/stripe';
    up.set({endpoints:[{url,status:'enabled',enabled_events:['checkout.session.completed']}]});
    const partial=await int.testConnection(env,a.id,{provider:'stripe'},later(1000));
    assert.equal(partial.code,'WEBHOOK_EVENTS_MISSING');assert.ok(partial.detail.missing.includes('charge.refunded'));
    up.set({live:true});
    assert.equal((await int.testConnection(env,a.id,{provider:'stripe'},later(1000))).code,'LIVE_MODE');
    up.set({endpoints:[{url,status:'enabled',enabled_events:int.STRIPE_WEBHOOK_EVENTS}]});
    const ok=await int.testConnection(env,a.id,{provider:'stripe'},later(2000));
    assert.equal(ok.ok,true);assert.equal(ok.detail.secretMatch,'unverifiable','the signing secret is proven only by a signed event');
    assert.equal(stripe.paymentsGate(await int.runtimeEnv(env,{stripe:true})).code,'PAYMENTS_DISABLED','stored and verified, still off');
    await int.setProviderEnabled(env,a.id,{provider:'stripe',enabled:true,...reasons},later(3000));
    const run=await int.runtimeEnv(env,{stripe:true});
    assert.deepEqual(stripe.paymentsGate(run),{ok:true,mode:'test'});assert.equal(run.STRIPE_SECRET_KEY,KEYS.stripe);
    assert.equal(stripe.paymentsGate({...run,STRIPE_SECRET_KEY:'sk_live_x'}).code,'LIVE_PAYMENTS_NOT_AUTHORIZED','the gate refuses live keys whatever the panel says');
    await int.setProviderEnabled(env,a.id,{provider:'stripe',enabled:false,...reasons},later(4000));
    assert.equal(stripe.paymentsGate(await int.runtimeEnv(env,{stripe:true})).ok,false);
  });

  test('Mercado Pago: credentials, country and currency, account checked, but it cannot be switched on before PAY-002',async()=>{
    await assert.rejects(int.saveProviderSettings(env,a.id,{provider:'mercadopago',settings:{country:'US'},...reasons},NOW),e=>e.code==='COUNTRY_NOT_SUPPORTED');
    const s=await int.saveProviderSettings(env,a.id,{provider:'mercadopago',settings:{country:'co',currency:'USD'},...reasons},NOW);
    assert.deepEqual(s.settings,{country:'CO',currency:'COP'},'the currency follows the country');
    await int.saveCredential(env,a.id,{provider:'mercadopago',name:'access_token',value:KEYS.mp,...reasons},NOW);
    up.set({site:'MLM'});
    assert.equal((await int.testConnection(env,a.id,{provider:'mercadopago'},later(1000))).code,'COUNTRY_MISMATCH');
    up.set({site:'MCO'});
    const ok=await int.testConnection(env,a.id,{provider:'mercadopago'},later(2000));
    assert.equal(ok.ok,true);assert.equal(ok.detail.transactional,'pending_pay_002');
    await assert.rejects(int.setProviderEnabled(env,a.id,{provider:'mercadopago',enabled:true,...reasons},later(3000)),e=>e.code==='ADAPTER_NOT_AVAILABLE');
    const p=(await int.getIntegrationsView(env,null,NOW)).providers.find(x=>x.id==='mercadopago');
    assert.equal(p.adapter,false);assert.equal(p.enabled,false);
  });

  test('email: a test message is "accepted", never "delivered"; a provider is chosen only after one',async()=>{
    await assert.rejects(int.selectMailProvider(env,a.id,{provider:'cloudflare_email',...reasons},NOW),e=>e.code==='MAIL_TEST_REQUIRED');
    const sent=await int.sendTestEmail(env,{id:a.id,email:a.email},{provider:'cloudflare_email'},NOW);
    assert.equal(sent.code,'ACCEPTED');assert.equal(sent.detail.delivery,'not_confirmed');assert.equal(box.sent.at(-1).to,a.email,'only to the administrator');
    await int.selectMailProvider(env,a.id,{provider:'cloudflare_email',...reasons},later(1000));
    assert.equal((await int.runtimeEnv(env,{mail:true})).MAIL_PROVIDER,'cloudflare');
    await assert.rejects(int.saveProviderSettings(env,a.id,{provider:'resend',settings:{from:'not an address'},...reasons},NOW),e=>e.code==='INVALID_SENDER');
    await int.saveProviderSettings(env,a.id,{provider:'resend',settings:{from:'THE1500 <hola@the1500.test>'},...reasons},NOW);
    await int.saveCredential(env,a.id,{provider:'resend',name:'api_key',value:KEYS.resend,...reasons},NOW);
    const failing=await int.sendTestEmail({...env,RESEND_API_BASE:`${up.base}/nowhere`},{id:a.id,email:a.email},{provider:'resend'},later(2000));
    assert.equal(failing.ok,false);
    await assert.rejects(int.selectMailProvider(env,a.id,{provider:'resend',...reasons},later(3000)),e=>e.code==='MAIL_TEST_REQUIRED');
    assert.equal((await int.runtimeEnv(env,{mail:true})).MAIL_PROVIDER,'cloudflare','a failed test changes nothing');
    await assert.rejects(int.setProviderEnabled(env,a.id,{provider:'resend',enabled:true,...reasons},NOW),e=>e.code==='USE_MAIL_SELECTION');
  });

  test('history records each change with who, when and why, and no value',async()=>{
    const view=await int.getIntegrationsView(env,null,NOW);
    assert.ok(view.history.length>=10);
    assert.ok(view.history.every(e=>e.actor===a.email));
    const text=JSON.stringify((await h.db.prepare(`SELECT * FROM admin_events`).all()).results);
    for (const v of Object.values(KEYS)) assert.ok(!text.includes(v),'no credential in admin_events');
  });
});

describe('re-authentication for critical changes',()=>{
  let h,a,b,env,box;
  before(async()=>{h=await freshDb();await apply0012(h.db);int.forgetIntegrationsCache();a=await admin(h.db);b=await admin(h.db,'second@the1500.test');box=mailbox();
    env={DB:h.db,SECRETS_MASTER_KEY:MASTER,PUBLIC_BASE_URL:'https://the1500.test',MAIL_FROM:'THE1500 <no-reply@the1500.test>',EMAIL:box.EMAIL};});
  after(()=>h.dispose());
  const tokenFrom=m=>new URL(m.text.match(/https:\/\/\S+/)[0]).searchParams.get('token');

  test('a session is not re-authenticated until the emailed link is confirmed in it',async()=>{
    await assert.rejects(int.requireRecentReauth(h.db,a.request(),NOW),e=>e.code==='REAUTH_REQUIRED'&&e.httpStatus===403);
    const sent=await int.requestReauth(env,{id:a.id,email:a.email},'es',NOW);
    assert.equal(sent.sentTo,a.email);assert.equal(box.sent.at(-1).to,a.email);
    assert.ok(box.sent.at(-1).text.includes('/es/admin/reautenticar?token='));
    const token=tokenFrom(box.sent.at(-1));
    const stored=await everything(h.db);assert.ok(!stored.includes(token),'only the digest of the link is stored');
    await assert.rejects(int.confirmReauth(h.db,b.request(),{id:b.id,email:b.email},token,NOW),e=>e.code==='INVALID_OR_EXPIRED_LINK','another administrator cannot use it');
    const ok=await int.confirmReauth(h.db,a.request(),{id:a.id,email:a.email},token,later(60_000));
    assert.equal(ok.reauthenticatedUntil,later(60_000+15*60_000).toISOString());
    await int.requireRecentReauth(h.db,a.request(),later(14*60_000));
    await assert.rejects(int.requireRecentReauth(h.db,a.request(),later(17*60_000)),e=>e.code==='REAUTH_REQUIRED','it lasts 15 minutes');
    await assert.rejects(int.confirmReauth(h.db,a.request(),{id:a.id,email:a.email},token,later(70_000)),e=>e.code==='INVALID_OR_EXPIRED_LINK','single use');
    assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM admin_events WHERE action='admin_reauthenticated'`).first()).n,1,'only the valid confirmation is recorded');
  });
  test('links expire after 15 minutes, requests are limited, and a refused email leaves no live link',async()=>{
    await int.requestReauth(env,{id:b.id,email:b.email},'en',NOW);
    await assert.rejects(int.confirmReauth(h.db,b.request(),{id:b.id,email:b.email},tokenFrom(box.sent.at(-1)),later(16*60_000)),e=>e.code==='INVALID_OR_EXPIRED_LINK');
    await int.requestReauth(env,{id:b.id,email:b.email},'en',later(1000));await int.requestReauth(env,{id:b.id,email:b.email},'en',later(2000));
    await assert.rejects(int.requestReauth(env,{id:b.id,email:b.email},'en',later(3000)),e=>e.code==='TOO_MANY_REQUESTS');
    const refusing={...env,EMAIL:{send:async()=>{throw Object.assign(new Error('x'),{code:'E_SENDER_NOT_VERIFIED'});}}};
    const c=await admin(h.db,'third@the1500.test');
    await assert.rejects(int.requestReauth(refusing,{id:c.id,email:c.email},'en',NOW),e=>e.code==='MAIL_DELIVERY_UNAVAILABLE');
    assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM reauth_challenges WHERE user_id=?`).bind(c.id).first()).n,0);
  });
  test('the API puts every change behind re-authentication; checks are not changes',()=>{
    const dir=path.join(ROOT,'src/pages/api/v1/admin/integrations');const route=f=>fs.readFileSync(path.join(dir,f),'utf8');
    for (const f of ['credential','credential-disable','enable','settings','ai-function','mail-select']) assert.match(route(`${f}.ts`),/criticalAdminPost\(/,`${f} needs re-authentication`);
    for (const f of ['test','mail-test']) assert.match(route(`${f}.ts`),/adminPost\(/,`${f} still needs an administrator`);
    assert.equal(fs.readdirSync(dir).length,9,'no endpoint here escapes this list');
    const http=fs.readFileSync(path.join(ROOT,'src/core/http.ts'),'utf8');
    assert.match(http,/criticalAdminPost[\s\S]*adminPost\(db,async context=>\{await requireRecentReauth/,'the administrator guard comes first, then re-authentication');
  });
});

describe('nothing secret leaves the server',()=>{
  test('no page or component imports the module that opens credentials, and no log line carries a value',()=>{
    const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
    for (const f of walk(path.join(ROOT,'src')).filter(f=>/\.(astro|tsx?)$/.test(f))) {
      const text=fs.readFileSync(f,'utf8');
      if (/src\/(components|ui)\//.test(f)&&!f.endsWith('.astro')) assert.ok(!/core\/(secrets|integrations)/.test(text),`${f} runs in the browser`);
      assert.ok(!/console\.(log|error|warn)\([^)]*(value|plaintext|apiKey|AI_API_KEY|STRIPE_SECRET_KEY|RESEND_API_KEY)/.test(text),`${f} logs a secret`);
    }
  });
});
