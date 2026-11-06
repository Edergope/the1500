import {AdminError} from './admin';
import {latePaymentFacts} from './payments';
import {readCatalog,readCommerce} from './read-model';

/**
 * ADMIN-OPS: reads behind the operations screens (inventory, founders, requests, payments, incidents).
 * Nothing here writes. Every action keeps its own route in admin.ts, cases.ts or payments.ts, with its rules,
 * reason, evidence and audit event; these screens only call them.
 * Lists follow admin-console.ts: only the filters in use reach the SQL, the page is written as numbers, and an
 * unfiltered list stops at the page instead of counting every row.
 */
const page=(limit:number,offset:number,max=100)=>{
  if (!Number.isSafeInteger(limit)||limit<1||limit>max||!Number.isSafeInteger(offset)||offset<0||offset>100_000) throw new AdminError('INVALID_LIMIT',400);
};
const like=(text?:string)=>text?`%${text.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`:null;
const parse=(text:string|null|undefined):unknown=>{if (!text) return null;try {return JSON.parse(text);} catch {return null;}};
/** One extra row says whether a next page exists. No total is counted: that would read every matching row. */
function window_<T>(rows:T[],limit:number,offset:number) {return {rows:rows.slice(0,limit),hasMore:rows.length>limit,limit,offset};}
const oneOf=<T extends string>(value:string|undefined,allowed:readonly T[]):T|undefined=>{
  if (value===undefined||value==='') return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new AdminError('INVALID_QUERY',400);
  return value as T;
};

// ---------- Inventory ----------
export const POSITION_STATES=['available','held','assigned','published','retired'] as const;
export const ASSIGNMENT_KINDS=['founder','paid','premium'] as const;
export interface InventoryFilters {state?:string;kind?:string;phase?:number;from?:number;to?:number;company?:string;limit:number;offset:number;}
/**
 * The 1,500 positions. The board comes from the PERF-001 read models (a few rows while nothing changes) plus the
 * live reservations, which are read every time: a reservation is never shown from a cache.
 */
