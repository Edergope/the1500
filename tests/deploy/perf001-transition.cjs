// DEPLOY-001: the PERF-001 transition and its rollback, on one local D1 that keeps its data from start to end.
// Three builds of the core run against the same database, in the order staging goes through:
//   old     5dd7122, the Worker in staging (strict `changes` checks, no read models)
//   bridge  5dd7122 plus the four tolerant checks of PERF-001: correct with and without migration 0010
//   new     c3387c4, PERF-001 (read models; needs 0010)
// Each build is the output of `tsc -p tsconfig.core-runtime-test.json` in a worktree of that commit.
//   node tests/deploy/perf001-transition.cjs --old <worktree> --bridge <worktree> --new <worktree>
// Local only. It never touches a remote database.
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const arg=k=>{const i=process.argv.indexOf(`--${k}`);if(i<0)throw new Error(`--${k} <worktree> is required`);return path.resolve(process.argv[i+1]);};
const trees={old:arg('old'),bridge:arg('bridge'),new:arg('new')};
const ROOT=path.join(__dirname,'../..');
const {getPlatformProxy}=require(path.join(ROOT,'node_modules/wrangler'));
const core=(v,m)=>require(path.join(trees[v],'.core-js-tests/core',`${m}.js`));
const NOW=new Date('2026-11-06T01:00:00.000Z');
const ROLLBACK=`DROP TRIGGER IF EXISTS trg_rm_commerce_slots;DROP TRIGGER IF EXISTS trg_rm_catalog_slots;
DROP TRIGGER IF EXISTS trg_rm_catalog_company_insert;DROP TRIGGER IF EXISTS trg_rm_catalog_company_update;DROP TRIGGER IF EXISTS trg_rm_catalog_company_delete;
DROP TRIGGER IF EXISTS trg_rm_catalog_profile_insert;DROP TRIGGER IF EXISTS trg_rm_catalog_profile_update;DROP TRIGGER IF EXISTS trg_rm_catalog_profile_delete;
DROP TABLE IF EXISTS read_models;DROP TABLE IF EXISTS read_model_revisions;DELETE FROM d1_migrations WHERE name='0010_perf001.sql'`;

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'the1500-transition-'));
const migrate=tree=>execFileSync(path.join(ROOT,'node_modules/.bin/wrangler'),['d1','migrations','apply','DB','--local','--persist-to',dir],
  {cwd:tree,stdio:'pipe',env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}}).toString();
let proxy,db;
const open=async()=>{proxy=await getPlatformProxy({configPath:path.join(trees.old,'wrangler.jsonc'),persist:{path:path.join(dir,'v3')}});db=proxy.env.DB;};
const close=async()=>{await proxy.dispose();};
const log=(...a)=>console.log(...a);
let n=0,keyN=0;const key=()=>`transition_key_${String(++keyN).padStart(6,'0')}`;

async function seed(){
  const id=`tr${++n}`;
  await db.batch([db.prepare(`INSERT INTO users(id,email) VALUES(?,?)`).bind(`u-${id}`,`owner@${id}.example`),
    db.prepare(`INSERT INTO companies(id,display_name,slug,country,industry,website,identity_state) VALUES(?,?,?,?,?,?,'self_declared')`)
      .bind(id,`Transition ${n}`,`transition-${n}`,'US','Logistics',`${id}.example`),
    db.prepare(`INSERT INTO memberships(user_id,company_id,role) VALUES(?,?,'owner')`).bind(`u-${id}`,id)]);
  return {companyId:id,userId:`u-${id}`};
}
const DECL={language:'en',description:'We coordinate ocean freight and shipment visibility for US importers and logistics teams across the Atlantic.',
  descriptionEs:'Coordinamos fletes marítimos y visibilidad de envíos para importadores de Estados Unidos.',services:['Ocean freight'],audiences:['Importers'],
  problemSolutions:[{problem:'Importers lack status visibility',solution:'Consolidated tracking'}],serviceCountries:['US'],consent:{processingAuthorized:true,documentVersion:'c1'}};
let paidN=150;
/** A company in a paid position that publishes its profile through the code of version v. */
async function publish(v){
  const pro=core(v,'profiles');const s=await seed();
  await db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind='paid' WHERE number=?`).bind(s.companyId,++paidN).run();
  const d=await pro.submitDeclaration(db,{},s.companyId,s.userId,pro.parseDeclaration(DECL));
  await pro.approveProfile(db,s.companyId,d.version,s.userId,d.contentDigest);
  return pro.publishProfile(db,s.companyId,d.version,NOW,{PUBLIC_BASE_URL:'https://x.test'});
}
let admin;
async function award(v){
  const adm=core(v,'admin');const f=await seed();
  const invite=await adm.inviteFounder(db,admin.userId,f.companyId,NOW);
  await adm.acceptFounderInvitation(db,invite.invitationId,f.userId,NOW);
  return adm.awardFounder(db,admin.userId,invite.invitationId,'selected','transition-case',NOW);
}
async function hold(v){const s=await seed();return core(v,'inventory').createCheckoutHold(db,s.companyId,s.userId,key(),NOW);}

/** What the tables say, read directly. Every public answer must match it. */
async function truth(){
  const s=await db.prepare(`SELECT SUM(status IN('assigned','retired')) AS occupied,SUM(status='held') AS held,SUM(status='available') AS available,COUNT(*) AS capacity FROM slots`).first();
  const p=await db.prepare(`SELECT COUNT(*) AS n FROM companies WHERE publication_status='published'`).first();
  return {occupied:s.occupied,held:s.held,available:s.available,capacity:s.capacity,published:p.n};
}
async function publicMatches(v,label){
  const t=await truth(),st=await core(v,'public').getPublicStats(db);
  assert.deepEqual({occupied:st.occupied,held:st.held,available:st.available,capacity:st.capacity,published:st.published},t,`${label}: public stats differ from the tables`);
  return t;
}
const counts=async()=>Object.fromEntries(await Promise.all(['users','companies','memberships','sessions','slots','slot_holds','slot_audit','profile_versions','platform_admins','admin_events']
  .map(async t=>[t,(await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n])));
const hasTriggers=async()=>(await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_rm_%'`).first()).n;
const revisions=async()=>Object.fromEntries((await db.prepare(`SELECT scope,revision FROM read_model_revisions`).all()).results.map(r=>[r.scope,r.revision]));

