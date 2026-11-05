// ADMIN-001: what the control center reads, against the data it claims to show.
const {test,describe,before,after}=require('node:test');const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');const path=require('node:path');
const {freshDb,seedCompany,fillUpTo,ROOT}=require('../support/d1.cjs');
const core=p=>require(`../../.core-js-tests/core/${p}.js`);
const con=core('admin-console'),adm=core('admin'),pro=core('profiles'),inv=core('inventory');
const {diffJson}=require('../../.core-js-tests/lib/json-diff.js');
const NOW=new Date('2026-11-05T20:00:00.000Z');
const DECL=(extra={})=>({language:'en',description:'We coordinate ocean freight and shipment visibility for US importers and logistics teams across the Atlantic.',
  descriptionEs:'Coordinamos fletes marítimos y visibilidad de envíos para importadores de Estados Unidos.',services:['Ocean freight'],audiences:['Importers'],
  problemSolutions:[{problem:'Importers lack status visibility',solution:'Consolidated tracking'}],serviceCountries:['US'],consent:{processingAuthorized:true,documentVersion:'c1'},...extra});
let slotN=200;
async function publishedCompany(h,opts={}){
  const s=await seedCompany(h.db,opts);const number=opts.number??++slotN;
  await h.db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind='paid',assigned_at=? WHERE number=?`).bind(s.companyId,NOW.toISOString(),number).run();
  const d=await pro.submitDeclaration(h.db,{},s.companyId,s.userId,pro.parseDeclaration(DECL()));
  await pro.approveProfile(h.db,s.companyId,d.version,s.userId,d.contentDigest);
  await pro.publishProfile(h.db,s.companyId,d.version,new Date(),{PUBLIC_BASE_URL:'https://x.test'});
  return {...s,position:number,version:d.version};
}
async function adminUser(h){const a=await seedCompany(h.db);await h.db.prepare(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,'test')`).bind(a.userId,NOW.toISOString()).run();return a;}
function spy(db){
  let read=0;const stmt=s=>({_s:s,bind:(...a)=>stmt(s.bind(...a)),all:async()=>{const r=await s.all();read+=r.meta.rows_read;return r;},first:async()=>{const r=await s.all();read+=r.meta.rows_read;return r.results[0]??null;},run:async()=>{const r=await s.run();read+=r.meta.rows_read;return r;}});
  return {reads:()=>read,db:{prepare:sql=>stmt(db.prepare(sql)),batch:async l=>{const rs=await db.batch(l.map(x=>x._s));rs.forEach(r=>read+=r.meta.rows_read);return rs;}}};
}
describe('authorization in the core',()=>{
  let h;before(async()=>{h=await freshDb();});after(()=>h.dispose());
  test('only an active, unrevoked administrator passes',async()=>{
    const a=await adminUser(h),b=await seedCompany(h.db);
    await adm.requirePlatformAdmin(h.db,a.userId);
    await assert.rejects(adm.requirePlatformAdmin(h.db,b.userId),e=>e.code==='ADMIN_ONLY'&&e.httpStatus===403);
    await h.db.prepare(`UPDATE platform_admins SET revoked_at=? WHERE user_id=?`).bind(NOW.toISOString(),a.userId).run();
    await assert.rejects(adm.requirePlatformAdmin(h.db,a.userId),e=>e.code==='ADMIN_ONLY');
    const c=await adminUser(h);await h.db.prepare(`UPDATE users SET status='blocked' WHERE id=?`).bind(c.userId).run();
    await assert.rejects(adm.requirePlatformAdmin(h.db,c.userId),e=>e.code==='ADMIN_ONLY');
  });
  test('the panel offers nothing that assigns or moves a position',()=>{
    const fs=require('node:fs');const dir=path.join(ROOT,'src/components/admin');
    const all=fs.readdirSync(dir).map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n');
    for(const route of ['premium/assign','founder-award','payments/resolve-late'])assert.equal(all.includes(route),false,route);
    assert.deepEqual([...new Set(all.match(/\/api\/v1\/admin\/[a-z/-]+/g))].sort(),['/api/v1/admin/company-action','/api/v1/admin/profiles/detail','/api/v1/admin/profiles/review','/api/v1/admin/review-company']);
  });
});
describe('the superadministrator procedure',()=>{
  const run=(h,...args)=>{try{return {ok:true,out:execFileSync('node',[path.join(ROOT,'scripts/superadmin.cjs'),...args,'--persist-to',h.dir],{cwd:ROOT,stdio:'pipe'}).toString()};}catch(e){return {ok:false,code:e.status,out:e.stderr.toString()+e.stdout.toString()};}};
  const signIn=(h,userId,at)=>h.db.prepare(`INSERT INTO auth_audit(id,user_id,kind,occurred_at) VALUES(?,?,'login_completed',?)`).bind(crypto.randomUUID(),userId,at.toISOString()).run();
  const crypto=require('node:crypto');const OWNER='first-owner@company.test';
  const grant=(h,userId,...extra)=>run(h,'grant',OWNER,'--user-id',userId,'--confirm',OWNER,'--authorized-by','Owner decision','--target','local',...extra);
  test('grant needs a fresh verified sign-in, the checked user id, a repeated email and a named authority',async()=>{
    const h=await freshDb();try{
      const s=await seedCompany(h.db,{email:OWNER});
      assert.match(run(h,'grant',OWNER,'--target','production').out,/local or staging/);
      assert.match(run(h,'grant',OWNER,'--user-id',s.userId,'--confirm',OWNER,'--target','local').out,/authorized-by/);
      assert.match(run(h,'grant',OWNER,'--user-id',s.userId,'--confirm','other@company.test','--authorized-by','Owner decision','--target','local').out,/repeat the same email/);
      assert.match(grant(h,s.userId).out,/older than one hour/,'never signed in');
      await signIn(h,s.userId,new Date(Date.now()-2*60*60*1000));
      assert.match(grant(h,s.userId).out,/older than one hour/,'stale sign-in');
      await signIn(h,s.userId,new Date());
      assert.match(grant(h,'someone-else').out,/does not match/);
      assert.match(run(h,'prepare',OWNER,'--target','local').out,new RegExp(`user id\\s+${s.userId}`));
      const done=grant(h,s.userId);assert.equal(done.ok,true,done.out);
      await adm.requirePlatformAdmin(h.db,s.userId);
      const event=await h.db.prepare(`SELECT admin_id,reason_code,evidence_reference FROM admin_events WHERE action='admin_granted'`).first();
      assert.deepEqual(event,{admin_id:s.userId,reason_code:'bootstrap',evidence_reference:'Owner decision'});
      assert.match(grant(h,s.userId).out,/already an active administrator/);
      const second=await seedCompany(h.db,{email:'second@company.test'});await signIn(h,second.userId,new Date());
      const again=run(h,'grant','second@company.test','--user-id',second.userId,'--confirm','second@company.test','--authorized-by','x y z','--target','local');
      assert.match(again.out,/non-demo administrator is already active/);
    }finally{await h.dispose();}
  });
  test('a demo address is never granted; an active demo administrator does not block the owner',async()=>{
    const h=await freshDb();try{
      const demo=await seedCompany(h.db,{email:'admin@demo-the1500.example'});await signIn(h,demo.userId,new Date());
      assert.match(run(h,'grant','admin@demo-the1500.example','--user-id',demo.userId,'--confirm','admin@demo-the1500.example','--authorized-by','x y z','--target','local').out,/demo address/);
      await h.db.prepare(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,'demo seed')`).bind(demo.userId,NOW.toISOString()).run();
      const s=await seedCompany(h.db,{email:OWNER});await signIn(h,s.userId,new Date());
      const done=grant(h,s.userId);assert.equal(done.ok,true,done.out);assert.match(done.out,/revoke-demo next/);
      assert.equal(run(h,'verify','--expect',OWNER,'--target','local').code,1,'two administrators is not the expected state');
      assert.match(run(h,'revoke-demo','--by','admin@demo-the1500.example','--authorized-by','Owner decision','--target','local').out,/not an active non-demo/);
      const r=run(h,'revoke-demo','--by',OWNER,'--authorized-by','Owner decision','--target','local');assert.equal(r.ok,true,r.out);
      await assert.rejects(adm.requirePlatformAdmin(h.db,demo.userId),e=>e.code==='ADMIN_ONLY');
      const ev=await h.db.prepare(`SELECT admin_id,subject_id,reason_code,evidence_reference FROM admin_events WHERE action='admin_revoked'`).all();
      assert.deepEqual(ev.results,[{admin_id:s.userId,subject_id:demo.userId,reason_code:'demo_access_removed',evidence_reference:'Owner decision'}]);
      const v=run(h,'verify','--expect',OWNER,'--target','local');assert.equal(v.ok,true,v.out);assert.match(v.out,/Only first-owner@company.test/);
      assert.match(run(h,'status','--target','local').out,/Active administrators on local: 1\. Revoked: 1\./);
      assert.match(run(h,'revoke-demo','--by',OWNER,'--authorized-by','Owner decision','--target','local').out,/Nothing to revoke/);
    }finally{await h.dispose();}
  });
  test('the demo tool prints sign-in links only for demo addresses, so a real account always goes through the inbox',()=>{
    let out='';try{execFileSync('node',[path.join(ROOT,'scripts/demo.cjs'),'link',OWNER,'--target','staging'],{cwd:ROOT,stdio:'pipe'});}catch(e){out=e.stderr.toString();}
    assert.match(out,/Only demo addresses/);
  });
  test('no application code can write platform_admins',()=>{
    const fs=require('node:fs');const hits=[];
    const walk=d=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);if(f.isDirectory())walk(p);else if(/platform_admins/.test(fs.readFileSync(p,'utf8'))&&/(INSERT|UPDATE|DELETE)[^;]*platform_admins/is.test(fs.readFileSync(p,'utf8')))hits.push(path.relative(ROOT,p));}};
    walk(path.join(ROOT,'src'));assert.deepEqual(hits,[]);
  });
});
describe('companies',()=>{
  let h,a,b,c;before(async()=>{h=await freshDb();
    a=await publishedCompany(h,{name:'Harbor Freight',slug:'harbor-freight',email:'ana@harbor.test',country:'US',industry:'Logistics',website:'harbor.test',number:150});
    b=await seedCompany(h.db,{name:'Andes 100% Legal',slug:'andes-legal',email:'bea@andes.example',country:'CO',industry:'Legal',state:'pending_review',website:'andes.test'});
    c=await seedCompany(h.db,{name:'Mill Works',slug:'mill-works',email:'cal@mill.test',country:'MX',industry:'Manufacturing',website:'mill.test'});
  });after(()=>h.dispose());
  const names=async f=>(await con.searchCompanies(h.db,{limit:50,offset:0,...f})).companies.map(x=>x.displayName);
  test('search by name, website, owner email, country, sector, identity, publication and position',async()=>{
    assert.deepEqual(await names({q:'harbor'}),['Harbor Freight']);
    assert.deepEqual(await names({q:'mill.test'}),['Mill Works']);
    assert.deepEqual(await names({email:'bea@'}),['Andes 100% Legal']);
    assert.deepEqual(await names({country:'MX'}),['Mill Works']);
    assert.deepEqual(await names({industry:'legal'}),['Andes 100% Legal']);
    assert.deepEqual(await names({identity:'pending_review'}),['Andes 100% Legal']);
    assert.deepEqual(await names({publication:'published'}),['Harbor Freight']);
    assert.deepEqual(await names({position:150}),['Harbor Freight']);
    assert.deepEqual(await names({q:'mill',email:'bea'}),[],'filters add up');
  });
  test('a percent sign or a quote is plain text, not syntax',async()=>{
    assert.deepEqual(await names({q:'100%'}),['Andes 100% Legal']);
    assert.deepEqual(await names({q:'%'}),['Andes 100% Legal']);
    assert.deepEqual(await names({q:"' OR 1=1 --"}),[]);
  });
  test('a demo company says so, and a real one does not',async()=>{
    const rows=(await con.searchCompanies(h.db,{limit:50,offset:0})).companies;
    assert.equal(rows.find(r=>r.displayName.startsWith('Andes')).isDemo,true);
    assert.equal(rows.find(r=>r.displayName.startsWith('Harbor')).isDemo,false);
    assert.equal(con.isDemoAddress('someone@company.example.com'),false);
  });
  test('an unfiltered page counts nothing and knows if more follow; a filtered page keeps its total; bad input is refused',async()=>{
    const p=await con.searchCompanies(h.db,{limit:2,offset:0});assert.equal(p.companies.length,2);assert.equal(p.total,null);assert.equal(p.hasMore,true);
    const q=await con.searchCompanies(h.db,{limit:2,offset:2});assert.equal(q.companies.length,1);assert.equal(q.total,null);assert.equal(q.hasMore,false);
    const f=await con.searchCompanies(h.db,{q:'i',limit:1,offset:0});assert.equal(f.total,2);assert.equal(f.hasMore,true);
    const none=await con.searchCompanies(h.db,{country:'BR',limit:5,offset:0});assert.equal(none.total,0);assert.equal(none.hasMore,false);
    await assert.rejects(con.searchCompanies(h.db,{limit:500,offset:0}),e=>e.code==='INVALID_LIMIT');
    await assert.rejects(con.searchCompanies(h.db,{limit:5,offset:-1}),e=>e.code==='INVALID_LIMIT');
    await assert.rejects(con.searchCompanies(h.db,{limit:5,offset:0,country:'colombia'}),e=>e.code==='INVALID_COUNTRY');
    await assert.rejects(con.searchCompanies(h.db,{limit:5,offset:0,position:1501}),e=>e.code==='INVALID_QUERY');
  });
  test('the file brings the company, its owner, its process and its history, and no secret',async()=>{
    const admin=await adminUser(h);
    await adm.companyAdminAction(h.db,admin.userId,a.companyId,'block_publication','legal_hold','ticket-77',NOW);
    const d=await con.getCompanyDossier(h.db,a.companyId);
    assert.equal(d.company.displayName,'Harbor Freight');assert.equal(d.company.position,150);assert.equal(d.company.publicationBlock,'admin_hold');
    assert.deepEqual(d.members.map(m=>[m.email,m.role,m.status]),[['ana@harbor.test','owner','active']]);
    assert.equal(d.versions.length,1);assert.equal(d.declarations.length,1);
    assert.ok(d.process.find(s=>s.step==='published').at);
    const event=d.timeline.find(e=>e.action==='block_publication');
    assert.deepEqual([event.actor,event.reasonCode,event.evidence],[admin.email,'legal_hold','ticket-77']);
    assert.ok(event.at);
    assert.ok(d.timeline.some(e=>e.action==='declaration_submitted'));assert.ok(d.timeline.some(e=>e.action==='consent_processing_authorization'));
    const times=d.timeline.map(e=>e.at);assert.deepEqual(times,[...times].sort().reverse(),'newest first');
    assert.equal(/token|digest|session|cookie/i.test(JSON.stringify(d)),false);
  });
  test('an unknown company is a 404',async()=>{await assert.rejects(con.getCompanyDossier(h.db,'nope'),e=>e.httpStatus===404);});
  test('existing review actions show up where the panel reads them',async()=>{
    const admin=await adminUser(h);
    await adm.reviewCompany(h.db,b.companyId,admin.userId,'approved','identity_ok','registry-1',NOW);
    const d=await con.getCompanyDossier(h.db,b.companyId);assert.equal(d.company.identityState,'admin_verified');
    assert.ok(d.timeline.some(e=>e.action==='company_review'&&e.evidence==='registry-1'));assert.ok(c);
  });
});
describe('profiles and their documents',()=>{
  let h,a;before(async()=>{h=await freshDb();a=await publishedCompany(h,{name:'Doc Co',slug:'doc-co',email:'doc@doc.test',industry:'Logistics'});});after(()=>h.dispose());
  test('every document of a version, told apart, with who approved it and when',async()=>{
    const d=await con.getProfileDossier(h.db,a.companyId,a.version);
    assert.equal(d.documents.declaration.description,DECL().description,'the original declaration, as received');
    assert.equal(d.documents.declaration.consent,undefined);
    assert.equal(d.documents.canonical.schemaVersion,2);
    assert.equal(d.documents.jsonld['@graph'].find(n=>n['@type']==='Organization').name,'Doc Co');
    assert.ok(d.documents.jsonldEs);
    assert.equal(d.stage,'published');assert.equal(d.isPublic,true);
    assert.equal(d.approval.by,'doc@doc.test');assert.ok(d.approval.at);assert.ok(d.publication.at);
    assert.equal(d.generator.kind,'deterministic');assert.equal(d.reviewStatus,'not_required');
    assert.equal(d.declaration.submittedBy,'doc@doc.test');
    assert.deepEqual(d.unsupportedClaims,[]);assert.ok(Object.keys(d.provenance).length>0);
    assert.ok(d.checks.length>=6);assert.ok(d.checks.every(c=>c.ok),JSON.stringify(d.checks));
  });
  test('a newer version is not the public one until it is approved and published',async()=>{
    const v2=await pro.submitDeclaration(h.db,{},a.companyId,a.userId,pro.parseDeclaration(DECL({services:['Ocean freight','Customs brokerage']})));
    const draft=await con.getProfileDossier(h.db,a.companyId,v2.version);
    assert.equal(draft.stage,'generated');assert.equal(draft.isPublic,false);assert.equal(draft.approval,null);assert.equal(draft.latestPublished,a.version);
    assert.equal(draft.checks.some(c=>c.id==='approval_matches_content'),false);
    assert.equal((await con.getProfileDossier(h.db,a.companyId,a.version)).isPublic,true);
    const changes=diffJson((await con.getProfileDossier(h.db,a.companyId,a.version)).documents.canonical,draft.documents.canonical);
    assert.ok(changes.some(c=>c.path==='services[1]'&&c.kind==='added'&&c.after==='Customs brokerage'),JSON.stringify(changes));
    assert.ok(changes.some(c=>c.path==='version'&&c.kind==='changed'));
    const list=await con.listProfileVersions(h.db,{stage:'generated',limit:10,offset:0});assert.deepEqual(list.profiles.map(p=>p.version),[v2.version]);
    const pub=await con.listProfileVersions(h.db,{stage:'published',q:'doc',limit:10,offset:0});assert.equal(pub.total,1);
    await assert.rejects(con.listProfileVersions(h.db,{stage:'x',limit:10,offset:0}),e=>e.code==='INVALID_QUERY');
  });
  test('stored content that is not what the owner approved is flagged, not hidden',async()=>{
    const h2=await freshDb();try{
      const b=await publishedCompany(h2,{name:'Tampered',slug:'tampered'});
      // Only by removing the schema's own protection can this happen: that protection is tested too.
      await assert.rejects(h2.db.prepare(`UPDATE profile_versions SET canonical_json='{}' WHERE company_id=? AND version=?`).bind(b.companyId,b.version).run());
      const triggers=(await h2.db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='profile_versions' AND name NOT LIKE 'trg_rm_%'`).all()).results;
      for(const t of triggers)await h2.db.exec(`DROP TRIGGER ${t.name}`);
      await h2.db.prepare(`UPDATE profile_versions SET public_jsonld='{"@graph":[]}' WHERE company_id=? AND version=?`).bind(b.companyId,b.version).run();
      const d=await con.getProfileDossier(h2.db,b.companyId,b.version);
      const failed=d.checks.filter(c=>!c.ok).map(c=>c.id).sort();
      assert.deepEqual(failed,['approval_matches_content','jsonld_en_structure','snapshot_matches_jsonld']);
    }finally{await h2.dispose();}
  });
  test('a pending version shows its unsupported claims, and the review stays on record',async()=>{
    const h3=await freshDb();try{
      const admin=await adminUser(h3);const s=await publishedCompany(h3,{name:'Claims',slug:'claims'});
      const canonical={...(await con.getProfileDossier(h3.db,s.companyId,s.version)).documents.canonical,version:2,unsupportedClaims:[{text:'Largest in the region',reason:'no_evidence'}]};
      await h3.db.prepare(`INSERT INTO profile_versions(company_id,version,canonical_json,public_jsonld,public_jsonld_es,created_at,review_status) VALUES(?,2,?,'{}','{}',?,'pending')`).bind(s.companyId,JSON.stringify(canonical),NOW.toISOString()).run();
      const before=await con.getProfileDossier(h3.db,s.companyId,2);
      assert.deepEqual(before.unsupportedClaims,[{text:'Largest in the region',reason:'no_evidence'}]);assert.equal(before.reviewStatus,'pending');
      await adm.reviewProfile(h3.db,admin.userId,s.companyId,2,'rejected','unsupported_claim','review-note-4',NOW);
      const after=await con.getProfileDossier(h3.db,s.companyId,2);
      assert.equal(after.reviewStatus,'rejected');assert.deepEqual([after.reviews[0].actor,after.reviews[0].reasonCode,after.reviews[0].evidence],[admin.email,'unsupported_claim','review-note-4']);
    }finally{await h3.dispose();}
  });
  test('an unknown version is a 404',async()=>{
    await assert.rejects(con.getProfileDossier(h.db,a.companyId,99),e=>e.httpStatus===404);
    await assert.rejects(con.getProfileDossier(h.db,a.companyId,0),e=>e.httpStatus===404);
  });
  test('structure checks say what is wrong',()=>{
    assert.deepEqual(con.validateCanonical(null),['not_an_object']);
    assert.ok(con.validateCanonical({schemaVersion:1}).includes('schemaVersion'));
    assert.deepEqual(con.validateJsonLd({}),['@graph']);assert.deepEqual(con.validateJsonLd({'@graph':[{'@type':'Thing'}]}),['Organization']);
    assert.deepEqual(con.validateJsonLd({'@graph':[{'@type':'Organization',name:'X'}]}),[]);
  });
  test('comparison tells added, removed and changed apart, down to the array item',()=>{
    assert.deepEqual(diffJson({a:1,b:[1,2],c:{d:null}},{a:2,b:[1],c:{d:null},e:'x'}),[
      {path:'a',kind:'changed',before:1,after:2},{path:'b[1]',kind:'removed',before:2},{path:'e',kind:'added',after:'x'}]);
    assert.deepEqual(diffJson({a:[1]},{a:[1]}),[]);
  });
});
describe('the audit trail and the overview',()=>{
  let h,admin,a;before(async()=>{h=await freshDb();admin=await adminUser(h);a=await publishedCompany(h,{name:'Audit Co',slug:'audit-co'});
    await adm.companyAdminAction(h.db,admin.userId,a.companyId,'block_publication','legal_hold','ticket-1',NOW);
    await adm.companyAdminAction(h.db,admin.userId,a.companyId,'clear_block','legal_cleared','ticket-2',new Date(NOW.getTime()+1000));});after(()=>h.dispose());
  test('events carry who, when, why and evidence, newest first, and can be filtered',async()=>{
    const all=await con.listAuditEvents(h.db,{limit:50,offset:0});
    assert.equal(all.total,null);assert.equal(all.hasMore,false);assert.equal(all.events.length,2);assert.deepEqual(all.events.map(e=>e.action),['clear_block','block_publication']);
    assert.deepEqual(all.actions,['block_publication','clear_block']);
    const e=all.events[1];assert.deepEqual([e.actor,e.reasonCode,e.evidence,e.companyName],[admin.email,'legal_hold','ticket-1','Audit Co']);assert.ok(e.occurredAt);
    assert.equal((await con.listAuditEvents(h.db,{action:'clear_block',limit:50,offset:0})).total,1);
    assert.equal((await con.listAuditEvents(h.db,{actor:'nobody',limit:50,offset:0})).total,0);
    assert.equal((await con.listAuditEvents(h.db,{subject:a.companyId,limit:1,offset:1})).events.length,1);
  });
  test('an audit entry cannot be changed or deleted',async()=>{
    await assert.rejects(h.db.prepare(`UPDATE admin_events SET evidence_reference='x'`).run());
    await assert.rejects(h.db.prepare(`DELETE FROM admin_events`).run());
  });
  test('every overview figure matches a direct count',async()=>{
    await seedCompany(h.db,{email:'demo@demo.example',state:'pending_review'});
    const buyer=await seedCompany(h.db);await inv.createCheckoutHold(h.db,buyer.companyId,buyer.userId,'idempotency_key_000777',NOW);
    const o=await con.getControlOverview(h.db);
    const n=async sql=>(await h.db.prepare(sql).first()).n;
    assert.equal(o.companies.total,await n(`SELECT COUNT(*) n FROM companies`));
    assert.equal(o.companies.pendingReview,await n(`SELECT COUNT(*) n FROM companies WHERE identity_state='pending_review'`));
    assert.equal(o.companies.demo,await n(`SELECT COUNT(*) n FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email LIKE '%.example'`));
    assert.equal(o.companies.real+o.companies.demo,o.companies.total);
    assert.equal(o.stats.published,await n(`SELECT COUNT(*) n FROM companies WHERE publication_status='published'`));
    assert.equal(o.stats.held,await n(`SELECT COUNT(*) n FROM slots WHERE status='held'`));
    assert.equal(o.stats.available,await n(`SELECT COUNT(*) n FROM slots WHERE status='available'`));
    assert.equal(o.profiles.versions,await n(`SELECT COUNT(*) n FROM profile_versions`));
    assert.equal(o.incidentsOpen,await n(`SELECT COUNT(*) n FROM incidents WHERE status='open'`));
    assert.equal(o.payments.attempts,0);
  });
  test('reading the panel writes nothing, and costs little without walking the inventory',async()=>{
    await con.getControlOverview(h.db);
    const before=await h.db.prepare(`SELECT (SELECT COUNT(*) FROM admin_events) a,(SELECT revision FROM read_model_revisions WHERE scope='commerce') c`).first();
    const s=spy(h.db);await con.getControlOverview(s.db);assert.ok(s.reads()<400,`overview read ${s.reads()}`);
    const t=spy(h.db);await con.searchCompanies(t.db,{limit:50,offset:0});assert.ok(t.reads()<200,`list read ${t.reads()}`);
    const after=await h.db.prepare(`SELECT (SELECT COUNT(*) FROM admin_events) a,(SELECT revision FROM read_model_revisions WHERE scope='commerce') c`).first();
    assert.deepEqual(after,before);
  });
  test('the panel page never asks on its own',()=>{
    const fs=require('node:fs');
    for(const f of ['src/components/admin/JsonWorkbench.tsx','src/ui/admin-actions.ts'])assert.equal(/setInterval|setTimeout|EventSource|WebSocket/.test(fs.readFileSync(path.join(ROOT,f),'utf8')),false,f);
  });
});