export async function getInventoryBoard(db:D1Database,f:InventoryFilters) {
  page(f.limit,f.offset,200);
  const state=oneOf(f.state,POSITION_STATES),kind=oneOf(f.kind,ASSIGNMENT_KINDS);
  for (const n of [f.phase,f.from,f.to]) if (n!==undefined&&(!Number.isSafeInteger(n)||n<1||n>1500)) throw new AdminError('INVALID_QUERY',400);
  if (f.phase!==undefined&&f.phase>4) throw new AdminError('INVALID_QUERY',400);
  if (f.company&&f.company.length>100) throw new AdminError('INVALID_QUERY',400);
  const where:string[]=[],binds:unknown[]=[];
  if (state==='available') where.push(`s.status='available'`);
  if (state==='held') where.push(`s.status='held'`);
  if (state==='retired') where.push(`s.status='retired'`);
  if (state==='assigned') where.push(`s.status='assigned' AND COALESCE(c.publication_status,'')<>'published'`);
  if (state==='published') where.push(`s.status='assigned' AND c.publication_status='published'`);
  if (kind) {where.push('s.assignment_kind=?');binds.push(kind);}
  if (f.phase) {where.push('s.phase=?');binds.push(f.phase);}
  if (f.from) {where.push('s.number>=?');binds.push(f.from);}
  if (f.to) {where.push('s.number<=?');binds.push(f.to);}
  // Tiers are contiguous ranges of numbers, so (phase, number) is the same order as number. With a state filter that
  // order walks idx_slots_status_phase and stops at the page; ordering by number alone would sort every match.
  const byState=!!state;
  const company=like(f.company);
  if (company) {where.push(`LOWER(c.display_name) LIKE ? ESCAPE '\\'`);binds.push(company);}
  const [commerce,catalog,holds,rows]=await Promise.all([
    readCommerce(db),readCatalog(db),
    db.prepare(`SELECT h.slot_number AS position,h.company_id AS companyId,c.display_name AS companyName,h.expires_at AS expiresAt
      FROM slot_holds h JOIN companies c ON c.id=h.company_id WHERE h.status='active' ORDER BY h.slot_number`).all<{position:number;companyId:string;companyName:string;expiresAt:string}>(),
    db.prepare(`SELECT s.number AS position,s.phase,s.status,s.assignment_kind AS assignmentKind,s.price_usd_cents AS priceUsdCents,s.assigned_at AS assignedAt,
        s.first_published_at AS firstPublishedAt,s.held_until AS heldUntil,c.id AS companyId,c.display_name AS companyName,c.publication_status AS publicationStatus
      FROM slots s LEFT JOIN companies c ON c.id=s.company_id ${where.length?`WHERE ${where.join(' AND ')}`:''}
      ${byState?'ORDER BY s.phase,s.number':'ORDER BY s.number'} LIMIT ${f.limit+1} OFFSET ${f.offset}`).bind(...binds)
      .all<{position:number;phase:number;status:string;assignmentKind:string|null;priceUsdCents:number;assignedAt:string|null;firstPublishedAt:string|null;heldUntil:string|null;companyId:string|null;companyName:string|null;publicationStatus:string|null}>(),
  ]);
  // One character per position: p published, o assigned, x retired, h reserved now, a open.
  const map=catalog.positionMap.split('');
  for (const h of holds.results) if (map[h.position-1]==='a') map[h.position-1]='h';
  const published=map.filter(c=>c==='p').length;
  return {
    summary:{capacity:1500,available:commerce.available,held:commerce.held,assigned:commerce.occupied-commerce.retired-published,published,retired:commerce.retired,
      currentPhase:commerce.currentPhase,currentPriceUsdCents:commerce.currentPriceUsdCents,salesMode:commerce.salesMode,phases:commerce.phases},
    map:map.join(''),holds:holds.results,
    positions:window_(rows.results.map(r=>({...r,state:r.status==='assigned'&&r.publicationStatus==='published'?'published':r.status})),f.limit,f.offset),
    filtered:where.length>0,
  };
}
/** One position: its facts and every movement, oldest first. Nothing here can change it. */
export async function getPositionDossier(db:D1Database,position:number) {
  if (!Number.isSafeInteger(position)||position<1||position>1500) throw new AdminError('INVALID_QUERY',400);
  const [slot,history,awards,attempts]=await db.batch([
    db.prepare(`SELECT s.number AS position,s.phase,s.status,s.assignment_kind AS assignmentKind,s.price_usd_cents AS priceUsdCents,s.assigned_at AS assignedAt,
        s.first_published_at AS firstPublishedAt,s.held_until AS heldUntil,s.active_hold_id AS activeHoldId,c.id AS companyId,c.display_name AS companyName,
        c.publication_status AS publicationStatus,c.slug FROM slots s LEFT JOIN companies c ON c.id=s.company_id WHERE s.number=?`).bind(position),
    db.prepare(`SELECT a.occurred_at AS at,a.action,a.company_id AS companyId,c.display_name AS companyName,a.reference_id AS reference,a.metadata_json AS metadata
      FROM slot_audit a LEFT JOIN companies c ON c.id=a.company_id WHERE a.slot_number=? ORDER BY a.occurred_at,a.event_id`).bind(position),
    db.prepare(`SELECT f.id,f.company_id AS companyId,c.display_name AS companyName,f.status,f.awarded_at AS awardedAt,f.revoked_at AS revokedAt,u.email AS approvedBy
      FROM founder_awards f JOIN companies c ON c.id=f.company_id LEFT JOIN users u ON u.id=f.approved_by WHERE f.slot_number=? ORDER BY f.awarded_at`).bind(position),
    db.prepare(`SELECT id,company_id AS companyId,status,provider,amount_usd_cents AS amountUsdCents,created_at AS createdAt FROM purchase_attempts
      WHERE assigned_slot_number=? OR provisional_slot_number=? ORDER BY created_at DESC LIMIT 20`).bind(position,position),
  ]);
  const s=slot!.results[0] as Record<string,unknown>|undefined;
  if (!s) throw new AdminError('POSITION_NOT_FOUND',404);
  return {
    position:{...s,locked:!!s.firstPublishedAt},
    history:(history!.results as Record<string,unknown>[]).map(h=>({...h,metadata:parse(h.metadata as string)})),
    founderAwards:awards!.results,attempts:attempts!.results,
  };
}

