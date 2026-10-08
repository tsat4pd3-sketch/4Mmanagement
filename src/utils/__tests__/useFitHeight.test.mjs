/**
 * contentBelow() — "ที่ว่างใต้กล่อง" ต้องมาจากเนื้อหาจริง ไม่ใช่ช่องว่างของพ่อที่สูงตายตัว (2026-09-30)
 * บั๊กที่ล็อกไว้: user ส่งคลิป "บัคๆ" — บอร์ด KPI 5×2 หดทีละ 20px ทุกรอบ → ข้อความซ้อน → 6×1 + แถบหน้า → วนใหม่
 * ต้นเหตุ: วัด parent.bottom − node.bottom ไล่ทุกชั้น แต่ <main> มี minHeight:100vh ⇒ กล่องเตี้ยลง = ช่องว่างใต้โต
 * ⇒ ค่าที่วัดได้ **ต้องไม่เปลี่ยน** เมื่อกล่องเปลี่ยนความสูงแล้วของข้างล่างแค่เลื่อนตาม
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentBelow } from '../useFitHeight.js';

/* DOM ปลอมขั้นต่ำ: rect (top/bottom) · style · parent/sibling */
function node(name, { top = 0, height = 0, style = {}, children = [] } = {}) {
  const n = { name, top, height, style: { display: 'block', position: 'static', marginBottom: '0px', paddingBottom: '0px', borderBottomWidth: '0px', ...style },
    parentElement: null, nextElementSibling: null, children };
  n.getBoundingClientRect = () => ({ top: n.top, bottom: n.top + n.height, height: n.height });
  children.forEach((c, i) => { c.parentElement = n; c.nextElementSibling = children[i + 1] || null; });
  return n;
}
const getStyle = (n) => n.style;

/** จำลองหน้า OBEYA: body(100%) > main(minHeight 100vh · สูง 1000 คงที่) > page > [หัวเพจ, กล่องบอร์ด, แถบหน้า, หมายเหตุ] */
function scene(boxH, { pager = 40, foot = 30, pagePad = 16 } = {}) {
  const head = node('head', { top: 0, height: 120 });
  const box = node('box', { top: 120, height: boxH });
  const items = [head, box];
  let y = 120 + boxH;
  if (pager) { items.push(node('pager', { top: y, height: pager })); y += pager; }
  items.push(node('foot', { top: y, height: foot })); y += foot;
  const page = node('page', { top: 0, height: y + pagePad, style: { paddingBottom: `${pagePad}px` }, children: items });
  const main = node('main', { top: 0, height: 1000, children: [page] });      // ← สูงตายตัว ไม่โตตามลูก
  const body = node('body', { top: 0, height: 1000, children: [main] });
  return { box, body };
}

test('🔴 ค่าใต้กล่องต้องเท่าเดิมไม่ว่ากล่องจะสูง 600 หรือ 300 (พ่อสูงตายตัว ห้ามนับช่องว่างของพ่อ)', () => {
  const a = scene(600), b = scene(300);
  const va = contentBelow(a.box, { getStyle, root: a.body });
  const vb = contentBelow(b.box, { getStyle, root: b.body });
  assert.equal(va, vb, `กล่อง 600 ได้ ${va} แต่กล่อง 300 ได้ ${vb} — ค่าที่ต่างกันคือลูปหดที่เคยเกิด`);
  assert.equal(va, 40 + 30 + 16);          // แถบหน้า + หมายเหตุ + padding ล่างของ <Page>
});

test('ไม่มีแถบหน้า = นับแค่หมายเหตุ + padding (ของที่โผล่/หายไปจริงถึงเปลี่ยนค่าได้)', () => {
  const s = scene(500, { pager: 0 });
  assert.equal(contentBelow(s.box, { getStyle, root: s.body }), 30 + 16);
});

test('ของที่ไม่กินที่ในผัง (fixed/absolute/display:none) ไม่นับ', () => {
  const s = scene(500);
  const modal = node('modal', { top: 0, height: 900, style: { position: 'fixed' } });
  const hidden = node('hidden', { top: 900, height: 300, style: { display: 'none' } });
  const page = s.box.parentElement;
  page.children.push(modal, hidden);
  page.children.forEach((c, i) => { c.parentElement = page; c.nextElementSibling = page.children[i + 1] || null; });
  assert.equal(contentBelow(s.box, { getStyle, root: s.body }), 40 + 30 + 16);
});

test('margin-bottom ของพี่น้องตัวสุดท้ายนับด้วย (มันกินที่จริง)', () => {
  const s = scene(500);
  const foot = s.box.nextElementSibling.nextElementSibling;
  foot.style.marginBottom = '12px';
  assert.equal(contentBelow(s.box, { getStyle, root: s.body }), 40 + 30 + 12 + 16);
});
