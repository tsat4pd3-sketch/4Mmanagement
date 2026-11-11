/* 🔗 เทสโซ่ส่งต่อ MO ที่ขาด (2026-11-11) — เคสจริง: ใบลูกถูกลบ ⇒ `to_order_id` ถูกล้างเป็น null
   โดย FK `on delete set null` ⇒ ใบแม่ยัง `transferred` (จบแล้ว) = ปัญหาหลุดจากคิวทุกคน */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HANDOFF_GAP_KINDS, handoffGapKind, handoffAgeDays, buildHandoffGapBoard, handoffGapMeta,
} from '../moHandoffGaps.js';

const NOW = Date.UTC(2026, 10, 11, 3, 0, 0);     // 11/11/2026 10:00 ไทย — ตรึง (เทสรอบ +400 วัน)
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
const h = (over = {}) => ({ id: 'h1', from_order_id: 'P1', to_order_id: 'C1', to_dept: 'jig_maintenance',
  reason: 'Reed ชำรุด', handed_by: 'กรกฎ', handed_at: ago(50), ...over });

test('ลิงก์ว่าง = ใบลูกถูกลบ ⇒ missing (ไม่ใช่ unknown)', () => {
  assert.equal(handoffGapKind(h({ to_order_id: null })), 'missing');
  assert.equal(handoffGapKind(h({ to_order_id: '' })), 'missing');
});

test('ปลายทางยังทำงานอยู่ = ไม่ใช่โซ่ขาด (คืน null)', () => {
  assert.equal(handoffGapKind(h(), { childBy: { C1: { id: 'C1', status: 'pending' } }, loadedIds: new Set(['C1']) }), null);
  assert.equal(handoffGapKind(h(), { childBy: { C1: { id: 'C1', status: 'closed' } }, loadedIds: new Set(['C1']) }), null,
    'ปลายทางปิดงานแล้ว = จบสวย ไม่ต้องเตือน');
});

test('ปลายทางถูกยกเลิก/ตีกลับ = void (คนละเรื่องกับหาย)', () => {
  for (const st of ['cancelled', 'rejected']) {
    assert.equal(handoffGapKind(h(), { childBy: { C1: { id: 'C1', status: st } }, loadedIds: new Set(['C1']) }), 'void', st);
  }
});

test('🔴 อ่านใบลูกไม่ได้ = unknown ห้ามบีบเป็น "หาย"', () => {
  // ไม่ส่ง loadedIds เลย = ยังไม่รู้ว่าโหลดครบหรือยัง
  assert.equal(handoffGapKind(h(), { childBy: {} }), 'unknown');
  // ส่ง loadedIds แต่ id นี้ไม่อยู่ในชุดที่โหลด = ยังไม่ได้ถาม
  assert.equal(handoffGapKind(h(), { childBy: {}, loadedIds: new Set(['OTHER']) }), 'unknown');
  // ยืนยันว่าถามแล้วไม่มีแถว = ถูกลบจริง
  assert.equal(handoffGapKind(h(), { childBy: {}, loadedIds: new Set(['C1']) }), 'missing');
});

test('นับวันไม่ได้ = null ห้ามคืน 0', () => {
  assert.equal(handoffAgeDays(h({ handed_at: null }), NOW), null);
  assert.equal(handoffAgeDays(h({ handed_at: 'ไม่ใช่วันที่' }), NOW), null);
  assert.equal(handoffAgeDays(h({ handed_at: ago(50) }), NOW), 50);
});

test('board: เรียงนานสุดก่อน · ตัวนับวันไม่ได้ต่อท้าย ห้ามหาย', () => {
  const b = buildHandoffGapBoard([
    h({ id: 'a', to_order_id: null, handed_at: ago(10) }),
    h({ id: 'b', to_order_id: null, handed_at: ago(50) }),
    h({ id: 'c', to_order_id: null, handed_at: null }),
    h({ id: 'd', to_order_id: 'OK', handed_at: ago(99) }),   // ปลายทางยังทำงาน = ไม่เข้าแผง
  ], { childBy: { OK: { id: 'OK', status: 'repaired' } }, loadedIds: new Set(['OK']), now: NOW });
  assert.deepEqual(b.rows.map(r => r.id), ['b', 'a', 'c']);
  assert.equal(b.total, 3, 'ใบที่ปลายทางยังทำงานต้องไม่เข้าแผง');
  assert.equal(b.rows[2].days, null);
});

test('board: เนื้อปัญหาต้องมาจากใบแม่ (ใบลูกหายแล้ว เหลือใบแม่ที่เดียว)', () => {
  const b = buildHandoffGapBoard([h({ to_order_id: null })], {
    parentBy: { P1: { id: 'P1', mo_no: 'PRO-BM-220926-0461', line_name: 'Line 61', machine_no: 'SP-84/NF97',
      problem_characteristic: 'Reed ชำรุด' } },
    teamName: (k) => (k === 'jig_maintenance' ? 'ซ่อมบำรุงจิ๊ก' : k),
    now: NOW,
  });
  const r = b.rows[0];
  assert.equal(r.moNo, 'PRO-BM-220926-0461');
  assert.equal(r.lineName, 'Line 61');
  assert.equal(r.toDeptLabel, 'ซ่อมบำรุงจิ๊ก');
  assert.equal(r.fromOrderId, 'P1', 'จอต้องเปิดใบแม่ได้ — ใบลูกไม่มีแล้ว');
});

test('board: จัดกลุ่มตามชนิด เรียงตามทะเบียน (ต้องลงมือก่อนขึ้นก่อน)', () => {
  const b = buildHandoffGapBoard([
    h({ id: 'v', to_order_id: 'C2', handed_at: ago(5) }),
    h({ id: 'm', to_order_id: null, handed_at: ago(5) }),
  ], { childBy: { C2: { id: 'C2', status: 'cancelled', reject_reason: '[ยกเลิกใบ] ไม่ใช่งานจิ๊ก' } },
       loadedIds: new Set(['C2']), now: NOW });
  assert.deepEqual(b.groups.map(g => g.key), ['missing', 'void']);
  assert.equal(b.groups[1].rows[0].childReason, '[ยกเลิกใบ] ไม่ใช่งานจิ๊ก');
});

test('ทะเบียนชนิด — ต้องมีคำอธิบายทุกตัว + meta ตกถัง unknown เมื่อไม่รู้จัก', () => {
  assert.ok(HANDOFF_GAP_KINDS.every(k => k.label && k.hint && k.icon && k.tone));
  assert.equal(handoffGapMeta('ไม่มีชนิดนี้').key, 'unknown');
});
