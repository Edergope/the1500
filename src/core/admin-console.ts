import type {InventorySummary} from '../lib/contracts/inventory';
import {AdminError} from './admin';
import {sha256} from './identity';
import {contentDigestSource} from './profiles';
import {composeStats,readCatalog,readCommerce} from './read-model';

/**
 * Reads behind the administration panel. Nothing here writes: actions stay in admin.ts, behind their own routes.
 * Session tokens, digests of sessions and login links are never selected.
 */
/** RFC 2606 reserves .example, and the demo seed uses it for every owner, so no real company can have one. */
export const isDemoAddress=(email:string|null|undefined)=>!!email&&/\.example$/i.test(email);
const page=(limit:number,offset:number,max=100)=>{
  if (!Number.isSafeInteger(limit)||limit<1||limit>max||!Number.isSafeInteger(offset)||offset<0) throw new AdminError('INVALID_LIMIT',400);
};
/**
 * LIMIT and OFFSET go into the SQL as numbers, after page() has checked them. Bound as parameters, SQLite does not
 * know the page is small and scans the whole table instead of the index (3,254 rows instead of 306 at 1,500 companies).
 */
const window_=(filtered:boolean,limit:number,offset:number)=>`LIMIT ${filtered?limit:limit+1} OFFSET ${offset}`;
const like=(text?:string)=>text?`%${text.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`:null;
/**
 * A page of a list. Without filters it walks an index and stops at the page, so no total is counted (that would read
 * every row); one extra row says whether there is a next page. With filters the scan happens anyway and brings the total.
 */
export interface ListPage {total:number|null;hasMore:boolean;limit:number;offset:number;}
function pageOf<T extends {total:number|null}>(rows:T[],filtered:boolean,limit:number,offset:number):{rows:Omit<T,'total'>[]}&ListPage {
  const total=filtered?(rows[0]?.total??(offset===0?0:null)):null;
  const hasMore=filtered?(total!==null&&offset+limit<total):rows.length>limit;
  return {rows:rows.slice(0,limit).map(({total:_,...row})=>row),total,hasMore,limit,offset};
}
const parse=(text:string|null|undefined):unknown=>{
  if (!text) return null;
  try {return JSON.parse(text);} catch {return null;}
};

