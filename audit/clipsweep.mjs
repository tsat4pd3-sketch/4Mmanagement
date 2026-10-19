/* clip-sweep — หา "ข้อความตกกรอบ" บนจอคอม/จอ TV (2026-10-19 · user ส่งภาพชิป "● หลุดเป้า" ถูกขอบแผ่นตัดครึ่ง: "ยังมีหลายจุดตกกรอบ")
   อาการ: ข้อความ/ชิปถูกบรรพบุรุษที่ `overflow: clip|hidden` ตัดทิ้งเงียบ — หน้าไม่พัง ไม่ล้นจอ mobilesweep (390px) ก็ไม่เห็น
   เพราะที่ 390px layout เป็นอีกชุด (flexWrap) ⇒ ต้องวัดที่ความกว้างที่หน้างานใช้จริง: 1366 (โน้ตบุ๊ก) · 1920 (PC/TV)
   วิธี: ทุก element ที่มีข้อความของตัวเอง → ไล่บรรพบุรุษที่ตัดของล้น (ไม่นับ auto/scroll = ปัดดูได้) → ถ้ากล่องข้อความยื่นพ้นขอบขวา/ซ้าย > 2px = ตกกรอบ
   ไม่นับ: `text-overflow: ellipsis` (ตั้งใจตัดและมี …) · element ที่ซ่อน/สูง 0 · สิ่งที่อยู่นอกจอ
   ใช้: เปิด `npx vite --config audit/vite.audit.mjs` ค้างไว้ · `ONLY=Obeya node audit/clipsweep.mjs` · `VW=1366 VH=768 node audit/clipsweep.mjs`
   กดทุกแท็บบนหัวเพจเหมือน lengthsweep (ของตกกรอบมักอยู่ในแท็บที่ไม่ใช่แท็บแรก) */
import { chromium } from 'playwright';

const TZ = { timezoneId: 'Asia/Bangkok' };
const VW = Number(process.env.VW || 1920);
const VH = Number(process.env.VH || 1080);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p0 = await b.newPage({ ...TZ });
await p0.goto('http://localhost:5199/audit/index.html'); await p0.waitForTimeout(1200);
let PAGES = await p0.evaluate(() => window.__PAGES); await p0.close();
if (ONLY) PAGES = PAGES.filter(n => ONLY.includes(n));

const MEASURE = () => {
  const out = [];
  /* ไล่บรรพบุรุษที่ "ตัดของล้น" — หยุดทันทีที่เจอกล่องเลื่อนได้ (overflow auto/scroll): ของที่ยื่นพ้น main แต่ปัดดูได้ในตารางกว้าง ไม่ใช่ตกกรอบ
     (รอบแรก 19/10 จับ BbsCheck/DailyChecker ผิด: หัวคอลัมน์ "หมายเหตุ" อยู่ในตาราง overflowX:auto) */
  const clipAnc = (el) => {
    const r = [];
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflow)) break;
      if (/(hidden|clip)/.test(cs.overflowX) || /(hidden|clip)/.test(cs.overflow)) r.push(a);
    }
    return r;
  };
  /* ตัดโดยตั้งใจและมี … บอก = ไม่นับ: text-overflow:ellipsis หรือ -webkit-line-clamp (ป้าย 2 บรรทัดบนบอร์ด Heijunka) */
  const intentional = (a) => { const cs = getComputedStyle(a); return cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none'); };
  const ownText = (el) => Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  for (const el of document.querySelectorAll('body *')) {
    const txt = ownText(el);
    if (txt.length < 2) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 6 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (intentional(el)) continue;
    for (const a of clipAnc(el)) {
      if (intentional(a) && (a === el.parentElement || a === el.parentElement?.parentElement)) break;
      const ar = a.getBoundingClientRect();
      const over = Math.max(r.right - ar.right, ar.left - r.left);
      if (over > 2) {
        const chain = [];
        for (let x = el; x && x !== a && chain.length < 3; x = x.parentElement) chain.unshift(x.tagName.toLowerCase());
        out.push(`ตกกรอบ ${Math.round(over)}px | "${txt.slice(0, 40)}" | กล่องที่ตัด ${a.tagName.toLowerCase()} ${Math.round(ar.width)}×${Math.round(ar.height)} (${(a.textContent || '').trim().slice(0, 30)})`);
        break;
      }
    }
  }
  return [...new Set(out)].slice(0, 40);
};

const bad = [];
for (const name of PAGES) {
  const p = await b.newPage({ viewport: { width: VW, height: VH }, ...TZ });
  const hits = new Map();
  try {
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}&role=admin`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForTimeout(1500);
    (await p.evaluate(MEASURE)).forEach(h => hits.set(h, 'หน้าแรก'));
    const labels = [];
    for (const btn of await p.$$('header button, main > div button')) {
      const t = ((await btn.textContent()) || '').trim();
      if (t && t.length <= 40 && !labels.includes(t)) labels.push(t);
    }
    for (const label of labels.slice(0, 12)) {
      try {
        const loc = p.locator('header button, main > div button').filter({ hasText: label }).first();
        await loc.click({ timeout: 800 });
        await p.waitForTimeout(900);
        (await p.evaluate(MEASURE)).forEach(h => { if (!hits.has(h)) hits.set(h, `แท็บ "${label}"`); });
        await p.keyboard.press('Escape').catch(() => {});
      } catch { /* ปุ่มที่กดไม่ได้ ข้าม */ }
    }
  } catch (e) { hits.set(`เปิดไม่ขึ้น: ${String(e).slice(0, 80)}`, '-'); }
  if (hits.size) bad.push({ name, hits });
  await p.close();
}
await b.close();

console.log(`ตรวจ ${PAGES.length} หน้า @${VW}×${VH} — มีข้อความตกกรอบ ${bad.length} หน้า`);
bad.forEach(x => { console.log(`🔴 ${x.name}`); [...x.hits].slice(0, 12).forEach(([h, where]) => console.log(`     [${where}] ${h}`)); });
process.exit(bad.length ? 1 : 0);
