/* ═══ ✍️ รหัสพนักงาน → ชื่อ + ลายเซ็น สำหรับเอกสาร export (2026-11-03 · ประชุม 02/11 C1) ═══ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { signerFromRows, signatureOfPerson, isMissingColumnError, loadEmployeeSigners, resolveEmployeeSigner } from '../employeeSignature.js';

const ROWS = [
  { id: 'e1', employee_id_code: '2101864', name: 'สมชาย', signature_url: 'https://x/signatures/emp/e1/1.png' },
  { id: 'e2', employee_id_code: 'SUB-0007', name: 'ผู้รับเหมา', signature_url: null },
  { id: 'e3', employee_id_code: 'D1', name: 'ก' },
  { id: 'e4', employee_id_code: 'd 1', name: 'ข' },
];

test('สแกนบัตร/พิมพ์รหัส: ปรับรูปแล้วตรงเป๊ะ = ได้ชื่อ + ลายเซ็น', () => {
  const s = signerFromRows(' 2101864\n', ROWS);
  assert.equal(s.state, 'ok');
  assert.equal(s.name, 'สมชาย');
  assert.equal(s.signatureUrl, 'https://x/signatures/emp/e1/1.png');
  assert.equal(signerFromRows('sub 0007', ROWS).name, 'ผู้รับเหมา', 'ผู้รับเหมาพิมพ์ตัวเล็ก/เว้นวรรคได้');
});

test('ไม่มีลายเซ็น / ไม่พบ / ซ้ำ / ว่าง — แต่ละแบบมีสถานะของตัวเอง และไม่คืนสตริงว่างเป็น URL', () => {
  const ns = signerFromRows('SUB0007', ROWS);
  assert.equal(ns.state, 'no_signature'); assert.equal(ns.signatureUrl, null); assert.ok(ns.note);
  assert.equal(signerFromRows('999', ROWS).state, 'not_found');
  assert.equal(signerFromRows('D1', ROWS).state, 'ambiguous', 'รหัสซ้ำหลังปรับรูป = ไม่เดา');
  assert.equal(signerFromRows('', ROWS).state, 'no_code');
  assert.equal(signerFromRows('2101', ROWS).state, 'not_found', 'ห้ามจับแบบมีเลขนี้อยู่ข้างใน');
});

test('คอลัมน์ยังไม่ apply = unknown (ไม่ใช่ "ไม่มีลายเซ็น") แต่ยังได้ชื่อ', () => {
  const s = signerFromRows('2101864', ROWS, { sigColumnMissing: true });
  assert.equal(s.state, 'unknown');
  assert.equal(s.name, 'สมชาย');
  assert.equal(s.signatureUrl, null);
});

test('ลำดับลายเซ็น: โปรไฟล์ → ฐานพนักงาน → ค่าที่ใบเก็บไว้ → null', () => {
  assert.equal(signatureOfPerson({ profileSig: 'p', employeeSig: 'e', stored: 's' }), 'p');
  assert.equal(signatureOfPerson({ profileSig: '', employeeSig: 'e', stored: 's' }), 'e');
  assert.equal(signatureOfPerson({ employeeSig: '  ', stored: 's' }), 's');
  assert.equal(signatureOfPerson({}), null);
});

test('isMissingColumnError รู้จักทั้ง 42703 และ PGRST204', () => {
  assert.ok(isMissingColumnError({ code: '42703' }));
  assert.ok(isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'signature_url' column" }));
  assert.ok(!isMissingColumnError({ code: '42501' }));
  assert.ok(!isMissingColumnError(null));
});

/* client ปลอม: จำลอง "คอลัมน์ยังไม่ apply" แล้วตรวจว่าโหลดซ้ำแบบไม่มีคอลัมน์ + ติดธงบอก */
function fakeClient({ missingCol = false, fail = false } = {}) {
  return {
    from: () => ({
      select: (sel) => ({
        in: async (col, vals) => {
          if (fail) return { data: null, error: { code: '500', message: 'boom' } };
          if (missingCol && sel.includes('signature_url')) return { data: null, error: { code: '42703', message: 'column employees.signature_url does not exist' } };
          const key = col === 'id' ? 'id' : 'employee_id_code';
          return { data: ROWS.filter(r => vals.includes(r[key])), error: null };
        },
      }),
    }),
  };
}

test('loader: คอลัมน์ขาด = ถอยไปโหลดแบบไม่มีลายเซ็น + ธง sigColumnMissing (ไม่ล้ม)', async () => {
  const r = await loadEmployeeSigners(fakeClient({ missingCol: true }), { codes: ['2101864'] });
  assert.equal(r.sigColumnMissing, true);
  assert.equal(r.error, null);
  assert.equal(r.rows.length, 1);
  const s = await resolveEmployeeSigner(fakeClient({ missingCol: true }), '2101864');
  assert.equal(s.state, 'unknown');
});

test('loader: อ่านไม่ได้จริง = error ส่งกลับ (ห้ามกลืนเป็นลิสต์ว่าง)', async () => {
  const r = await loadEmployeeSigners(fakeClient({ fail: true }), { codes: ['x'] });
  assert.ok(r.error);
  const s = await resolveEmployeeSigner(fakeClient({ fail: true }), '2101864');
  assert.equal(s.state, 'unknown');
  assert.ok(s.error);
  const none = await loadEmployeeSigners(fakeClient(), {});
  assert.deepEqual(none, { rows: [], sigColumnMissing: false, error: null });
});

test('loader: ค้นด้วย id ได้ (บัญชีที่ผูก employee_id)', async () => {
  const r = await loadEmployeeSigners(fakeClient(), { ids: ['e1'] });
  assert.equal(r.rows[0].signature_url, 'https://x/signatures/emp/e1/1.png');
});

test('inspectorForExport — มีรหัส = คนตามรหัสเซ็น · ห้ามถอยไปลายเซ็นบัญชีกลาง', async () => {
  const { inspectorForExport } = await import('../employeeSignature.js');
  const acc = { accountName: 'บัญชีกลาง', accountSig: 'acc.png' };
  assert.deepEqual(inspectorForExport({ ...acc }), { name: 'บัญชีกลาง', signatureUrl: 'acc.png', source: 'account', note: '' });
  const ok = inspectorForExport({ ...acc, code: '61234', signer: { state: 'ok', name: 'สมชาย', signatureUrl: 'emp.png', note: '' } });
  assert.equal(ok.name, 'สมชาย'); assert.equal(ok.signatureUrl, 'emp.png'); assert.equal(ok.source, 'code');
  for (const state of ['no_signature', 'not_found', 'ambiguous', 'unknown']) {
    const r = inspectorForExport({ ...acc, code: '61234', signer: { state, name: state === 'no_signature' ? 'สมชาย' : null, note: 'x' } });
    assert.equal(r.signatureUrl, null, `${state}: ห้ามเอาลายเซ็นบัญชีกลางมาแทน`);
    assert.ok(r.note, `${state}: ต้องมีเหตุผล`);
    assert.ok(r.name && r.name !== 'บัญชีกลาง', `${state}: ชื่อต้องไม่ใช่บัญชีกลาง`);
  }
});