/** The operations whose `changes` check the triggers affect: a reservation, a publication and a founder award. */
async function writes(v,label){
  const h=await hold(v);
  const held=await db.prepare(`SELECT slot_number AS n FROM slot_holds WHERE id=? AND status='active'`).bind(h.holdId).first();
  assert.ok(held?.n>100,`${label}: reservation`);
  const p=await publish(v);assert.equal(p.status,'published',`${label}: publication`);
  const a=await award(v);assert.ok(a.slotNumber>=1&&a.slotNumber<=100,`${label}: founder award`);
  await core(v,'inventory').releaseHold(db,h.holdId,NOW);
  return {held:held.n,published:p.slotNumber,founder:a.slotNumber};
}

(async()=>{
  try{
    log('1. Schema 0001-0009, as staging is today');
    migrate(trees.old);await open();
    admin=await seed();await db.prepare(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,'transition')`).bind(admin.userId,NOW.toISOString()).run();
    await publish('old');await publish('old');const kept=await hold('old');
    await db.prepare(`INSERT INTO sessions(id,user_id,token_digest,created_at,expires_at) VALUES('tr-session',?,'tr-digest',?,?)`).bind(admin.userId,NOW.toISOString(),new Date(NOW.getTime()+864e5).toISOString()).run();
    log('   old code: data, an active reservation and a session',await publicMatches('old','old/0009'));

    log('2. Bridge Worker on the old schema');
    log('   writes',await writes('bridge','bridge/0009'),'public',await publicMatches('bridge','bridge/0009'));

    log('3. Migration 0010, with the reservation of step 1 still active');
    const before=await counts();await close();migrate(trees.new);await open();
    assert.deepEqual(await counts(),before,'0010 changed existing rows');assert.equal(await hasTriggers(),8);
    assert.equal((await db.prepare(`SELECT status FROM slot_holds WHERE id=?`).bind(kept.holdId).first()).status,'active','the reservation survived');
    log('   rows unchanged, 8 triggers, reservation still active, revisions',await revisions());

    log('4. Bridge Worker on schema 0010');
    const r0=await revisions();
    log('   writes',await writes('bridge','bridge/0010'),'public',await publicMatches('bridge','bridge/0010'));
    const r1=await revisions();assert.ok(r1.commerce>r0.commerce&&r1.catalog>r0.catalog,'the triggers moved the revisions');
    log('   revisions moved',r0,'->',r1);

    log('5. What the bridge prevents: the old Worker on schema 0010');
    const heldBefore=(await truth()).held;
    const oldHold=await hold('old').then(()=>'accepted',e=>e.code);
    const heldAfter=(await truth()).held;
    log(`   old reservation answered ${oldHold}; positions held ${heldBefore} -> ${heldAfter}`);
    assert.notEqual(oldHold,'accepted');assert.equal(heldAfter,heldBefore+1,'the old Worker kept the position while telling the buyer it failed');
    // The orphan reservation is released, as its expiry would do, so the next steps start from the same inventory.
    for (const o of (await db.prepare(`SELECT id FROM slot_holds WHERE status='active' AND id<>?`).bind(kept.holdId).all()).results)
      await core('bridge','inventory').releaseHold(db,o.id,NOW);
    assert.equal((await truth()).held,heldBefore);

    log('6. PERF-001 Worker on schema 0010');
    const pub=core('new','public'),rm=core('new','read-model');
    log('   first read, builds the models',await publicMatches('new','new/0010 first'));
    const built=(await db.prepare(`SELECT COUNT(*) AS n FROM read_models`).first()).n;assert.ok(built>=1);
    await publicMatches('new','new/0010 second');
    log('   writes',await writes('new','new/0010'),'public after writes',await publicMatches('new','new/0010 after writes'));
    assert.equal((await rm.readCatalog(db)).positionMap,(await core('new','public').getPositionMap(db)),'mosaic');

    log('7. Rollback, first half: Worker back to the bridge, triggers still in place');
    log('   writes',await writes('bridge','rollback bridge/0010'),'public',await publicMatches('bridge','rollback bridge/0010'));
    log('   PERF-001 again after the rollback: stale models are rebuilt',await publicMatches('new','new after bridge'));

    log('8. Rollback, second half: the 0010 objects removed, bridge still serving');
    const pre=await counts();
    await db.batch(ROLLBACK.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
    assert.equal(await hasTriggers(),0);assert.deepEqual(await counts(),pre,'the rollback changed rows');
    log('   writes',await writes('bridge','bridge/0009 again'),'public',await publicMatches('bridge','bridge/0009 again'));
    log('   old Worker, now safe again',await writes('old','old/0009 again'),await publicMatches('old','old/0009 again'));

    log('9. Forward again: 0010 re-applies over the rolled-back database');
    await close();migrate(trees.new);await open();assert.equal(await hasTriggers(),8);
    log('   PERF-001',await writes('new','new/0010 re-applied'),await publicMatches('new','new/0010 re-applied'));
    log('   final rows',await counts());
    log('OK: every step kept the data, and the public numbers matched the tables in each one.');
  }finally{if(proxy)await close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error('FAILED',e);process.exit(1);});
