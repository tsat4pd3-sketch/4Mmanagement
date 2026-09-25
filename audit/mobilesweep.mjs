/* mobile-sweep — เปิดทุกหน้าที่ความกว้างมือถือ (390×844) แล้วจับ 3 อาการที่ "build/lint/เทส/crashsweep ผ่านหมด"
   แต่หน้างานใช้ไม่ได้จริง (2026-09-16 · user ส่งคลิปจอมือถือมา: เนื้อหา 2 ชั้นซ้อนทับกันอ่านไม่ออก)

   1. 🔴 sticky ค้างทับเนื้อหา — แผง `position: sticky` ที่กินพื้นที่เกิน 60% ของกว้าง + 25% ของสูงจอ
      และ **ไม่ได้อยู่ในกล่องที่เลื่อนเองได้** · ต้นเหตุประจำ: layout 2 คอลัมน์ยุบเหลือคอลัมน์เดียว
      เมื่อ `isMobile` แต่ `position: sticky` ของ sidebar ไม่ได้ถอดตาม ⇒ แผงค้างนิ่งแล้วเนื้อหา
      เลื่อนทะลุขึ้นมาทับ (เคสจริง: DailyReport แผงเลือกกะ 350×651 บนจอ 390×844 = 77% ของจอ)
   2. 🔴 ของล้นแล้วปัดดูไม่ได้ — แถว flex แนวนอน `nowrap` ที่เนื้อหากว้างเกินตัวเอง และไม่มี `overflowX`
      (UI-CONVENTIONS §231: ของกว้างต้องมี scroller ของตัวเอง)
      · **2ข (25/09): แถว `wrap` ที่ยังล้น** = มีลูกที่หดไม่ลงจริงๆ ไม่ใช่แค่ของเยอะ
        เคสจริงที่หลุดด่านนี้ไป: `.trb-row` ของ <TimeRangeBar> ในกรอบ flex column + align-items:stretch
        — `min-width:0` ไม่พอ ต้อง `max-width:100%` ด้วย ไม่งั้น <select> ตัวเลือกยาวดันแถวพ้นการ์ด
   3. 🔴 ข้อความถูกบีบจนกว้าง 0 — span ที่มีตัวอักษรแต่ `width < 1px` ในแถว flex
      ต้นเหตุประจำ: เพื่อนบ้านตั้ง `whiteSpace: nowrap` แล้วไม่ยอมหด ⇒ **ตัวที่ต้องอ่านที่สุดหายทั้งบรรทัด**
      (เคสจริง: MorningMeeting ชื่อไลน์ 198px จาก 328px ⇒ รายละเอียดปัญหา/4M เหลือ 0)

   ── 📵 หน้าที่ "ตกลงกันแล้วว่าไม่ทำมือถือ" (ACCEPTED ด้านล่าง · คำสั่ง user 2026-09-23) ──
   ไม่ใช่ทุกหน้าที่ต้องใช้ได้บนจอ 390px — บางหน้าเป็นงานที่**ทำบนคอมอยู่แล้วโดยธรรมชาติ**
   หรือเป็นจอที่ตั้งใจฉายขึ้นจอใหญ่ · บังคับให้ผ่านทุกหน้า = ยัด UI มือถือให้งานที่ไม่มีใครทำบนมือถือ
   ⇒ ขึ้นทะเบียนไว้พร้อม**เหตุผลของ user** แล้วรายงานแยกส่วน (ยังพิมพ์ให้เห็น ไม่ได้ซ่อน)
   🔴 ใส่ชื่อหน้าลงทะเบียนนี้ได้เฉพาะเมื่อ **user ตัดสินใจเอง** — ห้าม AI session ใส่เพราะแก้ไม่ไหว

   ใช้: เปิด `npx vite --config audit/vite.audit.mjs` ค้างไว้ แล้ว `node audit/mobilesweep.mjs`
   ⚠️ รันคู่กับ `audit/crashsweep.mjs` (คนละเรื่อง: crashsweep = หน้าพัง · อันนี้ = หน้าไม่พังแต่ใช้ไม่ได้) */
import { chromium } from 'playwright';

