// เทสอะไหล่ของแผน PM — src/utils/pmSpares.js · ตรึง todayStr ทุกเคส (กฎเทสระเบิดเวลา)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pmOccurrences, planReadiness, spareDemand, addDaysYmd } from '../pmSpares.js';

const TODAY = '2026-10-08';

test('pmOccurrences: รายสัปดาห์ใน 30 วัน = หลายครั้ง · เลยกำหนด = เริ่มวันนี้ · ไม่มีวัน = ว่าง', () => {
  assert.deepEqual(pmOccurrences({ dueYmd: '2026-10-10', cycleDays: 7, todayStr: TODAY, horizonDays: 30 }),
    ['2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31', '2026-11-07']);
  assert.deepEqual(pmOccurrences({ dueYmd: '2026-09-20', cycleDays: 30, todayStr: TODAY, horizonDays: 30 }),
    ['2026-10-08', '2026-11-07']);
  assert.deepEqual(pmOccurrences({ dueYmd: '2026-12-01', cycleDays: 30, todayStr: TODAY, horizonDays: 30 }), []);
  assert.deepEqual(pmOccurrences({ dueYmd: null, cycleDays: 7, todayStr: TODAY }), []);
  // วันที่กำหนดเองแต่ไม่มีรอบ = ครั้งเดียว
  assert.deepEqual(pmOccurrences({ dueYmd: '2026-10-15', cycleDays: null, todayStr: TODAY }), ['2026-10-15']);
  assert.equal(addDaysYmd('2026-10-31', 1), '2026-11-01');
});

test('planReadiness: พอ/ไม่พอ · ยังไม่ผูกอะไหล่ = null ไม่ใช่ "พร้อม" · อะไหล่ถูกลบ = ไม่พร้อม', () => {
  const parts = { a: { id: 'a', stock_qty: '4' }, b: { id: 'b', stock_qty: 0 } };
  const r = planReadiness([{ part_id: 'a', qty_per_pm: 2 }, { part_id: 'b', qty_per_pm: 1 }], parts);
  assert.equal(r.allOk, false);
  assert.equal(r.shortCount, 1);
  assert.equal(r.items[0].ok, true);
  assert.equal(planReadiness([], parts).allOk, null);
  assert.equal(planReadiness([{ part_id: 'x', qty_per_pm: 1 }], parts).items[0].missing, true);
});

test('spareDemand: รวมทุกครั้งที่ PM จะเกิด · หาวันแรกที่ขาด · ต้องสั่งภายใน = วันขาด − leadtime', () => {
  const parts = [
    { id: 'p1', name: 'ปลายเชื่อม', stock_qty: 5, min_qty: 2, lead_time_days: 14 },
    { id: 'p2', name: 'ซีลกระบอกลม', stock_qty: 10, min_qty: 8, lead_time_days: null },
  ];
  const plans = [
    { checklistId: 'c1', name: 'RB-55', dueYmd: '2026-10-10', cycleDays: 7 },    // 5 ครั้งใน 30 วัน
    { checklistId: 'c2', name: 'RB-56', dueYmd: '2026-10-20', cycleDays: 30 },   // 1 ครั้ง
    { checklistId: 'c3', name: 'SP-78', dueYmd: null, cycleDays: null },         // คาดไม่ได้
  ];
  const lines = [
    { checklist_id: 'c1', part_id: 'p1', qty_per_pm: 1 },
    { checklist_id: 'c2', part_id: 'p1', qty_per_pm: 2 },
    { checklist_id: 'c2', part_id: 'p2', qty_per_pm: 3 },
    { checklist_id: 'c3', part_id: 'p2', qty_per_pm: 1 },
  ];
  const d = spareDemand({ plans, lines, parts, todayStr: TODAY, horizonDays: 30 });
  const p1 = d.rows.find(r => r.part.id === 'p1');
  assert.equal(p1.needQty, 7);                 // 5×1 + 1×2
  assert.equal(p1.shortQty, 2);
  // สะสม: 10/10=1 · 17=2 · 20=4 · 24=5 · 31=6 > 5 ⇒ ขาดวันที่ 31/10
  assert.equal(p1.firstShortYmd, '2026-10-31');
  assert.equal(p1.orderByYmd, '2026-10-17');   // − 14 วัน
  assert.equal(p1.orderLate, false);
  const p2 = d.rows.find(r => r.part.id === 'p2');
  assert.equal(p2.shortQty, 0);
  assert.equal(p2.belowMin, true);             // เหลือ 7 < min 8
  assert.equal(p2.orderByYmd, null);           // ไม่ขาด
  assert.equal(d.rows[0].part.id, 'p1');       // ขาดขึ้นก่อน
  assert.equal(d.summary.noDuePlans, 1);       // SP-78 ห้ามหายเงียบ
  assert.equal(d.noDue[0].checklistId, 'c3');
});

test('spareDemand: ขาดตั้งแต่ PM แรกที่เลยกำหนด + leadtime ยาว = สั่งไม่ทันแล้ว (orderLate)', () => {
  const d = spareDemand({
    plans: [{ checklistId: 'c1', name: 'X', dueYmd: '2026-10-01', cycleDays: 90, estimate: true }],
    lines: [{ checklist_id: 'c1', part_id: 'p', qty_per_pm: 3 }],
    parts: [{ id: 'p', stock_qty: 1, lead_time_days: 30 }],
    todayStr: TODAY,
  });
  assert.equal(d.rows[0].firstShortYmd, TODAY);
  assert.equal(d.rows[0].orderLate, true);
  assert.equal(d.rows[0].estimate, true);
});
