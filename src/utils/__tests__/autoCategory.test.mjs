import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normText, termsOfLabel, buildCategoryIndex, classifyText, looksPlanned, fillCategories,
} from '../autoCategory.js';
import { PLANNED_GROUP } from '../unclassified.js';

/* ── ทะเบียนจริงของโรงงาน (ตัดมาบางส่วนจาก mtn_problem_types + dr_downtime_types 23/09) ──
   🔴 ทุกคำในเทสนี้ต้องมาจาก "ป้ายที่โรงงานเขียนเอง" — ห้ามแต่งศัพท์ขึ้นมาเทส
      ไม่งั้นเทสจะผ่านกับพจนานุกรมสมมติ แต่พังกับทะเบียนจริง */
const REGISTRY = [
  { label: 'เครื่อง Laser มีปัญหา', group: 'เลเซอร์ (Laser)', team: 'production' },
  { label: 'เลเซอร์มีปัญหา', group: 'เลเซอร์ (Laser)', team: 'production' },
  { label: 'ราง Conveyor มีปํญหา', group: 'ราง / ลำเลียง', team: 'production' },
  { label: 'เครื่องBending มีปัญหา', group: 'เครื่องขึ้นรูป (ปั๊ม/เบนด์/ไฮดรอลิก)', team: 'production' },
  { label: 'Sensor / Reed มีปัญหา', group: 'ไฟฟ้า / ควบคุม', team: 'production' },
  { label: 'เปลี่ยน Cap Tip / Contact Tip', group: 'เชื่อม — ของสิ้นเปลือง/ปลายหัว', team: 'production' },
  { label: 'ลวดเชื่อมติด', group: 'เชื่อม — ของสิ้นเปลือง/ปลายหัว', team: 'production' },
  { label: 'Robot (Alarm/Error)', group: 'หุ่นยนต์ / Gripper', team: 'production' },
  { label: 'ลมรั่ว', group: 'ระบบลม', team: null },
  { label: 'ระบบน้ำ / ลม / ไฟ มีปัญหา', group: 'สาธารณูปโภค (น้ำ/ลม/ไฟ)', team: 'production' },
  { label: 'อื่นๆ', group: '', team: null },                       // ป้ายถังขยะ — สอนอะไรไม่ได้
];

/* ข้อความจริงจากใบที่ "ช่างจัดกลุ่มไว้แล้ว" — แหล่งศัพท์หน้างานที่ทะเบียนไม่มี */
const seen = (label, group, n = 2) =>
  Array.from({ length: n }, () => ({ label, group, team: 'production', kind: 'seen' }));
const SEEN = [
  ...seen('เลเซอร์มีปัญหา Alarm TC Alarm observeline', 'เลเซอร์ (Laser)', 12),
  ...seen('ราง Conveyor มีปํญหา พาเลทไม่ไหล M23 Overload', 'ราง / ลำเลียง', 4),
  ...seen('Robot (Alarm/Error) โรบอทค้าง', 'หุ่นยนต์ / Gripper', 3),
  ...seen('เปลี่ยน Cap Tip / Contact Tip เปลี่ยนหัวทิป', 'เชื่อม — ของสิ้นเปลือง/ปลายหัว', 6),
  ...seen('ลวดเชื่อมติด ลวดเชื่อมละลายติด Contact tip', 'เชื่อม — ของสิ้นเปลือง/ปลายหัว', 5),
];

const idx = buildCategoryIndex([...REGISTRY, ...SEEN]);
const hit = (text, team = 'production') => classifyText(text, idx, { team });

test('normText แยกรอยต่อไทย↔อังกฤษ (ทะเบียนเขียนติดกัน)', () => {
  assert.equal(normText('เครื่องBending มีปัญหา'), 'เครื่อง bending มีปัญหา');
  assert.equal(normText('Alarm TC_OBSERVELINE2'), 'alarm tc observeline2');
});

test('termsOfLabel ตัดคำโหล/คำเชื่อม/เลขล้วนทิ้ง เหลือคำที่ชี้หมวดได้', () => {
  assert.deepEqual(termsOfLabel('เครื่องBending มีปัญหา'), ['bending']);
  assert.deepEqual(termsOfLabel('เครื่อง Laser มีปัญหา'), ['laser']);
  // 'เปลี่ยน' เป็นคำโหล · เลขล้วนไม่บอกหมวด
  assert.deepEqual(termsOfLabel('เปลี่ยน Part 172'), []);
});

test('🔴 พจนานุกรมมาจากทะเบียน — ป้ายถังขยะสอนอะไรไม่ได้', () => {
  assert.equal(idx.terms.some(t => t.term.includes('อื่น')), false);
});

