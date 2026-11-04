// Runs against the DEPLOYED staging Worker and REMOTE D1/R2. Refuses any other target.
// Sign-in links are seeded in D1 until a mail provider exists; webhooks are signed with a temporary test secret.
// Needs: STAGING_URL, STAGING_WEBHOOK_SECRET. Leaves test data: restore D1 afterwards (docs/STAGING.md).
const {execFileSync}=require('node:child_process');const crypto=require('node:crypto');const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.join(__dirname,'../..');const WR=path.join(ROOT,'node_modules/.bin/wrangler');
const BASE=process.env.STAGING_URL,SECRET=process.env.STAGING_WEBHOOK_SECRET;
assert.match(BASE||'',/^https:\/\/(the1500-staging\.|staging\.the1500\.com)/,'staging target only');assert.ok(SECRET,'STAGING_WEBHOOK_SECRET');
const RUN=Date.now().toString(36);const log=[];
const step=(s,d='')=>{const l=`PASS  ${s}${d?`  →  ${d}`:''}`;log.push(l);console.log(l);};
const wr=(...a)=>{try{return execFileSync(WR,a,{cwd:ROOT,stdio:'pipe',maxBuffer:1<<26,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}}).toString();}catch(e){throw new Error(`wrangler ${a.slice(0,3).join(' ')}: ${(e.stdout||'').toString().slice(0,600)}`);}};
const sql=c=>JSON.parse(wr('d1','execute','DB','--remote','--json','--command',c)).at(-1).results;
const one=c=>sql(c)[0];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const q=v=>`'${String(v).replace(/'/g,"''")}'`;
async function api(method,url,{cookie,body,headers={},origin=true}={}){
  const r=await fetch(BASE+url,{method,redirect:'manual',headers:{...(body?{'content-type':'application/json'}:{}),...(origin&&method!=='GET'?{Origin:BASE}:{}),...(cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:r.status,data,headers:r.headers};
}
let k=0;const idem=()=>({'Idempotency-Key':`remote_${RUN}_${String(++k).padStart(6,'0')}`});
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*p))];};
function seedChallenges(emails){
  const now=new Date(),exp=new Date(now.getTime()+15*60000).toISOString();
  const rows=emails.map(email=>{const token=crypto.randomBytes(32).toString('hex');return {email,token,sql:`(${q(crypto.randomUUID())},${q(email)},${q(sha(token))},${q(now.toISOString())},${q(exp)},'en')`};});
  sql(`INSERT INTO login_challenges(id,email,token_digest,requested_at,expires_at,locale) VALUES ${rows.map(r=>r.sql).join(',')}`);
  return rows;
}
const verify=token=>fetch(`${BASE}/api/v1/auth/verify`,{method:'POST',redirect:'manual',headers:{Origin:BASE,'content-type':'application/x-www-form-urlencoded'},body:`token=${token}`});
const form=(name)=>({language:'en',description:`${name} coordinates ocean freight and shipment visibility for US importers and logistics teams across the Atlantic.`,
  descriptionEs:'Coordinamos fletes marítimos y visibilidad de envíos para importadores de Estados Unidos.',services:['Ocean freight coordination','Shipment visibility'],audiences:['Importers'],
  problemSolutions:[{problem:'Importers lack shipment status visibility',solution:'Consolidated container tracking updates'}],serviceCountries:['US','CO'],consent:{processingAuthorized:true,documentVersion:'consent-2026-11'}});
