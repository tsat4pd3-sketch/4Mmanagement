import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mailsMissingFiles, subjectKinds, mailFileKind } from '../mailInbox.js';

test('หัวเรื่องบอก 830 & 862 แต่ได้แค่ 830 → ขาด 862 (เคสจริง 05/10)', () => {
  const r = mailsMissingFiles([
    { message_id: 'm3', subject: 'FTM_AAT_ 830 & 862_05.10.2026', file_name: '830_05.10.26.xlsm', received_at: '2026-10-05T01:02:14Z' },
    { message_id: 'm1', subject: 'FTM_AAT_ 830 & 862_30.09.2026', file_name: '830_28.09.26.xlsm', received_at: '2026-09-30T01:10:41Z' },
    { message_id: 'm1', subject: 'FTM_AAT_ 830 & 862_30.09.2026', file_name: '862_30.09.26.xlsm', received_at: '2026-09-30T01:10:41Z' },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].missing, ['862']);
  assert.deepEqual(r[0].got, ['830']);
});

test('ตัวเลขในวันที่/เลขอื่นไม่ถูกนับเป็นชนิด · หัวเรื่องไม่ระบุ = ไม่เตือน', () => {
  assert.deepEqual(subjectKinds('report 18620 / 8300'), []);
  assert.deepEqual(subjectKinds('FTM_AAT_ 830 & 862_02.10.2026').sort(), ['830', '862']);
  assert.deepEqual(mailsMissingFiles([{ message_id: 'x', subject: 'Forecast', file_name: '830_x.xlsm' }]), []);
  assert.equal(mailFileKind('862 05.10.26.xlsm'), '862');
});
