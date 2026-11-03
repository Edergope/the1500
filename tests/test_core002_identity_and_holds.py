"""SQLite contract tests for CORE-002. NOT a substitute for Workers/D1 integration QA."""
import hashlib
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FILES=sorted((ROOT/'db'/'migrations').glob('*.sql'))
NOW=datetime(2026,11,3,20,0,0,tzinfo=timezone.utc)
def stamp(n=0):return (NOW+timedelta(minutes=n)).isoformat(timespec='milliseconds').replace('+00:00','Z')

def db_ready():
    db=sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    for f in FILES:db.executescript(f.read_text(encoding='utf-8'))
    return db

class Core002Tests(unittest.TestCase):
    def setUp(self): self.db=db_ready()
    def tearDown(self): self.db.close()
    def company(self,n=1,state='self_declared',website=None):
        self.db.execute('INSERT INTO companies(id,display_name,slug,country,identity_state,website) VALUES(?,?,?,?,?,?)',
                        (f'company{n}',f'Company {n}',f'company-{n}','US',state,website))
    def user(self,n=1):
        self.db.execute('INSERT INTO users(id,email) VALUES(?,?)',(f'user{n}',f'user{n}@example.com'))

    def test_inventory_still_1500_and_founder_positions_excluded_from_checkout(self):
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM slots').fetchone()[0],1500)
        # Founder places are protected by a capacity trigger, not by reserving specific numbers.
        self.db.execute("UPDATE slots SET status='assigned',assignment_kind='paid' WHERE number BETWEEN 1 AND 500")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'phase 1 paid capacity exhausted'):
            self.db.execute("UPDATE slots SET status='held',active_hold_id='h',held_until='x' WHERE number=501")

    def test_company_email_and_membership_unique(self):
        self.user();self.company()
        self.db.execute("INSERT INTO memberships(user_id,company_id,role) VALUES ('user1','company1','owner')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO memberships(user_id,company_id,role) VALUES ('user1','company1','editor')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO users(id,email) VALUES ('user-alt','USER1@example.com')")

    def test_verified_website_unique_pending_review_does_not_squat(self):
        self.company(1,'pending_review','example.com')
        self.company(2,'self_declared','example.com')
        self.company(3,'pending_review','example.com')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE companies SET identity_state='self_declared' WHERE id='company3'")

    def test_challenge_valid_15_minutes_and_session_replay_blocked(self):
        raw='sample-secret-token';digest=hashlib.sha256(raw.encode()).hexdigest()
        self.db.execute('INSERT INTO login_challenges(id,email,token_digest,requested_at,expires_at) VALUES(?,?,?,?,?)',
                        ('challenge','user1@example.com',digest,stamp(),stamp(15)))
        self.db.commit()
        def consume(sid,at):
            self.db.execute('BEGIN')
            changed=self.db.execute('''UPDATE login_challenges SET consumed_at=?,session_id=?
            WHERE token_digest=? AND consumed_at IS NULL AND expires_at>?''',(at,sid,digest,at)).rowcount
            self.db.execute('''INSERT INTO users(id,email) SELECT ?,email FROM login_challenges
              WHERE session_id=? ON CONFLICT(email) DO NOTHING''',(f'user-{sid}',sid))
            self.db.execute('''INSERT INTO sessions(id,user_id,token_digest,expires_at)
              SELECT ?,u.id,?,? FROM login_challenges c JOIN users u ON u.email=c.email
              WHERE c.session_id=?''',(sid,f'sessionhash-{sid}',stamp(60),sid))
            self.db.commit()
            return changed
        self.assertEqual(consume('session1',stamp(1)),1)
        self.assertEqual(consume('session2',stamp(2)),0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],1)
        self.db.execute('UPDATE sessions SET revoked_at=? WHERE id=?',(stamp(3),'session1'))
        self.assertEqual(self.db.execute('''SELECT COUNT(*) FROM sessions
          WHERE id='session1' AND revoked_at IS NULL AND expires_at>?''',(stamp(4),)).fetchone()[0],0)

    def test_expired_link_cannot_generate_session(self):
        digest=hashlib.sha256(b'expired').hexdigest()
        self.db.execute('INSERT INTO login_challenges(id,email,token_digest,requested_at,expires_at) VALUES(?,?,?,?,?)',
                        ('expired','user1@example.com',digest,stamp(-20),stamp(-5)))
        self.assertEqual(self.db.execute('UPDATE login_challenges SET consumed_at=?,session_id=? WHERE token_digest=? AND consumed_at IS NULL AND expires_at>?',
                         (stamp(),'new',digest,stamp())).rowcount,0)

    def test_idempotency_key_never_reused_and_one_active_company_hold(self):
        self.company(1);self.company(2);self.user()
        self.db.execute("INSERT INTO slot_holds(id,slot_number,company_id,user_id,idempotency_key,created_at,expires_at) VALUES('h1',101,'company1','user1','same',?,?)",(stamp(),stamp(20)))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO slot_holds(id,slot_number,company_id,user_id,idempotency_key,created_at,expires_at) VALUES('h2',102,'company1','user1','new',?,?)",(stamp(),stamp(20)))
        self.db.execute("UPDATE slot_holds SET status='expired' WHERE id='h1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO slot_holds(id,slot_number,company_id,user_id,idempotency_key,created_at,expires_at) VALUES('h2',102,'company2','user1','same',?,?)",(stamp(),stamp(20)))
        self.db.execute("INSERT INTO slot_holds(id,slot_number,company_id,user_id,idempotency_key,created_at,expires_at) VALUES('h2',102,'company2','user1','new',?,?)",(stamp(),stamp(20)))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM slot_holds WHERE status='active'").fetchone()[0],1)

    def test_paid_hold_cannot_take_any_founder_slot(self):
        self.db.execute("UPDATE slots SET status='assigned',assignment_kind='paid' WHERE number BETWEEN 1 AND 500")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'phase 1 paid capacity exhausted'):
            self.db.execute("UPDATE slots SET status='held',active_hold_id='h',held_until='x' WHERE number=600")
        self.assertEqual(self.db.execute("SELECT MIN(phase) FROM slots WHERE status IN('available','held')").fetchone(),(1,))

    def test_complete_founders_then_next_tier_opens(self):
        self.db.execute("UPDATE slots SET status='assigned' WHERE number BETWEEN 1 AND 600")
        self.assertEqual(self.db.execute("SELECT MIN(phase) FROM slots WHERE status IN('available','held')").fetchone(),(2,))

    def test_session_cookie_digest_unique(self):
        self.user();self.db.execute("INSERT INTO sessions(id,user_id,token_digest,expires_at) VALUES('s1','user1','digest',?)",(stamp(100),))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO sessions(id,user_id,token_digest,expires_at) VALUES('s2','user1','digest',?)",(stamp(100),))

if __name__=='__main__':unittest.main()
