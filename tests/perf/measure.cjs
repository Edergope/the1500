// PERF-001: rows and statements per route, read from D1's own meta.rows_read, for the code in --root.
//   node tests/perf/measure.cjs --root <checkout> --scenario demo|full --out result.json
// Local only. The loaders called are the ones the pages call.
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const arg=k=>{const i=process.argv.indexOf(`--${k}`);return i>0?process.argv[i+1]:undefined;};
const root=path.resolve(arg('root')||path.join(__dirname,'../..'));const name=arg('scenario')||'demo';
const {build}=require('./scenario.cjs');
const core=n=>require(path.join(root,'.core-js-tests/core',n+'.js'));
function wrap(db,log){
  // The same statement with other values is another question, so a repeat is counted on both.
  const note=(sql,args,r)=>log.push({sql:sql.replace(/\s+/g,' ').trim(),key:sql+JSON.stringify(args),read:r.meta.rows_read,written:r.meta.rows_written,ret:(r.results||[]).length});
  const stmt=(s,sql,args=[])=>({_s:s,_sql:sql,_args:args,bind:(...a)=>stmt(s.bind(...a),sql,a),
    all:async()=>{const r=await s.all();note(sql,args,r);return r;},
    first:async c=>{const r=await s.all();note(sql,args,r);const row=r.results[0]??null;return c?row?.[c]??null:row;},
    run:async()=>{const r=await s.run();note(sql,args,r);return r;}});
  return {prepare:sql=>stmt(db.prepare(sql),sql),batch:async l=>{const rs=await db.batch(l.map(x=>x._s));rs.forEach((r,i)=>note(l[i]._sql,l[i]._args,r));return rs;}};
}
(async()=>{
  const {dir,proxy}=await build(root,name);const raw=proxy.env.DB;
  const pub=core('public'),home=core('home'),join=core('join'),d=core('directory'),search=core('search'),inv=core('inventory'),ops=core('ops'),pay=core('payments');
  const directory=(db,f)=>pub.loadDirectory?pub.loadDirectory(db,f).then(r=>({result:r.result,stats:r.stats,retired:r.retired})):
    Promise.all([d.listPublishedCompanies(db,f),pub.getPublicStats(db),d.listRetiredPositions(db)]).then(([result,stats,ret])=>({result,stats,retired:ret.items}));
  const routes={
    '/':db=>home.loadHome(db,'en'),'/es/':db=>home.loadHome(db,'es'),
    '/unirse':db=>join.loadJoin(db,{},'en'),'/es/unirse':db=>join.loadJoin(db,{},'es'),
    '/empresas':db=>directory(db,{page:1,language:'en'}),'/es/empresas':db=>directory(db,{page:1,language:'es'}),
    '/empresas?page=40':db=>directory(db,{page:40,language:'en'}),
    '/empresas?query=simulated (matches all)':db=>directory(db,{page:1,q:'simulated',language:'en'}),
    '/empresas?query=simulated 7 (matches few)':db=>directory(db,{page:1,q:'simulated 7',language:'en'}),
    '/empresas?query=nomatch':db=>directory(db,{page:1,q:'nomatch',language:'en'}),
    '/empresas?country=CO':db=>directory(db,{page:1,country:'CO',language:'en'}),
    '/api/v1/public/stats':db=>pub.getPublicStats(db),
    '/api/v1/public/companies':db=>d.listPublishedCompanies(db,{page:1,language:'en'}),
    '/api/v1/public/retired-positions':db=>d.listRetiredPositions(db),
    '/empresas/:slug':db=>d.findPublicProfile(db,'simulated-5'),
    '/api/v1/public/search?query=freight (matches all)':db=>search.searchPublishedProfiles(db,'freight',8,{language:'en'}),
    '/api/v1/public/search?query=7 (matches one)':db=>search.searchPublishedProfiles(db,'simulated7',8,{language:'en'}),
  };
  const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,16);
  const one=async fn=>{const log=[];const t=performance.now();const value=await fn(wrap(raw,log));const ms=performance.now()-t;
    const count={};for(const l of log)count[l.key]=(count[l.key]||0)+1;
    return {read:log.reduce((n,l)=>n+l.read,0),written:log.reduce((n,l)=>n+l.written,0),queries:log.length,repeated:Object.values(count).filter(n=>n>1).length,ms:+ms.toFixed(1),value,log};};
  const out={scenario:name,commit:arg('commit')||null,counts:await raw.prepare(`SELECT (SELECT COUNT(*) FROM companies WHERE publication_status='published') published,(SELECT COUNT(*) FROM slots WHERE status='assigned') assigned,(SELECT COUNT(*) FROM slots WHERE status='retired') retired`).first(),routes:{},events:{}};
  for(const [route,fn] of Object.entries(routes)){
    const cold=await one(fn),warm=await one(fn);
    out.routes[route]={cold:{read:cold.read,written:cold.written,queries:cold.queries,repeated:cold.repeated,ms:cold.ms},warm:{read:warm.read,written:warm.written,queries:warm.queries,repeated:warm.repeated,ms:warm.ms},digest:digest(warm.value),
      statements:warm.log.map(l=>({sql:l.sql.slice(0,120),read:l.read,ret:l.ret}))};
  }
  if(fs.existsSync(path.join(root,'.core-js-tests/core/read-model.js'))){
    const rm=core('read-model');
    out.events.sqlOnly={commerce:await one(db=>rm.buildCommerce(db)).then(r=>({read:r.read,queries:r.queries}))};
    // The price of one real change: the write that fires the triggers, and the next visitor's rebuild.
    const hold=await raw.prepare(`UPDATE slots SET status='available' WHERE number=1 AND status='available'`).run();
    out.events.noopWrite={written:hold.meta.rows_written};
    await raw.prepare(`UPDATE read_model_revisions SET revision=revision+1 WHERE scope='commerce'`).run();
    out.events.afterCommerceChange=await one(routes['/']).then(r=>({read:r.read,written:r.written,queries:r.queries}));
    await raw.prepare(`UPDATE read_model_revisions SET revision=revision+1 WHERE scope='catalog'`).run();
    out.events.afterCatalogChange=await one(routes['/']).then(r=>({read:r.read,written:r.written,queries:r.queries}));
  }
  out.events.sales=await one(db=>inv.getSalesState(db)).then(r=>({read:r.read,queries:r.queries}));
  out.events.cron=await one(async db=>{await pay.sweepPayments(db,{},new Date());await ops.maintenanceSweep(db,{PUBLIC_BASE_URL:'http://localhost'},new Date());}).then(r=>({read:r.read,written:r.written,queries:r.queries}));
  // The full answers, so two versions of the code can be compared field by field.
  const answers={};for(const [route,fn] of Object.entries(routes)){answers[route]=await fn(raw);}
  out.answers=answers;
  fs.writeFileSync(arg('out'),JSON.stringify(out,null,1));
  for(const [r,v] of Object.entries(out.routes))console.log(r.padEnd(50),'cold',String(v.cold.read).padStart(6),'warm',String(v.warm.read).padStart(6),'q',String(v.warm.queries).padStart(2),'rep',v.warm.repeated);
  console.log(JSON.stringify(out.events));
  await proxy.dispose();fs.rmSync(dir,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exit(1);});
