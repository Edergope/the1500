// DEPLOY-002: the five-minute cron reads what is due, not every case. With 0011 its cost stays flat as the register grows.
const {test,describe,before,after}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {freshDb,seedCompany,ROOT}=require('../support/d1.cjs');
const ops=require('../../.core-js-tests/core/ops.js');
const NOW=new Date('2026-11-06T12:00:00.000Z');const iso=d=>new Date(NOW.getTime()+d*864e5).toISOString();
const INDEXES=fs.readFileSync(path.join(ROOT,'db/migrations/0011_admin_indexes.sql'),'utf8').replace(/--.*$/gm,'');

describe('the cron with migration 0011',()=>{
  let h;const ids={};
  before(async()=>{
    h=await freshDb();await h.db.batch(INDEXES.split(';').map(s=>s.trim()).filter(Boolean).map(s=>h.db.prepare(s)));
    const add=async(name,status,form,extension,reactivation)=>{const s=await seedCompany(h.db);ids[name]=s.companyId;
      await h.db.prepare(`INSERT INTO onboarding_cases(company_id,origin,status,started_at,form_due_at,extension_due_at,reactivation_due_at) VALUES(?,'paid',?,?,?,?,?)`)
        .bind(s.companyId,status,iso(-40),iso(form),iso(extension),iso(reactivation)).run();};
    await add('extendedWaiting','extended',-10,5,30);
    await add('suspendedWaiting','suspended',-20,-10,20);
    await add('activeDue','active',-1,3,30);
    await add('extendedDue','extended',-10,-1,30);
    await add('suspendedDue','suspended',-30,-20,-1);
    await add('notYet','active',2,9,30);
  });
  after(()=>h.dispose());
  test('due cases move; cases waiting out a term are left alone',async()=>{
    await ops.maintenanceSweep(h.db,{PUBLIC_BASE_URL:'https://x.test'},NOW);
    const status=async k=>(await h.db.prepare(`SELECT status FROM onboarding_cases WHERE company_id=?`).bind(ids[k]).first()).status;
    assert.deepEqual({
      extendedWaiting:await status('extendedWaiting'),suspendedWaiting:await status('suspendedWaiting'),activeDue:await status('activeDue'),
      extendedDue:await status('extendedDue'),suspendedDue:await status('suspendedDue'),notYet:await status('notYet'),
    },{extendedWaiting:'extended',suspendedWaiting:'suspended',activeDue:'extended',extendedDue:'suspended',suspendedDue:'admin_review',notYet:'active'});
  });
  test('no deadline query walks the onboarding table',async()=>{
    const src=fs.readFileSync(path.join(ROOT,'src/core/ops.ts'),'utf8');
    const queries=[...src.matchAll(/`(SELECT [^`]*FROM onboarding_cases[^`]*)`/g)].map(m=>m[1].replace(/\$\{cols\}/g,'company_id'));
    assert.ok(queries.length>=4);
    for (const q of queries) {
      const plan=(await h.db.prepare(`EXPLAIN QUERY PLAN ${q}`).bind(...Array((q.match(/\?/g)||[]).length).fill(NOW.toISOString())).all()).results.map(r=>r.detail).join(' | ');
      assert.doesNotMatch(plan,/SCAN onboarding_cases(?! USING)/,`${q.slice(0,80)} -> ${plan}`);
    }
  });
});
