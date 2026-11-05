// PERF-001: two versions of the code, same scenario, every answer compared field by field.
//   node tests/perf/compare.cjs before.json after.json
const assert=require('node:assert/strict');const fs=require('node:fs');
const [b,a]=process.argv.slice(2).map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
let same=0;const different=[];
for(const route of Object.keys(b.answers)){
  let x=b.answers[route],y=a.answers[route];
  // The join page keeps only what it shows: compared on those fields.
  if(route.endsWith('/unirse')){const {companies,retiredPositions,retiredLabel,...home}=x.home;x={...x,home};}
  try{assert.deepEqual(y,x);same++;}catch(e){different.push(route+'\n'+e.message.slice(0,600));}
}
console.log(`${b.scenario}: ${same} of ${Object.keys(b.answers).length} routes identical`);
for(const d of different)console.log('DIFFERENT',d);
process.exit(different.length?1:0);
