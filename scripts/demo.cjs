// Demo data and sign-in links for building the interface, locally or on staging. Never for production.
//   node scripts/demo.cjs seed --target local|staging        Creates demo companies in every state, and prints sign-in links.
//   node scripts/demo.cjs link <email> --target local|staging  Prints one sign-in link, for use while no mail provider exists.
// Links reach stdout only. Whoever runs this already holds Cloudflare access to that database.
const {execFileSync}=require('node:child_process');const crypto=require('node:crypto');const path=require('node:path');
const ROOT=path.join(__dirname,'..');const WR=path.join(ROOT,'node_modules/.bin/wrangler');
const STAGING='https://the1500-staging.admonpalmerafood.workers.dev';
const args=process.argv.slice(2);const command=args[0];
const target=args[args.indexOf('--target')+1];
if(!args.includes('--target')||!['local','staging'].includes(target)||!['seed','link'].includes(command)){console.error('Usage: demo.cjs seed|link [email] --target local|staging');process.exit(2);}
const BASE=target==='staging'?STAGING:(process.env.DEMO_BASE||'http://localhost:4321');
const flag=target==='staging'?'--remote':'--local';
const sql=c=>JSON.parse(execFileSync(WR,['d1','execute','DB',flag,'--json','--command',c],{cwd:ROOT,stdio:'pipe',maxBuffer:1<<26,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}}).toString()).at(-1).results;
const q=v=>v===null?'NULL':`'${String(v).replace(/'/g,"''")}'`;
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const iso=ms=>new Date(ms).toISOString();const NOW=Date.now();const DAY=86400000;
// Staging links keep the normal 15 minutes; local ones last a year, so a seed survives a working week.
const linkLife=target==='staging'?15*60000:365*DAY;
function challenge(email){
  const token=crypto.randomBytes(32).toString('hex');
  sql(`INSERT INTO login_challenges(id,email,token_digest,requested_at,expires_at,locale) VALUES(${q(crypto.randomUUID())},${q(email)},${q(sha(token))},${q(iso(NOW))},${q(iso(NOW+linkLife))},'en')`);
  return token;
}
const linkOf=token=>`${BASE}/auth/verify?token=${token}`;
async function signIn(email){
  const r=await fetch(`${BASE}/api/v1/auth/verify`,{method:'POST',redirect:'manual',headers:{Origin:BASE,'content-type':'application/x-www-form-urlencoded'},body:`token=${challenge(email)}`});
  if(r.status!==303)throw new Error(`sign-in ${email}: ${r.status}`);
  return r.headers.get('set-cookie').split(';')[0];
}
async function api(method,url,cookie,body,headers={}){
  const r=await fetch(BASE+url,{method,redirect:'manual',headers:{'content-type':'application/json',Origin:BASE,cookie,...headers},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
const form=(what,es,problem,solution,country)=>({language:'en',description:`Demo company for interface work. It ${what}. This is sample text, not a real business.`,descriptionEs:`Empresa de demostración para el desarrollo de la interfaz. ${es}. Es un texto de ejemplo, no un negocio real.`,services:[what.replace(/^\w+ /,'')],audiences:['Mid-size companies'],problemSolutions:[{problem,solution}],serviceCountries:[country,'US'],consent:{processingAuthorized:true,documentVersion:'demo'}});
const PUBLISHED=[
  ['Demo Ocean Freight','Ocean freight','US','coordinates ocean freight for importers','Coordina fletes marítimos para importadores','Importers lack shipment status visibility','Consolidated container tracking'],
  ['Demo Andes Accounting','Accounting','CO','provides tax accounting for exporters','Ofrece contabilidad tributaria a exportadores','Exporters struggle with tax filings','Monthly tax compliance service'],
  ['Demo Harbor Legal','Legal services','US','advises on commercial contracts','Asesora sobre contratos comerciales','Companies sign contracts without review','Fixed-fee contract review'],
  ['Demo Cloud Security','Cybersecurity','MX','audits cloud security for retailers','Audita la seguridad en la nube de comercios','Retailers cannot assess cloud risk','Quarterly cloud security audit'],
  ['Demo Green Packaging','Packaging','CO','manufactures recyclable packaging','Fabrica empaques reciclables','Brands need recyclable packaging','Recyclable packaging lines'],
  ['Demo Metro Staffing','Staffing','US','recruits warehouse staff','Selecciona personal de bodega','Warehouses lose staff at peak season','Seasonal staffing plans'],
];
async function register(name,country,industry){
  const slug=name.toLowerCase().replace(/[^a-z]+/g,'-');const email=`owner@${slug}.example`;const cookie=await signIn(email);
  const reg=await api('POST','/api/v1/registrations',cookie,{displayName:name,country,industry,website:`https://${slug}.example`,declareAuthority:true});
  return {name,email,cookie,companyId:reg.id,slug:reg.slug,userId:sql(`SELECT id FROM users WHERE email=${q(email)}`)[0].id};
}
function assign(c,started){
  // Paid positions start at 101. The next free number, as a confirmed purchase would take.
  const n=sql(`SELECT MIN(number) n FROM slots WHERE number>=101 AND status='available'`)[0].n;
  sql(`UPDATE slots SET status='assigned',company_id=${q(c.companyId)},assignment_kind='paid',assigned_at=${q(iso(started))} WHERE number=${n};
    INSERT INTO onboarding_cases(company_id,origin,started_at,form_due_at,extension_due_at,reactivation_due_at) VALUES(${q(c.companyId)},'paid',${q(iso(started))},${q(iso(started+15*DAY))},${q(iso(started+30*DAY))},${q(iso(started+45*DAY))})`);
  return n;
}
async function publish(c,decl){
  const d=await api('PUT','/api/v1/me/company/profile',c.cookie,{companyId:c.companyId,...decl});
  await api('POST','/api/v1/me/company/approve',c.cookie,{companyId:c.companyId,version:d.version,contentDigest:d.contentDigest,acceptPublicDisclosure:true});
  await api('POST','/api/v1/me/company/publish',c.cookie,{companyId:c.companyId,version:d.version});
}
(async()=>{
  if(command==='link'){
    const email=args[1];if(!email||email.startsWith('--')){console.error('Email required');process.exit(2);}
    console.log(linkOf(challenge(email)));return;
  }
  if(sql(`SELECT COUNT(*) n FROM users WHERE email LIKE '%.example' AND email LIKE 'owner@demo-%'`)[0].n)throw new Error('Demo data already exists here.');
  const out=[];
  const adminEmail='admin@demo-the1500.example';await signIn(adminEmail);
  const adminId=sql(`SELECT id FROM users WHERE email=${q(adminEmail)}`)[0].id;
  sql(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(${q(adminId)},${q(iso(NOW))},'demo seed')`);
  const adminCookie=await signIn(adminEmail);out.push(['Administrator',adminEmail]);
  const pub=[];
  for(const [name,industry,country,what,es,problem,solution] of PUBLISHED){const c=await register(name,country,industry);assign(c,NOW-5*DAY);await publish(c,form(what,es,problem,solution,country));pub.push(c);}
  out.push(['Published profile',pub[0].email]);
  const none=await register('Demo No Position','US','Services');out.push(['Registered, no position',none.email]);
  const active=await register('Demo Form Pending','US','Services');assign(active,NOW-2*DAY);out.push(['Position, form pending',active.email]);
  const suspended=await register('Demo Suspended','CO','Services');assign(suspended,NOW-32*DAY);
  sql(`UPDATE onboarding_cases SET status='suspended',suspended_at=${q(iso(NOW-2*DAY))} WHERE company_id=${q(suspended.companyId)}`);out.push(['Suspended, may request reactivation',suspended.email]);
  const reviewed=await register('Demo Final Notice','CO','Services');assign(reviewed,NOW-47*DAY);
  sql(`UPDATE onboarding_cases SET status='admin_review',admin_review_at=${q(iso(NOW-2*DAY))},final_notice_requested_at=${q(iso(NOW-DAY))},final_notice_requested_by=${q(adminId)},final_notice_channel='email',final_notice_recipient=${q(reviewed.email)},final_notice_evidence='demo',final_notice_sent_at=${q(iso(NOW-DAY))},final_notice_due_at=${q(iso(NOW+6*DAY))} WHERE company_id=${q(reviewed.companyId)}`);
  out.push(['Final notice awaiting reply',reviewed.email]);
  const invited=await register('Demo Founder Invited','US','Services');await api('POST','/api/v1/admin/founder-invite',adminCookie,{companyId:invited.companyId});out.push(['Founder invitation pending',invited.email]);
  const held=await register('Demo Withdrawal','US','Services');assign(held,NOW-5*DAY);await publish(held,form('offers sample services','Ofrece servicios de ejemplo','Sample problem','Sample solution','US'));
  const w=await api('POST','/api/v1/me/company/requests',held.cookie,{companyId:held.companyId,kind:'withdrawal',reason:'Demo withdrawal'});
  await api('POST','/api/v1/admin/withdrawals/execute',adminCookie,{companyId:held.companyId,requestId:w.requestId,reasonCode:'demo',evidenceReference:'demo seed'});
  const open=await register('Demo Request Open','US','Services');assign(open,NOW-5*DAY);await publish(open,form('runs sample operations','Opera ejemplos','Sample issue','Sample answer','US'));
  await api('POST','/api/v1/me/company/requests',open.cookie,{companyId:open.companyId,kind:'withdrawal',reason:'Demo open request',legalBasis:'data_protection'});out.push(['Published, legal withdrawal request open',open.email]);
  console.log(`Demo data created on ${target}: ${BASE}\nEvery company is named "Demo ..." and uses .example addresses. Links work once.\n`);
  for(const [what,email] of out)console.log(`${what}\n  ${email}\n  ${linkOf(challenge(email))}\n`);
})().catch(e=>{console.error(e.message);process.exit(1);});
