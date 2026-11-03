"""SQLite integration contract tests. NOT Cloudflare workerd, production payments, or browser E2E."""
import json
import sqlite3
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MIGRATIONS=sorted((ROOT/'db/migrations').glob('*.sql'))
STAMP='2026-11-03T20:00:00.000Z'


def new_db():
    db=sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    for migration in MIGRATIONS:db.executescript(migration.read_text())
    db.execute("INSERT INTO users(id,email) VALUES ('admin','admin@example.com'),('owner','owner@example.com'),('other','other@example.com')")
    db.execute("INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES('admin',?,'verified operator')",(STAMP,))
    for cid in ['one','two']:
        db.execute('INSERT INTO companies(id,display_name,slug,country,industry,identity_state) VALUES(?,?,?,?,?,?)',
                   (cid,'Company '+cid,cid,'US','Maritime logistics','self_declared'))
    db.execute("INSERT INTO memberships(user_id,company_id,role) VALUES('owner','one','owner')")
    db.execute("INSERT INTO memberships(user_id,company_id,role) VALUES('other','two','owner')")
    db.commit()
    return db


def accept_invite_sql(db,cid='one',invite='inv1',slot=1):
    """Matches the four important transactional statements in acceptFounderInvitation()."""
    db.commit()
    db.execute('BEGIN IMMEDIATE')
    try:
        changed=db.execute("""UPDATE slots SET status='assigned',company_id=?,assignment_kind='founder'
        WHERE number=? AND status='available'
        AND NOT EXISTS(SELECT 1 FROM slots s WHERE s.company_id=? AND s.status IN('assigned','retired'))
        AND EXISTS(SELECT 1 FROM founder_invitations fi WHERE fi.id=? AND fi.company_id=?
        AND fi.status='pending' AND fi.expires_at>?)""",
                           (cid,slot,cid,invite,cid,STAMP)).rowcount
        if changed!=1:raise ValueError('conflict')
        db.execute("""INSERT INTO founder_awards(id,slot_number,company_id,approved_by,status,awarded_at)
          SELECT 'award',s.number,?,fi.invited_by,'active',? FROM slots s JOIN founder_invitations fi
          ON fi.id=? WHERE s.number=? AND s.company_id=? AND s.status='assigned'
          AND s.assignment_kind='founder' AND fi.status='pending' AND fi.expires_at>?""",
                   (cid,STAMP,invite,slot,cid,STAMP))
        db.execute("""UPDATE founder_invitations SET status='accepted',accepted_at=?,accepted_by='owner'
          WHERE id=? AND status='pending' AND expires_at>? AND EXISTS(SELECT 1 FROM founder_awards WHERE id='award')""",
                   (STAMP,invite,STAMP))
        db.execute("""INSERT INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at)
          SELECT 'ev',s.number,'assign_founder',s.company_id,'award',? FROM slots s
          WHERE s.number=? AND s.status='assigned' AND s.company_id=?
          AND EXISTS(SELECT 1 FROM founder_awards WHERE id='award')""",
                   (STAMP,slot,cid))
        db.commit()
    except Exception:
        db.rollback()
        raise


