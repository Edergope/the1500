import {IdentityError} from './identity';

/** Only owner-approved published profiles are indexed. No crawling of private drafts. */
export interface SearchResult {
  companyId:string;slug:string;name:string;industry:string|null;
  country:string;summary:string;version:number;url:string;
}
export interface SearchResponse {items:SearchResult[];query:string;count:number;source:'published_profiles';}
const stopwords=new Set(['the','and','for','with','that','this','from','into','about','are','can',
  'need','looking','find','company','companies','business','businesses','please','what','who',
  'una','uno','las','los','por','para','que','con','del','quiero','empresa','empresas','necesito']);

export function asFtsQuery(input:string) {
  if (input.length>220) throw new IdentityError('QUERY_TOO_LONG',400);
  const words=(input.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[])
    .filter(word=>!stopwords.has(word)).slice(0,8);
  if (!words.length) throw new IdentityError('QUERY_REQUIRED',400);
  // Quote every token. An input cannot inject FTS5 operators or SQL syntax.
  return [...new Set(words)].map(word=>`"${word}"`).join(' OR ');
}

interface SearchRow {
  companyId:string;slug:string;name:string;industry:string|null;
  country:string;summary:string;version:number;
}
export async function searchPublishedProfiles(db:D1Database,text:string,limit=6):Promise<SearchResponse> {
  if (!Number.isSafeInteger(limit)||limit<1||limit>12) throw new IdentityError('INVALID_LIMIT');
  const fts=asFtsQuery(text.trim());
  const found=await db.prepare(`SELECT c.id AS companyId,c.slug,c.display_name AS name,
    c.industry,c.country,c.public_summary AS summary,
    (SELECT MAX(v.version) FROM profile_versions v JOIN published_profile_snapshots p
      ON p.company_id=v.company_id AND p.version=v.version
      WHERE v.company_id=c.id AND v.published_at IS NOT NULL AND v.approved_at IS NOT NULL) AS version
    FROM published_company_fts f
    JOIN companies c ON c.id=f.company_id
    WHERE published_company_fts MATCH ? AND c.publication_status='published'
      AND EXISTS(SELECT 1 FROM profile_versions v JOIN published_profile_snapshots p
        ON p.company_id=v.company_id AND p.version=v.version
        WHERE v.company_id=c.id AND v.published_at IS NOT NULL AND v.approved_at IS NOT NULL)
    ORDER BY bm25(published_company_fts),c.slug LIMIT ?`).bind(fts,limit).all<SearchRow>();
  return {query:text,source:'published_profiles',count:found.results.length,
    items:found.results.map(r=>({...r,url:`/empresas/${r.slug}`}))};
}

/** Honest fallback while the LLM provider isn't enabled: grounded retrieval, not invented generation. */
export async function answerFromPublishedProfiles(db:D1Database,question:string,language:'en'|'es'='en') {
  const result=await searchPublishedProfiles(db,question,5);
  if (!result.items.length) return {mode:'retrieval_only',language,
    answer:language==='es'?'No encontré perfiles publicados que respondan a esa consulta.':
      'I could not find published company profiles relevant to that question.',
    citations:[],limitations:'Only owner-approved profiles published in THE1500 are searched.'};
  const nameList=result.items.map(x=>x.name).join(', ');
  return {mode:'retrieval_only',language,
    answer:language==='es'?`Perfiles publicados que podrían ser relevantes: ${nameList}. Consulta las fichas citadas para verificar sus declaraciones.`:
      `Published company profiles that may be relevant: ${nameList}. Check the linked profiles for their owner-declared capabilities.`,
    citations:result.items.map(x=>({companyId:x.companyId,slug:x.slug,title:x.name,
      url:language==='es'?`/es/empresas/${x.slug}`:x.url,profileVersion:x.version})),
    limitations:'This is keyword retrieval of published, owner-approved data; it does not certify companies or guarantee external AI recommendations.'};
}
