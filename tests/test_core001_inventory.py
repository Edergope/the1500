"""SQLite contract checks for additive CORE-001 migration.
These are NOT Cloudflare D1 concurrency integration tests.
"""
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SQL1=(ROOT/'db/migrations/0001_init.sql').read_text(encoding='utf-8')
SQL2=(ROOT/'db/migrations/0002_core001.sql').read_text(encoding='utf-8')
NOW=datetime(2026,11,3,19,0,0,tzinfo=timezone.utc)
def stamp(dt): return dt.isoformat(timespec='milliseconds').replace('+00:00','Z')

def make_db():
    db=sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript(SQL1)
    db.executescript(SQL2)
    return db

class MigrationContractTests(unittest.TestCase):
    def setUp(self): self.db=make_db()
    def tearDown(self): self.db.close()

    def company(self,n):
        self.db.execute('INSERT INTO companies(id,display_name,slug,country) VALUES (?,?,?,?)',(f'c{n}',f'Company {n}',f'company-{n}','US'))

    def test_exact_fixed_inventory_and_prices(self):
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM slots').fetchone()[0],1500)
        expected={1:(1,10000),100:(1,10000),600:(1,10000),601:(2,40000),1050:(2,40000),1051:(3,100000),1350:(3,100000),1351:(4,506600),1500:(4,506600)}
        for number,phase_price in expected.items():
            self.assertEqual(self.db.execute('SELECT phase,price_usd_cents FROM slots WHERE number=?',(number,)).fetchone(),phase_price)

    def test_purchase_history_allows_multiple_attempts_same_slot(self):
        self.company(1)
        for i in range(2):
            self.db.execute("INSERT INTO purchase_attempts(id,company_id,slot_number,provider,amount_usd_cents,charged_currency,total_minor,status,idempotency_key) VALUES (?,?,1,'stripe',10000,'USD',10000,'expired',?)",(f'purchase-{i}','c1',f'key-{i}'))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM purchase_attempts WHERE slot_number=1').fetchone()[0],2)

    def test_active_hold_uniqueness(self):
        self.company(1);self.company(2)
        self.db.execute("INSERT INTO slot_holds(id,slot_number,company_id,created_at,expires_at) VALUES ('h1',1,'c1',?,?)",(stamp(NOW),stamp(NOW+timedelta(minutes=20))))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO slot_holds(id,slot_number,company_id,created_at,expires_at) VALUES ('h2',1,'c2',?,?)",(stamp(NOW),stamp(NOW+timedelta(minutes=20))))
        self.db.execute("UPDATE slot_holds SET status='expired' WHERE id='h1'")
        self.db.execute("INSERT INTO slot_holds(id,slot_number,company_id,created_at,expires_at) VALUES ('h2',1,'c2',?,?)",(stamp(NOW),stamp(NOW+timedelta(minutes=20))))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM slot_holds WHERE slot_number=1").fetchone()[0],2)

    def test_founder_limit_is_100_and_phase_one_only(self):
        self.db.execute("INSERT INTO users(id,email) VALUES ('admin','admin@example.com')")
        for i in range(1,102): self.company(i)
        for n in range(1,101):
            self.db.execute("INSERT INTO founder_awards(id,slot_number,company_id,approved_by,awarded_at) VALUES (?,?,?,'admin',?)",(f'f{n}',n,f'c{n}',stamp(NOW)))
        with self.assertRaisesRegex(sqlite3.IntegrityError,'founder quota exhausted'):
            self.db.execute("INSERT INTO founder_awards(id,slot_number,company_id,approved_by,awarded_at) VALUES ('f101',101,'c101','admin',?)",(stamp(NOW),))
        self.db.execute("UPDATE founder_awards SET status='revoked',revoked_at=? WHERE id='f1'",(stamp(NOW),))
        with self.assertRaisesRegex(sqlite3.IntegrityError,'founder award must be within phase 1'):
            self.db.execute("INSERT INTO founder_awards(id,slot_number,company_id,approved_by,awarded_at) VALUES ('bad',601,'c1','admin',?)",(stamp(NOW),))
        self.db.execute("INSERT INTO founder_awards(id,slot_number,company_id,approved_by,awarded_at) VALUES ('f101',101,'c101','admin',?)",(stamp(NOW),))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM founder_awards WHERE status='active'").fetchone()[0],100)

    def test_slot_audit_immutable(self):
        self.db.execute("INSERT INTO slot_audit(event_id,slot_number,action,occurred_at) VALUES ('ev',1,'expire',?)",(stamp(NOW),))
        with self.assertRaisesRegex(sqlite3.IntegrityError,'append-only'):
            self.db.execute("UPDATE slot_audit SET action='release' WHERE event_id='ev'")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'append-only'):
            self.db.execute("DELETE FROM slot_audit WHERE event_id='ev'")

    def test_live_payment_mode_blocked_until_seller_approved(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE legal_seller_configuration SET payment_mode='live' WHERE id=1")

    def test_phase_does_not_advance_if_first_phase_only_held(self):
        self.db.execute("UPDATE slots SET status='held' WHERE phase=1")
        current=self.db.execute("SELECT MIN(phase) FROM slots WHERE status IN ('available','held')").fetchone()[0]
        self.assertEqual(current,1)
        self.assertIsNone(self.db.execute("SELECT number FROM slots WHERE phase=? AND status='available' LIMIT 1",(current,)).fetchone())

    def test_reopened_old_phase_has_priority(self):
        self.db.execute("UPDATE slots SET status='assigned' WHERE phase=1")
        self.assertEqual(self.db.execute("SELECT MIN(phase) FROM slots WHERE status IN ('available','held')").fetchone()[0],2)
        self.db.execute("UPDATE slots SET status='available' WHERE number=250")
        self.assertEqual(self.db.execute("SELECT MIN(phase) FROM slots WHERE status IN ('available','held')").fetchone()[0],1)

class RaceSimulationTests(unittest.TestCase):
    """File-backed SQLite serialized writer simulation; D1 staging race still required."""
    def test_only_one_winner_even_when_competing_for_same_last_slot(self):
        with tempfile.TemporaryDirectory() as folder:
            path=str(Path(folder)/'test.db')
            db=sqlite3.connect(path)
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA foreign_keys=ON')
            db.executescript(SQL1); db.executescript(SQL2)
            db.execute("UPDATE slots SET status='held' WHERE number BETWEEN 2 AND 600")
            for n in range(1,13):
                db.execute('INSERT INTO companies(id,display_name,slug,country) VALUES (?,?,?,?)',(f'c{n}',f'C{n}',f'c-{n}','US'))
            db.commit();db.close()
            barrier=threading.Barrier(12)
            def race(n):
                c=sqlite3.connect(path,timeout=8,isolation_level=None)
                c.execute('PRAGMA foreign_keys=ON')
                hold_id=f'hold-{n}'
                barrier.wait()
                try:
                    c.execute('BEGIN IMMEDIATE')
                    c.execute("UPDATE slots SET status='held',active_hold_id=?,held_until=? WHERE number=1 AND status='available' AND phase=(SELECT MIN(phase) FROM slots WHERE status IN ('available','held'))",(hold_id,stamp(NOW+timedelta(minutes=20))))
                    c.execute("INSERT INTO slot_holds(id,slot_number,company_id,status,created_at,expires_at) SELECT ?,number,?,'active',?,? FROM slots WHERE number=1 AND status='held' AND active_hold_id=?",(hold_id,f'c{n}',stamp(NOW),stamp(NOW+timedelta(minutes=20)),hold_id))
                    c.commit()
                    return c.execute('SELECT COUNT(*) FROM slot_holds WHERE id=?',(hold_id,)).fetchone()[0]
                finally:c.close()
            with ThreadPoolExecutor(max_workers=12) as executor: winners=list(executor.map(race,range(1,13)))
            self.assertEqual(sum(winners),1)
            verification=sqlite3.connect(path)
            self.assertEqual(verification.execute("SELECT COUNT(*) FROM slot_holds WHERE slot_number=1 AND status='active'").fetchone()[0],1)
            verification.close()

if __name__=='__main__': unittest.main()
