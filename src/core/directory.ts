import {IdentityError} from './identity';
export interface PublicCompanyCard {slug:string;name:string;country:string;industry:string|null;summary:string|null;}
export interface PublicCompanyRow {
  id:string;slug:string;display_name:string;country:string;industry:string|null;
  website:string|null;public_summary:string|null;version:number;
  public_jsonld:string|null;public_jsonld_es:string|null;
}
export async function findPublicProfile(db:D1Database,slug:string):Promise<PublicCompanyRow|null> {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return null;
  const row=await db.prepare(`SELECT c.id,c.slug,c.display_name,c.country,c.industry,c.website,
    c.public_summary,v.version,v.public_jsonld,v.public_jsonld_es
    FROM companies c JOIN profile_versions v ON v.company_id=c.id
    WHERE c.slug=? AND c.publication_status='published' AND v.published_at IS NOT NULL
      AND v.version=(SELECT MAX(v2.version) FROM profile_versions v2
        WHERE v2.company_id=c.id AND v2.published_at IS NOT NULL)`)
    .bind(slug).first<PublicCompanyRow>();
  return row||null;
}
export async function listPublishedCompanies(db:D1Database,filters:{page:number;country?:string;q?:string}) {
  if (!Number.isSafeInteger(filters.page)||filters.page<1||filters.page>500) throw new IdentityError('INVALID_PAGE');
  if (filters.country&&!/^[A-Z]{2}$/.test(filters.country)) throw new IdentityError('INVALID_COUNTRY');
  if (filters.q && filters.q.length>100) throw new IdentityError('INVALID_QUERY');
  const q=filters.q?.toLowerCase().replace(/[\\%_]/g,'\\$&');
  const where=`c.publication_status='published' AND EXISTS(
    SELECT 1 FROM profile_versions v WHERE v.company_id=c.id AND v.published_at IS NOT NULL)
    AND (? IS NULL OR c.country=?)
    AND (? IS NULL OR LOWER(c.display_name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.industry,'')) LIKE ? ESCAPE '\\'
         OR LOWER(COALESCE(c.public_summary,'')) LIKE ? ESCAPE '\\')`;
  const args=[filters.country||null,filters.country||null,q||null,...Array(3).fill(q?`%${q}%`:null)];
  const count=await db.prepare(`SELECT COUNT(*) AS total FROM companies c WHERE ${where}`)
    .bind(...args).first<{total:number}>();
  const res=await db.prepare(`SELECT c.slug,c.display_name AS name,c.country,c.industry,c.public_summary AS summary
    FROM companies c WHERE ${where} ORDER BY c.published_at DESC,c.id ASC LIMIT 24 OFFSET ?`)
    .bind(...args,(filters.page-1)*24).all<PublicCompanyCard>();
  return {items:res.results,page:filters.page,pageSize:24,total:count?.total??0};
}
