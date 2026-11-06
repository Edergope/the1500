// ADMIN-OPS: the operations screens read the real state, decide nothing themselves, and keep their cost at 1,500 companies.
const {test,describe,before,after}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {freshDb,seedCompany,fillUpTo,ROOT}=require('../support/d1.cjs');
const core=p=>require(`../../.core-js-tests/core/${p}.js`);
const ops=core('admin-ops'),adm=core('admin'),inv=core('inventory'),mail=core('mail');
const NOW=new Date('2026-11-06T12:00:00.000Z');
let keyN=0;const key=()=>`adminops_key_${String(++keyN).padStart(6,'0')}`;
async function admin(db){const s=await seedCompany(db,{email:'ops@the1500.test'});
  await db.prepare(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,'test')`).bind(s.userId,NOW.toISOString()).run();return s;}

describe('inventory',()=>{
  let h,held,assigned;
  before(async()=>{h=await freshDb();await fillUpTo(h.db,3);
    assigned=await seedCompany(h.db);await h.db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind='paid',assigned_at=? WHERE number=101`).bind(assigned.companyId,NOW.toISOString()).run();
    held=await seedCompany(h.db);await inv.createCheckoutHold(h.db,held.companyId,held.userId,key(),NOW);});
  after(()=>h.dispose());
  test('the board shows every position in its real state, reservations included, and agrees with the tables',async()=>{
    const b=await ops.getInventoryBoard(h.db,{limit:100,offset:0});
    assert.equal(b.map.length,1500);
    const truth=(await h.db.prepare(`SELECT SUM(status='available') a,SUM(status='held') h,SUM(status IN('assigned','retired')) o FROM slots`).first());
    assert.equal(b.summary.available,truth.a);assert.equal(b.summary.held,truth.h);assert.equal(b.summary.held,1);
    assert.equal([...b.map].filter(c=>c==='h').length,1,'the live reservation is on the board');
    assert.equal(b.holds[0].companyId,held.companyId);
    assert.equal(b.positions.rows[0].position,1);assert.equal(b.positions.hasMore,true);
  });
  test('filters by state, allocation and range, and pages without counting',async()=>{
    const heldRows=(await ops.getInventoryBoard(h.db,{state:'held',limit:100,offset:0})).positions.rows;
    assert.equal(heldRows.length,1);assert.equal(heldRows[0].status,'held');
    const founders=(await ops.getInventoryBoard(h.db,{kind:'founder',limit:100,offset:0})).positions.rows;
    assert.deepEqual(founders.map(r=>r.position),[1,2,3]);
    const range=(await ops.getInventoryBoard(h.db,{from:100,to:102,limit:100,offset:0})).positions.rows;
    assert.deepEqual(range.map(r=>[r.position,r.status]),[[100,'available'],[101,'assigned'],[102,'held']],'the reservation took the lowest free paid position');
    await assert.rejects(ops.getInventoryBoard(h.db,{state:'sold',limit:100,offset:0}),e=>e.code==='INVALID_QUERY');
    await assert.rejects(ops.getInventoryBoard(h.db,{limit:500,offset:0}),e=>e.code==='INVALID_LIMIT');
  });
  test('a position file has its facts and its movements, and offers no way to change them',async()=>{
    const d=await ops.getPositionDossier(h.db,101);
    assert.equal(d.position.companyId,assigned.companyId);assert.equal(d.position.locked,false);
    await assert.rejects(ops.getPositionDossier(h.db,1501),e=>e.code==='INVALID_QUERY');
    const view=fs.readFileSync(path.join(ROOT,'src/components/admin/PositionView.astro'),'utf8')+fs.readFileSync(path.join(ROOT,'src/components/admin/InventoryView.astro'),'utf8');
    assert.doesNotMatch(view,/ActionButton|\/api\/v1\/admin/,'the inventory screens have no action');
  });
});

describe('founders',()=>{
  let h,a,f;
  before(async()=>{h=await freshDb();a=await admin(h.db);f=await seedCompany(h.db);
    const invite=await adm.inviteFounder(h.db,a.userId,f.companyId,NOW);await adm.acceptFounderInvitation(h.db,invite.invitationId,f.userId,NOW);});
  after(()=>h.dispose());
  test('an accepted invitation is not a position until a person awards it',async()=>{
    let b=await ops.getFounderBoard(h.db,{limit:50,offset:0});
    assert.equal(b.invitations.rows[0].status,'accepted');assert.equal(b.invitations.rows[0].awardedPosition,null);
    assert.equal(b.positions.available,100);assert.equal(b.awards.length,0);
    const invitationId=b.invitations.rows[0].id;
    await adm.awardFounder(h.db,a.userId,invitationId,'selected','case-1',NOW);
    b=await ops.getFounderBoard(h.db,{status:'accepted',limit:50,offset:0});
    assert.equal(b.invitations.rows[0].awardedPosition,1);assert.equal(b.positions.assigned,1);assert.equal(b.awards[0].status,'active');
    assert.equal(b.invitationCounts.accepted,1);
  });
});

