import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PANEL_NPI_MAP, npiLinkFor, linkedPanelCount, daysToSop, summarizeNpi, boardOptions,
} from '../nmNpiLink.js';

const NOW = new Date('2026-10-06T10:00:00');   // ตรึงเวลา — กันเทสระเบิดเวลา (CLAUDE.md)
const PROJ = { id: 'p1', project_code: 'NPI-2026-001', name: 'P703', customer: 'FORD', model: 'P703', sop_date: '2026-11-29' };

test('npiLinkFor — แผงที่ NPI ไม่มีของ ต้องคืน null (ห้ามวาดปุ่มที่กดไปแล้วไม่เจออะไร)', () => {
  assert.equal(npiLinkFor('organization', 'p1'), null);
  assert.equal(npiLinkFor('meeting-minutes', 'p1'), null);
  assert.ok(npiLinkFor('tooling-schedule', 'p1').href.includes('tab=tooling'));
});

test('npiLinkFor — ยังไม่ผูกโปรเจค = null ทุกแผง (ห้ามลิงก์ไป /npi ลอยๆ)', () => {
  for (const k of Object.keys(PANEL_NPI_MAP)) assert.equal(npiLinkFor(k, ''), null);
  assert.equal(npiLinkFor('tooling-schedule', null), null);
});

test('npiLinkFor — id ต้องถูก encode (กันรหัสที่มีอักขระพิเศษทำลิงก์พัง)', () => {
  assert.ok(npiLinkFor('kadai', 'a b&c').href.includes('project=a%20b%26c'));
});

test('linkedPanelCount — นับเฉพาะแผงที่มีของจริงใน NPI', () => {
  assert.equal(linkedPanelCount([{ key: 'tooling-schedule' }, { key: 'organization' }, { key: 'kadai' }]), 2);
  assert.equal(linkedPanelCount([]), 0);
  assert.equal(linkedPanelCount(null), 0);
});

test('daysToSop — ไม่มีวัน SOP = null ห้ามคืน 0', () => {
  assert.equal(daysToSop(null, NOW), null);
  assert.equal(daysToSop('', NOW), null);
  assert.equal(daysToSop('ไม่ใช่วันที่', NOW), null);
});

test('daysToSop — เลยกำหนดแล้วต้องติดลบ ไม่ใช่ 0', () => {
  assert.equal(daysToSop('2026-10-06', NOW), 0);        // วันนี้พอดี = 0 (จริง ไม่ใช่ "ไม่รู้")
  assert.equal(daysToSop('2026-10-16', NOW), 10);
  assert.ok(daysToSop('2026-09-26', NOW) < 0);
});

test('🔴 summarizeNpi — ข้อมูลที่ยังไม่ได้โหลด = null ห้ามกลายเป็น 0', () => {
  const s = summarizeNpi({ project: PROJ, now: NOW });
  assert.equal(s.parts, null);
  assert.equal(s.docTotal, null);
  assert.equal(s.docPct, null);
  assert.equal(s.eciOpen, null);
  assert.equal(s.sopIn, 54);
});

test('summarizeNpi — ไม่มีโปรเจค = null ทั้งก้อน (จอจะได้เขียนว่ายังไม่ผูก)', () => {
  assert.equal(summarizeNpi({ now: NOW }), null);
  assert.equal(summarizeNpi(), null);
});

test('summarizeNpi — 0 รายการเอกสาร ต้องได้ docPct = null ไม่ใช่ 0% (หารศูนย์)', () => {
  const s = summarizeNpi({ project: PROJ, deliverables: [], now: NOW });
  assert.equal(s.docTotal, 0);
  assert.equal(s.docDone, 0);
  assert.equal(s.docPct, null);
});

test('summarizeNpi — นับเอกสาร/ECI/PPAP ตามกติกา', () => {
  const s = summarizeNpi({
    project: PROJ,
    parts: [{ ppap_status: 'approved' }, { ppap_status: 'submitted' }, {}],
    deliverables: [{ status: 'approved' }, { status: 'done' }, { status: 'open' }, { status: 'open' }],
    ecis: [{ status: 'open' }, { status: 'evaluating' }, { status: 'implemented' }, { status: 'rejected' }],
    now: NOW,
  });
  assert.equal(s.parts, 3);
  assert.equal(s.ppapApproved, 1);          // พาร์ทที่ยังไม่ตั้งสถานะ ไม่นับเป็น "ไม่ผ่าน"
  assert.equal(s.docDone, 2);
  assert.equal(s.docPct, 50);
  assert.equal(s.eciOpen, 2);               // implemented/rejected = จบแล้ว
  assert.equal(s.eciTotal, 4);
});

test('🔴 boardOptions — เรียงตัวที่น่าจะใช่ขึ้นก่อน แต่ห้ามเลือกให้เอง (คืนทุกตัวเสมอ)', () => {
  const board = [
    { id: 'd02d-tmt', title: 'D02D', customer: 'toyota' },
    { id: '737d-mlm', title: '737D MLM', customer: 'toyota' },
    { id: 'x', title: 'X1', customer: 'ford' },
  ];
  const opts = boardOptions(board, { customer: 'toyota', model: '737D' });
  assert.equal(opts.length, 3, 'ต้องคืนครบทุกตัว — คนเป็นคนเลือก ระบบแค่เรียงให้');
  assert.equal(opts[0].id, '737d-mlm');
  assert.equal(opts[0].hint, 'ลูกค้าและชื่อรุ่นตรงกัน');
  assert.ok(opts.some(o => o.hint === null), 'ตัวที่ไม่เกี่ยวต้องไม่มี hint หลอก');
});

test('boardOptions — ไม่มีลูกค้า/รุ่นให้เทียบ ก็ยังคืนรายการได้ ไม่ระเบิด', () => {
  const opts = boardOptions([{ id: 'a', title: 'A' }], {});
  assert.equal(opts.length, 1);
  assert.equal(opts[0].hint, null);
  assert.deepEqual(boardOptions(null, {}), []);
});
