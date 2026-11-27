import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLang } from '../i18n.js';
import { fmtDateMedium, fmtDateLabel, fmtDate, fmtDateFull, fmtDateTime, monthsShort, yearDisplay, MONTHS_SHORT_TH } from '../dateFormat.js';
import { dateLocale } from '../i18n.js';

/* กฎ (คำสั่ง user 2026-11-24): โหมดไทย = ชื่อเดือนไทย + ปี พ.ศ. · โหมดอังกฤษ = ชื่อเดือนอังกฤษ + ปี ค.ศ. */
test('🌐 วันที่ตามภาษา — ไทย พ.ศ. · อังกฤษ ค.ศ.', () => {
  const d = new Date(2026, 7, 4);          // 4 ส.ค. 2026 (ตรึง ไม่พึ่งนาฬิกา)
  setLang('th');
  assert.equal(fmtDateMedium(d), '04 ส.ค. 69');
  assert.equal(fmtDate(d), '04/08/69');
  assert.equal(fmtDateFull(d), '04/08/2569');
  assert.equal(fmtDateTime(new Date(2026, 7, 4, 14, 30)), '04/08/69 14:30');
  assert.equal(fmtDateLabel(d), '04 ส.ค.');
  assert.equal(yearDisplay(2026), 2569);
  assert.equal(dateLocale(), 'th-TH');
  assert.deepEqual(monthsShort(), MONTHS_SHORT_TH);
  setLang('en');
  assert.equal(fmtDateMedium(d), '04 Aug 26');
  assert.equal(fmtDate(d), '04/08/26');
  assert.equal(fmtDateFull(d), '04/08/2026');
  assert.equal(fmtDateLabel(d), '04 Aug');
  assert.equal(yearDisplay(2026), 2026);
  assert.equal(dateLocale(), 'en-GB');
  assert.equal(monthsShort()[0], 'Jan');
  setLang('th');
});
