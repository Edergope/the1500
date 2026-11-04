/**
 * Typed API contract for frontend consumers (Antigravity). Import types only.
 * Human-readable reference, errors and permissions: docs/API_CONTRACT.md.
 */
export type {HoldReceipt,InventorySummary,PhaseSummary,SalesMode,SlotPhase} from './inventory';
import type {HoldReceipt} from './inventory';

export type Locale='en'|'es';
export interface ApiError {error:{code:string;message:string;locale:Locale}}
export type IdentityState='self_declared'|'pending_review'|'admin_verified'|'rejected';
export type PublicationStatus='draft'|'generated'|'owner_approved'|'published'|'withdrawn';
export type ProvenanceType='owner_declared'|'ai_generated'|'ai_translated'|'corroborated';
export type LegalBasis='data_protection'|'illicit_content';
export type PremiumRequestStatus='received'|'in_review'|'accepted'|'rejected'|'assigned';
export type PremiumContactPreference='email'|'meeting'|'no_preference';
export type OnboardingStatus='active'|'extended'|'suspended'|'reactivation_requested'|'reactivation_approved'|'reactivated'|'admin_review'|'completed'|'cancelled';
export type PaymentStatus='creating'|'pending'|'paid'|'failed'|'expired'|'late_review'|'amount_review'|'refund_pending'|'refunded'|'disputed'|'chargeback_lost';

// ---- Auth
export interface RequestLinkBody {email:string;locale?:Locale}
export interface MeResponse {user:{id:string;email:string};companies:Array<{id:string;displayName:string;slug:string;identityState:IdentityState;publicationStatus:PublicationStatus;role:'owner'|'editor'}>}

// ---- Companies
export interface RegistrationBody {displayName:string;country:string;industry:string;website:string;declareAuthority:true}
export interface RegistrationResponse {id:string;slug:string;displayName:string;identityState:IdentityState;checkoutEligible:boolean;publicationStatus:'draft'}
export interface CompanyStatusResponse {
  role:'owner'|'editor';
  company:{id:string;displayName:string;slug:string;country:string;industry:string|null;website:string|null;identityState:IdentityState;publicationStatus:PublicationStatus;publicationBlock:string|null;firstPublishedAt:string|null;correctionWindowEndsAt:string|null;guaranteeEndsAt:string|null};
  position:{position:number;status:'assigned'|'retired';phase:number;firstPublishedAt:string|null}|null;
  onboarding:{status:OnboardingStatus;startedAt:string;formDueAt:string;extensionDueAt:string;reactivationDueAt:string;submittedAt:string|null;reactivationRequestedAt:string|null;reactivationApprovedAt:string|null;reactivationNotifiedAt:string|null;reactivationFormDueAt:string|null}|null;
  activeHold:{holdId:string;expiresAt:string}|null;
  profileVersions:Array<{version:number;approvedAt:string|null;publishedAt:string|null;reviewStatus:'not_required'|'pending'|'cleared'|'rejected'}>;
  founderInvitation:{invitationId:string;expiresAt:string}|null;
  requests:Array<{id:string;kind:'withdrawal'|'cancellation';status:'requested'|'completed'|'rejected';legalBasis:LegalBasis|null;requestedAt:string;resolvedAt:string|null}>;
  premiumRequest:{id:string;status:PremiumRequestStatus;contactPreference:PremiumContactPreference;createdAt:string;updatedAt:string}|null;
}

// ---- Orders
export interface HoldResponse {hold:HoldReceipt;paymentStatus:'not_started';checkoutEnabled:boolean}
export interface CheckoutBody {companyId:string;holdId:string;acceptTerms:true;termsVersion:string;locale?:Locale}
export interface CheckoutResponse {
  attemptId:string;checkoutUrl:string|null;status:PaymentStatus;reservationExpiresAt:string;
  amount:{baseUsdCents:number;taxMinor:number;taxStatus:'not_determined';totalMinor:number;currency:'usd'};
  seller:{legalName:string|null;status:'unapproved'|'approved'};paymentMode:'test';
}

