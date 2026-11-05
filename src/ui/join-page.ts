import {cellOrder,LANDSCAPE,positionStatus,type PositionRange} from '../lib/mosaic';
import {buildCells,createWallRenderer} from './wall-renderer';

interface JoinClient {map:string|null;current:PositionRange|null;position:number|null;}
const still=matchMedia('(prefers-reduced-motion: reduce)').matches;

function demoTabs() {
  const tabs=[...document.querySelectorAll<HTMLButtonElement>('.jn-tabs [role="tab"]')];
  const panels=tabs.map(t=>document.getElementById(t.getAttribute('aria-controls')!));
  const show=(i:number,focus=false)=>{
    tabs.forEach((t,n)=>{t.setAttribute('aria-selected',String(n===i));t.tabIndex=n===i?0:-1;});
    panels.forEach((p,n)=>p?.classList.toggle('is-on',n===i));
    if (focus) tabs[i]?.focus();
    // On a phone the list is a row, and the chosen one must be in view. The page itself stays still.
    tabs[i]?.scrollIntoView({block:'nearest',inline:'nearest',behavior:still?'auto':'smooth'});
  };
  tabs.forEach((t,i)=>{
    t.addEventListener('click',()=>show(i));
    t.addEventListener('keydown',e=>{
      const step={ArrowDown:1,ArrowRight:1,ArrowUp:-1,ArrowLeft:-1}[e.key];
      if (step) {e.preventDefault();show((i+step+tabs.length)%tabs.length,true);}
      if (e.key==='Home') {e.preventDefault();show(0,true);}
      if (e.key==='End') {e.preventDefault();show(tabs.length-1,true);}
    });
  });
}

/** The whole wall, small and true: every position as the database has it, and this company marked. */
function miniWall(data:JoinClient) {
  const canvas=document.querySelector<HTMLCanvasElement>('.jn-mini');
  const ctx=canvas?.getContext('2d');
  if (!canvas||!ctx||!data.map) return;
  const grid=LANDSCAPE,order=cellOrder(grid),u=canvas.width/grid.cols;
  const colour:Record<string,string>={published:'#c9a24b',assigned:'#6f7a8a',retired:'#4a2a26',reserved:'#1b2636',open:'#1b2636',unreleased:'#111824'};
  ctx.clearRect(0,0,canvas.width,canvas.height);
  order.forEach((cell,i)=>{
    ctx.fillStyle=colour[positionStatus(i+1,data.map![i],data.current)]!;
    ctx.fillRect(cell%grid.cols*u+1,Math.floor(cell/grid.cols)*u+1,u-2,u-2);
  });
  if (data.position) {
    const cell=order[data.position-1]!,x=cell%grid.cols*u,y=Math.floor(cell/grid.cols)*u;
    ctx.fillStyle='#f5f2eb';ctx.fillRect(x-1,y-1,u+2,u+2);
  }
}

/** The hero's wall: the real positions, with a light drifting over them. */
function heroWall(data:JoinClient) {
  const canvas=document.querySelector<HTMLCanvasElement>('.jn-glass');
  if (!canvas||!data.map||!matchMedia('(min-width: 821px)').matches) return;
  const grid=LANDSCAPE;
  const renderer=createWallRenderer(canvas,buildCells(data.map,grid,data.current,new Map()),grid,()=>{
    const w=Math.min(1500,canvas.clientWidth*Math.min(devicePixelRatio||1,1.5));
    return [w,w*grid.rows/grid.cols];
  });
  if (!renderer) return;
  renderer.resize(1);
  document.querySelector('.jn-glass')?.classList.add('is-lit');
  const began=performance.now();
  const paint=(now:number)=>{
    const t=(now-began)/1000;
    renderer.draw({a:still?[20,12]:[grid.cols/2+Math.sin(t*0.2)*grid.cols*0.4,grid.rows/2+Math.cos(t*0.16)*grid.rows*0.35],b:[grid.cols*0.7,grid.rows*0.7],reveal:999,origin:[grid.cols/2,grid.rows/2],ignite:0,close:0});
  };
  paint(began);
  if (still||!renderer.animated) return;
  let visible=true,running=false,frames=0,last=0,spent=0;
  const loop=(now:number)=>{
    running=false;
    if (!visible||document.hidden) return;
    paint(now);
    if (last) {spent+=now-last;if (++frames===45) {if (spent/frames>40) return;frames=0;spent=0;}}
    last=now;
    wake();
  };
  const wake=()=>{if (!running) {running=true;requestAnimationFrame(loop);}};
  new IntersectionObserver(([entry])=>{visible=!!entry?.isIntersecting;last=0;wake();}).observe(canvas);
  document.addEventListener('visibilitychange',()=>{last=0;wake();});
  wake();
}

/** The steps light up as the section passes, in both directions. */
function processScene() {
  const root=document.getElementById('jn-process');
  if (!root||still) return;
  root.classList.add('is-scrubbed');
  let queued=false;
  const update=()=>{
    queued=false;
    const r=root.getBoundingClientRect();
    root.style.setProperty('--lit',((innerHeight*0.82-r.top)/(innerHeight*0.6)*5).toFixed(2));
  };
  const wake=()=>{if (!queued) {queued=true;requestAnimationFrame(update);}};
  addEventListener('scroll',wake,{passive:true});
  addEventListener('resize',wake,{passive:true});
  wake();
}

function start() {
  const el=document.getElementById('join-data');
  const data=JSON.parse(el?.textContent||'{}') as JoinClient;
  demoTabs();
  miniWall(data);
  processScene();
  const later=()=>heroWall(data);
  const idle=()=>('requestIdleCallback' in window?requestIdleCallback(later,{timeout:1000}):setTimeout(later,200));
  if (document.readyState==='complete') idle();else addEventListener('load',idle,{once:true});
}
start();
