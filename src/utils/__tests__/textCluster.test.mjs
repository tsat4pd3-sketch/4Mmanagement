import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteSimilarity, clusterNotes, CLUSTER_THRESHOLD } from '../textCluster.js';

/* ── บั๊กจริงที่ user จับได้ (2026-08-25) ─────────────────────────────────────
   "รองานจากHDF" กับ "รองาน HDF" ถูกแยกเป็นคนละกลุ่มในแท็บวิเคราะห์สาเหตุ (OEE Analytics)
   ทั้งที่เป็นเรื่องเดียวกัน — ต้นเหตุ: คำว่า "จาก" แทรกกลางไปรบกวน trigram รอบจุดต่อ
   ทำให้ Jaccard เหลือแค่ ~0.364 ต่ำกว่าเกณฑ์ 0.45 */
test('รองานจากHDF ↔ รองาน HDF — เหมือนกันหลังตัดคำเชื่อม (บั๊กจริง 2026-08-25)', () => {
  const sim = noteSimilarity('รองานจากHDF', 'รองาน HDF');
  assert.ok(sim >= CLUSTER_THRESHOLD, `sim=${sim} ควร >= ${CLUSTER_THRESHOLD}`);
});

test('clusterNotes รวม "รองานจากHDF" กับ "รองาน HDF" เป็นกลุ่มเดียว', () => {
  const rows = [
    { note: 'รองานจากHDF', v: 750 }, { note: 'รองานจากHDF', v: 80 },
    { note: 'รองาน HDF', v: 135 }, { note: 'รองาน HDF', v: 40 },
  ];
  const { clusters } = clusterNotes(rows, r => r.note, r => r.v);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].value, 750 + 80 + 135 + 40);
  assert.equal(clusters[0].count, 4);
});

test('คำเชื่อมอื่นที่พบจริงในหน้างาน: "รอเหล็กจากStore" ↔ "รอเหล็ก Store"', () => {
  const sim = noteSimilarity('รอเหล็กจากStore', 'รอเหล็ก Store');
  assert.ok(sim >= CLUSTER_THRESHOLD, `sim=${sim} ควร >= ${CLUSTER_THRESHOLD}`);
});

/* ── กันเดา: การตัดคำเชื่อมต้องไม่ทำให้เรื่องคนละเรื่องถูกจับกลุ่มผิด ───────────────── */
test('คนละเรื่องกัน (คนละเครื่อง) ยังไม่ถูกจับกลุ่มแม้มีคำเชื่อมร่วมกัน', () => {
  const sim = noteSimilarity('รองานจากHDF', 'รอวัตถุดิบจากคลัง');
  assert.ok(sim < CLUSTER_THRESHOLD, `sim=${sim} ไม่ควรถึงเกณฑ์ — คนละเรื่องกัน`);
});

/* ── บั๊กจริงรอบ 2 (2026-08-25) — "คอนเวเย่อพัง" (ทับศัพท์ไทย) กับ "conveyor เสีย"
   (อังกฤษ+ไทย) แยกเป็นคนละกลุ่ม ทั้งที่เป็นเรื่องเดียวกัน — คนละปัญหากับคำเชื่อม (ไม่มีคำแทรก
   เลย) เป็นปัญหาคำพ้อง: ชื่ออุปกรณ์ทับศัพท์/อังกฤษ + คำไทยหลายคำที่แปลว่า "เสีย" */
test('คอนเวเย่อพัง ↔ conveyor เสีย — คำพ้องข้ามภาษา (บั๊กจริง 2026-08-25 รอบ 2)', () => {
  const sim = noteSimilarity('คอนเวเย่อพัง', 'conveyor เสีย');
  assert.ok(sim >= CLUSTER_THRESHOLD, `sim=${sim} ควร >= ${CLUSTER_THRESHOLD}`);
});

test('clusterNotes รวม "คอนเวเย่อพัง" กับ "conveyor เสีย" เป็นกลุ่มเดียว', () => {
  const rows = [
    { note: 'คอนเวเย่อพัง', v: 300 }, { note: 'คอนเวเยอร์เสีย', v: 60 },
    { note: 'conveyor เสีย', v: 90 }, { note: 'conveyor ชำรุด', v: 20 },
  ];
  const { clusters } = clusterNotes(rows, r => r.note, r => r.v);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].value, 300 + 60 + 90 + 20);
  assert.equal(clusters[0].count, 4);
});

test('คำพ้องอาการเสียอื่นๆ (ชำรุด/ขัดข้อง) ก็เทียบเท่ากับ "พัง"', () => {
  const sim = noteSimilarity('จิ๊กพัง', 'จิ๊กขัดข้อง');
  assert.ok(sim >= CLUSTER_THRESHOLD, `sim=${sim} ควร >= ${CLUSTER_THRESHOLD}`);
});

/* ── กันเดา: แทนคำพ้องแล้วห้ามทำให้ "คนละอุปกรณ์" ถูกจับกลุ่มผิด ───────────────────── */
test('คนละอุปกรณ์ (จิ๊ก vs มอเตอร์) ยังแยกกันแม้ทั้งคู่มีคำว่า "เสีย/พัง"', () => {
  const sim = noteSimilarity('จิ๊กพัง', 'มอเตอร์เสีย');
  assert.ok(sim < CLUSTER_THRESHOLD, `sim=${sim} ไม่ควรถึงเกณฑ์ — คนละอุปกรณ์กัน`);
});

test('มาตรฐานเดิมยังผ่าน — ข้อความเหมือนกันเป๊ะ = 1', () => {
  assert.equal(noteSimilarity('โรบอทชนจิ๊ก', 'โรบอทชนจิ๊ก'), 1);
});

test('มาตรฐานเดิมยังผ่าน — ขยายความ (containment) ยังทำงาน', () => {
  const sim = noteSimilarity('ไฟดับ', 'ไฟดับทั้งโรงงาน');
  assert.equal(sim, 1);
});

test('มาตรฐานเดิมยังผ่าน — เว้นวรรค/ไม่เว้นวรรคเรื่องเดิม (ไม่มีคำเชื่อม) ยังเหมือนกัน', () => {
  const sim = noteSimilarity('โรบอทชนจิ๊ก', 'โรบอท ชนจิ๊ก');
  assert.equal(sim, 1);
});
