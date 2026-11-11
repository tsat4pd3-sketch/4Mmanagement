/* 🔌 ศูนย์เชื่อมต่อ — ตัว gen flow Node-RED + สถานะต้นทาง + แถบสุขภาพ
   invariant: ไฟล์ flow ห้ามมีรหัสลับ · โหนดต่อสายถูก · ชนิด planned ไม่สร้างแต่ต้องบอก · ไม่เคยได้รับ ≠ ขาด */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeRedFlow, envVarName } from '../nodeRedFlow.js';
import { sourceStatus, healthBars, kindLabel, INTEGRATION_KINDS } from '../integrationKinds.js';

const URL = 'https://example.test/functions/v1/ingest-energy';
const ALL_ENERGY = ['energy_readings', 'energy_events', 'energy_daily', 'energy_limits'];

test('flow: JSON ใช้ได้ · id ไม่ซ้ำ · สายทุกเส้นชี้โหนดที่มีจริง · URL ถูก', () => {
  const { nodes, built, skipped } = buildNodeRedFlow({ source: { code: 'dieshop', name: 'Die Shop' }, kinds: ALL_ENERGY, ingestUrl: URL });
  const parsed = JSON.parse(JSON.stringify(nodes));
  const ids = new Set(parsed.map(n => n.id));
  assert.equal(ids.size, parsed.length);
  for (const n of parsed) for (const out of n.wires || []) for (const t of out) assert.ok(ids.has(t), `${n.id} → ${t}`);
  assert.ok(parsed.filter(n => n.type === 'http request').every(n => n.url === URL));
  assert.deepEqual(built.sort(), [...ALL_ENERGY].sort());
  assert.deepEqual(skipped, []);
});

test('flow: topic ขึ้นต้นด้วย code ของต้นทาง · ลิมิตแนบไปกับค่าไฟ', () => {
  const { nodes } = buildNodeRedFlow({ source: { code: 'dieshop' }, kinds: ['energy_readings', 'energy_limits'], ingestUrl: URL });
  const f = nodes.find(n => n.name === 'แปลงเป็น readings').func;
  assert.match(f, /topic: `dieshop\/\$\{m\}\/\$\{f\}`/);
  assert.match(f, /global\.get\('ecLimits'\)/);
  assert.equal(nodes.filter(n => n.type === 'http request').length, 1);   // ไม่แยกยิงลิมิตซ้ำ
});

test('flow: ไม่มีรหัสลับในไฟล์ · legacy ใช้ secret กลาง · ต้นทางใหม่ใช้ ESM_SOURCE_KEY', () => {
  const legacy = buildNodeRedFlow({ source: { code: 'dieshop', legacy_secret: true, key_hint: null }, kinds: ['energy_events'], ingestUrl: URL });
  const fresh = buildNodeRedFlow({ source: { code: 'pd2-oee', legacy_secret: false, key_hint: 'ab12' }, kinds: ['energy_events'], ingestUrl: URL });
  const lf = JSON.stringify(legacy.nodes), ff = JSON.stringify(fresh.nodes);
  assert.match(lf, /env\.get\('INGEST_SECRET'\)/);
  assert.match(lf, /'x-source': 'dieshop'/);
  assert.match(ff, /env\.get\('ESM_SOURCE_KEY'\)/);
  assert.doesNotMatch(ff, /INGEST_SECRET/);
  assert.doesNotMatch(ff, /esm_[A-Za-z0-9_-]{20,}/);          // ไม่มีรูปรหัสจริงหลุดเข้าไฟล์
  assert.equal(envVarName({ legacy_secret: true, key_hint: 'x1y2' }), 'ESM_SOURCE_KEY');   // ออกรหัสแล้ว = ใช้รหัสของตัวเอง
});

test('flow: ชนิดไม่รู้จัก ไม่สร้างโหนด แต่คืนเหตุผลให้จอบอก', () => {
  const r = buildNodeRedFlow({ source: { code: 'pd2' }, kinds: ['xyz'], ingestUrl: URL });
  assert.equal(r.nodes.length, 0);
  assert.deepEqual(r.skipped.map(s => s.key), ['xyz']);
  assert.match(kindLabel('xyz'), /ไม่รู้จัก/);
});

