/* search-sweep — "พิมพ์ในช่องค้นหาแล้ว จอต้องกรองตาม" ทุกหน้า × ทุกแท็บ (2026-10-01 · user: "พิมไปแล้ว ไม่เห็นกรองให้")
 *
 * วิธีวัด: หาช่องค้นหาที่มองเห็น (SearchInput · input[type=search] · placeholder ขึ้นต้น "ค้น"/"🔎"/"Search")
 *   แล้วพิมพ์คำที่ไม่มีทางเจอ (`zqxj9`) → เทียบเนื้อหาของหน้า/ลิสต์ก่อน-หลัง
 *   1. `dead`  พิมพ์แล้วเนื้อหาไม่เปลี่ยนเลย = ช่องไม่ได้ต่อกับอะไร (หรือกรองไม่ทำงาน)
 *   2. `lost`  พิมพ์แล้วช่องว่างเปล่า (ตัวอักษรหาย = controlled ผิด)
 *   3. `stick` picker (SearchSelect) ที่พิมพ์แล้วลิสต์ยังโชว์ "แสดง N จาก M" เท่าเดิม
 *   4. `overlap` ไอคอน/ของที่วางลอย (position:absolute) ทับจุดเริ่มตัวหนังสือของช่องกรอก (ทุกช่อง ไม่ใช่แค่ค้นหา)
 *      — เคสจริง 01/10: 🔍 ทับคำในช่องค้นหา 17 หน้า เพราะกฎแถบกรองเขียนทับ padding ซ้าย
 *   5. `lab`   picker กลางที่พาเรนต์เก็บคำที่พิมพ์ (แบบ EdiMatchFixer) ต้องกรองตาม — `audit/searchlab.html`
 *      (picker ส่วนใหญ่อยู่ในฟอร์ม/โมดัลที่ไม่เปิดตอนโหลดหน้า กวาดหน้าเปล่าๆ จึงไม่เจอ — เคสจริง: พิมพ์ 274 ขึ้นครบ 128)
 * ข้าม: ช่องที่ข้อมูล mock ว่างทั้งหน้า (ไม่มีอะไรให้กรอง) — รายงานแยกเป็น `noData` ไม่นับเป็นผิด
 *
 * ใช้: เปิด `npx vite --config audit/vite.audit.mjs --port 5199` ค้างไว้ แล้ว `node audit/searchsweep.mjs [Page…]`
 */
import { chromium } from 'playwright';

const VIEW = { width: 1600, height: 950 };
const TZ = { timezoneId: 'Asia/Bangkok' };
const ONLY = process.argv.slice(2);
const NONSENSE = 'zqxj9';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p0 = await b.newPage({ ...TZ });
await p0.goto('http://localhost:5199/audit/index.html'); await p0.waitForTimeout(1200);
const ALL = await p0.evaluate(() => window.__PAGES); await p0.close();
const PAGES = ONLY.length ? ALL.filter(n => ONLY.includes(n)) : ALL;

const findBoxes = () => {
  const main = document.getElementById('mainbox');
  const vis = el => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const inOverlay = el => { for (let a = el; a && a !== document.body; a = a.parentElement) { const c = getComputedStyle(a); if (c.position === 'fixed' && Number(c.zIndex) >= 100) return true; } return false; };
  const out = [];
  [...main.querySelectorAll('input')].forEach((el, i) => {
    if (!vis(el) || inOverlay(el) || el.disabled || el.readOnly) return;
    const ph = (el.placeholder || '').trim();
    const isSearch = el.type === 'search' || /^(🔎|🔍|ค้น|search)/i.test(ph) || el.closest('.search-input');
    if (!isSearch) return;
    el.setAttribute('data-ss', String(i));
    out.push({ k: String(i), ph: ph.slice(0, 40) });
  });
  return out;
};
const snap = () => {
  const main = document.getElementById('mainbox');
  const t = main.innerText.replace(/\s+/g, ' ');
  const foot = (t.match(/แสดง \d+ จาก \d+/) || [''])[0];
  return { len: t.length, hash: t.length + ':' + t.slice(0, 4000), foot };
};

