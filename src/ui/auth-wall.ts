import {hash,PORTRAIT} from '../lib/mosaic';
import {createWallRenderer,GLASS,rgb,tiltOf,type WallCell} from './wall-renderer';
import {glyphCells} from './wall-glyph';

/** The wall of the Home, quieter: a light drifts over it and the number lights up once. Only where there is room for it. */
function start() {
  const canvas=document.querySelector<HTMLCanvasElement>('.auth-glass');
  if (!canvas||!matchMedia('(min-width: 901px)').matches) return;
  const grid=PORTRAIT,glass=GLASS.open!,still=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glyph=glyphCells(grid,true,10),gold=['#a8843f','#b8934a','#96743a','#c29c55'];
  const cells:WallCell[]=[];
  for (let row=0;row<grid.rows;row++) for (let col=0;col<grid.cols;col++) {
    const cell=row*grid.cols+col,h=hash(`auth-${cell}`),on=glyph.has(cell);
    cells.push({position:cell+1,col,row,tint:glass.tint,gloss:glass.gloss,retired:false,...tiltOf(h),
      tintB:on?rgb(gold[h%gold.length]!).map(v=>v*0.26) as [number,number,number]:glass.tint,rank:on?(h&1023)/1023:2});
  }
  const renderer=createWallRenderer(canvas,cells,grid,()=>{
    const w=Math.min(1100,canvas.clientWidth*Math.min(devicePixelRatio||1,1.5));
    return [w,w*grid.rows/grid.cols];
  });
  if (!renderer) return;
  renderer.resize(1);
  const lit=document.querySelector('.auth-glass');
  lit?.classList.add('is-lit');
  const began=performance.now();
  const paint=(now:number)=>{
    const t=(now-began)/1000;
    renderer.draw({
      a:still?[9,18]:[grid.cols/2+Math.sin(t*0.16)*grid.cols*0.42,grid.rows/2+Math.cos(t*0.12)*grid.rows*0.3],
      b:[grid.cols*0.8,grid.rows*0.7],reveal:999,origin:[grid.cols/2,grid.rows/2],
      ignite:still?1:Math.min(1,t/2.2),close:0,
    });
  };
  paint(performance.now());
  if (still||!renderer.animated) return;
  let visible=true,running=false,frames=0,last=0,spent=0;
  const loop=(now:number)=>{
    running=false;
    if (!visible||document.hidden) return;
    paint(now);
    // Behind a form, a stuttering wall is worse than a still one.
    if (last) {spent+=now-last;if (++frames===45) {if (spent/frames>40) return;frames=0;spent=0;}}
    last=now;
    wake();
  };
  const wake=()=>{if (!running) {running=true;requestAnimationFrame(loop);}};
  new IntersectionObserver(([entry])=>{visible=!!entry?.isIntersecting;last=0;wake();}).observe(canvas);
  document.addEventListener('visibilitychange',()=>{last=0;wake();});
  addEventListener('resize',()=>{renderer.resize(1);paint(performance.now());},{passive:true});
  wake();
}
const later=()=>('requestIdleCallback' in window?requestIdleCallback(start,{timeout:1000}):setTimeout(start,200));
if (document.readyState==='complete') later();else addEventListener('load',later,{once:true});