describe('requests, payments and incidents',()=>{
  let h,a,c;
  before(async()=>{h=await freshDb();a=await admin(h.db);c=await seedCompany(h.db,{state:'pending_review'});
    await adm.requestService(h.db,c.companyId,c.userId,'cancellation','Change of plans').run?.();
    await h.db.prepare(`INSERT INTO incidents(id,kind,severity,company_id,dedupe_key,details_json,status,created_at) VALUES('inc-1','test_kind','critical',?,'d1','{"note":"x"}','open',?)`).bind(c.companyId,NOW.toISOString()).run();});
  after(()=>h.dispose());
  test('the request center lists what waits, by queue, without deciding anything',async()=>{
    const r=await ops.getRequestCenter(h.db,NOW);
    assert.deepEqual(r.identity.map(x=>x.companyId),[c.companyId]);
    assert.equal(r.service.length,1);assert.equal(r.service[0].kind,'cancellation');
    for (const q of ['profiles','premium','reactivation','review','corrections']) assert.ok(Array.isArray(r[q]));
  });
  test('incidents: listed by severity, and resolving one records who and why',async()=>{
    const list=await ops.listIncidentsPage(h.db,{limit:50,offset:0});
    assert.ok(list.rows.some(r=>r.id==='inc-1'));assert.equal(list.openBySeverity.critical,(await h.db.prepare(`SELECT COUNT(*) n FROM incidents WHERE status='open' AND severity='critical'`).first()).n);
    await adm.resolveIncident(h.db,a.userId,'inc-1','handled','ticket-9',NOW);
    const d=await ops.getIncidentDossier(h.db,'inc-1');
    assert.equal(d.incident.status,'resolved');assert.equal(d.incident.resolvedBy,'ops@the1500.test');assert.equal(d.events[0].action,'incident_resolved');
    assert.deepEqual(d.incident.details,{note:'x'});
    await assert.rejects(h.db.prepare(`DELETE FROM admin_events`).run(),'the audit trail stays append-only');
  });
  test('payments: an empty list says so, and an unknown attempt is a 404',async()=>{
    const p=await ops.listPaymentsPage(h.db,{limit:50,offset:0});
    assert.equal(p.rows.length,0);assert.equal(p.hasMore,false);
    await assert.rejects(ops.getPaymentDossier(h.db,'nope'),e=>e.code==='ATTEMPT_NOT_FOUND');
    await assert.rejects(ops.listPaymentsPage(h.db,{status:'stolen',limit:50,offset:0}),e=>e.code==='INVALID_QUERY');
  });
});

describe('security of the operations',()=>{
  test('irreversible actions and anything touching a position or money need a recent re-authentication',()=>{
    const dir=path.join(ROOT,'src/pages/api/v1/admin');
    for (const f of ['founder-award','founder-revoke','premium/assign','withdrawals/execute','onboarding/resolve','payments/refund','payments/refund-alternative','payments/resolve-late','payments/chargeback-resolve'])
      assert.match(fs.readFileSync(path.join(dir,`${f}.ts`),'utf8'),/POST:APIRoute=criticalAdminPost\(/,f);
  });
  test('every operations page sits under /admin, where the middleware checks platform_admins first',()=>{
    for (const lang of ['','es/']) for (const page of ['inventario','fundadores','solicitudes','pagos/index','incidencias/index','inventario/[position]','pagos/[id]','incidencias/[id]'])
      assert.ok(fs.existsSync(path.join(ROOT,`src/pages/${lang}admin/${page}.astro`)),`${lang}${page}`);
    assert.match(fs.readFileSync(path.join(ROOT,'src/middleware.ts'),'utf8'),/const ADMIN_PAGE=\/\^\\\/\(es\\\/\)\?admin\(\\\/\|\$\)\//);
  });
});

describe('migration 0013 (indexes only)',()=>{
  test('it adds indexes and nothing else, and the queues use them',async()=>{
    const file=fs.readFileSync(path.join(ROOT,'db/migrations/0013_admin_ops_indexes.sql'),'utf8').replace(/--.*$/gm,'');
    for (const s of file.split(';').map(x=>x.trim()).filter(Boolean)) assert.match(s,/^CREATE INDEX IF NOT EXISTS /);
    const h=await freshDb();try{
      const plan=async sql=>(await h.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()).results.map(r=>r.detail).join(' | ');
      assert.match(await plan(`SELECT id FROM companies WHERE identity_state='pending_review' ORDER BY created_at LIMIT 50`),/idx_companies_identity_review/);
      assert.match(await plan(`SELECT company_id FROM profile_versions WHERE review_status='pending' ORDER BY created_at LIMIT 50`),/idx_profile_versions_review/);
      assert.match(await plan(`SELECT id FROM purchase_attempts ORDER BY created_at DESC LIMIT 51`),/idx_purchase_created/);
      assert.match(await plan(`SELECT COUNT(*) FROM incidents WHERE attempt_id='x' AND status='open'`),/idx_incidents_attempt/);
    }finally{await h.dispose();}
  });
});

describe('transitional mail (Resend test sender)',()=>{
  test('a recipient the test sender may not reach is refused for that recipient only, never reported as sent',async()=>{
    const http=require('node:http');
    const server=http.createServer((req,res)=>{res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({statusCode:403,name:'validation_error',message:'You can only send testing emails to your own email address (owner@x.test).'}));});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{
      const out=await mail.sendMail({MAIL_PROVIDER:'resend',MAIL_FROM:'THE1500 <onboarding@resend.dev>',RESEND_API_KEY:'re_test',RESEND_API_BASE:`http://127.0.0.1:${server.address().port}`},{to:'someone@else.test',subject:'s',text:'t'});
      assert.deepEqual(out,{accepted:false,provider:'resend',failure:'rejected',code:'RESEND_TEST_RECIPIENT_ONLY'});
    }finally{await new Promise(r=>server.close(r));}
  });
});