// ---------- Founders ----------
export const INVITATION_STATES=['pending','accepted','expired','revoked'] as const;
export async function getFounderBoard(db:D1Database,f:{status?:string;limit:number;offset:number}) {
  page(f.limit,f.offset);
  const status=oneOf(f.status,INVITATION_STATES);
  const [slots,invitations,awards,counts]=await db.batch([
    // Positions 1-100 only: a primary-key range, 100 rows at most.
    // NOT INDEXED keeps it a primary-key range of 100 rows; the planner would otherwise walk the whole status index.
    db.prepare(`SELECT status,COUNT(*) AS n FROM slots NOT INDEXED WHERE number BETWEEN 1 AND 100 GROUP BY status`),
    db.prepare(`SELECT i.id,i.company_id AS companyId,c.display_name AS companyName,i.status,i.created_at AS createdAt,i.expires_at AS expiresAt,i.accepted_at AS acceptedAt,
        inv.email AS invitedBy,acc.email AS acceptedBy,
        (SELECT a.slot_number FROM founder_awards a WHERE a.company_id=i.company_id AND a.status='active') AS awardedPosition
      FROM founder_invitations i JOIN companies c ON c.id=i.company_id LEFT JOIN users inv ON inv.id=i.invited_by LEFT JOIN users acc ON acc.id=i.accepted_by
      ${status?'WHERE i.status=?':''} ORDER BY i.created_at DESC LIMIT ${f.limit+1} OFFSET ${f.offset}`).bind(...(status?[status]:[])),
    db.prepare(`SELECT a.id,a.slot_number AS position,a.company_id AS companyId,c.display_name AS companyName,a.status,a.awarded_at AS awardedAt,a.revoked_at AS revokedAt,u.email AS approvedBy
      FROM founder_awards a JOIN companies c ON c.id=a.company_id LEFT JOIN users u ON u.id=a.approved_by ORDER BY a.awarded_at DESC LIMIT 100`),
    db.prepare(`SELECT status,COUNT(*) AS n FROM founder_invitations GROUP BY status`),
  ]);
  const by=(rows:{status:string;n:number}[])=>Object.fromEntries(rows.map(r=>[r.status,r.n]));
  return {
    positions:{total:100,...by(slots!.results as {status:string;n:number}[])},
    invitationCounts:by(counts!.results as {status:string;n:number}[]),
    invitations:window_(invitations!.results as Record<string,unknown>[],f.limit,f.offset),
    awards:awards!.results,
  };
}

// ---------- Requests ----------
/**
 * Every decision waiting for a person, by queue, most urgent first. Each queue is short by nature (what is open now),
 * and each reads through the index of its own state.
 */
export async function getRequestCenter(db:D1Database,now=new Date()) {
  const at=now.toISOString();
  const [identity,profiles,premium,service,reactivation,review,corrections]=await db.batch([
    db.prepare(`SELECT c.id AS companyId,c.display_name AS companyName,c.website,c.country,c.created_at AS createdAt FROM companies c
      WHERE c.identity_state='pending_review' ORDER BY c.created_at LIMIT 50`),
    db.prepare(`SELECT v.company_id AS companyId,c.display_name AS companyName,v.version,v.created_at AS createdAt,v.approved_at AS approvedAt FROM profile_versions v
      JOIN companies c ON c.id=v.company_id WHERE v.review_status='pending' ORDER BY v.created_at LIMIT 50`),
    db.prepare(`SELECT p.id,p.company_id AS companyId,c.display_name AS companyName,p.status,p.channel_note AS note,p.created_at AS createdAt,p.updated_at AS updatedAt FROM premium_requests p
      JOIN companies c ON c.id=p.company_id WHERE p.status IN('received','in_review','accepted') ORDER BY p.created_at LIMIT 50`),
    db.prepare(`SELECT r.id,r.company_id AS companyId,c.display_name AS companyName,r.kind,r.reason,r.legal_basis AS legalBasis,r.legal_due_at AS legalDueAt,r.origin,
        r.channel_note AS channelNote,r.requested_at AS requestedAt FROM service_requests r JOIN companies c ON c.id=r.company_id WHERE r.status='requested'
      ORDER BY r.legal_due_at IS NULL,r.legal_due_at,r.legal_basis IS NULL,r.requested_at LIMIT 50`),
    db.prepare(`SELECT o.company_id AS companyId,c.display_name AS companyName,o.status,o.reactivation_requested_at AS requestedAt,o.reactivation_due_at AS dueAt FROM onboarding_cases o
      JOIN companies c ON c.id=o.company_id WHERE o.status='reactivation_requested' ORDER BY o.reactivation_requested_at LIMIT 50`),
    db.prepare(`SELECT o.company_id AS companyId,c.display_name AS companyName,o.admin_review_at AS since,o.final_notice_requested_at AS noticeRequestedAt,o.final_notice_sent_at AS noticeSentAt,
        o.final_notice_due_at AS noticeDueAt,o.final_notice_response_at AS responseAt,o.final_notice_response AS response,o.resolution_due_at AS resolutionDueAt FROM onboarding_cases o
      JOIN companies c ON c.id=o.company_id WHERE o.status='admin_review' AND o.resolved_at IS NULL ORDER BY o.resolution_due_at IS NULL,o.resolution_due_at,o.admin_review_at LIMIT 50`),
    db.prepare(`SELECT c.id AS companyId,c.display_name AS companyName,c.correction_override_until AS until FROM companies c WHERE c.correction_override_until>? ORDER BY c.correction_override_until LIMIT 50`).bind(at),
  ]);
  return {
    identity:identity!.results,profiles:profiles!.results,premium:premium!.results,
    service:(service!.results as Record<string,unknown>[]).map(r=>({...r,overdue:typeof r.legalDueAt==='string'&&r.legalDueAt<=at})),
    reactivation:reactivation!.results,
    review:(review!.results as Record<string,unknown>[]).map(r=>({...r,overdue:typeof r.resolutionDueAt==='string'&&r.resolutionDueAt<=at})),
    corrections:corrections!.results,
  };
}

