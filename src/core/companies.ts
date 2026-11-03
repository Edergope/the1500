import { IdentityError, type Principal } from './identity';
export interface RegistrationInput {
  displayName:string; country:string; website:string; industry:string;
  declareAuthority:true;
}
export function parseRegistration(input:Record<string,unknown>): RegistrationInput {
  const displayName=typeof input.displayName==='string'?input.displayName.trim():'';
  const country=typeof input.country==='string'?input.country.trim().toUpperCase():'';
  const industry=typeof input.industry==='string'?input.industry.trim():'';
  const rawWebsite=typeof input.website==='string'?input.website.trim():'';
  if (displayName.length<2||displayName.length>120||! /^[A-Z]{2}$/.test(country)||
    !industry || industry.length>100 || input.declareAuthority!==true)
    throw new IdentityError('INVALID_REGISTRATION');
  let website:string;
  try {
    const parsed=new URL(rawWebsite);
    if (!['https:','http:'].includes(parsed.protocol) || parsed.username||parsed.password ||
      rawWebsite.length>320 || !parsed.hostname.includes('.')) throw new Error('bad');
    website=parsed.hostname.toLowerCase().replace(/^www\./,'');
  } catch { throw new IdentityError('INVALID_WEBSITE'); }
  return {displayName,country,industry,website,declareAuthority:true};
}
export async function registerCompany(db:D1Database,user:Principal,input:RegistrationInput,now=new Date()) {
  const emailDomain=user.email.split('@')[1]?.toLowerCase();
  const verifiedByEmail=!!emailDomain && (emailDomain===input.website ||
    emailDomain.endsWith(`.${input.website}`));
  const state=verifiedByEmail?'self_declared':'pending_review';
  const ownedCount=await db.prepare(`SELECT COUNT(*) AS total FROM memberships
    WHERE user_id=? AND role='owner'`).bind(user.id).first<{total:number}>();
  if ((ownedCount?.total??0)>=3) throw new IdentityError('REGISTRATION_LIMIT',429);
  const key=input.displayName.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'company';
  const id=crypto.randomUUID(), slug=`${key}-${id.slice(0,8)}`;
  try {
    await db.batch([
      db.prepare(`INSERT INTO companies(id,display_name,slug,country,industry,website,
        publication_status,identity_state,authority_declared_at)
        VALUES(?,?,?,?,?,?,'draft',?,?)`).bind(id,input.displayName,slug,input.country,input.industry,
          input.website,state,now.toISOString()),
      db.prepare(`INSERT INTO memberships(user_id,company_id,role)
        VALUES(?,?,'owner')`).bind(user.id,id),
      db.prepare(`INSERT INTO auth_audit(id,user_id,kind,occurred_at,details_code)
        VALUES(?,?,'registration',?,?)`)
        .bind(crypto.randomUUID(),user.id,now.toISOString(),state)
    ]);
  } catch (error) {
    if (/UNIQUE constraint failed|constraint failed|SQLITE_CONSTRAINT/i.test(String(error)))
      throw new IdentityError('COMPANY_CONFLICT',409);
    throw error;
  }
  return {id,slug,displayName:input.displayName,identityState:state,
    checkoutEligible:state==='self_declared',publicationStatus:'draft'};
}
