/* ทบทวน CT — "ระบบเสนอ วิศวกรตัดสิน" (2026-09-18)
   เทสนี้คุมสิ่งที่วิศวกรจะถูกขอให้อนุมัติ ⇒ พลาดตรงนี้ = CT มาตรฐานทั้งโรงงานเพี้ยน */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { median, percentile, observedCtOfOrder, summarizeObservedCt, SAMPLE_RULES } from '../ctReview.js';

const SESSION = { work_date: '2026-09-15', shift: 'day', start_time: '08:00:00', end_time: '20:00:00' };
const ord = (from, to, qty) => ({ opened_at: `2026-09-15T${from}:00`, confirmed_at: `2026-09-15T${to}:00`, qty_ok: qty });
const base = { session: SESSION, downtimes: [], breakPolicies: [], processType: null };

test('median — เลขคู่ต้องเฉลี่ยกลาง · เลขคี่ต้องเอาตัวกลาง · ว่าง = null', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test('🔴 median ต้องทนใบเดียวที่เพี้ยน (เหตุผลที่ห้ามใช้ค่าเฉลี่ย)', () => {
  const xs = [50, 51, 52, 53, 9999];
  assert.equal(median(xs), 52);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(mean > 2000, 'ค่าเฉลี่ยโดนลากไปไกล — นี่คือเหตุผลที่ใช้มัธยฐาน');
});

test('percentile — p25/p75 ต้องอยู่ในชุดข้อมูลจริง', () => {
  const xs = [10, 20, 30, 40];
  assert.equal(percentile(xs, 0.25), 10);
  assert.equal(percentile(xs, 0.75), 30);
  assert.equal(percentile([], 0.5), null);
});

test('CT จากใบเดียว — 1 ชม. ทำ 60 ชิ้น = 60 วินาที/ชิ้น', () => {
  assert.equal(observedCtOfOrder(ord('09:00', '10:00', 60), base), 60);
});

test('หัก downtime ที่ทับช่วงใบออกก่อน', () => {
  const dt = [{ started_at: '2026-09-15T09:10:00', ended_at: '2026-09-15T09:40:00', duration_min: 30 }];
  // 60 นาที − 30 นาที = 30 นาที ทำ 60 ชิ้น = 30 วินาที/ชิ้น
  assert.equal(observedCtOfOrder(ord('09:00', '10:00', 60), { ...base, downtimes: dt }), 30);
});

test('🔴 downtime ที่ทับเวลาพัก ห้ามหักซ้ำ (กฎเหล็ก oee.js §3.1)', () => {
  const policies = [{ shift: 'day', start_time: '09:10', duration_min: 30, process_type: null, ot_scope: 'always' }];
  const dt = [{ started_at: '2026-09-15T09:10:00', ended_at: '2026-09-15T09:40:00', duration_min: 30 }];
  // พัก 30 + DT 30 ที่ทับกันสนิท ⇒ ต้องหักครั้งเดียว = เหลือ 30 นาที ไม่ใช่ 0
  const ct = observedCtOfOrder(ord('09:00', '10:00', 60), { ...base, downtimes: dt, breakPolicies: policies });
  assert.equal(ct, 30, 'หักซ้ำจะได้ runMin = 0 แล้วคืน null');
});

test('🔴 ใบที่ยืนยันข้ามวัน ต้องถูกรัดในกะ ไม่งั้นได้ CT ช้าเกินจริงมหาศาล', () => {
  const late = { opened_at: '2026-09-15T19:00:00', confirmed_at: '2026-09-16T08:30:00', qty_ok: 60 };
  const ct = observedCtOfOrder(late, base);
  assert.equal(ct, 60, 'ต้องรัดเหลือ 19:00–20:00 = 60 วิ/ชิ้น ไม่ใช่ ~810');
});

test('ใบที่ทำน้อยชิ้นเกินเกณฑ์ ⇒ ไม่เอาเข้าตัวอย่าง (เวลาตั้งเครื่องกินสัดส่วนเยอะ)', () => {
  assert.equal(observedCtOfOrder(ord('09:00', '10:00', SAMPLE_RULES.MIN_QTY_PER_ORDER - 1), base), null);
});

test('ใบที่ข้อมูลเวลาไม่ครบ ⇒ null ไม่ใช่เดา', () => {
  assert.equal(observedCtOfOrder({ opened_at: '2026-09-15T09:00:00', qty_ok: 60 }, base), null);
  assert.equal(observedCtOfOrder({ confirmed_at: '2026-09-15T10:00:00', qty_ok: 60 }, base), null);
});

test('เวลาปิดก่อนเวลาเปิด ⇒ null (ไม่ระเบิด ไม่ได้ค่าติดลบ)', () => {
  assert.equal(observedCtOfOrder(ord('10:00', '09:00', 60), base), null);
});

/* ── สรุปต่อ MAT ───────────────────────────────────────────────────────── */
const rows = (n, from, to, qty) => Array.from({ length: n }, () => ({ order: ord(from, to, qty), session: SESSION, downtimes: [] }));

test('🔴 ตัวอย่างน้อยกว่าเกณฑ์ ⇒ ห้ามเสนอ', () => {
  const s = summarizeObservedCt('X', rows(SAMPLE_RULES.MIN_ORDERS - 1, '09:00', '10:00', 60), { ctStd: 60 });
  assert.equal(s.canPropose, false);
  assert.ok(s.flags.includes('few_samples'));
});

test('ตัวอย่างพอ + ต่างจากมาตรฐานจริง ⇒ เสนอได้', () => {
  // 1 ชม. ทำ 80 ชิ้น = 45 วิ/ชิ้น เทียบมาตรฐาน 60
  const s = summarizeObservedCt('X', rows(12, '09:00', '10:00', 80), { ctStd: 60 });
  assert.equal(s.n, 12);
  assert.equal(s.p50, 45);
  assert.equal(s.canPropose, true);
  assert.ok(Math.round(s.gapPct) === -25);
  assert.ok(s.flags.includes('big_gap'), 'ต่าง 25% ต้องขึ้นธงให้คนดูก่อน');
});

test('🔴 ใบที่ได้ CT เร็วผิดปกติ (ลายเซ็นของ DT เกินจริง) ต้องถูกตัดออก ไม่ลากค่าลง', () => {
  const good = rows(12, '09:00', '10:00', 60);                 // 60 วิ
  const bogus = rows(4, '09:00', '10:00', 6000);               // 0.6 วิ = เป็นไปไม่ได้
  const s = summarizeObservedCt('X', [...good, ...bogus], { ctStd: 60 });
  assert.equal(s.n, 12, 'ใบเป็นไปไม่ได้ต้องไม่อยู่ในตัวอย่าง');
  assert.equal(s.nTooFast, 4);
  assert.equal(s.p50, 60);
  assert.ok(s.flags.includes('dropped_impossible_fast'));
});

test('ใบที่ช้าผิดปกติ (ลืมปิดใบ) ต้องถูกตัดออกเหมือนกัน', () => {
  const s = summarizeObservedCt('X', [...rows(12, '09:00', '10:00', 60), ...rows(3, '09:00', '19:00', 6)], { ctStd: 60 });
  assert.equal(s.nTooSlow, 3);
  assert.equal(s.p50, 60);
});

test('ไม่มี CT มาตรฐาน ⇒ เสนอไม่ได้ (ไม่มีอะไรให้เทียบ) แต่ยังบอก p50 ได้', () => {
  const s = summarizeObservedCt('X', rows(12, '09:00', '10:00', 60), { ctStd: 0 });
  assert.equal(s.canPropose, false);
  assert.equal(s.p50, 60);
  assert.equal(s.gapPct, null);
});

test('ต่างจากมาตรฐานนิดเดียว ⇒ ไม่ต้องกวนวิศวกร', () => {
  const s = summarizeObservedCt('X', rows(12, '09:00', '10:00', 60), { ctStd: 60.2 });
  assert.equal(s.canPropose, false);
});

test('🛡️ ct_observed ต้องไม่ถูกนำไปใช้ในสูตร OEE ที่ไหนเลย', () => {
  const oee = readFileSync(new URL('../oee.js', import.meta.url), 'utf8');
  const dr  = readFileSync(new URL('../../pages/DailyReport.jsx', import.meta.url), 'utf8');
  for (const [name, src] of [['oee.js', oee], ['DailyReport.jsx', dr]]) {
    assert.ok(!/ctReview|ct_observed|observedCtOfOrder/.test(src),
      `\n\n❌ ${name} อ้างถึง CT ที่สังเกตได้\n`
      + '   สัญญาของโปรเจค: %P หารด้วย ct_standard (dr_products.cycle_time_sec) เสมอ\n'
      + '   ct_observed เป็นแค่ "ข้อเสนอ" ให้วิศวกรอนุมัติ ห้ามเข้าสูตรเอง\n');
  }
});
