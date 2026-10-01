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
