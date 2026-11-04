import { IdentityError, requireOwner, type Principal } from './identity';
export interface RegistrationInput {
  displayName:string; country:string; website:string; industry:string;
  declareAuthority:true;
}
/** Mailbox providers: a verified address there says nothing about owning the website. Decision 13. */
const FREE_MAIL=new Set(['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','yahoo.com','ymail.com',
  'icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','pm.me','gmx.com','gmx.net','mail.com','zoho.com','yandex.com','fastmail.com','hey.com']);
/** Second-level registry suffixes frequent in priority markets: nobody "owns" co.uk through x@foo.co.uk. */
const SHARED_SUFFIX=/^(co|com|org|net|edu|gov|gob|ac|or|ne|mil|nom|web)\.[a-z]{2}$/;
export function emailProvesWebsite(emailDomain:string|undefined,website:string):boolean {
  if (!emailDomain||FREE_MAIL.has(emailDomain)||FREE_MAIL.has(website)) return false;
  if (website.split('.').length<2||SHARED_SUFFIX.test(website)) return false;
  return emailDomain===website||emailDomain.endsWith(`.${website}`);
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
  const verifiedByEmail=emailProvesWebsite(user.email.split('@')[1]?.toLowerCase(),input.website);
  const state=verifiedByEmail?'self_declared':'pending_review';
  const ownedCount=await db.prepare(`SELECT COUNT(*) AS total FROM memberships
    WHERE user_id=? AND role='owner'`).bind(user.id).first<{total:number}>();
  if ((ownedCount?.total??0)>=3) throw new IdentityError('REGISTRATION_LIMIT',429);
  // Unverified duplicates by someone else go to the review queue flagged; an impostor must not
  // be able to block the legitimate owner, and the unique index protects verified companies.
  const mine=await db.prepare(`SELECT 1 AS ok FROM companies c JOIN memberships m ON m.company_id=c.id
    WHERE m.user_id=? AND c.website=? AND c.identity_state<>'rejected'`).bind(user.id,input.website).first<{ok:number}>();
  if (mine) throw new IdentityError('COMPANY_CONFLICT',409);
  const key=input.displayName.normalize('NFKD').replace(/[̀-ͯ]/g,'')
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
export async function setCompanyMember(db:D1Database,ownerId:string,companyId:string,email:string,action:'add'|'remove',now=new Date()) {
  await requireOwner(db,ownerId,companyId);
  const target=await db.prepare(`SELECT id FROM users WHERE email=?`).bind(email).first<{id:string}>();
  if (!target) throw new IdentityError('MEMBER_NOT_REGISTERED',404);
  if (action==='add') {
    await db.prepare(`INSERT OR IGNORE INTO memberships(user_id,company_id,role,created_at) VALUES(?,?,'editor',?)`)
      .bind(target.id,companyId,now.toISOString()).run();
  } else {
    await db.prepare(`DELETE FROM memberships WHERE user_id=? AND company_id=? AND role='editor'`).bind(target.id,companyId).run();
  }
  return {companyId,email,role:action==='add'?'editor':null};
}
/** Everything the owner's account page needs about one company, without administrative internals. */
export async function getOwnerCompanyStatus(db:D1Database,companyId:string) {
  const [company,slot,onboarding,hold,versions,invitation,requests,premium]=await Promise.all([
    db.prepare(`SELECT id,display_name AS displayName,slug,country,industry,website,identity_state AS identityState,
      publication_status AS publicationStatus,publication_block AS publicationBlock,published_at AS firstPublishedAt,
      correction_window_ends_at AS correctionWindowEndsAt,guarantee_ends_at AS guaranteeEndsAt FROM companies WHERE id=?`).bind(companyId).first(),
    db.prepare(`SELECT number AS position,status,phase,first_published_at AS firstPublishedAt FROM slots WHERE company_id=? AND status IN('assigned','retired')`).bind(companyId).first(),
    db.prepare(`SELECT status,started_at AS startedAt,form_due_at AS formDueAt,extension_due_at AS extensionDueAt,
      reactivation_due_at AS reactivationDueAt,submitted_at AS submittedAt,reactivation_requested_at AS reactivationRequestedAt,reactivation_approved_at AS reactivationApprovedAt,reactivation_notified_at AS reactivationNotifiedAt,reactivation_form_due_at AS reactivationFormDueAt,final_notice_sent_at AS finalNoticeSentAt,final_notice_due_at AS finalNoticeDueAt,final_notice_response_at AS finalNoticeResponseAt FROM onboarding_cases WHERE company_id=?`).bind(companyId).first(),
    db.prepare(`SELECT id AS holdId,expires_at AS expiresAt FROM slot_holds WHERE company_id=? AND status='active'`).bind(companyId).first(),
    db.prepare(`SELECT version,approved_at AS approvedAt,published_at AS publishedAt,review_status AS reviewStatus FROM profile_versions WHERE company_id=? ORDER BY version DESC LIMIT 20`).bind(companyId).all(),
    db.prepare(`SELECT id AS invitationId,expires_at AS expiresAt FROM founder_invitations WHERE company_id=? AND status='pending'`).bind(companyId).first(),
    db.prepare(`SELECT id,kind,status,legal_basis AS legalBasis,requested_at AS requestedAt,resolved_at AS resolvedAt FROM service_requests WHERE company_id=? AND origin='owner' ORDER BY requested_at DESC LIMIT 10`).bind(companyId).all(),
    db.prepare(`SELECT id,status,contact_preference AS contactPreference,created_at AS createdAt,updated_at AS updatedAt FROM premium_requests WHERE company_id=? ORDER BY created_at DESC LIMIT 1`).bind(companyId).first(),
  ]);
  if (!company) throw new IdentityError('COMPANY_NOT_FOUND',404);
  return {company,position:slot??null,onboarding:onboarding??null,activeHold:hold??null,profileVersions:versions.results,founderInvitation:invitation??null,requests:requests.results,premiumRequest:premium??null};
}
