import test from 'node:test';
import assert from 'node:assert/strict';
import { dtTypeName, dtBucketName, isDtVague, dtTrashStats, buildDtIndex, dtResolve, NO_MACHINE, NO_TYPE }
  from '../downtimeCategory.js';

/* ── แถวจริงจาก downtime_logs 90 วัน (23/09) — ชื่อประเภทตัดมาจาก dr_downtime_types จริง ──
   🔴 ห้ามแต่งชื่อประเภทเอง ต้องเป็นป้ายที่โรงงานเขียนไว้จริง ไม่งั้นเทสผ่านกับทะเบียนสมมติ */
const row = (name_th, machine_no, duration_min = 10, description = '') =>
  ({ dr_downtime_types: name_th === null ? null : { name_th, category: 'unplanned' }, machine_no, duration_min, description });

test('ประเภทปกติ = ชื่อเดิมเป๊ะ (ห้ามต่อชื่อเครื่อง ไม่งั้นแท่งแตกกระจาย)', () => {
  assert.equal(dtBucketName(row('เลเซอร์มีปัญหา', 'LS-04')), 'เลเซอร์มีปัญหา');
  assert.equal(dtBucketName(row('ราง Conveyor มีปํญหา', 'CV-01')), 'ราง Conveyor มีปํญหา');
  assert.equal(isDtVague(row('JIG มีปัญหา (ชำรุด/ปรับแก้)', 'JG-1')), false);
});

test('🔴 ถังขยะต้องแตกตามเครื่อง — HDF-02 ที่ซ่อนอยู่ต้องโผล่เป็นแท่งของตัวเอง', () => {
  assert.equal(dtBucketName(row('อื่นๆ (นอกแผน)', 'HDF-02')), 'HDF-02 · อื่นๆ (นอกแผน)');
  assert.equal(dtBucketName(row('เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)', 'LS-04')),
    'LS-04 · เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)');
  assert.equal(dtBucketName(row('อื่นๆ (ในแผน)', 'BD-08')), 'BD-08 · อื่นๆ (ในแผน)');
  // 🔴 เลขเครื่องต้องอยู่หน้า — บอร์ด TV ตัดป้ายที่ ~8 ตัวอักษร
  assert.ok(dtBucketName(row('อื่นๆ (นอกแผน)', 'HDF-02')).startsWith('HDF-02'));
  assert.equal(isDtVague(row('อื่นๆ (นอกแผน)', 'HDF-02')), true);
});

test('ไม่กรอกเครื่อง = ชี้เป้าไม่ได้จริงๆ ต้องเห็นว่าเป็นคนละกองกับ "ไม่มีประเภท"', () => {
  assert.equal(dtBucketName(row('อื่นๆ (นอกแผน)', '')), `${NO_MACHINE} · อื่นๆ (นอกแผน)`);
  assert.equal(dtBucketName(row('อื่นๆ (นอกแผน)', '   ')), `${NO_MACHINE} · อื่นๆ (นอกแผน)`);
  assert.equal(dtBucketName(row(null, 'LS-02')), `LS-02 · ${NO_TYPE}`);
  assert.equal(dtBucketName({}), `${NO_MACHINE} · ${NO_TYPE}`);
});

test('รองรับทั้งแบบ join และแบบ flatten (จอเก่าบางจอ map ชื่อออกมาก่อน)', () => {
  assert.equal(dtTypeName({ type_name: 'Robot (Alarm/Error)' }), 'Robot (Alarm/Error)');
  assert.equal(dtTypeName({ name_th: 'Prox ชำรุด' }), 'Prox ชำรุด');
  assert.equal(dtBucketName({ type_name: 'อื่นๆ (นอกแผน)', machine_no: 'LS-07' }), 'LS-07 · อื่นๆ (นอกแผน)');
});

test('🔴 บรรทัดความซื่อสัตย์ — แยก "ยังชี้เป้าต่อได้" ออกจาก "ต้องไปแก้ที่การกรอก"', () => {
  const rows = [
    row('เลเซอร์มีปัญหา', 'LS-04', 30),
    row('อื่นๆ (นอกแผน)', 'HDF-02', 60),
    row('เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)', 'LS-02', 20),
    row('อื่นๆ (นอกแผน)', '', 15),
  ];
  const s = dtTrashStats(rows);
  assert.equal(s.total, 4);
  assert.equal(s.vague, 3);
  assert.equal(s.vagueMin, 95);
  assert.equal(s.withMachine, 2);
  assert.equal(s.noMachine, 1);
  assert.equal(s.noMachineMin, 15);
  assert.equal(Math.round(s.vaguePct), 75);
});

