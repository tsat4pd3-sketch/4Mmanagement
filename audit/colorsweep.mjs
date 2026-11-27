/* color-sweep — วัด "จอนี้ใช้สีเกินจำเป็นแค่ไหน" ทุกหน้า (2026-11-25 · คำสั่ง user)
 *
 * ที่มา: user ส่งรูป `/daily-report` มาแล้วบอก *"สีสันเยอะจนมองเป็นโปรแกรมไม่ formal"*
 * พอไล่หน้านั้นเสร็จก็สั่งต่อ *"ไล่สีแบบนี้ต่อในหน้าอื่นด้วย"* ⇒ 90+ หน้าไล่ด้วยตาไม่มีทางครบ
 * และจะ drift กลับทุกครั้งที่มี session เพิ่มฟีเจอร์ ⇒ ทำเครื่องมือวัดถาวรแบบเดียวกับ
 * `crashsweep` / `mobilesweep` / `uxsweep` **ให้ "ทุกหน้า" เป็นตัวเลขที่ตรวจซ้ำได้**
 *
 * ── สิ่งที่วัด (จาก computed style ของจอจริง ไม่ใช่ grep ซอร์ส) ───────────────────────
 *  1. `นอกพาเลต`  🔴 **ตัวสำคัญที่สุด** — สีตัวอักษรที่ไม่ใช่ทั้งสีกลางและไม่ใช่ 5 สีของพาเลต
 *                 = สีดิบที่เขียนในหน้า (`#22c55e`, `#60a5fa`, …) ⇒ **เฉดเพี้ยนจากทั้งแอป
 *                 + ธีมสว่างไม่เปลี่ยนตาม** · อันนี้ "ผิด" ไม่ใช่ "ควรดู"
 *  2. `สีเส้นขอบ` 🔴 เอา `--border`/`--border2` มาเป็น **สีตัวอักษร** = ตัวหนังสือจมพื้น
 *                 (เคสจริง `PlannedLotQueue` 26 จุดบนจอเข้ม) — อันนี้ก็ "ผิด"
 *  3. `จุดมีสี`   จำนวนโหนดข้อความที่ไม่ใช่สีกลาง = "ความดัง" ของหน้า · **ไม่ใช่ความผิด**
 *                 หน้าที่เป็นบอร์ดสถานะย่อมมีเยอะกว่าหน้าฟอร์ม ⇒ ใช้ **เทียบก่อน/หลัง** ของหน้าเดียวกัน
 *  4. `กี่สี`     จำนวนสีที่ต่างกันในหน้าเดียว — เกิน 5 = มีสีนอกพาเลตแน่ (ดูข้อ 1)
 *
 * ── สิ่งที่ **ไม่** วัด ────────────────────────────────────────────────────────────
 *  · พื้นหลัง/ขอบ/ไอคอน — วัดเฉพาะ **สีตัวอักษร** เพราะนั่นคือสิ่งที่ตาอ่านแล้วรู้สึก "ลายตา"
 *  · กราฟ (`svg`) — สีในกราฟคือข้อมูล ไม่ใช่การตกแต่ง (พาเลตกราฟมีกฎของตัวเองใน UI §6.9)
 *  · หน้าที่ harness เรนเดอร์ไม่ขึ้น — รายงานแยกเป็น `เปิดไม่ได้` ไม่ใช่ 0 (ห้ามนับว่าผ่าน)
 *
 * ใช้: เปิด `npx vite --config audit/vite.audit.mjs` ค้างไว้ แล้ว
 *      `node audit/colorsweep.mjs`                  — ทุกหน้า
 *      `node audit/colorsweep.mjs DailyReport Obeya` — เจาะเฉพาะหน้า
 *      `OPEN=1 node audit/colorsweep.mjs DailyReport` — กางแผงที่หุบอยู่ก่อนวัด (หน้าที่มี
 *        `localStorage dr_live_collapse_*`) ⇒ เห็นสีในแถวรายการด้วย ไม่ใช่แค่หัวการ์ด
 */
import { chromium } from 'playwright';

const VIEW = { width: 1600, height: 1000 };
const TZ = { timezoneId: 'Asia/Bangkok' };
const ONLY = process.argv.slice(2);
const OPEN = process.env.OPEN === '1';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p0 = await b.newPage({ ...TZ });
await p0.goto('http://localhost:5199/audit/index.html'); await p0.waitForTimeout(1200);
const ALL = await p0.evaluate(() => window.__PAGES); await p0.close();
const PAGES = ONLY.length ? ALL.filter(n => ONLY.includes(n)) : ALL;