/** For a page that must answer 404 itself: only the page can still set its status. */
export async function readRecord<T>(read:()=>Promise<T>):Promise<{record:T|null;missing:boolean}> {
  try {return {record:await read(),missing:false};} catch(e) {
    if (e instanceof AdminError&&e.httpStatus===404) return {record:null,missing:true};
    console.error('admin_record_unavailable',e instanceof Error?e.message:String(e));
    return {record:null,missing:false};
  }
}
export interface ControlOverview {
  stats:InventorySummary;
  companies:{total:number;pendingReview:number;demo:number;real:number;blocked:number};
  profiles:{versions:number;companiesWithProfile:number;pendingReview:number;pendingOwnerApproval:number};
  payments:{attempts:number;confirmed:number;refunded:number;inReview:number};
  incidentsOpen:number;requestsOpen:number;foundersActive:number;
}
export async function getControlOverview(db:D1Database):Promise<ControlOverview> {
  const [commerce,catalog,companies,demo,profiles,payments,other]=await Promise.all([
    readCommerce(db),readCatalog(db),
    db.prepare(`SELECT COUNT(*) AS total,SUM(identity_state='pending_review') AS pending,SUM(publication_block IS NOT NULL) AS blocked FROM companies`)
      .first<{total:number;pending:number|null;blocked:number|null}>(),
    // CROSS JOIN keeps users first: one pass over users, then a key lookup only for the demo ones.
    db.prepare(`SELECT COUNT(DISTINCT m.company_id) AS n FROM users u CROSS JOIN memberships m ON m.user_id=u.id WHERE u.email LIKE '%.example' AND m.role='owner'`).first<{n:number}>(),
    db.prepare(`SELECT COUNT(*) AS versions,COUNT(DISTINCT v.company_id) AS companies,SUM(v.review_status='pending') AS review,
        SUM(v.approved_at IS NULL AND v.published_at IS NULL AND v.review_status<>'rejected'
          AND v.version=(SELECT MAX(x.version) FROM profile_versions x WHERE x.company_id=v.company_id)) AS approval
      FROM profile_versions v`).first<{versions:number;companies:number;review:number|null;approval:number|null}>(),
    db.prepare(`SELECT COUNT(*) AS attempts,SUM(status='paid') AS confirmed,SUM(status='refunded') AS refunded,
        SUM(status IN('late_review','amount_review','refund_pending','disputed')) AS review FROM purchase_attempts`)
      .first<{attempts:number;confirmed:number|null;refunded:number|null;review:number|null}>(),
    db.prepare(`SELECT (SELECT COUNT(*) FROM incidents WHERE status='open') AS incidents,(SELECT COUNT(*) FROM service_requests WHERE status='requested') AS requests,
        (SELECT COUNT(*) FROM founder_awards WHERE status='active') AS founders`).first<{incidents:number;requests:number;founders:number}>(),
  ]);
  const total=companies?.total??0,demoCount=demo?.n??0;
  return {stats:composeStats(commerce,catalog),
    companies:{total,pendingReview:companies?.pending??0,demo:demoCount,real:total-demoCount,blocked:companies?.blocked??0},
    profiles:{versions:profiles?.versions??0,companiesWithProfile:profiles?.companies??0,pendingReview:profiles?.review??0,pendingOwnerApproval:profiles?.approval??0},
    payments:{attempts:payments?.attempts??0,confirmed:payments?.confirmed??0,refunded:payments?.refunded??0,inReview:payments?.review??0},
    incidentsOpen:other?.incidents??0,requestsOpen:other?.requests??0,foundersActive:other?.founders??0};
}

export interface CompanyFilters {
  q?:string;email?:string;country?:string;industry?:string;identity?:string;publication?:string;position?:number;limit:number;offset:number;
}
export interface CompanyRow {
  id:string;displayName:string;slug:string;country:string;website:string|null;industry:string|null;identityState:string;
  publicationStatus:string;publicationBlock:string|null;createdAt:string;position:number|null;positionStatus:string|null;
  assignmentKind:string|null;onboardingStatus:string|null;ownerEmail:string|null;isDemo:boolean;
}
export async function searchCompanies(db:D1Database,f:CompanyFilters) {
  page(f.limit,f.offset);
  for (const text of [f.q,f.email,f.industry]) if (text&&text.length>100) throw new AdminError('INVALID_QUERY',400);
  if (f.country&&!/^[A-Z]{2}$/.test(f.country)) throw new AdminError('INVALID_COUNTRY',400);
  if (f.position!==undefined&&(!Number.isSafeInteger(f.position)||f.position<1||f.position>1500)) throw new AdminError('INVALID_QUERY',400);
  const q=like(f.q),email=like(f.email),industry=like(f.industry);
  // Only the filters in use reach the SQL, so the planner can use an index for each one.
  const where:string[]=[],binds:unknown[]=[];
  if (q) {where.push(`(LOWER(c.display_name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.website,'')) LIKE ? ESCAPE '\\')`);binds.push(q,q);}
  // From users to companies: one pass over users and a key lookup per match, with or without migration 0011.
  if (email) {where.push(`c.id IN (SELECT m.company_id FROM users u CROSS JOIN memberships m ON m.user_id=u.id WHERE LOWER(u.email) LIKE ? ESCAPE '\\')`);binds.push(email);}
  if (f.country) {where.push('c.country=?');binds.push(f.country);}
  if (industry) {where.push(`LOWER(COALESCE(c.industry,'')) LIKE ? ESCAPE '\\'`);binds.push(industry);}
  if (f.identity) {where.push('c.identity_state=?');binds.push(f.identity);}
  if (f.publication) {where.push('c.publication_status=?');binds.push(f.publication);}
  if (f.position!==undefined) {where.push('c.id=(SELECT company_id FROM slots WHERE number=?)');binds.push(f.position);}
  const filtered=where.length>0;
  // The page is chosen first, so the owner is looked up only for the rows shown.
  const rows=await db.prepare(`WITH chosen AS (
      SELECT c.id,${filtered?'COUNT(*) OVER()':'NULL'} AS total FROM companies c ${filtered?`WHERE ${where.join(' AND ')}`:''}
      ORDER BY c.created_at DESC,c.id ${window_(filtered,f.limit,f.offset)})
    SELECT c.id,c.display_name AS displayName,c.slug,c.country,c.website,c.industry,c.identity_state AS identityState,
      c.publication_status AS publicationStatus,c.publication_block AS publicationBlock,c.created_at AS createdAt,
      s.number AS position,s.status AS positionStatus,s.assignment_kind AS assignmentKind,o.status AS onboardingStatus,
      (SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=c.id AND m.role='owner' LIMIT 1) AS ownerEmail,chosen.total
    FROM chosen JOIN companies c ON c.id=chosen.id LEFT JOIN slots s ON s.company_id=c.id LEFT JOIN onboarding_cases o ON o.company_id=c.id
    ORDER BY c.created_at DESC,c.id`)
    .bind(...binds).all<Omit<CompanyRow,'isDemo'>&{total:number|null}>();
  const {rows:companies,...list}=pageOf(rows.results,filtered,f.limit,f.offset);
  return {companies:companies.map(row=>({...row,isDemo:isDemoAddress(row.ownerEmail)})),...list};
}

