/* 🏛️ obeyaLive — บอร์ดสถานะ OBEYA สดบนผังรวมโรงงาน (/factory-map แผงขวา · 2026-09-22)

   เทสชุดนี้ล็อก "กฎความซื่อสัตย์ของจอ" เป็นหลัก ไม่ใช่แค่เลขถูก:
   หัวข้อที่ตัดสินไม่ได้ ต้องไม่กลายเป็นเขียว · ไม่กลายเป็น 0 · และไฟรวมต้องบอกจำนวนหัวข้อที่ตัดสินเสมอ
   (จอที่ยืนยันสิ่งที่ไม่จริง แย่กว่าจอที่ว่าง — OBEYA-DESIGN §4) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAT_TO_STATUS, catToStatus, STATUS_RANK, PPE_TARGET, ppeStatus,
  LIVE_AXES, NO_JUDGE_NOTE, NOT_LIVE_NOTE, rollupAxis, boardOverall, SAFETY_PROXY_NOTE,
} from '../obeyaLive.js';

const SRC = new URL('../obeyaLive.js', import.meta.url);

/* ── แปลง cat ของผัง → สถานะบอร์ด ─────────────────────────────────────────── */
test('idle / waiting = ตัดสินไม่ได้ ห้ามนับเป็นเขียว', () => {
  assert.equal(catToStatus('idle'), 'none');
  assert.equal(catToStatus('waiting'), 'none');
  assert.equal(catToStatus('ไม่รู้จัก'), 'none');
  assert.equal(catToStatus(undefined), 'none');
});

test('down (เครื่องหยุดอยู่) = แดง · busy (กำลังทำ PM ตามแผน) = เขียว', () => {
  assert.equal(catToStatus('down'), 'bad');
  assert.equal(catToStatus('busy'), 'good');
  assert.equal(catToStatus('ok'), 'warn');
});

test('ทุก cat ของผังต้องมีที่ลงในตารางแปลง (ไม่งั้นสถานะหล่นเป็น none เงียบๆ)', () => {
  // รายชื่อนี้ = key ของ CAT ใน src/pages/FactoryMap.jsx
  ['good', 'ok', 'bad', 'down', 'idle', 'waiting', 'busy']
    .forEach(c => assert.ok(CAT_TO_STATUS[c], `cat "${c}" ยังไม่มีในตารางแปลง`));
});

/* ── PPE (แกน S) ─────────────────────────────────────────────────────────── */
test('ไม่มีคนมาทำงาน = ตัดสินไม่ได้ ห้ามคืน 100% หรือ 0%', () => {
  const r = ppeStatus({ present: 0, ppeBad: 0 });
  assert.equal(r.status, 'none');
  assert.equal(r.pct, null);
});

test('PPE ครบทุกคน = เขียว · ขาดเกิน 5% = แดง · ขาดไม่เกิน 5% = เหลือง', () => {
  assert.equal(ppeStatus({ present: 20, ppeBad: 0 }).status, 'good');
  assert.equal(ppeStatus({ present: 100, ppeBad: 3 }).status, 'warn');   // 97% ของเป้า 100
  assert.equal(ppeStatus({ present: 100, ppeBad: 20 }).status, 'bad');
  assert.equal(PPE_TARGET, 100, 'เป้า PPE ต้องเท่ากับ axisSafety บนจอ SQDCM');
});

test('ppeBad มากกว่าคนที่มา ต้องไม่ทำให้ % ติดลบ', () => {
  const r = ppeStatus({ present: 5, ppeBad: 99 });
  assert.equal(r.pct, 0);
  assert.equal(r.bad, 5);
});

/* ── rollupAxis ──────────────────────────────────────────────────────────── */
const rows = (...arr) => arr.map(([name, status]) => ({ name, status, text: name }));

test('ไฟของหัวข้อ = ไลน์ที่แย่ที่สุด (Andon) ไม่ใช่ค่าเฉลี่ย', () => {
  const a = rollupAxis({ key: 'Q', rows: rows(['L1', 'good'], ['L2', 'good'], ['L3', 'bad']) });
  assert.equal(a.status, 'bad');
  assert.deepEqual(a.counts, { good: 2, warn: 0, bad: 1, none: 0 });
  assert.equal(a.judged, 3);
});

test('มีแต่ none = ตัดสินไม่ได้ + ต้องมีข้อความอธิบาย ห้ามเขียว', () => {
  const a = rollupAxis({ key: 'D', rows: rows(['L1', 'none'], ['L2', 'none']) });
  assert.equal(a.status, 'none');
  assert.equal(a.judged, 0);
  assert.equal(a.note, NO_JUDGE_NOTE);
  assert.ok(/ไม่ใช่ว่าผลเป็นศูนย์/.test(a.note), 'ต้องบอกว่าไม่ใช่ศูนย์');
});

test('none ปนกับ good = เขียวได้ แต่ต้องนับ none ไว้ให้จอโชว์', () => {
  const a = rollupAxis({ key: 'M', rows: rows(['L1', 'good'], ['L2', 'none']) });
  assert.equal(a.status, 'good');
  assert.equal(a.counts.none, 1);
  assert.equal(a.judged, 1);
  assert.equal(a.total, 2);
});

test('หัวข้อที่ดูสดไม่ได้ = เทาเสมอ และห้ามมีตัวเลขหลุดออกไป', () => {
  const a = rollupAxis({ key: 'C', live: false, value: '1,234 บาท', sub: 'x', note: NOT_LIVE_NOTE('ไม่มีอัตราค่าแรง') });
  assert.equal(a.status, 'none');
  assert.equal(a.value, null, 'live:false แล้วต้องไม่โชว์ตัวเลขที่คำนวณไม่ได้');
  assert.equal(a.sub, null);
  assert.ok(a.note.includes('ดูสดจากผังรวมไม่ได้'));
});

