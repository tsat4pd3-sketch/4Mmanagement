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
 *  6. `nav`    **"คุณอยู่ตรงนี้" บนรางไอคอน** — ยืนอยู่หน้าไหน หมวดที่มีหน้านั้นต้องถูกมาร์ค
 *              `aria-current` **ครบทุกหมวด** (หน้าที่ตั้ง `alsoIn` อยู่ 2 หมวดจริงๆ ต้องติดทั้งคู่)
 *              ⚠️ ด่านนี้มีเพราะ bug จริง 24/09: รางไฮไลต์ "แผงที่กดเปิด" แรงกว่า "หน้าที่เปิดอยู่จริง"
 *                 และ lab ของ sidebar ตรึง path เป็น `/` เสมอ ⇒ **ไม่มี sweep ไหนเคยเห็นไฮไลต์นี้เลย**
 *                 จน user ต้องมาทักเอง ("sidebar นอกสุดไม่บอกว่าอยู่หน้าไหน")
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
    /* ตรวจเฉพาะ dropdown ที่เป็น "ตัวกรอง" (อยู่ในแถบกรอง) — ช่องในฟอร์มใช้ "— … —" ได้ตามมาตรฐาน §3.4
       รูปแบบที่ถูก: ALL.* หรือ allOf() = "ทุก<คำนาม>" ไม่มีขีด/วงเล็บ/อังกฤษ */
    if (s.closest('.filter-bar') && (s.options[0]?.value === '' || /^all$/i.test(s.options[0]?.value || ''))) {
      const isAll = /^(—\s*)?(ทุก|ทั้งหมด|ALL\b)/i.test(t);
      const okForm = window.__ALL.has(t) || /^ทุก[^—()A-Za-z]+$/.test(t) || /^ทุก Rank$/.test(t);
      if (isAll && !okForm) out.all.push(`"${t}"`);
    }
  }
  for (const el of main.querySelectorAll('.filter-bar select, .filter-bar input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file])')) {
    if (!vis(el) || inOv(el)) continue; const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    if (Math.abs(r.height - 34) > 1 || c.borderTopLeftRadius !== '8px') out.ctl.push(`${el.tagName.toLowerCase()} h${Math.round(r.height)} r${c.borderTopLeftRadius}`);
  }
  /* 6. `order` ลำดับแนวตั้ง (24/09 · user: "ลำดับยังโดดไปมา เดี๋ยวแท็บมาก่อนช่องค้นหา บางหน้าค้นหาอยู่บนสุด")
        มาตรฐาน: ชื่อหน้า|ปุ่มคำสั่ง → แท็บ → แถบกรอง → เนื้อหา
        ผิดเมื่อ (ก) มีช่องกรอง (select/input/segmented/ปุ่มช่วงเวลา) อยู่ใน `actions` ของ PageHeader
                 (ข) มีช่องกรองอยู่ **เหนือ** แถบแท็บ */
  out.order = [];
  const CTL = 'select, input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]), .seg, .search-input';
  for (const el of main.querySelectorAll(`[data-ph="actions"] :is(${CTL})`)) {
    if (!vis(el) || inOv(el)) continue;
    out.order.push(`ช่องกรองอยู่ในปุ่มหัวเพจ (${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''})`);
  }
  const ind = main.querySelector('[data-tab-ind]');
  if (ind) {
    const tabTop = ind.parentElement.getBoundingClientRect().top;
    for (const el of main.querySelectorAll(CTL)) {
      if (!vis(el) || inOv(el) || el.closest('[data-ph="actions"]')) continue;
      if (el.getBoundingClientRect().bottom <= tabTop + 1) out.order.push(`ช่องกรองอยู่เหนือแถบแท็บ (${el.tagName.toLowerCase()})`);
    }
  }
  out.order = [...new Set(out.order)];
  /* 7. `gapFB` ระยะ แถบแท็บ → แถบกรองแรก (px) — ต้องเท่ากันทุกหน้า (ค่ามาตรฐาน = ค่าที่พบมากสุด) */
  if (ind) {
    /* วัดจากแถวแท็บที่อยู่ "ใกล้ที่สุดเหนือแถบกรอง" — หน้าลูกใน hub มีแท็บย่อยของตัวเอง (แท็บ → แท็บย่อย → แถบกรอง = ถูก) */
    const rows = [...main.querySelectorAll('[data-tab-ind]')].map(i => i.parentElement.getBoundingClientRect());
    /* แถบแบบ `bare` อยู่ในการ์ดที่ทำหน้าที่เป็นแถบ ⇒ วัดกรอบการ์ดนั้น (สิ่งที่ตาเห็น) ไม่ใช่ตัวแถบที่ถูก padding ดันลง */
    const boxOf = e => { if (!e.classList.contains('bare')) return e.getBoundingClientRect();
      for (let a = e.parentElement, d = 0; a && a !== main && d < 3; a = a.parentElement, d++) { const c = getComputedStyle(a); if (parseFloat(c.borderTopWidth) >= 1 && c.borderTopStyle !== 'none') return a.getBoundingClientRect(); }
      return e.getBoundingClientRect(); };
    const fbs = [...main.querySelectorAll('.filter-bar')].filter(e => vis(e) && !inOv(e)).map(boxOf);
    const tb = rows.filter(r => fbs.some(f => f.top >= r.bottom - 1)).sort((a, b) => b.bottom - a.bottom)[0] || ind.parentElement.getBoundingClientRect();
    const fb = fbs.filter(r => r.top >= tb.bottom - 1).sort((a, b) => a.top - b.top)[0];
    if (fb && fb.top - tb.bottom < 80) out.gapFB = Math.round(fb.top - tb.bottom);
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
    /* หาแถบแท็บจาก `data-tabbar` ของ PageHeader (24/09) — เดิมยืม `data-ux-ok="tab-indicator"`
       ของ uxsweep มาใช้ พอ uxsweep เลิกต้องการแล้วถอดออก ตัวนี้ก็เหลือหน้าละ 1 แท็บเงียบๆ */
    const n = await p.evaluate(() => document.querySelectorAll('#mainbox [data-tabbar] > button').length || 1);
    for (let i = 0; i < Math.max(1, n); i++) {
      if (i) {
        await p.evaluate(k => { document.querySelectorAll('#mainbox [data-tabbar] > button')[k]?.click(); }, i).catch(() => {});
        await p.waitForTimeout(1300); await p.keyboard.press('Escape').catch(() => {});
      }
      rows.push({ name, tab: i, ...(await p.evaluate(measure)) });
    }
  } catch (e) { rows.push({ name, tab: 0, err: String(e).slice(0, 90) }); }
  await p.close();
}
await b.close();

