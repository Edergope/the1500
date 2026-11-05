-- PERF-001: public read models, derived from the tables that remain the only authority.
-- A revision says "something this data depends on changed". It moves in the same transaction as
-- the change, through these triggers, so a stored payload can never be taken for current once it is stale.
-- Nothing here is a counter: every payload is recomputed from slots and companies when its revision moves.
-- Checkout, payment and adjudication never read these tables.
CREATE TABLE IF NOT EXISTS read_model_revisions (
  scope TEXT PRIMARY KEY CHECK (scope IN ('commerce','catalog')),
  revision INTEGER NOT NULL
);
INSERT OR IGNORE INTO read_model_revisions(scope,revision) VALUES('commerce',1),('catalog',1);
CREATE TABLE IF NOT EXISTS read_models (
  key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  built_at TEXT NOT NULL
);
-- Availability, reservations, phase and price depend on the status of a position and on nothing else.
CREATE TRIGGER IF NOT EXISTS trg_rm_commerce_slots AFTER UPDATE OF status ON slots
WHEN OLD.status IS NOT NEW.status
BEGIN UPDATE read_model_revisions SET revision=revision+1 WHERE scope='commerce'; END;
-- The wall and the directory ignore a reservation: a held position is shown as open.
CREATE TRIGGER IF NOT EXISTS trg_rm_catalog_slots AFTER UPDATE OF status,company_id ON slots
WHEN (OLD.status IN ('assigned','retired') OR NEW.status IN ('assigned','retired'))
  AND (OLD.status IS NOT NEW.status OR OLD.company_id IS NOT NEW.company_id)
BEGIN UPDATE read_model_revisions SET revision=revision+1 WHERE scope='catalog'; END;
CREATE TRIGGER IF NOT EXISTS trg_rm_catalog_company_insert AFTER INSERT ON companies
WHEN NEW.publication_status='published'
BEGIN UPDATE read_model_revisions SET revision=revision+1 WHERE scope='catalog'; END;
CREATE TRIGGER IF NOT EXISTS trg_rm_catalog_company_update AFTER UPDATE OF publication_status,slug,display_name,country,industry ON companies
WHEN OLD.publication_status IS NOT NEW.publication_status OR OLD.slug IS NOT NEW.slug OR OLD.display_name IS NOT NEW.display_name
  OR OLD.country IS NOT NEW.country OR OLD.industry IS NOT NEW.industry
BEGIN UPDATE read_model_revisions SET revision=revision+1 WHERE scope='catalog'; END;
CREATE TRIGGER IF NOT EXISTS trg_rm_catalog_company_delete AFTER DELETE ON companies
BEGIN UPDATE read_model_revisions SET revision=revision+1 WHERE scope='catalog'; END;
CREATE TRIGGER IF NOT EXISTS trg_rm_catalog_profile_insert AFTER INSERT ON profile_versions
WHEN NEW.published_at IS NOT NULL
BEGIN UPDATE read_model_revisions SET revision=revision+1 WHERE scope='catalog'; END;
CREATE TRIGGER IF NOT EXISTS trg_rm_catalog_profile_update AFTER UPDATE OF published_at ON profile_versions
WHEN OLD.published_at IS NOT NEW.published_at
BEGIN UPDATE read_model_revisions SET revision=revision+1 WHERE scope='catalog'; END;
CREATE TRIGGER IF NOT EXISTS trg_rm_catalog_profile_delete AFTER DELETE ON profile_versions
WHEN OLD.published_at IS NOT NULL
BEGIN UPDATE read_model_revisions SET revision=revision+1 WHERE scope='catalog'; END;
