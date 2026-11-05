/** The wall on the Home: where each of the 1,500 positions sits and how much room each company takes. Pure, so server and browser agree. */
export interface MosaicCompany {slug:string;name:string;position:number;industry:string|null;country:string;}
export interface Grid {cols:number;rows:number;}
export interface TileRect {col:number;row:number;w:number;h:number;anchorCol:number;anchorRow:number;}
export interface PositionRange {first:number;last:number;}
/** One character per position, from getPositionMap: published, otherwise assigned, retired, or open. */
export type PositionCode='p'|'o'|'x'|'a';

export const CAPACITY=1500;
export const LANDSCAPE:Grid={cols:50,rows:30};
export const PORTRAIT:Grid={cols:30,rows:50};
/** Decision 2026-11-03: positions below this one are reserved for founders, by invitation. */
export const FIRST_PAID_POSITION=101;
const MAX_TILE=5;
const COVERAGE=0.2;

export const SMALTI=[
  {bg:'#1f43b0',ink:'#f5f2eb'},{bg:'#d8452d',ink:'#fff6ea'},{bg:'#e8a92e',ink:'#1a1305'},{bg:'#0f7a5c',ink:'#eefbf3'},
  {bg:'#7e1f2e',ink:'#fbe9df'},{bg:'#1fa6a8',ink:'#04201f'},{bg:'#5b2e91',ink:'#f3ecff'},{bg:'#ede6d6',ink:'#17130b'},
  {bg:'#c9a24b',ink:'#191204'},{bg:'#c2557a',ink:'#fff0f4'},
] as const;

