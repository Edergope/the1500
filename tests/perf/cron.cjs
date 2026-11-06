// DEPLOY-002: rows read by one run of the five-minute cron, at 1,500 companies with an onboarding case each. Local only.
//   node tests/perf/cron.cjs [--with db/migrations/0011_admin_indexes.sql]
// Most cases sit in a waiting state (extended, suspended, completed); a few are due. A second run measures an idle register:
// what the cron costs every five minutes when nothing has changed.
const path=require('node:path'),fs=require('node:fs');
const arg=k=>{const i=process.argv.indexOf(`--${k}`);return i>0?process.argv[i+1]:undefined;};
const root=path.join(__dirname,'../..');const {build}=require('./scenario.cjs');
const ops=require(path.join(root,'.core-js-tests/core/ops.js'));
function wrap(db,log){const stmt=(s,sql)=>({_s:s,_sql:sql,bind:(...a)=>stmt(s.bind(...a),sql),all:async()=>{const r=await s.all();log.push([sql,r.meta.rows_read]);return r;},
  first:async()=>{const r=await s.all();log.push([sql,r.meta.rows_read]);return r.results[0]??null;},run:async()=>{const r=await s.run();log.push([sql,r.meta.rows_read]);return r;}});
  return {prepare:sql=>stmt(db.prepare(sql),sql),batch:async l=>{const rs=await db.batch(l.map(x=>x._s));rs.forEach((r,i)=>log.push([l[i]._sql,r.meta.rows_read]));return rs;}};}
const STATES=['completed','completed','completed','extended','suspended','completed','reactivation_requested','completed','extended','admin_review'];
(async()=>{
  const {dir,proxy}=await build(root,'full');const raw=proxy.env.DB;
  if(arg('with')){const file=fs.readFileSync(path.resolve(root,arg('with')),'utf8').replace(/--.*$/gm,'');
    await raw.batch(file.split(';').map(x=>x.trim()).filter(Boolean).map(x=>raw.prepare(x)));console.log(`with ${arg('with')}`);}
  const now=new Date('2026-11-06T12:00:00.000Z'),iso=d=>new Date(now.getTime()+d*864e5).toISOString();
  // One case per company. Waiting cases have their next deadline in the future; ten are due now.
  const cases=[];
  for(let n=1;n<=1500;n++){
    const due=n%150===0,status=due?'active':STATES[n%STATES.length];
    cases.push(raw.prepare(`INSERT INTO onboarding_cases(company_id,origin,status,started_at,form_due_at,extension_due_at,reactivation_due_at,final_notice_due_at,resolution_due_at,resolved_at)
      VALUES(?,'paid',?,?,?,?,?,?,?,?)`).bind(`sim-${n}`,status,iso(-40),iso(due?-1:-10),iso(status==='extended'?5:due?3:-5),iso(status==='suspended'?20:30),
      status==='admin_review'?iso(10):null,status==='admin_review'?iso(30):null,status==='completed'?iso(-1):null));
  }
  for(let i=0;i<cases.length;i+=100)await raw.batch(cases.slice(i,i+100));
  for(const label of ['first run (ten cases due)','idle run (nothing changed)']){
    const log=[];await ops.maintenanceSweep(wrap(raw,log),{PUBLIC_BASE_URL:'https://x.test'},now);
    const total=log.reduce((a,[,n])=>a+n,0);
    console.log(`${label.padEnd(28)} ${String(total).padStart(6)} rows ${String(log.length).padStart(3)} statements`);
    if(process.argv.includes('--detail'))for(const [sql,n] of log.filter(([,n])=>n>20))console.log(`   ${String(n).padStart(6)}  ${sql.replace(/\s+/g,' ').slice(0,110)}`);
  }
  await proxy.dispose();fs.rmSync(dir,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exit(1);});
