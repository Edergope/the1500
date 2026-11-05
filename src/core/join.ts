import type {Locale} from '../lib/contracts/api';
import {findPublicProfile,publicProfileDto} from './directory';
import {currentRange,homeSample,type HomeData} from './home';
import {composeStats,readCatalog,readCommerce} from './read-model';
import {paymentsGate,type StripeEnv} from './stripe';

type Profile=ReturnType<typeof publicProfileDto>;
export type OfferState='open'|'open_no_payment'|'paused'|'premium'|'closed'|'unknown';
export interface JoinData {
  /** Only what this page shows. The list of companies and of retired positions are not read for it. */
  home:Pick<HomeData,'stats'|'positionMap'|'currentRange'|'sample'>;offer:OfferState;priceUsdCents:number|null;openPositions:number|null;
  /** The same published profile in both languages. Null until a company has published. */
  profile:{en:Profile;es:Profile}|null;
}
/**
 * What a visitor can do right now. Two separate facts decide it: whether the inventory is on sale,
 * and whether payment is actually enabled. Neither is decided here.
 */
export function offerState(home:Pick<HomeData,'stats'>,payments:boolean):OfferState {
  const stats=home.stats;
  if (!stats) return 'unknown';
  if (stats.salesMode==='closed_archive') return 'closed';
  if (stats.salesMode==='premium_admission') return 'premium';
  if (stats.salesMode==='awaiting_founder_allocation'||!stats.checkoutOpen) return 'paused';
  return payments?'open':'open_no_payment';
}
export async function loadJoin(db:D1Database,env:StripeEnv,language:Locale):Promise<JoinData> {
  let home:JoinData['home']={stats:null,positionMap:null,currentRange:null,sample:null};
  let profile:JoinData['profile']=null;
  try {
    const [commerce,catalog]=await Promise.all([readCommerce(db),readCatalog(db)]);
    const stats=composeStats(commerce,catalog);
    home={stats,positionMap:catalog.positionMap,currentRange:currentRange(stats),sample:null};
    const row=catalog.firstSlug?await findPublicProfile(db,catalog.firstSlug):null;
    if (row) {
      home.sample=homeSample(row,language);
      profile={en:publicProfileDto(row,'en'),es:publicProfileDto(row,'es')};
    }
  } catch(e) {
    console.error('join_data_unavailable',e instanceof Error?e.message:String(e));
  }
  const offer=offerState(home,paymentsGate(env).ok);
  const phase=home.stats?.phases.find(p=>p.status==='current');
  const openPositions=phase?(offer==='premium'?phase.remaining:phase.forSale):null;
  return {home,offer,priceUsdCents:home.stats?.currentPriceUsdCents??null,openPositions,profile};
}
