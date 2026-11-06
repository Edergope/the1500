// ADMIN-OPS: rows read by each operations screen, at 1,500 companies with every position in use. Local only.
//   node tests/perf/ops.cjs [--scenario demo|full]
// Holds, founders, requests, payments and incidents are added at a realistic size, so every queue has rows to page through.
const path=require('node:path'),fs=require('node:fs');
const arg=k=>{const i=process.argv.indexOf(`--${k}`);return i>0?process.argv[i+1]:undefined;};
const root=path.join(__dirname,'../..');const {build}=require('./scenario.cjs');
const ops=require(path.join(root,'.core-js-tests/core/admin-ops.js'));
function wrap(db,log){const stmt=s=>({_s:s,bind:(...a)=>stmt(s.bind(...a)),all:async()=>{const r=await s.all();log.push(r.meta.rows_read);return r;},first:async()=>{const r=await s.all();log.push(r.meta.rows_read);return r.results[0]??null;},run:async()=>{const r=await s.run();log.push(r.meta.rows_read);return r;}});
  return {prepare:sql=>stmt(db.prepare(sql)),batch:async l=>{const rs=await db.batch(l.map(x=>x._s));rs.forEach(r=>log.push(r.meta.rows_read));return rs;}};}
(async()=>{
  const {dir,proxy}=await build(root,arg('scenario')||'full');const raw=proxy.env.DB;
  const at='2026-11-06T12:00:00.000Z',later='2026-12-06T12:00:00.000Z';
  const ids=(await raw.prepare(`SELECT c.id,m.user_id AS userId FROM companies c JOIN memberships m ON m.company_id=c.id ORDER BY c.id LIMIT 400`).all()).results;
  const admin=ids[0].userId;const st=[];
  ids.slice(0,300).forEach((c,i)=>{
    st.push(raw.prepare(`INSERT INTO incidents(id,kind,severity,company_id,dedupe_key,details_json,status,created_at) VALUES(?,?,?,?,?,'{}',?,?)`).bind(`inc-${i}`,'onboarding_suspended',['info','warning','critical'][i%3],c.id,`d-${i}`,i%4?'resolved':'open',at));
    st.push(raw.prepare(`INSERT INTO slot_holds(id,slot_number,company_id,user_id,idempotency_key,status,created_at,expires_at) VALUES(?,?,?,?,?,'expired',?,?)`).bind(`h-${i}`,101+i,c.id,c.userId,`hk-${i}`,at,later));
    st.push(raw.prepare(`INSERT INTO purchase_attempts(id,company_id,user_id,hold_id,phase,provider,amount_usd_cents,total_minor,status,idempotency_key,created_at,updated_at,hold_expires_at)
      VALUES(?,?,?,?,1,'stripe',10000,10000,?,?,?,?,?)`).bind(`pa-${i}`,c.id,c.userId,`h-${i}`,['expired','failed','expired','late_review'][i%4],`k-${i}`,at,at,at));
  });
  ids.slice(300,360).forEach((c,i)=>st.push(raw.prepare(`INSERT INTO founder_invitations(id,company_id,invited_by,status,created_at,expires_at) VALUES(?,?,?,?,?,?)`).bind(`fi-${i}`,c.id,admin,['pending','accepted','expired'][i%3],at,later)));
  ids.slice(360,380).forEach((c,i)=>st.push(raw.prepare(`INSERT INTO service_requests(id,company_id,kind,status,requested_by,reason,requested_at,origin) VALUES(?,?,?,?,?,?,?,'owner')`).bind(`sr-${i}`,c.id,i%2?'withdrawal':'cancellation',i%3?'completed':'requested',c.userId,'reason',at)));
  for(let i=0;i<st.length;i+=50)await raw.batch(st.slice(i,i+50));
  const routes={
    '/admin/inventario':db=>ops.getInventoryBoard(db,{limit:100,offset:0}),
    '/admin/inventario?state=available':db=>ops.getInventoryBoard(db,{state:'available',limit:100,offset:0}),
    '/admin/inventario?state=published':db=>ops.getInventoryBoard(db,{state:'published',limit:100,offset:0}),
    '/admin/inventario?company=':db=>ops.getInventoryBoard(db,{company:'simulated 7',limit:100,offset:0}),
    '/admin/inventario/:n':db=>ops.getPositionDossier(db,150),
    '/admin/fundadores':db=>ops.getFounderBoard(db,{limit:50,offset:0}),
    '/admin/fundadores?status=accepted':db=>ops.getFounderBoard(db,{status:'accepted',limit:50,offset:0}),
    '/admin/solicitudes':db=>ops.getRequestCenter(db,new Date(at)),
    '/admin/pagos':db=>ops.listPaymentsPage(db,{limit:50,offset:0}),
    '/admin/pagos?status=late_review':db=>ops.listPaymentsPage(db,{status:'late_review',limit:50,offset:0}),
    '/admin/pagos/:id':db=>ops.getPaymentDossier(db,'pa-1'),
    '/admin/incidencias':db=>ops.listIncidentsPage(db,{limit:50,offset:0}),
    '/admin/incidencias?severity=critical':db=>ops.listIncidentsPage(db,{severity:'critical',limit:50,offset:0}),
    '/admin/incidencias/:id':db=>ops.getIncidentDossier(db,'inc-0'),
  };
  for(const [name,fn] of Object.entries(routes)){await fn(raw);const log=[];await fn(wrap(raw,log));console.log(name.padEnd(40),String(log.reduce((a,b)=>a+b,0)).padStart(7),'rows',String(log.length).padStart(3),'queries');}
  await proxy.dispose();fs.rmSync(dir,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exit(1);});