/* ── 6) "คุณอยู่ตรงนี้" บนรางไอคอน ───────────────────────────────────────────────
   เปิด lab ของ sidebar ทีละ route แล้วเทียบ: หมวดที่ถูกมาร์ค `aria-current` บนราง
   ต้องเท่ากับหมวดที่ทะเบียนเมนูบอก (group + alsoIn) เป๊ะ — ขาดไป/เกินมา = จอโกหกตำแหน่ง */
const navBad = [];
{
  const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p0b = await b2.newPage({ viewport: VIEW, ...TZ });
  await p0b.goto('http://localhost:5199/audit/index.html?p=__sidebar&role=admin');
  await p0b.waitForTimeout(1200);
  const nav = await p0b.evaluate(() => window.__NAV || []);
  await p0b.close();
  const routes = ONLY.length ? [] : [...new Set(nav.map(i => i.to))];
  for (const to of routes) {
    const want = new Set(nav.filter(i => i.to === to).flatMap(i => [i.group, i.alsoIn].filter(Boolean)));
    const p = await b2.newPage({ viewport: VIEW, ...TZ });
    try {
      await p.goto(`http://localhost:5199/audit/index.html?p=__sidebar&role=admin&path=${encodeURIComponent(to)}`,
        { waitUntil: 'domcontentloaded', timeout: 20000 });
      await p.waitForSelector('nav button[aria-current]', { timeout: 6000 });
      const got = await p.evaluate(() => [...document.querySelectorAll('nav button[aria-current]')].map(x => x.title.split(' — ')[0]));
      const miss = [...want].filter(g => !got.includes(g));
      const extra = got.filter(g => !want.has(g));
      if (miss.length || extra.length) {
        navBad.push(`🔴 ${to} — มาร์คหมวด [${got.join(' , ') || '(ไม่มีเลย)'}] แต่ควรเป็น [${[...want].join(' , ')}]`);
      }
    } catch (e) { navBad.push(`🔴 ${to} — ตรวจไม่ได้: ${String(e.message).slice(0, 60)}`); }
    await p.close();
  }
  await b2.close();
}

const xs = rows.filter(r => r.x != null).map(r => r.x);
const freq = xs.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
const STD_X = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0);
const gf = rows.filter(r => r.gapFB != null).map(r => r.gapFB);
const gfreq = gf.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
const STD_GAP = Number(Object.entries(gfreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 16);
const bad = [];
for (const r of rows) {
  const why = [];
  if (r.err) why.push(`เปิดไม่ขึ้น ${r.err}`);
  if (r.x == null) why.push('ไม่มีหัวเรื่อง h1/h2');
  else if (Math.abs(r.x - STD_X) > 2) why.push(`x=${r.x} (มาตรฐาน ${STD_X})`);
  if (r.dup > 1) why.push(`หัวซ้อน ${r.dup} ตัว`);
  if (r.wide?.length) why.push(`select ยืด ${r.wide.join(', ')}`);
  if (r.ctl?.length) why.push(`ช่องกรองผิด token ${[...new Set(r.ctl)].slice(0, 3).join(', ')}${r.ctl.length > 3 ? ` +${r.ctl.length - 3}` : ''}`);
  if (r.gapFB != null && Math.abs(r.gapFB - STD_GAP) > 3) why.push(`ระยะแท็บ→แถบกรอง ${r.gapFB}px (มาตรฐาน ${STD_GAP})`);
  if (r.order?.length) why.push(`ลำดับผิด: ${r.order.join(', ')}`);
  if (r.all?.length) why.push(`ป้ายทั้งหมดนอกทะเบียน ${[...new Set(r.all)].join(', ')}`);
  if (why.length) bad.push(`🔴 ${r.name} [แท็บ ${r.tab}] ${r.title ? `"${r.title}" ` : ''}— ${why.join(' · ')}`);
}
console.log(`ตรวจ ${PAGES.length} หน้า / ${rows.length} มุมมอง @${VIEW.width}px · ตำแหน่งชื่อหน้ามาตรฐาน x=${STD_X} · ระยะแท็บ→แถบกรอง ${STD_GAP}px · ผิด ${bad.length} มุมมอง`);
bad.forEach(l => console.log(l));
if (!ONLY.length) console.log(`🧭 "คุณอยู่ตรงนี้" บนรางไอคอน — ผิด ${navBad.length} route`);
navBad.forEach(l => console.log(l));
process.exit((bad.length + navBad.length) ? 1 : 0);
