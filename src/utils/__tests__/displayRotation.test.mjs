import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROT_LIMITS, pathOnly, isValidRotationPath, secOf, normalizeConfig, buildPlaylist,
  stepIndex, indexOfLocation, resolveIndex, shouldReload, fmtSec, cleanItemsForSave,
} from '../displayRotation.js';

test('path ภายในแอปเท่านั้น — ห้ามพาจอออกนอกระบบ', () => {
  for (const p of ['/tv', '/tv?dept=production', '/factory-map', '/obeya?tab=sqdcm#x']) assert.equal(isValidRotationPath(p), true, p);
  for (const p of ['', 'tv', '//evil.com', 'https://x.com', '/javascript:alert(1)', '/tv x', '/login', '/register?x=1', null, 5]) {
    assert.equal(isValidRotationPath(p), false, String(p));
  }
});

test('pathOnly ตัด query/hash/ขีดท้าย', () => {
  assert.equal(pathOnly('/tv?dept=production'), '/tv');
  assert.equal(pathOnly('/obeya/#a'), '/obeya');
  assert.equal(pathOnly(''), '/');
});

test('วินาทีว่าง = ค่าตั้งต้นของจอ ไม่ใช่ 0 · นอกช่วง = clamp', () => {
  assert.equal(secOf({ sec: null }, 45), 45);
  assert.equal(secOf({ sec: '' }, 45), 45);
  assert.equal(secOf({}, undefined), ROT_LIMITS.defaultSec);
  assert.equal(secOf({ sec: 3 }, 45), ROT_LIMITS.minSec);
  assert.equal(secOf({ sec: 99999 }, 45), ROT_LIMITS.maxSec);
  assert.equal(secOf({ sec: 'abc' }, 45), 45);
});

test('normalizeConfig ทนค่าเพี้ยน · reload_min null = ตั้งใจไม่รีโหลด', () => {
  const c = normalizeConfig({ default_sec: 'x', pause_sec: 1, reload_min: null, items: 'nope' });
  assert.equal(c.defaultSec, ROT_LIMITS.defaultSec);
  assert.equal(c.pauseSec, ROT_LIMITS.minPauseSec);
  assert.equal(c.reloadMin, null);
  assert.deepEqual(c.items, []);
  assert.equal(normalizeConfig(null).enabled, true);
  assert.equal(normalizeConfig({ enabled: false }).enabled, false);
  assert.equal(normalizeConfig({}).reloadMin, ROT_LIMITS.defaultReloadMin);
});

test('หน้าที่ไม่มีสิทธิ์/ที่อยู่ผิด = ข้ามพร้อมเหตุผล (ไม่หายเงียบ)', () => {
  const can = (p) => p !== '/machine-database';
  const { playable, skipped } = buildPlaylist([
    { path: '/tv?dept=production', sec: 30 },
    { path: '/machine-database' },
    { path: 'oops' },
    { path: '/factory-map' },
  ], can, 50);
  assert.deepEqual(playable.map(p => [p.path, p.sec, p.idx]), [['/tv?dept=production', 30, 0], ['/factory-map', 50, 3]]);
  assert.deepEqual(skipped.map(s => [s.idx, s.reason]), [[1, 'no_access'], [2, 'invalid']]);
});

test('รายการเกินเพดานถูกตัด · ค่าไม่ใช่ array = ว่าง', () => {
  const many = Array.from({ length: ROT_LIMITS.maxItems + 5 }, () => ({ path: '/tv' }));
  assert.equal(buildPlaylist(many, () => true).playable.length, ROT_LIMITS.maxItems);
  assert.deepEqual(buildPlaylist(null, () => true), { playable: [], skipped: [] });
});

test('stepIndex วนกลับทั้ง 2 ทิศ', () => {
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(0, 0, 1), 0);
});

test('indexOfLocation — ตรง query ก่อน แล้วค่อยตรง path', () => {
  const pl = [{ path: '/tv?dept=maintenance' }, { path: '/tv?dept=production' }, { path: '/factory-map' }];
  assert.equal(indexOfLocation(pl, '/tv', '?dept=production'), 1);
  assert.equal(indexOfLocation(pl, '/tv', '?dept=store'), 0);
  assert.equal(indexOfLocation(pl, '/factory-map', ''), 2);
  assert.equal(indexOfLocation(pl, '/obeya', ''), -1);
});

test('shouldReload — รับ now เป็นพารามิเตอร์ (ไม่พึ่งนาฬิกาเครื่อง)', () => {
  const t0 = Date.UTC(2026, 9, 9, 0, 0, 0);
  assert.equal(shouldReload(t0, t0 + 59 * 60000, 60), false);
  assert.equal(shouldReload(t0, t0 + 60 * 60000, 60), true);
  assert.equal(shouldReload(t0, t0 + 1e9, null), false);
});

test('fmtSec + cleanItemsForSave', () => {
  assert.equal(fmtSec(45), '45 วิ');
  assert.equal(fmtSec(65), '1:05');
  assert.deepEqual(cleanItemsForSave([{ path: ' /tv ', sec: '' }, { path: '' }, { path: '/x', sec: 5 }]),
    [{ path: '/tv', sec: null }, { path: '/x', sec: ROT_LIMITS.minSec }]);
});

test('resolveIndex — รอบที่มีหน้าซ้ำ (A,B,A) ต้องวนถึงตัวที่ 3', () => {
  const pl = [{ path: '/tv' }, { path: '/factory-map' }, { path: '/tv' }];
  assert.equal(resolveIndex(pl, 2, '/tv', ''), 2);       // เพิ่งไปตัวที่ 3 → คงไว้ ไม่เด้งกลับตัวแรก
  assert.equal(resolveIndex(pl, 1, '/tv', ''), 0);       // คนกดไป /tv เอง → ตัวแรกที่ตรง
  assert.equal(resolveIndex(pl, 1, '/obeya', ''), 1);    // หน้านอกรอบ → คงตำแหน่งเดิม
  assert.equal(resolveIndex(pl, 5, '/obeya', ''), 5);    // ผู้เรียก clamp เอง
});
