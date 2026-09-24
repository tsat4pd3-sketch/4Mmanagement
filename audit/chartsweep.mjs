/* chart-sweep — ตรวจ "กราฟทุกตัว ทุกหน้า ทุกแท็บ" ว่าตัวเลข/ป้ายบนแกนอ่านออกจริง (2026-09-24 · คำสั่ง user)
 *
 * ที่มา: user ส่งภาพจอ SQDCM — แกนตั้งเขียน "0", "5", "7" ทั้งที่ค่าจริงคือ 100 / 75 / …
 *        *"ตัวเลขของกราฟแกนแนวตั้ง ดูไม่ออกเลยเลขอะไร audit ทุกกราฟให้ด้วย"*
 * ต้นเหตุคลาสนี้: `<YAxis width={…}>` แคบกว่าตัวเลขที่ยาวที่สุด ⇒ SVG ตัดตัวหน้าทิ้ง (overflow ของ <svg> = hidden)
 *        เหลือแต่หลักท้าย — **build/lint/เทส/crashsweep/uxsweep ผ่านหมด** เพราะไม่มีอะไร "พัง" มันแค่อ่านผิด
 *
 * วัด (จากจอจริง ทุกหน้า × ทุกแท็บ @1600px):
 *  1. `cut`   ป้ายตัวหนังสือใน <svg> ที่ยื่นเลยกรอบ svg (ถูกตัด = อ่านผิด เช่น 100 → "0")
 *  2. `tiny`  ตัวเลข/ป้ายแกนเล็กกว่า 11px (UI §4 — จอ TV ดูไกล)
 *  3. `noY`   กราฟ Recharts ที่มีเส้นกริดแต่ **ไม่มีตัวเลขแกน Y** (UI-CONVENTIONS §5 "กราฟทุกตัวต้องมีแกน Y + ตัวเลข")
 *  4. `lap`   ป้ายแกน X ทับกันเอง (อ่านไม่ออก)
 * ข้าม: SVG ที่เป็นผัง (มี <image> = รูปผังโรงงาน · ป้ายสเกลตาม markerScale โดยตั้งใจ) · ไอคอนเล็ก (< 120×60)
 *
 * ใช้: เปิด `npx vite --config audit/vite.audit.mjs --port 5199` ค้างไว้ แล้ว `node audit/chartsweep.mjs [Page…]`
 */
import { chromium } from 'playwright';

const VIEW = { width: 1600, height: 950 };
const TZ = { timezoneId: 'Asia/Bangkok' };
const ONLY = process.argv.slice(2);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p0 = await b.newPage({ ...TZ });
await p0.goto('http://localhost:5199/audit/index.html'); await p0.waitForTimeout(1200);
const ALL = await p0.evaluate(() => window.__PAGES); await p0.close();
const PAGES = ONLY.length ? ALL.filter(n => ONLY.includes(n)) : ALL;

