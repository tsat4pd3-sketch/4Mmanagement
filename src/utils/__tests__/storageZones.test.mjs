// เทสสูตรโซนคลัง (WMS เฟส 1) — ล็อกกฎ "ไม่รู้ = null ห้ามเป็น 0" + เกณฑ์สถานะ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneFill, zoneHealth, zoneHealthText, zoneKindMeta } from '../storageZones.js';

const pkgMap = { A: 100, B: 50 };
const stdMap = { A: { min_qty: 200, max_qty: 1000 }, B: { min_qty: null, max_qty: null } };
const pkgOf = (m) => pkgMap[m] ?? null;
const stdOf = (m) => stdMap[m] ?? null;

test('นับกล่องปัดขึ้น + fill% เมื่อรู้ครบ', () => {
  const f = zoneFill({ capacity_pkg: 10, mat_nos: ['A', 'B'] }, { A: 250, B: 120 }, pkgOf, stdOf);
  assert.equal(f.mats[0].pkgs, 3);   // 250/100 → 3
  assert.equal(f.mats[1].pkgs, 3);   // 120/50 → 3
  assert.equal(f.totPkgs, 6);
  assert.equal(f.fillPct, 60);
  assert.equal(zoneHealth(f), 'good');
});

test('ไม่รู้ขนาดกล่อง → pkgs null + fill% null (ห้ามตีเป็น 0)', () => {
  const f = zoneFill({ capacity_pkg: 10, mat_nos: ['X'] }, { X: 500 }, () => null, () => null);
  assert.equal(f.mats[0].pkgs, null);
  assert.equal(f.unknownPkg, 1);
  assert.equal(f.fillPct, null);
  assert.match(zoneHealthText(f), /\+\?/); // บอกว่ามีตัวไม่รู้ขนาดกล่อง
});

test('ไม่กรอก capacity → fill% null แม้รู้ pkg ครบ', () => {
  const f = zoneFill({ capacity_pkg: null, mat_nos: ['A'] }, { A: 300 }, pkgOf, stdOf); // 300 > min 200 = ไม่ขาด
  assert.equal(f.fillPct, null);
  assert.equal(zoneHealth(f), 'good');
});

test('ต่ำกว่า Min → bad (แดงนิ่ง) · min ที่ null ไม่นับเป็น 0', () => {
  const f = zoneFill({ capacity_pkg: 100, mat_nos: ['A', 'B'] }, { A: 50, B: 0 }, pkgOf, stdOf);
  assert.equal(f.mats[0].short, true);   // 50 < min 200
  assert.equal(f.mats[1].short, false);  // B ไม่มี min — Number(null)=0 ต้องไม่หลอกว่า short
  assert.equal(zoneHealth(f), 'bad');
  assert.match(zoneHealthText(f), /ต่ำกว่า Min 1/);
});

test('ล้นความจุ ≥100% → bad · ใกล้เต็ม ≥85% → ok · เกิน Max → ok', () => {
  const full = zoneFill({ capacity_pkg: 5, mat_nos: ['A'] }, { A: 500 }, pkgOf, stdOf);
  assert.equal(full.fillPct, 100);
  assert.equal(zoneHealth(full), 'bad');
  const near = zoneFill({ capacity_pkg: 10, mat_nos: ['A'] }, { A: 900 }, pkgOf, stdOf);
  assert.equal(near.fillPct, 90);
  assert.equal(zoneHealth(near), 'ok');
  const over = zoneFill({ capacity_pkg: 100, mat_nos: ['A'] }, { A: 1100 }, pkgOf, stdOf);
  assert.equal(over.mats[0].over, true); // 1100 > max 1000
  assert.equal(zoneHealth(over), 'ok');
});

test('ยังไม่ผูก MAT → idle', () => {
  const f = zoneFill({ capacity_pkg: 10, mat_nos: [] }, {}, pkgOf, stdOf);
  assert.equal(zoneHealth(f), 'idle');
});

test('kind ที่โค้ดไม่รู้จัก → โชว์ key ดิบ ไม่หายเงียบ', () => {
  assert.equal(zoneKindMeta('freezer').label, 'freezer');
  assert.equal(zoneKindMeta('fg').icon, '📦');
});
