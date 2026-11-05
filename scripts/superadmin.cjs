// The only way to grant or revoke the platform superadministrator. There is no route for this on purpose.
//   node scripts/superadmin.cjs status      --target local|staging
//   node scripts/superadmin.cjs prepare     <email> --target local|staging
//   node scripts/superadmin.cjs grant       <email> --user-id <id from prepare> --confirm <email> --authorized-by "<who and how>" --target local|staging
//   node scripts/superadmin.cjs revoke-demo --by <superadmin email> --authorized-by "<who and how>" --target local|staging
//   node scripts/superadmin.cjs verify      --expect <email> --target local|staging
// grant needs a sign-in through the real login in the last hour, and refuses while a non-demo administrator is active.
// Every grant and revocation goes to admin_events, which cannot be edited. Nothing here prints session or token data.
const {execFileSync}=require('node:child_process');const path=require('node:path');const crypto=require('node:crypto');
const args=process.argv.slice(2);const flag=k=>{const i=args.indexOf(`--${k}`);return i>=0?args[i+1]:undefined;};
const command=args[0],email=args[1]&&!args[1].startsWith('--')?args[1].trim().toLowerCase():undefined,target=flag('target');
const stop=(m,code=2)=>{console.error(m);process.exit(code);};
const SIGN_IN_WINDOW_MS=60*60*1000;
const isDemo=e=>/\.example$/i.test(e??'');
const validEmail=e=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e??'');
if(!['status','prepare','grant','revoke-demo','verify'].includes(command))stop('Command must be status, prepare, grant, revoke-demo or verify.');
if(!['local','staging'].includes(target))stop('--target must be local or staging. Production is not available here.');
const ROOT=path.join(__dirname,'..');
const q=s=>`'${String(s).replace(/'/g,"''")}'`;
const sql=c=>JSON.parse(execFileSync(path.join(ROOT,'node_modules/.bin/wrangler'),['d1','execute','DB',...(target==='staging'?['--remote']:['--local',...(flag('persist-to')?['--persist-to',flag('persist-to')]:[])]),'--json','--command',c],{cwd:ROOT,stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}}).toString()).at(-1).results;
const activeAdmins=()=>sql(`SELECT u.id,u.email,u.status,a.granted_at,a.granted_by FROM platform_admins a JOIN users u ON u.id=a.user_id WHERE a.revoked_at IS NULL ORDER BY a.granted_at`);
const authority=()=>{const by=flag('authorized-by');if(!by||by.trim().length<3)stop('--authorized-by is required: it goes on the record.');return by.trim();};
const account=e=>sql(`SELECT u.id,u.email,u.status,(SELECT MAX(occurred_at) FROM auth_audit a WHERE a.user_id=u.id AND a.kind='login_completed') AS last_sign_in FROM users u WHERE u.email=${q(e)}`)[0];

