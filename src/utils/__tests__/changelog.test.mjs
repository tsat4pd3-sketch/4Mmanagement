/* เทสกฎหน้า "อัพเดทโปรแกรม" (2026-10-01) — ล็อกเรื่องชนิด/ตะกร้ารับ/การจัดฟีด */
import test from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, kindOf, countByKind, buildFeed } from '../changelog.js';

const c = (o) => ({ h: 'h1', d: '2026-09-30', t: 'feat', s: null, m: 'ข้อความ', ...o });

test('kindOf — ชนิดที่รู้จักเข้าถังของตัวเอง', () => {
  assert.equal(kindOf('feat').key, 'feat');
  assert.equal(kindOf('FIX').key, 'fix');          // ไม่สนตัวพิมพ์
  assert.equal(kindOf('perf').key, 'tune');
  assert.equal(kindOf('refactor').key, 'tune');
  assert.equal(kindOf('docs').key, 'doc');
});

test('🔴 kindOf — ชนิดที่ไม่รู้จัก / ไม่มี prefix ต้องตกตะกร้าท้ายลิสต์ ห้ามคืน null (จะหายจากจอ)', () => {
  for (const v of [null, undefined, '', 'wip', 'migration', 'ชนิดแปลก']) {
    assert.equal(kindOf(v).key, 'other', `${v} ต้องเข้า other`);
  }
});

test('🔴 KINDS — ต้องมีตะกร้ารับ (types ว่าง) อยู่ตัวท้ายเสมอ', () => {
  assert.deepEqual(KINDS[KINDS.length - 1].types, []);
  assert.ok(KINDS.every(k => k.icon && k.label && k.color), 'ทุกชนิดต้องมี icon/label/สี');
});

test('countByKind — คืนทุกคีย์เสมอ แม้เป็น 0 (การ์ดบนจอต้องไม่กระพริบหาย)', () => {
  const n = countByKind([c({ t: 'feat' }), c({ t: 'fix' }), c({ t: 'wip' })]);
  assert.deepEqual(Object.keys(n).sort(), KINDS.map(k => k.key).sort());
  assert.equal(n.feat, 1); assert.equal(n.fix, 1); assert.equal(n.other, 1); assert.equal(n.doc, 0);
});

test('countByKind — ชุดว่าง = 0 ทุกช่อง ไม่ throw', () => {
  assert.equal(Object.values(countByKind([])).reduce((a, b) => a + b, 0), 0);
  assert.equal(Object.values(countByKind()).reduce((a, b) => a + b, 0), 0);
});

test('🔴 buildFeed — วันใหม่ขึ้นก่อน', () => {
  const f = buildFeed([c({ d: '2026-09-01' }), c({ d: '2026-09-30' }), c({ d: '2026-09-15' })]);
  assert.deepEqual(f.map(g => g.date), ['2026-09-30', '2026-09-15', '2026-09-01']);
});

test('buildFeed — กรองชนิด แล้ววันที่ไม่เหลือรายการต้องไม่โผล่เป็นหัวข้อเปล่า', () => {
  const f = buildFeed([c({ d: '2026-09-30', t: 'feat' }), c({ d: '2026-09-29', t: 'docs' })], { kind: 'feat' });
  assert.equal(f.length, 1);
  assert.equal(f[0].date, '2026-09-30');
});

test('buildFeed — ค้นได้ทั้งข้อความและเรื่อง (scope) · ช่องว่างซ้ำ/ตัวพิมพ์ไม่สำคัญ', () => {
  const rows = [c({ m: 'แก้  ปฏิทิน  บริษัท', s: 'oee' }), c({ m: 'เพิ่มคิวงาน', s: 'nav' })];
  assert.equal(buildFeed(rows, { q: 'ปฏิทิน บริษัท' })[0].items.length, 1);
  assert.equal(buildFeed(rows, { q: 'OEE' })[0].items.length, 1);
  assert.equal(buildFeed(rows, { q: 'ไม่มีคำนี้' }).length, 0);
});

test('buildFeed — แถวที่ไม่มีวันที่ ต้องถูกข้าม ไม่สร้างกลุ่มชื่อ undefined', () => {
  const f = buildFeed([c({ d: null }), c({ d: '2026-09-30' })]);
  assert.equal(f.length, 1);
  assert.equal(f[0].date, '2026-09-30');
});

test('buildFeed — ชุดว่าง/undefined = [] ไม่ throw', () => {
  assert.deepEqual(buildFeed([]), []);
  assert.deepEqual(buildFeed(), []);
});

// ── limitFeed — เพดานจำนวนที่วาด ──────────────────────────────────────────
import { limitFeed } from '../changelog.js';

const day = (d, n) => ({ date: d, items: Array.from({ length: n }, (_, i) => ({ h: `${d}-${i}` })) });

test('limitFeed — ไม่เกินเพดาน = คืนของเดิมทั้งก้อน', () => {
  const f = [day('2026-09-30', 3), day('2026-09-29', 2)];
  assert.deepEqual(limitFeed(f, 10), { days: f, shown: 5, total: 5, hidden: 0 });
  assert.equal(limitFeed(f).shown, 5);               // ไม่ส่ง max = ไม่ตัด
});

test('🔴 limitFeed — เกินเพดาน ต้องบอกจำนวนที่ซ่อน (ห้ามตัดเงียบ)', () => {
  const r = limitFeed([day('2026-09-30', 3), day('2026-09-29', 5)], 4);
  assert.equal(r.shown, 4);
  assert.equal(r.total, 8);
  assert.equal(r.hidden, 4);
  assert.deepEqual(r.days.map(d => d.items.length), [3, 1]);   // วันสุดท้ายถูกตัดครึ่งได้
});

test('limitFeed — วันที่ไม่เหลือที่ว่างแล้ว ต้องไม่โผล่เป็นหัวข้อเปล่า', () => {
  const r = limitFeed([day('2026-09-30', 3), day('2026-09-29', 5)], 3);
  assert.equal(r.days.length, 1);
  assert.equal(r.hidden, 5);
});

test('limitFeed — ชุดว่าง/เพดาน 0 ไม่ throw', () => {
  assert.deepEqual(limitFeed([], 5), { days: [], shown: 0, total: 0, hidden: 0 });
  assert.equal(limitFeed([day('2026-09-30', 2)], 0).shown, 2);  // 0 = ไม่ตั้งเพดาน (ไม่ใช่ซ่อนทั้งหมด)
});

test('มุมมอง "สำหรับผู้ใช้" (ตั้งต้น) ซ่อนเอกสาร/งานระบบ · "ทั้งหมด" ยังเห็นครบ (UX audit 05/10)', async () => {
  const { buildFeed } = await import('../changelog.js');
  const rows = [
    { d: '2026-10-05', t: 'feat', m: 'a' }, { d: '2026-10-05', t: 'fix', m: 'b' },
    { d: '2026-10-05', t: 'perf', m: 'c' }, { d: '2026-10-05', t: 'docs', m: 'd' },
    { d: '2026-10-05', t: '', m: 'e ไม่มี prefix' },
  ];
  assert.deepEqual(buildFeed(rows, { kind: 'user' })[0].items.map(r => r.m), ['a', 'b', 'c']);
  assert.equal(buildFeed(rows, { kind: 'all' })[0].items.length, 5);
});

