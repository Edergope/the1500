import type {InventorySummary} from '../lib/contracts/inventory';
import {listPublishedCompanies,retiredItems,type DirectoryFilters} from './directory';
import {composeStats,readCatalog,readCommerce} from './read-model';
export type PublicStats=InventorySummary;

/** Every number comes from the database; nothing here is estimated. read-model.ts says when it is recomputed. */
export async function getPublicStats(db:D1Database):Promise<PublicStats> {
  const [commerce,catalog]=await Promise.all([readCommerce(db),readCatalog(db)]);
  return composeStats(commerce,catalog);
}
export async function getPositionMap(db:D1Database):Promise<string> {
  return (await readCatalog(db)).positionMap;
}
/** What the directory page shows, reading the shared data once. */
export async function loadDirectory(db:D1Database,filters:DirectoryFilters) {
  const [commerce,catalog]=await Promise.all([readCommerce(db),readCatalog(db)]);
  const result=await listPublishedCompanies(db,filters,catalog);
  return {result,stats:composeStats(commerce,catalog),retired:retiredItems(catalog.retired)};
}
