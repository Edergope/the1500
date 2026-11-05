import {hash,LANDSCAPE,PORTRAIT,type Grid} from '../lib/mosaic';
import {createWallRenderer,GLASS,rgb,tiltOf,type WallCell,type WallRenderer} from './wall-renderer';

const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const portrait=matchMedia('(orientation: portrait)');
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));

interface Scene {el:HTMLElement;update():void;}
const scenes:Scene[]=[];
const onScreen=new Set<Scene>();
let queued=false;
const tick=()=>{queued=false;for (const scene of onScreen) scene.update();};
const wake=()=>{if (!queued) {queued=true;requestAnimationFrame(tick);}};
const watcher=new IntersectionObserver(entries=>{
  for (const entry of entries) {
    const scene=scenes.find(s=>s.el===entry.target);
    if (!scene) continue;
    if (entry.isIntersecting) onScreen.add(scene);else onScreen.delete(scene);
  }
  wake();
},{rootMargin:'20% 0px'});
const add=(scene:Scene)=>{scenes.push(scene);watcher.observe(scene.el);};

/* Between sections the colour changes piece by piece, tied to the scroll in both directions. */
function seam(canvas:HTMLCanvasElement) {
  const ctx=canvas.getContext('2d');
  if (!ctx) return;
  const a=canvas.dataset.a!,b=canvas.dataset.b!;
  let cols=0,rows=0,size=0,jitter:number[]=[],last=-1;
  const fit=()=>{
    const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,1.5);
    size=Math.max(18,Math.round(w/50));
    cols=Math.ceil(w/size);rows=Math.ceil(h/size);
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    jitter=Array.from({length:cols*rows},(_,i)=>(hash(`seam-${i}`)&1023)/1023);
    last=-1;
  };
  const draw=(p:number)=>{
    if (Math.abs(p-last)<0.002) return;
    last=p;
    ctx.fillStyle=a;ctx.fillRect(0,0,canvas.clientWidth,canvas.clientHeight);
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
      const v=(r+0.5)/rows+(jitter[r*cols+c]!-0.5)*0.62+(p-0.5)*0.72;
      if (v<0.42) continue;
      ctx.fillStyle=v<0.47?'#eec679':b;
      const inset=v<0.62?1.5:0;
      ctx.fillRect(c*size+inset,r*size+inset,size-inset*2+0.5,size-inset*2+0.5);
    }
  };
  fit();
  addEventListener('resize',fit,{passive:true});
  if (reduced.matches) {draw(0.5);return;}
  draw(0.5);
  add({el:canvas,update(){
    const r=canvas.getBoundingClientRect();
    draw(clamp(1-(r.top+r.height/2)/innerHeight,0,1));
  }});
}

/* How it works: raw information becomes a profile, then a piece of the wall. */
function onboarding(root:HTMLElement) {
  const steps=[...root.querySelectorAll<HTMLElement>('.ob-step')];
  const scene=root.querySelector<HTMLElement>('.ob-scene');
  if (!scene||!steps.length||reduced.matches) return;
  root.classList.add('is-scrubbed');
  add({el:root,update(){
    const r=root.getBoundingClientRect();
    const s=clamp(-r.top/Math.max(1,r.height-innerHeight),0,1)*(steps.length-1);
    for (let q=1;q<=4;q++) scene.style.setProperty(`--q${q}`,clamp(s-(q-1),0,1).toFixed(3));
    steps.forEach((el,n)=>{el.classList.toggle('is-active',n===Math.round(s));});
  }});
}

/* What you get: each promise points at the part of the page it refers to. */
function anatomy(root:HTMLElement) {
  const sheet=root.querySelector<HTMLElement>('.sheet');
  const items=[...root.querySelectorAll<HTMLElement>('[data-part]')];
  if (!sheet) return;
  const show=(item:HTMLElement)=>{
    sheet.dataset.show=item.dataset.part;
    items.forEach(i=>{i.classList.toggle('is-active',i===item);});
  };
  for (const item of items) {
    item.addEventListener('pointerenter',()=>show(item));
    item.addEventListener('focus',()=>show(item));
    item.addEventListener('click',()=>show(item));
  }
  if (items[0]) show(items[0]);
}

/* The questions open one at a time. */
function questions(root:HTMLElement) {
  const all=[...root.querySelectorAll('details')];
  for (const d of all) d.addEventListener('toggle',()=>{if (d.open) for (const other of all) if (other!==d) other.open=false;});
}

