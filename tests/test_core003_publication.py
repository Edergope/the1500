"""Publication state-machine contract tests against SQLite (not live Cloudflare D1)."""
import sqlite3
import json
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
MIGRATIONS=sorted((ROOT/'db/migrations').glob('*.sql'))
STAMP='2026-11-03T20:00:00.000Z'

def ready_db():
    db=sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    for p in MIGRATIONS:db.executescript(p.read_text())
    db.execute("INSERT INTO users(id,email) VALUES('owner','owner@acme.com')")
    db.execute("INSERT INTO companies(id,display_name,slug,country,industry,website,identity_state) VALUES('acme','Acme LLC','acme','US','Logistics','acme.com','self_declared')")
    db.execute("INSERT INTO memberships(user_id,company_id,role) VALUES('owner','acme','owner')")
    return db

def draft(db,version=1,description='Acme coordinates freight and helps importers monitor shipments.'):
    canonical=json.dumps({'descriptionEn':description,'services':['Freight coordination'],
                          'source_type':'owner_declaration','audiences':['Importers']})
    public=json.dumps({'@context':'https://schema.org','@type':'Organization',
                       '@id':'urn:the1500:company:acme','name':'Acme LLC','description':description,
                       'hasOfferCatalog':{'@type':'OfferCatalog','name':'Services'}})
    db.execute('INSERT INTO profile_versions(company_id,version,canonical_json,public_jsonld,created_at) VALUES(?,?,?,?,?)',
               ('acme',version,canonical,public,STAMP))
    db.execute('INSERT INTO owner_profile_declarations(company_id,version,declaration_json,submitted_by,submitted_at) VALUES(?,?,?,?,?)',
               ('acme',version,canonical,'owner',STAMP))
    return canonical,public

def approve(db,version=1,digest='sha256-approved'):
    db.execute('UPDATE profile_versions SET approved_by=?,approved_at=? WHERE company_id=? AND version=? AND approved_at IS NULL',
               ('owner',STAMP,'acme',version))
    db.execute('INSERT INTO profile_approvals(company_id,version,user_id,content_digest,approved_at) VALUES(?,?,?,?,?)',
               ('acme',version,'owner',digest,STAMP))

def public_row(db):
    return db.execute('''SELECT c.slug,v.version FROM companies c JOIN profile_versions v ON v.company_id=c.id
      WHERE c.slug='acme' AND c.publication_status='published' AND v.published_at IS NOT NULL
      AND v.version=(SELECT MAX(v2.version) FROM profile_versions v2
        WHERE v2.company_id=c.id AND v2.published_at IS NOT NULL)''').fetchone()

class PublicationSqlTests(unittest.TestCase):
    def setUp(self):self.db=ready_db()
    def tearDown(self):self.db.close()
    def test_unapproved_company_draft_is_not_public(self):
        draft(self.db)
        self.assertIsNone(public_row(self.db))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM published_profile_snapshots').fetchone()[0],0)
    def test_snapshot_requires_approval_and_real_assignment(self):
        draft(self.db)
        with self.assertRaisesRegex(sqlite3.IntegrityError,'requires approval'):
            self.db.execute('INSERT INTO published_profile_snapshots(company_id,version,jsonld_digest,published_at) VALUES(?,?,?,?)',
                            ('acme',1,'hash',STAMP))
        approve(self.db)
        self.db.execute("UPDATE profile_versions SET published_at=? WHERE company_id='acme' AND version=1",(STAMP,))
        with self.assertRaisesRegex(sqlite3.IntegrityError,'requires approval'):
            self.db.execute('INSERT INTO published_profile_snapshots(company_id,version,jsonld_digest,published_at) VALUES(?,?,?,?)',
                            ('acme',1,'hash',STAMP))

    def test_publication_requirements_and_snapshot(self):
        _,public=draft(self.db)
        approve(self.db)
        self.assertIsNone(public_row(self.db))
        self.db.execute("UPDATE slots SET status='assigned',company_id='acme',assignment_kind='paid' WHERE number=101")
        self.db.execute('UPDATE profile_versions SET published_at=? WHERE company_id=? AND version=1 AND approved_at IS NOT NULL',
                        (STAMP,'acme'))
        self.db.execute('INSERT INTO published_profile_snapshots(company_id,version,jsonld_digest,published_at) VALUES(?,?,?,?)',
                        ('acme',1,'validhash',STAMP))
        self.db.execute("UPDATE companies SET publication_status='published',public_summary=?,published_at=? WHERE id='acme'",
                        ('Acme coordinates freight.',STAMP))
        self.assertEqual(public_row(self.db),('acme',1))
        self.assertEqual(json.loads(public)['@type'],'Organization')
    def test_published_snapshot_immutable(self):
        draft(self.db);approve(self.db)
        self.db.execute("UPDATE slots SET status='assigned',company_id='acme',assignment_kind='paid' WHERE number=101")
        self.db.execute("UPDATE profile_versions SET published_at=? WHERE company_id='acme' AND version=1",(STAMP,))
        self.db.execute('INSERT INTO published_profile_snapshots(company_id,version,jsonld_digest,published_at) VALUES(?,?,?,?)',
                        ('acme',1,'hash',STAMP))
        with self.assertRaisesRegex(sqlite3.IntegrityError,'immutable'):
            self.db.execute("UPDATE published_profile_snapshots SET jsonld_digest='modified'")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'immutable'):
            self.db.execute('DELETE FROM published_profile_snapshots')
    def test_version_two_is_not_public_until_approved_and_published(self):
        draft(self.db,1);approve(self.db,1)
        self.db.execute("UPDATE slots SET status='assigned',company_id='acme',assignment_kind='paid' WHERE number=101")
        self.db.execute("UPDATE profile_versions SET published_at=? WHERE company_id='acme' AND version=1",(STAMP,))
        self.db.execute("UPDATE companies SET publication_status='published' WHERE id='acme'")
        draft(self.db,2,'Acme now provides additional customs and logistics support.')
        self.assertEqual(public_row(self.db),('acme',1))
        approve(self.db,2)
        self.assertEqual(public_row(self.db),('acme',1))
        self.db.execute("UPDATE profile_versions SET published_at=? WHERE company_id='acme' AND version=2",(STAMP,))
        self.assertEqual(public_row(self.db),('acme',2))
    def test_withdrawal_hides_company_even_if_snapshot_remains(self):
        draft(self.db);approve(self.db)
        self.db.execute("UPDATE profile_versions SET published_at=? WHERE company_id='acme' AND version=1",(STAMP,))
        self.db.execute("UPDATE companies SET publication_status='withdrawn' WHERE id='acme'")
        self.assertIsNone(public_row(self.db))

if __name__=='__main__':unittest.main()
