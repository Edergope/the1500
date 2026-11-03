// Runtime integration of ACTUAL transpiled TypeScript core functions.
// Test adapter is backed by Node SQLite, not by Cloudflare workerd.
const { DatabaseSync } = require('node:sqlite');
const { readFileSync, readdirSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const root=join(__dirname,'..');
const {inviteFounder,acceptFounderInvitation,requirePlatformAdmin,reviewCompany,getAdminOverview}=require('../.core-js-tests/core/admin.js');
const {parseProfile,createProfileDraft,approveProfile,publishProfile}=require('../.core-js-tests/core/profiles.js');
const {searchPublishedProfiles,answerFromPublishedProfiles,asFtsQuery}=require('../.core-js-tests/core/search.js');
const {createCheckoutHold}=require('../.core-js-tests/core/inventory.js');

class TestStatement {
  constructor(engine,sql,args=[]) {this.engine=engine;this.sql=sql;this.args=args;}
  bind(...args) {return new TestStatement(this.engine,this.sql,args);}
  async first() {return this.engine.sqlite.prepare(this.sql).get(...this.args)??null;}
  async all() {return {results:this.engine.sqlite.prepare(this.sql).all(...this.args)};}
  async run() {const r=this.engine.sqlite.prepare(this.sql).run(...this.args);return {meta:{changes:Number(r.changes)}};}
}
class TestD1 {
  constructor() {this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');
    for(const file of readdirSync(join(root,'db/migrations')).sort()) {
      if(file.endsWith('.sql'))this.sqlite.exec(readFileSync(join(root,'db/migrations',file),'utf8'));
    }
  }
  prepare(sql) {return new TestStatement(this,sql);}
  async batch(stmts) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const out=[];
      for(const s of stmts)out.push(await s.run());
      this.sqlite.exec('COMMIT');return out;
    } catch(e) {this.sqlite.exec('ROLLBACK');throw e;}
  }
}
async function run() {
  const now=new Date('2026-11-03T20:00:00.000Z');
  const db=new TestD1(),sql=db.sqlite;
  sql.exec("INSERT INTO users(id,email) VALUES ('admin','admin@the1500.example'),('owner','owner@ocean.example'),('outsider','outsider@example.com')");
  sql.prepare('INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,?)').run('admin',now.toISOString(),'manual-verification');
  sql.exec("INSERT INTO companies(id,display_name,slug,country,industry,identity_state,website) VALUES ('ocean','Ocean Line LLC','ocean-line','US','Ocean freight','self_declared','ocean.example')");
  sql.exec("INSERT INTO memberships(user_id,company_id,role) VALUES('owner','ocean','owner')");
  let checks=0;
  await requirePlatformAdmin(db,'admin');checks++;
  await assert.rejects(()=>requirePlatformAdmin(db,'owner'),e=>e.code==='ADMIN_ONLY');checks++;
  const overview=await getAdminOverview(db);
  assert.equal(overview.capacity,1500);checks++;
  const invited=await inviteFounder(db,'admin','ocean',now);
  assert.equal(invited.delivery,'owner_portal');checks++;
  await assert.rejects(()=>acceptFounderInvitation(db,invited.invitationId,'outsider',now),e=>e.code==='INVITATION_NOT_FOUND');checks++;
  const award=await acceptFounderInvitation(db,invited.invitationId,'owner',now);
  assert.equal(award.slotNumber,1);checks++;
  await assert.rejects(()=>acceptFounderInvitation(db,invited.invitationId,'owner',now),e=>e.code==='INVITATION_EXPIRED');checks++;
  assert.equal(sql.prepare('SELECT count(*) AS n FROM founder_awards').get().n,1);checks++;
  // Founder purchase must NOT also acquire paid inventory.
  await assert.rejects(()=>createCheckoutHold(db,'ocean','owner','key_for_a_unique_hold_2026',now),e=>e.code==='ALREADY_ALLOCATED');checks++;
  const input=parseProfile({descriptionEn:'We coordinate ocean freight and shipment visibility for US importers and global logistics teams.',
    services:['Ocean freight coordination','Shipment visibility'],audiences:['Importers'],
    problemSolutions:[{problem:'Importers lack shipment status visibility',solution:'We coordinate consolidated shipment updates'}],
    advantages:[],serviceCountries:['US','CO']});
  const draft=await createProfileDraft(db,'ocean','owner',input,now);assert.equal(draft.version,1);checks++;
  const before=await searchPublishedProfiles(db,'ocean freight logistics');assert.equal(before.count,0);checks++;
  await approveProfile(db,'ocean',draft.version,'owner',draft.contentDigest,now);checks++;
  const published=await publishProfile(db,'ocean',1,now);assert.equal(published.slotNumber,1);checks++;
  const search=await searchPublishedProfiles(db,'ocean shipment coordination');
  assert.equal(search.count,1);assert.equal(search.items[0].slug,'ocean-line');checks++;
  const answer=await answerFromPublishedProfiles(db,'Need support with ocean shipping?','en');
  assert.equal(answer.mode,'retrieval_only');assert.deepEqual(answer.citations.map(c=>c.slug),['ocean-line']);checks++;
  const none=await answerFromPublishedProfiles(db,'astronautic propulsion boosters');
  assert.equal(none.citations.length,0);checks++;
  assert.ok(asFtsQuery('" OR * drop table companies;').includes('"drop"'));checks++;
  sql.prepare('UPDATE companies SET publication_status=? WHERE id=?').run('withdrawn','ocean');
  assert.equal((await searchPublishedProfiles(db,'ocean freight')).count,0);checks++;
  assert.equal(sql.prepare("SELECT count(*) AS n FROM published_company_fts WHERE company_id='ocean'").get().n,0);checks++;
  // Admin may review, but cannot assert independent verification without an evidence reference.
  sql.exec("INSERT INTO companies(id,display_name,slug,country,industry,identity_state) VALUES ('pending','Pending Inc','pending','US','Services','pending_review')");
  await assert.rejects(()=>reviewCompany(db,'pending','admin','approved','documents_checked','',now),e=>e.code==='REVIEW_EVIDENCE_REQUIRED');checks++;
  const approved=await reviewCompany(db,'pending','admin','approved','documents_checked','internal case-2026-003',now);
  assert.equal(approved.identityState,'admin_verified');checks++;
  await assert.rejects(()=>reviewCompany(db,'pending','admin','approved','documents_checked','case-duplicate',now),e=>e.code==='REVIEW_CONFLICT');checks++;
  assert.equal(sql.prepare("SELECT count(*) AS n FROM admin_review_events WHERE company_id='pending'").get().n,1);checks++;
  await assert.rejects(()=>inviteFounder(db,'owner','pending',now),e=>e.code==='ADMIN_ONLY');checks++;
  console.log(`PASS ${checks} actual TypeScript core/runtime checks (Node SQLite D1 adapter; not workerd)`);
}
run().catch(e=>{console.error(e);process.exitCode=1});