if(command==='status'){
  const active=activeAdmins();
  const revoked=sql(`SELECT COUNT(*) AS n FROM platform_admins WHERE revoked_at IS NOT NULL`)[0].n;
  console.log(`Active administrators on ${target}: ${active.length}. Revoked: ${revoked}.`);
  for(const a of active)console.log(`  ${a.email}  ${isDemo(a.email)?'demo':'real'}  status=${a.status}  granted ${a.granted_at} by ${a.granted_by}`);
  process.exit(0);
}
if(command==='prepare'){
  if(!validEmail(email))stop('A valid email is required.');
  const u=account(email);
  if(!u)stop('No account with that email. Sign in once through the real login first.');
  const fresh=u.last_sign_in&&Date.now()-Date.parse(u.last_sign_in)<SIGN_IN_WINDOW_MS;
  console.log(`Account ${u.email}\n  user id      ${u.id}\n  status       ${u.status}\n  last sign-in ${u.last_sign_in??'never'}${fresh?'':'  (older than one hour: sign in again before grant)'}`);
  console.log(`Check that this is the owner, then run grant with --user-id ${u.id}.`);
  process.exit(0);
}
if(command==='grant'){
  if(!validEmail(email))stop('A valid email is required.');
  if(isDemo(email))stop('A demo address cannot be the superadministrator.');
  const by=authority();
  if(flag('confirm')?.trim().toLowerCase()!==email)stop('--confirm must repeat the same email.');
  const u=account(email);
  if(!u||u.status!=='active')stop('No active account with that email. Sign in once through the real login first.');
  if(flag('user-id')!==u.id)stop('--user-id does not match this account. Run prepare and check the account first.');
  if(!u.last_sign_in||Date.now()-Date.parse(u.last_sign_in)>=SIGN_IN_WINDOW_MS)stop('The last verified sign-in is older than one hour. Sign in again through the real login.');
  const active=activeAdmins();
  if(active.some(a=>a.id===u.id))stop('This account is already an active administrator.');
  const real=active.filter(a=>!isDemo(a.email));
  if(real.length)stop(`A non-demo administrator is already active (${real.length}). This script only creates the first one.`);
  const at=new Date().toISOString();
  // The guard repeats in SQL so two runs at once cannot both pass.
  sql(`INSERT INTO platform_admins(user_id,granted_at,granted_by)
    SELECT ${q(u.id)},${q(at)},${q(by)} WHERE NOT EXISTS(SELECT 1 FROM platform_admins a JOIN users x ON x.id=a.user_id WHERE a.revoked_at IS NULL AND x.email NOT LIKE '%.example')
    ON CONFLICT(user_id) DO UPDATE SET granted_at=excluded.granted_at,granted_by=excluded.granted_by,revoked_at=NULL;
  INSERT INTO admin_events(id,admin_id,action,subject_type,subject_id,reason_code,evidence_reference,details_json,occurred_at)
    SELECT ${q(crypto.randomUUID())},${q(u.id)},'admin_granted','user',${q(u.id)},'bootstrap',${q(by)},${q(JSON.stringify({role:'superadmin',signInAt:u.last_sign_in}))},${q(at)}
    WHERE EXISTS(SELECT 1 FROM platform_admins WHERE user_id=${q(u.id)} AND granted_at=${q(at)} AND revoked_at IS NULL)`);
  if(!activeAdmins().some(a=>a.id===u.id))stop('Not granted: another administrator became active meanwhile.',1);
  console.log(`Superadministrator granted on ${target}. Recorded in admin_events.`);
  const demo=activeAdmins().filter(a=>isDemo(a.email));
  if(demo.length)console.log(`Demo administrators still active: ${demo.length}. Run revoke-demo next.`);
  process.exit(0);
}
if(command==='revoke-demo'){
  const actorEmail=flag('by')?.trim().toLowerCase();
  if(!validEmail(actorEmail))stop('--by must name the superadministrator who revokes.');
  const by=authority();
  const active=activeAdmins();
  const actor=active.find(a=>a.email===actorEmail&&!isDemo(a.email)&&a.status==='active');
  if(!actor)stop('--by is not an active non-demo administrator. Grant the owner first.');
  const demo=active.filter(a=>isDemo(a.email));
  if(!demo.length){console.log('No demo administrator is active. Nothing to revoke.');process.exit(0);}
  const at=new Date().toISOString();
  sql(demo.map(d=>`UPDATE platform_admins SET revoked_at=${q(at)} WHERE user_id=${q(d.id)} AND revoked_at IS NULL;
  INSERT INTO admin_events(id,admin_id,action,subject_type,subject_id,reason_code,evidence_reference,details_json,occurred_at)
    VALUES(${q(crypto.randomUUID())},${q(actor.id)},'admin_revoked','user',${q(d.id)},'demo_access_removed',${q(by)},${q(JSON.stringify({email:d.email}))},${q(at)});`).join('\n'));
  const left=activeAdmins().filter(a=>isDemo(a.email));
  if(left.length)stop(`Demo administrators still active: ${left.length}.`,1);
  console.log(`Revoked ${demo.length} demo administrator(s) on ${target}. Recorded in admin_events.`);
  process.exit(0);
}
if(command==='verify'){
  const expect=flag('expect')?.trim().toLowerCase();
  if(!validEmail(expect))stop('--expect must name the one superadministrator.');
  const active=activeAdmins();
  const ok=active.length===1&&active[0].email===expect&&active[0].status==='active';
  console.log(`Active administrators on ${target}: ${active.length}.`);
  for(const a of active)console.log(`  ${a.email}  ${isDemo(a.email)?'demo':'real'}  status=${a.status}`);
  if(!ok)stop(`Not as expected: only ${expect} should be active.`,1);
  console.log(`Only ${expect} holds administrator access.`);
  process.exit(0);
}
