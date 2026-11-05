// PERF-001: optimizing the reads must not change one commercial decision.
// The queries that ran before are kept here, verbatim, as the oracle every new answer is compared with.
const {test,describe,before,after}=require('node:test');const assert=require('node:assert/strict');
const {freshDb,seedCompany,fillPaid,fillFounder,fillUpTo}=require('../support/d1.cjs');
const core=p=>require(`../../.core-js-tests/core/${p}.js`);
const inv=core('inventory'),pub=core('public'),dir=core('directory'),home=core('home'),join=core('join'),adm=core('admin'),pro=core('profiles');
const NOW=new Date('2026-11-05T20:00:00.000Z');
let keyN=0;const key=()=>`idempotency_key_${String(++keyN).padStart(6,'0')}`;
const RANGES={1:[1,600,10000],2:[601,1050,40000],3:[1051,1350,100000],4:[1351,1500,506600]};
const CURRENT=`(SELECT MIN(phase) FROM slots WHERE status IN('available','held'))`;
async function legacySales(db){
  const row=await db.prepare(`SELECT ${CURRENT} AS phase,(SELECT COUNT(*) FROM slots WHERE phase=1 AND status='available' AND number>=101) AS paid_free,
    (SELECT price_usd_cents FROM slots WHERE phase=${CURRENT} LIMIT 1) AS price,
    (SELECT COUNT(*) FROM slots WHERE number<101 AND status='available') AS founder_free`).first();
  const phase=row?.phase??null;
  if(phase===null)return {mode:'closed_archive',currentPhase:null,priceUsdCents:null,checkoutOpen:false};
  if(phase===4)return {mode:'premium_admission',currentPhase:4,priceUsdCents:row.price,checkoutOpen:false};
  if(phase===1&&row.paid_free===0&&row.founder_free>0)return {mode:'awaiting_founder_allocation',currentPhase:1,priceUsdCents:row.price,checkoutOpen:false};
  return {mode:'selling',currentPhase:phase,priceUsdCents:row.price,checkoutOpen:true};
}
async function legacyStats(db){
  const slotCounts=await db.prepare(`SELECT SUM(CASE WHEN status IN ('assigned','retired') THEN 1 ELSE 0 END) occupied,SUM(CASE WHEN status='held' THEN 1 ELSE 0 END) held,
    SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) available,SUM(CASE WHEN status='retired' THEN 1 ELSE 0 END) retired,COUNT(*) capacity FROM slots`).first();
  const phases=await db.prepare(`SELECT phase,SUM(CASE WHEN status IN('available','held') THEN 1 ELSE 0 END) remaining,
    SUM(CASE WHEN status IN('available','held') AND number<101 THEN 1 ELSE 0 END) reserved FROM slots GROUP BY phase ORDER BY phase`).all();
  const published=await db.prepare("SELECT COUNT(*) total FROM companies WHERE publication_status='published'").first();
  const sectors=await db.prepare("SELECT COUNT(DISTINCT industry) total FROM companies WHERE publication_status='published' AND industry IS NOT NULL").first();
  const sales=await legacySales(db);
  const summaries=phases.results.map(p=>{const [firstPosition,lastPosition,priceUsdCents]=RANGES[p.phase];
    return {phase:p.phase,firstPosition,lastPosition,priceUsdCents,remaining:p.remaining,reservedByInvitation:p.reserved,forSale:p.remaining-p.reserved,
      status:p.phase===sales.currentPhase?'current':(sales.currentPhase===null||p.phase<sales.currentPhase)?'sold_out':'upcoming'};});
  return {capacity:1500,occupied:slotCounts.occupied||0,held:slotCounts.held||0,available:slotCounts.available||0,retired:slotCounts.retired||0,
    published:published.total||0,sectorsRepresented:sectors.total||0,currentPhase:sales.currentPhase,currentPriceUsdCents:sales.priceUsdCents,
    salesMode:sales.mode,checkoutOpen:sales.checkoutOpen,phases:summaries.filter(p=>p.status!=='upcoming')};
}
async function legacyMap(db){
  const rows=await db.prepare(`SELECT s.number,s.status,(s.status='assigned' AND c.publication_status='published' AND EXISTS(
    SELECT 1 FROM profile_versions v WHERE v.company_id=c.id AND v.published_at IS NOT NULL)) AS listed
    FROM slots s LEFT JOIN companies c ON c.id=s.company_id WHERE s.status IN('assigned','retired')`).all();
  const map=new Array(1500).fill('a');for(const r of rows.results)map[r.number-1]=r.status==='retired'?'x':r.listed?'p':'o';return map.join('');
}
const legacyMosaic=async db=>(await db.prepare(`SELECT c.slug,c.display_name AS name,c.country,c.industry,s.number AS position
  FROM companies c JOIN slots s ON s.company_id=c.id WHERE c.publication_status='published' AND s.status='assigned' AND EXISTS(
  SELECT 1 FROM profile_versions v WHERE v.company_id=c.id AND v.published_at IS NOT NULL) ORDER BY s.number ASC`).all()).results;