/* The close: the same wall of 1,500 pieces, and the number they are limited to. */
const DIGITS:Record<string,string[]>={
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '5':['11111','10000','11110','00001','00001','10001','01110'],
  '0':['01110','10001','10001','10001','10001','10001','01110'],
};
function glyphCells(grid:Grid,tall:boolean):Set<number> {
  const out=new Set<number>(),bit=2;
  const put=(digit:string,col:number,row:number)=>{
    DIGITS[digit]!.forEach((line,y)=>{[...line].forEach((on,x)=>{
      if (on!=='1') return;
      for (let dy=0;dy<bit;dy++) for (let dx=0;dx<bit;dx++) out.add((row+y*bit+dy)*grid.cols+col+x*bit+dx);
    });});
  };
  const width=5*bit,gap=1;
  if (tall) {
    const left=Math.floor((grid.cols-(width*2+gap))/2),top=5;
    put('1',left,top);put('5',left+width+gap,top);
    put('0',left,top+7*bit+gap);put('0',left+width+gap,top+7*bit+gap);
  } else {
    const left=Math.floor((grid.cols-(width*4+gap*3))/2),top=4;
    ['1','5','0','0'].forEach((d,i)=>put(d,left+i*(width+gap),top));
  }
  return out;
}
function finale(root:HTMLElement,colors:string[]) {
  let canvas=root.querySelector<HTMLCanvasElement>('canvas');
  const inner=root.querySelector<HTMLElement>('.finale-wall');
  if (!canvas||!inner) return;
  let renderer:WallRenderer|null=null,grid:Grid=LANDSCAPE,current=-1,running=false,pointerX=-1,pointerY=-1;
  const started=performance.now();
  const build=()=>{
    grid=portrait.matches?PORTRAIT:LANDSCAPE;
    const glyph=glyphCells(grid,grid===PORTRAIT),glass=GLASS.open!,gold=['#a8843f','#b8934a','#96743a','#c29c55'];
    const picks=[...glyph].sort((a,b)=>hash(`f-${a}`)-hash(`f-${b}`));
    const brand=new Map(picks.slice(0,colors.length).map((cell,i)=>[cell,colors[i]!]));
    const cells:WallCell[]=[];
    for (let row=0;row<grid.rows;row++) for (let col=0;col<grid.cols;col++) {
      const cell=row*grid.cols+col,h=hash(`finale-${cell}`),on=glyph.has(cell);
      cells.push({position:cell+1,col,row,tint:glass.tint,gloss:glass.gloss,retired:false,...tiltOf(h),
        tintB:on?rgb(brand.get(cell)??gold[h%gold.length]!).map(v=>v*0.72) as [number,number,number]:glass.tint,rank:on?(h&1023)/1023:2});
    }
    renderer=createWallRenderer(canvas!,cells,grid,()=>{
      const limit=grid===PORTRAIT?1300:2000,w=Math.min(limit,canvas!.clientWidth*Math.min(devicePixelRatio||1,1.5));
      return [w,w*grid.rows/grid.cols];
    });
    canvas=root.querySelector('canvas');
    renderer?.resize(1);
    canvas?.classList.add('is-lit');
    current=-1;
  };
  const paint=(p:number,t:number)=>{
    if (!renderer) return;
    const moving=!reduced.matches&&renderer.animated;
    const a:[number,number]=pointerX>=0?[pointerX,pointerY]:moving?[grid.cols/2+Math.sin(t*0.4)*grid.cols*0.42,grid.rows*0.3+Math.cos(t*0.3)*grid.rows*0.25]:[grid.cols*0.3,grid.rows*0.25];
    renderer.draw({a,b:[grid.cols*0.75,grid.rows*0.6],reveal:999,origin:[grid.cols/2,grid.rows/2],ignite:p,close:0});
  };
  const progress=()=>{
    if (reduced.matches) return 1;
    const r=root.getBoundingClientRect();
    return clamp((innerHeight*0.75-r.top)/(innerHeight*0.95),0,1);
  };
  const loop=()=>{
    running=false;
    if (!onScreen.has(scene)||document.hidden) return;
    const p=progress();
    inner.style.setProperty('--p',p.toFixed(3));
    const animated=!reduced.matches&&!!renderer?.animated;
    if (animated||p!==current) paint(p,(performance.now()-started)/1000);
    current=p;
    if (animated) start();
  };
  const start=()=>{if (!running) {running=true;requestAnimationFrame(loop);}};
  const scene:Scene={el:root,update(){
    if (!renderer) build();
    start();
  }};
  add(scene);
  root.addEventListener('pointermove',e=>{
    if (e.pointerType!=='mouse'||!canvas) return;
    const r=canvas.getBoundingClientRect();
    pointerX=(e.clientX-r.left)/r.width*grid.cols;pointerY=(e.clientY-r.top)/r.height*grid.rows;
  },{passive:true});
  root.addEventListener('pointerleave',()=>{pointerX=-1;});
  portrait.addEventListener('change',()=>{if (renderer) build();wake();});
  addEventListener('resize',()=>{renderer?.resize(1);current=-1;wake();},{passive:true});
}

function startScenes() {
  document.querySelectorAll<HTMLCanvasElement>('canvas.seam').forEach(seam);
  const how=document.querySelector<HTMLElement>('#how-it-works');
  if (how) onboarding(how);
  const get=document.querySelector<HTMLElement>('#what-you-get');
  if (get) anatomy(get);
  const faq=document.querySelector<HTMLElement>('#faq');
  if (faq) questions(faq);
  const end=document.querySelector<HTMLElement>('.finale');
  const colors=[...document.querySelectorAll<HTMLElement>('.tile')].map(t=>t.style.getPropertyValue('--bg')).filter(Boolean);
  if (end) finale(end,colors);
  addEventListener('scroll',wake,{passive:true});
  addEventListener('resize',wake,{passive:true});
  wake();
}
startScenes();
