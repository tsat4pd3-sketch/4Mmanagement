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
 *  6. `nav`    **"คุณอยู่ตรงนี้" บนรางไอคอน** — ยืนอยู่หน้าไหน **หมวดบ้านจริงหมวดเดียว**
 *              (`item.group`) ต้องถูกมาร์ค `aria-current` · หมวดที่หน้านั้นไปโผล่เป็น *ทางลัด*
 *              (`alsoIn`) **ห้ามถูกมาร์ค** — คำถาม "อยู่หมวดไหน" ต้องมีคำตอบเดียว (24/09 คำสั่ง user)
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
      /* 🔢 ตัวเลขในวงเล็บท้ายป้าย: ห้ามตามกติกา **ยกเว้นลิสต์ที่ตัวเลือกอื่นก็มีตัวนับ**
         (ทั้งลิสต์มีตัวนับ = คงเส้นคงวา · มีแค่ตัวแรก = ป้ายแปลกตัวเดียวแบบที่ audit 23/09 เจอ) */
      const sibs = [...s.options].slice(1).map(o => (o.text || '').trim()).filter(Boolean);
      const sibsCounted = sibs.length > 0 && sibs.filter(x => /\(\d+\)\s*$/.test(x)).length * 2 >= sibs.length;
      const bare = sibsCounted ? t.replace(/\s*\(\d+\)\s*$/, '') : t;
      /* ตัวย่อโรมันพิมพ์ใหญ่ในคำนามใช้ได้ (ทะเบียนเองก็มี `ทุก Rank`) — ที่ห้ามคือป้ายที่
         *นำ* ด้วยอังกฤษ (`ALL SHIFT (ทุกกะ)`) กับรูปขีด `— … —` ของช่องฟอร์ม */
      const okForm = window.__ALL.has(bare) || /^(ทุก|ทั้งหมด)[^—()]*$/.test(bare);
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
  /* 7. `gapFB` ระยะ แถบแท็บ → แถบกรองแรก (px) — ต้องเท่ากันทุกหน้า (ค่ามาตรฐาน = ค่าที่พบมากสุด)
     🕳️ 2 รูที่ปิด 20/10 (QC audit — การ์ดสถิติแทรกเหนือแถบกรอง 3 หน้าแล้วตัวตรวจไม่เห็น):
       ① เดิมคร่อมด้วย `if (ind)` ⇒ **หน้าที่ไม่มีแถบแท็บไม่เคยถูกวัดลำดับเลย**
          ⇒ ไม่มีแท็บ = วัดจากก้นหัวเพจแทน (สิ่งที่ตาเห็นเหนือแถบกรองก็คือหัวเพจ)
       ② เดิมบันทึกเฉพาะ `< 80px` ⇒ **ยิ่งผิดมาก ยิ่งมองไม่เห็น** (การ์ด+แถบเตือนซ้อน = ห่างเกิน 80)
          ⇒ เกินเพดานแล้วรายงานเป็นเหตุผลคนละข้อ (`gapBig`) ไม่ใช่ทิ้งเงียบ */
  {
    /* วัดจากแถวแท็บที่อยู่ "ใกล้ที่สุดเหนือแถบกรอง" — หน้าลูกใน hub มีแท็บย่อยของตัวเอง (แท็บ → แท็บย่อย → แถบกรอง = ถูก) */
    /* `[data-subtab]` = แถวปุ่มสลับ "มุมมองย่อย" ที่หน้าวาดเอง (ไม่ได้ออกจาก PageHeader)
       — ทำหน้าที่เป็นแท็บย่อย ⇒ นับเป็นจุดอ้างอิงได้ (แท็บ → แท็บย่อย → แถบกรอง = ถูก) */
    const rows = [...main.querySelectorAll('[data-tab-ind]')].map(i => i.parentElement.getBoundingClientRect())
      .concat([...main.querySelectorAll('[data-subtab]')].filter(vis).map(e => e.getBoundingClientRect()));
    /* แถบแบบ `bare` อยู่ในการ์ดที่ทำหน้าที่เป็นแถบ ⇒ วัดกรอบการ์ดนั้น (สิ่งที่ตาเห็น) ไม่ใช่ตัวแถบที่ถูก padding ดันลง */
    const boxOf = e => { if (!e.classList.contains('bare')) return e.getBoundingClientRect();
      for (let a = e.parentElement, d = 0; a && a !== main && d < 3; a = a.parentElement, d++) { const c = getComputedStyle(a); if (parseFloat(c.borderTopWidth) >= 1 && c.borderTopStyle !== 'none') return a.getBoundingClientRect(); }
      return e.getBoundingClientRect(); };
    const fbEls = [...main.querySelectorAll('.filter-bar')].filter(e => vis(e) && !inOv(e));
    const fbs = fbEls.map(boxOf);
    /* 🔴 ไม่มีแถบแท็บ ⇒ จุดอ้างอิงคือ **ก้นของก้อนหัวเพจทั้งก้อน** (`[data-ph-root]`)
       ไม่ใช่ก้นของ `h1` — เพราะคำอธิบายใต้ชื่อหน้า (`sub=`) และ filters/actions ของหัว
       อยู่ใต้ h1 ⇒ วัดจาก h1 จะนับของในหัวเพจเองเป็น "ของแทรก" (false positive ทุกหน้า) */
    const phRoot = [...main.querySelectorAll('[data-ph-root]')].filter(vis).pop();
    const head = phRoot || main.querySelector('h1, h2');
    const anchor = ind ? ind.parentElement.getBoundingClientRect() : head?.getBoundingClientRect();
    if (!anchor) return out;                                   // ไม่มีทั้งแท็บและหัวเพจ = วัดไม่ได้ (มีเหตุผลอื่นรายงานอยู่แล้ว)
    const tb = rows.filter(r => fbs.some(f => f.top >= r.bottom - 1)).sort((a, b) => b.bottom - a.bottom)[0] || anchor;
    const fbIdx = fbs.map((r, i) => [r, i]).filter(([r]) => r.top >= tb.bottom - 1).sort((a, b) => a[0].top - b[0].top)[0];
    const fb = fbIdx?.[0];
    const fbEl = fbIdx ? fbEls[fbIdx[1]] : null;
    /* กล่อง/การ์ดที่ "เป็นเจ้าของ" แถบกรอง — padding ของมันไม่ใช่ของแทรก (ดูเหตุผลใน gapWhat) */
    const fbPanel = (() => { for (let a = fbEl; a && a !== main; a = a.parentElement) { const c = getComputedStyle(a); if (parseFloat(c.borderTopWidth) >= 1 && c.borderTopStyle !== 'none') return a; } return fbEl; })();
    if (fb) {
      /* 🔴 มี "ของที่อนุญาต" คั่นอยู่ ⇒ วัดระยะจาก **ก้นของตัวล่างสุด** ไม่ใช่ก้นแถบแท็บ
         (วัดจากแท็บ = ความสูงของแถบเตือนกลายเป็น "ระยะห่างผิดมาตรฐาน" — ฟ้องหน้าที่ทำถูก) */
      const notes = [...main.querySelectorAll('[data-ro-note], [data-page-note], [data-subtab], [data-subpanel]')]
        .filter(e => vis(e) && !inOv(e)).map(e => e.getBoundingClientRect())
        .filter(r => r.top >= tb.bottom - 1 && r.bottom <= fb.top + 1 && r.height > 8)
        .sort((a, b) => b.bottom - a.bottom);
      const base = notes[0] || tb;
      const g = Math.round(fb.top - base.bottom);
      /* ของที่อนุญาตให้คั่นได้ (UI-STANDARD §2.1):
         · `[data-ro-note]`   = <ReadOnlyNote> (โหมดดูอย่างเดียว)
         · `[data-subpanel]`  = **แผงอิสระ** ที่ถูกวางไว้เหนืออีกแผงหนึ่ง (หน้านั้นไม่มีแถบกรองระดับหน้า)
         · `[data-page-note]` = แถบคำเตือน/ยืนยันตัวตน/สภาพแวดล้อม **ของทั้งหน้า** ที่ต้องเห็นตลอด
           (เช่น "กำลังเช็คชื่อในนาม …" · "ป้ายจะพิมพ์เป็นข้อความเพราะเปิดจาก localhost" ·
            "ข้อมูลบางส่วนโหลดไม่ครบ") — **ไม่ใช่** การ์ดสรุป/ตัวนับที่คิดจากตัวกรอง
         🔴 ติดป้ายได้เฉพาะของที่ "ไม่ขึ้นกับตัวกรอง" — เอาไปติดการ์ดสถิติ = ถอดด่านตัวเอง
         📄 กฎเต็ม: docs/UI-STANDARD.md §2.1 */
      /* ⚠️ หน้าที่ "ไม่มีแท็บ" วัดจากหัวเพจ ⇒ ระยะมาตรฐานคนละชุดกับหน้าที่วัดจากแถบแท็บ
         (เอามาเทียบชุดเดียวกัน = รายงานผิดเป็นกอง — apples/oranges) */
      out.gapFrom = ind ? 'tab' : 'head';
      /* 🔴 ถ้าตัวอ้างอิงเป็น "ของที่อนุญาต" (แถบเตือน/แท็บย่อย) ⇒ ระยะที่วัดได้คือ margin ของกล่องนั้น
         **คนละปริมาณ** กับ "แท็บ → แถบกรอง" ⇒ ไม่เอามาเทียบมาตรฐานเดียวกัน (ลำดับถูกแล้ว พิสูจน์จาก gapWhat) */
      if (notes.length) return out;
      if (g < 80) out.gapFB = g;
      else {
        out.gapBigRaw = g;                                     // เก็บไว้ก่อน — รายงานเฉพาะเมื่อ "เจอของแทรกจริง"
        /* 🔎 บอกด้วยว่า "อะไร" แทรกอยู่ — ไม่งั้นคนอ่านรายงานต้องไปเดาจากซอร์สเอง
           (รอบ 20/10 เสียเวลาเดาผิดหลายหน้า: บางหน้าเป็น padding ของการ์ดที่ครอบแถบกรอง ไม่ใช่ของแทรกจริง) */
        out.gapWhat = [...main.querySelectorAll('*')]
          .filter(e => {
            if (!vis(e) || inOv(e)) return false;
            /* ของในหัวเพจ · ในกล่องที่เป็นเจ้าของแถบกรอง · ป้ายข้อยกเว้น = ไม่ใช่ "ของแทรก" */
            if (e.closest('[data-ph-root], [data-ro-note], [data-page-note], [data-subtab], [data-subpanel]')) return false;
            if (fbPanel && (fbPanel.contains(e) || e.contains(fbPanel))) return false;
            /* 🔴 ก้อนที่มีตาราง/แถบกรองของตัวเอง = **อีกแผงหนึ่ง** ไม่ใช่ "การ์ดสรุปแทรก"
               (เช่น `/equipment?tab=spare` วาง แผง PR ไว้เหนือ แผงคลังอะไหล่ ซึ่งมีแถบกรองของแผงตัวเอง
                ⇒ แถบกรองที่เจอไม่ใช่แถบกรองระดับหน้า — วัดลำดับไม่ได้ ไม่ใช่ว่าผิด) */
            if (e.querySelector('table, .filter-bar')) return false;
            const r = e.getBoundingClientRect();
            if (!(r.top >= tb.bottom - 1 && r.bottom <= fb.top + 1 && r.height > 8)) return false;
            const pr = e.parentElement?.getBoundingClientRect();
            return !pr || pr.top < tb.bottom - 1 || pr.bottom > fb.top + 1;   // เอาชั้นนอกสุดที่อยู่ในช่อง
          })
          .slice(0, 3)
          .map(e => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''}:"${(e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`);
        /* 🔴 รายงานเฉพาะเมื่อ "เจอของแทรกจริง" — ไม่เจอ = เป็นแค่ margin/padding ของกล่องที่ครอบแถบกรอง
           **ไม่ใช่ลำดับผิด** (ระยะห่างเป็น proxy ที่อ่อน — รอบ 20/10 เคยรายงาน 19 มุมมองซึ่งเกินครึ่ง
           เป็น false positive จากคำอธิบายใต้ชื่อหน้า + padding การ์ด)
           🔴 และ "ของที่อนุญาต" ตัดออกจาก `gapWhat` **รายตัว** ไม่ใช่ปลดทั้งช่อง — เดิมใช้ธง `okNote`
              (เจอป้ายที่อนุญาต 1 ตัว = ปล่อยทุกอย่างในช่องนั้น) = การ์ดสถิติแอบอยู่หลังแถบเตือนได้ */
        if (out.gapWhat.length) out.gapBig = g;
      }
    }
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
    /* ⏳ หน้าที่ต้องรอข้อมูลก่อน render หัวเรื่อง = 1800ms ไม่พอ **เป็นระยะ** (2026-10-06 · QC audit)
       เคสจริง: `SchemaMap` อ่านโครงสร้างจาก RPC **ทั้ง 2 project** ก่อน ⇒ รอบเต็มฟ้อง
       "ไม่มีหัวเรื่อง h1/h2" แต่รันเจาะหน้าเดียวผ่าน (เครื่องว่างกว่า) = ด่านร้องหมาป่า
       ⇒ ให้เวลาเพิ่มเฉพาะหน้าที่ยังไม่มีหัวเรื่อง · หน้าที่พร้อมแล้วไม่ถูกหน่วง
       🔴 ห้ามแก้ด้วยการเพิ่ม waitForTimeout ให้ทุกหน้า (82 หน้า × ทุกแท็บ = รอบเต็มช้าขึ้นหลายนาที) */
    await p.waitForSelector('#mainbox h1, #mainbox h2', { timeout: 6000 }).catch(() => {});
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
   ต้องเท่ากับ **`item.group` (บ้านจริง) เท่านั้น** — ขาดไป/เกินมา = จอโกหกตำแหน่ง
   🔴 `alsoIn` = โผล่เป็น "ทางลัด" ในหมวดนั้น **ไม่ใช่บ้านที่สอง** ⇒ ห้ามนับเข้า want
      (เดิมนับทั้งคู่ ⇒ 2 หมวดสว่างพร้อมกัน = user ทักว่าเมนูซ้ำ · ดู `isNavGuest` ใน src/App.jsx) */
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
    const want = new Set(nav.filter(i => i.to === to).map(i => i.group));
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
/* ระยะมาตรฐาน **แยก 2 ชุด** ตามจุดอ้างอิง (แถบแท็บ / หัวเพจ) — ดูเหตุผลที่ `gapFrom` */
const stdGapOf = (from) => {
  const g = rows.filter(r => r.gapFB != null && (r.gapFrom || 'tab') === from).map(r => r.gapFB);
  const f = g.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
  return Number(Object.entries(f).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 16);
};
const STD_GAP = stdGapOf('tab'), STD_GAP_HEAD = stdGapOf('head');
const bad = [];
for (const r of rows) {
  const why = [];
  if (r.err) why.push(`เปิดไม่ขึ้น ${r.err}`);
  if (r.x == null) why.push('ไม่มีหัวเรื่อง h1/h2');
  else if (Math.abs(r.x - STD_X) > 2) why.push(`x=${r.x} (มาตรฐาน ${STD_X})`);
  if (r.dup > 1) why.push(`หัวซ้อน ${r.dup} ตัว`);
  if (r.wide?.length) why.push(`select ยืด ${r.wide.join(', ')}`);
  if (r.ctl?.length) why.push(`ช่องกรองผิด token ${[...new Set(r.ctl)].slice(0, 3).join(', ')}${r.ctl.length > 3 ? ` +${r.ctl.length - 3}` : ''}`);
  if (r.gapFB != null) {
    const from = r.gapFrom || 'tab';
    const std = from === 'head' ? STD_GAP_HEAD : STD_GAP;
    if (Math.abs(r.gapFB - std) > 3) why.push(`ระยะ${from === 'head' ? 'หัวเพจ' : 'แท็บ'}→แถบกรอง ${r.gapFB}px (มาตรฐาน ${std})`);
  }
  if (r.gapBig != null) why.push(`มีของแทรกระหว่างหัวเพจ/แท็บ กับแถบกรอง ~${r.gapBig}px${r.gapWhat?.length ? ` [${r.gapWhat.join(' | ')}]` : ' [ไม่พบ element — น่าจะเป็น margin/padding ของกล่องที่ครอบแถบกรอง]'} — การ์ดสรุป/แถบเตือนต้องอยู่ "ใต้" แถบกรอง (UI-STANDARD §2.1)`);
  if (r.order?.length) why.push(`ลำดับผิด: ${r.order.join(', ')}`);
  if (r.all?.length) why.push(`ป้ายทั้งหมดนอกทะเบียน ${[...new Set(r.all)].join(', ')}`);
  if (why.length) bad.push(`🔴 ${r.name} [แท็บ ${r.tab}] ${r.title ? `"${r.title}" ` : ''}— ${why.join(' · ')}`);
}
console.log(`ตรวจ ${PAGES.length} หน้า / ${rows.length} มุมมอง @${VIEW.width}px · ตำแหน่งชื่อหน้ามาตรฐาน x=${STD_X} · ระยะแท็บ→แถบกรอง ${STD_GAP}px · หัวเพจ→แถบกรอง ${STD_GAP_HEAD}px · ผิด ${bad.length} มุมมอง`);
bad.forEach(l => console.log(l));
if (!ONLY.length) console.log(`🧭 "คุณอยู่ตรงนี้" บนรางไอคอน — ผิด ${navBad.length} route`);
navBad.forEach(l => console.log(l));
process.exit((bad.length + navBad.length) ? 1 : 0);