const legacyRetired=async db=>(await db.prepare(`SELECT number AS position FROM slots WHERE status='retired' ORDER BY number`).all()).results.map(r=>r.position);
async function legacyDirectory(db,f){
  const like=t=>t?`%${t.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`:null;const q=like(f.q),industry=like(f.industry),service=like(f.service);
  const where=`c.publication_status='published' AND s.status='assigned' AND EXISTS(SELECT 1 FROM profile_versions v WHERE v.company_id=c.id AND v.published_at IS NOT NULL)
    AND (? IS NULL OR c.country=?) AND (? IS NULL OR LOWER(COALESCE(c.industry,'')) LIKE ? ESCAPE '\\')
    AND (? IS NULL OR EXISTS(SELECT 1 FROM published_company_fts x WHERE x.company_id=c.id AND LOWER(x.services) LIKE ? ESCAPE '\\'))
    AND (? IS NULL OR LOWER(c.display_name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.industry,'')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.public_summary,'')) LIKE ? ESCAPE '\\')`;
  const args=[f.country||null,f.country||null,industry,industry,service,service,q,q,q,q];
  const count=await db.prepare(`SELECT COUNT(*) AS total FROM companies c JOIN slots s ON s.company_id=c.id WHERE ${where}`).bind(...args).first();
  const res=await db.prepare(`SELECT c.slug,c.display_name AS name,c.country,c.industry,${dir.localizedSummary(f.language)} AS summary,s.number AS position
    FROM companies c JOIN slots s ON s.company_id=c.id WHERE ${where} ORDER BY s.number ASC LIMIT 24 OFFSET ?`).bind(...args,(f.page-1)*24).all();
  return {items:res.results,page:f.page,pageSize:24,total:count?.total??0};
}
/** Every public answer, now, against the oracle. */
async function sameAsOracle(db,label=''){
  assert.deepEqual(await inv.getSalesState(db),await legacySales(db),`${label} sales state`);
  assert.deepEqual(await pub.getPublicStats(db),await legacyStats(db),`${label} stats`);
  assert.equal(await pub.getPositionMap(db),await legacyMap(db),`${label} map`);
  assert.deepEqual(await dir.listMosaicCompanies(db),await legacyMosaic(db),`${label} mosaic`);
  assert.deepEqual((await dir.listRetiredPositions(db)).items.map(i=>i.position),await legacyRetired(db),`${label} retired`);
  assert.deepEqual(await dir.listPublishedCompanies(db,{page:1}),await legacyDirectory(db,{page:1}),`${label} directory`);
}
/** Counts what a call really costs, statement by statement. */
function spy(db){
  const log=[];const note=(sql,r)=>log.push({sql,read:r.meta.rows_read});
  const stmt=(s,sql)=>({_s:s,bind:(...a)=>stmt(s.bind(...a),sql),
    all:async()=>{const r=await s.all();note(sql,r);return r;},
    first:async()=>{const r=await s.all();note(sql,r);return r.results[0]??null;},
    run:async()=>{const r=await s.run();note(sql,r);return r;},_sql:sql});
  return {log,reads:()=>log.reduce((n,l)=>n+l.read,0),db:{prepare:sql=>stmt(db.prepare(sql),sql),
    batch:async list=>{const rs=await db.batch(list.map(x=>x._s));rs.forEach((r,i)=>note(list[i]._sql,r));return rs;}}};
}
const DECL={language:'en',description:'We coordinate ocean freight and shipment visibility for US importers and logistics teams across the Atlantic.',
  descriptionEs:'Coordinamos fletes marítimos y visibilidad de envíos para importadores de Estados Unidos.',services:['Ocean freight'],audiences:['Importers'],
  problemSolutions:[{problem:'Importers lack status visibility',solution:'Consolidated tracking'}],serviceCountries:['US'],consent:{processingAuthorized:true,documentVersion:'c1'}};