const measure = () => {
  const main = document.getElementById('mainbox');
  const vis = el => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const out = { charts: 0, cut: [], tiny: [], noY: [], lap: [] };
  const titleOf = svg => {
    for (let a = svg.parentElement, d = 0; a && a !== main && d < 7; a = a.parentElement, d++) {
      const t = [...a.querySelectorAll('b,h3,h4,div,span')].find(x => (x.innerText || '').trim().length > 3 && x.getBoundingClientRect().top <= svg.getBoundingClientRect().top && !x.contains(svg));
      if (t) return t.innerText.replace(/\s+/g, ' ').trim().slice(0, 28);
    }
    return '?';
  };
  for (const svg of main.querySelectorAll('svg')) {
    if (!vis(svg) || svg.querySelector('image') || svg.closest('svg') !== svg) continue;
    const sr = svg.getBoundingClientRect();
    if (sr.width < 120 || sr.height < 60) continue;
    const texts = [...svg.querySelectorAll('text')].filter(t => (t.textContent || '').trim());
    if (texts.length < 3) continue;
    out.charts++;
    const name = titleOf(svg);
    for (const t of texts) {
      const r = t.getBoundingClientRect(); if (!r.width) continue;
      const txt = t.textContent.trim().slice(0, 12);
      const over = Math.max(sr.left - r.left, r.right - sr.right, sr.top - r.top, r.bottom - sr.bottom);
      if (over > 2) out.cut.push(`[${name}] "${txt}" ยื่นเลยกรอบ ${Math.round(over)}px`);
      /* ขนาด "ที่เห็นบนจอ" = font-size × สเกลของ SVG (viewBox ย่อ/ขยาย) — ไม่ใช่ตัวเลขในโค้ด */
      const ctm = t.getScreenCTM(); const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
      const fs = Math.round(parseFloat(getComputedStyle(t).fontSize) * scale * 10) / 10;
      if (fs < 10.5) out.tiny.push(`[${name}] "${txt}" ${fs}px`);
    }
    // Recharts: มีแท่ง/เส้น "จริง" แต่ไม่มีตัวเลขแกน Y
    //   ⚠️ Recharts 3 วางป้ายแกนในกลุ่มแยก `.recharts-yAxis-tick-labels` (ไม่ได้อยู่ใต้ `.recharts-yAxis`)
    //   ⚠️ กราฟที่ยังไม่มีข้อมูล (ไม่มีแท่ง/เส้น) ไม่นับ — ไม่งั้นรายงานเท็จเพราะ harness ไม่มีข้อมูลชุดนั้น
    if (svg.classList.contains('recharts-surface')) {
      const hasMarks = svg.querySelector('.recharts-bar-rectangle path, .recharts-bar-rectangle rect, .recharts-line-curve, .recharts-area-area');
      const yTicks = svg.querySelectorAll('.recharts-yAxis-tick-labels text, .recharts-yAxis .recharts-cartesian-axis-tick-value');
      const xTicks = svg.querySelectorAll('.recharts-xAxis-tick-labels text, .recharts-xAxis .recharts-cartesian-axis-tick-value');
      // layout="vertical" (แท่งนอน) = แกนตัวเลขคือ X ⇒ ต้องมีตัวเลขฝั่งใดฝั่งหนึ่งที่เป็นตัวเลข
      const labels = svg.querySelectorAll('.recharts-label-list text, .recharts-label');   // ตัวเลขกำกับปลายแท่ง = อ่านค่าได้เช่นกัน
      const numeric = [...yTicks, ...xTicks, ...labels].some(t => /^-?[\d,.]+\s*(%|k|น\.|นาที|ชิ้น|บาท|ppm)?$/i.test(t.textContent.trim()));
      if (hasMarks && !numeric) out.noY.push(`[${name}]`);
    }
    // ป้ายแกน X ทับกัน
    const xs = [...svg.querySelectorAll('.recharts-xAxis-tick-labels text, .recharts-xAxis .recharts-cartesian-axis-tick-value')].map(t => t.getBoundingClientRect()).filter(r => r.width).sort((a, b) => a.left - b.left);
    for (let i = 1; i < xs.length; i++) {
      if (xs[i].left < xs[i - 1].right - 2 && Math.abs(xs[i].top - xs[i - 1].top) < xs[i].height * 0.6) { out.lap.push(`[${name}]`); break; }
    }
  }
  for (const k of ['cut', 'tiny', 'noY', 'lap']) out[k] = [...new Set(out[k])];
  return out;
};

const rows = [];
for (const name of PAGES) {
  const p = await b.newPage({ viewport: VIEW, ...TZ });
  try {
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}&role=admin`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await p.waitForTimeout(2200);
    const n = await p.evaluate(() => document.querySelectorAll('#mainbox [data-tabbar] > button').length || 1);
    for (let i = 0; i < Math.max(1, n); i++) {
      if (i) {
        await p.evaluate(k => { document.querySelectorAll('#mainbox [data-tabbar] > button')[k]?.click(); }, i).catch(() => {});
        await p.waitForTimeout(1600); await p.keyboard.press('Escape').catch(() => {});
      }
      rows.push({ name, tab: i, ...(await p.evaluate(measure)) });
    }
  } catch (e) { rows.push({ name, tab: 0, err: String(e).slice(0, 90) }); }
  await p.close();
}
await b.close();

const charts = rows.reduce((s, r) => s + (r.charts || 0), 0);
const bad = rows.filter(r => r.err || r.cut?.length || r.tiny?.length || r.noY?.length || r.lap?.length);
console.log(`ตรวจ ${PAGES.length} หน้า / ${rows.length} มุมมอง · กราฟ ${charts} ตัว · มีปัญหา ${bad.length} มุมมอง`);
for (const r of bad) {
  console.log(`🔴 ${r.name} [แท็บ ${r.tab}]${r.err ? ' ' + r.err : ''}`);
  if (r.cut?.length) console.log(`   ✂️ ถูกตัด ${r.cut.length}: ${r.cut.slice(0, 4).join(' · ')}`);
  if (r.tiny?.length) console.log(`   🔍 เล็กกว่า 11px ${r.tiny.length}: ${r.tiny.slice(0, 3).join(' · ')}`);
  if (r.noY?.length) console.log(`   📏 ไม่มีตัวเลขแกน Y: ${r.noY.join(' · ')}`);
  if (r.lap?.length) console.log(`   🧱 ป้ายแกน X ทับกัน: ${r.lap.join(' · ')}`);
}
process.exit(bad.length ? 1 : 0);
