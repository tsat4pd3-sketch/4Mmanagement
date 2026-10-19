import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROT_LIMITS, pathOnly, isValidRotationPath, secOf, normalizeConfig, buildPlaylist,
  stepIndex, indexOfLocation, resolveIndex, shouldReload, fmtSec, cleanItemsForSave,
  boardFlipSec, setActiveDwellSec, activeDwellSecOf, BOARD_FLIP_MIN_SEC,
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

import { canManageDisplay, sectionsOfProfile, parseDisplayCmd, queryParamsOf, withQueryParams, paramSummary, DISPLAY_PAGE_PARAMS } from '../displayRotation.js';

test('canManageDisplay — แอดมินส่วนงานตั้งได้เฉพาะจอของส่วนงานตัวเอง', () => {
  assert.equal(canManageDisplay([], ['PD1']), true);            // ทั้งโรงงาน
  assert.equal(canManageDisplay([], []), true);
  assert.equal(canManageDisplay(['PD3'], ['PD3']), true);
  assert.equal(canManageDisplay(['pd3 '], ['PD3']), true);      // ตัวพิมพ์/ช่องว่าง
  assert.equal(canManageDisplay(['PD3'], ['PD1']), false);      // ข้ามส่วนงาน
  assert.equal(canManageDisplay(['PD3'], []), false);           // จอเห็นทั้งโรงงาน = ต้องผู้ตั้งทั้งโรงงาน
  assert.equal(canManageDisplay(['PD3'], ['PD3', 'PD1']), false); // ต้องครอบทุกส่วนงานของจอ
  assert.equal(canManageDisplay(['PD3', 'PD1'], ['PD3', 'PD1']), true);
});

test('sectionsOfProfile — sections ก่อน แล้วค่อย section เดี่ยว', () => {
  assert.deepEqual(sectionsOfProfile({ sections: ['PD3'], section: 'PD1' }), ['PD3']);
  assert.deepEqual(sectionsOfProfile({ sections: [], section: 'PD1' }), ['PD1']);
  assert.deepEqual(sectionsOfProfile({}), []);
});

test('parseDisplayCmd — สั่งได้เฉพาะหน้าในรอบ ห้ามพาไป path อื่น', () => {
  assert.deepEqual(parseDisplayCmd({ type: 'goto', idx: 1 }, 3), { type: 'goto', idx: 1 });
  assert.equal(parseDisplayCmd({ type: 'goto', idx: 3 }, 3), null);
  assert.deepEqual(parseDisplayCmd({ type: 'goto', idx: '1' }, 3), { type: 'goto', idx: 1 });
  assert.equal(parseDisplayCmd({ type: 'nav', to: '//evil' }, 3), null);
  assert.equal(parseDisplayCmd({ type: 'goto', path: '/x' }, 3), null);
  assert.deepEqual(parseDisplayCmd({ type: 'next' }, 3), { type: 'next' });
  assert.equal(parseDisplayCmd(null, 3), null);
});

test('query params — ประกอบ/แกะ/สรุป', () => {
  assert.deepEqual(queryParamsOf('/oee-analytics?tab=today&line=HYDROFORM#x'), { tab: 'today', line: 'HYDROFORM' });
  assert.equal(withQueryParams('/oee-analytics', { tab: 'today', line: 'LINE APRON ASSY', section: '' }), '/oee-analytics?tab=today&line=LINE+APRON+ASSY');
  assert.equal(withQueryParams('/tv', {}), '/tv');
  assert.deepEqual(paramSummary('/tv?dept=production&x=1'), ['มุมมอง: 🏭 ฝ่ายผลิต', 'x: 1']);
});

test('ทะเบียนตัวกรอง — ทุกตัว select มีตัวเลือก และคีย์ไม่ซ้ำในหน้าเดียว', () => {
  for (const [p, defs] of Object.entries(DISPLAY_PAGE_PARAMS)) {
    const keys = defs.map(d => d.key);
    assert.equal(new Set(keys).size, keys.length, p);
    defs.filter(d => d.kind === 'select').forEach(d => assert.ok(d.options?.length, `${p}:${d.key}`));
  }
});

