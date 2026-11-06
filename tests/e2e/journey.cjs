// Acceptance journey (CORE-005 section 11) through real HTTP on the built Worker in workerd, with persistent
// local D1 and R2. Email, LLM and Stripe are local stand-ins: see tests/support/upstreams.cjs.
const {spawn,execFileSync}=require('node:child_process');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
const {createUpstreams,signedEvent,WEBHOOK_SECRET}=require('../support/upstreams.cjs');
const ROOT=path.join(__dirname,'../..');const WR=path.join(ROOT,'node_modules/.bin/wrangler');
const PORT=Number(process.env.E2E_PORT||8791);const BASE=`http://localhost:${PORT}`;
const persist=fs.mkdtempSync(path.join(os.tmpdir(),'the1500-e2e-'));
const log=[];const step=(s,d='')=>{const l=`PASS  ${s}${d?`  →  ${d}`:''}`;log.push(l);console.log(l);};
const sh=(...args)=>execFileSync(WR,args,{cwd:ROOT,stdio:'pipe',env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}}).toString();
const sql=c=>JSON.parse(sh('d1','execute','DB','--local','--persist-to',persist,'--json','--command',c)).at(-1).results;
let up,proc;
async function startWorker(){
  const vars={PUBLIC_BASE_URL:BASE,MAIL_FROM:'THE1500 <signin@the1500.test>',MAIL_PROVIDER:'resend',RESEND_API_KEY:'re_test',RESEND_API_BASE:up.base,
    PAYMENTS_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_e2e',STRIPE_WEBHOOK_SECRET:WEBHOOK_SECRET,STRIPE_API_BASE:up.base,
    AI_PROVIDER:'anthropic',AI_API_KEY:'test',AI_BASE_URL:up.base};
  const args=['dev','--config','dist/server/wrangler.json','--port',String(PORT),'--persist-to',persist,'--test-scheduled','--show-interactive-dev-session=false',...Object.entries(vars).flatMap(([k,v])=>['--var',`${k}:${v}`])];
  proc=spawn(WR,args,{cwd:ROOT,stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'},detached:true});
  let out='';proc.stdout.on('data',d=>out+=d);proc.stderr.on('data',d=>out+=d);
  for(let i=0;i<120;i++){try{const r=await fetch(`${BASE}/api/v1/public/stats`);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}
  throw new Error('worker did not start:\n'+out);
}
const stopWorker=()=>new Promise(res=>{if(!proc)return res();proc.on('exit',res);try{process.kill(-proc.pid,'SIGTERM');}catch{res();}setTimeout(res,3000);});
async function api(method,url,{cookie,body,headers={},origin=true}={}){
  const r=await fetch(BASE+url,{method,redirect:'manual',headers:{...(body?{'content-type':'application/json'}:{}),...(origin&&method!=='GET'?{Origin:BASE}:{}),...(cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:r.status,data,headers:r.headers};
}
let keyN=0;const idem=()=>({'Idempotency-Key':`e2e_idempotency_key_${String(++keyN).padStart(5,'0')}`});
/** ADMIN-OPS: irreversible actions need a re-authentication of the session through a link sent to the administrator's own mailbox. */
async function reauthenticate(cookie,email){
  const n=up.state.emails.length;
  const r=await api('POST','/api/v1/admin/reauth/request',{cookie,body:{locale:'en'}});assert.equal(r.status,200,JSON.stringify(r.data));
  const mail=up.state.emails.slice(n).find(m=>m.to[0]===email);assert.ok(mail,'re-authentication link sent to '+email);
  const token=mail.text.match(/token=([a-f0-9]{64})/)[1];
  assert.equal((await api('POST','/api/v1/admin/reauth/confirm',{cookie,body:{token}})).status,200);
}
async function login(email,locale='en'){
  const n=up.state.emails.length;
  const r=await api('POST','/api/v1/auth/request-link',{body:{email,locale}});assert.equal(r.status,202);
  const mail=up.state.emails.slice(n).find(m=>m.to[0]===email);assert.ok(mail,'email sent to '+email);
  const token=mail.text.match(/token=([a-f0-9]{64})/)[1];
  const page=await fetch(`${BASE}/auth/verify?token=${token}`);assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'same-origin','no-referrer makes browsers send Origin: null');
  const v=await fetch(`${BASE}/api/v1/auth/verify`,{method:'POST',redirect:'manual',headers:{Origin:BASE,'content-type':'application/x-www-form-urlencoded'},body:`token=${token}`});
  assert.equal(v.status,303);assert.equal(v.headers.get('location'),'/mi-cuenta');
  const c=v.headers.get('set-cookie');assert.match(c,/__Host-the1500_session=.*HttpOnly; Secure; SameSite=Lax/);
  return {cookie:c.split(';')[0],token};
}
const form=(over={})=>({language:'en',description:'We coordinate ocean freight and shipment visibility for US importers and logistics teams across the Atlantic.',
  descriptionEs:'Coordinamos fletes marítimos y visibilidad de envíos para importadores de Estados Unidos.',
  services:['Ocean freight coordination','Shipment visibility'],audiences:['Importers'],
  problemSolutions:[{problem:'Importers lack shipment status visibility',solution:'Consolidated container tracking updates'}],serviceCountries:['US','CO'],
  consent:{processingAuthorized:true,documentVersion:'consent-2026-11'},...over});
async function webhook(type,object,opts){const ev=signedEvent(type,object,opts);
  const r=await fetch(`${BASE}/api/v1/webhooks/stripe`,{method:'POST',headers:{'content-type':'application/json','stripe-signature':ev.signature},body:ev.body});
  return {status:r.status,data:await r.json(),ev};}
async function buy(owner,companyId){
  const h=await api('POST','/api/v1/orders/hold',{cookie:owner.cookie,body:{companyId},headers:idem()});assert.equal(h.status,201,JSON.stringify(h.data));
  const c=await api('POST','/api/v1/orders/checkout',{cookie:owner.cookie,body:{companyId,holdId:h.data.hold.holdId,acceptTerms:true,termsVersion:'terms-2026-11'},headers:idem()});assert.equal(c.status,201,JSON.stringify(c.data));
  const sessionId=c.data.checkoutUrl.split('/').pop();
  return {hold:h.data.hold,checkout:c.data,sessionId};
}
(async()=>{
  up=await createUpstreams();
  sh('d1','migrations','apply','DB','--local','--persist-to',persist);
  step('Real wrangler migrations applied to local D1');
  await startWorker();step('Built Worker running in workerd',BASE);
  // ---- Empty state and honesty
  const s0=await api('GET','/api/v1/public/stats');
  assert.equal(s0.data.capacity,1500);assert.equal(s0.data.available,1500);assert.equal(s0.data.salesMode,'selling');assert.equal(s0.data.currentPriceUsdCents,10000);
  step('Stats come from the database',`available=${s0.data.available}, tier=${s0.data.currentPhase}, mode=${s0.data.salesMode}`);
  for(const p of ['/','/unirse','/empresas','/es/','/es/unirse','/es/empresas','/login'])assert.equal((await fetch(BASE+p)).status,200,p);
  step('Public pages respond in EN and ES');
  // UX-003: the wall on the Home, and no phase that is not open yet.
  for(const [p,headline] of [['/','Take your place'],['/es/','Ocupa tu lugar']]){
    const home=await (await fetch(BASE+p)).text();assert.ok(home.includes(headline),p);
    const client=JSON.parse(home.match(/id="mosaic-data"[^>]*>([^<]*)</)[1]);assert.equal(client.map.length,1500,'one piece per position');
    assert.doesNotMatch(home,/FTS5|lifetime|vitalicia|private index|índice privado|self_declared|role: owner|founder badge/i,p);
    assert.doesNotMatch(home,/\$400|\$1,000|\$1\.000|\$5,066|\$5\.066|Fase 2|Phase 2|601|1,?351/,p);
  }
  // UX-004: every section down to the footer, with no legal page presented as if it existed.
  for(const [p,words] of [['/',['Behind the glass','Search by the problem','How it works','Publication terms','Terms of service: in preparation','Privacy policy: in preparation']],['/es/',['Detrás del vidrio','Busca por el problema','Cómo funciona','Condiciones de publicación','Términos de servicio: en preparación','Política de privacidad: en preparación']]]){
    const home=await (await fetch(BASE+p)).text();for(const w of words)assert.ok(home.includes(w),`${p} ${w}`);
    for(const id of ['explore','how-it-works','what-you-get','faq','availability'])assert.ok(home.includes(`id="${id}"`),`${p} ${id}`);
    assert.match(home,/action="[^"]*\/empresas" method="get"/,'search works without JavaScript');
  }
  assert.deepEqual(s0.data.phases.map(p=>p.phase),[1],'only the open phase is public');
  const phase1=s0.data.phases[0];assert.equal(phase1.reservedByInvitation,100);assert.equal(phase1.forSale,500);
  for(const p of ['/unirse','/es/unirse']){const join=await (await fetch(BASE+p)).text();assert.match(join,/id="terms"/,p);assert.match(join,/data-offer="(open|open_no_payment)"/,p);assert.doesNotMatch(join,/\$400|\$1,000|\$1\.000|\$5,066|\$5\.066|4-Tier|4 tramos/,p);}
  step('Home is the wall of 1,500; only the open phase and its price are public; no technical jargon');
  // ---- 1 Company registers
  const owner=await login('ana@oceanline.example');
  const again=await fetch(`${BASE}/api/v1/auth/verify`,{method:'POST',redirect:'manual',headers:{Origin:BASE,'content-type':'application/x-www-form-urlencoded'},body:`token=${owner.token}`});
  assert.equal(again.status,401);step('Magic link works once; raw token not reusable');
  // Found in the browser: the Spanish journey ended in English, and a stale link showed a JSON body.
  const nEs=up.state.emails.length;
  assert.equal((await api('POST','/api/v1/auth/request-link',{body:{email:'lucia@oceanline.example',locale:'es'}})).status,202);
  const esLink=up.state.emails.slice(nEs)[0].text.match(/\/auth\/verify\?[^\s]+/)[0];assert.match(esLink,/lang=es/);
  const esPage=await (await fetch(BASE+esLink)).text();assert.match(esPage,/Confirmar acceso/);assert.match(esPage,/name="lang" value="es"/);
  const esToken=esLink.match(/token=([a-f0-9]{64})/)[1];const form2=`token=${esToken}&lang=es`;const browser={Origin:BASE,'content-type':'application/x-www-form-urlencoded',accept:'text/html'};
  const esV=await fetch(`${BASE}/api/v1/auth/verify`,{method:'POST',redirect:'manual',headers:browser,body:form2});
  assert.equal(esV.status,303);assert.equal(esV.headers.get('location'),'/es/mi-cuenta');
  const esStale=await fetch(`${BASE}/api/v1/auth/verify`,{method:'POST',redirect:'manual',headers:browser,body:form2});
  assert.equal(esStale.status,303);assert.equal(esStale.headers.get('location'),'/es/login?expired=1');
  const esCookie=esV.headers.get('set-cookie').split(';')[0];
  const signedIn=await fetch(`${BASE}/es/login`,{redirect:'manual',headers:{cookie:esCookie}});assert.equal(signedIn.status,302);assert.match(signedIn.headers.get('location'),/\/es\/mi-cuenta$/);
  assert.match(await (await fetch(`${BASE}/es/`,{headers:{cookie:esCookie}})).text(),/Mi cuenta/);
  step('Spanish sign-in stays in Spanish; stale link returns to sign-in; signed-in visitor skips the form');
  const reg=await api('POST','/api/v1/registrations',{cookie:owner.cookie,body:{displayName:'Ocean Line LLC',country:'US',industry:'Ocean freight',website:'https://oceanline.example',declareAuthority:true}});
  assert.equal(reg.status,201);assert.equal(reg.data.identityState,'self_declared');const companyId=reg.data.id,slug=reg.data.slug;
  step('1. Company registered by verified corporate email',slug);
  // ---- Security on the way
  const stranger=await login('eve@evilcorp.example');
  assert.equal((await api('POST','/api/v1/orders/hold',{cookie:stranger.cookie,body:{companyId},headers:idem()})).status,403);
  assert.equal((await api('PUT','/api/v1/me/company/profile',{cookie:stranger.cookie,body:{companyId,...form()}})).status,403);
  assert.equal((await api('GET',`/api/v1/me/company?companyId=${companyId}`,{cookie:stranger.cookie})).status,403);
  assert.equal((await api('POST','/api/v1/orders/hold',{body:{companyId},headers:idem()})).status,401);
  assert.equal((await api('POST','/api/v1/orders/hold',{cookie:owner.cookie,body:{companyId},headers:{...idem(),Origin:'https://evil.example'}})).status,403);
  assert.equal((await api('GET','/api/v1/admin/overview',{cookie:owner.cookie})).status,403);
  const es=await api('GET','/api/v1/admin/overview',{headers:{'Accept-Language':'es-CO'}});
  assert.equal(es.status,401);assert.equal(es.data.error.message,'Inicia sesión.');assert.equal(es.data.error.locale,'es');
  const en=await api('GET','/api/v1/admin/overview');assert.equal(en.data.error.message,'Please sign in.');
  step('T07 another user cannot touch a company; no session 401; foreign origin 403; non-admin 403');
  step('T13 API errors localized','en: Please sign in. / es: Inicia sesión.');
  // ---- 2 Buys a position
  const first=await buy(owner,companyId);
  assert.equal(first.checkout.amount.totalMinor,10000);assert.equal('slotNumber' in first.hold,false);
  assert.equal((await api('GET',`/api/v1/me/company?companyId=${companyId}`,{cookie:owner.cookie})).data.position,null);
  const session=up.pay(first.sessionId);
  const badSig=await webhook('checkout.session.completed',session,{secret:'whsec_forged'});assert.equal(badSig.status,400);
  assert.equal((await api('GET',`/api/v1/me/company?companyId=${companyId}`,{cookie:owner.cookie})).data.position,null);
  step('T06 forged webhook rejected over HTTP; nothing assigned');
  const paid=await webhook('checkout.session.completed',session);assert.equal(paid.status,200);assert.equal(paid.data.outcome,'assigned');
  const dup=await fetch(`${BASE}/api/v1/webhooks/stripe`,{method:'POST',headers:{'content-type':'application/json','stripe-signature':paid.ev.signature},body:paid.ev.body});
  assert.equal((await dup.json()).duplicate,true);
  const status=await api('GET',`/api/v1/me/company?companyId=${companyId}`,{cookie:owner.cookie});
  assert.equal(status.data.position.position,101);assert.equal(status.data.onboarding.status,'active');
  step('2. Paid via signed webhook, duplicate ignored, position assigned',`position=${status.data.position.position}, form due ${status.data.onboarding.formDueAt.slice(0,10)}`);
  // ---- 3-4 Form and AI profile
  assert.equal((await api('PUT','/api/v1/me/company/profile',{cookie:owner.cookie,body:{companyId,...form(),consent:undefined}})).data.error.code,'CONSENT_REQUIRED');
  const draft=await api('PUT','/api/v1/me/company/profile',{cookie:owner.cookie,body:{companyId,...form()}});
  assert.equal(draft.status,201,JSON.stringify(draft.data));assert.equal(draft.data.generation.mode,'llm');assert.equal(draft.data.preview.canonical.provenance.descriptionEn.type,'ai_generated');
  step('3-4. Form submitted with consent; profile structured through the LLM adapter',`provider=${draft.data.generation.provider}, model=${draft.data.generation.model} [stand-in upstream]`);
  assert.equal((await fetch(`${BASE}/empresas/${slug}`)).status,404);
  assert.equal((await api('GET',`/api/v1/public/search?query=ocean+freight`)).data.count,0);
  // ---- T08
  assert.equal((await api('POST','/api/v1/me/company/publish',{cookie:owner.cookie,body:{companyId,version:draft.data.version}})).data.error.code,'PROFILE_NOT_APPROVED');
  step('T08 unapproved profile cannot be published; draft invisible to public and search');
  // ---- 5 Approval, 6 publication
  assert.equal((await api('POST','/api/v1/me/company/approve',{cookie:owner.cookie,body:{companyId,version:draft.data.version,contentDigest:draft.data.contentDigest}})).status,400);
  const appr=await api('POST','/api/v1/me/company/approve',{cookie:owner.cookie,body:{companyId,version:draft.data.version,contentDigest:draft.data.contentDigest,acceptPublicDisclosure:true}});
  assert.equal(appr.data.status,'owner_approved');step('5. Representative approved the exact content digest');
  const pubd=await api('POST','/api/v1/me/company/publish',{cookie:owner.cookie,body:{companyId,version:draft.data.version}});
  assert.equal(pubd.status,200,JSON.stringify(pubd.data));assert.equal(pubd.data.status,'published');
  step('6. Published',`correction until ${pubd.data.correctionWindowEndsAt.slice(0,10)}, guaranteed until ${pubd.data.guaranteeEndsAt.slice(0,10)}`);
  const html=await fetch(`${BASE}/empresas/${slug}`);const page=await html.text();assert.equal(html.status,200);
  assert.ok(page.includes('Ocean Line LLC'));assert.ok(page.includes('application/ld+json'));assert.ok(page.includes('Shipment visibility'));
  const ld=await fetch(`${BASE}/api/v1/public/companies/${slug}.json`);assert.match(ld.headers.get('content-type'),/application\/ld\+json/);
  const doc=await ld.json();assert.equal(doc['@graph'][0]['@type'],'Organization');assert.equal(doc['@graph'][0].identifier.value,101);
  const ldEs=await (await fetch(`${BASE}/api/v1/public/companies/${slug}.json?lang=es`)).json();assert.equal(ldEs['@graph'][1].inLanguage,'es');
  assert.ok((await fetch(`${BASE}/es/empresas/${slug}`)).status===200);
  const pubText=JSON.stringify(doc);for(const s of ['ana@oceanline',companyId,'stripe','founder'])assert.equal(pubText.includes(s),false,s);
  step('HTML and JSON-LD served publicly in EN and ES; no private data in the document');
  const localized=/Coordinamos fletes/;
  assert.match((await api('GET','/api/v1/public/companies?lang=es')).data.items[0].summary,localized);
  assert.match((await api('GET','/api/v1/public/search?query=ocean+freight&lang=es')).data.items[0].summary,localized);
  assert.doesNotMatch((await api('GET','/api/v1/public/companies')).data.items[0].summary,localized);
  assert.match(await (await fetch(`${BASE}/es/empresas`)).text(),localized);
  step('Directory and search summaries follow the visitor language');
  const exp=await api('GET',`/api/v1/me/company/export?companyId=${companyId}`,{cookie:owner.cookie});assert.equal(exp.data.exportedFormat,'the1500.semantic-profile.v2');
  step('Exportable semantic profile available to the owner');
  // ---- 7 Someone else searches a business problem
  const found=await api('GET',`/api/v1/public/search?query=${encodeURIComponent('importers cannot see shipment status')}`);
  assert.equal(found.data.items[0].slug,slug);assert.equal(found.data.retrieval.semantic,false);
  step('7. A visitor searching a business problem finds the company',`"importers cannot see shipment status" → ${found.data.items[0].name} (${found.data.retrieval.method})`);
  const dirList=await api('GET','/api/v1/public/companies?country=US&industry=freight&service=visibility');assert.equal(dirList.data.total,1);
  // ---- 8 Assistant cites the public profile
  const ask=await api('POST','/api/v1/public/ask',{body:{question:'Who helps importers with shipment visibility?',language:'en'}});
  assert.equal(ask.status,200,JSON.stringify(ask.data));assert.equal(ask.data.mode,'llm_grounded');
  const cite=ask.data.citations[0];assert.equal(cite.slug,slug);
  const cited=await fetch(BASE+cite.url);assert.equal(cited.status,200);assert.ok((await cited.text()).includes(cite.quote.split(':')[0].slice(0,20)));
  const citedLd=await (await fetch(BASE+cite.jsonldUrl)).text();
  const digest=require('node:crypto').createHash('sha256').update(citedLd).digest('hex');assert.equal(digest,cite.jsonldDigest);
  step('8. Assistant answered citing the public profile; digest of the cited JSON-LD verified',`"${ask.data.answer.slice(0,70)}…"`);
  const no=await api('POST','/api/v1/public/ask',{body:{question:'Which firm builds astronautic propulsion boosters?',language:'es'}});
  assert.equal(no.data.mode,'abstained');assert.deepEqual(no.data.citations,[]);assert.match(no.data.answer,/evidencia suficiente/);
  step('Assistant abstains when evidence is missing (ES)');
  // ---- Founder path, with an admin bootstrapped by SQL as documented
  const adminUser=await login('root@the1500.example');
  const adminId=sql(`SELECT id FROM users WHERE email='root@the1500.example'`)[0].id;
  sql(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES('${adminId}','2026-11-03T00:00:00.000Z','e2e')`);
  const fOwner=await login('rosa@andescargo.example','es');
  const fReg=await api('POST','/api/v1/registrations',{cookie:fOwner.cookie,body:{displayName:'Andes Cargo SAS',country:'CO',industry:'Logistics',website:'https://andescargo.example',declareAuthority:true}});
  const invite=await api('POST','/api/v1/admin/founder-invite',{cookie:adminUser.cookie,body:{companyId:fReg.data.id}});assert.equal(invite.status,201);
  const inv=await api('GET','/api/v1/me/founder-invitations',{cookie:fOwner.cookie});assert.equal(inv.data.invitations.length,1);
  assert.equal((await api('POST','/api/v1/me/founder-invitations/accept',{cookie:fOwner.cookie,body:{invitationId:invite.data.invitationId}})).data.error.code,'TERMS_REQUIRED');
  const acc=await api('POST','/api/v1/me/founder-invitations/accept',{cookie:fOwner.cookie,body:{invitationId:invite.data.invitationId,acceptTerms:true,termsVersion:'founder-2026-11'}});
  assert.equal(acc.data.status,'accepted');
  // Found in the browser: an accepted invitation vanished from the status, and the account offered to buy a position.
  assert.equal((await api('GET',`/api/v1/me/company?companyId=${fReg.data.id}`,{cookie:fOwner.cookie})).data.founderInvitation.status,'accepted');
  assert.equal((await api('POST','/api/v1/admin/founder-award',{cookie:fOwner.cookie,body:{invitationId:invite.data.invitationId,reasonCode:'selected',evidenceReference:'x'}})).status,403);
  assert.equal((await api('GET','/api/v1/admin/founder-award',{cookie:adminUser.cookie})).data.invitations.length,1);
  const early=await api('POST','/api/v1/admin/founder-award',{cookie:adminUser.cookie,body:{invitationId:invite.data.invitationId,reasonCode:'selected',evidenceReference:'selection-case-1'}});
  assert.equal(early.status,403);assert.equal(early.data.error.code,'REAUTH_REQUIRED','an award needs a fresh identity check');
  await reauthenticate(adminUser.cookie,'root@the1500.example');
  const awd=await api('POST','/api/v1/admin/founder-award',{cookie:adminUser.cookie,body:{invitationId:invite.data.invitationId,reasonCode:'selected',evidenceReference:'selection-case-1'}});
  assert.equal(awd.data.slotNumber,1);
  step('Founder path: invited, accepted with terms, then awarded by an admin in 1-100',`position=${awd.data.slotNumber}`);
  const fDraft=await api('PUT','/api/v1/me/company/profile',{cookie:fOwner.cookie,body:{companyId:fReg.data.id,...form({language:'es',description:'Coordinamos transporte terrestre de carga y despacho aduanero para exportadores de la región andina.',descriptionEs:undefined,services:['Transporte terrestre'],audiences:['Exportadores'],problemSolutions:[{problem:'Demoras en aduana',solution:'Despacho aduanero coordinado'}],serviceCountries:['CO']})}});
  await api('POST','/api/v1/me/company/approve',{cookie:fOwner.cookie,body:{companyId:fReg.data.id,version:fDraft.data.version,contentDigest:fDraft.data.contentDigest,acceptPublicDisclosure:true}});
  const fp=await api('POST','/api/v1/me/company/publish',{cookie:fOwner.cookie,body:{companyId:fReg.data.id,version:fDraft.data.version}});assert.equal(fp.data.status,'published');
  const pubFounder=await api('GET',`/api/v1/public/companies/${fReg.data.slug}`);assert.equal(JSON.stringify(pubFounder.data).toLowerCase().includes('founder'),false);
  step('Founder published with the same service; no founder marker in public data');
  // ---- Admin surface
  const ov=await api('GET','/api/v1/admin/overview',{cookie:adminUser.cookie});assert.equal(ov.data.foundersAssigned,1);
  for(const u of ['/api/v1/admin/inventory','/api/v1/admin/companies?scope=all','/api/v1/admin/companies','/api/v1/admin/incidents','/api/v1/admin/payments','/api/v1/admin/requests','/api/v1/admin/profiles','/api/v1/admin/premium/requests','/api/v1/admin/seller'])
    assert.equal((await api('GET',u,{cookie:adminUser.cookie})).status,200,u);
  const seller=await api('GET','/api/v1/admin/seller',{cookie:adminUser.cookie});assert.equal(seller.data.status,'unapproved');assert.equal(seller.data.legalName,null);
  step('Admin endpoints respond; seller is unset configuration','status=unapproved, legalName=null');
  // ---- T02 real HTTP concurrency
  // Sessions are seeded here: the sign-in limit (8 links per address in 15 minutes) correctly stops one test client.
  const crypto=require('node:crypto');const seeded=Array.from({length:12},(_,i)=>{const token=crypto.randomBytes(32).toString('hex');return {i,token,digest:crypto.createHash('sha256').update(token).digest('hex')};});
  sql(seeded.flatMap(b=>[`INSERT INTO users(id,email) VALUES('buyer${b.i}','b${b.i}@buyer${b.i}.example')`,
    `INSERT INTO sessions(id,user_id,token_digest,expires_at) VALUES('sess${b.i}','buyer${b.i}','${b.digest}','2030-01-01T00:00:00.000Z')`]).join(';'));
  const buyers=[];for(const b of seeded){const i=b.i;const c={cookie:`__Host-the1500_session=${b.token}`};
    const r=await api('POST','/api/v1/registrations',{cookie:c.cookie,body:{displayName:`Buyer ${i}`,country:'US',industry:'Services',website:`https://buyer${i}.example`,declareAuthority:true}});buyers.push({...c,companyId:r.data.id});}
  const holds=await Promise.all(buyers.map(b=>api('POST','/api/v1/orders/hold',{cookie:b.cookie,body:{companyId:b.companyId},headers:idem()})));
  assert.deepEqual(holds.map(h=>h.status),Array(12).fill(201));
  const heldRows=sql(`SELECT COUNT(*) n,COUNT(DISTINCT number) d FROM slots WHERE status='held'`)[0];assert.equal(heldRows.n,12);assert.equal(heldRows.d,12);
  step('T02 12 concurrent HTTP reservations on workerd/D1: all distinct',`held=${heldRows.n}, distinct=${heldRows.d}`);
  // ---- Cron through the real scheduled handler
  const cron=await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*`);assert.equal(cron.status,200);
  await new Promise(r=>setTimeout(r,1500));
  const sent=sql(`SELECT COUNT(*) n FROM notifications WHERE status='sent'`)[0].n;assert.ok(sent>=2,`sent=${sent}`);
  step('Scheduled handler ran: queued notifications delivered',`sent=${sent}`);
  // ---- T09 withdrawal
  const reqW=await api('POST','/api/v1/me/company/requests',{cookie:owner.cookie,body:{companyId,kind:'withdrawal',reason:'Closing the business line'}});assert.equal(reqW.status,201);
  const exec=await api('POST','/api/v1/admin/withdrawals/execute',{cookie:adminUser.cookie,body:{companyId,requestId:reqW.data.requestId,reasonCode:'owner_request',evidenceReference:'ticket-1'}});
  assert.equal(exec.status,200,JSON.stringify(exec.data));
  assert.equal((await fetch(`${BASE}/empresas/${slug}`)).status,404);assert.equal((await fetch(`${BASE}/api/v1/public/companies/${slug}.json`)).status,404);
  assert.equal((await api('GET','/api/v1/public/search?query=ocean+freight')).data.items.some(x=>x.slug===slug),false);
  const ret=await api('GET','/api/v1/public/retired-positions');assert.deepEqual(ret.data.items,[{position:101,label:'Position retired — Not available',labelEs:'Cupo retirado — No disponible'}]);
  const after=await api('GET','/api/v1/public/stats');assert.equal(after.data.retired,1);assert.equal(after.data.published,1);
  step('T09 withdrawn company gone from page, JSON-LD and search; position 101 consumed and shown only as retired');
  // ---- Persistence across a restart
  await stopWorker();await startWorker();
  const persisted=await api('GET',`/api/v1/public/companies/${fReg.data.slug}`);assert.equal(persisted.data.name,'Andes Cargo SAS');
  const s9=await api('GET','/api/v1/public/stats');assert.equal(s9.data.occupied,2);assert.equal(s9.data.held,12);
  step('Data survives a Worker restart',`occupied=${s9.data.occupied}, held=${s9.data.held}, published=${s9.data.published}`);
  // ---- PERF-001: the same public data for everyone, and no page in a shared cache
  const anon=await fetch(BASE+'/');const withSession=await fetch(BASE+'/',{headers:{cookie:owner.cookie}});
  assert.equal(anon.headers.get('cache-control'),'private, no-cache');assert.equal(withSession.headers.get('cache-control'),'private, no-cache');
  const [anonHtml,signedHtml]=await Promise.all([anon.text(),withSession.text()]);
  assert.ok(anonHtml.includes('Sign in'));assert.ok(signedHtml.includes('My account'));assert.equal(anonHtml.includes('My account'),false);
  const statsAnon=await fetch(BASE+'/api/v1/public/stats'),statsSigned=await fetch(BASE+'/api/v1/public/stats',{headers:{cookie:owner.cookie}});
  assert.equal(statsSigned.headers.get('set-cookie'),null);assert.match(statsSigned.headers.get('cache-control'),/^public/);
  assert.equal(await statsSigned.text(),await statsAnon.text());
  step('A page never goes to a shared cache; public statistics are the same with or without a session');
  // ---- ADMIN-001: the control center, through the real guard
  const panelGet=(url,headers={})=>fetch(BASE+url,{redirect:'manual',headers});
  for(const url of ['/admin','/admin/empresas','/es/admin/perfiles','/admin/auditoria']){
    const anonymous=await panelGet(url);assert.equal(anonymous.status,302,url);assert.match(anonymous.headers.get('location'),/login\?required=1/);assert.equal(anonymous.headers.get('cache-control'),'no-store');
    const outsider=await panelGet(url,{cookie:owner.cookie});assert.equal(outsider.status,404,url);assert.equal(outsider.headers.get('cache-control'),'no-store');assert.equal((await outsider.text()).includes('THE1500'),false,'nothing reveals the panel');
  }
  step('Control center: no session goes to sign-in, a non-administrator gets a plain 404');
  for(const url of ['overview','companies/detail?companyId=x','profiles/detail?companyId=x&version=1','audit']){
    assert.equal((await api('GET',`/api/v1/admin/${url}`)).status,401,url);assert.equal((await api('GET',`/api/v1/admin/${url}`,{cookie:owner.cookie})).status,403,url);
  }
  assert.equal((await api('POST','/api/v1/admin/company-action',{cookie:owner.cookie,body:{companyId:'x',action:'block_publication',reasonCode:'abc',evidenceReference:'x'}})).status,403);
  step('Control center API: 401 without a session, 403 without the permission');
  const adminEmail='control@the1500.example';const adminCookie=(await login(adminEmail)).cookie;
  assert.equal((await panelGet('/admin',{cookie:adminCookie})).status,404,'signing in does not make an administrator');
  sql(`INSERT INTO platform_admins(user_id,granted_at,granted_by) SELECT id,'2026-11-05T00:00:00.000Z','e2e' FROM users WHERE email='${adminEmail}'`);
  const headersOf={cookie:adminCookie};
  const panel=await panelGet('/admin',headersOf);assert.equal(panel.status,200);assert.equal(panel.headers.get('cache-control'),'no-store');assert.match(panel.headers.get('x-robots-tag'),/noindex/);
  const panelHtml=await panel.text();assert.ok(panelHtml.includes(adminEmail));assert.ok(panelHtml.includes('Positions'));
  const companiesHtml=await (await panelGet('/admin/empresas?query='+encodeURIComponent('"><script>alert(1)</script>'),headersOf)).text();
  assert.equal(companiesHtml.includes('"><script>alert(1)'),false,'a search term cannot leave its attribute');assert.ok(companiesHtml.includes('&quot;><script>alert(1)'));
  const anyCompany=sql(`SELECT c.id,c.display_name,v.version FROM companies c JOIN profile_versions v ON v.company_id=c.id ORDER BY v.published_at DESC LIMIT 1`)[0];
  const listed=await (await panelGet('/es/admin/empresas?query='+encodeURIComponent(anyCompany.display_name),headersOf)).text();assert.ok(listed.includes(anyCompany.display_name));
  const fileHtml=await (await panelGet(`/admin/empresas/${anyCompany.id}`,headersOf)).text();assert.ok(fileHtml.includes(anyCompany.display_name));
  const profileHtml=await (await panelGet(`/admin/perfiles/${anyCompany.id}/${anyCompany.version}`,headersOf)).text();assert.ok(profileHtml.includes('astro-island'),'the JSON viewer is there');
  assert.equal((await panelGet('/admin/empresas/no-such-company',headersOf)).status,404);
  const detail=await api('GET',`/api/v1/admin/profiles/detail?companyId=${anyCompany.id}&version=${anyCompany.version}`,{cookie:adminCookie});assert.equal(detail.status,200);assert.ok(detail.data.documents.canonical);
  assert.equal((await api('POST','/api/v1/admin/company-action',{cookie:adminCookie,origin:false,body:{companyId:anyCompany.id,action:'block_publication',reasonCode:'abc',evidenceReference:'x'}})).status,403,'no origin, no write');
  const blocked=await fetch(BASE+'/api/v1/admin/company-action',{method:'POST',headers:{'content-type':'application/json',cookie:adminCookie,Origin:'https://evil.test'},body:JSON.stringify({companyId:anyCompany.id,action:'block_publication',reasonCode:'abc',evidenceReference:'x'})});assert.equal(blocked.status,403,'another origin, no write');
  assert.equal((await api('POST','/api/v1/admin/company-action',{cookie:adminCookie,body:{companyId:anyCompany.id,action:'block_publication',reasonCode:'x',evidenceReference:''}})).status,400,'no reason, no action');
  assert.equal((await api('POST','/api/v1/admin/company-action',{cookie:adminCookie,body:{companyId:anyCompany.id,action:'block_publication',reasonCode:'e2e_check',evidenceReference:'journey'}})).status,200);
  const auditHtml=await (await panelGet('/admin/auditoria',headersOf)).text();assert.ok(auditHtml.includes('e2e_check')&&auditHtml.includes(adminEmail));
  assert.equal((await api('POST','/api/v1/admin/company-action',{cookie:adminCookie,body:{companyId:anyCompany.id,action:'clear_block',reasonCode:'e2e_check',evidenceReference:'journey'}})).status,200);
  step('Control center: an administrator reads real data, writes need origin and reason, and the action is on the audit page');
  // ---- Sessions
  const out=await api('POST','/api/v1/auth/logout-all',{cookie:stranger.cookie});assert.equal(out.status,200);
  assert.equal((await api('GET','/api/v1/auth/me',{cookie:stranger.cookie})).status,401);
  step('Sessions revoked server-side');
  console.log(`\n${log.length} acceptance steps passed. Email, LLM and Stripe were LOCAL STAND-INS, not the real providers.`);
  fs.writeFileSync(path.join(ROOT,'docs/CORE005_E2E_EVIDENCE.txt'),`THE1500 CORE-005 acceptance journey. ${new Date().toISOString()}\nWorker: built output on workerd via wrangler dev; D1/R2: local persisted.\nEmail, LLM, Stripe: local stand-ins (tests/support/upstreams.cjs). NOT real providers, NOT remote Cloudflare.\n\n${log.join('\n')}\n`);
})().catch(e=>{console.error('\nE2E FAILED:',e);process.exitCode=1;}).finally(async()=>{await stopWorker();if(up)await up.close();fs.rmSync(persist,{recursive:true,force:true});process.exit();});
