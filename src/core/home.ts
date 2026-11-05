import type {Locale} from '../lib/contracts/api';
import type {MosaicCompany,PositionRange} from '../lib/mosaic';
import {findPublicProfile,publicProfileDto,type PublicCompanyRow,RETIRED_LABEL_EN,RETIRED_LABEL_ES} from './directory';
import type {PublicStats} from './public';
import {composeStats,readCatalogWithMosaic,readCommerce} from './read-model';

export interface HomeSample {profile:ReturnType<typeof publicProfileDto>;machine:Record<string,unknown>;}
export interface HomeData {
  stats:PublicStats|null;companies:MosaicCompany[];retiredPositions:number[];positionMap:string|null;
  currentRange:PositionRange|null;retiredLabel:string;sample:HomeSample|null;
}
/** The fields of the published JSON-LD worth showing a reader. Taken from the stored document, never written for the page. */
function machineExcerpt(jsonld:string):Record<string,unknown> {
  const graph=(JSON.parse(jsonld) as {'@graph':Array<Record<string,unknown>>})['@graph'];
  const org=graph.find(node=>node['@type']==='Organization')??{};
  const excerpt:Record<string,unknown>={'@type':org['@type']};
  for (const key of ['name','description','knowsAbout','areaServed','identifier']) if (org[key]!==undefined) excerpt[key]=org[key];
  return excerpt;
}
export function homeSample(row:PublicCompanyRow,language:Locale):HomeSample {
  return {profile:publicProfileDto(row,language),machine:machineExcerpt((language==='es'?row.public_jsonld_es:row.public_jsonld)??'{"@graph":[]}')};
}
export function currentRange(stats:PublicStats):PositionRange|null {
  const current=stats.phases.find(p=>p.status==='current');
  return current?{first:current.firstPosition,last:current.lastPosition}:null;
}
export async function loadHome(db:D1Database,language:Locale):Promise<HomeData> {
  const retiredLabel=language==='es'?RETIRED_LABEL_ES:RETIRED_LABEL_EN;
  const empty:HomeData={stats:null,companies:[],retiredPositions:[],positionMap:null,currentRange:null,retiredLabel,sample:null};
  try {
    const [commerce,{catalog,mosaic}]=await Promise.all([readCommerce(db),readCatalogWithMosaic(db)]);
    const stats=composeStats(commerce,catalog);
    const row=catalog.firstSlug?await findPublicProfile(db,catalog.firstSlug):null;
    return {stats,companies:mosaic,retiredPositions:catalog.retired,positionMap:catalog.positionMap,
      currentRange:currentRange(stats),retiredLabel,sample:row?homeSample(row,language):null};
  } catch(e) {
    // The page renders without numbers rather than with invented ones.
    console.error('home_data_unavailable',e instanceof Error?e.message:String(e));
    return empty;
  }
}
