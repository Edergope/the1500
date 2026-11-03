const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'../..');
test('API_CONTRACT.md and the route files list exactly the same endpoints',()=>{
  const api=path.join(ROOT,'src/pages/api/v1');const routes=new Set();
  const walk=d=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);
    if(f.isDirectory())walk(p);else{const url='/'+path.relative(api,p).replace(/\.ts$/,'').replace(/\/index$/,'').replace(/\[slug\]/,':slug');
      for(const m of fs.readFileSync(p,'utf8').matchAll(/export const (GET|POST|PUT)\b/g))routes.add(`${m[1]} ${url}`);}}};
  walk(api);
  const doc=fs.readFileSync(path.join(ROOT,'docs/API_CONTRACT.md'),'utf8');const listed=new Set();
  for(const line of doc.split('\n')){const m=line.match(/^\| ((?:GET|POST|PUT)(?:, (?:GET|POST|PUT))*) `([^`?]+)/);
    if(m)for(const method of m[1].split(', '))listed.add(`${method} ${m[2]}`);}
  assert.deepEqual([...routes].filter(r=>!listed.has(r)).sort(),[],'routes missing from the contract');
  assert.deepEqual([...listed].filter(r=>!routes.has(r)).sort(),[],'contract lists routes that do not exist');
});
