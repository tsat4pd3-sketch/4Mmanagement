/* เทสกติกา "แผ่นบนบอร์ด = KPI ที่หน่วยถือจริง" (05/10/2026)
   ข้อมูลจำลองถอดจากฐานจริง 05/10: MTN 11 นิยามไม่มี catalog · PD4 ครบ 8 ช่อง · PD1/PD2 ไม่มีนิยาม · plant ถือ %RM/CSat (ค่าร่วม) */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pickBoardRows, normKpiRowName, applyBoardOrder, moveBoardKey } from '../kpiBoardRows.js';
import { scopeOfDef, sameScope, isPlant } from '../orgScope.js';
import { boardSlotOf } from '../kpiSetup.js';

const T = [
  { key: 'rm', name: '%RM (Raw Material)', auto: null },
  { key: 'dloh', name: 'DL+OH (Direct Labor + Overhead)', auto: null },
  { key: 'inv', name: 'Inventory Balance', auto: null },
  { key: 'csat', name: 'Customer Satisfaction', auto: null },
  { key: 'oee', name: 'OEE', auto: 'oee' },
  { key: 'ppm', name: 'PPM', auto: 'ppm' },
  { key: 'safe', name: 'Safety', auto: 'safety' },
  { key: 'train', name: 'Training', auto: null },
];
const PLANT = { kind: 'plant', value: '' };
const cat = (name, board_slot) => ({ kpi_catalog: { name, board_slot } });
const def = (id, scope_kind, scope_value, name, extra = {}) => ({ id, scope_kind, scope_value, name, source: 'manual', seq: id, ...extra });
const DEFS = [
  def(1, 'plant', null, 'Raw Material Control', cat('%RM (Raw Material)', 'rm')),
  def(2, 'plant', null, 'Customer Satisfaction', cat('Customer Satisfaction', 'csat')),
  // MTN: ตั้งจาก 📘 โดยไม่ผูก catalog — "Safety" ตรงชื่อช่อง · "TS Academy training" ไม่ตรงชื่อ Training
  def(10, 'department', 'MTN', 'Safety'),
  def(11, 'department', 'MTN', 'TS Academy training'),
  def(12, 'department', 'MTN', 'Mean Time Between Failure (MTBF)'),
  def(13, 'department', 'MTN', 'Cost Reduction (MTN)'),
  // PD1: ตั้งแค่ %RM ตัวเดียว (มีไลน์ผลิต)
  def(20, 'section', 'PD1', 'Raw Material Control', cat('%RM (Raw Material)', 'rm')),
  // PD4: ครบ + พิเศษ 1 + slot ที่ปีนี้ไม่มีช่อง (dl)
  def(30, 'section', 'PD4', 'Raw Material Control', cat('%RM (Raw Material)', 'rm')),
  def(31, 'section', 'PD4', 'Overall Equipment Effectiveness (OEE)', cat('OEE', 'oee')),
  def(32, 'section', 'PD4', 'QCC', cat('QCC', null)),
  def(33, 'section', 'PD4', 'Direct Labor', cat('Direct Labor', 'dl')),
  def(34, 'section', 'PD4', 'PPM ของเสียภายใน', { source: 'auto:ppm' }),
];
/* จำลอง chain "ใกล้สุดก่อน": ขอบเขตเอง → แม่ (ถ้ามี) → โรงงาน — เหมือน manualOf/autoDefOf ในบอร์ด */
const mk = (scope, parents = []) => {
  const chain = [scope, ...parents, PLANT];
  const covering = DEFS.filter(d => chain.some(sc => sameScope(scopeOfDef(d), sc)));
  const nearest = (pred) => {
    for (const sc of chain) { const d = covering.find(x => sameScope(scopeOfDef(x), sc) && pred(x)); if (d) return { def: d, at: sc }; }
    return null;
  };
  const findManual = (r) => nearest(x => !String(x.source || '').startsWith('auto:')
    && (boardSlotOf(x) ? boardSlotOf(x) === r.key : normKpiRowName(x.kpi_catalog?.name || x.name) === normKpiRowName(r.name)));
  const findAuto = (k) => nearest(x => x.source === `auto:${k}`)?.def || null;
  return { kdefs: covering, scope, findManual, findAuto };
};
const keys = (res) => res.rows.map(r => r.key);
const names = (res) => res.rows.map(r => r.name);

test('MTN (ไม่มีไลน์ผลิต): ไม่มี OEE/PPM/%RM/CSat · Safety เข้าช่องด้วยชื่อ · ที่เหลือเป็นแผ่นพิเศษ def:<id>', () => {
  const res = pickBoardRows({ templates: T, hasLines: false, ...mk({ kind: 'department', value: 'MTN' }) });
  assert.equal(res.fallbackTemplate, false);
  assert.deepEqual(keys(res), ['safe', 'def:11', 'def:12', 'def:13']);
  assert.ok(!keys(res).includes('oee') && !keys(res).includes('ppm'), 'หน่วยไม่มีไลน์ห้ามเห็น OEE/PPM');
  assert.ok(!keys(res).includes('rm') && !keys(res).includes('csat'), 'นิยามระดับโรงงาน (ค่าร่วม) ไม่นับว่า MTN ถือ');
  assert.equal(names(res)[1], 'TS Academy training');
});

test('PD1 (มีไลน์ · ตั้งแค่ %RM): %RM + แถว auto ทั้ง 3 · ไม่มีช่องว่าง "ยังไม่ได้ตั้ง" ของ Inventory/Training', () => {
  const res = pickBoardRows({ templates: T, hasLines: true, ...mk({ kind: 'section', value: 'PD1' }) });
  assert.deepEqual(keys(res), ['rm', 'oee', 'ppm', 'safe']);
});

