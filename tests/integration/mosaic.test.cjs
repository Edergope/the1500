const {test}=require('node:test');const assert=require('node:assert/strict');
const m=require('../../.core-js-tests/lib/mosaic.js');
const companies=n=>Array.from({length:n},(_,i)=>({slug:`company-${i}`,position:i+1}));
const mapOf=(n,extra={})=>{const a=new Array(1500).fill('a');for(let i=0;i<n;i++)a[i]='p';for(const [k,v] of Object.entries(extra))a[k-1]=v;return a.join('');};
const cellsOf=t=>{const out=[];for(let r=t.row;r<t.row+t.h;r++)for(let c=t.col;c<t.col+t.w;c++)out.push(`${c},${r}`);return out;};

for(const [name,grid] of [['landscape',m.LANDSCAPE],['portrait',m.PORTRAIT]]){
  test(`${name}: every position has its own cell and the spiral starts in the middle`,()=>{
    const order=m.cellOrder(grid);assert.equal(order.length,1500);assert.equal(new Set(order).size,1500);
    const c=order[0]%grid.cols,r=Math.floor(order[0]/grid.cols);assert.ok(Math.abs(c-(grid.cols-1)/2)<=1);assert.ok(Math.abs(r-(grid.rows-1)/2)<=1);
    assert.deepEqual(m.cellOrder(grid),order,'positions never move');
  });
  for(const n of [1,7,24,60,100,160,361,800,1500])test(`${name}: ${n} companies fit without overlap and inside the wall`,()=>{
    const tiles=m.layoutTiles(companies(n),mapOf(n),grid);assert.equal(tiles.size,n);
    const seen=new Set();
    for(const t of tiles.values()){
      assert.ok(t.col>=0&&t.row>=0&&t.col+t.w<=grid.cols&&t.row+t.h<=grid.rows);
      for(const cell of cellsOf(t)){assert.ok(!seen.has(cell),`overlap at ${cell}`);seen.add(cell);}
    }
  });
  test(`${name}: a piece never covers a retired position or one assigned without a profile`,()=>{
    const order=m.cellOrder(grid);const blocked=[8,9,10,11];
    const map=mapOf(7,{8:'o',9:'x',10:'o',11:'x'});
    const covered=new Set();for(const t of m.layoutTiles(companies(7),map,grid).values())for(const cell of cellsOf(t))covered.add(cell);
    for(const n of blocked){const cell=order[n-1];assert.ok(!covered.has(`${cell%grid.cols},${Math.floor(cell/grid.cols)}`),`position ${n}`);}
  });
}
test('Pieces shrink as the wall fills, down to one cell',()=>{
  const sizes=[7,24,100,400,1500].map(m.baseTileSize);
  for(let i=1;i<sizes.length;i++)assert.ok(sizes[i]<=sizes[i-1]);
  assert.equal(sizes[0],5);assert.equal(sizes[4],1);
});
test('A full wall gives each company exactly its own position',()=>{
  const order=m.cellOrder(m.LANDSCAPE);
  for(const t of m.layoutTiles(companies(1500),mapOf(1500),m.LANDSCAPE).values()){assert.equal(t.w,1);assert.equal(t.h,1);assert.equal(t.col,t.anchorCol);assert.equal(t.row,t.anchorRow);}
  assert.equal(order.length,1500);
});
test('Monograms ignore the demo prefix and small words',()=>{
  assert.equal(m.monogram('Demo Ocean Freight'),'OF');assert.equal(m.monogram('Banco de la Gente'),'BG');
  assert.equal(m.monogram('Acme'),'Ac');assert.equal(m.monogram('Ñandú Andino'),'ÑA');
});
test('Status comes from the map: reserved is not for sale, and only the open range is available',()=>{
  const range={first:1,last:600};
  assert.equal(m.positionStatus(50,'a',range),'reserved');assert.equal(m.positionStatus(101,'a',range),'open');
  assert.equal(m.positionStatus(700,'a',range),'unreleased');assert.equal(m.positionStatus(110,'x',range),'retired');
  const c=m.countPositions(mapOf(0,{101:'p',102:'o',103:'x'}),range);
  assert.deepEqual(c,{published:1,assigned:1,retired:1,reserved:100,open:497,unreleased:900});
});
