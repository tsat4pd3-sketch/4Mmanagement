import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBurstTracker, isNumericField, isTypingField, exactScanMatch, scanOfEvent } from '../scanWedge.js';

/* ป้อนรหัสทีละตัวด้วยระยะห่าง gap ms แล้วต่อ Enter — คืนผลของ Enter */
const type = (tr, text, { gap = 5, t0 = 1000, target = 'A', value = '' } = {}) => {
  let t = t0;
  for (const ch of text) { tr.feed({ key: ch, t, target, value }); t += gap; }
  return { r: tr.feed({ key: 'Enter', t }), t };
};

test('🔫 ตัวอักษรรัว ≥4 ตัว + Enter = การสแกน · คืนรหัสและค่าเดิมของช่องตอนเริ่ม', () => {
  const tr = createBurstTracker();
  const { r } = type(tr, '98881640', { value: '12' });
  assert.equal(r.kind, 'scan');
  assert.equal(r.raw, '98881640');
  assert.equal(r.startValue, '12', 'ต้องจำค่าก่อนสแกน — ไว้คืนให้ช่องตัวเลข');
});

test('คนพิมพ์ (ห่าง ≥ 60ms) ไม่ใช่การสแกน', () => {
  const tr = createBurstTracker();
  assert.equal(type(tr, '1234', { gap: 120 }).r.kind, 'enter');
});

test('สั้นกว่า 4 ตัวไม่นับเป็นสแกน (กันพิมพ์ตัวเลขสั้นด้วยคีย์บอร์ดเร็วๆ)', () => {
  const tr = createBurstTracker();
  assert.equal(type(tr, '12').r.kind, 'enter');
});

test('🔴 Enter ตัวที่ 2 ของ CR+LF ที่ตามมาติดๆ = trail (ต้องถูกกลืน ไม่ไปกดปุ่ม)', () => {
  const tr = createBurstTracker();
  const { r, t } = type(tr, 'RB-104');
  assert.equal(r.kind, 'scan');
  assert.equal(tr.feed({ key: 'Enter', t: t + 8 }).kind, 'trail');
  // Enter ถัดไปนานหลังจากนั้น = Enter ธรรมดา
  assert.equal(tr.feed({ key: 'Enter', t: t + 2000 }).kind, 'enter');
});

test('ย้ายช่องกลางทาง = เริ่มนับใหม่ (รหัสไม่ปนข้ามช่อง)', () => {
  const tr = createBurstTracker();
  tr.feed({ key: '1', t: 0, target: 'A' });
  tr.feed({ key: '2', t: 5, target: 'A' });
  for (const [i, ch] of [...'ABCD'].entries()) tr.feed({ key: ch, t: 10 + i * 5, target: 'B' });
  const r = tr.feed({ key: 'Enter', t: 40 });
  assert.equal(r.raw, 'ABCD');
  assert.equal(r.target, 'B');
});

test('🔴 Shift ที่เครื่องสแกนกดให้ตัวพิมพ์ใหญ่ ต้องไม่ตัดชุดสแกน', () => {
  const tr = createBurstTracker();
  let t = 0;
  for (const ch of 'PN-B') { tr.feed({ key: 'Shift', t }); tr.feed({ key: ch, t: t + 1 }); t += 5; }
  assert.equal(tr.feed({ key: 'Enter', t }).raw, 'PN-B');
});

test('ปุ่มพิเศษ (Tab) ล้างชุดที่สะสม', () => {
  const tr = createBurstTracker();
  tr.feed({ key: '1', t: 0 }); tr.feed({ key: '2', t: 5 });
  tr.feed({ key: 'Tab', t: 10 });
  tr.feed({ key: '3', t: 15 }); tr.feed({ key: '4', t: 20 });
  assert.equal(tr.feed({ key: 'Enter', t: 25 }).kind, 'enter');
});

const el = (tagName, props = {}, attrs = {}) => ({ tagName, ...props, hasAttribute: k => k in attrs, getAttribute: k => attrs[k] ?? null });

test('ช่องตัวเลข = type number หรือ inputMode numeric/decimal · data-scan-ok ยกเว้น', () => {
  assert.equal(isNumericField(el('INPUT', { type: 'number' })), true);
  assert.equal(isNumericField(el('INPUT', { type: 'text', inputMode: 'decimal' })), true);
  assert.equal(isNumericField(el('INPUT', { type: 'text' })), false);
  assert.equal(isNumericField(el('INPUT', { type: 'number' }, { 'data-scan-ok': '' })), false);
  assert.equal(isNumericField(el('SELECT')), false);
  assert.equal(isNumericField(null), false);
});

test('ช่องพิมพ์ได้ — checkbox/ปุ่ม/readOnly ไม่นับ', () => {
  assert.equal(isTypingField(el('INPUT', { type: 'text' })), true);
  assert.equal(isTypingField(el('INPUT', { type: 'checkbox' })), false);
  assert.equal(isTypingField(el('INPUT', { type: 'text', readOnly: true })), false);
  assert.equal(isTypingField(el('BUTTON')), false);
  assert.equal(isTypingField(el('TEXTAREA')), true);
});