test('PD2 (ยังไม่ตั้ง KPI เลย): template เต็ม + fallbackTemplate = true (บอร์ดว่างเปล่าไม่บอกอะไรใคร)', () => {
  const res = pickBoardRows({ templates: T, hasLines: true, ...mk({ kind: 'section', value: 'PD2' }) });
  assert.equal(res.fallbackTemplate, true);
  assert.deepEqual(keys(res), T.map(r => r.key));
});

test('PD4: ช่องตาม slot · auto:ppm นับว่าถือ · QCC เป็นแผ่นพิเศษ · slot dl (ปีนี้ไม่มีช่อง) เป็นแผ่นพิเศษ ไม่หาย', () => {
  const res = pickBoardRows({ templates: T, hasLines: true, ...mk({ kind: 'section', value: 'PD4' }) });
  assert.deepEqual(keys(res), ['rm', 'oee', 'ppm', 'safe', 'def:32', 'def:33']);
  const r33 = res.rows.find(r => r.key === 'def:33');
  assert.equal(r33.defId, 33); assert.equal(r33.extra, true); assert.equal(r33.auto, null);
});

test('แผนกใต้ PD4 (ตกทอดจากหน่วยแม่): ช่อง rm/oee ของ PD4 ยังโชว์ แต่แผ่นพิเศษของ PD4 ไม่ตกทอด', () => {
  const res = pickBoardRows({ templates: T, hasLines: false, ...mk({ kind: 'department', value: 'HYDROFORM' }, [{ kind: 'section', value: 'PD4' }]) });
  assert.deepEqual(keys(res), ['rm', 'oee', 'ppm']);   // ppm จาก auto:ppm ของแม่ · ไม่มีไลน์เลยไม่ได้ safe
});

test('ดูทั้งโรงงาน: นิยามโรงงานนับว่าถือ ⇒ rm/csat + auto ตามไลน์', () => {
  const res = pickBoardRows({ templates: T, hasLines: true, ...mk(PLANT) });
  assert.deepEqual(keys(res), ['rm', 'csat', 'oee', 'ppm', 'safe']);
  assert.ok(isPlant(PLANT));
});

test('normKpiRowName: ตัวพิมพ์/ช่องว่าง/วงเล็บไม่สำคัญ', () => {
  assert.equal(normKpiRowName('%RM (Raw Material)'), normKpiRowName('%rm raw-material'));
});

/* 💰 เลือก CC ของ MTN ต้องได้แผ่นเดียวกับเลือกแผนก MTN (06/10 · user: "เลือกส่วนของ MTN เหมือนกัน ทำไมไม่เหมือนกัน") */
test('ownScopes: CC ของแผนก MTN เห็นแผ่นพิเศษ def:<id> ของ MTN · ไม่ส่ง ownScopes = พฤติกรรมเดิม (CC ไม่มีแผ่น)', () => {
  const cc = { kind: 'cost_center', value: '2140456000' };
  const mtn = { kind: 'department', value: 'MTN' };
  const mtnDefs = DEFS.filter(d => d.scope_kind === 'department' && d.scope_value === 'MTN');
  const base = { templates: T, kdefs: mtnDefs, scope: cc, hasLines: false, findManual: () => null, findAuto: () => null };
  const withOwn = pickBoardRows({ ...base, ownScopes: [cc, mtn] });
  // def:10 'Safety' ตรงชื่อช่องมาตรฐาน ⇒ อยู่บนช่อง ไม่ใช่แผ่นพิเศษ
  assert.deepEqual(withOwn.rows.filter(r => r.extra).map(r => r.key), ['def:11', 'def:12', 'def:13']);
  assert.equal(withOwn.rows.some(r => r.auto === 'oee'), false, 'CC ของช่างไม่มีไลน์ = ไม่มี OEE');
  const without = pickBoardRows(base);
  assert.deepEqual(without.rows.filter(r => r.extra), [], 'ไม่บอกเจ้าของ = นิยามของแผนกเป็นแค่ตกทอด ไม่ทำแผ่นพิเศษ');
});

/* 🧩 จัดเรียงแผ่นเอง (09/10 · user PD2) — คีย์ที่คนจัดมาก่อน · แผ่นใหม่ต่อท้าย · คีย์ที่ไม่มีแผ่นแล้วข้าม */
test('applyBoardOrder: เรียงตาม row_keys · คีย์ที่ไม่อยู่ในลิสต์ต่อท้ายตามลำดับเดิม · คีย์หายไปไม่พัง · ว่าง = เดิม', () => {
  const rows = [{ key: 'rm' }, { key: 'oee' }, { key: 'ppm' }, { key: 'def:9' }];
  assert.deepEqual(applyBoardOrder(rows, ['oee', 'def:9', 'gone']).map(r => r.key), ['oee', 'def:9', 'rm', 'ppm']);
  assert.deepEqual(applyBoardOrder(rows, []).map(r => r.key), ['rm', 'oee', 'ppm', 'def:9']);
  assert.deepEqual(applyBoardOrder(rows, null).map(r => r.key), ['rm', 'oee', 'ppm', 'def:9']);
});
test('moveBoardKey: สลับกับเพื่อนบ้าน · ชนขอบ = ไม่เปลี่ยน · ไม่แก้ array เดิม', () => {
  const k = ['a', 'b', 'c'];
  assert.deepEqual(moveBoardKey(k, 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveBoardKey(k, 'c', 1), ['a', 'b', 'c']);
  assert.deepEqual(moveBoardKey(k, 'zz', 1), ['a', 'b', 'c']);
  assert.deepEqual(k, ['a', 'b', 'c']);
});
