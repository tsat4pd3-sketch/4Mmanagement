// เทส "คิวงานของฉัน" — ล็อกกฎการแบ่ง 3 ชั้น (2026-09-25)
// ⚠️ ตัวเลข/รูปแบบแถวในไฟล์นี้ถอดจากข้อมูลจริงที่วัดวันที่เขียน ไม่ใช่ตัวอย่างสมมติ
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER, CAP, ageDays, dayKeyBack, isMe, moWaitingOn, inMyScope, scopeStateOf, buildQueue,
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
  const w = moWaitingOn(mo({ status: 'repaired', current_step: 3, reporter_prod: 'สมชาย ใจดี', checker_name: 'คนอื่น' }));
  assert.equal(w.byName, true);
  assert.equal(w.who.name, 'สมชาย ใจดี');
  assert.equal(w.meta.stage, 'accept_work');
});

test('moWaitingOn — ขั้นลงมือซ่อม รอช่างที่ถูกมอบหมาย', () => {
  const w = moWaitingOn(mo({ status: 'assigned', current_step: 2, assigned_to: 'ช่าง ก', tech_main_uid: 'uid-tech' }));
  assert.equal(w.meta.stage, 'service');
  assert.equal(w.who.uid, 'uid-tech');
});

test('🔴 moWaitingOn — ขั้นที่รอ "ตำแหน่ง" ต้องคืน who = null (ห้ามเดาเป็นตัวคน)', () => {
  for (const [status, step] of [['pending', 2], ['checked', 5], ['handover', 7]]) {
    const w = moWaitingOn(mo({ status, current_step: step - 1 }));
    assert.equal(w.step, step);
    assert.equal(w.who, null, `ขั้น ${step} ไม่ควรผูกตัวบุคคล`);
    assert.equal(w.byName, false);
  }
});

test('moWaitingOn — ใบปิด/ตีกลับ (ไม่อยู่ในลูป) คืน meta = null', () => {
  assert.equal(moWaitingOn(mo({ status: 'closed', current_step: 7 })).meta, null);
  assert.equal(moWaitingOn(mo({ status: 'returned', current_step: 1 })).meta, null);
});

test('🔴 moWaitingOn — ขั้นรอ = ขั้น "ถัดไป" จาก status ไม่ใช่ current_step (workflow audit 05/10)', () => {
  // current_step = ขั้นที่ทำเสร็จแล้ว · ใบที่ผู้แจ้งตรวจรับแล้ว (checked, current_step 4) ต้องรอ QA ไม่ใช่รอผู้แจ้งอีก
  const w = moWaitingOn(mo({ status: 'checked', current_step: 4, reporter_prod_uid: 'uid-me' }));
  assert.equal(w.step, 5);
  assert.equal(w.meta.stage, 'qa');
  assert.equal(w.byName, false);
  // ใบเพิ่งเปิด (current_step 1) = รอจ่ายงาน — เดิมถูกตัดทิ้งไม่โผล่ที่ไหนเลย
  assert.equal(moWaitingOn(mo({ status: 'pending', current_step: 1 })).meta.stage, 'assign');
  // QA กดข้ามแล้ว = รอรับมอบ (ขั้น 6) ไม่ค้างที่ QA
  assert.equal(moWaitingOn(mo({ status: 'checked', current_step: 4, qa_skipped_at: '2026-10-01T01:00:00Z' })).step, 6);
});

test('🔴 buildQueue — ใบรอ QA ต้องไม่โผล่ในชั้น "รอคุณโดยตรง" ของผู้แจ้งที่ตรวจรับไปแล้ว', () => {
  const q = buildQueue({ ...EMPTY_SRC, mo: [mo({ id: 'q', status: 'checked', current_step: 4, reporter_prod_uid: 'uid-me' })] }, ME, NOW);
  assert.equal(q.mine.length, 0);
  assert.deepEqual(q.unit.map(x => x.key), ['mo:q']);
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
      mo({ id: 'a', status: 'repaired', current_step: 3, reporter_prod_uid: 'uid-me' }),
      mo({ id: 'b', status: 'repaired', current_step: 3, reporter_prod: 'คนอื่น ในแผนก' }),
    ],
  }, ME, NOW);
  assert.deepEqual(q.mine.map(x => x.key), ['mo:a']);
  assert.deepEqual(q.unit.map(x => x.key), ['mo:b']);
});

