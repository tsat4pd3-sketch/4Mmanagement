/* ux-sweep — เปิดทุกหน้าแล้ววัด "อาการที่ฟ้องว่าจอถูกตกแต่งเกินจำเป็น" (2026-09-23 · คำสั่ง user)
 *
 * ที่มา: user ส่ง brief `DeAI_UI_video_brief.md` (5 tells / 5 fixes) มาแล้วสั่งให้รีเช็คทั้งโปรเจค
 * "น่าจะได้ปรับแก้ทุกหน้า ทุกฟังก์ชัน ทุกโมดูล" ⇒ 75 หน้า ไล่ด้วยตาไม่มีทางครบและ drift แน่
 * ⇒ ทำเครื่องมือวัดถาวรแบบเดียวกับ `crashsweep` / `mobilesweep` **ให้ "ทุกหน้า" เป็นตัวเลขที่ตรวจซ้ำได้**
 *
 * ── สิ่งที่วัด (ทั้งหมดวัดจาก computed style ของจอจริง ไม่ใช่ grep ซอร์ส) ─────────────────
 *  1. `grad`   ไล่เฉดที่ไม่ได้สื่อความหมาย — **ไม่นับ** `repeating-linear-gradient` (ลายขีดบอกสถานะ
 *              พัก/หยุดตามแผน = สื่อความหมาย) และ **ไม่นับ** gradient 2 stop สีเดียวกัน
 *              (`linear-gradient(${c}14, ${c}14)` = ท่าแทน `color-mix()` ของโปรเจคนี้ = สีเรียบ)
 *  2. `shadow` เงาบนของที่ไม่ได้ลอยจริง — เงาควรมีเฉพาะ overlay (modal/dropdown/toast)
 *              ⇒ ตัดของที่อยู่ใต้ ancestor `position:fixed` + `z-index ≥ 900` ออกก่อนนับ
 *              ⚠️ **นับเฉพาะเงาที่ "ทำให้ของดูลอย" จริง** — 3 อย่างที่หน้าตาเป็น box-shadow
 *              แต่ไม่ใช่การตกแต่ง จึง **ไม่นับ**:
 *                · `0 0 Npx <สี>` = **แสงเรืองของไฟสถานะ** (จุด Andon · กรอบเตือน downtime · ตัวชี้แท็บ)
 *                · blur ≤ 1px เช่น `0 1px 0 var(--border)` = **เส้นคั่น 1px** ที่ยืมท่า box-shadow มาวาด
 *                · element ที่ `position: sticky` = มัน**ลอยทับเนื้อหาจริง**ตอนเลื่อน เงาคือสิ่งที่ถูกต้อง
 *              รอบแรก 23/09 นับรวมหมดแล้วได้ operator 66 / BbsCheck 32 ทั้งที่เกือบทั้งหมดคือ
 *              ไฟสถานะกลมๆ กับเส้นใต้หัวตาราง sticky ⇒ ตัวเลขสูงแต่ไม่มีอะไรให้แก้ = เครื่องมือที่โกหก
 *  3. `emoji`  emoji ขนาด ≥ 20px ที่อยู่การ์ดเดียวกับตัวเลข ≥ 24px = "ไอคอนแย่งความสนใจจากตัวเลข"
 *              ⚠️ emoji ในเมนู/แท็บ/หัวข้อ **ไม่นับ** (เป็น convention ที่ช่วยสแกนบนจอ TV)
 *  4. `flat`   แถวการ์ด ≥ 3 ใบที่ตัวเลขขนาดเท่ากันหมด + กว้างเท่ากันหมด = ไม่มีใบไหนเป็นพระเอก
 *              → **"ควรดู" ไม่ใช่ "ผิด"**: ชุดตัวเลขที่ *เป็นพี่น้องกันจริง* (เช่น OEE/OOE/TEEP ที่ต่างกัน
 *              แค่ฐานเวลา) ควรเท่ากันทั้งแถวอยู่แล้ว · ที่ผิดคือแถวที่มี "ผลรวม" ปนกับ "ส่วนประกอบ"
 *  5. `naked`  ตัวเลขใหญ่ที่ทั้งการ์ดไม่มีหน่วย/เป้า/ฐานเทียบเลย ("71,021" เฉยๆ = 71,021 อะไร?)
 *              → ข้อนี้เป็น **"ควรดู"** ไม่ใช่ "ผิด" (heuristic — บางใบมีบริบทอยู่นอกการ์ด)
 *
 * ── สิ่งที่ **ไม่** วัด และห้ามเอาไปวัด ────────────────────────────────────────────────
 *  · สีเขียว/เหลือง/แดงบน Andon และไฟ KPI = **ความหมาย ไม่ใช่การตกแต่ง** — ห้ามนับเป็นความผิด
 *    (brief ต้นทางทำมาเพื่อ SaaS dashboard · กติกา "one flat accent" ใช้กับจอโรงงานไม่ได้)
 *  · "สี Andon ถูกใช้เป็นสีประจำการ์ด" ตรวจด้วย runtime ไม่แม่น → ใช้ด่าน grep ใน
 *    `regressionGuards.test.mjs` แทน (ดูกฎ `status-color-as-identity`)
 *
 * ── ทางออกสำหรับของที่ "ตั้งใจให้เป็นแบบนั้น" ─────────────────────────────────────────
 * ใส่ `data-ux-ok="<เหตุผลสั้นๆ>"` บน element นั้น แล้วเครื่องมือจะข้ามให้ **แต่พิมพ์จำนวนที่ข้าม
 * ออกมาทุกครั้ง** ⇒ ถ้าใครเริ่มเอาไปแปะมั่ว ตัวเลขจะโผล่เองในรายงาน (ช่องโหว่ที่มองเห็นได้
 * ดีกว่าเครื่องมือที่นับของที่ไม่ควรนับจนไม่มีใครเชื่อตัวเลข)
 *
 * ใช้: เปิด `npx vite --config audit/vite.audit.mjs` ค้างไว้ แล้ว `node audit/uxsweep.mjs`
 *      `node audit/uxsweep.mjs Dashboard DeptHub` = เจาะเฉพาะหน้าที่ระบุ
 */
