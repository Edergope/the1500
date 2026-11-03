const {test,describe,before,after}=require('node:test');const assert=require('node:assert/strict');
const {freshDb,seedCompany,fillPaid,fillFounder}=require('../support/d1.cjs');
const core=p=>require(`../../.core-js-tests/core/${p}.js`);
const inv=core('inventory'),adm=core('admin'),pub=core('public');
const key=n=>`idempotency_key_${String(n).padStart(6,'0')}`;
const NOW=new Date('2026-11-03T20:00:00.000Z');
async function attemptFor(db,hold,s,id=crypto.randomUUID()){
  await db.prepare(`INSERT INTO purchase_attempts(id,company_id,user_id,hold_id,phase,provider,amount_usd_cents,total_minor,status,idempotency_key,hold_expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,'stripe',?,?,'pending',?,?,?,?)`).bind(id,s.companyId,s.userId,hold.holdId,hold.phase,hold.priceUsdCents,hold.priceUsdCents,id,hold.expiresAt,NOW.toISOString(),NOW.toISOString()).run();
  return id;
}
describe('T01/T02 concurrency on the D1 engine',()=>{
  let h;before(async()=>{h=await freshDb();});after(()=>h.dispose());
  test('40 simultaneous buyers all get distinct reservations (baseline: 1 of 20 succeeded)',async()=>{
    const sellers=await Promise.all(Array.from({length:40},()=>seedCompany(h.db)));
    const results=await Promise.allSettled(sellers.map((s,i)=>inv.createCheckoutHold(h.db,s.companyId,s.userId,key(i),NOW)));
    const failed=results.filter(r=>r.status==='rejected').map(r=>r.reason.code);
    assert.deepEqual(failed,[]);
    const slots=await h.db.prepare(`SELECT number,active_hold_id FROM slots WHERE status='held' ORDER BY number`).all();
    assert.equal(slots.results.length,40);
    assert.equal(new Set(slots.results.map(s=>s.number)).size,40);
    assert.equal(slots.results[0].number,1);assert.equal(slots.results[39].number,40);
  });
  test('same key replayed concurrently yields one hold',async()=>{
    const s=await seedCompany(h.db);
    const results=await Promise.all(Array.from({length:8},()=>inv.createCheckoutHold(h.db,s.companyId,s.userId,key(900),NOW)));
    assert.equal(new Set(results.map(r=>r.holdId)).size,1);
    const n=await h.db.prepare(`SELECT COUNT(*) n FROM slot_holds WHERE company_id=?`).bind(s.companyId).first();
    assert.equal(n.n,1);
  });
  test('one company cannot hold twice in parallel with different keys',async()=>{
    const s=await seedCompany(h.db);
    const results=await Promise.allSettled([1,2,3].map(i=>inv.createCheckoutHold(h.db,s.companyId,s.userId,key(910+i),NOW)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    for(const r of results.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'ACTIVE_HOLD_EXISTS');
  });
});
describe('T01 hard limit at the end of an automatic tier',()=>{
  let h;before(async()=>{h=await freshDb();});after(()=>h.dispose());
  test('5 free places and 30 buyers: exactly 5 reservations, the rest refused, capacity stays 1500',async()=>{
    await fillPaid(h.db,1,1345);
    const sellers=await Promise.all(Array.from({length:30},()=>seedCompany(h.db)));
    const results=await Promise.allSettled(sellers.map((s,i)=>inv.createCheckoutHold(h.db,s.companyId,s.userId,key(i),NOW)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,5);
    assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='PHASE_PENDING'));
    const c=await h.db.prepare(`SELECT COUNT(*) total,SUM(status='held') held FROM slots`).first();
    assert.equal(c.total,1500);assert.equal(c.held,5);
    await assert.rejects(h.db.prepare(`INSERT INTO slots(number,phase,price_usd_cents) VALUES(1501,4,506600)`).run());
    await assert.rejects(h.db.prepare(`DELETE FROM slots WHERE number=1`).run());
  });
});
describe('T02 two confirmations cannot take one position',()=>{
  let h;before(async()=>{h=await freshDb();});after(()=>h.dispose());
  test('concurrent conversions and duplicate conversions settle on distinct ascending numbers',async()=>{
    const buyers=await Promise.all(Array.from({length:12},()=>seedCompany(h.db)));
    const holds=await Promise.all(buyers.map((s,i)=>inv.createCheckoutHold(h.db,s.companyId,s.userId,key(i),NOW)));
    const ids=await Promise.all(holds.map((hold,i)=>attemptFor(h.db,hold,buyers[i])));
    // Every attempt confirmed twice at the same moment.
    const results=await Promise.all([...ids,...ids].map(id=>inv.convertHold(h.db,id,NOW)));
    assert.equal(results.filter(r=>r.outcome==='assigned').length,12);
    const assigned=results.filter(r=>r.outcome==='assigned').map(r=>r.slotNumber).sort((a,b)=>a-b);
    assert.deepEqual(assigned,Array.from({length:12},(_,i)=>i+1));
    const rows=await h.db.prepare(`SELECT COUNT(*) n,COUNT(DISTINCT company_id) c FROM slots WHERE status='assigned'`).first();
    assert.equal(rows.n,12);assert.equal(rows.c,12);
    assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM slots WHERE status='held'`).first()).n,0);
  });
  test('Decision 31: the number follows the order of confirmation, not of reservation',async()=>{
    const [a,b]=await Promise.all([seedCompany(h.db),seedCompany(h.db)]);
    const ha=await inv.createCheckoutHold(h.db,a.companyId,a.userId,key(100),NOW);
    const hb=await inv.createCheckoutHold(h.db,b.companyId,b.userId,key(101),NOW);
    const ia=await attemptFor(h.db,ha,a),ib=await attemptFor(h.db,hb,b);
    const second=await inv.convertHold(h.db,ib,NOW);const first=await inv.convertHold(h.db,ia,NOW);
    assert.equal(second.outcome,'assigned');assert.equal(first.outcome,'assigned');
    assert.ok(second.slotNumber<first.slotNumber,'the buyer who confirmed first holds the lower number');
  });
});
describe('T03 founders consume real inventory inside tier 1',()=>{
  let h,admin;before(async()=>{h=await freshDb();admin=await seedCompany(h.db);
    await h.db.prepare(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,?)`).bind(admin.userId,NOW.toISOString(),'test').run();});after(()=>h.dispose());
  test('a founder takes the next ascending number; paid and founder numbers mix, so a number reveals nothing',async()=>{
    const paid=await seedCompany(h.db);const hold=await inv.createCheckoutHold(h.db,paid.companyId,paid.userId,key(1),NOW);
    assert.equal((await inv.convertHold(h.db,await attemptFor(h.db,hold,paid),NOW)).slotNumber,1);
    const f=await seedCompany(h.db);
    const invite=await adm.inviteFounder(h.db,admin.userId,f.companyId,NOW);
    await assert.rejects(adm.acceptFounderInvitation(h.db,invite.invitationId,paid.userId,NOW),e=>e.code==='INVITATION_NOT_FOUND');
    const award=await adm.acceptFounderInvitation(h.db,invite.invitationId,f.userId,NOW,'terms-1');
    assert.equal(award.slotNumber,2);
    const stats=await pub.getPublicStats(h.db);assert.equal(stats.occupied,2);assert.equal(stats.available,1498);
    assert.equal(JSON.stringify(stats).includes('founder'),false,'public stats never mention founders');
    await assert.rejects(adm.acceptFounderInvitation(h.db,invite.invitationId,f.userId,NOW),e=>e.code==='INVITATION_EXPIRED');
    await assert.rejects(inv.createCheckoutHold(h.db,f.companyId,f.userId,key(2),NOW),e=>e.code==='ALREADY_ALLOCATED');
  });
  test('invitation expires after 7 days; a pending invitation consumes nothing',async()=>{
    const f=await seedCompany(h.db);const before=(await pub.getPublicStats(h.db)).available;
    const invite=await adm.inviteFounder(h.db,admin.userId,f.companyId,NOW);
    assert.equal((await pub.getPublicStats(h.db)).available,before);
    await assert.rejects(adm.acceptFounderInvitation(h.db,invite.invitationId,f.userId,new Date(NOW.getTime()+7*86400000+1000)),e=>e.code==='INVITATION_EXPIRED');
  });
  test('Decision 34: a revoked founder place returns to inventory before publication',async()=>{
    const f=await seedCompany(h.db);const invite=await adm.inviteFounder(h.db,admin.userId,f.companyId,NOW);
    const award=await adm.acceptFounderInvitation(h.db,invite.invitationId,f.userId,NOW);
    const r=await adm.revokeFounderAward(h.db,admin.userId,f.companyId,'inactive','case-1',NOW);
    assert.equal(r.positionReleased,award.slotNumber);
    const slot=await h.db.prepare(`SELECT status,company_id FROM slots WHERE number=?`).bind(award.slotNumber).first();
    assert.equal(slot.status,'available');assert.equal(slot.company_id,null);
  });
});
describe('T03 caps: 100 founders and 500 paid in tier 1',()=>{
  let h,admin;before(async()=>{h=await freshDb();admin=await seedCompany(h.db);
    await h.db.prepare(`INSERT INTO platform_admins(user_id,granted_at,granted_by) VALUES(?,?,?)`).bind(admin.userId,NOW.toISOString(),'test').run();});after(()=>h.dispose());
  test('after 500 paid, checkout stops though 100 places remain, and tier 2 does not open',async()=>{
    await fillPaid(h.db,1,500);
    const s=await seedCompany(h.db);
    await assert.rejects(inv.createCheckoutHold(h.db,s.companyId,s.userId,key(1),NOW),e=>e.code==='PAID_CAPACITY_PENDING_FOUNDERS');
    const stats=await pub.getPublicStats(h.db);
    assert.equal(stats.salesMode,'awaiting_founder_allocation');assert.equal(stats.currentPhase,1);assert.equal(stats.checkoutOpen,false);
    assert.equal(stats.available,1000);
    await assert.rejects(h.db.prepare(`UPDATE slots SET status='held' WHERE number=501`).run(),/phase 1 paid capacity/);
  });
  test('founders can still take those places, and the 101st is refused',async()=>{
    // 99 awards seeded directly, then the real path for the rest.
    for(let n=501;n<=599;n++){
      const f=await seedCompany(h.db);
      await h.db.batch([h.db.prepare(`UPDATE slots SET status='assigned',assignment_kind='founder',company_id=? WHERE number=?`).bind(f.companyId,n),
        h.db.prepare(`INSERT INTO founder_awards(id,slot_number,company_id,approved_by,awarded_at) VALUES(?,?,?,?,?)`).bind(`f${n}`,n,f.companyId,admin.userId,NOW.toISOString())]);
    }
    const f100=await seedCompany(h.db);const inv100=await adm.inviteFounder(h.db,admin.userId,f100.companyId,NOW);
    const f101=await seedCompany(h.db);const inv101=await adm.inviteFounder(h.db,admin.userId,f101.companyId,NOW);
    const award=await adm.acceptFounderInvitation(h.db,inv100.invitationId,f100.userId,NOW);
    assert.equal(award.slotNumber,600);
    await assert.rejects(adm.acceptFounderInvitation(h.db,inv101.invitationId,f101.userId,NOW),e=>e.code==='FOUNDER_INVENTORY_EXHAUSTED');
    assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM founder_awards WHERE status='active'`).first()).n,100);
    const stats=await pub.getPublicStats(h.db);
    assert.equal(stats.currentPhase,2);assert.equal(stats.currentPriceUsdCents,40000);assert.equal(stats.salesMode,'selling');
  });
});
describe('T04 tier changes respect prices',()=>{
  const cases=[[600,1,10000,false],[601,2,40000,true],[1050,2,40000,false],[1051,3,100000,true],[1350,3,100000,false]];
  for(const [number,phase,price] of cases){
    test(`position ${number}: tier ${phase}, ${price} cents`,async()=>{
      const h=await freshDb();try{
        // Founders are complete when the boundary is above tier 1.
        if(number>600){await fillFounder(h.db,1,100);await fillPaid(h.db,101,number-1);}
        else {await fillFounder(h.db,1,100);await fillPaid(h.db,101,number-1);}
        const s=await seedCompany(h.db);
        const hold=await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(1),NOW);
        assert.equal(hold.phase,phase);assert.equal(hold.priceUsdCents,price);
        const row=await h.db.prepare(`SELECT slot_number FROM slot_holds WHERE id=?`).bind(hold.holdId).first();
        assert.equal(row.slot_number,number);
      }finally{await h.dispose();}
    });
  }
  test('tiers are strict: a live reservation keeps the next tier closed; Decision 39',async()=>{
    const h=await freshDb();try{
      await fillFounder(h.db,1,100);await fillPaid(h.db,101,599);
      const a=await seedCompany(h.db),b=await seedCompany(h.db);
      await inv.createCheckoutHold(h.db,a.companyId,a.userId,key(1),NOW);
      await assert.rejects(inv.createCheckoutHold(h.db,b.companyId,b.userId,key(2),NOW),e=>e.code==='PHASE_PENDING');
      assert.equal((await pub.getPublicStats(h.db)).currentPhase,1);
    }finally{await h.dispose();}
  });
  test('position 1351 onward: Premium has no checkout',async()=>{
    const h=await freshDb();try{
      await fillPaid(h.db,1,1350);
      const s=await seedCompany(h.db);
      await assert.rejects(inv.createCheckoutHold(h.db,s.companyId,s.userId,key(1),NOW),e=>e.code==='PREMIUM_ADMISSION_REQUIRED');
      const stats=await pub.getPublicStats(h.db);
      assert.equal(stats.salesMode,'premium_admission');assert.equal(stats.checkoutOpen,false);assert.equal(stats.currentPriceUsdCents,506600);
      await assert.rejects(h.db.prepare(`UPDATE slots SET status='held' WHERE number=1351`).run(),/premium positions have no checkout/);
    }finally{await h.dispose();}
  });
  test('Decisions 40-41: a released place reopens its tier at its original price without touching live holds',async()=>{
    const h=await freshDb();try{
      await fillFounder(h.db,1,100);await fillPaid(h.db,101,600);
      const a=await seedCompany(h.db),b=await seedCompany(h.db);
      const upper=await inv.createCheckoutHold(h.db,a.companyId,a.userId,key(1),NOW);
      assert.equal(upper.priceUsdCents,40000);
      await h.db.prepare(`UPDATE slots SET status='available',assignment_kind=NULL WHERE number=300`).run();
      const lower=await inv.createCheckoutHold(h.db,b.companyId,b.userId,key(2),NOW);
      assert.equal(lower.priceUsdCents,10000);
      const still=await h.db.prepare(`SELECT status FROM slot_holds WHERE id=?`).bind(upper.holdId).first();
      assert.equal(still.status,'active');
    }finally{await h.dispose();}
  });
});
describe('T05 and T14: expiry and archive',()=>{
  test('an expired reservation gives no right to a position, and frees it',async()=>{
    const h=await freshDb();try{
      const s=await seedCompany(h.db),t=await seedCompany(h.db);
      const hold=await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(1),NOW);
      const id=await attemptFor(h.db,hold,s);
      const later=new Date(NOW.getTime()+20*60000+1);
      assert.deepEqual(await inv.convertHold(h.db,id,later),{outcome:'hold_not_active'});
      const other=await inv.createCheckoutHold(h.db,t.companyId,t.userId,key(2),later);
      assert.equal((await h.db.prepare(`SELECT slot_number n FROM slot_holds WHERE id=?`).bind(other.holdId).first()).n,1);
      assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM slots WHERE status='assigned'`).first()).n,0);
      await assert.rejects(inv.createCheckoutHold(h.db,s.companyId,s.userId,key(1),later),e=>e.code==='HOLD_EXPIRED');
    }finally{await h.dispose();}
  });
  test('hold lasts exactly 20 minutes',async()=>{
    const h=await freshDb();try{const s=await seedCompany(h.db);
      const hold=await inv.createCheckoutHold(h.db,s.companyId,s.userId,key(1),NOW);
      assert.equal(new Date(hold.expiresAt)-new Date(hold.createdAt),20*60000);
      assert.equal('slotNumber' in hold,false,'a position number is only given on confirmation (Decision 30)');
    }finally{await h.dispose();}
  });
  test('T14 archive mode: nothing can be bought once every position is consumed; reading still works',async()=>{
    const h=await freshDb();try{
      await fillPaid(h.db,1,1500);
      const s=await seedCompany(h.db);
      await assert.rejects(inv.createCheckoutHold(h.db,s.companyId,s.userId,key(1),NOW),e=>e.code==='SALES_CLOSED');
      const stats=await pub.getPublicStats(h.db);
      assert.equal(stats.salesMode,'closed_archive');assert.equal(stats.checkoutOpen,false);assert.equal(stats.currentPhase,null);assert.equal(stats.available,0);
      assert.ok(stats.phases.every(p=>p.status==='sold_out'));
      const directory=await core('directory').listPublishedCompanies(h.db,{page:1});
      assert.equal(directory.total,0);
    }finally{await h.dispose();}
  });
});
