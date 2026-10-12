/* ใบ MO ที่ปิดแล้ว = "บันทึก" — กฎที่พลาดแล้วเอกสารโกหกแบบดูไม่ออก (2026-10-12) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MO_SNAP_VERSION, serializeMo, moFromSnapshot, moPrintSource, moPrintNote, snapshotUsesFile,
} from '../mtnMoSnapshotCore.js';

const ORDER = {
  id: 'mo-1', mo_no: 'JIG-2610-001', status: 'closed', mtn_dept: 'jig_maintenance',
  report_note: 'จิ๊กหลวม', root_cause: 'สลักสึก', solution: 'เปลี่ยนสลัก',
  approve_sign: 'https://x/sig.png', cost_mgr_at: '2026-10-11T03:00:00Z',
};
const PARTS = [{ id: 'p1', part_name: 'สลัก', qty: 2, unit: 'ชิ้น' }];
const LABOR = [{ id: 'l1', seq: 1, name: 'ช่าง ก', hours: 2 }];
const CMTS  = [{ id: 'c1', author_name: 'สมชาย', body: 'แก้แล้ว', created_at: '2026-10-10T02:00:00Z' }];

test('serializeMo เก็บเนื้อใบ + อะไหล่ + ค่าแรง + คอมเมนต์ ครบ', () => {
  const snap = serializeMo(ORDER, { parts: PARTS, labor: LABOR, comments: CMTS });
  assert.equal(snap.v, MO_SNAP_VERSION);
  assert.equal(snap.order.mo_no, 'JIG-2610-001');
  assert.equal(snap.order.root_cause, 'สลักสึก');
  assert.deepEqual(snap.parts, PARTS);
  assert.deepEqual(snap.labor, LABOR);
  assert.deepEqual(snap.comments, CMTS);
  assert.ok(snap.at, 'ต้องมีเวลาที่เก็บ');
  assert.equal(serializeMo(null), null);
  assert.equal(serializeMo({ mo_no: 'x' }), null);     // ไม่มี id = ไม่รู้ว่าใบไหน
});

test('🔴 ห้ามเก็บเลขฟอร์ม/Rev/โลโก้ลง snapshot — doc_control ต้องแก้ได้ที่ /doc-forms', () => {
  const snap = serializeMo({
    ...ORDER, form_code: 'FM-JIG-008', rev: 'REV.00', effective_date: '05/12/2025',
    footer_note: 'x.xls', sig_blocks: ['A'], logo_url: 'https://x/logo.png',
    snapshot: { v: 1 }, snapshot_at: '2026-10-11T00:00:00Z',
  }, {});
  for (const k of ['form_code', 'rev', 'effective_date', 'footer_note', 'sig_blocks', 'logo_url']) {
    assert.equal(k in snap.order, false, `${k} ต้องไม่อยู่ใน snapshot (อ่านสดจากทะเบียน)`);
  }
  // และห้ามซ้อนตัวเองเข้าไปอีก
  assert.equal('snapshot' in snap.order, false);
  assert.equal('snapshot_at' in snap.order, false);
});

test('moFromSnapshot แกะกลับได้ · ของเสีย/ว่าง/เวอร์ชันใหม่กว่า = null (ห้ามเดา)', () => {
  const snap = serializeMo(ORDER, { parts: PARTS, labor: LABOR, comments: CMTS });
  const got = moFromSnapshot(snap);
  assert.equal(got.order.mo_no, 'JIG-2610-001');
  assert.deepEqual(got.parts, PARTS);
  assert.deepEqual(got.cmt, { rows: CMTS, error: null });   // คอมเมนต์ในบันทึก = ครบแน่ ⇒ error null
  assert.equal(moFromSnapshot(null), null);
  assert.equal(moFromSnapshot({}), null);
  assert.equal(moFromSnapshot({ order: {} }), null);        // ไม่มี id
  assert.equal(moFromSnapshot({ ...snap, v: MO_SNAP_VERSION + 1 }), null);
  // อะไหล่/ค่าแรงหายไปจากก้อน = คืน [] ไม่ throw
  const thin = moFromSnapshot({ v: 1, order: { id: 'x' } });
  assert.deepEqual(thin.parts, []);
  assert.deepEqual(thin.labor, []);
  assert.deepEqual(thin.cmt.rows, []);
});

test('🔴 ใบยังไม่ปิด = พิมพ์สด · ปิดแล้วมีบันทึก = พิมพ์จากบันทึก · ปิดแล้วไม่มี = ต้องเขียนบนใบ', () => {
  assert.equal(moPrintSource({ status: 'handover' }), 'live');
  assert.equal(moPrintSource({ status: 'qa', snapshot: null }), 'live');
  const snap = serializeMo(ORDER, {});
  assert.equal(moPrintSource({ status: 'closed', snapshot: snap }), 'snapshot');
  assert.equal(moPrintSource({ status: 'closed', snapshot: null }), 'closed_no_record');
  // snapshot เสียอ่านไม่ได้ ⇒ ต้องตกไป closed_no_record ไม่ใช่ snapshot
  assert.equal(moPrintSource({ status: 'closed', snapshot: { v: 99, order: { id: 'a' } } }), 'closed_no_record');
  assert.equal(moPrintSource(null), 'live');
});

test('ข้อความกำกับบนใบ: ใบปกติไม่เขียน · ใบเก่าที่ปิดแล้วต้องบอกว่าไม่ตรงที่ลงนาม', () => {
  assert.equal(moPrintNote({ status: 'handover' }), null);
  const old = moPrintNote({ status: 'closed', snapshot: null });
  assert.match(old, /อาจไม่ตรงกับที่ลงนาม/);
  const snap = serializeMo(ORDER, {});
  const ok = moPrintNote({ status: 'closed', snapshot: snap, snapshot_at: '2026-10-11T03:00:00Z' });
  assert.match(ok, /พิมพ์จากบันทึกต้นฉบับ/);
  assert.match(ok, /11\/10\/2569/);        // พ.ศ. · Asia/Bangkok
});

test('🔴 ไฟล์ที่บันทึกต้นฉบับอ้างอยู่ ห้ามลบ — นับไม่ได้ก็ถือว่าใช้อยู่ (fail-closed)', () => {
  const snap = serializeMo(ORDER, { parts: PARTS, labor: LABOR, comments: CMTS });
  assert.equal(snapshotUsesFile(snap, 'https://x/sig.png'), true);     // ลายเซ็นในบันทึก
  assert.equal(snapshotUsesFile(snap, 'https://x/other.png'), false);  // ไม่เกี่ยว = ลบได้
  // ไม่มีบันทึก / ไม่รู้ URL = ไม่บล็อก (ใบที่ยังไม่ปิดต้องเก็บกวาดไฟล์กำพร้าได้เหมือนเดิม)
  assert.equal(snapshotUsesFile(null, 'https://x/sig.png'), false);
  assert.equal(snapshotUsesFile(snap, null), false);
  // ก้อนที่ serialize ไม่ได้ (วนอ้างตัวเอง) = ถือว่าใช้อยู่ ห้ามลบ
  const loop = { a: 1 }; loop.self = loop;
  assert.equal(snapshotUsesFile(loop, 'https://x/sig.png'), true);
});