let slotN=100;
async function publishedCompany(h,opts={}){
  const s=await seedCompany(h.db,opts);const num=opts.number??++slotN;
  await h.db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind=? WHERE number=?`).bind(s.companyId,num<=100?'founder':num>1350?'premium':'paid',num).run();
  const d=await pro.submitDeclaration(h.db,{},s.companyId,s.userId,pro.parseDeclaration(DECL));
  await pro.approveProfile(h.db,s.companyId,d.version,s.userId,d.contentDigest);
  await pro.publishProfile(h.db,s.companyId,d.version,new Date(),{PUBLIC_BASE_URL:'https://x.test'});
  return {...s,position:num};
}
const STATES={
  'open sale':async()=>{},
  'open sale with founders being allocated':async db=>{await fillFounder(db,1,40);await fillPaid(db,101,130);},
  'founders still free, paid places gone':async db=>{await fillPaid(db,101,600);},
  'all paid places of the tier held, none free':async(db,h)=>{await fillFounder(db,1,100);await fillPaid(db,101,599);
    const s=await seedCompany(db);await inv.createCheckoutHold(db,s.companyId,s.userId,key(),NOW);},
  'first tier just sold out, next one open':async db=>{await fillUpTo(db,600);},
  'mid second tier':async db=>{await fillUpTo(db,700);},
  'an old place reopened':async db=>{await fillUpTo(db,700);await db.prepare(`UPDATE slots SET status='available',company_id=NULL,assignment_kind=NULL WHERE number=300`).run();},
  'premium by request':async db=>{await fillUpTo(db,1350);},
  'premium half way':async db=>{await fillUpTo(db,1400);},
  'register exhausted':async db=>{await fillUpTo(db,1500);},
};
describe('every state of a sale answers as it did',()=>{
  for(const [name,arrange] of Object.entries(STATES))test(name,async()=>{
    const h=await freshDb();try{
      await arrange(h.db,h);await sameAsOracle(h.db,name);
      // Answered again, now from what was stored.
      await sameAsOracle(h.db,`${name} (stored)`);
      const sales=spy(h.db);await inv.getSalesState(sales.db);
      assert.ok(sales.reads()<=6,`${name}: sales state read ${sales.reads()} rows`);
    }finally{await h.dispose();}
  });
  test('each state reaches the checkout decision it should',async()=>{
    const expected={'open sale':'ok','founders still free, paid places gone':'PAID_CAPACITY_PENDING_FOUNDERS','all paid places of the tier held, none free':'PHASE_PENDING',
      'premium by request':'PREMIUM_ADMISSION_REQUIRED','register exhausted':'SALES_CLOSED','first tier just sold out, next one open':'ok','an old place reopened':'ok'};
    for(const [name,want] of Object.entries(expected)){
      const h=await freshDb();try{
        await STATES[name](h.db,h);const s=await seedCompany(h.db);
        const got=await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(),NOW).then(r=>r,e=>e.code);
        if(want==='ok'){assert.equal(typeof got,'object',name);if(name==='an old place reopened'){assert.equal(got.priceUsdCents,10000);assert.equal(got.phase,1);}}else assert.equal(got,want,name);
      }finally{await h.dispose();}
    }
  });
});
describe('real events update what the public sees, in the same answer',()=>{
  test('phase exhaustion: 5 places and 30 buyers, and the public numbers follow each step',async()=>{
    const h=await freshDb();try{
      await fillUpTo(h.db,595);await sameAsOracle(h.db,'before');
      const buyers=await Promise.all(Array.from({length:30},()=>seedCompany(h.db)));
      const results=await Promise.allSettled(buyers.map(s=>inv.createCheckoutHold(h.db,s.companyId,s.userId,key(),NOW)));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,5);
      const stats=await pub.getPublicStats(h.db);assert.equal(stats.held,5);assert.equal(stats.available,900);
      assert.deepEqual(stats,await legacyStats(h.db));
    }finally{await h.dispose();}
  });
  test('concurrent reservations and public reads at once: no double number, and the numbers settle true',async()=>{
    const h=await freshDb();try{
      const buyers=await Promise.all(Array.from({length:40},()=>seedCompany(h.db)));
      const mixed=await Promise.allSettled(buyers.flatMap(s=>[inv.createCheckoutHold(h.db,s.companyId,s.userId,key(),NOW),pub.getPublicStats(h.db),home.loadHome(h.db,'en')]));
      assert.deepEqual(mixed.filter(r=>r.status==='rejected').map(r=>r.reason.code),[]);
      const held=(await h.db.prepare(`SELECT number FROM slots WHERE status='held' ORDER BY number`).all()).results.map(r=>r.number);
      assert.equal(new Set(held).size,40);assert.equal(held[0],101);assert.equal(held[39],140);
      await sameAsOracle(h.db,'after the race');
      assert.equal((await pub.getPublicStats(h.db)).held,40);
    }finally{await h.dispose();}
  });
  test('availability read in the middle of changes is never older than the last finished change',async()=>{
    const h=await freshDb();try{
      for(let i=1;i<=12;i++){const s=await seedCompany(h.db);
        const [,mid]=await Promise.all([inv.createCheckoutHold(h.db,s.companyId,s.userId,key(),NOW),pub.getPublicStats(h.db)]);
        assert.ok(mid.held===i||mid.held===i-1,`read ${mid.held} around hold ${i}`);
        assert.equal((await pub.getPublicStats(h.db)).held,i);
      }
    }finally{await h.dispose();}
  });
  test('an expired reservation returns the place and the public numbers say so',async()=>{
    const h=await freshDb();try{
      const s=await seedCompany(h.db);await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(),NOW);
      assert.equal((await pub.getPublicStats(h.db)).held,1);
      const map=await pub.getPositionMap(h.db);
      await inv.expireStaleHolds(h.db,new Date(NOW.getTime()+21*60000));
      const stats=await pub.getPublicStats(h.db);assert.equal(stats.held,0);assert.equal(stats.available,1500);
      assert.equal(await pub.getPositionMap(h.db),map,'a reservation never showed on the wall');
      await sameAsOracle(h.db,'after expiry');
    }finally{await h.dispose();}
  });
  test('a reservation does not make anyone rebuild the wall',async()=>{
    const h=await freshDb();try{
      await home.loadHome(h.db,'en');
      const rev=()=>h.db.prepare(`SELECT revision FROM read_model_revisions WHERE scope='catalog'`).first();
      const before=await rev();const s=await seedCompany(h.db);await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(),NOW);
      assert.deepEqual(await rev(),before);
      const seen=spy(h.db);await home.loadHome(seen.db,'en');
      assert.ok(seen.log.every(l=>!/profile_versions v WHERE v.company_id=c.id/.test(l.sql)),'the catalog was not recomputed');
    }finally{await h.dispose();}
  });
  test('founder award and its revocation: order and numbers intact',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);await h.db.prepare(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,'test')`).bind(admin.userId,NOW.toISOString()).run();
      const f=await seedCompany(h.db);
      await pub.getPublicStats(h.db);
      const invite=await adm.inviteFounder(h.db,admin.userId,f.companyId,NOW);
      await adm.acceptFounderInvitation(h.db,invite.invitationId,f.userId,NOW);
      const award=await adm.awardFounder(h.db,admin.userId,invite.invitationId,'selected','case-1',NOW);
      assert.equal(award.slotNumber,1);
      await sameAsOracle(h.db,'after award');assert.equal((await pub.getPublicStats(h.db)).occupied,1);
      await adm.revokeFounderAward(h.db,admin.userId,f.companyId,'changed','case-2',NOW);
      await sameAsOracle(h.db,'after revocation');assert.equal((await pub.getPublicStats(h.db)).occupied,0);
    }finally{await h.dispose();}
  });
  test('Premium: requested, assigned in order, at its price, no checkout',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);await h.db.prepare(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,'test')`).bind(admin.userId,NOW.toISOString()).run();
      await fillUpTo(h.db,1350);await sameAsOracle(h.db,'premium open');
      const s=await seedCompany(h.db);
      await assert.rejects(inv.createCheckoutHold(h.db,s.companyId,s.userId,key(),NOW),e=>e.code==='PREMIUM_ADMISSION_REQUIRED');
      const r=await adm.submitPremiumRequest(h.db,s.companyId,s.userId,{message:'We would like to apply for a position.',contactPreference:'email'});
      await adm.updatePremiumRequest(h.db,admin.userId,r.requestId,'in_review','evaluating','email-1');
      await adm.updatePremiumRequest(h.db,admin.userId,r.requestId,'accepted','accepted','meeting-1');
      assert.equal((await adm.assignPremium(h.db,admin.userId,r.requestId,'funds_ok','bank-ref')).position,1351);
      await sameAsOracle(h.db,'after premium');const stats=await pub.getPublicStats(h.db);
      assert.equal(stats.currentPriceUsdCents,506600);assert.equal(stats.checkoutOpen,false);assert.equal(stats.phases.find(p=>p.phase===4).remaining,149);
    }finally{await h.dispose();}
  });
  test('publication, withdrawal and retirement reach wall, directory and numbers at once',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);
      const a=await publishedCompany(h,{slug:'first-co',name:'First Co',industry:'Logistics'});
      await sameAsOracle(h.db,'published');
      assert.equal((await pub.getPositionMap(h.db))[a.position-1],'p');
      assert.equal((await dir.listMosaicCompanies(h.db)).at(-1).slug,'first-co');
      assert.equal((await pub.getPublicStats(h.db)).published,1);
      const b=await publishedCompany(h,{slug:'second-co',name:'Second Co',industry:'Accounting',country:'CO'});
      assert.equal((await pub.getPublicStats(h.db)).sectorsRepresented,2);
      const r=await adm.requestService(h.db,a.companyId,a.userId,'withdrawal','Closing');
      await adm.executeWithdrawal(h.db,admin.userId,a.companyId,r.requestId,'owner_request','ticket-1');
      await sameAsOracle(h.db,'withdrawn');
      assert.equal((await pub.getPositionMap(h.db))[a.position-1],'x');
      assert.deepEqual((await dir.listRetiredPositions(h.db)).items.map(i=>i.position),[a.position]);
      assert.equal((await dir.listMosaicCompanies(h.db)).some(c=>c.slug==='first-co'),false);
      const after=await dir.listPublishedCompanies(h.db,{page:1});assert.equal(after.total,1);assert.equal(after.items[0].slug,'second-co');
      assert.equal((await pub.getPublicStats(h.db)).retired,1);assert.ok(b);
    }finally{await h.dispose();}
  });
  test('suspension and reactivation move no public number by themselves',async()=>{
    const h=await freshDb();try{
      const admin=await seedCompany(h.db);await h.db.prepare(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,'test')`).bind(admin.userId,NOW.toISOString()).run();
      const c=await publishedCompany(h,{slug:'paused-co',name:'Paused Co'});
      const at=NOW.toISOString(),due=new Date(NOW.getTime()+86400000).toISOString();
      await h.db.prepare(`INSERT INTO onboarding_cases(company_id,origin,status,started_at,form_due_at,extension_due_at,reactivation_due_at,suspended_at) VALUES(?,'paid','suspended',?,?,?,?,?)`)
        .bind(c.companyId,at,at,at,due,at).run();
      const before=await pub.getPublicStats(h.db);
      await adm.requestReactivation(h.db,c.companyId,NOW);
      await adm.decideReactivation(h.db,admin.userId,c.companyId,'approved','reviewed','ticket-2',NOW);
      assert.deepEqual(await pub.getPublicStats(h.db),before);await sameAsOracle(h.db,'reactivated');
    }finally{await h.dispose();}
  });
});
describe('the database stays the authority of a sale',()=>{
  const poison=(db,scope,payload)=>db.prepare(`INSERT INTO read_models(key,revision,payload,built_at)
    SELECT ?,revision,?,'x' FROM read_model_revisions WHERE scope=? ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,revision=excluded.revision`).bind(`${scope}:v1`,payload,scope).run();
  test('a stored payload claiming the sale is open cannot sell a closed register',async()=>{
    const h=await freshDb();try{
      await fillUpTo(h.db,1500);await pub.getPublicStats(h.db);
      await poison(h.db,'commerce',JSON.stringify({checkoutOpen:true,salesMode:'selling',currentPhase:1,currentPriceUsdCents:1,phases:[]}));
      const s=await seedCompany(h.db);
      await assert.rejects(inv.createCheckoutHold(h.db,s.companyId,s.userId,key(),NOW),e=>e.code==='SALES_CLOSED');
      assert.equal(await h.db.prepare(`SELECT COUNT(*) n FROM slots WHERE status='held'`).first('n'),0);
    }finally{await h.dispose();}
  });
  test('a stored payload claiming the sale is closed cannot stop one, nor change its price',async()=>{
    const h=await freshDb();try{
      await poison(h.db,'commerce',JSON.stringify({checkoutOpen:false,salesMode:'closed_archive',currentPhase:null,currentPriceUsdCents:null,phases:[]}));
      const s=await seedCompany(h.db);const hold=await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(),NOW);
      assert.equal(hold.priceUsdCents,10000);
      assert.equal(await h.db.prepare(`SELECT number FROM slots WHERE status='held'`).first('number'),101);
      await sameAsOracle(h.db,'the real change replaced the bad payload');
    }finally{await h.dispose();}
  });
  test('checkout and adjudication code never reads the read models',()=>{
    const fs=require('node:fs'),path=require('node:path');
    for(const f of ['inventory','payments','admin','stripe','cases'])
      assert.equal(/read-model|read_models/.test(fs.readFileSync(path.join(__dirname,`../../src/core/${f}.ts`),'utf8')),false,f);
  });
  test('an older rebuild cannot overwrite a newer one, and the answer stays right',async()=>{
    const h=await freshDb();try{
      await pub.getPublicStats(h.db);
      await h.db.prepare(`UPDATE read_models SET revision=9999,payload='{"stale":true}' WHERE key='commerce:v1'`).run();
      const stats=await pub.getPublicStats(h.db);assert.deepEqual(stats,await legacyStats(h.db));
      assert.equal(await h.db.prepare(`SELECT revision FROM read_models WHERE key='commerce:v1'`).first('revision'),9999);
    }finally{await h.dispose();}
  });
  test('a revision moves with its change or not at all: a failed batch leaves it where it was',async()=>{
    const h=await freshDb();try{
      const rev=()=>h.db.prepare(`SELECT revision FROM read_model_revisions WHERE scope='commerce'`).first('revision');
      const before=await rev();
      await assert.rejects(h.db.batch([h.db.prepare(`UPDATE slots SET status='held' WHERE number=500`),h.db.prepare(`INSERT INTO slots(number,phase,price_usd_cents) VALUES(9999,1,1)`)]));
      assert.equal(await rev(),before);assert.equal(await h.db.prepare(`SELECT status FROM slots WHERE number=500`).first('status'),'available');
      await h.db.prepare(`UPDATE slots SET status='held' WHERE number=500`).run();assert.equal(await rev(),before+1);
    }finally{await h.dispose();}
  });
});
describe('the shared data holds nothing private',()=>{
  test('no session, user, email, hold or internal company id in any stored payload, in either language',async()=>{
    const h=await freshDb();try{
      const a=await publishedCompany(h,{slug:'open-co',name:'Open Co',email:'secret-owner@open-co.example'});
      const b=await seedCompany(h.db,{email:'buyer@secret.example'});const hold=await inv.createCheckoutHold(h.db,b.companyId,b.userId,key(),NOW);
      await home.loadHome(h.db,'en');await home.loadHome(h.db,'es');await join.loadJoin(h.db,{},'es');
      const rows=(await h.db.prepare(`SELECT key,payload FROM read_models`).all()).results;
      assert.deepEqual(rows.map(r=>r.key).sort(),['catalog:v1','commerce:v1','mosaic:v1']);
      for(const r of rows){
        for(const secret of [a.companyId,a.userId,b.companyId,b.userId,hold.holdId,'secret-owner','buyer@','@'])assert.equal(r.payload.includes(secret),false,`${r.key} holds ${secret}`);
        assert.equal(/session|cookie|email|user_?id|company_?id|hold_?id|founder/i.test(r.payload),false,r.key);
      }
    }finally{await h.dispose();}
  });
  test('English and Spanish share the numbers and keep their own words',async()=>{
    const h=await freshDb();try{
      const c=await publishedCompany(h,{slug:'both-co',name:'Both Co'});
      const [en,es]=await Promise.all([home.loadHome(h.db,'en'),home.loadHome(h.db,'es')]);
      assert.deepEqual(en.stats,es.stats);assert.equal(en.positionMap,es.positionMap);assert.deepEqual(en.companies,es.companies);
      assert.equal(en.sample.profile.summary.startsWith('We coordinate'),true);assert.equal(es.sample.profile.summary.startsWith('Coordinamos'),true);
      assert.equal(es.sample.profile.html,'/es/empresas/both-co');assert.equal(en.sample.profile.html,'/empresas/both-co');
      assert.equal(en.retiredLabel,'Position retired — Not available');assert.equal(es.retiredLabel,'Cupo retirado — No disponible');
      assert.ok(c);
    }finally{await h.dispose();}
  });
  test('the directory answers filters as it did, including past the last page',async()=>{
    const h=await freshDb();try{
      for(let i=0;i<26;i++)await publishedCompany(h,{slug:`co-${i}`,name:i%2?`Harbor ${i}`:`Mill ${i}`,industry:i%3?'Logistics':'Accounting',country:i%4?'US':'CO'});
      for(const f of [{page:1},{page:2},{page:3},{page:1,language:'es'},{page:1,q:'harbor'},{page:2,q:'harbor'},{page:9,q:'harbor'},{page:1,country:'CO'},{page:1,industry:'accounting'},
        {page:1,service:'ocean'},{page:1,q:'nothing-matches'},{page:1,q:'100%_'}])
        assert.deepEqual(await dir.listPublishedCompanies(h.db,f),await legacyDirectory(h.db,f),JSON.stringify(f));
    }finally{await h.dispose();}
  });
});
describe('what a page costs',()=>{
  let h;before(async()=>{h=await freshDb();await publishedCompany(h,{slug:'cost-co',name:'Cost Co'});await fillFounder(h.db,1,100);await fillPaid(h.db,200,1300);
    await home.loadHome(h.db,'en');await pub.getPublicStats(h.db);});after(()=>h.dispose());
  const noRepeats=log=>{const seen=new Set();for(const l of log){assert.equal(seen.has(l.sql),false,`repeated: ${l.sql.slice(0,80)}`);seen.add(l.sql);}};
  test('the Home reads a handful of rows, with no statement twice',async()=>{const s=spy(h.db);await home.loadHome(s.db,'en');assert.ok(s.reads()<=20,`read ${s.reads()}`);noRepeats(s.log);});
  test('the join page reads less than the Home and never asks for the list of companies',async()=>{
    const s=spy(h.db);const data=await join.loadJoin(s.db,{},'en');assert.ok(s.reads()<=20,`read ${s.reads()}`);
    assert.equal(s.log.filter(l=>/findPublic|JOIN profile_versions/.test(l.sql)).length,1,'the demo profile is read once');
    assert.equal('companies' in data.home,false);assert.equal('retiredPositions' in data.home,false);
    assert.ok(s.log.every(l=>l.sql.split('?').length<=3),'only the catalog key, not the wall');
  });
  test('public statistics read two stored rows per scope',async()=>{const s=spy(h.db);await pub.getPublicStats(s.db);assert.ok(s.reads()<=6,`read ${s.reads()}`);});
  test('the directory reads the shared data once, whichever the page',async()=>{
    const s=spy(h.db);await pub.loadDirectory(s.db,{page:1});assert.equal(s.log.filter(l=>/read_model_revisions/.test(l.sql)).length,2,'one per scope');
    assert.ok(s.reads()<=120,`read ${s.reads()}`);
  });
});