const opts = [
  { id: '10092454', label: '10092454', lead: '52101-0K010', code: 'MAT 10092454' },
  { id: '1009245', label: '1009245', lead: '52101-0K020', code: 'MAT 1009245' },
  { id: '20000001', label: '20000001', lead: 'SAME-PN', code: 'MAT 20000001' },
  { id: '20000002', label: '20000002', lead: 'SAME-PN', code: 'MAT 20000002' },
];

test('🔴 สแกนต้องเลือกตัวที่ตรงเป๊ะ ไม่ใช่ตัวที่ "มีเลขนี้อยู่ข้างใน"', () => {
  assert.equal(exactScanMatch(opts, '1009245')?.id, '1009245');
  assert.equal(exactScanMatch(opts, '100924'), null, 'ไม่มีตัวตรงเป๊ะ = ไม่เลือก');
});

test('เทียบ Part No. ได้ · ขีด/ช่องว่าง/ตัวพิมพ์ไม่มีผล', () => {
  assert.equal(exactScanMatch(opts, '521010k010')?.id, '10092454');
});

test('ตัวเลือกนอกทะเบียน (history · เงาของคำที่สแกน) ไม่ทำให้ตัวจริงกลายเป็น "ตรงหลายตัว"', () => {
  const withEcho = [...opts, { id: 'hist:52101-0K020', label: '52101-0K020', history: true }];
  assert.equal(exactScanMatch(withEcho, '52101-0K020')?.id, '1009245');
});

test('🔴 รหัสตรงหลายตัว = ไม่เลือก (ให้คนเลือกเอง ห้ามเดา)', () => {
  assert.equal(exactScanMatch(opts, 'SAME-PN'), null);
});

test('scanOfEvent อ่านธงจาก native event (React ส่ง nativeEvent) · ไม่มีธง = null', () => {
  assert.equal(scanOfEvent({ nativeEvent: { __esmScan: 'X1' } }), 'X1');
  assert.equal(scanOfEvent({ nativeEvent: {} }), null);
  assert.equal(scanOfEvent(null), null);
});

/* ── ด่านโครงสร้าง: ของที่ทำให้ตัวดักทำงานจริง ห้ามหลุดตอน merge/refactor ── */
import { readFileSync } from 'node:fs';
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('🛡️ App ต้อง mount <ScanWedgeGuard/> ทั้ง 2 โครง (หน้า Home + หน้าอื่น) — หลุด = ปุ่มสแกนข้างเครื่องกลับไปลงช่องตัวเลขเงียบๆ', () => {
  const n = (src('App.jsx').match(/<ScanWedgeGuard\s*\/>/g) || []).length;
  assert.ok(n >= 2, `เจอ ${n} จุด`);
});

test('🛡️ SearchSelect ต้องเช็ค Enter ท้ายการสแกน (scanOfEvent + exactScanMatch) — หลุด = สแกนแล้วเลือกตัวที่ "มีเลขนี้อยู่ข้างใน"', () => {
  const s = src('components/SearchSelect.jsx');
  assert.match(s, /scanOfEvent\(e\)/);
  assert.match(s, /exactScanMatch\(/);
});

test('🔴 สติกเกอร์ของระบบ (ESM:M:<uuid> / ลิงก์ /scan?c=) สแกนลงช่องเลือกต้องเจอ — เดิมไม่ตรงอะไรเลย', () => {
  const machines = [{ id: 'a1b2-uuid', label: 'SW-10' }, { id: 'c3d4-uuid', label: 'SW-11' }];
  assert.equal(exactScanMatch(machines, 'ESM:M:a1b2-uuid')?.label, 'SW-10');
  assert.equal(exactScanMatch(machines, 'https://esm.example.com/scan?c=ESM:M:c3d4-uuid')?.label, 'SW-11');
  assert.equal(exactScanMatch(machines, 'SW10')?.label, 'SW-10', 'เลขเปล่าบนป้ายเดิมยังใช้ได้');
  const parts = [{ id: 7, label: '10092454', lead: 'PN-A' }];
  assert.equal(exactScanMatch(parts, 'ESM:P:10092454')?.id, 7);
});

test('บัตรพนักงานสแกนลงช่องเลือกคนได้ (employee_code) · scanKeys ไม่ต้องโชว์บนจอก็สแกนเจอ', () => {
  const people = [{ id: 'e:1', label: 'สมชาย', employee_code: '2101864' }, { id: 'p:9', label: 'สมหญิง' }];
  assert.equal(exactScanMatch(people, '2101864')?.id, 'e:1');
  assert.equal(exactScanMatch([{ id: 'x', label: 'โกดัง A', scanKeys: ['WH-A'] }], 'wh a')?.id, 'x');
});