export interface TimelineEvent {at:string;source:'admin'|'inventory'|'owner'|'system';action:string;actor:string|null;reasonCode:string|null;evidence:string|null;detail:string|null;}
const earliest=(a:string|null|undefined,b:string|null|undefined)=>!a?b??null:!b?a:a<b?a:b;
export async function getCompanyDossier(db:D1Database,companyId:string) {
  if (companyId.length>80) throw new AdminError('COMPANY_NOT_FOUND',404);
  const company=await db.prepare(`SELECT c.id,c.display_name AS displayName,c.slug,c.country,c.website,c.industry,c.identity_state AS identityState,
      c.publication_status AS publicationStatus,c.publication_block AS publicationBlock,c.public_summary AS publicSummary,c.authority_declared_at AS authorityDeclaredAt,
      c.created_at AS createdAt,c.approved_at AS approvedAt,c.published_at AS publishedAt,c.withdrawn_at AS withdrawnAt,
      c.correction_window_ends_at AS correctionWindowEndsAt,c.correction_override_until AS correctionOverrideUntil,c.guarantee_ends_at AS guaranteeEndsAt,
      s.number AS position,s.status AS positionStatus,s.assignment_kind AS assignmentKind,s.assigned_at AS assignedAt,s.first_published_at AS firstPublishedAt,
      o.status AS onboardingStatus,o.form_due_at AS formDueAt,o.reactivation_due_at AS reactivationDueAt
    FROM companies c LEFT JOIN slots s ON s.company_id=c.id LEFT JOIN onboarding_cases o ON o.company_id=c.id WHERE c.id=?`).bind(companyId)
    .first<{id:string;displayName:string;slug:string;country:string;website:string|null;industry:string|null;identityState:string;publicationStatus:string;
      publicationBlock:string|null;publicSummary:string|null;authorityDeclaredAt:string|null;createdAt:string;approvedAt:string|null;publishedAt:string|null;withdrawnAt:string|null;
      correctionWindowEndsAt:string|null;correctionOverrideUntil:string|null;guaranteeEndsAt:string|null;position:number|null;positionStatus:string|null;
      assignmentKind:string|null;assignedAt:string|null;firstPublishedAt:string|null;onboardingStatus:string|null;formDueAt:string|null;reactivationDueAt:string|null}>();
  if (!company) throw new AdminError('COMPANY_NOT_FOUND',404);
  const [members,versions,declarations,requests,incidents,attempts,adminEvents,slotAudit,consents]=await Promise.all([
    db.prepare(`SELECT u.id AS userId,u.email,u.status,m.role,m.created_at AS since FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=? ORDER BY m.role DESC,u.email`).bind(companyId)
      .all<{userId:string;email:string;status:string;role:string;since:string}>(),
    db.prepare(`SELECT version,created_at AS createdAt,review_status AS reviewStatus,approved_at AS approvedAt,published_at AS publishedAt,generator_json AS generator FROM profile_versions WHERE company_id=? ORDER BY version DESC LIMIT 50`).bind(companyId)
      .all<{version:number;createdAt:string|null;reviewStatus:string;approvedAt:string|null;publishedAt:string|null;generator:string|null}>(),
    db.prepare(`SELECT revision,language,submitted_at AS submittedAt FROM company_declarations WHERE company_id=? ORDER BY revision DESC LIMIT 50`).bind(companyId)
      .all<{revision:number;language:string;submittedAt:string}>(),
    db.prepare(`SELECT id,kind,status,reason,origin,legal_basis AS legalBasis,legal_due_at AS legalDueAt,requested_at AS requestedAt,resolved_at AS resolvedAt,resolution_code AS resolutionCode FROM service_requests WHERE company_id=? ORDER BY requested_at DESC LIMIT 20`).bind(companyId)
      .all<{id:string;kind:string;status:string;reason:string;origin:string;legalBasis:string|null;legalDueAt:string|null;requestedAt:string;resolvedAt:string|null;resolutionCode:string|null}>(),
    db.prepare(`SELECT id,kind,severity,status,created_at AS createdAt,resolved_at AS resolvedAt,resolution_code AS resolutionCode FROM incidents WHERE company_id=? ORDER BY created_at DESC LIMIT 20`).bind(companyId)
      .all<{id:string;kind:string;severity:string;status:string;createdAt:string;resolvedAt:string|null;resolutionCode:string|null}>(),
    db.prepare(`SELECT id,provider,status,amount_usd_cents AS amountUsdCents,charged_currency AS currency,total_minor AS totalMinor,assigned_slot_number AS position,paid_at AS paidAt FROM purchase_attempts WHERE company_id=? ORDER BY rowid DESC LIMIT 10`).bind(companyId)
      .all<{id:string;provider:string;status:string;amountUsdCents:number;currency:string;totalMinor:number;position:number|null;paidAt:string|null}>(),
    db.prepare(`SELECT e.action,e.reason_code AS reasonCode,e.evidence_reference AS evidence,e.occurred_at AS at,u.email AS actor,e.subject_id AS subject FROM admin_events e LEFT JOIN users u ON u.id=e.admin_id
      WHERE (e.subject_type='company' AND e.subject_id=?) OR (e.subject_type='profile' AND e.subject_id LIKE ? ESCAPE '\\') ORDER BY e.occurred_at DESC LIMIT 100`).bind(companyId,`${companyId.replace(/[\\%_]/g,'\\$&')}:%`)
      .all<{action:string;reasonCode:string|null;evidence:string|null;at:string;actor:string|null;subject:string}>(),
    db.prepare(`SELECT action,slot_number AS position,occurred_at AS at FROM slot_audit WHERE company_id=? ORDER BY occurred_at DESC LIMIT 100`).bind(companyId)
      .all<{action:string;position:number;at:string}>(),
    db.prepare(`SELECT kind,document_version AS document,accepted_at AS at,u.email AS actor FROM consent_records r LEFT JOIN users u ON u.id=r.user_id WHERE r.company_id=? ORDER BY r.accepted_at DESC LIMIT 50`).bind(companyId)
      .all<{kind:string;document:string;at:string;actor:string|null}>(),
  ]);
  const timeline:TimelineEvent[]=[
    ...adminEvents.results.map(e=>({at:e.at,source:'admin' as const,action:e.action,actor:e.actor,reasonCode:e.reasonCode,evidence:e.evidence,detail:e.subject===companyId?null:e.subject.slice(companyId.length+1)})),
    ...slotAudit.results.map(e=>({at:e.at,source:'inventory' as const,action:e.action,actor:null,reasonCode:null,evidence:null,detail:String(e.position)})),
    ...consents.results.map(e=>({at:e.at,source:'owner' as const,action:`consent_${e.kind}`,actor:e.actor,reasonCode:null,evidence:null,detail:e.document})),
    ...declarations.results.map(e=>({at:e.submittedAt,source:'owner' as const,action:'declaration_submitted',actor:null,reasonCode:null,evidence:null,detail:String(e.revision)})),
    ...versions.results.filter(v=>v.createdAt).map(v=>({at:v.createdAt!,source:'system' as const,action:'profile_generated',actor:null,reasonCode:null,evidence:null,detail:String(v.version)})),
  ].sort((a,b)=>a.at<b.at?1:a.at>b.at?-1:0);
  const owner=members.results.find(m=>m.role==='owner');
  const firstDeclaration=declarations.results.at(-1)?.submittedAt??null;
  const firstVersion=versions.results.at(-1)?.createdAt??null;
  const firstApproval=versions.results.reduce<string|null>((at,v)=>earliest(at,v.approvedAt),null);
  return {company,isDemo:isDemoAddress(owner?.email),members:members.results,
    versions:versions.results.map(v=>({...v,generator:parse(v.generator) as {kind?:string;provider?:string;model?:string}|null})),
    declarations:declarations.results,requests:requests.results,incidents:incidents.results,attempts:attempts.results,timeline,
    process:[
      {step:'registered',at:company.createdAt},{step:'identity',at:company.identityState==='pending_review'?null:company.createdAt,state:company.identityState},
      {step:'position',at:company.assignedAt},{step:'declaration',at:firstDeclaration},{step:'generated',at:firstVersion},
      {step:'approved',at:firstApproval},{step:'published',at:company.publishedAt},...(company.withdrawnAt?[{step:'withdrawn',at:company.withdrawnAt}]:[]),
    ] as Array<{step:string;at:string|null;state?:string}>};
}