// ---------- Payments ----------
export const PAYMENT_STATES=['creating','pending','paid','failed','expired','late_review','amount_review','refund_pending','refunded','disputed','chargeback_lost'] as const;
export const ACTIONABLE_PAYMENTS=['pending','late_review','amount_review','refund_pending','disputed','chargeback_lost'] as const;
export async function listPaymentsPage(db:D1Database,f:{status?:string;provider?:string;limit:number;offset:number}) {
  page(f.limit,f.offset);
  const status=oneOf(f.status,PAYMENT_STATES),provider=oneOf(f.provider,['stripe','bank','manual'] as const);
  const where:string[]=[],binds:unknown[]=[];
  if (status) {where.push('a.status=?');binds.push(status);}
  if (provider) {where.push('a.provider=?');binds.push(provider);}
  const rows=await db.prepare(`SELECT a.id,a.company_id AS companyId,c.display_name AS companyName,a.provider,a.status,a.phase,a.assigned_slot_number AS position,
      a.amount_usd_cents AS amountUsdCents,a.total_minor AS totalMinor,a.charged_currency AS currency,a.paid_at AS paidAt,a.payer_review AS payerReview,
      a.refund_requested_at AS refundRequestedAt,a.refund_confirmed_at AS refundConfirmedAt,a.created_at AS createdAt,
      (SELECT COUNT(*) FROM incidents i WHERE i.attempt_id=a.id AND i.status='open') AS openIncidents
    FROM purchase_attempts a JOIN companies c ON c.id=a.company_id ${where.length?`WHERE ${where.join(' AND ')}`:''}
    ORDER BY a.created_at DESC LIMIT ${f.limit+1} OFFSET ${f.offset}`).bind(...binds).all();
  // Only the states that wait for someone are counted: each is a seek on idx_purchase_status, so the cost follows the
  // open work, not the whole payment history.
  const counts=await db.prepare(`SELECT status,COUNT(*) AS n FROM purchase_attempts WHERE status IN(${ACTIONABLE_PAYMENTS.map(()=>'?').join(',')}) GROUP BY status`)
    .bind(...ACTIONABLE_PAYMENTS).all<{status:string;n:number}>();
  return {...window_(rows.results as Record<string,unknown>[],f.limit,f.offset),counts:Object.fromEntries(counts.results.map(r=>[r.status,r.n]))};
}
export async function getPaymentDossier(db:D1Database,attemptId:string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(attemptId)) throw new AdminError('ATTEMPT_NOT_FOUND',404);
  const [attempt,incidents,events,webhooks]=await db.batch([
    db.prepare(`SELECT a.id,a.company_id AS companyId,c.display_name AS companyName,a.user_id AS userId,u.email AS buyerEmail,a.provider,a.status,a.phase,
        (SELECT h.slot_number FROM slot_holds h WHERE h.id=a.hold_id) AS heldPosition,a.provisional_slot_number AS provisionalPosition,a.assigned_slot_number AS position,a.amount_usd_cents AS amountUsdCents,a.total_minor AS totalMinor,
        a.charged_currency AS currency,a.tax_status AS taxStatus,a.provider_session_id AS providerSessionId,a.provider_payment_intent AS providerPaymentIntent,a.hold_expires_at AS holdExpiresAt,
        a.checkout_expires_at AS checkoutExpiresAt,a.paid_at AS paidAt,a.paid_at_source AS paidAtSource,a.payer_email AS payerEmail,a.payer_review AS payerReview,
        a.payer_authorization_ref AS payerAuthorizationRef,a.late_resolution AS lateResolution,a.refund_reason AS refundReason,a.refund_requested_at AS refundRequestedAt,
        a.refund_order_due_at AS refundOrderDueAt,a.provider_refund_id AS providerRefundId,a.refund_method AS refundMethod,a.refund_operation_ref AS refundOperationRef,
        a.refund_confirmed_at AS refundConfirmedAt,a.regularization_due_at AS regularizationDueAt,a.chargeback_resolution AS chargebackResolution,a.created_at AS createdAt,a.updated_at AS updatedAt
      FROM purchase_attempts a JOIN companies c ON c.id=a.company_id LEFT JOIN users u ON u.id=a.user_id WHERE a.id=?`).bind(attemptId),
    db.prepare(`SELECT id,kind,severity,status,created_at AS createdAt,resolved_at AS resolvedAt,resolution_code AS resolutionCode FROM incidents WHERE attempt_id=? ORDER BY created_at`).bind(attemptId),
    db.prepare(`SELECT e.action,e.reason_code AS reasonCode,e.evidence_reference AS evidence,e.occurred_at AS at,u.email AS actor FROM admin_events e LEFT JOIN users u ON u.id=e.admin_id
      WHERE e.subject_type='payment' AND e.subject_id=? ORDER BY e.occurred_at`).bind(attemptId),
    db.prepare(`SELECT event_type AS type,received_at AS receivedAt,processed_at AS processedAt,outcome FROM webhook_events WHERE attempt_id=? ORDER BY received_at`).bind(attemptId),
  ]);
  const a=attempt!.results[0] as Record<string,unknown>|undefined;
  if (!a) throw new AdminError('ATTEMPT_NOT_FOUND',404);
  const late=a.status==='late_review'?await latePaymentFacts(db,attemptId).catch(()=>null):null;
  return {attempt:a,incidents:incidents!.results,events:events!.results,webhooks:webhooks!.results,late};
}

