// เทส "คิวงานของฉัน" — ล็อกกฎการแบ่ง 3 ชั้น (2026-09-25)
// ⚠️ ตัวเลข/รูปแบบแถวในไฟล์นี้ถอดจากข้อมูลจริงที่วัดวันที่เขียน ไม่ใช่ตัวอย่างสมมติ
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER, CAP, ageDays, isMe, moWaitingOn, inMyScope, buildQueue,
  badgeCount, capped, EMPTY_TEXT,
} from '../myQueue.js';

const ME = { uid: 'uid-me', name: 'สมชาย ใจดี', sections: ['PD3'] };
const NOW = new Date('2026-09-25T10:00:00+07:00');

/* แถวใบซ่อมขั้นต่ำที่ทำให้ isMtnFormRow() = false (ฟอร์ม JIG/DIE 7 ขั้น) */
const mo = (o) => ({ id: 'x', mo_no: 'MO-001', work_date: '2026-09-16', dept_section: 'PD3', mtn_dept: '', item_type: '', ...o });

// ── ageDays ────────────────────────────────────────────────────────────────
test('ageDays — วันที่อ่านไม่ออก/ว่าง ต้องคืน null ไม่ใช่ 0', () => {
  assert.equal(ageDays('2026-09-18', NOW), 7);
  assert.equal(ageDays(null), null);
  assert.equal(ageDays('ไม่ใช่วันที่'), null);
});

test('ageDays — วันในอนาคตคืน 0 ไม่ติดลบ', () => {
  assert.equal(ageDays('2026-09-30', NOW), 0);
});

// ── isMe ───────────────────────────────────────────────────────────────────
test('isMe — uid ชนะชื่อ (สะกดต่างแต่ uid ตรง = ตัวเรา)', () => {
  assert.equal(isMe({ uid: 'uid-me', name: 'สมชาย  ใจดีี' }, ME), true);
});

test('isMe — ไม่มี uid ก็ยังเทียบชื่อแบบ normalize ได้ (คำนำหน้า/ช่องว่างซ้ำ)', () => {
  assert.equal(isMe({ uid: null, name: 'นายสมชาย  ใจดี' }, ME), true);
});

test('🔴 isMe — ไม่มีทั้ง uid และชื่อ ต้องเป็น false (ไม่รู้ ≠ ใช่)', () => {
  assert.equal(isMe({ uid: null, name: null }, ME), false);
  assert.equal(isMe({ uid: null, name: '' }, ME), false);
});

test('isMe — uid คนละตัว = คนละคน แม้ชื่อพ้องกัน (เคสจริง: ธวัช พิมพ์วงศ์ มี 2 บัญชี)', () => {
  assert.equal(isMe({ uid: 'uid-other', name: 'สมชาย ใจดี' }, ME), false);
});

// ── moWaitingOn — ห้าม hardcode เลขขั้น ────────────────────────────────────
test('moWaitingOn — ขั้นตรวจรับงาน รอ "ผู้เปิดใบ" ไม่ใช่ผู้ตรวจรับ', () => {
  // เคสจริง 25/09: 168 ใบค้างขั้นนี้ เฉลี่ย 9.3 วัน · ชื่อในช่อง checker ถูกกรอกทีหลัง
  const w = moWaitingOn(mo({ current_step: 4, reporter_prod: 'สมชาย ใจดี', checker_name: 'คนอื่น' }));
  assert.equal(w.byName, true);
  assert.equal(w.who.name, 'สมชาย ใจดี');
  assert.equal(w.meta.stage, 'accept_work');
});

test('moWaitingOn — ขั้นลงมือซ่อม รอช่างที่ถูกมอบหมาย', () => {
  const w = moWaitingOn(mo({ current_step: 3, assigned_to: 'ช่าง ก', tech_main_uid: 'uid-tech' }));
  assert.equal(w.meta.stage, 'service');
  assert.equal(w.who.uid, 'uid-tech');
});

