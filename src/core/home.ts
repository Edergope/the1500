import type {Locale} from '../lib/contracts/api';
import type {MosaicCompany,PositionRange} from '../lib/mosaic';
import {findPublicProfile,listMosaicCompanies,listRetiredPositions,publicProfileDto,RETIRED_LABEL_EN,RETIRED_LABEL_ES} from './directory';
import {getPositionMap,getPublicStats,type PublicStats} from './public';

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
export async function loadHome(db:D1Database,language:Locale):Promise<HomeData> {
  const retiredLabel=language==='es'?RETIRED_LABEL_ES:RETIRED_LABEL_EN;
  const empty:HomeData={stats:null,companies:[],retiredPositions:[],positionMap:null,currentRange:null,retiredLabel,sample:null};
  try {
    const [stats,companies,retired,positionMap]=await Promise.all([
      getPublicStats(db),listMosaicCompanies(db),listRetiredPositions(db),getPositionMap(db),
    ]);
    const first=companies[0];
    const row=first?await findPublicProfile(db,first.slug):null;
    const sample=row?{profile:publicProfileDto(row,language),machine:machineExcerpt((language==='es'?row.public_jsonld_es:row.public_jsonld)??'{"@graph":[]}')}:null;
    const current=stats.phases.find(p=>p.status==='current');
    return {stats,companies,retiredPositions:retired.items.map(r=>r.position),positionMap,
      currentRange:current?{first:current.firstPosition,last:current.lastPosition}:null,retiredLabel,sample};
  } catch(e) {
    // The page renders without numbers rather than with invented ones.
    console.error('home_data_unavailable',e instanceof Error?e.message:String(e));
    return empty;
  }
}
