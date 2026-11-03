import {IdentityError,sha256} from './identity';

export interface ProfileInput {
  descriptionEn:string;descriptionEs?:string;
  services:string[];audiences:string[];
  problemSolutions:Array<{problem:string;solution:string}>;
  advantages:string[]; serviceCountries:string[];
}
function requiredText(value:unknown,min:number,max:number):string {
  if (typeof value!=='string') throw new IdentityError('INVALID_PROFILE');
  const result=value.trim();
  if (result.length<min||result.length>max) throw new IdentityError('INVALID_PROFILE');
  return result;
}
function texts(value:unknown,maxItems:number,maxLen:number,required=false):string[] {
  if (!Array.isArray(value)||value.length>maxItems||(required&&value.length===0)) throw new IdentityError('INVALID_PROFILE');
  return [...new Set(value.map(x=>requiredText(x,2,maxLen)))];
}
export function parseProfile(value:Record<string,unknown>):ProfileInput {
  const descriptionEn=requiredText(value.descriptionEn,40,1200);
  const descriptionEs=value.descriptionEs===undefined||value.descriptionEs===null||value.descriptionEs===''?
    undefined:requiredText(value.descriptionEs,40,1200);
  const services=texts(value.services,12,120,true);
  const audiences=texts(value.audiences,12,120);
  const advantages=texts(value.advantages,10,180);
  const serviceCountries=texts(value.serviceCountries,25,2).map(x=>x.toUpperCase());
  if (serviceCountries.some(x=>!/^[A-Z]{2}$/.test(x))) throw new IdentityError('INVALID_PROFILE');
  if (!Array.isArray(value.problemSolutions)||value.problemSolutions.length>12) throw new IdentityError('INVALID_PROFILE');
  const problemSolutions=value.problemSolutions.map(raw=>{
    if (!raw||typeof raw!=='object'||Array.isArray(raw)) throw new IdentityError('INVALID_PROFILE');
    const p=raw as Record<string,unknown>;
    return {problem:requiredText(p.problem,4,200),solution:requiredText(p.solution,4,200)};
  });
  return {descriptionEn,descriptionEs,services,audiences,problemSolutions,advantages,serviceCountries};
}
interface CompanyRow {id:string; display_name:string; slug:string; country:string; industry:string|null;website:string|null;
  publication_status:string;identity_state:string;}
interface VersionRow {canonical_json:string; public_jsonld:string|null; public_jsonld_es:string|null;
  description_es:string|null; approved_at:string|null; published_at:string|null;approved_by:string|null;}
