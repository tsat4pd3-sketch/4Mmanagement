/* เทส csvDoc — ชื่อไฟล์ของเอกสารที่ "ไม่มีหัวกระดาษ" (CSV / Excel)
   โจทย์ที่ต้องผ่าน:
   1. 🔴 ทะเบียนยังไม่ตั้งเลขฟอร์ม = **ชื่อไฟล์เดิมเป๊ะ** ⇒ วันที่ apply migration ไม่มีอะไรเปลี่ยน
      (หลักเดียวกับ `withDocFoot` ของใบพิมพ์ — ของใหม่ต้อง no-op จนกว่า doc_control จะตั้งค่า)
   2. ตั้งเลขฟอร์ม/Rev แล้ว = นำหน้าชื่อไฟล์ ไม่แตะส่วนบริบท (ช่วงวันที่/ไลน์) ที่หน้าส่งมา
   3. 🔴 กัน formula injection — ค่าที่คนพิมพ์ขึ้นต้น `=` `+` `-` `@` ถูก Excel รันเป็นสูตร
      **ยกเว้นตัวเลขติดลบจริง** (`-5` ไม่ใช่สูตร — ถ้า quote ทิ้งจะกลายเป็นข้อความ พัง SUM ของผู้ใช้)
   4. ตัวอักษรที่ตั้งชื่อไฟล์ไม่ได้บน Windows/macOS ต้องถูกแทน (ชื่อฟอร์มที่คนพิมพ์ `/` มาได้) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docFileNameFrom, csvCell, csvText } from '../csvCore.js';

/* ทะเบียนว่าง = เคสจริงวันที่ apply migration (ยังไม่มีใครตั้งเลขฟอร์ม) */
const csvDocName = (k, n) => docFileNameFrom({}, n, 'csv', k);
const xlsxDocName = (k, n) => docFileNameFrom({}, n, 'xlsx', k);
const docFileName = (k, n, e) => docFileNameFrom({}, n, e, k);

test('🔴 ทะเบียนว่าง (ยังไม่ apply/ยังไม่ตั้งเลข) = ชื่อไฟล์เดิมเป๊ะ', () => {
  // cache ของ docForms ยังไม่ถูกโหลดในบริบทเทส ⇒ docFormSync คืน fallback ว่าง = เคสจริงวันที่ apply
  assert.equal(csvDocName('csv_daily_checkin', 'daily_2026-10-08_day'), 'daily_2026-10-08_day.csv');
  assert.equal(xlsxDocName('xlsx_cqi15_event_log', 'CQI15_EventLog_2026-10-08'), 'CQI15_EventLog_2026-10-08.xlsx');
});

test('ส่งชื่อมาพร้อมนามสกุลแล้ว ต้องไม่ซ้ำนามสกุล', () => {
  assert.equal(csvDocName('k', 'report_2026.csv'), 'report_2026.csv');
  assert.equal(xlsxDocName('k', 'book.xlsx'), 'book.xlsx');
  // นามสกุลอื่นที่ไม่ใช่ของตัวเอง = ถือเป็นส่วนของชื่อ ไม่ตัด
  assert.equal(csvDocName('k', 'book.xlsx'), 'book.xlsx.csv');
});

test('ไม่ส่งชื่อมา = ใช้ doc_key เป็นชื่อ (ห้ามได้ไฟล์ชื่อ ".csv")', () => {
  assert.equal(csvDocName('csv_thing'), 'csv_thing.csv');
  assert.equal(csvDocName('csv_thing', ''), 'csv_thing.csv');
  assert.equal(csvDocName('csv_thing', null), 'csv_thing.csv');
});

test('ตัวอักษรที่ตั้งชื่อไฟล์ไม่ได้ ต้องถูกแทน', () => {
  // ชื่อฟอร์ม/ไลน์ที่คนพิมพ์ `/` `:` `?` มาได้ ⇒ ดาวน์โหลดล้มถ้าไม่ล้าง
  const n = csvDocName('k', 'station_A/B:C?D*E"F<G>H|I');
  assert.ok(!/[\\/:*?"<>|]/.test(n), n);
  assert.ok(n.endsWith('.csv'));
});

test('docFileName รับนามสกุลอะไรก็ได้ (ตัวเดียวที่ 2 helper เรียกใช้)', () => {
  assert.equal(docFileName('k', 'x', 'tsv'), 'x.tsv');
  assert.equal(docFileName('k', 'x.tsv', 'tsv'), 'x.tsv');
});

test('🔴 csvCell กัน formula injection แต่ไม่แตะตัวเลขติดลบจริง', () => {
  for (const bad of ['=SUM(A1)', '+1+1', '@foo', '-SUM(A1)', '=cmd|']) {
    assert.ok(csvCell(bad).startsWith("'"), bad);
  }
  for (const num of ['-5', '-5.25', '0', '12345']) {
    assert.equal(csvCell(num), num);        // quote ทิ้ง = กลายเป็นข้อความ พัง SUM ของผู้ใช้
  }
});

test('csvCell escape ตามมาตรฐาน CSV (comma / quote / newline)', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell('line1\r\nline2'), '"line1\r\nline2"');
  assert.equal(csvCell('plain'), 'plain');
});

test('csvCell: null/undefined = ช่องว่าง (ห้ามได้คำว่า "null" ในไฟล์)', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');            // 0 ต้องไม่หาย
  assert.equal(csvCell(false), 'false');
});

test('csvText ประกอบหัว + แถว และ escape ทุกช่อง', () => {
  const out = csvText(['ชื่อ', 'หมายเหตุ'], [['ก', '=1+1'], ['ข,ค', null]]);
  assert.equal(out, 'ชื่อ,หมายเหตุ\nก,\'=1+1\n"ข,ค",');
});

test('csvText: ไม่มีแถว = เหลือแค่บรรทัดหัว', () => {
  assert.equal(csvText(['a', 'b'], []), 'a,b');
});

test('ตั้งเลขฟอร์ม/Rev แล้ว = นำหน้าชื่อไฟล์ ไม่แตะส่วนบริบทที่หน้าส่งมา', () => {
  assert.equal(docFileNameFrom({ form_code: 'FM-HR-001' }, 'attendance_2026_10_p1', 'csv'),
    'FM-HR-001_attendance_2026_10_p1.csv');
  assert.equal(docFileNameFrom({ form_code: 'FM-HR-001', rev: '03' }, 'attendance_2026_10_p1', 'csv'),
    'FM-HR-001_Rev03_attendance_2026_10_p1.csv');
  // มี rev แต่ไม่มี form_code = ใส่แค่ rev (ห้ามมี separator ค้างหน้าชื่อ)
  assert.equal(docFileNameFrom({ rev: '02' }, 'x', 'csv'), 'Rev02_x.csv');
});

test('เลขฟอร์มที่คนพิมพ์ตัวอักษรห้ามใช้มา ต้องถูกล้างด้วย', () => {
  const n = docFileNameFrom({ form_code: 'FM/PD:01' }, 'x', 'csv');
  assert.ok(!/[\\/:*?"<>|]/.test(n), n);
});
