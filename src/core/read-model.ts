import type {InventorySummary,PhaseSummary,SlotPhase} from '../lib/contracts/inventory';
import type {MosaicCompany} from '../lib/mosaic';
import {FIRST_PAID_NUMBER,getSalesState} from './inventory';

/**
 * Public data that is computed once and reused until something it depends on changes.
 * Reading costs a few rows whatever the size of the register; a change costs one rebuild, on the next read.
 * The tables stay the authority: checkout, payment and adjudication never come through here, and nothing here
 * holds a session, a user or an internal company id. Migration 0010 explains the revisions.
 * Change the version in a key when the shape of its payload changes, so a stored one is not read by new code.
 */
const KEYS={commerce:'commerce:v1',catalog:'catalog:v1',mosaic:'mosaic:v1'} as const;
type Scope='commerce'|'catalog';
const RANGES:Record<SlotPhase,[number,number,number]>={1:[1,600,10000],2:[601,1050,40000],3:[1051,1350,100000],4:[1351,1500,506600]};

async function readThrough(db:D1Database,scope:Scope,keys:string[],build:()=>Promise<Record<string,unknown>>):Promise<Record<string,string>> {
  const rows=await db.prepare(`SELECT r.revision AS current,m.key,m.revision AS built,m.payload FROM read_model_revisions r
    LEFT JOIN read_models m ON m.key IN (${keys.map(()=>'?').join(',')}) WHERE r.scope=?`)
    .bind(...keys,scope).all<{current:number;key:string|null;built:number|null;payload:string|null}>();
  const fresh:Record<string,string>={};
  for (const r of rows.results) if (r.key&&r.built===r.current) fresh[r.key]=r.payload!;
  if (keys.every(k=>k in fresh)) return fresh;
  // The revision was read first, so what is computed now is at least that recent. If it moved meanwhile,
  // the next read rebuilds. Parallel rebuilds are harmless: the newest revision wins.
  const revision=rows.results[0]?.current;
  const built=Object.fromEntries(Object.entries(await build()).map(([k,v])=>[k,JSON.stringify(v)]));
  if (revision!==undefined) {
    const at=new Date().toISOString();
    try {
      await db.batch(Object.entries(built).map(([k,payload])=>db.prepare(`INSERT INTO read_models(key,revision,payload,built_at) VALUES(?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,built_at=excluded.built_at
        WHERE excluded.revision>=read_models.revision`).bind(k,revision,payload,at)));
    } catch(e) {
      // The visitor still gets correct data; the next read tries again.
      console.error('read_model_write_failed',e instanceof Error?e.message:String(e));
    }
  }
  return built;
}

export type CommerceModel=Omit<InventorySummary,'capacity'|'published'|'sectorsRepresented'>;
export async function buildCommerce(db:D1Database):Promise<CommerceModel> {
  const [counts,sales]=await Promise.all([
    db.prepare(`SELECT phase,status,COUNT(*) AS n,SUM(number<${FIRST_PAID_NUMBER}) AS low FROM slots GROUP BY phase,status`)
      .all<{phase:SlotPhase;status:string;n:number;low:number}>(),
    getSalesState(db),
  ]);
  const total={assigned:0,retired:0,held:0,available:0};
  const remaining=new Map<SlotPhase,number>(),reserved=new Map<SlotPhase,number>();
  let capacity=0;
  for (const c of counts.results) {
    capacity+=c.n;
    if (c.status in total) total[c.status as keyof typeof total]+=c.n;
    const open=c.status==='available'||c.status==='held';
    remaining.set(c.phase,(remaining.get(c.phase)??0)+(open?c.n:0));
    reserved.set(c.phase,(reserved.get(c.phase)??0)+(open?c.low:0));
  }
  if (capacity!==1500) throw new Error('Inventory integrity check failed');
  const summaries:PhaseSummary[]=([1,2,3,4] as SlotPhase[]).map(phase=>{
    const [firstPosition,lastPosition,priceUsdCents]=RANGES[phase];
    const left=remaining.get(phase)??0,kept=reserved.get(phase)??0;
    return {phase,firstPosition,lastPosition,priceUsdCents,remaining:left,reservedByInvitation:kept,forSale:left-kept,
      status:phase===sales.currentPhase?'current':(sales.currentPhase===null||phase<sales.currentPhase)?'sold_out':'upcoming'};
  });
  return {occupied:total.assigned+total.retired,held:total.held,available:total.available,retired:total.retired,
    currentPhase:sales.currentPhase,currentPriceUsdCents:sales.priceUsdCents,salesMode:sales.mode,checkoutOpen:sales.checkoutOpen,
    // Decision UX-003: phases not yet open stay private. Their price and range are read by checkout once they open.
    phases:summaries.filter(p=>p.status!=='upcoming')};
}