export interface ProfileFilters {review?:string;stage?:string;q?:string;limit:number;offset:number;}
const STAGE_SQL:Record<string,string>={generated:'v.approved_at IS NULL AND v.published_at IS NULL',approved:'v.approved_at IS NOT NULL AND v.published_at IS NULL',published:'v.published_at IS NOT NULL'};
export async function listProfileVersions(db:D1Database,f:ProfileFilters) {
  page(f.limit,f.offset);
  if (f.q&&f.q.length>100) throw new AdminError('INVALID_QUERY',400);
  const stage=f.stage?STAGE_SQL[f.stage]:null;
  if (f.stage&&!stage) throw new AdminError('INVALID_QUERY',400);
  const where:string[]=[],binds:unknown[]=[];
  if (f.review) {where.push('v.review_status=?');binds.push(f.review);}
  if (f.q) {where.push(`EXISTS(SELECT 1 FROM companies c WHERE c.id=v.company_id AND LOWER(c.display_name) LIKE ? ESCAPE '\\')`);binds.push(like(f.q));}
  if (stage) where.push(stage);
  const filtered=where.length>0;
  // This ORDER BY matches idx_profile_versions_recent (migration 0011) term by term; change both together.
  const rows=await db.prepare(`WITH chosen AS (
      SELECT v.company_id,v.version,${filtered?'COUNT(*) OVER()':'NULL'} AS total FROM profile_versions v ${filtered?`WHERE ${where.join(' AND ')}`:''}
      ORDER BY COALESCE(v.created_at,v.published_at,'') DESC,v.company_id,v.version DESC ${window_(filtered,f.limit,f.offset)})
    SELECT v.company_id AS companyId,c.display_name AS companyName,c.publication_status AS publicationStatus,v.version,v.created_at AS createdAt,
      v.review_status AS reviewStatus,v.approved_at AS approvedAt,v.published_at AS publishedAt,v.generator_json AS generator,chosen.total
    FROM chosen JOIN profile_versions v ON v.company_id=chosen.company_id AND v.version=chosen.version JOIN companies c ON c.id=v.company_id
    ORDER BY COALESCE(v.created_at,v.published_at,'') DESC,v.company_id,v.version DESC`)
    .bind(...binds)
    .all<{companyId:string;companyName:string;publicationStatus:string;version:number;createdAt:string|null;reviewStatus:string;approvedAt:string|null;publishedAt:string|null;generator:string|null;total:number|null}>();
  const {rows:profiles,...list}=pageOf(rows.results,filtered,f.limit,f.offset);
  return {profiles:profiles.map(({generator,...row})=>({...row,generator:parse(generator) as {kind?:string;provider?:string;model?:string;reason?:string}|null})),...list};
}

