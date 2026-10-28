import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineProcessTypes, typeFitsLine, defaultSheetPicks } from '../scanSheet.js';
import { buildScanSheetHtml } from '../../lib/scanSheetPrint.js';
import { parseQrPayload } from '../qrCode.js';

const machines = [
  { line_name: 'LINE 60', process_type: 'metal_forming', equipment_kind: 'machine' },
  { line_name: 'LINE 60-A', process_type: 'welding_assembly', equipment_kind: 'machine' },
  { line_name: 'LINE 99', process_type: 'painting', equipment_kind: 'machine' },
];

test('กระบวนการของไลน์ = ของเครื่องในครอบครัวไลน์ (แม่+ลูก) ไม่ใช่ทั้งโรงงาน', () => {
  const pts = lineProcessTypes(machines, ['LINE 60', 'line 60-a']);
  assert.ok(pts.has('metal_forming') && pts.has('welding_assembly'));
  assert.equal(pts.has('painting'), false);
});

test('ติ๊กให้ก่อน = ของไลน์นี้ + ประเภทกลาง (ไม่ผูก process / common) · กติกาเดียวกับ dropdown Daily Report', () => {
  const pts = new Set(['metal_forming']);
  const types = [
    { id: 1, process_type: 'metal_forming' }, { id: 2, process_type: null }, { id: 3, process_type: 'common' },
    { id: 4, process_type: 'painting' }, { id: 5, process_type: 'metal_forming', is_active: false },
  ];
  assert.deepEqual([...defaultSheetPicks(types, pts)].sort(), ['1', '2', '3']);
  assert.equal(typeFitsLine({ process_type: 'painting' }, pts), false);
});

test('ใบสแกน: QR ไลน์/Downtime/งานเสีย เป็นรหัสระบบที่แอปอ่านกลับได้ · ชื่อถูก escape', async () => {
  const payloads = [];
  const html = await buildScanSheetHtml({
    line: { id: 12, name: 'LINE <60>' },
    downtime: [{ id: 'u1', name_th: 'เครื่องเสีย', category: 'unplanned' }, { id: 'u2', name_th: 'PM', category: 'planned' }],
    defects: [{ id: 'x1', name_th: 'รอยบุบ' }],
    toSvg: async (p) => { payloads.push(p); return '<svg/>'; },
  });
  assert.deepEqual(payloads.map(p => { const q = parseQrPayload(p); return `${q.kind}:${q.id}`; }).sort(),
    ['defect_type:x1', 'downtime_type:u1', 'downtime_type:u2', 'line:12']);
  assert.ok(html.includes('LINE &lt;60&gt;') && !html.includes('LINE <60>'));
  assert.ok(html.includes('ในแผน'), 'Downtime ในแผนต้องติดป้ายให้เห็น');
});
