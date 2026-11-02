import { test } from 'node:test';
import assert from 'node:assert/strict';

/* localStorage ปลอม — เทสรันบน node ไม่มี window */
const mem = new Map();
globalThis.window = {
  localStorage: {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
    key: i => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  },
};
const { saveDraft, loadDraft, clearDraft, purgeOldDrafts, DRAFT_MAX_AGE_MS } = await import('../formDraft.js');

const T0 = Date.UTC(2026, 9, 22, 1, 0, 0);

test('เก็บแล้วอ่านคืนได้ครบ พร้อมเวลาที่เก็บ', () => {
  mem.clear();
  assert.equal(saveDraft('lpa:A|day', { answers: { q1: 'Y' } }, T0), true);
  assert.deepEqual(loadDraft('lpa:A|day', { now: T0 + 1000 }), { at: T0, data: { answers: { q1: 'Y' } } });
});

test('🔴 หมดอายุ = null และลบทิ้ง (ร่างข้ามกะไม่มีความหมาย)', () => {
  mem.clear();
  saveDraft('k', { a: 1 }, T0);
  assert.equal(loadDraft('k', { now: T0 + DRAFT_MAX_AGE_MS + 1 }), null);
  assert.equal(mem.size, 0);
});

test('คีย์ต่างชุด = ไม่ปนกัน', () => {
  mem.clear();
  saveDraft('pm:J1|production', { notes: 'x' }, T0);
  assert.equal(loadDraft('pm:J2|production', { now: T0 }), null);
});

test('อ่านไม่ออก (ข้อมูลเสีย) = null ไม่ throw', () => {
  mem.clear();
  mem.set('esm_draft_v1:bad', '{not json');
  assert.equal(loadDraft('bad', { now: T0 }), null);
});

test('clearDraft ลบ · purgeOldDrafts ลบเฉพาะที่หมดอายุและไม่แตะคีย์อื่นของแอป', () => {
  mem.clear();
  mem.set('nav_recent_v1', '[]');
  saveDraft('old', 1, T0 - DRAFT_MAX_AGE_MS - 5);
  saveDraft('new', 2, T0);
  assert.equal(purgeOldDrafts({ now: T0 }), 1);
  assert.equal(loadDraft('new', { now: T0 })?.data, 2);
  assert.equal(mem.get('nav_recent_v1'), '[]');
  clearDraft('new');
  assert.equal(loadDraft('new', { now: T0 }), null);
});

test('ไม่มี localStorage (โหมดส่วนตัว) = ไม่มีร่าง ไม่ throw', async () => {
  const saved = globalThis.window;
  globalThis.window = { get localStorage() { throw new Error('denied'); } };
  try {
    assert.equal(saveDraft('k', 1, T0), false);
    assert.equal(loadDraft('k', { now: T0 }), null);
    assert.doesNotThrow(() => clearDraft('k'));
  } finally { globalThis.window = saved; }
});