function buildJsonLd(company:CompanyRow,p:ProfileInput,language:'en'|'es') {
  const description=language==='es'&&p.descriptionEs?p.descriptionEs:p.descriptionEn;
  const site=company.website?`https://${company.website}`:undefined;
  return {
    '@context':'https://schema.org', '@type':'Organization',
    '@id':`urn:the1500:company:${company.id}`,
    identifier:company.id,name:company.display_name,
    description,inLanguage:language,
    ...(site?{url:site}:{}),
    address:{'@type':'PostalAddress',addressCountry:company.country},
    ...(company.industry?{industry:company.industry}:{}),
    ...(p.serviceCountries.length?{areaServed:p.serviceCountries.map(code=>({'@type':'Country',identifier:code}))}:{}),
    hasOfferCatalog:{'@type':'OfferCatalog',name:'Declared services',
      itemListElement:p.services.map(name=>({'@type':'Offer',itemOffered:{'@type':'Service',name}}))}
  };
}
export async function createProfileDraft(db:D1Database,companyId:string,userId:string,input:ProfileInput,now=new Date()) {
  const company=await db.prepare(`SELECT * FROM companies WHERE id=?`).bind(companyId).first<CompanyRow>();
  if (!company||company.identity_state==='rejected') throw new IdentityError('COMPANY_NOT_ELIGIBLE',403);
  const previous=await db.prepare(`SELECT COALESCE(MAX(version),0) AS current FROM profile_versions WHERE company_id=?`)
    .bind(companyId).first<{current:number}>();
  const version=(previous?.current??0)+1;
  const data=JSON.stringify({version,source_type:'owner_declaration',...input});
  const jsonld=JSON.stringify(buildJsonLd(company,input,'en'));
  const jsonldEs=input.descriptionEs?JSON.stringify(buildJsonLd(company,input,'es')):null;
  const at=now.toISOString();
  try {
    await db.batch([
      db.prepare(`INSERT INTO profile_versions(company_id,version,canonical_json,public_jsonld,
        description_es,public_jsonld_es,locale,created_at) VALUES(?,?,?,?,?,?,'en',?)`)
        .bind(companyId,version,data,jsonld,input.descriptionEs??null,jsonldEs,at),
      db.prepare(`INSERT INTO owner_profile_declarations(company_id,version,declaration_json,submitted_by,submitted_at)
        VALUES(?,?,?,?,?)`).bind(companyId,version,data,userId,at)
    ]);
  } catch {throw new IdentityError('PROFILE_VERSION_CONFLICT',409);}
  return {companyId,version,status:'draft',preview:{...JSON.parse(jsonld),sourceStatus:'owner_declared',
    descriptionEs:input.descriptionEs??null},contentDigest:await sha256(data),
    requiresExplicitApproval:true};
}
export async function getOwnerProfile(db:D1Database,companyId:string,version:number) {
  const row=await db.prepare(`SELECT canonical_json,public_jsonld,public_jsonld_es,approved_at,published_at
    FROM profile_versions WHERE company_id=? AND version=?`)
    .bind(companyId,version).first<VersionRow>();
  if (!row) throw new IdentityError('PROFILE_NOT_FOUND',404);
  return {companyId,version,canonical:JSON.parse(row.canonical_json),
    preview:row.public_jsonld?JSON.parse(row.public_jsonld):null,
    previewEs:row.public_jsonld_es?JSON.parse(row.public_jsonld_es):null,
    approvedAt:row.approved_at,publishedAt:row.published_at,
    contentDigest:await sha256(row.canonical_json)};
}
export async function approveProfile(db:D1Database,companyId:string,version:number,userId:string,
  expectedDigest:string,now=new Date()) {
  const record=await db.prepare(`SELECT canonical_json,approved_at,published_at FROM profile_versions
     WHERE company_id=? AND version=?`).bind(companyId,version).first<VersionRow>();
  if (!record) throw new IdentityError('PROFILE_NOT_FOUND',404);
  if (record.approved_at||record.published_at) throw new IdentityError('ALREADY_APPROVED',409);
  const digest=await sha256(record.canonical_json);
  if (digest!==expectedDigest) throw new IdentityError('STALE_PROFILE_PREVIEW',409);
  const at=now.toISOString();
  const results=await db.batch([
    db.prepare(`UPDATE profile_versions SET approved_by=?,approved_at=? WHERE company_id=?
      AND version=? AND approved_at IS NULL AND published_at IS NULL`).bind(userId,at,companyId,version),
    db.prepare(`INSERT INTO profile_approvals(company_id,version,user_id,content_digest,approved_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM profile_versions WHERE company_id=?
      AND version=? AND approved_by=? AND approved_at=?)`)
      .bind(companyId,version,userId,digest,at,companyId,version,userId,at)
  ]);
  if (results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
    throw new IdentityError('PROFILE_APPROVAL_CONFLICT',409);
  return {companyId,version,status:'owner_approved',approvedAt:at};
}
export async function publishProfile(db:D1Database,companyId:string,version:number,now=new Date()) {
  const row=await db.prepare(`SELECT v.canonical_json,v.public_jsonld,v.approved_at,v.published_at,c.identity_state,
      c.display_name,c.industry,c.country
    FROM profile_versions v JOIN companies c ON c.id=v.company_id
    WHERE v.company_id=? AND v.version=?`).bind(companyId,version)
    .first<VersionRow & {identity_state:string;display_name:string;industry:string|null;country:string}>();
  if (!row||!row.approved_at||row.published_at) throw new IdentityError('PROFILE_NOT_APPROVED',409);
  if (!['self_declared','admin_verified'].includes(row.identity_state)) throw new IdentityError('COMPANY_REVIEW_REQUIRED',409);
  if (!row.public_jsonld) throw new IdentityError('PUBLIC_FORMAT_MISSING',409);
  const allocated=await db.prepare(`SELECT number FROM slots WHERE company_id=?
    AND status='assigned' AND assignment_kind IN('paid','founder','premium') LIMIT 1`)
    .bind(companyId).first<{number:number}>();
  if (!allocated) throw new IdentityError('NO_CONFIRMED_SLOT',403);
  const at=now.toISOString();const digest=await sha256(row.public_jsonld);
  const canonical=JSON.parse(row.canonical_json) as ProfileInput;
  const result=await db.batch([
    db.prepare(`UPDATE profile_versions SET published_at=? WHERE company_id=? AND version=?
      AND approved_at IS NOT NULL AND published_at IS NULL`).bind(at,companyId,version),
    db.prepare(`INSERT INTO published_profile_snapshots(company_id,version,jsonld_digest,published_at)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM profile_versions WHERE company_id=?
      AND version=? AND published_at=?)`).bind(companyId,version,digest,at,companyId,version,at),
    db.prepare(`UPDATE companies SET publication_status='published',public_summary=?,published_at=COALESCE(published_at,?)
      WHERE id=? AND EXISTS(SELECT 1 FROM profile_versions WHERE company_id=? AND version=? AND published_at=?)`)
      .bind(canonical.descriptionEn,at,companyId,companyId,version,at),
    // Refresh the public-only FTS index inside the same atomic D1 batch.
    db.prepare(`DELETE FROM published_company_fts WHERE company_id=?`).bind(companyId),
    db.prepare(`INSERT INTO published_company_fts(company_id,name,industry,country,summary,services,problems,solutions)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(
        SELECT 1 FROM companies c JOIN published_profile_snapshots p ON p.company_id=c.id
        WHERE c.id=? AND p.version=? AND c.publication_status='published')`)
      .bind(companyId,row.display_name,row.industry??'',row.country,
        [canonical.descriptionEn,canonical.descriptionEs??''].join(' '),canonical.services.join(' '),
        canonical.problemSolutions.map(x=>x.problem).join(' '),
        canonical.problemSolutions.map(x=>x.solution).join(' '),companyId,version)
  ]);
  if (result[0]?.meta?.changes!==1||result[1]?.meta?.changes!==1||result[4]?.meta?.changes!==1)
    throw new IdentityError('PUBLICATION_CONFLICT',409);
  return {companyId,version,status:'published',publishedAt:at,slotNumber:allocated.number};
}