test('จับหมวดจากคำในทะเบียนได้ตรง', () => {
  assert.equal(hit('Bending Alarm Bending Alarm')?.group, 'เครื่องขึ้นรูป (ปั๊ม/เบนด์/ไฮดรอลิก)');
  assert.equal(hit('ปรับรูเลเซอร์ C chanal nogo')?.group, 'เลเซอร์ (Laser)');
  assert.equal(hit('หรีดขาดสันยานไม่เข้า Reed ชำรุด')?.group, 'ไฟฟ้า / ควบคุม');
});

test('🔴 ศัพท์หน้างานที่ไม่มีในทะเบียน ต้องเรียนจากใบที่จัดกลุ่มแล้วได้', () => {
  // "observeline" / "พาเลทไม่ไหล" ไม่เคยอยู่ในทะเบียน — คนพิมพ์เองล้วนๆ
  assert.equal(idx.terms.some(t => t.term === 'observeline'), true);
  const laser = hit('Alarm TC Alarm Observeline ตัดขาด');
  assert.equal(laser?.group, 'เลเซอร์ (Laser)');
  assert.ok(laser.terms.includes('observeline'), 'ต้องบอกได้ว่าเดาจากคำไหน');
  assert.equal(hit('พาเลทไม่ไหล Conveyor alarm overload m23')?.group, 'ราง / ลำเลียง');
});

test('🔴 คำที่เจอครั้งเดียวในใบเก่า = บังเอิญ ห้ามเอามาเป็นคำชี้หมวด', () => {
  const one = buildCategoryIndex([{ label: 'ควันขึ้นผิดปกติ', group: 'ไฟฟ้า / ควบคุม', kind: 'seen' }]);
  assert.equal(one.terms.length, 0);
});

test('🔴 ก้ำกึ่ง/ไม่มีหลักฐาน = ต้องคืน null ปล่อยให้ตกถัง "อื่นๆ" ดีกว่าเดาผิด', () => {
  assert.equal(hit(''), null);
  assert.equal(hit('งานยุบดาตั้ม'), null);
  assert.equal(hit('เปลี่ยนโปรแกรมเป็นขึ้น 2 ข้าง'), null);
});

test('🔴 งานตามแผนต้องชนะการจับคำเสมอ — "เปลี่ยน Guide Pin ตามรอบ" ไม่ใช่ปัญหาเชื่อม', () => {
  assert.equal(looksPlanned('เปลี่ยน Upper/Lower Electrode และ Guide Pin ตามรอบ'), true);
  assert.equal(looksPlanned('Cap tip ถึงระยะเปลี่ยน'), true);
  assert.equal(looksPlanned('ลวดเชื่อมละลายติด Contact tip'), false);
  const out = fillCategories(
    [{ group: 'อื่นๆ', note: 'เปลี่ยน Guide Pin ตามรอบ' }], idx, { team: 'production' },
  );
  assert.equal(out.rows[0].group, PLANNED_GROUP);
  assert.equal(out.plannedFound, 1);
  assert.equal(out.filled, 0);
});

test('fillCategories ไม่แตะแถวที่ช่างเลือกกลุ่มไว้แล้ว + ติดป้ายที่มาให้แถวที่เดา', () => {
  const rows = [
    { group: 'เลเซอร์ (Laser)', note: 'อะไรก็ได้' },
    { group: 'อื่นๆ', note: 'Alarm TC Alarm Observeline ตัดขาด' },
    { group: 'ไม่ระบุกลุ่ม', note: '' },
  ];
  const out = fillCategories(rows, idx, { team: 'production' });
  assert.equal(out.rows[0].autoFrom, undefined, 'ของที่คนเลือกเองห้ามถูกทับ');
  assert.equal(out.rows[1].group, 'เลเซอร์ (Laser)');
  assert.equal(out.rows[1].autoFrom.from, 'อื่นๆ');
  assert.equal(out.rows[2].group, 'ไม่ระบุกลุ่ม', 'ไม่มีข้อความ = จับไม่ได้ ต้องคงเดิม');
  assert.equal(out.filled, 1);
  assert.equal(out.stuck, 1);
});

test('🔴 ห้ามแก้แถวเดิม (จอวิเคราะห์อ่านอย่างเดียว ห้ามเขียนกลับฐาน)', () => {
  const rows = [{ group: 'อื่นๆ', note: 'Alarm TC Alarm Observeline ตัดขาด' }];
  fillCategories(rows, idx, { team: 'production' });
  assert.equal(rows[0].group, 'อื่นๆ');
});

test('ขอบเขตทีม: ทะเบียนของทีมอื่นไม่ควรถูกใช้เมื่อส่ง scopeOf มา', () => {
  const scopeOf = (h, team) => !h.team || h.team === team;
  assert.equal(classifyText('Bending Alarm', idx, { team: 'die_maintenance', scopeOf }), null);
  assert.equal(classifyText('Bending Alarm', idx, { team: 'production', scopeOf })?.group,
    'เครื่องขึ้นรูป (ปั๊ม/เบนด์/ไฮดรอลิก)');
});
