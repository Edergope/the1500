// Real D1 engine: Wrangler's platform proxy over workerd, migrated by the real `wrangler d1 migrations apply`.
const {execFileSync}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const ROOT=path.join(__dirname,'..','..');
const {getPlatformProxy}=require(path.join(ROOT,'node_modules/wrangler'));
let template=null;
function migrated(){
  if(template)return template;
  template=fs.mkdtempSync(path.join(os.tmpdir(),'the1500-d1-template-'));
  execFileSync(path.join(ROOT,'node_modules/.bin/wrangler'),['d1','migrations','apply','DB','--local','--persist-to',template],{cwd:ROOT,stdio:'pipe',env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}});
  return template;
}
async function freshDb(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'the1500-d1-'));
  fs.cpSync(migrated(),dir,{recursive:true});
  const proxy=await getPlatformProxy({configPath:path.join(ROOT,'wrangler.jsonc'),persist:{path:path.join(dir,'v3')}});
  return {dir,db:proxy.env.DB,bucket:proxy.env.SNAPSHOTS,email:proxy.env.EMAIL,dispose:async()=>{await proxy.dispose();fs.rmSync(dir,{recursive:true,force:true});}};
}
let seq=0;
async function seedCompany(db,opts={}){
  const n=++seq;const id=opts.id||`co${n}`;const user=opts.user||`us${n}`;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO users(id,email) VALUES(?,?)`).bind(user,opts.email||`owner${n}@co${n}.example`),
    db.prepare(`INSERT INTO companies(id,display_name,slug,country,industry,website,identity_state) VALUES(?,?,?,?,?,?,?)`)
      .bind(id,opts.name||`Company ${n}`,opts.slug||`company-${n}`,opts.country||'US',opts.industry||'Logistics',opts.website||`co${n}.example`,opts.state||'self_declared'),
    db.prepare(`INSERT INTO memberships(user_id,company_id,role) VALUES(?,?,'owner')`).bind(user,id),
  ]);
  return {companyId:id,userId:user,email:opts.email||`owner${n}@co${n}.example`};
}
const fillPaid=(db,from,to)=>db.prepare(`UPDATE slots SET status='assigned',assignment_kind='paid' WHERE number BETWEEN ? AND ?`).bind(from,to).run();
const fillFounder=(db,from,to)=>db.prepare(`UPDATE slots SET status='assigned',assignment_kind='founder' WHERE number BETWEEN ? AND ?`).bind(from,to).run();
/** Every position up to n consumed, founders in their reserved range. */
const fillUpTo=async(db,n)=>{await fillFounder(db,1,Math.min(n,100));if(n>100)await fillPaid(db,101,n);};
module.exports={freshDb,seedCompany,fillPaid,fillFounder,fillUpTo,ROOT};
