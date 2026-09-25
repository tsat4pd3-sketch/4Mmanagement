/**
 * repairWi — ทะเบียน QRs ↔ WI การซ่อม (WI-PD3-069 §6)
 * 🔴 กฎที่ล็อกไว้: เลขพาร์ทต้องตรงเป๊ะ · คำอาการต้องยาวพอ · จับคู่ไม่ได้ต้องคืนว่าง
 *    (แนะนำ WI ผิดเล่ม อันตรายกว่าไม่แนะนำ — คนจะซ่อมตามเล่มที่จอบอก)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRepairWi } from '../repairWi.js';

const REG = [
  { code: 'WLS6051',  symptom: 'Missing nut',               wi_no: 'WI-PD3-018' },
  { code: 'WLS6005',  symptom: 'Missing nut M6',            wi_no: 'WI-PD3-048' },
  { code: 'WLS6033',  symptom: 'Skip process cutting hole', wi_no: 'WI-PD3-055' },
  { code: 'W3501083', symptom: 'Feed nut double',           wi_no: 'WI-PD3-068, WI-PD3-050' },
];

test('เลขพาร์ทตรง = จับได้ และบอกว่ามาจากเลขพาร์ท', () => {
  const r = matchRepairWi(REG, { codes: ['WLS6051'] });
  assert.equal(r.length, 1);
  assert.equal(r[0].wi_no, 'WI-PD3-018');
  assert.equal(r[0].why, 'code');
});

test('เลขพาร์ททนช่องว่าง/ขีด/ตัวพิมพ์เล็ก แต่ยังต้องเป็นเลขเดียวกัน', () => {
  assert.equal(matchRepairWi(REG, { codes: ['wls-6051'] })[0]?.wi_no, 'WI-PD3-018');
  assert.equal(matchRepairWi(REG, { codes: [' WLS 6051 '] })[0]?.wi_no, 'WI-PD3-018');
  // เลขคนละตัว ห้ามจับคู่แบบ "ขึ้นต้นเหมือนกัน"
  assert.deepEqual(matchRepairWi(REG, { codes: ['WLS60511'] }), []);
  assert.deepEqual(matchRepairWi(REG, { codes: ['WLS605'] }), []);
});

test('คำอาการตรง = จับได้ แต่ต้องบอกว่าเป็นการเดาจากคำ', () => {
  const r = matchRepairWi(REG, { codes: [], text: 'สถานี 3 พบ Missing nut 2 ชิ้น' });
  assert.ok(r.some(x => x.wi_no === 'WI-PD3-018' && x.why === 'symptom'));
});

test('เลขพาร์ทขึ้นก่อนคำอาการเสมอ (ตรงเป้ากว่า)', () => {
  const r = matchRepairWi(REG, { codes: ['WLS6033'], text: 'Missing nut' });
  assert.equal(r[0].why, 'code');
  assert.equal(r[0].wi_no, 'WI-PD3-055');
});

test('จับคู่ไม่ได้ = ว่าง ห้ามเดาเล่มให้', () => {
  assert.deepEqual(matchRepairWi(REG, { codes: ['XXXX'], text: 'เครื่องเสีย' }), []);
  assert.deepEqual(matchRepairWi([], { codes: ['WLS6051'] }), []);
  assert.deepEqual(matchRepairWi(REG, {}), []);
});

test('แถวที่ปิดใช้แล้วไม่ถูกแนะนำ', () => {
  const off = REG.map(r => (r.code === 'WLS6051' ? { ...r, is_active: false } : r));
  assert.deepEqual(matchRepairWi(off, { codes: ['WLS6051'] }), []);
});

test('อาการสั้นกว่า 4 ตัวอักษร ห้ามใช้จับคู่ (บทเรียน keyword "รู" ชน "เสียรูป")', () => {
  const reg = [{ code: 'X1', symptom: 'nut', wi_no: 'WI-X' }];
  assert.deepEqual(matchRepairWi(reg, { codes: [], text: 'nuts and bolts' }), []);
});

test('คืนไม่เกิน 4 เล่ม (ชิปล้นจอ = ไม่มีใครอ่าน)', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ code: `C${i}`, symptom: 'Missing nut', wi_no: `WI-${i}` }));
  assert.equal(matchRepairWi(many, { codes: [], text: 'Missing nut' }).length, 4);
});