export interface DocumentCheck {id:string;ok:boolean;detail?:string;}
const STRING_LISTS=['services','audiences','advantages','certifications','clients','serviceCountries'];
/** The structure the code writes for a canonical profile. A stored one that differs is worth seeing. */
export function validateCanonical(value:unknown):string[] {
  if (typeof value!=='object'||value===null||Array.isArray(value)) return ['not_an_object'];
  const c=value as Record<string,unknown>,problems:string[]=[];
  if (c.schemaVersion!==2) problems.push('schemaVersion');
  if (!Number.isSafeInteger(c.version)) problems.push('version');
  if (c.source_type!=='owner_declaration') problems.push('source_type');
  if (typeof c.descriptionOriginal!=='string'||!c.descriptionOriginal) problems.push('descriptionOriginal');
  for (const key of STRING_LISTS) if (!Array.isArray(c[key])||(c[key] as unknown[]).some(x=>typeof x!=='string')) problems.push(key);
  if (!Array.isArray(c.problemSolutions)||(c.problemSolutions as Array<Record<string,unknown>>).some(p=>typeof p?.problem!=='string'||typeof p?.solution!=='string')) problems.push('problemSolutions');
  if (typeof c.provenance!=='object'||c.provenance===null) problems.push('provenance');
  if (typeof c.publish!=='object'||c.publish===null) problems.push('publish');
  if (!Array.isArray(c.warnings)) problems.push('warnings');
  if (!Array.isArray(c.unsupportedClaims)) problems.push('unsupportedClaims');
  return problems;
}
export function validateJsonLd(value:unknown):string[] {
  const graph=(value as {'@graph'?:unknown}|null)?.['@graph'];
  if (!Array.isArray(graph)) return ['@graph'];
  const org=graph.find((n:{'@type'?:unknown})=>n?.['@type']==='Organization') as Record<string,unknown>|undefined;
  if (!org) return ['Organization'];
  return typeof org.name==='string'&&org.name?[]:['name'];
}
export async function getProfileDossier(db:D1Database,companyId:string,version:number) {
  if (companyId.length>80||!Number.isSafeInteger(version)||version<1) throw new AdminError('PROFILE_NOT_FOUND',404);
  const row=await db.prepare(`SELECT v.canonical_json,v.public_jsonld,v.public_jsonld_es,v.created_at,v.declaration_revision,v.generator_json,v.review_status,v.locale,
      v.approved_at,v.approved_by,v.published_at,c.display_name,c.slug,c.country,c.industry,c.website,c.identity_state,c.publication_status,c.publication_block,c.public_summary,s.number AS position,s.status AS position_status
    FROM profile_versions v JOIN companies c ON c.id=v.company_id LEFT JOIN slots s ON s.company_id=c.id WHERE v.company_id=? AND v.version=?`).bind(companyId,version)
    .first<{canonical_json:string;public_jsonld:string|null;public_jsonld_es:string|null;created_at:string|null;declaration_revision:number|null;generator_json:string|null;review_status:string;locale:string;
      approved_at:string|null;approved_by:string|null;published_at:string|null;display_name:string;slug:string;country:string;industry:string|null;website:string|null;identity_state:string;publication_status:string;publication_block:string|null;public_summary:string|null;position:number|null;position_status:string|null}>();
  if (!row) throw new AdminError('PROFILE_NOT_FOUND',404);
  const [declaration,fallback,approval,snapshot,versions,reviews]=await Promise.all([
    row.declaration_revision?db.prepare(`SELECT d.revision,d.payload_json,d.payload_digest,d.language,d.form_version,d.submitted_at,u.email FROM company_declarations d LEFT JOIN users u ON u.id=d.submitted_by WHERE d.company_id=? AND d.revision=?`).bind(companyId,row.declaration_revision)
      .first<{revision:number;payload_json:string;payload_digest:string;language:string;form_version:string;submitted_at:string;email:string|null}>():null,
    db.prepare(`SELECT d.declaration_json,d.submitted_at,u.email FROM owner_profile_declarations d LEFT JOIN users u ON u.id=d.submitted_by WHERE d.company_id=? AND d.version=?`).bind(companyId,version)
      .first<{declaration_json:string;submitted_at:string;email:string|null}>(),
    db.prepare(`SELECT a.content_digest,a.approved_at,u.email FROM profile_approvals a LEFT JOIN users u ON u.id=a.user_id WHERE a.company_id=? AND a.version=?`).bind(companyId,version)
      .first<{content_digest:string;approved_at:string;email:string|null}>(),
    db.prepare(`SELECT jsonld_digest,published_at FROM published_profile_snapshots WHERE company_id=? AND version=?`).bind(companyId,version)
      .first<{jsonld_digest:string;published_at:string}>(),
    db.prepare(`SELECT version,approved_at AS approvedAt,published_at AS publishedAt FROM profile_versions WHERE company_id=? ORDER BY version DESC LIMIT 50`).bind(companyId)
      .all<{version:number;approvedAt:string|null;publishedAt:string|null}>(),
    db.prepare(`SELECT e.action,e.reason_code AS reasonCode,e.evidence_reference AS evidence,e.occurred_at AS at,e.details_json AS details,u.email AS actor FROM admin_events e LEFT JOIN users u ON u.id=e.admin_id
      WHERE e.subject_type='profile' AND e.subject_id=? ORDER BY e.occurred_at DESC LIMIT 20`).bind(`${companyId}:${version}`)
      .all<{action:string;reasonCode:string|null;evidence:string|null;at:string;details:string;actor:string|null}>(),
  ]);
  const canonical=parse(row.canonical_json) as {unsupportedClaims?:Array<{text:string;reason:string}>;warnings?:string[];provenance?:Record<string,unknown>}|null;
  const jsonld=parse(row.public_jsonld),jsonldEs=parse(row.public_jsonld_es);
  const contentDigest=await sha256(contentDigestSource(row));
  const publishedDigest=row.public_jsonld?await sha256(row.public_jsonld):null;
  const latestPublished=versions.results.find(v=>v.publishedAt)?.version??null;
  const isPublic=latestPublished===version&&row.publication_status==='published'&&row.position_status==='assigned';
  const canonicalProblems=validateCanonical(canonical),enProblems=validateJsonLd(jsonld),esProblems=validateJsonLd(jsonldEs);
  const checks:DocumentCheck[]=[
    {id:'canonical_structure',ok:!canonicalProblems.length,detail:canonicalProblems.join(', ')||undefined},
    {id:'jsonld_en_structure',ok:!enProblems.length,detail:enProblems.join(', ')||undefined},
    {id:'jsonld_es_structure',ok:!esProblems.length,detail:esProblems.join(', ')||undefined},
  ];
  // These two say whether what is stored is what the owner saw and what went public.
  if (row.approved_at) checks.push({id:'approval_matches_content',ok:approval?.content_digest===contentDigest});
  if (row.published_at) {
    checks.push({id:'published_after_approval',ok:!!row.approved_at&&!!approval});
    checks.push({id:'snapshot_matches_jsonld',ok:snapshot?.jsonld_digest===publishedDigest});
  }
  const declarationRaw=declaration?.payload_json??fallback?.declaration_json??null;
  return {companyId,version,company:{displayName:row.display_name,slug:row.slug,country:row.country,industry:row.industry,website:row.website,identityState:row.identity_state,
      publicationStatus:row.publication_status,publicationBlock:row.publication_block,publicSummary:row.public_summary,position:row.position},
    stage:row.published_at?'published':row.approved_at?'approved':'generated',isPublic,latestPublished,
    createdAt:row.created_at,reviewStatus:row.review_status,
    generator:parse(row.generator_json) as {kind?:string;provider?:string;model?:string;promptVersion?:string;reason?:string;violations?:unknown[]}|null,
    declaration:{revision:declaration?.revision??row.declaration_revision,language:declaration?.language??null,formVersion:declaration?.form_version??null,
      submittedAt:declaration?.submitted_at??fallback?.submitted_at??null,submittedBy:declaration?.email??fallback?.email??null,payloadDigest:declaration?.payload_digest??null},
    documents:{declaration:parse(declarationRaw),canonical,jsonld,jsonldEs},
    approval:approval?{by:approval.email,at:approval.approved_at,contentDigest:approval.content_digest}:null,
    publication:snapshot?{at:snapshot.published_at,jsonldDigest:snapshot.jsonld_digest}:null,
    contentDigest,checks,
    warnings:canonical?.warnings??[],unsupportedClaims:canonical?.unsupportedClaims??[],provenance:canonical?.provenance??{},
    versions:versions.results,reviews:reviews.results.map(r=>({...r,details:parse(r.details)}))};
}