const overlapCheck = () => {
  const main = document.getElementById('mainbox');
  const vis = el => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && c.opacity !== '0'; };
  const out = [];
  for (const i of main.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=hidden])')) {
    if (!vis(i)) continue;
    const ir = i.getBoundingClientRect(); const cs = getComputedStyle(i);
    const textL = ir.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const box = i.parentElement; if (!box) continue;
    for (const el of box.children) {
      if (el === i || !vis(el) || getComputedStyle(el).position !== 'absolute') continue;
      const r = el.getBoundingClientRect();
      const vOver = r.bottom > ir.top + 4 && r.top < ir.bottom - 4;
      if (vOver && r.left < textL + 4 && r.right > textL + 2) out.push(`${(i.placeholder || i.type || '').slice(0, 30)} (ทับ ${Math.round(r.right - textL)}px)`);
    }
  }
  return out;
};

const rows = [];
// ขั้น lab — picker ที่พาเรนต์เก็บคำค้น ต้องกรองตาม + ค่านอกทะเบียนต้องไม่ค้าง (allowFree=false)
{
  const p = await b.newPage({ viewport: VIEW, ...TZ });
  await p.goto('http://localhost:5199/audit/searchlab.html'); await p.waitForTimeout(2000);
  await p.click('input'); await p.keyboard.type('274', { delay: 40 }); await p.waitForTimeout(400);
  const t = await p.evaluate(() => document.getElementById('root').innerText);
  const stuck = /แสดง \d+ จาก/.test(t) || !/16C274/.test(t);
  await p.mouse.click(500, 700); await p.waitForTimeout(300);
  const leftover = (await p.textContent('#val')).trim();
  rows.push({ name: 'searchlab', tab: 0, ph: 'ProductSelect · พิมพ์ 274', issue: stuck ? 'lab ไม่กรอง' : leftover ? `lab ค่านอกทะเบียนค้าง "${leftover}"` : null });
  await p.close();
}
for (const name of PAGES) {
  const p = await b.newPage({ viewport: VIEW, ...TZ });
  try {
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}&role=admin`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await p.waitForTimeout(2200);
    const n = await p.evaluate(() => document.querySelectorAll('#mainbox [data-tabbar] > button').length || 1);
    for (let t = 0; t < Math.max(1, n); t++) {
      if (t) { await p.evaluate(k => document.querySelectorAll('#mainbox [data-tabbar] > button')[k]?.click(), t).catch(() => {}); await p.waitForTimeout(1500); }
      for (const o of await p.evaluate(overlapCheck)) rows.push({ name, tab: t, ph: o, issue: 'overlap' });
      const boxes = await p.evaluate(findBoxes);
      for (const bx of boxes) {
        const sel = `[data-ss="${bx.k}"]`;
        try {
          await p.click(sel, { timeout: 2000 }); await p.waitForTimeout(350);
          const before = await p.evaluate(snap);
          await p.fill(sel, ''); await p.type(sel, NONSENSE, { delay: 15 }); await p.waitForTimeout(700);
          const after = await p.evaluate(snap);
          const val = await p.inputValue(sel).catch(() => '');
          let issue = null;
          if (val !== NONSENSE) issue = `lost (ช่องเหลือ "${val}")`;
          else if (before.foot && after.foot && before.foot === after.foot) issue = `stick (${after.foot})`;
          else if (before.hash === after.hash) issue = before.len < 400 ? 'noData' : 'dead';
          rows.push({ name, tab: t, ph: bx.ph, issue });
          await p.fill(sel, '').catch(() => {}); await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(250);
        } catch (e) { rows.push({ name, tab: t, ph: bx.ph, issue: 'err ' + String(e).slice(0, 60) }); }
      }
    }
  } catch (e) { rows.push({ name, tab: 0, ph: '', issue: 'load ' + String(e).slice(0, 60) }); }
  await p.close();
}
await b.close();
const bad = rows.filter(r => r.issue && r.issue !== 'noData');
console.log(`ตรวจ ${PAGES.length} หน้า · ช่องค้นหา ${rows.length} ช่อง · ผิด ${bad.length} · ไม่มีข้อมูลให้ทดสอบ ${rows.filter(r => r.issue === 'noData').length}`);
for (const r of rows.filter(r => r.issue)) console.log(`${r.issue === 'noData' ? '⚪' : '🔴'} ${r.name} [แท็บ ${r.tab}] "${r.ph}" → ${r.issue}`);
process.exit(bad.length ? 1 : 0);
