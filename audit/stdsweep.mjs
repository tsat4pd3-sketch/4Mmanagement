/* std-sweep — ตรวจ "มาตรฐานหน้าตา" ข้ามหน้า (2026-09-24 · docs/UI-STANDARD.md)
 *
 * ที่มา: audit 23/09 user บอกว่าระบบ "แปลกๆ" + "search/filter/dropdown มั่ว" — ต้นเหตุคือของที่ควรเหมือนกัน
 * ข้ามหน้าไม่เหมือนกัน (ชื่อหน้าเริ่มคนละตำแหน่ง 20+ ค่า · ช่องกรอง 71 ทรง · "ทั้งหมด" 30+ แบบ)
 * เครื่องมืออื่นดูทีละหน้า (crash/mobile/ux) — ตัวนี้ **เทียบข้ามหน้า** เปิดทุกหน้า × ทุกแท็บของ PageHeader
 *
 * วัด (จาก computed style ของจอจริง):
 *  1. `x`      ตำแหน่งซ้ายของชื่อหน้า/แถบแท็บ ต้องเท่ากันทุกหน้า (ค่ามาตรฐาน = ค่าที่พบมากที่สุด)
 *  2. `dup`    หัวเรื่องหลัก (h1/h2) ซ้อนกัน > 1 ตัวในส่วนบนของหน้า (hub ต้องไม่หัวซ้อน)
 *  3. `wide`   <select> ยืดเกิน 45% ของความกว้างเนื้อหา (บั๊ก select{width:100%})
 *  4. `ctl`    ช่องใน .filter-bar ที่สูง/มุม ไม่ตรง token (--ctl-h 34 · --ctl-r 8)
 *  5. `all`    ตัวเลือก "ทั้งหมด" ของ dropdown ที่ไม่ใช่ป้ายในทะเบียน ALL (src/utils/filterLabels.js)
 *
 * ยกเว้นทั้งหน้า: บอร์ด TV ตาม UI-STANDARD §1 (ไม่มี PageHeader โดยตั้งใจ)
 * ใช้: เปิด `npx vite --config audit/vite.audit.mjs --port 5199` ค้างไว้ แล้ว `node audit/stdsweep.mjs [Page…]`
 */
import { chromium } from 'playwright';
import { ALL } from '../src/utils/filterLabels.js';

const EXEMPT = new Set(['Login', 'Dashboard', 'Management', 'LineOeeBoard', 'TvBoard', 'LineSetup', 'DeptHub']);
const ALL_LABELS = new Set(Object.values(ALL));
const VIEW = { width: 1600, height: 950 };
const TZ = { timezoneId: 'Asia/Bangkok' };
const ONLY = process.argv.slice(2);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p0 = await b.newPage({ ...TZ });
await p0.goto('http://localhost:5199/audit/index.html'); await p0.waitForTimeout(1200);
const PAGES = (await p0.evaluate(() => window.__PAGES)).filter(n => (ONLY.length ? ONLY.includes(n) : !EXEMPT.has(n)));
await p0.close();

const measure = () => {
  const main = document.getElementById('mainbox'); const mr = main.getBoundingClientRect();
  const vis = el => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const inOv = el => { for (let a = el; a && a !== document.body; a = a.parentElement) { const c = getComputedStyle(a); if (c.position === 'fixed' && Number(c.zIndex) >= 100) return true; } return false; };
  const heads = [...main.querySelectorAll('h1,h2')].filter(h => vis(h) && !inOv(h) && h.getBoundingClientRect().top - mr.top < 420);
  const h = heads[0];
  const out = { x: h ? Math.round(h.getBoundingClientRect().left - mr.left) : null, title: h ? h.innerText.replace(/\s+/g, ' ').slice(0, 30) : '', dup: heads.length, wide: [], ctl: [], all: [] };
  for (const s of main.querySelectorAll('select')) {
    if (!vis(s) || inOv(s)) continue; const r = s.getBoundingClientRect();
    if (r.width > mr.width * 0.45) out.wide.push(`${Math.round(r.width)}px "${(s.options[0]?.text || '').slice(0, 24)}"`);
    const t = (s.options[0]?.text || '').trim();
    if (s.options[0]?.value === '' || /^all$/i.test(s.options[0]?.value || '')) {
      if (/^(—\s*)?(ทุก|ทั้งหมด|ALL\b)/i.test(t) && !window.__ALL.has(t)) out.all.push(`"${t}"`);
    }
  }
  for (const el of main.querySelectorAll('.filter-bar select, .filter-bar input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file])')) {
    if (!vis(el) || inOv(el)) continue; const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    if (Math.abs(r.height - 34) > 1 || c.borderTopLeftRadius !== '8px') out.ctl.push(`${el.tagName.toLowerCase()} h${Math.round(r.height)} r${c.borderTopLeftRadius}`);
  }
  return out;
};

const rows = [];
for (const name of PAGES) {
  const p = await b.newPage({ viewport: VIEW, ...TZ });
  await p.addInitScript(labels => { window.__ALL = new Set(labels); }, [...ALL_LABELS]);
  try {
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}&role=admin`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await p.waitForTimeout(1800);
    const n = await p.evaluate(() => { const i = document.querySelector('#mainbox [data-ux-ok="tab-indicator"]'); return i ? [...i.parentElement.children].filter(c => c.tagName === 'BUTTON').length : 1; });
    for (let i = 0; i < Math.max(1, n); i++) {
      if (i) {
        await p.evaluate(k => { const ind = document.querySelector('#mainbox [data-ux-ok="tab-indicator"]'); [...ind.parentElement.children].filter(c => c.tagName === 'BUTTON')[k]?.click(); }, i).catch(() => {});
        await p.waitForTimeout(1300); await p.keyboard.press('Escape').catch(() => {});
      }
      rows.push({ name, tab: i, ...(await p.evaluate(measure)) });
    }
  } catch (e) { rows.push({ name, tab: 0, err: String(e).slice(0, 90) }); }
  await p.close();
}
await b.close();

const xs = rows.filter(r => r.x != null).map(r => r.x);
const freq = xs.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
const STD_X = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0);
const bad = [];
for (const r of rows) {
  const why = [];
  if (r.err) why.push(`เปิดไม่ขึ้น ${r.err}`);
  if (r.x == null) why.push('ไม่มีหัวเรื่อง h1/h2');
  else if (Math.abs(r.x - STD_X) > 2) why.push(`x=${r.x} (มาตรฐาน ${STD_X})`);
  if (r.dup > 1) why.push(`หัวซ้อน ${r.dup} ตัว`);
  if (r.wide?.length) why.push(`select ยืด ${r.wide.join(', ')}`);
  if (r.ctl?.length) why.push(`ช่องกรองผิด token ${[...new Set(r.ctl)].slice(0, 3).join(', ')}${r.ctl.length > 3 ? ` +${r.ctl.length - 3}` : ''}`);
  if (r.all?.length) why.push(`ป้ายทั้งหมดนอกทะเบียน ${[...new Set(r.all)].join(', ')}`);
  if (why.length) bad.push(`🔴 ${r.name} [แท็บ ${r.tab}] ${r.title ? `"${r.title}" ` : ''}— ${why.join(' · ')}`);
}
console.log(`ตรวจ ${PAGES.length} หน้า / ${rows.length} มุมมอง @${VIEW.width}px · ตำแหน่งชื่อหน้ามาตรฐาน x=${STD_X} · ผิด ${bad.length} มุมมอง`);
bad.forEach(l => console.log(l));
process.exit(bad.length ? 1 : 0);