import { chromium } from 'playwright';

const VIEW = { width: 1600, height: 1000 };   // จอ PC/TV — คนละเรื่องกับ mobilesweep (390px)
const TZ = { timezoneId: 'Asia/Bangkok' };    // คอนเทนเนอร์เป็น UTC — ไม่ตั้ง = โค้ดสายเวลาถูกข้ามทั้งคลาส
const ONLY = process.argv.slice(2);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p0 = await b.newPage({ ...TZ });
await p0.goto('http://localhost:5199/audit/index.html'); await p0.waitForTimeout(1200);
const ALL = await p0.evaluate(() => window.__PAGES); await p0.close();
const PAGES = ONLY.length ? ALL.filter(n => ONLY.includes(n)) : ALL;

const rows = [];
for (const name of PAGES) {
  const p = await b.newPage({ viewport: VIEW, ...TZ });
  try {
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}&role=admin`,
      { waitUntil: 'domcontentloaded', timeout: 25000 });
    await p.waitForTimeout(1800);
    const r = await p.evaluate(() => {
      const EMOJI = /\p{Extended_Pictographic}/u;
      const NUM = /\d/;
      /* หน่วย/เป้า/ฐานเทียบที่นับว่า "ตัวเลขมีรูปร่าง" — ไทย+อังกฤษ+สัญลักษณ์ */
      const CTX = /เป้า|target|เทียบ|\bvs\b|\/|%|ชิ้น|คน|นาที|น\.|ชม\.|บาท|รายการ|จุด|ใบ|ครั้ง|กะ|วัน|เดือน|kWh|ppm|PPM/;
      const px = (v) => parseFloat(v) || 0;
      const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

      /** ของชิ้นนี้อยู่ใน overlay (modal/dropdown/toast) ไหม — overlay มีเงาได้ */
      const inOverlay = (el) => {
        for (let a = el; a && a !== document.body; a = a.parentElement) {
          const c = getComputedStyle(a);
          if ((c.position === 'fixed' || c.position === 'absolute') && (parseInt(c.zIndex, 10) || 0) >= 900) return true;
        }
        return false;
      };
      /** กล่องการ์ดที่ใกล้ที่สุด (มีขอบหรือพื้นของตัวเอง) — ใช้หาบริบทรอบตัวเลข */
      const cardOf = (el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const c = getComputedStyle(a);
          const r = a.getBoundingClientRect();
          if (r.width > 90 && r.height > 60
            && (c.borderTopWidth !== '0px' || (c.backgroundColor && c.backgroundColor !== 'rgba(0, 0, 0, 0)'))) return a;
        }
        return null;
      };

      const out = { grad: [], shadow: 0, emoji: [], flat: [], naked: [], skipped: 0 };
      /** ตั้งใจให้เป็นแบบนี้ (มี `data-ux-ok`) — ข้าม แต่ต้องนับให้เห็นในรายงาน */
      const optedOut = (el) => !!el.closest('[data-ux-ok]');
      /** เงาที่ "ไม่ใช่การตกแต่ง": แสงเรือง (0 0 …) หรือเส้นคั่น 1px (blur ≤ 1) — ดูหัวไฟล์ */
      const notDecorShadow = (sh) => {
        const m = sh.match(/(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/);
        if (!m) return false;
        const [dx, dy, blur] = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
        return (dx === 0 && dy === 0) || blur <= 1;
      };
      const bigNums = [];

      for (const el of document.querySelectorAll('*')) {
        const c = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;

        // 1) ไล่เฉดตกแต่ง
        const bi = c.backgroundImage || '';
        if (bi.includes('gradient') && !bi.includes('repeating-')) {
          const stops = bi.match(/rgba?\([^)]*\)/g) || [];
          const flatTint = stops.length >= 2 && stops.every(s => s === stops[0]);
          if (optedOut(el)) { out.skipped++; } else if (!flatTint) {
            out.grad.push(`${Math.round(r.width)}×${Math.round(r.height)} ${bi.slice(0, 58)}`);
          }
        }

        // 2) เงาบนของที่ไม่ได้ลอย
        if (c.boxShadow && c.boxShadow !== 'none' && c.position !== 'sticky'
          && !notDecorShadow(c.boxShadow) && !inOverlay(el)) {
          if (optedOut(el)) out.skipped++; else out.shadow++;
        }

        // เก็บ "ตัวเลขใหญ่" ไว้ใช้ข้อ 3-5 (ต้องเป็นใบสุดท้ายที่มีตัวเลข ไม่ใช่กล่องที่ห่อมัน)
        const fs = px(c.fontSize);
        const t = txt(el);
        if (fs >= 24 && NUM.test(t) && t.length <= 14 && el.children.length === 0) bigNums.push({ el, fs, t, r });
      }

      // 3) emoji ≥ 20px ที่อยู่การ์ดเดียวกับตัวเลขใหญ่
      const numCards = new Set(bigNums.map(n => cardOf(n.el)).filter(Boolean));
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length) continue;
        const t = txt(el);
        if (!t || t.length > 4 || !EMOJI.test(t) || NUM.test(t)) continue;
        if (px(getComputedStyle(el).fontSize) < 20) continue;
        const card = cardOf(el);
        if (card && numCards.has(card)) out.emoji.push(`${t} ${Math.round(px(getComputedStyle(el).fontSize))}px`);
      }

      // 4) แถวการ์ดที่ไม่มีพระเอก
      const rowsSeen = new Set();
      for (const n of bigNums) {
        const card = cardOf(n.el); if (!card) continue;
        const row = card.parentElement; if (!row || rowsSeen.has(row)) continue;
        const sibs = bigNums.filter(m => { const c2 = cardOf(m.el); return c2 && c2.parentElement === row; });
        if (sibs.length < 3) continue;
        rowsSeen.add(row);
        const fsMax = Math.max(...sibs.map(s => s.fs)), fsMin = Math.min(...sibs.map(s => s.fs));
        const wMax = Math.max(...sibs.map(s => cardOf(s.el).getBoundingClientRect().width));
        const wMin = Math.min(...sibs.map(s => cardOf(s.el).getBoundingClientRect().width));
        if (fsMax / fsMin < 1.15 && wMax / wMin < 1.12) out.flat.push(`${sibs.length} ใบ @${Math.round(fsMax)}px`);
      }

      // 5) ตัวเลขใหญ่ที่การ์ดไม่มีหน่วย/ฐานเทียบเลย
      for (const n of bigNums) {
        const card = cardOf(n.el);
        const ctx = card ? (card.innerText || '') : '';
        if (!CTX.test(ctx)) out.naked.push(`${n.t}`);
      }
      return {
        grad: out.grad, shadow: out.shadow, skipped: out.skipped,
        emoji: [...new Set(out.emoji)], flat: out.flat, naked: [...new Set(out.naked)].slice(0, 6),
      };
    });
    const score = r.grad.length * 2 + Math.max(0, r.shadow - 2) + r.emoji.length * 3
      + r.flat.length * 4 + r.naked.length;
    rows.push({ name, ...r, score });
  } catch (e) {
    rows.push({ name, err: String(e.message).slice(0, 60), score: -1 });
  }
  await p.close();
}
await b.close();

rows.sort((a, b2) => b2.score - a.score);
const hit = rows.filter(r => r.score > 0);
const skipped = rows.reduce((a, r) => a + (r.skipped || 0), 0);
console.log(`\nตรวจ ${rows.length} หน้า @${VIEW.width}px — มีจุดที่ควรปรับ ${hit.length} หน้า`
  + (skipped ? `  (ข้ามของที่ติด data-ux-ok ${skipped} ชิ้น)` : '') + '\n');
console.log('คะแนน  หน้า                      ไล่เฉด  เงา  emojiแย่งเลข  แถวไร้พระเอก  เลขไร้หน่วย');
for (const r of hit) {
  if (r.err) { console.log(`  ERR  ${r.name} — ${r.err}`); continue; }
  console.log(`${String(r.score).padStart(5)}  ${r.name.padEnd(24)}${String(r.grad.length).padStart(6)}`
    + `${String(r.shadow).padStart(5)}${String(r.emoji.length).padStart(13)}`
    + `${String(r.flat.length).padStart(14)}${String(r.naked.length).padStart(13)}`);
}
console.log('\n── รายละเอียด 8 หน้าแรก ─────────────────────────────────────────────');
for (const r of hit.slice(0, 8)) {
  if (r.err) continue;
  console.log(`\n▸ ${r.name}  (คะแนน ${r.score})`);
  if (r.grad.length) console.log(`   ไล่เฉด ${r.grad.length}: ${r.grad.slice(0, 3).join(' | ')}`);
  if (r.shadow > 2) console.log(`   เงาบนของที่ไม่ได้ลอย: ${r.shadow}`);
  if (r.emoji.length) console.log(`   emoji แย่งตัวเลข: ${r.emoji.join(' ')}`);
  if (r.flat.length) console.log(`   แถวการ์ดไม่มีพระเอก: ${r.flat.join(' · ')}`);
  if (r.naked.length) console.log(`   ตัวเลขไร้หน่วย/ฐาน: ${r.naked.join(' · ')}`);
}