// ---------- Incidents ----------
export const INCIDENT_SEVERITIES=['info','warning','critical'] as const;
export async function listIncidentsPage(db:D1Database,f:{status?:string;severity?:string;limit:number;offset:number}) {
  page(f.limit,f.offset);
  const status=oneOf(f.status,['open','resolved'] as const)??'open',severity=oneOf(f.severity,INCIDENT_SEVERITIES);
  const rows=await db.prepare(`SELECT i.id,i.kind,i.severity,i.status,i.company_id AS companyId,c.display_name AS companyName,i.attempt_id AS attemptId,i.created_at AS createdAt,
      i.resolved_at AS resolvedAt,i.resolution_code AS resolutionCode,u.email AS resolvedBy
    FROM incidents i LEFT JOIN companies c ON c.id=i.company_id LEFT JOIN users u ON u.id=i.resolved_by
    WHERE i.status=?${severity?' AND i.severity=?':''} ORDER BY i.created_at DESC LIMIT ${f.limit+1} OFFSET ${f.offset}`).bind(status,...(severity?[severity]:[])).all();
  const counts=await db.prepare(`SELECT severity,COUNT(*) AS n FROM incidents WHERE status='open' GROUP BY severity`).all<{severity:string;n:number}>();
  return {...window_(rows.results as Record<string,unknown>[],f.limit,f.offset),status,openBySeverity:Object.fromEntries(counts.results.map(r=>[r.severity,r.n]))};
}
export async function getIncidentDossier(db:D1Database,id:string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new AdminError('INCIDENT_NOT_FOUND',404);
  const [incident,events]=await db.batch([
    db.prepare(`SELECT i.id,i.kind,i.severity,i.status,i.company_id AS companyId,c.display_name AS companyName,i.attempt_id AS attemptId,i.details_json AS details,
        i.created_at AS createdAt,i.resolved_at AS resolvedAt,i.resolution_code AS resolutionCode,u.email AS resolvedBy
      FROM incidents i LEFT JOIN companies c ON c.id=i.company_id LEFT JOIN users u ON u.id=i.resolved_by WHERE i.id=?`).bind(id),
    db.prepare(`SELECT e.action,e.reason_code AS reasonCode,e.evidence_reference AS evidence,e.occurred_at AS at,u.email AS actor FROM admin_events e LEFT JOIN users u ON u.id=e.admin_id
      WHERE e.subject_type='incident' AND e.subject_id=? ORDER BY e.occurred_at`).bind(id),
  ]);
  const i=incident!.results[0] as Record<string,unknown>|undefined;
  if (!i) throw new AdminError('INCIDENT_NOT_FOUND',404);
  return {incident:{...i,details:parse(i.details as string)},events:events!.results};
}