const VIEW = { width: 390, height: 844 };   // iPhone 14/15 — เล็กที่สุดที่หน้างานใช้จริง
// 🕐 timezone ไทยเหมือน crashsweep — ไม่งั้นโค้ดสายเวลาถูกข้ามทั้งคลาส (ดูคอมเมนต์ใน crashsweep.mjs)
const TZ = { timezoneId: 'Asia/Bangkok' };
/* 📵 หน้าที่ user ตัดสินใจแล้วว่าไม่ต้องรองรับมือถือ — ค่า = เหตุผลที่ user ให้มา (ห้ามแก้เป็นเหตุผลอื่น) */
const ACCEPTED = {
  LineSetup: 'ทำในคอม — วางจุดงาน/ลากผังบนจอ 390px ทำไม่ไหวด้วยข้อจำกัดขนาดจอ (user 23/09)',
  MorningMeeting: 'ไว้เปิดจอประชุม ไม่ใช่จอมือถือ (user 23/09)',
  Management: 'จัดคนเข้าสถานีบนจอเล็กทำได้ไม่สมบูรณ์ด้วยข้อจำกัดขนาดจอ — เก็บไว้ก่อน (user 23/09)',
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p0 = await b.newPage({ ...TZ });
await p0.goto('http://localhost:5199/audit/index.html'); await p0.waitForTimeout(1200);
const PAGES = await p0.evaluate(() => window.__PAGES); await p0.close();

const bad = [];
for (const name of PAGES) {
  const p = await b.newPage({ viewport: VIEW, isMobile: true, hasTouch: true, ...TZ });
  try {
    /* 🔴 ต้องส่ง `role=admin` (23/09) — ไม่ส่ง = harness เรนเดอร์มุมมอง **อ่านอย่างเดียว**
       ปุ่มของ admin (เพิ่ม/แก้ไข/⚙ ตั้งค่า/เปิดโมดัล) ไม่โผล่เลยสักปุ่ม
       วัดจริงที่ /pm?tab=setup: ไม่ส่ง role เห็น 4 ปุ่ม · ส่ง role=admin เห็น 8 ปุ่ม
       ⇒ ครึ่งหนึ่งของส่วนที่กดได้ทั้งแอป **ไม่เคยถูกสวีปเลย** — โมดัลที่พังทั้งใบจึงหลุดถึงหน้างาน */
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}&role=admin`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForTimeout(1300);
    const hits = await p.evaluate(() => {
      const out = [], VW = innerWidth, VH = innerHeight;
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        const txt = (el.innerText || '').replace(/\s+/g, ' ').slice(0, 45);

        if (cs.position === 'sticky' && cs.top !== 'auto' && r.width > VW * 0.6 && r.height > VH * 0.25) {
          let inScroller = false;
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            const ac = getComputedStyle(a);
            if (/(auto|scroll)/.test(ac.overflowY) && a.scrollHeight > a.clientHeight + 4) { inScroller = true; break; }
          }
          if (!inScroller) out.push(`sticky ค้างทับ ${Math.round(r.width)}×${Math.round(r.height)} | "${txt}"`);
        }

        if (el.tagName === 'DIV' && cs.display === 'flex' && cs.flexDirection === 'row' && cs.flexWrap === 'nowrap'
            && el.scrollWidth > el.clientWidth + 4 && !/(auto|scroll)/.test(cs.overflowX)
            && r.width > VW * 0.5 && r.height > 20)
          out.push(`ล้นปัดไม่ได้ กล่อง ${Math.round(r.width)} เนื้อหา ${el.scrollWidth} | "${txt}"`);

        /* 2ข. แถว flex ที่ **ขึ้นบรรทัดใหม่ได้แล้วยังล้น** — ลูกบางตัวหดไม่ลง (25/09)
           เคสจริง: `.trb-row` ใน <TimeRangeBar> วางอยู่ใน flex column + align-items:stretch
           ⇒ ขนาด "เส้น" มาจาก max-content ของแถว ไม่ใช่กรอบการ์ด · <select> ที่ตัวเลือกยาว
           (ชื่อไลน์) ดันแถว 449px ในกรอบ 370px แล้วล้นพ้นขอบการ์ดออกไปนอกจอ
           ข้อ 2 เดิมจับไม่ได้เพราะเช็คเฉพาะ `nowrap` — แถวนี้ `wrap` แต่ก็ยังล้น
           (ล้นทั้งที่ wrap ได้ = มีลูกที่ shrink ไม่ลงจริงๆ ไม่ใช่แค่ของเยอะ) */
        if (el.tagName === 'DIV' && cs.display === 'flex' && cs.flexDirection === 'row' && cs.flexWrap === 'wrap'
            && el.scrollWidth > el.clientWidth + 4 && !/(auto|scroll)/.test(cs.overflowX)
            && r.width > VW * 0.5 && r.height > 20)
          out.push(`ล้นทั้งที่ขึ้นบรรทัดใหม่ได้ (ลูกหดไม่ลง) กล่อง ${Math.round(r.width)} เนื้อหา ${el.scrollWidth} | "${txt}"`);

        if (el.tagName === 'SPAN' && r.width < 1 && r.height > 0 && (el.textContent || '').trim().length > 8
            && getComputedStyle(el.parentElement || el).display === 'flex')
          out.push(`ข้อความถูกบีบหาย | "${(el.textContent || '').trim().slice(0, 40)}"`);
      }
      return [...new Set(out)];
    });
    if (hits.length) bad.push({ name, hits });
  } catch (e) { bad.push({ name, hits: [`เปิดไม่ขึ้น: ${String(e).slice(0, 80)}`] }); }
  await p.close();
}
await b.close();

const open = bad.filter(x => !ACCEPTED[x.name]);
const accepted = bad.filter(x => ACCEPTED[x.name]);

console.log(`ตรวจ ${PAGES.length} หน้า @${VIEW.width}px — ต้องแก้ ${open.length} หน้า`
  + (accepted.length ? ` (+ ${accepted.length} หน้าที่ user ตัดสินใจว่าไม่ทำมือถือ)` : ''));
open.forEach(x => { console.log(`🔴 ${x.name}`); x.hits.slice(0, 4).forEach(h => console.log(`     ${h}`)); });
if (accepted.length) {
  console.log('\n📵 ไม่รองรับมือถือโดยตั้งใจ (ไม่นับเป็นปัญหา):');
  accepted.forEach(x => console.log(`   ${x.name} — ${ACCEPTED[x.name]}`));
}
process.exit(open.length ? 1 : 0);
