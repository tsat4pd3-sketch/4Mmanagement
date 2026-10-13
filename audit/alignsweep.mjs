/* align-sweep — "แถวกรอกข้อมูลตรงเป็นคอลัมน์ไหม" ทุกหน้า (2026-10-13 · คำสั่ง user)
   *"เสร็จละจัดระเบียบหน้านี้ด้วย และไล่ดูหน้าอื่นไห้ที"* → *"เนี่ย เจอเหมือนกันอีกหน้า เรื่อง ระเบียบ alignment"*

   ทำไมต้องมีเครื่องมือนี้:
   - อาการคือ "ลิสต์ทะเบียนที่แก้ในที่ได้" วาดแถวเป็น flex แล้วช่องกรอกตั้ง `flex: 1 1 Npx` (**ยืดได้**)
     ⇒ ความกว้างจริงขึ้นกับ "ของท้ายแถว" ซึ่งไม่เท่ากันต่อแถว (ชิปจำนวนไม่เท่ากัน · ปุ่มลบ vs ป้าย 🔒
     · แถวสองชนิดในลิสต์เดียว) ⇒ ขอบช่องเยื้องกันทีละแถว · แถว "+ เพิ่ม" ก็ไม่ตรงกับแถวข้อมูล
   - **build / lint / เทส / crashsweep / mobilesweep / stdsweep จับไม่ได้เลย** — หน้าไม่พัง ไม่ล้น
     ไม่ผิดมาตรฐานหัวเพจ แค่ "อ่านลงมาเป็นคอลัมน์ไม่ได้" ซึ่งเห็นด้วยตาเท่านั้น
   - กติกาที่ต้องทำตามเวลาเจอ → `docs/UI-CONVENTIONS.md` §6.28

   วิธีวัด: หา "แถว" = div ที่มีลูกเป็นช่องกรอก ≥ 2 ช่อง (ข้าม `<table>` — ตารางตรงอยู่แล้วโดยโครงสร้าง)
   แล้วจับกลุ่มด้วยบรรพบุรุษที่ใกล้สุดที่มีแถว ≥ 3 · รายงานเมื่อ
     (ก) ช่องแรกของแต่ละแถวอยู่คนละ x โดยห่างกัน **4–40px** — ระยะระดับ padding/ความกว้างที่ยืดไม่เท่ากัน
         🔴 ห่างเกิน 40px = ฟอร์มที่ตั้งใจวางคนละคอลัมน์ (เช่น label ซ้าย/ขวาใน modal) **ไม่นับ**
         (ถ้าไม่ตัดเกณฑ์นี้ จอฟอร์มทุกใบจะขึ้นแดง = เครื่องมือที่ไม่มีใครเชื่อ — บทเรียนเดียวกับ uxsweep)
     (ข) แถวที่มีจำนวนช่อง **เท่ากัน** แต่ช่องที่ n อยู่คนละ x เกิน 4px
   วัดที่ 1500px · role=admin · ไล่ทุกแท็บบนหัวเพจและแท็บลูก (ลิสต์ทะเบียนมักอยู่ในแท็บลูก)

   ⚠️ ของที่ "ตั้งใจ" ให้ช่องกว้างตามชนิดข้อมูล (วันที่ 150 · จำนวน 100) ในฟอร์ม modal
      = ไม่ใช่เป้าของเครื่องมือนี้ — เป้าคือ **ลิสต์ที่ซ้ำรูปแบบเดิมหลายแถว**
      ⇒ ติด `data-align-ok="<เหตุผลสั้นๆ>"` บนกล่องฟอร์มนั้น เครื่องมือจะข้ามให้ **แต่พิมพ์จำนวนที่ข้าม
      ให้เห็นในรายงาน** (ท่าเดียวกับ `data-ux-ok` ของ uxsweep) — ห้ามใช้กับลิสต์ทะเบียนเพื่อให้ผ่านด่าน
*/
import { chromium } from 'playwright';

const VW = Number(process.env.VW || 1500), VH = Number(process.env.VH || 950);
const NEAR = Number(process.env.NEAR || 40);   // เยื้างเกินนี้ = ฟอร์มตั้งใจ ไม่ใช่บั๊ก
const TAB_CAP = Number(process.env.TAB_CAP || 14);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p0 = await b.newPage({ timezoneId: 'Asia/Bangkok' });
await p0.goto('http://localhost:5199/audit/index.html');
await p0.waitForTimeout(1200);
const PAGES = await p0.evaluate(() => window.__PAGES);
await p0.close();