test('flow PD2: ช่วงหยุด + นับชิ้น ส่งข้อเท็จจริงอย่างเดียว · เวลาเป็นสตริงไทย · เหตุผลแยก master ตามสถานะ', () => {
  const r = buildNodeRedFlow({ source: { code: 'pd2-oee', key_hint: 'ab12' }, kinds: ['machine_state', 'piece_count'], ingestUrl: URL });
  assert.deepEqual(r.built, ['machine_state', 'piece_count']);
  assert.deepEqual(r.skipped, []);
  const ids = new Set(r.nodes.map(n => n.id));
  for (const n of r.nodes) for (const out of n.wires || []) for (const t of out) assert.ok(ids.has(t), `${n.id} → ${t}`);
  const all = r.nodes.map(n => n.func || '').join('\n');
  assert.doesNotMatch(all, /oee_shift|availability|performance|\boee\b\s*[,=]/i);   // ไม่ส่งเลข OEE ของต้นทาง
  assert.match(all, /FROM oee_stop/);
  assert.match(all, /FROM oee_piece/);
  assert.match(all, /IN \('PLANNED_STOP', 'NO_PLAN'\) THEN o\.Description/);
  assert.match(all, /= 'FAULT' THEN u\.Description/);
  assert.match(all, /DATE_FORMAT\(s\.start_ts/);                                 // ไม่ปล่อย Date ของ mysql node (โซนเพี้ยน)
  assert.match(all, /msg\.payload = \{ states: rows \}/);
  assert.match(all, /msg\.payload = \{ pieces: rows \}/);
  assert.match(all, /env\.get\('ESM_SOURCE_KEY'\)/);
});

test('code แปลกถูกกรองก่อนเข้าไฟล์ (กัน inject ผ่านชื่อ)', () => {
  const { nodes } = buildNodeRedFlow({ source: { code: "x'; drop" }, kinds: ['energy_readings'], ingestUrl: URL });
  assert.ok(nodes.every(n => /^esm_xdrop_/.test(n.id)));
});

test('สถานะต้นทาง: พัก · ไม่เคยได้รับ · ออนไลน์ · ขาด', () => {
  const NOW = Date.parse('2026-11-11T03:00:00Z');
  assert.equal(sourceStatus({ is_paused: true, last_ok_at: '2026-11-11T02:59:30Z' }, NOW), 'paused');
  assert.equal(sourceStatus({}, NOW), 'never');
  assert.equal(sourceStatus({ last_ok_at: '2026-11-11T02:59:00Z' }, NOW), 'online');
  assert.equal(sourceStatus({ last_ok_at: '2026-11-11T02:50:00Z' }, NOW), 'stale');
  assert.equal(sourceStatus({ last_seen_at: '2026-11-11T02:59:00Z' }, NOW), 'stale');   // เคยเข้ามาแต่ล้มตลอด
});

test('แถบสุขภาพ: 24 ช่อง · ชั่วโมงไม่มีแถว = 0 · ชั่วโมงปัจจุบันเทียบนาทีที่ผ่านไป', () => {
  const NOW = Date.parse('2026-11-11T03:30:00Z');
  const bars = healthBars([
    { hour_at: '2026-11-11T03:00:00+00:00', ok_count: 30, fail_count: 0 },
    { hour_at: '2026-11-11T02:00:00+00:00', ok_count: 45, fail_count: 2 },
  ], NOW);
  assert.equal(bars.length, 24);
  assert.equal(bars[23].expect, 30); assert.equal(bars[23].ratio, 1);
  assert.equal(bars[22].ratio, 0.75); assert.equal(bars[22].fail, 2);
  assert.equal(bars[0].ok, 0);
});

test('ทะเบียนชนิด: ไม่มีชนิด "เลข OEE ของต้นทาง" (ESM เป็นเจ้าของสูตร)', () => {
  assert.ok(!INTEGRATION_KINDS.some(k => /oee/i.test(k.key)));
  assert.equal(new Set(INTEGRATION_KINDS.map(k => k.key)).size, INTEGRATION_KINDS.length);
});

test('edge integration-admin ใช้รายชื่อชนิดเดียวกับทะเบียน (edge import จาก src/ ไม่ได้ — ห้ามเพี้ยน)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new globalThis.URL('../../../supabase/functions/integration-admin/index.ts', import.meta.url), 'utf8');
  const m = src.match(/const KINDS = \[([^\]]*)\]/);
  assert.ok(m, 'หา KINDS ใน integration-admin ไม่เจอ');
  const edge = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
  assert.deepEqual(edge, INTEGRATION_KINDS.map(k => k.key).sort(),
    '\n❌ ชนิดข้อมูลใน edge integration-admin ไม่ตรง src/utils/integrationKinds.js — แก้ 2 ที่ให้ตรงกันแล้ว deploy edge ใหม่\n');
});