test('🔴 moWaitingOn — ขั้นที่รอ "ตำแหน่ง" ต้องคืน who = null (ห้ามเดาเป็นตัวคน)', () => {
  for (const step of [2, 5, 7]) {
    const w = moWaitingOn(mo({ current_step: step }));
    assert.equal(w.who, null, `ขั้น ${step} ไม่ควรผูกตัวบุคคล`);
    assert.equal(w.byName, false);
  }
});

test('moWaitingOn — ใบขั้น 1 (ยังไม่เข้าลูป) คืน meta = null', () => {
  assert.equal(moWaitingOn(mo({ current_step: 1 })).meta, null);
});

// ── inMyScope ──────────────────────────────────────────────────────────────
test('inMyScope — sections ว่าง = ไม่จำกัด เห็นทุกส่วนงาน', () => {
  assert.equal(inMyScope({ dept_section: 'PD1' }, { sections: [] }), true);
});

test('inMyScope — เทียบแบบ normalize (ช่องว่าง/ตัวพิมพ์)', () => {
  assert.equal(inMyScope({ dept_section: ' pd3 ' }, ME), true);
  assert.equal(inMyScope({ dept_section: 'PD1' }, ME), false);
});

test('🔴 inMyScope — ใบที่ไม่ระบุส่วนงาน ต้องไม่ถูกนับเป็นของเรา', () => {
  assert.equal(inMyScope({ dept_section: null }, ME), false);
});

// ── buildQueue ─────────────────────────────────────────────────────────────
const EMPTY_SRC = { mo: [], sessions: [], fourM: [], actions: [], summaries: [] };

test('buildQueue — ใบที่รอเราเข้าชั้น mine · ใบส่วนงานเดียวกันเข้าชั้น unit', () => {
  const q = buildQueue({
    ...EMPTY_SRC,
    mo: [
      mo({ id: 'a', current_step: 4, reporter_prod_uid: 'uid-me' }),
      mo({ id: 'b', current_step: 4, reporter_prod: 'คนอื่น ในแผนก' }),
    ],
  }, ME, NOW);
  assert.deepEqual(q.mine.map(x => x.key), ['mo:a']);
  assert.deepEqual(q.unit.map(x => x.key), ['mo:b']);
});

test('buildQueue — ใบนอกส่วนงานเรา และไม่ได้รอเรา ต้องไม่โผล่เลย', () => {
  const q = buildQueue({ ...EMPTY_SRC, mo: [mo({ id: 'c', current_step: 4, dept_section: 'PD1', reporter_prod: 'คนอื่น' })] }, ME, NOW);
  assert.equal(q.mine.length + q.unit.length, 0);
});

test('🔴 buildQueue — เรียงเก่าสุดขึ้นก่อน', () => {
  const q = buildQueue({
    ...EMPTY_SRC,
    mo: [
      mo({ id: 'new', current_step: 4, reporter_prod_uid: 'uid-me', work_date: '2026-09-24' }),
      mo({ id: 'old', current_step: 4, reporter_prod_uid: 'uid-me', work_date: '2026-09-01' }),
    ],
  }, ME, NOW);
  assert.deepEqual(q.mine.map(x => x.key), ['mo:old', 'mo:new']);
});

test('🔴 buildQueue — ก้อนที่โหลดไม่สำเร็จต้องติด partial (ห้ามเงียบแล้วขึ้นว่าไม่มีงาน)', () => {
  const q = buildQueue({ mo: undefined, sessions: [], fourM: [], actions: [] }, ME, NOW);
  assert.equal(q.partial, true);
  assert.deepEqual(q.missing, ['mo']);
});

test('buildQueue — ส่ง [] (โหลดสำเร็จแต่ไม่มีแถว) ต้องไม่ถือว่า partial', () => {
  const q = buildQueue(EMPTY_SRC, ME, NOW);
  assert.equal(q.partial, false);
  assert.equal(q.counts.mine, 0);
});

