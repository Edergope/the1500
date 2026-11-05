// PERF-001: a reproducible local D1 for measuring. Local only: never give this a remote database.
// demo: what staging shows today, in shape. full: the directory at 1,500 simulated companies.
const {execFileSync}=require('node:child_process');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const INDUSTRIES=['Logistics','Accounting','Software','Legal','Manufacturing','Energy','Health','Education','Finance','Construction','Mining','Tourism','Agriculture','Retail','Marketing','Security','Consulting','Telecom','Insurance','Design'];
const COUNTRIES=['US','CO','MX','ES','BR'];
const canonical=i=>({originalLanguage:'en',descriptionOriginal:`Company ${i} coordinates ocean freight and shipment visibility for importers.`,descriptionEn:`Company ${i} coordinates ocean freight and shipment visibility for importers.`,
  descriptionEs:`La empresa ${i} coordina fletes marítimos y visibilidad de envíos para importadores.`,services:['Ocean freight','Customs'],servicesEs:['Flete marítimo','Aduanas'],audiences:['Importers'],audiencesEs:['Importadores'],
  problemSolutions:[{problem:'No status visibility',solution:'Consolidated tracking'}],problemSolutionsEs:[{problem:'Sin visibilidad',solution:'Seguimiento consolidado'}],
  serviceCountries:['US'],foundedYear:2010,certifications:[],advantages:[],clients:[],publish:{certifications:false,advantages:false,clients:false},provenance:{description:{type:'owner'}}});
const jsonld=(i,lang)=>JSON.stringify({'@graph':[{'@type':'Organization',name:`Simulated ${i}`,description:lang==='es'?`La empresa ${i}`:`Company ${i}`,knowsAbout:['Ocean freight'],identifier:`the1500-${i}`}]});
async function seed(db,published,{assignedOnly=0,retired=0,ownerDomain='test'}={}){
  const at='2026-11-05T00:00:00.000Z';let stm=[];
  const flush=async()=>{if(stm.length){await db.batch(stm);stm=[];}};
  const total=published+assignedOnly+retired;
  for(let n=1;n<=total;n++){
    const id=`sim-${n}`,isPub=n<=published||n>published+assignedOnly;
    const industry=INDUSTRIES[n%INDUSTRIES.length],country=COUNTRIES[n%COUNTRIES.length];
    const summary=`Company ${n} coordinates ocean freight and shipment visibility for importers.`;
    stm.push(db.prepare(`INSERT INTO companies(id,display_name,slug,country,industry,website,public_summary,publication_status,published_at,identity_state) VALUES(?,?,?,?,?,?,?,?,?,'admin_verified')`)
      .bind(id,`Simulated ${n}`,`simulated-${n}`,country,industry,`sim${n}.example`,isPub?summary:null,n<=published?'published':n<=published+assignedOnly?'draft':'withdrawn',isPub?at:null));
    // Every company has an owner, as in production; without one, owner lookups would measure an empty table.
    stm.push(db.prepare(`INSERT INTO users(id,email) VALUES(?,?)`).bind(`sim-user-${n}`,`owner@sim${n}.${ownerDomain}`));
    stm.push(db.prepare(`INSERT INTO memberships(user_id,company_id,role,created_at) VALUES(?,?,'owner',?)`).bind(`sim-user-${n}`,id,at));
    stm.push(db.prepare(`UPDATE companies SET created_at=? WHERE id=?`).bind(new Date(Date.parse(at)-n*60000).toISOString(),id));
    if(isPub){const c=JSON.stringify(canonical(n));
      stm.push(db.prepare(`INSERT INTO profile_versions(company_id,version,canonical_json,public_jsonld,public_jsonld_es,approved_at,published_at) VALUES(?,1,?,?,?,?,?)`).bind(id,c,jsonld(n,'en'),jsonld(n,'es'),at,at));
      if(n<=published)stm.push(db.prepare(`INSERT INTO published_company_fts(company_id,name,industry,country,summary,services,problems,solutions) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(id,`Simulated ${n}`,industry,country,summary,`Ocean freight\nCustoms\nsimulated${n}`,'No status visibility','Consolidated tracking'));}
    const kind=n<=100?'founder':n>1350?'premium':'paid';
    stm.push(db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind=?,assigned_at=? WHERE number=?`).bind(id,kind,at,n));
    // Search only answers from profiles with a snapshot, so a seed without them would measure an empty result.
    if(isPub)stm.push(db.prepare(`INSERT INTO published_profile_snapshots(company_id,version,jsonld_digest,published_at) VALUES(?,1,?,?)`).bind(id,`digest-${n}`,at));
    if(n>published+assignedOnly)stm.push(db.prepare(`UPDATE slots SET status='retired' WHERE number=?`).bind(n));
    if(stm.length>=240)await flush();
  }
  await flush();
}
const SCENARIOS={demo:db=>seed(db,9,{assignedOnly:2,retired:1,ownerDomain:'example'}),full:db=>seed(db,1500)};
/** A fresh, migrated, seeded D1 under its own folder. The migrations are those of `root`, so each version of the code is measured on its own schema. */
async function build(root,name){
  const {getPlatformProxy}=require(path.join(root,'node_modules/wrangler'));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),`the1500-perf-${name}-`));
  execFileSync(path.join(root,'node_modules/.bin/wrangler'),['d1','migrations','apply','DB','--local','--persist-to',dir],{cwd:root,stdio:'pipe',env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}});
  const proxy=await getPlatformProxy({configPath:path.join(root,'wrangler.jsonc'),persist:{path:path.join(dir,'v3')}});
  await SCENARIOS[name](proxy.env.DB);
  return {dir,proxy};
}
module.exports={build};