async function webhook(type,object,{secret=SECRET,id='evt_'+crypto.randomUUID()}={}){
  const body=JSON.stringify({id,type,created:Math.floor(Date.now()/1000),livemode:false,data:{object}});
  const t=Math.floor(Date.now()/1000);const v1=crypto.createHmac('sha256',secret).update(`${t}.${body}`).digest('hex');
  const r=await fetch(`${BASE}/api/v1/webhooks/stripe`,{method:'POST',headers:{'content-type':'application/json','stripe-signature':`t=${t},v1=${v1}`},body});
  return {status:r.status,data:await r.json().catch(()=>null)};
}
const paidSession=(attempt,amount=10000)=>({id:`cs_test_${attempt}`,object:'checkout.session',status:'complete',payment_status:'paid',amount_total:amount,currency:'usd',payment_intent:`pi_test_${attempt}`,metadata:{attempt_id:attempt},livemode:false,expires_at:0,customer_details:{email:'payer@example.com'}});
function seedAttempts(buyers){
  const now=new Date().toISOString();
  const rows=buyers.map(b=>{b.attemptId=crypto.randomUUID();return `(${q(b.attemptId)},${q(b.companyId)},${q(b.userId)},${q(b.hold.holdId)},1,'stripe',${q('cs_test_'+b.attemptId)},10000,10000,'pending',${q('seed:'+b.attemptId)},${q(b.hold.expiresAt)},${q(now)},${q(now)})`;});
  sql(`INSERT INTO purchase_attempts(id,company_id,user_id,hold_id,phase,provider,provider_session_id,amount_usd_cents,total_minor,status,idempotency_key,hold_expires_at,created_at,updated_at) VALUES ${rows.join(',')}`);
}
(async()=>{
  const dep=wr('deployments','list','--name','the1500-staging','--json');
  step('Target is the deployed staging Worker',`${BASE}, deployments on record: ${JSON.parse(dep).length}`);
  // ---- Schema and starting state
  const applied=wr('d1','migrations','list','DB','--remote');assert.match(applied,/No migrations to apply/);
  const start=one(`SELECT COUNT(*) n,SUM(status='available') free,SUM(number BETWEEN 1 AND 100) founders,SUM(number BETWEEN 101 AND 600) paid FROM slots`);
  assert.deepEqual(start,{n:1500,free:1500,founders:100,paid:500});
  const stats=await api('GET','/api/v1/public/stats');assert.equal(stats.data.salesMode,'selling');assert.equal(stats.data.currentPriceUsdCents,10000);
  step('Migrations 0001-0007 on remote D1; 1,500 positions; stats served from it',`available=${stats.data.available}, mode=${stats.data.salesMode}`);
  for(const p of ['/','/unirse','/empresas','/es/','/es/unirse','/login'])assert.equal((await fetch(BASE+p)).status,200,p);
  step('Public pages respond in EN and ES on workers.dev');
  // ---- Authentication
  const noMail=await api('POST','/api/v1/auth/request-link',{body:{email:'someone@acme.example'}});
  assert.equal(noMail.status,503);assert.equal(noMail.data.error.code,'MAIL_NOT_CONFIGURED');
  step('Without a mail provider, sign-in reports 503 instead of pretending','MAIL_NOT_CONFIGURED');
  const N=55;const emails=Array.from({length:N},(_,i)=>`owner@buyer${i}-${RUN}.example`);
  const [adminRow,evilRow,...rows]=seedChallenges([`root-${RUN}@the1500.example`,`eve@evil-${RUN}.example`,...emails]);
  const t0=Date.now();
  const verified=await Promise.all(rows.map(r=>verify(r.token)));
  assert.deepEqual(verified.map(v=>v.status),Array(N).fill(303));
  const cookieOf=v=>{const c=v.headers.get('set-cookie');assert.match(c,/^__Host-the1500_session=.*HttpOnly; Secure; SameSite=Lax/);return c.split(';')[0];};
  const buyers=verified.map((v,i)=>({i,email:emails[i],cookie:cookieOf(v)}));
  step(`${N} concurrent sign-in verifications created real sessions`,`${Date.now()-t0} ms in total`);
  assert.equal((await verify(rows[0].token)).status,401);
  const expired=seedChallenges([`late@late-${RUN}.example`])[0];
  sql(`UPDATE login_challenges SET requested_at='2020-01-01T00:00:00.000Z',expires_at='2020-01-01T00:15:00.000Z' WHERE email=${q(expired.email)}`);
  assert.equal((await verify(expired.token)).status,401);
  const admin={cookie:cookieOf(await verify(adminRow.token))};const evil={cookie:cookieOf(await verify(evilRow.token))};
  admin.userId=one(`SELECT id FROM users WHERE email=${q(adminRow.email)}`).id;
  sql(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(${q(admin.userId)},${q(new Date().toISOString())},'remote-test')`);
  assert.equal((await api('GET','/api/v1/auth/me',{cookie:admin.cookie})).status,200);
  assert.equal((await api('GET','/api/v1/auth/me')).status,401);
  step('Links work once, expired links fail, session cookie is __Host-, HttpOnly, Secure');
  const ids=sql(`SELECT id,email FROM users WHERE email LIKE '%-${RUN}.example'`);const idOf=Object.fromEntries(ids.map(r=>[r.email,r.id]));
  // ---- Companies
  const regs=await Promise.all(buyers.map(b=>api('POST','/api/v1/registrations',{cookie:b.cookie,body:{displayName:`Ocean Buyer ${b.i} ${RUN}`,country:'US',industry:'Ocean freight',website:`https://buyer${b.i}-${RUN}.example`,declareAuthority:true}})));
  regs.forEach((r,i)=>{assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.identityState,'self_declared');buyers[i].companyId=r.data.id;buyers[i].slug=r.data.slug;buyers[i].userId=idOf[buyers[i].email];});
  step(`${N} companies registered concurrently from corporate email`);
  // ---- Tenancy
  const b0=buyers[0];
  assert.equal((await api('POST','/api/v1/orders/hold',{cookie:evil.cookie,body:{companyId:b0.companyId},headers:idem()})).status,403);
  assert.equal((await api('GET',`/api/v1/me/company?companyId=${b0.companyId}`,{cookie:evil.cookie})).status,403);
  assert.equal((await api('PUT','/api/v1/me/company/profile',{cookie:evil.cookie,body:{companyId:b0.companyId,...form('x')}})).status,403);
  assert.equal((await api('POST','/api/v1/orders/hold',{body:{companyId:b0.companyId},headers:idem()})).status,401);
  assert.equal((await api('POST','/api/v1/orders/hold',{cookie:b0.cookie,body:{companyId:b0.companyId},headers:{...idem(),Origin:'https://evil.example'}})).status,403);
  assert.equal((await api('GET','/api/v1/admin/overview',{cookie:b0.cookie})).status,403);
  step('Another account cannot reach a company; no session 401; foreign origin 403; non-admin 403');
  // ---- Concurrency: reservations
  const first=buyers.slice(0,40);const lat=[];
  const holds=await Promise.all(first.map(async b=>{const t=Date.now();const r=await api('POST','/api/v1/orders/hold',{cookie:b.cookie,body:{companyId:b.companyId},headers:idem()});lat.push(Date.now()-t);return r;}));
  assert.deepEqual(holds.map(h=>h.status),Array(40).fill(201),JSON.stringify(holds.find(h=>h.status!==201)?.data));
  holds.forEach((h,i)=>{first[i].hold=h.data.hold;assert.equal('slotNumber' in h.data.hold,false);});
  const held=one(`SELECT COUNT(*) n,COUNT(DISTINCT number) d,MIN(number) lo,MAX(number) hi FROM slots WHERE status='held'`);
  assert.deepEqual(held,{n:40,d:40,lo:101,hi:140});
  step('40 concurrent reservations on remote D1: all accepted, all distinct, ascending from 101',`held=${held.n}, range ${held.lo}-${held.hi}, latency p50=${pct(lat,.5)} ms, p95=${pct(lat,.95)} ms, max=${Math.max(...lat)} ms`);
  // ---- Concurrency: payment confirmation through the real webhook route
  const forged=await webhook('checkout.session.completed',paidSession('x'),{secret:'whsec_forged'});assert.equal(forged.status,400);
  const paying=first.slice(0,20);seedAttempts(paying);
  const t1=Date.now();
  const evs=paying.flatMap(b=>{const id='evt_'+b.attemptId;return [webhook('checkout.session.completed',paidSession(b.attemptId),{id}),webhook('checkout.session.completed',paidSession(b.attemptId),{id}),webhook('checkout.session.completed',paidSession(b.attemptId))];});
  const delivered=await Promise.all(evs);
  const bad=delivered.filter(d=>d.status!==200);assert.equal(bad.length,0,JSON.stringify(bad[0]));
  const paidRows=sql(`SELECT assigned_slot_number n,status FROM purchase_attempts WHERE status='paid'`);
  assert.equal(paidRows.length,20);assert.equal(new Set(paidRows.map(r=>r.n)).size,20);
  const audit=one(`SELECT COUNT(*) n FROM slot_audit WHERE action='assign_paid'`).n;assert.equal(audit,20);
  const asg=one(`SELECT COUNT(*) n,COUNT(DISTINCT company_id) c,MIN(number) lo,MAX(number) hi FROM slots WHERE status='assigned' AND assignment_kind='paid'`);
  assert.deepEqual(asg,{n:20,c:20,lo:101,hi:120});
  step('60 concurrent signed webhooks (duplicates included) gave exactly 20 assignments; forged signature rejected',`positions ${asg.lo}-${asg.hi}, audit entries=${audit}, ${Date.now()-t1} ms`);
  for(const b of paying)b.position=one(`SELECT number n FROM slots WHERE company_id=${q(b.companyId)}`).n;
  const amountBuyer=first[20];seedAttempts([amountBuyer]);
  assert.equal((await webhook('checkout.session.completed',paidSession(amountBuyer.attemptId,500))).data.outcome,'amount_review');
  assert.equal(one(`SELECT COUNT(*) n FROM slots WHERE company_id=${q(amountBuyer.companyId)}`).n,0);
  step('Wrong amount goes to review and assigns nothing');
  // ---- Late payment: human reconciliation
  const late=first[21];seedAttempts([late]);
  const pastHold=new Date(new Date(late.hold.createdAt).getTime()+1).toISOString(); // Holds must expire after they were created.
  sql(`UPDATE slot_holds SET expires_at=${q(pastHold)} WHERE id=${q(late.hold.holdId)};UPDATE slots SET held_until=${q(pastHold)} WHERE active_hold_id=${q(late.hold.holdId)};UPDATE purchase_attempts SET hold_expires_at=${q(pastHold)} WHERE id=${q(late.attemptId)}`);
  assert.equal((await webhook('checkout.session.completed',paidSession(late.attemptId))).data.outcome,'late_review');
  assert.equal(one(`SELECT COUNT(*) n FROM slots WHERE company_id=${q(late.companyId)}`).n,0);
  const facts=await api('GET',`/api/v1/admin/payments/resolve-late?attemptId=${late.attemptId}`,{cookie:admin.cookie});
  assert.equal(facts.status,200);assert.equal(facts.data.paidAtSource,'provider_event');assert.equal(facts.data.paidWithinReservation,false);assert.equal(facts.data.assignable,true);
  assert.equal((await api('POST','/api/v1/admin/payments/resolve-late',{cookie:admin.cookie,body:{attemptId:late.attemptId,decision:'assign',reasonCode:'reviewed'}})).status,400);
  const lateOk=await api('POST','/api/v1/admin/payments/resolve-late',{cookie:admin.cookie,body:{attemptId:late.attemptId,decision:'assign',reasonCode:'reviewed',evidenceReference:'remote-case-1'}});
  assert.equal(lateOk.status,200,JSON.stringify(lateOk.data));assert.equal(lateOk.data.status,'paid');
  assert.equal(one(`SELECT COUNT(*) n FROM slots WHERE number=${lateOk.data.position} AND company_id=${q(late.companyId)}`).n,1);
  step('Late payment took nothing until a documented human decision; then only a free number',`position=${lateOk.data.position}`);
  // ---- Publication on real D1 and R2
  const publish=async b=>{
    const d=await api('PUT','/api/v1/me/company/profile',{cookie:b.cookie,body:{companyId:b.companyId,...form(`Ocean Buyer ${b.i}`)}});assert.equal(d.status,201,JSON.stringify(d.data));
    const a=await api('POST','/api/v1/me/company/approve',{cookie:b.cookie,body:{companyId:b.companyId,version:d.data.version,contentDigest:d.data.contentDigest,acceptPublicDisclosure:true}});assert.equal(a.status,200,JSON.stringify(a.data));
    const p=await api('POST','/api/v1/me/company/publish',{cookie:b.cookie,body:{companyId:b.companyId,version:d.data.version}});assert.equal(p.status,200,JSON.stringify(p.data));
    return {draft:d.data,pub:p.data};
  };
  const b1=paying[1];
  assert.equal((await fetch(`${BASE}/empresas/${b0.slug}`)).status,404);
  const dUn=await api('PUT','/api/v1/me/company/profile',{cookie:b0.cookie,body:{companyId:b0.companyId,...form('Ocean Buyer 0')}});assert.equal(dUn.data.generation.mode,'deterministic');
  assert.equal((await api('POST','/api/v1/me/company/publish',{cookie:b0.cookie,body:{companyId:b0.companyId,version:dUn.data.version}})).data.error.code,'PROFILE_NOT_APPROVED');
  step('Unapproved profile cannot be published; AI off is labelled deterministic, not AI','generation.mode=deterministic');
  const pubs=await Promise.all(paying.slice(0,6).map(publish));
  step('6 profiles published concurrently on remote D1, FTS5 included (regression A-13)');
  const page=await fetch(`${BASE}/empresas/${b0.slug}`);const html=await page.text();assert.equal(page.status,200);
  assert.ok(html.includes('application/ld+json'));assert.match(html,/noindex/);
  const ld=await fetch(`${BASE}/api/v1/public/companies/${b0.slug}.json`);const ldText=await ld.text();const doc=JSON.parse(ldText);
  assert.equal(doc['@graph'][0]['@type'],'Organization');assert.equal(doc['@graph'][0].identifier.value,b0.position);
  for(const s of [b0.email,b0.companyId,'stripe','founder'])assert.equal(ldText.toLowerCase().includes(s.toLowerCase()),false,s);
  assert.equal((await fetch(`${BASE}/es/empresas/${b0.slug}`)).status,200);
  step('HTML and JSON-LD public in EN and ES, staging marked noindex, no private data',`/empresas/${b0.slug}`);
  const r2Key=`profiles/${b0.companyId}/v${pubs[0].pub.version}/en.jsonld`;
  const snap=JSON.parse(wr('r2','object','get',`the1500-staging-snapshots/${r2Key}`,'--remote','--pipe'));
  assert.equal(snap['@graph'][0].identifier.value,b0.position);
  step('Immutable JSON-LD copy present in remote R2');
  const found=await api('GET',`/api/v1/public/search?query=${encodeURIComponent('importers cannot see shipment status')}`);
  assert.ok(found.data.items.some(x=>x.slug===b0.slug));assert.equal(found.data.retrieval.semantic,false);
  const ask=await api('POST','/api/v1/public/ask',{body:{question:'Who helps importers with shipment visibility?',language:'en'}});
  assert.equal(ask.status,200,JSON.stringify(ask.data));assert.equal(ask.data.mode,'retrieval_only');assert.ok(ask.data.citations.length>0);
  const cite=ask.data.citations[0];const cited=await (await fetch(BASE+cite.jsonldUrl)).text();assert.equal(sha(cited),cite.jsonldDigest);
  step('Search finds by business problem; assistant cites a verifiable digest, labelled retrieval_only because no LLM key exists');
  // ---- Founder
  const fb=first[30];
  const inv=await api('POST','/api/v1/admin/founder-invite',{cookie:admin.cookie,body:{companyId:fb.companyId}});assert.equal(inv.status,201,JSON.stringify(inv.data));
  assert.equal((await api('POST','/api/v1/me/founder-invitations/accept',{cookie:fb.cookie,body:{invitationId:inv.data.invitationId,acceptTerms:true,termsVersion:'f1'}})).data.status,'accepted');
  const awd=await api('POST','/api/v1/admin/founder-award',{cookie:admin.cookie,body:{invitationId:inv.data.invitationId,reasonCode:'selected',evidenceReference:'remote-case-2'}});
  assert.equal(awd.data.slotNumber,1,JSON.stringify(awd.data));
  step('Founder: invited, accepted, awarded by administration in 1-100',`position=${awd.data.slotNumber}`);
  // ---- Reactivation
  const rb=paying[10];
  sql(`UPDATE onboarding_cases SET status='suspended',suspended_at=${q(new Date().toISOString())},reactivation_due_at=${q(new Date(Date.now()+5*86400000).toISOString())} WHERE company_id=${q(rb.companyId)}`);
  assert.equal((await api('PUT','/api/v1/me/company/profile',{cookie:rb.cookie,body:{companyId:rb.companyId,...form('r')}})).data.error.code,'ONBOARDING_SUSPENDED');
  assert.equal((await api('POST','/api/v1/me/company/reactivate',{cookie:rb.cookie,body:{companyId:rb.companyId}})).data.status,'reactivation_requested');
  const ap=await api('POST','/api/v1/admin/onboarding/reactivation',{cookie:admin.cookie,body:{companyId:rb.companyId,decision:'approved',reasonCode:'approved',evidenceReference:'remote-case-3'}});
  assert.equal(ap.data.status,'reactivation_approved');assert.equal(ap.data.reactivationFormDueAt,null);
  const nt=await api('POST','/api/v1/admin/onboarding/reactivation',{cookie:admin.cookie,body:{companyId:rb.companyId,decision:'notified_by_other_means',reasonCode:'phoned',evidenceReference:'remote-case-4'}});
  assert.equal(nt.data.status,'reactivated');assert.equal(new Date(nt.data.reactivationFormDueAt)-new Date(nt.data.reactivationNotifiedAt),15*86400000);
  assert.equal(one(`SELECT status FROM onboarding_cases WHERE company_id=${q(rb.companyId)}`).status,'reactivated');
  assert.equal((await api('PUT','/api/v1/me/company/profile',{cookie:rb.cookie,body:{companyId:rb.companyId,...form('r')}})).status,201);
  assert.equal(one(`SELECT status FROM onboarding_cases WHERE company_id=${q(rb.companyId)}`).status,'completed');
  step('Reactivation: requested, approved, no term until notified, then exactly 15 days; form completes the case');
  // ---- Withdrawal
  const reqW=await api('POST','/api/v1/me/company/requests',{cookie:b1.cookie,body:{companyId:b1.companyId,kind:'withdrawal',reason:'Closing the business line'}});assert.equal(reqW.status,201);
  assert.equal((await api('POST','/api/v1/admin/withdrawals/execute',{cookie:b1.cookie,body:{companyId:b1.companyId,requestId:reqW.data.requestId,reasonCode:'owner_request',evidenceReference:'x'}})).status,403);
  const exW=await api('POST','/api/v1/admin/withdrawals/execute',{cookie:admin.cookie,body:{companyId:b1.companyId,requestId:reqW.data.requestId,reasonCode:'owner_request',evidenceReference:'remote-case-5'}});assert.equal(exW.status,200,JSON.stringify(exW.data));
  assert.equal((await fetch(`${BASE}/empresas/${b1.slug}`)).status,404);assert.equal((await fetch(`${BASE}/api/v1/public/companies/${b1.slug}.json`)).status,404);
  assert.equal((await api('GET',`/api/v1/public/search?query=${encodeURIComponent('Ocean Buyer 1 '+RUN)}`)).data.items.some(x=>x.slug===b1.slug),false);
  const ask2=await api('POST','/api/v1/public/ask',{body:{question:`Who is Ocean Buyer ${b1.i} ${RUN}?`,language:'en'}});assert.equal((ask2.data.citations||[]).some(c=>c.slug===b1.slug),false);
  const ret=await api('GET','/api/v1/public/retired-positions');assert.deepEqual(ret.data.items,[{position:b1.position,label:'Position retired — Not available',labelEs:'Cupo retirado — No disponible'}]);
  assert.throws(()=>sql(`UPDATE slots SET status='available',company_id=NULL WHERE number=${b1.position}`),/published position cannot be released/);
  const tr=one(`SELECT status,resolved_by,resolution_evidence e,requested_by FROM service_requests WHERE id=${q(reqW.data.requestId)}`);
  assert.deepEqual(tr,{status:'completed',resolved_by:admin.userId,e:'remote-case-5',requested_by:b1.userId});
  step('Withdrawal: gone from page, JSON-LD, search and assistant; number stays retired; request and decision on record',`position ${b1.position}: "${ret.data.items[0].labelEs}"`);
  const lb=paying[2];
  const legal=await api('POST','/api/v1/admin/requests',{cookie:admin.cookie,body:{companyId:lb.companyId,legalBasis:'data_protection',reason:'Affected person asks for removal',channelNote:'remote-case-6'}});assert.equal(legal.status,201,JSON.stringify(legal.data));
  const lq=await api('GET','/api/v1/admin/requests',{cookie:admin.cookie});assert.equal(lq.data.requests[0].id,legal.data.requestId);
  assert.equal((await api('POST','/api/v1/admin/requests/legal-deadline',{cookie:admin.cookie,body:{requestId:legal.data.requestId,legalDueAt:new Date(Date.now()+86400000).toISOString(),reasonCode:'term_set',evidenceReference:'remote-case-7'}})).status,200);
  step('Legal request recorded by administration, first in the queue, with its term');
  // ---- Scarcity: never beyond the tier
  sql(`UPDATE slots SET status='assigned',assignment_kind='paid' WHERE number BETWEEN 101 AND 595 AND status='available'`);
  const free=one(`SELECT COUNT(*) n FROM slots WHERE number BETWEEN 101 AND 600 AND status='available'`).n;assert.equal(free,5);
  const scarce=buyers.slice(40);
  const sc=await Promise.all(scarce.map(b=>api('POST','/api/v1/orders/hold',{cookie:b.cookie,body:{companyId:b.companyId},headers:idem()})));
  const wins=sc.filter(r=>r.status===201).length;const codes=[...new Set(sc.filter(r=>r.status!==201).map(r=>r.data.error.code))];
  assert.equal(wins,5,JSON.stringify(codes));
  assert.equal(one(`SELECT COUNT(*) n FROM slots WHERE number>600 AND status<>'available'`).n,0);
  assert.equal(one(`SELECT COUNT(*) n FROM slots WHERE number<=100 AND status='held'`).n,0);
  assert.equal(one(`SELECT COUNT(*) n FROM slots WHERE number BETWEEN 101 AND 600 AND status='available'`).n,0);
  step('15 buyers racing for the last 5 paid numbers: exactly 5 win; no sale above 600, none in 1-100',`refused with ${codes.join(', ')}`);
  // ---- Cron on Cloudflare, no traffic
  const stale=first[35];const pastStale=new Date(new Date(stale.hold.createdAt).getTime()+1).toISOString();
  sql(`UPDATE slot_holds SET expires_at=${q(pastStale)} WHERE id=${q(stale.hold.holdId)};UPDATE slots SET held_until=${q(pastStale)} WHERE active_hold_id=${q(stale.hold.holdId)}`);
  const t2=Date.now();let cron=null;
  for(let i=0;i<40&&!cron;i++){await sleep(15000);if(one(`SELECT status FROM slot_holds WHERE id=${q(stale.hold.holdId)}`).status!=='active')cron=Date.now()-t2;}
  assert.ok(cron,'cron did not expire the hold within 10 minutes');
  step('Real Cloudflare cron expired a stale reservation with no HTTP traffic',`after ${Math.round(cron/1000)} s`);
  // ---- Persistence across a new deployment
  const before=await api('GET','/api/v1/public/stats');
  wr('deploy','--config','dist/server/wrangler.json');
  await sleep(5000);
  const after=await api('GET','/api/v1/public/stats');
  assert.equal(after.data.occupied,before.data.occupied);assert.equal(after.data.published,before.data.published);assert.equal(after.data.retired,before.data.retired);
  assert.equal((await fetch(`${BASE}/empresas/${b0.slug}`)).status,200);
  assert.equal((await api('GET','/api/v1/auth/me',{cookie:b0.cookie})).status,200);
  step('Data, publications and sessions survive a new Worker deployment',`occupied=${after.data.occupied}, published=${after.data.published}, retired=${after.data.retired}`);
  const out=await api('POST','/api/v1/auth/logout-all',{cookie:evil.cookie});assert.equal(out.status,200);
  assert.equal((await api('GET','/api/v1/auth/me',{cookie:evil.cookie})).status,401);
  step('Sessions revoked server-side');
  // ---- Integrations report
  const ig=await api('GET','/api/v1/admin/integrations',{cookie:admin.cookie});
  assert.equal(ig.data.mail.configured,false);assert.equal(ig.data.stripe.keyPresent,false);assert.equal(ig.data.ai.configured,false);assert.equal(ig.data.stripe.gate,'PAYMENTS_DISABLED');assert.equal(JSON.stringify(ig.data).includes(SECRET),false);
  assert.equal((await api('POST','/api/v1/orders/checkout',{cookie:buyers[50].cookie,body:{companyId:buyers[50].companyId,holdId:'x',acceptTerms:true,termsVersion:'t'},headers:idem()})).status,503);
  step('Payments stay closed on staging; integration report shows no provider configured and no secret value');
  // ---- Premium, last: it consumes the whole sequence
  const pb=buyers[54];
  const fi=await api('POST','/api/v1/me/company/premium-request',{cookie:pb.cookie,body:{companyId:pb.companyId,message:'We would like to apply for a Premium position.'}});
  assert.equal(fi.data.error.code,'PREMIUM_NOT_OPEN');
  sql(`UPDATE slots SET status='assigned',active_hold_id=NULL,held_until=NULL,assignment_kind=CASE WHEN number<=100 THEN 'founder' ELSE 'paid' END WHERE number<=1350 AND status IN('available','held')`);
  // pb may hold nothing now; it needs no position to apply.
  const pr=await api('POST','/api/v1/me/company/premium-request',{cookie:pb.cookie,body:{companyId:pb.companyId,message:'We would like to apply for a Premium position.',contactPreference:'email'}});
  assert.equal(pr.status,201,JSON.stringify(pr.data));
  const sg=await api('GET','/api/v1/public/stats');assert.equal(sg.data.salesMode,'premium_admission');assert.equal(sg.data.checkoutOpen,false);
  const noHold=await api('POST','/api/v1/orders/hold',{cookie:buyers[53].cookie,body:{companyId:buyers[53].companyId},headers:idem()});assert.notEqual(noHold.status,201);
  assert.equal(one(`SELECT COUNT(*) n FROM slots WHERE number>1350 AND status<>'available'`).n,0);
  step('Premium: form opens only with its tier, no checkout, no position taken',`salesMode=${sg.data.salesMode}`);
  // ---- Final integrity
  const f=one(`SELECT COUNT(*) n,SUM(status='retired') retired,(SELECT COUNT(*) FROM (SELECT company_id FROM slots WHERE company_id IS NOT NULL GROUP BY company_id HAVING COUNT(*)>1)) dup,
    (SELECT COUNT(*) FROM slots WHERE assignment_kind='founder' AND number>100) fHigh,(SELECT COUNT(*) FROM slots WHERE assignment_kind='paid' AND number<=100) pLow FROM slots`);
  assert.deepEqual(f,{n:1500,retired:1,dup:0,fHigh:0,pLow:0});
  step('Final integrity on remote D1',`1,500 positions, no company with two, none outside its range`);
  console.log(`\n${log.length} steps passed on remote D1, R2 and the deployed Worker. Mail delivery, the Stripe API and LLM providers were NOT involved.`);
  fs.writeFileSync(path.join(ROOT,'docs/CORE006_REMOTE_EVIDENCE.txt'),`THE1500 CORE-006, staging run ${new Date().toISOString()}\nTarget: ${BASE}, remote D1 the1500-staging, remote R2 the1500-staging-snapshots.\nSign-in links seeded in D1 (no mail provider). Webhooks signed with a temporary test secret, sent to the real route. No real Stripe, LLM or email.\n\n${log.join('\n')}\n`);
  fs.writeFileSync(process.env.STAGING_CLEANUP_FILE||'/dev/null',JSON.stringify({r2:pubs.flatMap((p,i)=>[`profiles/${paying[i].companyId}/v${p.pub.version}/en.jsonld`,`profiles/${paying[i].companyId}/v${p.pub.version}/es.jsonld`])}));
})().catch(e=>{console.error('\nREMOTE TEST FAILED:',e);process.exitCode=1;});