export interface AuditFilters {action?:string;subject?:string;actor?:string;limit:number;offset:number;}
export async function listAuditEvents(db:D1Database,f:AuditFilters) {
  page(f.limit,f.offset);
  for (const text of [f.action,f.subject,f.actor]) if (text&&text.length>100) throw new AdminError('INVALID_QUERY',400);
  const where:string[]=[],binds:unknown[]=[];
  if (f.action) {where.push('e.action=?');binds.push(f.action);}
  if (f.subject) {where.push(`LOWER(e.subject_id) LIKE ? ESCAPE '\\'`);binds.push(like(f.subject));}
  if (f.actor) {where.push(`LOWER(u.email) LIKE ? ESCAPE '\\'`);binds.push(like(f.actor));}
  const filtered=where.length>0;
  const [rows,actions]=await Promise.all([
    db.prepare(`SELECT e.id,e.action,e.subject_type AS subjectType,e.subject_id AS subjectId,e.reason_code AS reasonCode,e.evidence_reference AS evidence,e.details_json AS details,e.occurred_at AS occurredAt,
        u.email AS actor,c.display_name AS companyName,${filtered?'COUNT(*) OVER()':'NULL'} AS total
      FROM admin_events e LEFT JOIN users u ON u.id=e.admin_id LEFT JOIN companies c ON e.subject_type='company' AND c.id=e.subject_id
      ${filtered?`WHERE ${where.join(' AND ')}`:''}
      ORDER BY e.occurred_at DESC,e.id ${window_(filtered,f.limit,f.offset)}`)
      .bind(...binds)
      .all<{id:string;action:string;subjectType:string;subjectId:string;reasonCode:string|null;evidence:string|null;details:string;occurredAt:string;actor:string|null;companyName:string|null;total:number|null}>(),
    db.prepare(`SELECT DISTINCT action FROM admin_events ORDER BY action`).all<{action:string}>(),
  ]);
  const {rows:events,...list}=pageOf(rows.results,filtered,f.limit,f.offset);
  return {events:events.map(({details,...row})=>({...row,details:parse(details)})),actions:actions.results.map(a=>a.action),...list};
}