const SCAN = (near) => {
  const CTRL = 'input,select,textarea';
  const isRow = (el) => {
    if (el.closest('table')) return false;
    return [...el.children].filter(c => c.matches(CTRL) || (c.children.length <= 2 && c.querySelector(CTRL))).length >= 2;
  };
  let skipped = 0;
  const rows = [...document.querySelectorAll('div')].filter(el => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 200 && r.height > 18 && r.height < 160 && isRow(el))) return false;
    /* ตั้งใจให้เป็นแบบนี้ (มี `data-align-ok`) — ข้าม แต่ต้องนับให้เห็นในรายงาน */
    if (el.closest('[data-align-ok]')) { skipped++; return false; }
    return true;
  });
  const groups = new Map();
  for (const el of rows) {
    let a = el.parentElement, key = null;
    for (let i = 0; i < 6 && a && a !== document.body; i++, a = a.parentElement) {
      if (rows.filter(r => a.contains(r)).length >= 3) { key = a; break; }
    }
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  }
  const out = [];
  for (const [, list] of groups) {
    if (list.length < 3) continue;
    const lefts = list.map(el => Math.round(el.querySelector(CTRL).getBoundingClientRect().left));
    const spread = Math.max(...lefts) - Math.min(...lefts);
    const byN = new Map();
    for (const el of list) {
      const cs = [...el.querySelectorAll(CTRL)];
      if (!byN.has(cs.length)) byN.set(cs.length, []);
      byN.get(cs.length).push(cs);
    }
    let colBad = 0, colWorst = 0;
    for (const [, sets] of byN) {
      if (sets.length < 3) continue;
      for (let i = 0; i < sets[0].length; i++) {
        const ls = sets.map(s => Math.round(s[i].getBoundingClientRect().left));
        const sp = Math.max(...ls) - Math.min(...ls);
        if (sp > 4) { colBad++; colWorst = Math.max(colWorst, sp); }
      }
    }
    if ((spread > 4 && spread < near) || colBad) {
      out.push({ n: list.length, spread, uniq: [...new Set(lefts)].slice(0, 6), colBad, colWorst,
        txt: (list[0].innerText || '').replace(/\s+/g, ' ').slice(0, 40) });
    }
  }
  return { out, skipped };
};

const hits = [];
let skipTotal = 0;
for (const name of PAGES) {
  const p = await b.newPage({ viewport: { width: VW, height: VH }, timezoneId: 'Asia/Bangkok' });
  try {
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}&role=admin`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForTimeout(1400);
    const seen = new Set();
    const take = async (where) => {
      const res = await p.evaluate(SCAN, NEAR);
      skipTotal += res.skipped;
      for (const h of res.out) {
        const k = `${h.txt}|${h.n}`;
        if (seen.has(k)) continue;
        seen.add(k);
        hits.push({ page: name, where, ...h });
      }
    };
    await take('หน้าแรก');
    /* ⚠️ ต้องหา element ใหม่ทุกรอบ (กดแล้ว re-render = handle เดิม detach) — กับดักเดียวกับ crashsweep */
    const labels = [];
    for (const btn of await p.$$('header button, main button')) {
      const t = ((await btn.textContent()) || '').trim().slice(0, 22);
      if (t && t.length > 1 && !labels.includes(t)) labels.push(t);
      if (labels.length >= TAB_CAP) break;
    }
    for (const label of labels) {
      try {
        const loc = p.locator('header button, main button').filter({ hasText: label }).first();
        if (!(await loc.count())) continue;
        await loc.click({ timeout: 800 });
        await p.waitForTimeout(900);
        await take(`แท็บ "${label}"`);
      } catch { /* กดไม่ติด = ข้าม */ }
    }
  } catch (e) {
    console.log(`⚠️ ${name}: โหลดไม่ขึ้น — ${String(e).slice(0, 70)}`);
  }
  await p.close();
}
await b.close();

hits.sort((a, c) => (c.spread + c.colWorst) - (a.spread + a.colWorst));
for (const h of hits) {
  console.log(`🔸 ${h.page} · ${h.where} — แถว ${h.n} · ช่องแรกเยื้อง ${h.spread}px ${JSON.stringify(h.uniq)}`
    + ` · คอลัมน์ไม่ตรง ${h.colBad} (สูงสุด ${h.colWorst}px) | "${h.txt}"`);
}
console.log(`\nตรวจ ${PAGES.length} หน้า @${VW}px — จุดที่แถวไม่ตรงเป็นคอลัมน์ ${hits.length} จุด / ${new Set(hits.map(h => h.page)).size} หน้า`
  + (skipTotal ? `  (ข้ามแถวที่ติด data-align-ok ${skipTotal} แถว)` : ''));
if (hits.length) console.log('วิธีแก้ (UI-CONVENTIONS §6.28): ให้แถวเพิ่ม+แถวข้อมูลใช้ gridTemplateColumns ชุดเดียว · ช่องใน width:100% minWidth:0 · ห้าม flex:1 1 Npx');
console.log('ALLDONE');
