import {cellOrder,LANDSCAPE,PORTRAIT,positionStatus,type Grid,type PositionRange} from '../lib/mosaic';
import {buildCells,createWallRenderer,type WallRenderer} from './wall-renderer';

interface ClientData {
  lang:'en'|'es';map:string|null;current:PositionRange|null;retiredLabel:string;
  labels:Record<'published'|'assigned'|'open'|'reserved'|'unreleased'|'demo',string>;
}
interface Tile {el:HTMLAnchorElement;slug:string;n:number;name:string;meta:string;demo:boolean;mark:string;cx:number;cy:number;w:number;h:number;}
interface Cam {vx:number;vy:number;fx:number;fy:number;s:number;rx:number;ry:number;bloom:number;shade:number;ignite:number;close:number;gather:number;}
interface Place {x:number;y:number;k:number;}
interface PublicProfile {
  summary:string;problemSolutions:{problem:string;solution:string}[];audiences:string[];html:string;jsonld:string;
}

const COVER_UNITS=1.5;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const portrait=matchMedia('(orientation: portrait)');
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
const smooth=(t:number)=>t*t*(3-2*t);
const qs=<T extends Element>(sel:string,root:ParentNode=document)=>root.querySelector(sel) as T|null;

function start() {
  const dataEl=qs<HTMLScriptElement>('#mosaic-data'),stage=qs<HTMLElement>('#stage'),wall=qs<HTMLElement>('#wall');
  if (!dataEl||!stage||!wall) return;
  const data=JSON.parse(dataEl.textContent||'{}') as ClientData;
  const chapters=[...document.querySelectorAll<HTMLElement>('.ch[data-cam]')];
  const tip=qs<HTMLElement>('#cell-tip')!,plate=qs<HTMLElement>('#plate')!,tilesRoot=qs<HTMLElement>('#tiles')!;
  const shade=qs<HTMLElement>('.stage-shade')!;
  const tileEls=[...tilesRoot.querySelectorAll<HTMLAnchorElement>('.tile')];
  const igniteEl=qs<HTMLElement>('.ch-ignite');

  let grid:Grid=portrait.matches?PORTRAIT:LANDSCAPE;
  let order=cellOrder(grid);
  let positionAt=new Int16Array(grid.cols*grid.rows);
  let tiles:Tile[]=[];
  let unit=1,vw=1,vh=1;
  let chapterCentres:number[]=[];
  let cams:Record<string,Cam>={};
  let featured=0;
  let renderer:WallRenderer|null=null;
  let canvas=qs<HTMLCanvasElement>('#wall-glass')!;
  const view:Cam={vx:0,vy:0,fx:0,fy:0,s:1,rx:0,ry:0,bloom:1,shade:1,ignite:0,close:0,gather:0};
  let igniteTop=0,igniteHeight=1,gathered=false;
  let places:Place[]=[];
  let primed=false,running=false,visible=true;
  const pointer={x:0,y:0,active:false,px:0,py:0};
  const appeared=performance.now();

  const readTiles=()=>{
    tiles=tileEls.map(el=>{
      const s=getComputedStyle(el),num=(name:string)=>parseFloat(s.getPropertyValue(name));
      const w=num('--w'),h=num('--h');
      return {el,slug:el.dataset.slug!,n:Number(el.dataset.n),name:el.dataset.name!,meta:el.dataset.meta!,demo:el.dataset.demo==='1',mark:el.dataset.mark!,
        cx:num('--x')+w/2,cy:num('--y')+h/2,w,h};
    });
  };
  const measure=()=>{
    vw=stage.clientWidth;vh=stage.clientHeight;
    unit=wall.offsetWidth/grid.cols;
    chapterCentres=chapters.map(ch=>{const r=ch.getBoundingClientRect();return r.top+scrollY+Math.min(r.height,vh*1.5)/2;});
    const coverScale=1/COVER_UNITS;
    const nucleus={x:parseFloat(getComputedStyle(stage).getPropertyValue('--focus-x')),y:parseFloat(getComputedStyle(stage).getPropertyValue('--focus-y'))};
    const tall=grid===PORTRAIT;
    const middle={x:grid.cols/2,y:grid.rows/2};
    const f=tiles[featured];
    const featureFocus=f?{x:f.cx,y:f.cy}:nucleus;
    const featureScale=f?clamp((tall?vw*0.56:vh*0.46)/(Math.max(f.w,f.h)*unit),coverScale,1.5):coverScale;
    const whole=tall?Math.min(vh*0.4/(grid.rows*unit),vw*0.8/(grid.cols*unit)):Math.min(vh*0.84/(grid.rows*unit),vw*0.56/(grid.cols*unit));
    const still={ignite:0,close:0,gather:0};
    cams=tall?{
      hero:{vx:0.5,vy:0.31,fx:nucleus.x,fy:nucleus.y,s:coverScale*1.12,rx:7,ry:-6,bloom:1,shade:1,...still},
      finite:{vx:0.5,vy:0.29,fx:middle.x,fy:middle.y,s:whole,rx:3,ry:-3,bloom:0,shade:1,...still},
      shape:{vx:0.5,vy:0.27,fx:nucleus.x,fy:nucleus.y,s:coverScale*1.04,rx:6,ry:-4,bloom:1,shade:1,...still},
      useful:{vx:0.5,vy:0.17,fx:featureFocus.x,fy:featureFocus.y,s:featureScale*0.8,rx:0,ry:0,bloom:1,shade:1.45,...still},
      identity:{vx:0.5,vy:0.14,fx:featureFocus.x,fy:featureFocus.y,s:featureScale*0.7,rx:0,ry:0,bloom:1,shade:2.1,...still},
      belong:{vx:0.5,vy:0.29,fx:middle.x,fy:middle.y,s:whole,rx:3,ry:-3,bloom:1,shade:1,...still},
    }:{
      hero:{vx:0.7,vy:0.52,fx:nucleus.x,fy:nucleus.y,s:coverScale*1.16,rx:7,ry:-11,bloom:1,shade:1,...still},
      finite:{vx:0.68,vy:0.52,fx:middle.x,fy:middle.y,s:whole,rx:3,ry:-7,bloom:0,shade:1,...still},
      shape:{vx:0.68,vy:0.5,fx:nucleus.x,fy:nucleus.y,s:coverScale*1.08,rx:5,ry:-8,bloom:1,shade:1,...still},
      useful:{vx:0.76,vy:0.5,fx:featureFocus.x,fy:featureFocus.y,s:featureScale,rx:2,ry:-6,bloom:1,shade:1,...still},
      identity:{vx:0.5,vy:0.5,fx:featureFocus.x,fy:featureFocus.y,s:featureScale*1.15,rx:0,ry:0,bloom:1,shade:2.2,...still},
      belong:{vx:0.68,vy:0.52,fx:middle.x,fy:middle.y,s:whole,rx:3,ry:-7,bloom:1,shade:1,...still},
    };
    // The wall ends flat and filling the screen, so that the next section can continue it.
    cams.ignite={vx:0.5,vy:0.5,fx:middle.x,fy:middle.y,s:Math.max(vw/(grid.cols*unit),vh/(grid.rows*unit))*1.06,rx:0,ry:0,bloom:1,shade:0,ignite:1,close:1,gather:1};
    if (igniteEl) {
      const r=igniteEl.getBoundingClientRect();
      igniteTop=r.top+scrollY;igniteHeight=r.height;
    }
    placeLineup(tall);
  };
  /** Where the companies stand once they have left the wall: one row, or several on a narrow screen. */
  const placeLineup=(tall:boolean)=>{
    const going=tiles.slice(0,tall?6:7);
    const rowHeight=tall?vh*0.115:vh*0.27,gap=tall?10:16,maxWidth=vw*(tall?0.92:0.9);
    const rows:{i:number;w:number}[][]=[[]];
    let used=0;
    going.forEach((t,i)=>{
      const w=rowHeight*t.w/t.h;
      // A wide screen keeps one row; a phone needs a second.
      if (tall&&used+w>maxWidth&&rows.length<3&&rows[rows.length-1]!.length) {rows.push([]);used=0;}
      rows[rows.length-1]!.push({i,w});used+=w+gap;
    });
    const fit=Math.min(1,...rows.map(r=>maxWidth/(r.reduce((a,c)=>a+c.w,0)+gap*(r.length-1))));
    const cam=cams.ignite!;
    places=[];
    const top=vh*(tall?0.4:0.56);
    rows.forEach((row,n)=>{
      const width=row.reduce((a,c)=>a+c.w*fit,0)+gap*(row.length-1);
      let x=(vw-width)/2;
      const y=top+n*(rowHeight*fit+gap);
      for (const {i,w} of row) {
        const tile=tiles[i]!;
        const k=(w*fit)/(tile.w*unit*cam.s);
        places[i]={x:cam.fx*unit+(x-cam.vx*vw)/cam.s-(tile.cx-tile.w/2)*unit,y:cam.fy*unit+(y-cam.vy*vh)/cam.s-(tile.cy-tile.h/2)*unit,k};
        x+=w*fit+gap;
      }
    });
    tileEls.forEach((el,i)=>{el.style.setProperty('--leaves',places[i]?'0':'1');});
  };
  const targetCam=():Cam=>{
    if (reduced.matches||!chapters.length) return cams.hero!;
    const mid=scrollY+vh/2;
    let i=0;
    while (i<chapterCentres.length-1&&chapterCentres[i+1]!<=mid) i++;
    const from=cams[chapters[i]!.dataset.cam!]!;
    const next=chapters[i+1];
    if (!next) return withIgnite(from);
    if (mid<=chapterCentres[i]!) return from;
    const to=cams[next.dataset.cam!]!;
    // Each chapter holds still for a moment, so its text can be read.
    const t=smooth(clamp(((mid-chapterCentres[i]!)/(chapterCentres[i+1]!-chapterCentres[i]!)-0.18)/0.64,0,1));
    return mixCams(from,to,t);
  };
  const mixCams=(a:Cam,b:Cam,t:number):Cam=>{
    const out={...a};
    for (const key of Object.keys(a) as (keyof Cam)[]) out[key]=lerp(a[key],b[key],t);
    return out;
  };
  /** The last stretch of the story: position by position the glass lights up, the camera closes in, the companies step out. */
  const withIgnite=(from:Cam):Cam=>{
    if (!igniteEl) return from;
    const p=clamp((scrollY+vh-igniteTop)/igniteHeight,0,1);
    igniteEl.style.setProperty('--p',p.toFixed(4));
    igniteEl.style.setProperty('--r',smooth(clamp((p-0.62)/0.2,0,1)).toFixed(4));
    const end=cams.ignite!;
    const out=mixCams(from,end,smooth(clamp((p-0.12)/0.5,0,1)));
    out.ignite=smooth(clamp((p-0.14)/0.5,0,1));
    out.close=smooth(clamp((p-0.58)/0.14,0,1));
    out.gather=smooth(clamp((p-0.5)/0.3,0,1));
    return out;
  };
  const applyCam=()=>{
    const tiltX=view.rx-(pointer.active?pointer.py*1.6:0),tiltY=view.ry+(pointer.active?pointer.px*2.2:0);
    wall.style.transformOrigin=`${view.fx*unit}px ${view.fy*unit}px`;
    wall.style.transform=`translate(${view.vx*vw-view.fx*unit}px,${view.vy*vh-view.fy*unit}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${view.s})`;
    wall.style.setProperty('--b',view.bloom.toFixed(3));
    wall.style.setProperty('--g',view.gather.toFixed(3));
    const out=view.gather>0.002;
    if (out!==gathered) tilesRoot.classList.toggle('is-out',out);
    if (out||gathered) places.forEach((place,i)=>{
      const el=tileEls[i];
      if (!el||!place) return;
      if (!out) {el.style.translate='';el.style.scale='';return;}
      el.style.translate=`${place.x*view.gather}px ${place.y*view.gather}px`;
      el.style.scale=String(lerp(1,place.k,view.gather));
    });
    gathered=out;
    shade.style.opacity=String(Math.min(1,view.shade*0.92));
    shade.style.setProperty('--veil',String(clamp(view.shade-1,0,1).toFixed(3)));
  };

  const pixels=():[number,number]=>{
    const dpr=Math.min(devicePixelRatio||1,2);
    const limit=grid===PORTRAIT?1500:2800;
    const w=Math.min(limit,grid.cols*unit*dpr);
    return [w,w*grid.rows/grid.cols];
  };
  let glassScale=1,frames=0,spent=0,last=0;
  const prepareGlass=()=>{
    if (!data.map) return;
    const bySlug=new Map(tiles.map(t=>[t.n,t.slug]));
    renderer=createWallRenderer(canvas,buildCells(data.map,grid,data.current,bySlug),grid,pixels);
    canvas=qs<HTMLCanvasElement>('#wall-glass')!;
    bindCanvas();
    if (!renderer) return;
    renderer.resize(glassScale);
    drawGlass(performance.now());
    canvas.classList.add('is-lit');
    wake();
  };
  const drawGlass=(now:number)=>{
    if (!renderer) return;
    const t=(now-appeared)/1000;
    const still=reduced.matches||!renderer.animated;
    const orbit:[number,number]=still?[view.fx-6,view.fy-3]:[view.fx+Math.sin(t*0.31)*grid.cols*0.32,view.fy+Math.cos(t*0.23)*grid.rows*0.32];
    const second:[number,number]=still?[view.fx+8,view.fy+6]:[grid.cols/2+Math.cos(t*0.17)*grid.cols*0.45,grid.rows/2+Math.sin(t*0.13)*grid.rows*0.45];
    const main=pointer.active?[pointer.x,pointer.y] as [number,number]:orbit;
    renderer.draw({a:main,b:second,reveal:still?999:Math.max(0,t*44),origin:[view.fx,view.fy],ignite:view.ignite,close:view.close});
    // The same light falls on the companies, while they are few enough for that to be cheap.
    if (tiles.length<=80) {wall.style.setProperty('--lx',main[0].toFixed(2));wall.style.setProperty('--ly',main[1].toFixed(2));}
  };

  const frame=(now:number)=>{
    running=false;
    if (!visible||document.hidden) return;
    const dt=Math.min(64,now-last||16);last=now;
    const target=targetCam();
    const k=primed?1-Math.exp(-dt/140):1;
    primed=true;
    let moved=false;
    for (const key of Object.keys(view) as (keyof Cam)[]) {
      const next=lerp(view[key],target[key],k);
      if (Math.abs(next-view[key])>1e-4) moved=true;
      view[key]=next;
    }
    if (moved||pointer.active) applyCam();
    const animated=!!renderer?.animated&&!reduced.matches;
    if (animated) {
      drawGlass(now);
      // Weak graphics hardware gets a coarser wall first, then a still one, never a stuttering one.
      spent+=dt;frames++;
      if (frames===45) {
        if (spent/frames>30&&glassScale>0.5) {glassScale*=0.7;renderer!.resize(glassScale);}
        else if (spent/frames>30) {renderer!.animated=false;}
        frames=0;spent=0;
      }
    } else if (moved&&renderer) drawGlass(now);
    if (moved||animated) wake();
  };
  function wake() {
    if (running) return;
    running=true;
    requestAnimationFrame(frame);
  }

  /* Selecting a company */
  const profileCache=new Map<string,Promise<PublicProfile|null>>();
  const loadProfile=(slug:string)=>{
    let hit=profileCache.get(slug);
    if (!hit) {
      hit=fetch(`/api/v1/public/companies/${slug}?lang=${data.lang}`).then(r=>r.ok?r.json() as Promise<PublicProfile>:null).catch(()=>null);
      profileCache.set(slug,hit);
    }
    return hit;
  };
  const fill=(root:HTMLElement,field:string,text:string)=>{root.querySelectorAll<HTMLElement>(`[data-field="${field}"]`).forEach(el=>{el.textContent=text;});};
  const machineFor=async(url:string)=>{
    const doc=await fetch(url).then(r=>r.ok?r.json():null).catch(()=>null) as {'@graph'?:Record<string,unknown>[]}|null;
    const org=doc?.['@graph']?.find(n=>n['@type']==='Organization');
    if (!org) return null;
    const excerpt:Record<string,unknown>={'@type':org['@type']};
    for (const key of ['name','description','knowsAbout','areaServed','identifier']) if (org[key]!==undefined) excerpt[key]=org[key];
    return JSON.stringify(excerpt,null,2);
  };
  const stories=[qs<HTMLElement>('.ch-profile'),qs<HTMLElement>('.ch-identity')].filter((e):e is HTMLElement=>!!e);
  let selection=0;
  const select=async(index:number,opts:{openPlate:boolean;focus?:boolean})=>{
    if (!tiles.length) return;
    const i=(index+tiles.length)%tiles.length,t=tiles[i]!;
    selection=i;featured=i;
    tileEls.forEach((el,n)=>{el.classList.toggle('is-selected',n===i);el.tabIndex=n===i?0:-1;});
    if (opts.focus) t.el.focus({preventScroll:true});
    measure();wake();
    const look=getComputedStyle(t.el);
    const card=qs<HTMLElement>('#profile-card');
    if (card) {
      card.style.setProperty('--bg',look.getPropertyValue('--bg'));
      card.style.setProperty('--ink',look.getPropertyValue('--ink'));
    }
    for (const root of [...stories,plate]) {
      fill(root,'name',t.name);fill(root,'meta',t.meta);fill(root,'mark',t.mark);
      root.querySelectorAll<HTMLAnchorElement>('[data-field="link"]').forEach(a=>{a.href=t.el.href;});
      root.querySelectorAll<HTMLElement>('[data-field="demo"],[data-field="demo-note"]').forEach(el=>{el.hidden=!t.demo;});
    }
    plate.hidden=!opts.openPlate&&plate.hidden;
    if (opts.openPlate) plate.hidden=false;
    const profile=await loadProfile(t.slug);
    if (selection!==i||!profile) return;
    for (const root of [...stories,plate]) fill(root,'summary',profile.summary??'');
    const pair=profile.problemSolutions?.[0];
    for (const root of stories) {
      fill(root,'problem',pair?`${pair.problem}\n${pair.solution}`:'—');
      fill(root,'audience',profile.audiences?.join(', ')||'—');
    }
    const machine=await machineFor(profile.jsonld);
    if (selection===i&&machine) for (const root of stories) fill(root,'machine',machine);
    if (card) measure();
  };
  const closePlate=()=>{
    plate.hidden=true;
    tiles[selection]?.el.classList.remove('is-selected');
    tiles[selection]?.el.focus({preventScroll:true});
  };

  tilesRoot.addEventListener('click',e=>{
    const el=(e.target as Element).closest<HTMLAnchorElement>('.tile');
    if (!el) return;
    const me=e as MouseEvent;
    if (me.metaKey||me.ctrlKey||me.shiftKey||me.button!==0) return;
    e.preventDefault();
    void select(tileEls.indexOf(el),{openPlate:!stories.some(inView)});
  });
  tilesRoot.addEventListener('keydown',e=>{
    const dir={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key];
    if (!dir) return;
    e.preventDefault();
    void select(selection+dir,{openPlate:true,focus:true});
  });
  function inView(el:HTMLElement) {const r=el.getBoundingClientRect();return r.top<vh*0.5&&r.bottom>vh*0.5;}
  document.addEventListener('click',e=>{
    const btn=(e.target as Element).closest<HTMLElement>('[data-step],[data-action="close"]');
    if (!btn) return;
    if (btn.dataset.action==='close') closePlate();
    else void select(selection+Number(btn.dataset.step),{openPlate:!plate.hidden});
  });
  document.addEventListener('keydown',e=>{if (e.key==='Escape'&&!plate.hidden) closePlate();});

  /* The rest of the wall answers too */
  const cellAt=(e:PointerEvent)=>{
    const c=Math.floor(e.offsetX/canvas.clientWidth*grid.cols),r=Math.floor(e.offsetY/canvas.clientHeight*grid.rows);
    if (c<0||r<0||c>=grid.cols||r>=grid.rows) return 0;
    return positionAt[r*grid.cols+c]!;
  };
  const describe=(n:number)=>{
    const status=positionStatus(n,data.map?.[n-1],data.current);
    const pad=`#${String(n).padStart(4,'0')}`;
    if (status==='retired') return `${pad} ${data.retiredLabel}`;
    if (status==='published') return `${pad} ${tiles.find(t=>t.n===n)?.name??data.labels.published}`;
    return `${pad} ${data.labels[status]}`;
  };
  const showTip=(e:PointerEvent)=>{
    const n=cellAt(e);
    if (!n) {tip.hidden=true;return;}
    tip.textContent=describe(n);tip.hidden=false;
    const r=stage.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
    tip.style.transform=`translate(${clamp(e.clientX-r.left+14,8,vw-w-8)}px,${clamp(e.clientY-r.top-h-12,8,vh-h-8)}px)`;
  };
  let boundCanvas:HTMLCanvasElement|null=null;
  function bindCanvas() {
    if (boundCanvas===canvas) return;
    boundCanvas=canvas;
    canvas.addEventListener('pointermove',e=>{if (e.pointerType==='mouse'&&data.map) showTip(e);});
    canvas.addEventListener('pointerleave',()=>{tip.hidden=true;});
    canvas.addEventListener('click',e=>{if (data.map) showTip(e as PointerEvent);});
  }
  stage.addEventListener('pointermove',e=>{
    if (e.pointerType!=='mouse'||reduced.matches) return;
    const r=canvas.getBoundingClientRect();
    pointer.x=(e.clientX-r.left)/r.width*grid.cols;pointer.y=(e.clientY-r.top)/r.height*grid.rows;
    pointer.px=e.clientX/vw-0.5;pointer.py=e.clientY/vh-0.5;pointer.active=true;
    wake();
  },{passive:true});
  stage.addEventListener('pointerleave',()=>{pointer.active=false;wake();});

  const rebuild=()=>{
    grid=portrait.matches?PORTRAIT:LANDSCAPE;
    order=cellOrder(grid);
    positionAt=new Int16Array(grid.cols*grid.rows);
    order.forEach((cell,i)=>{positionAt[cell]=i+1;});
    readTiles();measure();
    primed=false;
  };
  const relayout=()=>{
    const flipped=(portrait.matches?PORTRAIT:LANDSCAPE)!==grid;
    rebuild();
    if (flipped) prepareGlass();
    else if (renderer) {renderer.resize(glassScale);drawGlass(performance.now());}
    wake();
  };
  rebuild();
  tileEls.forEach((el,n)=>{el.tabIndex=n===0?0:-1;});
  applyCam();
  addEventListener('resize',relayout,{passive:true});
  portrait.addEventListener('change',relayout);
  addEventListener('scroll',wake,{passive:true});
  document.addEventListener('visibilitychange',wake);
  new ResizeObserver(()=>{measure();wake();}).observe(qs('.chapters')!);
  new IntersectionObserver(([entry])=>{visible=!!entry?.isIntersecting;wake();}).observe(stage);
  document.fonts?.ready.then(()=>{measure();wake();});

  // The bar on phones appears only while no other pair of buttons is on screen.
  const mobileCta=qs('#mobile-cta'),ownCtas=[...document.querySelectorAll('.home .cta')];
  if (mobileCta&&ownCtas.length) {
    const showing=new Set<Element>();
    const watch=new IntersectionObserver(entries=>{
      for (const e of entries) {if (e.isIntersecting) showing.add(e.target);else showing.delete(e.target);}
      mobileCta.classList.toggle('is-visible',showing.size===0);
    });
    ownCtas.forEach(el=>watch.observe(el));
  }

  // Heavy work waits until the page is on screen and answering.
  const whenIdle=(fn:()=>void)=>('requestIdleCallback' in window?requestIdleCallback(fn,{timeout:1200}):setTimeout(fn,300));
  const light=()=>whenIdle(prepareGlass);
  if (document.readyState==='complete') light();else addEventListener('load',light,{once:true});
  wake();
}
start();