describe('migration 0011 (pending)',()=>{
  test('it holds indexes only, and the lists use them',async()=>{
    const fs=require('node:fs');const file=fs.readFileSync(path.join(ROOT,'db/pending/0011_admin_indexes.sql'),'utf8').replace(/--.*$/gm,'');
    const statements=file.split(';').map(x=>x.trim()).filter(Boolean);
    for(const x of statements)assert.match(x,/^CREATE INDEX IF NOT EXISTS /,x);
    assert.equal(fs.existsSync(path.join(ROOT,'db/migrations/0011_admin_indexes.sql')),false,'0011 waits for PERF-001 in staging');
    const h=await freshDb();try{
      await h.db.batch(statements.map(x=>h.db.prepare(x)));await h.db.batch(statements.map(x=>h.db.prepare(x)));
      const plan=async sql=>(await h.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()).results.map(r=>r.detail).join(' | ');
      assert.match(await plan(`SELECT id FROM companies c ORDER BY c.created_at DESC,c.id LIMIT 51`),/idx_companies_created/);
      assert.doesNotMatch(await plan(`SELECT id FROM companies c ORDER BY c.created_at DESC,c.id LIMIT 51`),/TEMP B-TREE/);
      assert.match(await plan(`SELECT v.company_id FROM profile_versions v ORDER BY COALESCE(v.created_at,v.published_at,'') DESC,v.company_id,v.version DESC LIMIT 51`),/idx_profile_versions_recent/);
      assert.match(await plan(`SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id='x' AND m.role='owner'`),/idx_memberships_company/);
      assert.match(await plan(`SELECT e.id FROM admin_events e ORDER BY e.occurred_at DESC,e.id LIMIT 51`),/idx_admin_events_recent/);
    }finally{await h.dispose();}
  });
});