test('ไม่มีแถว = ต้องไม่หาร 0 (จอเปล่าห้ามขึ้น NaN)', () => {
  const s = dtTrashStats([]);
  assert.equal(s.total, 0);
  assert.equal(s.vaguePct, 0);
});


/* ── 🔎 เดาประเภทจากคำ (เปิด 24/09 หลังมีชั้นภาษา) ───────────────────────────
   สัดส่วนในเทสนี้ = สัดส่วนจริงจาก downtime_logs 180 วัน (conveyor 110 : 15) */
const conveyorRows = [
  ...Array.from({ length: 110 }, () => (
    { dr_downtime_types: { name_th: 'ราง Conveyor มีปํญหา' }, description: 'conveyor ติด' })),
  ...Array.from({ length: 15 }, () => (
    { dr_downtime_types: { name_th: 'ชิ้นงานเต็มราง Conveyor' }, description: 'conveyor เต็ม' })),
];

test('🔴 คำที่กำกวมใน "ทะเบียน" ต้องตัดสินด้วย "การใช้งานจริง" ไม่ใช่ทิ้ง', () => {
  /* `conveyor` อยู่ใน 2 ป้ายทะเบียน ⇒ ถ้าดูแต่ทะเบียนจะกำกวมและถูกตัดทิ้ง
     แต่ใบจริง 110 จาก 125 ใบอยู่ "ราง Conveyor มีปํญหา" ⇒ เรียนจากข้อมูลของโรงงานได้
     🔴 นี่คือเหตุผลที่ buildDtIndex ต้องส่ง "ใบที่จัดประเภทแล้ว" เข้าไปเรียน ไม่ใช่ทะเบียนอย่างเดียว */
  const idx = buildDtIndex(conveyorRows);
  const hit = dtResolve(row('อื่นๆ (นอกแผน)', 'CV-01', 30, 'คอนเวเย่ออาราม'), idx);
  assert.equal(hit.name, 'ราง Conveyor มีปํญหา');
  assert.equal(hit.guessed, true);
  assert.ok(hit.terms.includes('conveyor'), 'ต้องบอกได้ว่าเดาจากคำไหน');
});

test('ไม่ส่ง index = ไม่เดา (พฤติกรรมเดิม) · เดาไม่ได้ = ยังแตกตามเครื่อง', () => {
  const r = row('อื่นๆ (นอกแผน)', 'CV-01', 30, 'คอนเวเย่ออาราม');
  assert.equal(dtBucketName(r), 'CV-01 · อื่นๆ (นอกแผน)');
  const idx = buildDtIndex(conveyorRows);
  assert.equal(dtBucketName(row('อื่นๆ (นอกแผน)', 'HDF-02', 30, 'ให้เครื่องpeทายงาน'), idx),
    'HDF-02 · อื่นๆ (นอกแผน)');
});

test('🔴 ประเภทที่ไม่ใช่ถังขยะ ห้ามถูกเดาทับ (ของที่ช่างเลือกเองชนะเสมอ)', () => {
  const idx = buildDtIndex(conveyorRows);
  assert.equal(dtBucketName(row('เลเซอร์มีปัญหา', 'LS-04', 10, 'conveyor'), idx), 'เลเซอร์มีปัญหา');
});

test('dtTrashStats นับใบที่เดาได้แยกจากใบที่ต้องแตกตามเครื่อง', () => {
  const idx = buildDtIndex(conveyorRows);
  const s = dtTrashStats([
    row('อื่นๆ (นอกแผน)', 'CV-01', 30, 'คอนเวเย่ออาราม'),
    row('อื่นๆ (นอกแผน)', 'HDF-02', 20, 'ให้เครื่องpeทายงาน'),
    row('อื่นๆ (นอกแผน)', '', 10, ''),
  ], { index: idx });
  assert.equal(s.vague, 3);
  assert.equal(s.guessed, 1);
  assert.equal(s.guessedMin, 30);
  assert.equal(s.withMachine, 1);
  assert.equal(s.noMachine, 1);
});