/* ── 📖 สลับหน้าภายในบอร์ดตอนจอวน (15/10) ── */
test('boardFlipSec: แบ่งเวลาค้างหน้าให้ครบทุกหน้าภายใน · หน้าเดียว = null · ไม่รู้ dwell = defaultSec · ต่ำสุด BOARD_FLIP_MIN_SEC', () => {
  assert.equal(boardFlipSec(1, 120), null);
  assert.equal(boardFlipSec(0, 120), null);
  assert.equal(boardFlipSec(2, 120), 60);
  assert.equal(boardFlipSec(3, 100), 33);
  assert.equal(boardFlipSec(2, null), ROT_LIMITS.defaultSec / 2);
  assert.equal(boardFlipSec(10, 30), BOARD_FLIP_MIN_SEC);
  setActiveDwellSec(90); assert.equal(activeDwellSecOf(), 90); assert.equal(boardFlipSec(3), 30);
  setActiveDwellSec(null); assert.equal(activeDwellSecOf(), null);
  setActiveDwellSec('abc'); assert.equal(activeDwellSecOf(), null);
});

import { paramVisible } from '../displayRotation.js';

test('paramVisible — ช่องที่ผูกกับแท็บโชว์เฉพาะแท็บนั้น (ยังไม่เลือกแท็บ = "")', () => {
  const d = { key: 'period', showIf: { tab: ['sqdcm'] } };
  assert.equal(paramVisible(d, { tab: 'sqdcm' }), true);
  assert.equal(paramVisible(d, { tab: 'kpi' }), false);
  assert.equal(paramVisible(d, {}), false);
  assert.equal(paramVisible({ key: 'x', showIf: { tab: ['', 'kpi'] } }, {}), true);
  assert.equal(paramVisible({ key: 'x' }, {}), true);
});

test('ทะเบียนตัวกรอง — showIf ต้องอ้างคีย์ที่มีอยู่ในหน้าเดียวกัน', () => {
  for (const [p, defs] of Object.entries(DISPLAY_PAGE_PARAMS)) {
    const keys = new Set(defs.map(d => d.key));
    defs.filter(d => d.showIf).forEach(d => Object.keys(d.showIf).forEach(k => assert.ok(keys.has(k), `${p}:${d.key} → ${k}`)));
  }
});

import { minSecForPath } from '../displayRotation.js';

test('minSecForPath — ผังโรงงานวนมุมมอง ต้องอยู่นานพอวนครบรอบ', () => {
  assert.equal(minSecForPath('/factory-map?cycle=health,oee,ng&csec=20'), 60);
  assert.equal(minSecForPath('/factory-map?cycle=health,oee'), 30);          // ค่าตั้งต้น 15 วิ/มุม
  assert.equal(minSecForPath('/factory-map?cycle=health'), 0);              // มุมเดียว = ไม่วน
  assert.equal(minSecForPath('/factory-map?cycle=1&csec=10'), 100);
  assert.equal(minSecForPath('/tv?cycle=1'), 0);
  const { playable } = buildPlaylist([{ path: '/factory-map?cycle=health,oee,ng', sec: 20 }], () => true);
  assert.equal(playable[0].sec, 45);
});

import { isTvShell } from '../displayRotation.js';

test('isTvShell — บัญชี display หรือลิงก์ ?tvshell=1 เท่านั้น', () => {
  assert.equal(isTvShell('display', ''), true);
  assert.equal(isTvShell('admin', '?tvshell=1'), true);
  assert.equal(isTvShell('admin', '?x=1&tvshell=1'), true);
  assert.equal(isTvShell('admin', '?tvshell=0'), false);
  assert.equal(isTvShell('admin', ''), false);
  assert.equal(isTvShell('supervisor', undefined), false);
});

import { barChips } from '../displayRotation.js';

test('barChips — โชว์เฉพาะ "ข้อมูลชุดไหน" ไม่โชว์ค่าปรับหน้าตา/คีย์นอกทะเบียน', () => {
  assert.deepEqual(barChips('/factory-map?view=3d&panel=obeya&lbl=60&tvshell=1'), []);
  assert.deepEqual(barChips('/line-oee?line=LINE%20APRON%20ASSY'), ['LINE APRON ASSY']);
  assert.deepEqual(barChips('/tv?dept=production&sec=PD3'), ['🏭 ฝ่ายผลิต', 'PD3']);
  assert.deepEqual(barChips('/obeya?tab=kpi&board=1&scope=section:PD3'), ['📋 บอร์ด KPI', 'PD3']);
});