export interface CatalogModel {
  /** One character per position, 1 to 1500: p published, o otherwise assigned, x retired, a open. No company is identified. */
  positionMap:string;retired:number[];published:number;sectorsRepresented:number;firstSlug:string|null;
}
async function buildCatalog(db:D1Database):Promise<Record<string,unknown>> {
  const [rows,counts]=await Promise.all([
    db.prepare(`SELECT s.number AS position,s.status,c.slug,c.display_name AS name,c.country,c.industry,
        (s.status='assigned' AND c.publication_status='published' AND EXISTS(
          SELECT 1 FROM profile_versions v WHERE v.company_id=c.id AND v.published_at IS NOT NULL)) AS listed
      FROM slots s LEFT JOIN companies c ON c.id=s.company_id WHERE s.status IN('assigned','retired') ORDER BY s.number`)
      .all<MosaicCompany&{status:'assigned'|'retired';listed:number}>(),
    db.prepare(`SELECT COUNT(*) AS published,COUNT(DISTINCT industry) AS sectors FROM companies WHERE publication_status='published'`)
      .first<{published:number;sectors:number}>(),
  ]);
  const map=new Array<string>(1500).fill('a');
  const retired:number[]=[],mosaic:MosaicCompany[]=[];
  for (const r of rows.results) {
    map[r.position-1]=r.status==='retired'?'x':r.listed?'p':'o';
    if (r.status==='retired') retired.push(r.position);
    if (r.listed) mosaic.push({slug:r.slug,name:r.name,country:r.country,industry:r.industry,position:r.position});
  }
  const catalog:CatalogModel={positionMap:map.join(''),retired,published:counts?.published??0,sectorsRepresented:counts?.sectors??0,firstSlug:mosaic[0]?.slug??null};
  return {[KEYS.catalog]:catalog,[KEYS.mosaic]:mosaic};
}

export async function readCommerce(db:D1Database):Promise<CommerceModel> {
  const r=await readThrough(db,'commerce',[KEYS.commerce],async()=>({[KEYS.commerce]:await buildCommerce(db)}));
  return JSON.parse(r[KEYS.commerce]!) as CommerceModel;
}
export async function readCatalog(db:D1Database):Promise<CatalogModel> {
  const r=await readThrough(db,'catalog',[KEYS.catalog],()=>buildCatalog(db));
  return JSON.parse(r[KEYS.catalog]!) as CatalogModel;
}
/** The wall needs both, and they come from the same query, so one read asks for both. */
export async function readCatalogWithMosaic(db:D1Database):Promise<{catalog:CatalogModel;mosaic:MosaicCompany[]}> {
  const r=await readThrough(db,'catalog',[KEYS.catalog,KEYS.mosaic],()=>buildCatalog(db));
  return {catalog:JSON.parse(r[KEYS.catalog]!) as CatalogModel,mosaic:JSON.parse(r[KEYS.mosaic]!) as MosaicCompany[]};
}
export function composeStats(commerce:CommerceModel,catalog:CatalogModel):InventorySummary {
  const {occupied,held,available,retired,currentPhase,currentPriceUsdCents,salesMode,checkoutOpen,phases}=commerce;
  return {capacity:1500,occupied,held,available,retired,published:catalog.published,sectorsRepresented:catalog.sectorsRepresented,
    currentPhase,currentPriceUsdCents,salesMode,checkoutOpen,phases};
}