test('drill-down เรียงแดงก่อนเหลือง และไม่เอาเขียว/เทามาปน', () => {
  const a = rollupAxis({ key: 'Q', rows: rows(['b', 'warn'], ['a', 'bad'], ['c', 'good'], ['d', 'none'], ['e', 'bad']) });
  assert.deepEqual(a.problems.map(p => p.name), ['a', 'e', 'b']);
  assert.equal(STATUS_RANK.bad > STATUS_RANK.warn, true);
});

/* ── ไฟรวม ───────────────────────────────────────────────────────────────── */
test('ไฟรวมต้องบอกเสมอว่าตัดสินจากกี่หัวข้อ (เขียวจาก 2/6 ≠ เขียวจาก 6/6)', () => {
  const axes = [
    rollupAxis({ key: 'OEE', rows: rows(['L1', 'good']) }),
    rollupAxis({ key: 'S', rows: rows(['L1', 'good']) }),
    rollupAxis({ key: 'C', live: false, note: NOT_LIVE_NOTE('x') }),
  ];
  const ov = boardOverall(axes);
  assert.equal(ov.status, 'good');
  assert.equal(ov.judged, 2);
  assert.equal(ov.total, 3);
  assert.ok(ov.note.includes('2/3'), `ต้องบอกจำนวนหัวข้อ — ได้ "${ov.note}"`);
  assert.ok(ov.note.includes('อีก 1 หัวข้อ'), 'ต้องบอกว่ามีหัวข้อที่ตัดสินไม่ได้เหลืออยู่');
});

test('หัวข้อเทาห้ามลากไฟรวมให้เป็นเขียว และทุกหัวข้อเทา = ไฟรวมเทา', () => {
  const ov = boardOverall([
    rollupAxis({ key: 'C', live: false, note: 'x' }),
    rollupAxis({ key: 'D', rows: rows(['L1', 'none']) }),
  ]);
  assert.equal(ov.status, 'none');
  assert.equal(ov.judged, 0);
});

test('หัวข้อเดียวแดง = ไฟรวมแดง (ห้ามถูกกลบด้วยเขียวที่เหลือ)', () => {
  const ov = boardOverall([
    rollupAxis({ key: 'OEE', rows: rows(['L1', 'good']) }),
    rollupAxis({ key: 'Q', rows: rows(['L2', 'bad']) }),
    rollupAxis({ key: 'M', rows: rows(['L3', 'good']) }),
  ]);
  assert.equal(ov.status, 'bad');
});

/* ── ลำดับหัวข้อ ─────────────────────────────────────────────────────────── */
test('ลำดับบนบอร์ด = OEE แล้วตามด้วย SQDCM ตามลำดับเดิม (ห้ามสลับ)', () => {
  assert.deepEqual(LIVE_AXES.map(a => a.key), ['OEE', 'S', 'Q', 'D', 'C', 'M']);
  LIVE_AXES.forEach(a => {
    assert.ok(a.icon && a.label, `${a.key} ต้องมี icon + label สำหรับจอ`);
  });
});

test('ข้อความกำกับแกน S มาจาก obeyaKpi จุดเดียว (ห้ามพิมพ์ซ้ำคนละสำนวน)', () => {
  assert.ok(SAFETY_PROXY_NOTE.includes('ยังไม่มีทะเบียนอุบัติเหตุ'));
  const src = readFileSync(SRC, 'utf8');
  assert.ok(/import\s*\{[^}]*SAFETY_PROXY_NOTE[^}]*\}\s*from\s*'\.\/obeyaKpi\.js'/.test(src),
    'ต้อง import มาจาก obeyaKpi.js ไม่ใช่เขียนสตริงใหม่');
});

/* ── 🛡️ ด่านกันของเก่ากลับมา ────────────────────────────────────────────── */
test('🛡️ obeyaLive.js ห้ามตั้งเกณฑ์สี/สีสถานะชุดใหม่ของตัวเอง', () => {
  const src = readFileSync(SRC, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')       // ตัดคอมเมนต์ก้อน
    .replace(/\/\/[^\n]*/g, ' ');            // ตัดคอมเมนต์บรรทัด
  const hex = src.match(/#[0-9a-fA-F]{6}/g) || [];
  // สีประจำหัวข้อ OEE (ไม่ใช่สีสถานะ) อนุญาต 1 ตัว — สถานะต้องมาจาก statusColor() ของ obeyaKpi
  assert.ok(hex.length <= 1, `เจอโค้ดสีในไฟล์ ${hex.length} จุด (${hex.join(', ')}) — สีสถานะต้องใช้ statusColor() ของ obeyaKpi.js`);
  assert.ok(!/\b(?:>=|<=|>|<)\s*(?:80|95|99|65|20)\b/.test(src),
    'เจอการเทียบตัวเลขเกณฑ์ในไฟล์นี้ — เกณฑ์ต้องยืมจาก METRICS ของผัง หรือ statusOf() ของ obeyaKpi');
});

test('🛡️ แผงขวาของผังรวมโรงงานต้องยืมเกณฑ์จาก METRICS ไม่ใช่ตั้งเอง', () => {
  const fm = readFileSync(new URL('../../pages/FactoryMap.jsx', import.meta.url), 'utf8');
  assert.ok(fm.includes('catToStatus(Mx.cat(st))'),
    'บอร์ด OBEYA ต้องแปลงสถานะจาก METRICS.<x>.cat ของผังเอง (กฎเดียวกับแท็บ 🚦 สุขภาพรวม)');
  assert.ok(/import \{[^}]*\bstatusColor\b/.test(fm),
    'สีสถานะบนบอร์ดต้องมาจาก statusColor() ของ obeyaKpi.js');
});