// ---- Profile
export interface DeclarationBody {
  companyId:string;language?:string;description:string;descriptionEs?:string;
  services:string[];audiences?:string[];problemSolutions?:Array<{problem:string;solution:string}>;
  advantages?:string[];certifications?:string[];clients?:string[];serviceCountries?:string[];foundedYear?:number;correctionNote?:string;formVersion?:string;
  publish?:{certifications?:boolean;advantages?:boolean};
  consent:{processingAuthorized:true;documentVersion:string};
}
export interface CanonicalProfile {
  schemaVersion:2;version:number;source_type:'owner_declaration';declarationRevision:number;originalLanguage:string;descriptionOriginal:string;descriptionEn:string|null;descriptionEs:string|null;
  services:string[];servicesEs:string[]|null;audiences:string[];audiencesEs:string[]|null;
  problemSolutions:Array<{problem:string;solution:string}>;problemSolutionsEs:Array<{problem:string;solution:string}>|null;
  advantages:string[];certifications:string[];clients:string[];serviceCountries:string[];foundedYear:number|null;publish:{certifications:boolean;advantages:boolean};
  provenance:Record<string,{type:ProvenanceType;sourceFields:string[];method?:string}>;
  warnings:string[];unsupportedClaims:Array<{text:string;reason:string}>;
}
export interface DraftResponse {
  companyId:string;version:number;declarationRevision:number;status:'generated';
  generation:{mode:'llm'|'deterministic';reason:string|null;provider:string|null;model:string|null};
  preview:{canonical:CanonicalProfile;jsonld:unknown;jsonldEs:unknown};
  reviewStatus:'not_required'|'pending';warnings:string[];unsupportedClaims:Array<{text:string;reason:string}>;contentDigest:string;requiresExplicitApproval:true;
}
export interface ApproveBody {companyId:string;version:number;contentDigest:string;acceptPublicDisclosure:true}
export interface ApproveResponse {companyId:string;version:number;status:'owner_approved';approvedAt:string}
export interface PublishResponse {companyId:string;version:number;status:'published';publishedAt:string;slotNumber:number;firstPublishedAt:string;correctionWindowEndsAt:string;guaranteeEndsAt:string}

// ---- Public
export interface PublicCompanyCard {slug:string;name:string;country:string;industry:string|null;summary:string|null;position:number}
export interface DirectoryResponse {items:PublicCompanyCard[];page:number;pageSize:24;total:number}
export interface PublicProfile {
  slug:string;name:string;country:string;industry:string|null;website:string|null;position:number;summary:string;originalLanguage:string;
  services:string[];audiences:string[];problemSolutions:Array<{problem:string;solution:string}>;serviceCountries:string[];foundedYear:number|null;
  ownerDeclared:{certifications:string[];advantages:string[]};provenance:Record<string,ProvenanceType>;
  version:number;publishedAt:string;firstPublishedAt:string;html:string;jsonld:string;
}
export interface Retrieval {method:'fts5_lexical';semantic:false;scope:'published_profiles'}
export interface SearchResponse {
  query:string;count:number;source:'published_profiles';retrieval:Retrieval;
  items:Array<{companyId:string;slug:string;name:string;industry:string|null;country:string;summary:string;version:number;url:string;jsonldUrl:string;position:number;matchedTerms:string[];coverage:number;
    evidence:{field:'problems'|'solutions'|'services'|'summary'|'industry'|'name';quote:string}|null}>;
}
export interface AskBody {question:string;language?:Locale}
export interface AskResponse {
  /** llm_grounded: model answer checked against evidence. retrieval_only: no model text. abstained: not enough evidence. Label them differently. */
  mode:'llm_grounded'|'retrieval_only'|'abstained';degraded?:string|null;
  language:Locale;answer:string;insufficientEvidence:boolean;retrieval:Retrieval;limitations:string;
  citations:Array<{companyId:string;slug:string;title:string;url:string;jsonldUrl:string;profileVersion:number;jsonldDigest:string|null;quote:string;quoteField:string}>;
}
export interface RetiredPositionsResponse {items:Array<{position:number;label:string;labelEs:string}>}
export interface PremiumRequestBody {companyId:string;message:string;contactPreference?:PremiumContactPreference;}
export interface PremiumRequestResponse {requestId:string;companyId:string;status:'received';contactPreference:PremiumContactPreference;createdAt:string;}
export interface ServiceRequestBody {companyId:string;kind:'withdrawal'|'cancellation';reason:string;legalBasis?:LegalBasis;}
export interface ReactivationResponse {companyId:string;status:'reactivation_requested';reactivationRequestedAt:string;}
/** Administration screens. */
export interface LatePaymentFacts {attemptId:string;companyId:string;status:string;phase:number;paidAt:string|null;paidAtSource:'provider_charge'|'provider_event'|'processing_time'|null;holdExpiresAt:string;paidWithinReservation:boolean;
  reservedPosition:{number:number;status:string|null;takenByAnotherCompany:boolean}|null;tierOpen:boolean;freeInTier:number;companyAlreadyHasPosition:number|null;assignable:boolean;allowedDecisions:Array<'assign'|'refund'>;}
export interface IntegrationStatus {mail:{provider:string|null;configured:boolean;bindingPresent:boolean;keyPresent:boolean;from:string|null};stripe:{enabled:boolean;keyPresent:boolean;keyIsTestMode:boolean|null;webhookSecretPresent:boolean;gate:'open_test_mode'|'PAYMENTS_DISABLED'|'LIVE_PAYMENTS_NOT_AUTHORIZED'};
  ai:{configured:boolean;provider:string|null;model:string|null};publicBaseUrl:string|null;snapshotsBound:boolean;}
