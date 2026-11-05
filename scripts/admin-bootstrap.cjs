// Grants the first platform administrator. There is no route for this on purpose.
//   node scripts/admin-bootstrap.cjs <email> --authorized-by "<who authorized it>" --target local
//   node scripts/admin-bootstrap.cjs <email> --authorized-by "<who authorized it>" --target staging --confirm <email>
// The account must already have completed a verified sign-in. With an active administrator this refuses.
const {execFileSync}=require('node:child_process');const path=require('node:path');
const args=process.argv.slice(2);const flag=k=>{const i=args.indexOf(`--${k}`);return i>=0?args[i+1]:undefined;};
const email=args[0],target=flag('target'),by=flag('authorized-by');
const stop=m=>{console.error(m);process.exit(2);};
if(!email||email.startsWith('--')||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))stop('A valid email is required.');
if(!by||by.length<3)stop('--authorized-by is required: it goes on the record.');
if(!['local','staging'].includes(target))stop('--target must be local or staging. Production is not available here.');
if(target==='staging'&&flag('confirm')!==email)stop('Staging needs --confirm with the same email.');
const ROOT=path.join(__dirname,'..');
const q=s=>`'${String(s).replace(/'/g,"''")}'`;
const sql=c=>JSON.parse(execFileSync(path.join(ROOT,'node_modules/.bin/wrangler'),['d1','execute','DB',...(target==='staging'?['--remote']:['--local',...(flag('persist-to')?['--persist-to',flag('persist-to')]:[])]),'--json','--command',c],{cwd:ROOT,stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}}).toString()).at(-1).results;
const active=sql(`SELECT u.email FROM platform_admins a JOIN users u ON u.id=a.user_id WHERE a.revoked_at IS NULL`);
if(active.length)stop(`An administrator is already active (${active.length}). Revoke it first; this script only creates the first one.`);
const user=sql(`SELECT u.id FROM users u WHERE u.email=${q(email)} AND u.status='active' AND EXISTS(SELECT 1 FROM auth_audit a WHERE a.user_id=u.id AND a.kind='login_completed')`)[0];
if(!user)stop('No active account with a verified sign-in for that email. Sign in once first.');
const at=new Date().toISOString();
const event=require('node:crypto').randomUUID();
sql(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(${q(user.id)},${q(at)},${q(by)});
INSERT INTO admin_events(id,admin_id,action,subject_type,subject_id,reason_code,evidence_reference,details_json,occurred_at) VALUES(${q(event)},${q(user.id)},'admin_granted','user',${q(user.id)},'bootstrap',${q(by)},'{}',${q(at)})`);
console.log(`Administrator granted on ${target}. Recorded in admin_events.`);
