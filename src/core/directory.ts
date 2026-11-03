import {IdentityError} from './identity';
export interface PublicCompanyCard {slug:string;name:string;country:string;industry:string|null;summary:string|null;position:number;}
export interface PublicCompanyRow {
  id:string;slug:string;display_name:string;country:string;industry:string|null;
  website:string|null;public_summary:string|null;version:number;position:number;
  public_jsonld:string|null;public_jsonld_es:string|null;canonical_json:string;published_at:string;first_published_at:string;
}
export async function findPublicProfile(db:D1Database,slug:string):Promise<PublicCompanyRow|null> {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return null;
  const row=await db.prepare(`SELECT c.id,c.slug,c.display_name,c.country,c.industry,c.website,
    c.public_summary,v.version,v.public_jsonld,v.public_jsonld_es,v.canonical_json,v.published_at,c.published_at AS first_published_at,s.number AS position
    FROM companies c JOIN profile_versions v ON v.company_id=c.id JOIN slots s ON s.company_id=c.id
    WHERE c.slug=? AND c.publication_status='published' AND v.published_at IS NOT NULL AND s.status='assigned'
      AND v.version=(SELECT MAX(v2.version) FROM profile_versions v2
        WHERE v2.company_id=c.id AND v2.published_at IS NOT NULL)`)
    .bind(slug).first<PublicCompanyRow>();
  return row||null;
}
/** The public projection of a profile. Clients, users, payments and founder status are never selected. */
export function publicProfileDto(row:PublicCompanyRow,language:'en'|'es'='en') {
  const p=JSON.parse(row.canonical_json) as import('./profiles').CanonicalProfile;
  const es=language==='es';
  return {slug:row.slug,name:row.display_name,country:row.country,industry:row.industry,website:row.website,position:row.position,
    summary:(es?p.descriptionEs:p.descriptionEn)??p.descriptionOriginal,originalLanguage:p.originalLanguage,
    services:es&&p.servicesEs?p.servicesEs:p.services,audiences:es&&p.audiencesEs?p.audiencesEs:p.audiences,
    problemSolutions:es&&p.problemSolutionsEs?p.problemSolutionsEs:p.problemSolutions,
    serviceCountries:p.serviceCountries,foundedYear:p.foundedYear,
    ownerDeclared:{certifications:p.publish.certifications?p.certifications:[],advantages:p.publish.advantages?p.advantages:[]},
    provenance:Object.fromEntries(Object.entries(p.provenance).filter(([k])=>!['clients','certifications','advantages'].includes(k)||(p.publish as Record<string,boolean>)[k]).map(([k,e])=>[k,e.type])),
    version:row.version,publishedAt:row.published_at,firstPublishedAt:row.first_published_at,
    html:`${es?'/es':''}/empresas/${row.slug}`,jsonld:`/api/v1/public/companies/${row.slug}.json${es?'?lang=es':''}`};
}
export async function listPublishedCompanies(db:D1Database,filters:{page:number;country?:string;q?:string;industry?:string;service?:string}) {
  if (!Number.isSafeInteger(filters.page)||filters.page<1||filters.page>500) throw new IdentityError('INVALID_PAGE');
  if (filters.country&&!/^[A-Z]{2}$/.test(filters.country)) throw new IdentityError('INVALID_COUNTRY');
  for (const text of [filters.q,filters.industry,filters.service]) if (text&&text.length>100) throw new IdentityError('INVALID_QUERY');
  const like=(text?:string)=>text?`%${text.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`:null;
  const q=like(filters.q),industry=like(filters.industry),service=like(filters.service);
  const where=`c.publication_status='published' AND s.status='assigned' AND EXISTS(
    SELECT 1 FROM profile_versions v WHERE v.company_id=c.id AND v.published_at IS NOT NULL)
    AND (? IS NULL OR c.country=?)
    AND (? IS NULL OR LOWER(COALESCE(c.industry,'')) LIKE ? ESCAPE '\\')
    AND (? IS NULL OR EXISTS(SELECT 1 FROM published_company_fts f WHERE f.company_id=c.id AND LOWER(f.services) LIKE ? ESCAPE '\\'))
    AND (? IS NULL OR LOWER(c.display_name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.industry,'')) LIKE ? ESCAPE '\\'
         OR LOWER(COALESCE(c.public_summary,'')) LIKE ? ESCAPE '\\')`;
  const args=[filters.country||null,filters.country||null,industry,industry,service,service,q,q,q,q];
  const count=await db.prepare(`SELECT COUNT(*) AS total FROM companies c JOIN slots s ON s.company_id=c.id WHERE ${where}`)
    .bind(...args).first<{total:number}>();
  const res=await db.prepare(`SELECT c.slug,c.display_name AS name,c.country,c.industry,c.public_summary AS summary,s.number AS position
    FROM companies c JOIN slots s ON s.company_id=c.id WHERE ${where} ORDER BY s.number ASC LIMIT 24 OFFSET ?`)
    .bind(...args,(filters.page-1)*24).all<PublicCompanyCard>();
  return {items:res.results,page:filters.page,pageSize:24,total:count?.total??0};
}
/** Decision 29: exact text; nothing identifies the company that held the position. */
export const RETIRED_LABEL_ES='Cupo retirado — No disponible';
export const RETIRED_LABEL_EN='Position retired — Not available';
export async function listRetiredPositions(db:D1Database) {
  const rows=await db.prepare(`SELECT number AS position FROM slots WHERE status='retired' ORDER BY number`).all<{position:number}>();
  return {items:rows.results.map(r=>({position:r.position,label:RETIRED_LABEL_EN,labelEs:RETIRED_LABEL_ES}))};
}
