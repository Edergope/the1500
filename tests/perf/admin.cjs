// ADMIN-001: rows read by each page of the control center, on a scenario. Local only.
//   node tests/perf/admin.cjs --scenario demo|full
const path=require('node:path'),fs=require('node:fs');
const arg=k=>{const i=process.argv.indexOf(`--${k}`);return i>0?process.argv[i+1]:undefined;};
const root=path.join(__dirname,'../..');const {build}=require('./scenario.cjs');
const con=require(path.join(root,'.core-js-tests/core/admin-console.js'));
function wrap(db,log){const stmt=s=>({_s:s,bind:(...a)=>stmt(s.bind(...a)),all:async()=>{const r=await s.all();log.push(r.meta.rows_read);return r;},first:async()=>{const r=await s.all();log.push(r.meta.rows_read);return r.results[0]??null;},run:async()=>{const r=await s.run();log.push(r.meta.rows_read);return r;}});
  return {prepare:sql=>stmt(db.prepare(sql)),batch:async l=>{const rs=await db.batch(l.map(x=>x._s));rs.forEach(r=>log.push(r.meta.rows_read));return rs;}};}
(async()=>{
  const {dir,proxy}=await build(root,arg('scenario')||'demo');const raw=proxy.env.DB;
  const routes={'/admin (overview)':db=>con.getControlOverview(db),'/admin/empresas':db=>con.searchCompanies(db,{limit:50,offset:0}),
    '/admin/empresas?query=':db=>con.searchCompanies(db,{q:'simulated 7',limit:50,offset:0}),'/admin/empresas?email=':db=>con.searchCompanies(db,{email:'nobody',limit:50,offset:0}),
    '/admin/empresas?position=':db=>con.searchCompanies(db,{position:7,limit:50,offset:0}),'/admin/empresas/:id':db=>con.getCompanyDossier(db,'sim-7'),
    '/admin/perfiles':db=>con.listProfileVersions(db,{limit:50,offset:0}),'/admin/perfiles/:id/:v':db=>con.getProfileDossier(db,'sim-7',1),'/admin/auditoria':db=>con.listAuditEvents(db,{limit:50,offset:0})};
  for(const [name,fn] of Object.entries(routes)){await fn(raw);const log=[];await fn(wrap(raw,log));console.log(name.padEnd(30),String(log.reduce((a,b)=>a+b,0)).padStart(7),'rows',String(log.length).padStart(3),'queries');}
  await proxy.dispose();fs.rmSync(dir,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exit(1);});
