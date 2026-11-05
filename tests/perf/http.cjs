// PERF-001: the built Worker in local workerd, on a scenario, through real HTTP. Local only: the port is on localhost.
//   node tests/perf/http.cjs --root <checkout> --scenario demo|full --out result.json [--requests 30]
const {spawn,execSync}=require('node:child_process');const fs=require('node:fs'),path=require('node:path');
const arg=k=>{const i=process.argv.indexOf(`--${k}`);return i>0?process.argv[i+1]:undefined;};
const root=path.resolve(arg('root'));const name=arg('scenario');const N=Number(arg('requests')||30);const PORT=Number(arg('port')||8795);const BASE=`http://localhost:${PORT}`;
const {build}=require('./scenario.cjs');
const ROUTES=['/','/es/','/unirse','/es/unirse','/empresas','/es/empresas','/empresas?query=simulated%207','/api/v1/public/stats','/api/v1/public/search?query=freight'];
const cpuOf=pgid=>execSync('ps -A -o pgid=,time=,comm=').toString().split('\n').map(l=>l.trim().split(/\s+/)).filter(p=>Number(p[0])===pgid&&(p[2]||'').includes('workerd'))
  .reduce((n,p)=>{const [m,s]=p[1].split(':');return n+Number(m)*60000+Number(s)*1000;},0);
const pct=(a,p)=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))];
(async()=>{
  const {dir,proxy}=await build(root,name);await proxy.dispose();
  const wr=spawn(path.join(root,'node_modules/.bin/wrangler'),['dev','--config','dist/server/wrangler.json','--port',String(PORT),'--persist-to',dir,'--show-interactive-dev-session=false','--var','PUBLIC_BASE_URL:'+BASE],
    {cwd:root,stdio:'ignore',env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'},detached:true});
  const stop=()=>{try{process.kill(-wr.pid,'SIGTERM');}catch{}};
  try{
    let up=false;for(let i=0;i<120&&!up;i++){try{up=(await fetch(`${BASE}/favicon.svg`)).status>0;}catch{await new Promise(r=>setTimeout(r,500));}}
    if(!up)throw new Error('worker did not start');
    const out={scenario:name,requests:N,routes:{},html:{}};
    for(const route of ROUTES){
      const hit=async(headers={})=>{const t=performance.now();const r=await fetch(BASE+route,{headers});const text=await r.text();return {ms:performance.now()-t,status:r.status,text,cache:r.headers.get('cache-control'),setCookie:r.headers.get('set-cookie')};};
      const first=await hit();const cpu0=cpuOf(wr.pid);const times=[];let bad=0;
      for(let i=0;i<N;i++){const r=await hit();times.push(r.ms);if(r.status!==200)bad++;}
      const cpu=(cpuOf(wr.pid)-cpu0)/N;
      const signed=await hit({cookie:'__Host-the1500_session=abcdef'});
      out.routes[route]={firstMs:+first.ms.toFixed(1),p50:+pct(times,.5).toFixed(1),p95:+pct(times,.95).toFixed(1),cpuMsPerRequest:+cpu.toFixed(1),non200:bad,status:first.status,cacheControl:first.cache,cacheControlSigned:signed.cache,setCookie:first.setCookie,setCookieSigned:signed.setCookie,bytes:first.text.length};
      out.html[route]=first.text;
      console.log(route.padEnd(40),'first',out.routes[route].firstMs,'p50',out.routes[route].p50,'p95',out.routes[route].p95,'cpu',out.routes[route].cpuMsPerRequest,first.status,first.cache);
    }
    fs.writeFileSync(arg('out'),JSON.stringify(out,null,1));
  }finally{stop();setTimeout(()=>{fs.rmSync(dir,{recursive:true,force:true});process.exit(0);},1500);}
})().catch(e=>{console.error(e);process.exit(1);});