class AdminAndSearch(unittest.TestCase):
    def setUp(self):self.db=new_db()
    def tearDown(self):self.db.close()

    def test_exact_inventory_and_admin_bootstrap(self):
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM slots').fetchone()[0],1500)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM platform_admins WHERE revoked_at IS NULL').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM founder_awards').fetchone()[0],0)

    def test_founder_must_have_real_assigned_reserved_slot(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError,'founder award requires'):
            self.db.execute("INSERT INTO founder_awards(id,slot_number,company_id,approved_by,awarded_at) VALUES('award',1,'one','admin',?)",(STAMP,))
        # Tier 1 is one ascending pool (Decisions 31, 32, 35), so a founder may hold any number up to 600, never beyond.
        self.db.execute("UPDATE slots SET status='assigned',company_id='one',assignment_kind='founder' WHERE number=601")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'founder award'):
            self.db.execute("INSERT INTO founder_awards(id,slot_number,company_id,approved_by,awarded_at) VALUES('award',601,'one','admin',?)",(STAMP,))

    def test_founder_acceptance_changes_inventory_and_audits(self):
        self.db.execute("INSERT INTO founder_invitations(id,company_id,invited_by,created_at,expires_at) VALUES('inv1','one','admin','2026-11-02','2026-11-10')")
        accept_invite_sql(self.db)
        self.assertEqual(self.db.execute('SELECT number,assignment_kind FROM slots WHERE company_id=?',('one',)).fetchone(),(1,'founder'))
        self.assertEqual(self.db.execute("SELECT status FROM founder_invitations WHERE id='inv1'").fetchone()[0],'accepted')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM founder_awards').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT action FROM slot_audit').fetchone()[0],'assign_founder')

    def test_replayed_invite_does_not_award_twice(self):
        self.db.execute("INSERT INTO founder_invitations(id,company_id,invited_by,created_at,expires_at) VALUES('inv1','one','admin','2026-11-02','2026-11-10')")
        accept_invite_sql(self.db)
        with self.assertRaisesRegex(ValueError,'conflict'):
            accept_invite_sql(self.db,slot=2)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM founder_awards').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT status FROM slots WHERE number=2').fetchone()[0],'available')

    def test_expired_invite_fails_without_awarding(self):
        self.db.execute("INSERT INTO founder_invitations(id,company_id,invited_by,created_at,expires_at) VALUES('inv1','one','admin','2026-10-01','2026-10-08')")
        with self.assertRaisesRegex(ValueError,'conflict'):accept_invite_sql(self.db)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM founder_awards').fetchone()[0],0)

    def test_founder_quota_cannot_exceed_100(self):
        for n in range(1,101):
            cid='company'+str(n)
            self.db.execute("INSERT INTO companies(id,display_name,slug,country,identity_state) VALUES(?,?,?,'US','self_declared')",(cid,cid,cid))
            self.db.execute('UPDATE slots SET status=\'assigned\',company_id=?,assignment_kind=\'founder\' WHERE number=?',(cid,n))
            self.db.execute('INSERT INTO founder_awards(id,slot_number,company_id,approved_by,status,awarded_at) VALUES(?,?,?,?,\'active\',?)',(cid,n,cid,'admin',STAMP))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM founder_awards').fetchone()[0],100)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM slots WHERE assignment_kind='founder'").fetchone()[0],100)

    def test_company_review_evidence_is_append_only(self):
        self.db.execute("UPDATE companies SET identity_state='pending_review' WHERE id='one'")
        self.db.execute("UPDATE companies SET identity_state='admin_verified' WHERE id='one' AND identity_state='pending_review'")
        self.db.execute("""INSERT INTO admin_review_events(id,company_id,admin_id,decision,reason_code,evidence_reference,decided_at)
            SELECT 'review','one','admin','approved','documents_checked','case reference 123',? WHERE changes()=1""",(STAMP,))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM admin_review_events').fetchone()[0],1)
        with self.assertRaisesRegex(sqlite3.IntegrityError,'append-only'):
            self.db.execute("DELETE FROM admin_review_events WHERE id='review'")

    def test_search_index_ignores_unpublished_companies(self):
        self.db.execute("INSERT INTO published_company_fts(company_id,name,industry,country,summary,services,problems,solutions) VALUES('one','Company one','Logistics','US','Shipping routes','Freight','Delays','Tracking')")
        visible=self.db.execute("""SELECT c.slug FROM published_company_fts f JOIN companies c ON c.id=f.company_id
          WHERE published_company_fts MATCH 'Shipping' AND c.publication_status='published'""").fetchall()
        self.assertEqual(visible,[])

    def test_search_finds_real_published_only_and_withdrawal_clears(self):
        self.db.execute("UPDATE slots SET status='assigned',company_id='one',assignment_kind='founder' WHERE number=1")
        public=json.dumps({'descriptionEn':'Marine shipping logistics experts','services':['Port coordination'],'problemSolutions':[]})
        self.db.execute("INSERT INTO profile_versions(company_id,version,canonical_json,public_jsonld,approved_by,approved_at,published_at) VALUES('one',1,?,'{}','owner',?,?)",(public,STAMP,STAMP))
        self.db.execute("INSERT INTO published_profile_snapshots(company_id,version,jsonld_digest,published_at) VALUES('one',1,'hash',?)",(STAMP,))
        self.db.execute("UPDATE companies SET publication_status='published' WHERE id='one'")
        self.db.execute("INSERT INTO published_company_fts(company_id,name,industry,country,summary,services,problems,solutions) VALUES('one','Company one','Logistics','US','Marine shipping logistics experts','Port coordination','Delays','Tracking')")
        self.db.execute("INSERT INTO published_company_fts(company_id,name,industry,country,summary,services,problems,solutions) VALUES('two','Company two','Logistics','US','Marine shipping experts','Port','Delays','Tracking')")
        sql="""SELECT c.slug FROM published_company_fts f JOIN companies c ON c.id=f.company_id
          WHERE published_company_fts MATCH ? AND c.publication_status='published'
          AND EXISTS(SELECT 1 FROM profile_versions v JOIN published_profile_snapshots p
             ON p.company_id=v.company_id AND p.version=v.version
             WHERE v.company_id=c.id AND v.approved_at IS NOT NULL AND v.published_at IS NOT NULL)
          ORDER BY bm25(published_company_fts),c.slug"""
        self.assertEqual(self.db.execute(sql,('"Marine" OR "shipping"',)).fetchall(),[('one',)])
        self.db.execute("UPDATE companies SET publication_status='withdrawn' WHERE id='one'")
        self.assertEqual(self.db.execute(sql,('"Marine"',)).fetchall(),[])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM published_company_fts WHERE company_id='one'").fetchone()[0],0)

    def test_fts_backfill_on_existing_published_profile(self):
        staged=sqlite3.connect(':memory:')
        try:
            staged.execute('PRAGMA foreign_keys=ON')
            for migration in MIGRATIONS:
                if migration.name.startswith('0005'):break
                staged.executescript(migration.read_text())
            staged.execute("INSERT INTO users(id,email) VALUES('u','u@acme.com')")
            staged.execute("INSERT INTO companies(id,display_name,slug,country,industry,identity_state,publication_status) VALUES('old','Old Published Co','old','US','Supply chain','self_declared','published')")
            staged.execute("UPDATE slots SET status='assigned',company_id='old',assignment_kind='paid' WHERE number=101")
            canonical=json.dumps({'descriptionEn':'Legacy containers tracking solution',
               'services':['Container tracking'], 'problemSolutions':[{'problem':'Lost containers','solution':'Location monitoring'}]})
            staged.execute('INSERT INTO profile_versions(company_id,version,canonical_json,public_jsonld,approved_by,approved_at,published_at) VALUES(?,?,?,?,?,?,?)',
               ('old',1,canonical,'{}','u',STAMP,STAMP))
            staged.execute('INSERT INTO published_profile_snapshots(company_id,version,jsonld_digest,published_at) VALUES(?,?,?,?)',
               ('old',1,'digest',STAMP))
            staged.commit()
            staged.executescript((ROOT/'db/migrations/0005_core004_admin_and_search.sql').read_text())
            found=staged.execute('SELECT company_id FROM published_company_fts WHERE published_company_fts MATCH ?',('"containers"',)).fetchall()
            self.assertEqual(found,[('old',)])
        finally:staged.close()

    def test_fts_uses_unicode_and_does_not_parse_query_as_sql(self):
        self.db.execute("INSERT INTO published_company_fts(company_id,name,industry,country,summary,services,problems,solutions) VALUES('one','Compañía de logística','Transporte','CO','Servicios de carga','Aduanas','Demoras','Seguimiento')")
        self.assertEqual(self.db.execute("SELECT company_id FROM published_company_fts WHERE published_company_fts MATCH ?",('"logistica"',)).fetchall(),[('one',)])


if __name__=='__main__':unittest.main()