test('buildQueue — ใบนอกส่วนงานเรา และไม่ได้รอเรา ต้องไม่โผล่เลย', () => {
  const q = buildQueue({ ...EMPTY_SRC, mo: [mo({ id: 'c', status: 'repaired', current_step: 3, dept_section: 'PD1', reporter_prod: 'คนอื่น' })] }, ME, NOW);
  assert.equal(q.mine.length + q.unit.length, 0);
});

test('🔴 buildQueue — เรียงเก่าสุดขึ้นก่อน', () => {
  const q = buildQueue({
    ...EMPTY_SRC,
    mo: [
      mo({ id: 'new', status: 'repaired', current_step: 3, reporter_prod_uid: 'uid-me', work_date: '2026-09-24' }),
      mo({ id: 'old', status: 'repaired', current_step: 3, reporter_prod_uid: 'uid-me', work_date: '2026-09-01' }),
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
    mo: [mo({ id: 'a', status: 'repaired', current_step: 3, reporter_prod_uid: 'uid-me' }),
         mo({ id: 'b', status: 'repaired', current_step: 3, reporter_prod: 'คนอื่น' })],
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

/* ── 🔴 แถวที่ "ชี้ส่วนงานไม่ได้" ต้องถูกนับ ไม่ใช่หายเงียบ (2026-10-06) ──────────────
   วัดจริงบน DR 06/10: ใบรอ QA 188 ใบ — 152 ใบผูก PD3 แต่ **36 ใบ `dept_section` ว่าง**
   `inMyScope` คืน false ทั้ง "ของหน่วยอื่น" และ "ไม่ระบุส่วนงาน" เหมือนกัน
   ⇒ 36 ใบนั้นตกจากคิวของทุกคนทั้งโรงงานโดยไม่มีสัญญาณ (ขัดกฎ "ห้ามล้มเหลวเงียบ") */
test('scopeStateOf — แยก "ของหน่วยอื่น" ออกจาก "ไม่ระบุส่วนงาน" ห้ามยุบเป็น false เดียว', () => {
  assert.equal(scopeStateOf({ dept_section: 'PD3' }, ME), 'in');
  assert.equal(scopeStateOf({ dept_section: 'PD1' }, ME), 'other');
  assert.equal(scopeStateOf({ dept_section: null }, ME), 'unknown');
  assert.equal(scopeStateOf({ dept_section: '  ' }, ME), 'unknown');
  assert.equal(scopeStateOf({ dept_section: null }, { sections: [] }), 'in',
    'ไม่จำกัดขอบเขต = เห็นหมด ไม่ต้องนับว่าชี้ไม่ได้');
});

test('inMyScope — พฤติกรรมเดิมเป๊ะหลังยืมคำตอบจาก scopeStateOf', () => {
  assert.equal(inMyScope({ dept_section: ' pd3 ' }, ME), true);
  assert.equal(inMyScope({ dept_section: 'PD1' }, ME), false);
  assert.equal(inMyScope({ dept_section: null }, ME), false);
  assert.equal(inMyScope({ dept_section: 'PD1' }, { sections: [] }), true);
});

test('buildQueue — นับ unattributed แยกจาก "ของหน่วยอื่น" · ของหน่วยอื่นห้ามถูกนับ', () => {
  const q = buildQueue({
    mo: [
      { id: 'a', status: 'checked', mtn_dept: 'production', dept_section: 'PD3' },  // ของเรา
      { id: 'b', status: 'checked', mtn_dept: 'production', dept_section: 'PD1' },  // หน่วยอื่น
      { id: 'c', status: 'checked', mtn_dept: 'production', dept_section: null },   // ชี้ไม่ได้
      { id: 'd', status: 'checked', mtn_dept: 'production', dept_section: '' },     // ชี้ไม่ได้
    ],
    sessions: [], fourM: [], actions: [],
  }, ME);
  assert.equal(q.unattributed, 2, 'นับเฉพาะใบที่ไม่ระบุส่วนงาน');
  assert.equal(q.counts.unit, 1, 'ใบของหน่วยอื่นไม่เข้าคิว และไม่ถูกนับเป็น unattributed');
  assert.equal(q.partial, false, 'คิวรีไม่ได้ล่ม ⇒ ห้ามติด partial');
});

test('buildQueue — ไม่จำกัดขอบเขต = unattributed ต้องเป็น 0 (ห้ามเตือนหมาหอน)', () => {
  const q = buildQueue({
    mo: [{ id: 'c', status: 'checked', mtn_dept: 'production', dept_section: null }],
    sessions: [], fourM: [], actions: [],
  }, { uid: 'u1', name: 'x', sections: [] });
  assert.equal(q.unattributed, 0);
  assert.equal(q.counts.unit, 1, 'ไม่จำกัดขอบเขต = เห็นใบนั้นตามปกติ');
});

/* ── 🔴 ขั้นที่ "รอตำแหน่ง" ต้องสรุปในชั้น floor ไม่ใช่หายไปเลย (2026-10-06 · user เคาะ ข2) ──────
   ขั้น QA/จ่ายงาน/หัวหน้าแผนก ไม่มีเจ้าภาพรายใบ ⇒ เข้า `mine` ไม่ได้ ⇒ badge ไม่ขึ้น
   ⇒ เดิมไม่มีสัญญาณเลยว่ามีงานค้าง (วัดจริง: รอ QA 188 ใบ) · ห้ามแก้ด้วยการยัดเข้า `mine` */
test('floor — ใบ MO ที่รอตำแหน่ง ต้องสรุปบรรทัดเดียวต่อขั้น + นับทั้งโรงงานไม่กรองขอบเขต', () => {
  const q = buildQueue({
    mo: [
      { id: 'a', status: 'checked', mtn_dept: 'production', dept_section: 'PD3', work_date: '2026-09-01' },
      { id: 'b', status: 'checked', mtn_dept: 'production', dept_section: 'PD1', work_date: '2026-09-20' },
      { id: 'c', status: 'checked', mtn_dept: 'production', dept_section: null, work_date: '2026-09-10' },
      { id: 'd', status: 'pending', mtn_dept: 'production', dept_section: 'PD1', work_date: '2026-09-25' },
    ],
    sessions: [], fourM: [], actions: [],
  }, ME, new Date('2026-10-06T03:00:00Z'));
  const qa = q.floor.find(f => f.key.startsWith('mowait:'));
  assert.ok(qa, 'ต้องมีบรรทัดสรุปของขั้นที่รอตำแหน่ง');
  assert.equal(qa.count, 3, 'นับใบรอ QA ทั้งโรงงาน (รวมหน่วยอื่น + ใบที่ชี้ส่วนงานไม่ได้)');
  assert.match(qa.title, /3 ใบ/);
  assert.match(qa.detail, /ทั้งโรงงาน/);
  assert.match(qa.detail, /เก่าสุด/);
  assert.equal(q.floor.filter(f => f.key.startsWith('mowait:')).length, 2,
    'คนละขั้น (รอ QA / รอจ่ายงาน) = คนละบรรทัด ห้ามยุบรวม');
});

test('🔴 floor — บรรทัดสรุปนี้ห้ามขึ้น badge (badge นับเฉพาะ mine)', () => {
  const q = buildQueue({
    mo: [{ id: 'a', status: 'checked', mtn_dept: 'production', dept_section: 'PD3', work_date: '2026-09-01' }],
    sessions: [], fourM: [], actions: [],
  }, ME);
  assert.ok(q.floor.some(f => f.key.startsWith('mowait:')));
  assert.equal(q.counts.mine, 0);
  assert.equal(badgeCount(q), 0, 'กองที่ไม่มีเจ้าภาพรายใบ ห้ามทำให้ badge เด้ง');
});

test('floor — ไม่มีใบรอตำแหน่ง = ไม่มีบรรทัดสรุป (ห้ามวาดบรรทัดเลข 0)', () => {
  const q = buildQueue({ mo: [], sessions: [], fourM: [], actions: [] }, ME);
  assert.equal(q.floor.filter(f => f.key.startsWith('mowait:')).length, 0);
});

/* ── 🔴 เลขขั้นเดียวกันคนละ stage ⇒ ห้ามยุบเป็นกองเดียว (06/10) ────────────────────
   วัดจาก MTN_STEPS/MTN_FORM_STEPS จริง: **ขั้น 7 ชนกัน** — JIG/DIE = `close` (รอตำแหน่ง)
   · MTN = `mtn_approve` (รอตำแหน่ง) ⇒ ถ้าคีย์กองด้วยเลขขั้น 2 กองนี้ยุบเป็นบรรทัดเดียว
   แล้วได้ป้ายของฟอร์มที่มาถึงก่อน = จอโกหก (กฎ `stageOf` ใน CLAUDE.md: ห้ามตัดสินด้วยเลขขั้น)
   ⚠️ ขั้น 5 ไม่ชน (MTN ขั้น 5 = รับมอบ รอ "ตัวคน" จึงไม่เข้ากองสรุปตั้งแต่ต้น) */
test('🔴 floor — ขั้น 7 ที่ stage ต่างกัน (JIG=ปิดใบ / MTN=ผจก.ช่างอนุมัติ) ต้องแยกบรรทัด', () => {
  const q = buildQueue({
    mo: [
      { id: 'jig', status: 'handover', mtn_dept: 'jig_maintenance', dept_section: 'PD3', work_date: '2026-09-01' },
      { id: 'mtn', status: 'handover', mtn_dept: 'maintenance', dept_section: 'PD3', work_date: '2026-09-01',
        mtn_head_at: '2026-09-02T00:00:00Z', approve_at: null },
    ], sessions: [], fourM: [], actions: [],
  }, ME, new Date('2026-10-06T03:00:00Z'));
  const rows = q.floor.filter(f => f.key.startsWith('mowait:'));
  assert.equal(rows.length, 2, 'คนละ stage = คนละกอง ห้ามยุบด้วยเลขขั้น');
  assert.deepEqual(rows.map(r => r.key).sort(), ['mowait:close', 'mowait:mtn_approve'],
    'คีย์ต้องเป็น stage ไม่ใช่เลขขั้น');
});

test('floor — ลิงก์ต้องพาไปถึงกองนั้น: กรอง stage + ถอย from= ให้ครอบใบเก่าสุด', () => {
  const q = buildQueue({
    mo: [{ id: 'a', status: 'checked', mtn_dept: 'production', dept_section: 'PD3', work_date: '2026-09-26' }],
    sessions: [], fourM: [], actions: [],
  }, ME, new Date('2026-10-06T03:00:00Z'));
  const qa = q.floor.find(f => f.key === 'mowait:qa');
  assert.match(qa.to, /^\/mtn-repair\?tab=list&wait=qa&from=2026-09-26$/,
    'ต้องส่ง wait= + from= ที่ครอบใบเก่าสุด (ไม่งั้นตัวกรองวันที่ซ่อนใบค้างหมด)');
});

test('dayKeyBack — คิดวันไทยเองจาก epoch ห้ามพึ่ง timezone เครื่อง', () => {
  assert.equal(dayKeyBack(0, new Date('2026-10-06T03:00:00Z')), '2026-10-06', '03:00 UTC = 10:00 ไทย');
  assert.equal(dayKeyBack(0, new Date('2026-10-05T18:00:00Z')), '2026-10-06', '18:00 UTC = 01:00 ไทยของวันถัดไป');
  assert.equal(dayKeyBack(10, new Date('2026-10-06T03:00:00Z')), '2026-09-26');
  assert.equal(dayKeyBack(null, new Date('2026-10-06T03:00:00Z')), '2026-10-06', 'ไม่รู้จำนวนวัน = วันนี้');
});