const measure = () => {
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  /** แปลงค่าสีใดๆ ให้เป็นรูป `rgb(r, g, b)` ที่เทียบกันได้ (token เขียนเป็น hex) */
  const norm = (v) => {
    if (!v) return '';
    const d = document.createElement('span');
    d.style.color = v; document.body.appendChild(d);
    const out = getComputedStyle(d).color; d.remove();
    return out;
  };
  /* สีกลาง = สีที่ "ไม่ได้สื่อสถานะ" — ตัวหนังสือปกติ/รอง/จาง + ตัวอักษรบนปุ่มทึบ */
  const NEUTRAL = new Set(['--text', '--text2', '--muted', '--accent-ink'].map(n => norm(css(n))));
  NEUTRAL.add('rgb(255, 255, 255)'); NEUTRAL.add('rgb(0, 0, 0)');
  /* พาเลต 5 สีที่อนุญาต (UI §6.17) */
  const PALETTE = new Map(['--green', '--amber', '--red', '--blue', '--accent']
    .map(n => [norm(css(n)), n]));
  /* `--purple` = token ที่ **เลิกใช้แล้ว** (04/11) แต่ของเก่ายังอ้างอยู่ — แยกรายงานจาก "สีดิบ"
     เพราะคนละงานกัน: อันนี้แค่ย้ายไป `--blue` · สีดิบต้องหาว่าเขียนไว้ตรงไหน */
  const DEPRECATED = new Map([['--purple', norm(css('--purple'))]].map(([n, c]) => [c, n]));
  /* เอาสีเส้นขอบมาเป็นสีตัวอักษร = ตัวหนังสือจมพื้น (คนละเรื่องกับ "สีเยอะ") */
  const BORDERY = new Map(['--border', '--border2'].map(n => [norm(css(n)), n]));

  const out = { dots: 0, colors: {}, offPalette: [], borderText: [], deprecated: [] };
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('svg')) continue;                       // สีในกราฟ = ข้อมูล ไม่ใช่การตกแต่ง
    const t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').trim();
    if (!t) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) continue;          // ซ่อนอยู่ = คนไม่เห็น ไม่นับ
    const c = getComputedStyle(el).color;
    if (NEUTRAL.has(c)) continue;
    out.dots++;
    out.colors[c] = (out.colors[c] || 0) + 1;
    const sample = t.slice(0, 30);
    if (BORDERY.has(c)) out.borderText.push(`${BORDERY.get(c)} → "${sample}"`);
    else if (DEPRECATED.has(c)) out.deprecated.push(`${DEPRECATED.get(c)} "${sample}"`);
    else if (!PALETTE.has(c)) out.offPalette.push(`${c} "${sample}"`);
  }
  return out;
};

const rows = [];
const broken = [];
for (const name of PAGES) {
  const p = await b.newPage({ viewport: VIEW, ...TZ });
  if (OPEN) {
    await p.addInitScript(() => {
      for (const k of ['prod_orders', 'defects', 'downtime', 'mat_breakdown', 'overdue', 'session_list']) {
        try { localStorage.setItem('dr_live_collapse_' + k, '0'); } catch { /* localStorage ปิด */ }
      }
    });
  }
  try {
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}&role=admin`,
      { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForTimeout(2200);
    const crashed = await p.evaluate(() => !!window.__crash);
    if (crashed) { broken.push(name); await p.close(); continue; }
    const m = await p.evaluate(measure);
    const uniq = (a) => [...new Set(a)];
    rows.push({ name, dots: m.dots, colors: Object.keys(m.colors).length,
      off: uniq(m.offPalette), border: uniq(m.borderText), dep: uniq(m.deprecated) });
  } catch {
    broken.push(name);
  }
  await p.close();
}
await b.close();

const bad = rows.filter(r => r.off.length || r.border.length);
rows.sort((a, b2) => (b2.off.length + b2.border.length) - (a.off.length + a.border.length) || b2.dots - a.dots);

console.log(`\nตรวจ ${rows.length} หน้า @${VIEW.width}px${OPEN ? ' (กางแผงแล้ว)' : ''}`
  + ` — ผิดกติกาสี ${bad.length} หน้า\n`);
console.log('นอกพาเลต  สีเส้นขอบ  เลิกใช้  จุดมีสี  กี่สี  หน้า');
for (const r of rows.slice(0, 40)) {
  if (!r.off.length && !r.border.length && !r.dep.length && r.dots < 25) continue;
  console.log(`${String(r.off.length).padStart(8)}${String(r.border.length).padStart(11)}`
    + `${String(r.dep.length).padStart(9)}${String(r.dots).padStart(9)}${String(r.colors).padStart(7)}  ${r.name}`);
}
console.log('\n── รายละเอียด 12 หน้าแรกที่ผิดกติกา ───────────────────────────────');
for (const r of bad.slice(0, 12)) {
  console.log(`\n▸ ${r.name}`);
  r.off.slice(0, 6).forEach(x => console.log(`   นอกพาเลต  ${x}`));
  r.border.slice(0, 4).forEach(x => console.log(`   สีเส้นขอบ  ${x}`));
  r.dep.slice(0, 3).forEach(x => console.log(`   เลิกใช้    ${x}`));
}
if (broken.length) console.log(`\n⚠️ เปิดไม่ได้/พัง ${broken.length} หน้า (ยังไม่ได้วัด): ${broken.join(' · ')}`);