export function hash(text:string):number {
  let h=2166136261;
  for (let i=0;i<text.length;i++) {h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return h>>>0;
}
/** Colour and lettering come from the slug, so they carry no rank and never change. */
export function tileLook(slug:string) {
  const h=hash(slug);
  return {color:SMALTI[h%SMALTI.length]!,variant:(h>>>8)%6};
}
export const isDemoName=(name:string)=>/^demo\s/i.test(name);
const MINOR=new Set(['of','the','and','de','del','la','el','los','las','y','e','&','inc','llc','ltd','sa','sas','s.a.','corp','co']);
export function monogram(name:string):string {
  const words=name.replace(/^demo\s+/i,'').split(/\s+/).filter(w=>w&&!MINOR.has(w.toLowerCase()));
  if (!words.length) return Array.from(name)[0]?.toUpperCase()??'';
  if (words.length===1) {const letters=Array.from(words[0]!);return letters[0]!.toUpperCase()+(letters[1]?.toLowerCase()??'');}
  return (Array.from(words[0]!)[0]!+Array.from(words[1]!)[0]!).toUpperCase();
}

/** Position to cell, spiralling out from the middle. Position 1 is the centre and no position ever moves. */
export function cellOrder(grid:Grid):number[] {
  const cx=(grid.cols-1)/2,cy=(grid.rows-1)/2;
  const cells:{cell:number;ring:number;angle:number}[]=[];
  for (let r=0;r<grid.rows;r++) for (let c=0;c<grid.cols;c++) {
    const dx=c-cx,dy=r-cy;
    cells.push({cell:r*grid.cols+c,ring:Math.floor(Math.hypot(dx,dy)),angle:(Math.atan2(dx,-dy)+2*Math.PI)%(2*Math.PI)});
  }
  cells.sort((a,b)=>a.ring-b.ring||a.angle-b.angle||a.cell-b.cell);
  return cells.map(c=>c.cell);
}
/** The fewer companies there are, the more of the wall each one takes. At full capacity each takes one cell. */
export function baseTileSize(count:number):number {
  if (count<=0) return MAX_TILE;
  return Math.max(1,Math.min(MAX_TILE,Math.round(Math.sqrt(COVERAGE*CAPACITY/count))));
}
function tileShape(slug:string,base:number):[number,number] {
  if (base===1) return [1,1];
  const shapes:[number,number][]=base>=5?[[base,base],[base+2,base-1],[base-1,base+1],[base+1,base-1]]
    :base>=3?[[base,base],[base+1,base-1],[base-1,base+1]]:[[2,2],[3,2],[2,3]];
  return shapes[(hash(slug)>>>16)%shapes.length]!;
}
/**
 * Places each company as near its own position as the wall allows, in position order.
 * Pieces never overlap and never cover a position that is assigned without a profile or retired.
 */
export function layoutTiles(companies:Pick<MosaicCompany,'slug'|'position'>[],map:string,grid:Grid):Map<string,TileRect> {
  const order=cellOrder(grid),total=grid.cols*grid.rows;
  const used=new Uint8Array(total);
  for (let i=0;i<map.length;i++) if (map[i]==='o'||map[i]==='x') used[order[i]!]=1;
  const offsets:[number,number][]=[];
  for (let dy=-grid.rows;dy<=grid.rows;dy++) for (let dx=-grid.cols;dx<=grid.cols;dx++) offsets.push([dx,dy]);
  offsets.sort((a,b)=>a[0]*a[0]+a[1]*a[1]-b[0]*b[0]-b[1]*b[1]);
  const fits=(col:number,row:number,w:number,h:number)=>{
    if (col<0||row<0||col+w>grid.cols||row+h>grid.rows) return false;
    for (let r=row;r<row+h;r++) for (let c=col;c<col+w;c++) if (used[r*grid.cols+c]) return false;
    return true;
  };
  const base=baseTileSize(companies.length),out=new Map<string,TileRect>();
  for (const company of [...companies].sort((a,b)=>a.position-b.position)) {
    const cell=order[company.position-1]!,anchorCol=cell%grid.cols,anchorRow=Math.floor(cell/grid.cols);
    const [w,h]=tileShape(company.slug,base);
    const startCol=anchorCol-Math.floor(w/2),startRow=anchorRow-Math.floor(h/2);
    let placed:[number,number,number,number]|null=null;
    for (const [dx,dy] of offsets) if (fits(startCol+dx,startRow+dy,w,h)) {placed=[startCol+dx,startRow+dy,w,h];break;}
    if (!placed) for (const [dx,dy] of offsets) if (fits(anchorCol+dx,anchorRow+dy,1,1)) {placed=[anchorCol+dx,anchorRow+dy,1,1];break;}
    if (!placed) continue;
    for (let r=placed[1];r<placed[1]+placed[3];r++) for (let c=placed[0];c<placed[0]+placed[2];c++) used[r*grid.cols+c]=1;
    out.set(company.slug,{col:placed[0],row:placed[1],w:placed[2],h:placed[3],anchorCol,anchorRow});
  }
  return out;
}
/** Where the camera looks: the middle of the companies, or of the wall while it is empty. */
export function focusOf(rects:Iterable<TileRect>,grid:Grid):{x:number;y:number} {
  let x=0,y=0,n=0;
  for (const t of rects) {x+=t.col+t.w/2;y+=t.row+t.h/2;n++;}
  return n?{x:x/n,y:y/n}:{x:grid.cols/2,y:grid.rows/2};
}

export type PositionStatus='published'|'assigned'|'retired'|'reserved'|'open'|'unreleased';
export function positionStatus(position:number,code:string|undefined,current:PositionRange|null):PositionStatus {
  if (code==='p') return 'published';
  if (code==='o') return 'assigned';
  if (code==='x') return 'retired';
  if (position<FIRST_PAID_POSITION) return 'reserved';
  return current&&position>=current.first&&position<=current.last?'open':'unreleased';
}
export function countPositions(map:string,current:PositionRange|null):Record<PositionStatus,number> {
  const counts:Record<PositionStatus,number>={published:0,assigned:0,retired:0,reserved:0,open:0,unreleased:0};
  for (let i=0;i<map.length;i++) counts[positionStatus(i+1,map[i],current)]++;
  return counts;
}