test('🔴 buildQueue — ชั้นโรงงานต้องเป็นบรรทัดสรุป ไม่แตกรายตัว', () => {
  // ใบขอซื้อค้าง 6,743 รายการ (ตัวระเบิดความต้องการสร้างเอง) — แตกรายตัว = คิวไร้ความหมาย
  const q = buildQueue({
    ...EMPTY_SRC,
    summaries: [{ key: 'pr', icon: '🧾', title: 'ใบขอซื้อรอสั่งซื้อ', count: 6743, to: '/line-stock' }],
  }, ME, NOW);
  assert.equal(q.floor.length, 1);
  assert.equal(q.floor[0].count, 6743);
  assert.equal(q.counts.mine, 0);      // ต้องไม่ไหลไปชั้นอื่น
  assert.equal(q.counts.unit, 0);
});

test('buildQueue — สรุปที่ count = 0 ต้องไม่โผล่', () => {
  const q = buildQueue({ ...EMPTY_SRC, summaries: [{ key: 'pr', title: 'x', count: 0 }] }, ME, NOW);
  assert.equal(q.floor.length, 0);
});

test('buildQueue — งานที่มอบหมายชื่อเรา เข้าชั้น mine · ของคนอื่นในแผนกเข้า unit', () => {
  const q = buildQueue({
    ...EMPTY_SRC,
    actions: [
      { id: 1, problem: 'แก้จิ๊กเอียง', assignee_uid: 'uid-me', status: 'open', section: 'PD3' },
      { id: 2, problem: 'ทำ WI ใหม่', assignee: 'คนอื่น', status: 'doing', section: 'PD3' },
    ],
  }, ME, NOW);
  assert.deepEqual(q.mine.map(x => x.key), ['act:1']);
  assert.deepEqual(q.unit.map(x => x.key), ['act:2']);
});

// ── badge ──────────────────────────────────────────────────────────────────
test('🔴 badgeCount — นับเฉพาะชั้น "รอเราจริงๆ" ไม่รวมคิวแผนก/โรงงาน', () => {
  const q = buildQueue({
    ...EMPTY_SRC,
    mo: [mo({ id: 'a', current_step: 4, reporter_prod_uid: 'uid-me' }),
         mo({ id: 'b', current_step: 4, reporter_prod: 'คนอื่น' })],
    summaries: [{ key: 'pr', title: 'ใบขอซื้อ', count: 6743 }],
  }, ME, NOW);
  assert.equal(badgeCount(q), 1);
});

test('🔴 badgeCount — โหลดไม่ครบ ต้องคืน 0 (ตัวเลขที่อาจผิดแย่กว่าไม่มีตัวเลข)', () => {
  assert.equal(badgeCount({ partial: true, counts: { mine: 9 } }), 0);
  assert.equal(badgeCount(null), 0);
});

test('badgeCount — ไม่มีงาน = 0 (จอต้องไม่วาดวงกลมที่มีเลข 0)', () => {
  assert.equal(badgeCount(buildQueue(EMPTY_SRC, ME, NOW)), 0);
});

// ── capped / ข้อความว่าง ───────────────────────────────────────────────────
test('capped — ตัดตามเพดานแล้วบอกจำนวนที่ซ่อน', () => {
  const list = Array.from({ length: CAP[TIER.MINE] + 3 }, (_, i) => ({ key: i }));
  const r = capped(list, TIER.MINE);
  assert.equal(r.shown.length, CAP[TIER.MINE]);
  assert.equal(r.hidden, 3);
});

test('capped — รับค่าที่ไม่ใช่ array ได้ ไม่ throw', () => {
  assert.deepEqual(capped(undefined, TIER.MINE), { shown: [], hidden: 0 });
});

test('🔴 ไม่มีงาน ต้องมีข้อความบอก ห้ามปล่อยว่าง (ผู้ใช้ต้องแยก "เคลียร์หมด" ออกจาก "จอพัง")', () => {
  assert.ok(EMPTY_TEXT[TIER.MINE].length > 0);
  assert.ok(EMPTY_TEXT[TIER.UNIT].length > 0);
});
