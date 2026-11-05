import type {Locale} from '../lib/contracts/api';
import {findPublicProfile,publicProfileDto} from './directory';
import {loadHome,type HomeData} from './home';
import {paymentsGate,type StripeEnv} from './stripe';

type Profile=ReturnType<typeof publicProfileDto>;
export type OfferState='open'|'open_no_payment'|'paused'|'premium'|'closed'|'unknown';
export interface JoinData {
  home:HomeData;offer:OfferState;priceUsdCents:number|null;openPositions:number|null;
  /** The same published profile in both languages. Null until a company has published. */
  profile:{en:Profile;es:Profile}|null;
}
/**
 * What a visitor can do right now. Two separate facts decide it: whether the inventory is on sale,
 * and whether payment is actually enabled. Neither is decided here.
 */
export function offerState(home:HomeData,payments:boolean):OfferState {
  const stats=home.stats;
  if (!stats) return 'unknown';
  if (stats.salesMode==='closed_archive') return 'closed';
  if (stats.salesMode==='premium_admission') return 'premium';
  if (stats.salesMode==='awaiting_founder_allocation'||!stats.checkoutOpen) return 'paused';
  return payments?'open':'open_no_payment';
}
export async function loadJoin(db:D1Database,env:StripeEnv,language:Locale):Promise<JoinData> {
  const home=await loadHome(db,language);
  const offer=offerState(home,paymentsGate(env).ok);
  const phase=home.stats?.phases.find(p=>p.status==='current');
  const openPositions=phase?(offer==='premium'?phase.remaining:phase.forSale):null;
  let profile:JoinData['profile']=null;
  try {
    const row=home.sample?await findPublicProfile(db,home.sample.profile.slug):null;
    if (row) profile={en:publicProfileDto(row,'en'),es:publicProfileDto(row,'es')};
  } catch(e) {
    console.error('join_profile_unavailable',e instanceof Error?e.message:String(e));
  }
  return {home,offer,priceUsdCents:home.stats?.currentPriceUsdCents??null,openPositions,profile};
}
