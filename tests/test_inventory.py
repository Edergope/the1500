import sqlite3
import unittest
from pathlib import Path

SQL = Path(__file__).resolve().parents[1] / 'db/migrations/0001_init.sql'

class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SQL.read_text(encoding='utf-8'))

    def tearDown(self):
        self.db.close()

    def test_exactly_1500_positions(self):
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM slots').fetchone()[0], 1500)
        self.assertEqual(self.db.execute('SELECT MIN(number),MAX(number) FROM slots').fetchone(), (1, 1500))

    def test_boundaries_pricing(self):
        expected = {1:(1,10000),600:(1,10000),601:(2,40000),1050:(2,40000),1051:(3,100000),1350:(3,100000),1351:(4,506600),1500:(4,506600)}
        for slot,(phase,cents) in expected.items():
            with self.subTest(slot=slot):
                self.assertEqual(self.db.execute('SELECT phase,price_usd_cents FROM slots WHERE number=?',(slot,)).fetchone(),(phase,cents))

    def test_unique_inventory_after_second_seed(self):
        self.db.executescript(SQL.read_text(encoding='utf-8'))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM slots').fetchone()[0],1500)

    def test_reject_invalid_slot_number(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO slots(number,phase,price_usd_cents) VALUES (1501,4,506600)')

    def test_reject_mismatched_price(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('UPDATE slots SET price_usd_cents=40000 WHERE number=600')

    def test_reject_double_company_assignment(self):
        self.db.execute("INSERT INTO companies(id,display_name,slug,country) VALUES ('c1','Demo','demo','US')")
        self.db.execute("UPDATE slots SET status='assigned',company_id='c1' WHERE number=1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE slots SET status='assigned',company_id='c1' WHERE number=2")

    def test_initial_all_slots_free(self):
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM slots WHERE status != 'available'").fetchone()[0],0)

if __name__=='__main__': unittest.main()
