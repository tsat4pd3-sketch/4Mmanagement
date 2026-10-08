/* ═══ ⏮️ Backward Scheduling — ไล่ย้อนจาก "วันส่งลูกค้า" กลับมาว่าพาร์ทลูกต้องเสร็จวันไหน ═══
   2026-09-22 · คำสั่ง user:
     *"เหลือลีดไทม์พาร์ทลูก ต้องเสร็จก่อน แบบ reverse calculate ปะ — สมมติต้องการงานขายวันนี้
       แตก BOM รู้ว่าต้องผลิตพาร์ทแม่วันนี้ คำนวณสต็อกที่มีในสโตร์ หักลบเสร็จ ย้อนกลับ capacity
       ไลน์ปั๊ม เช็คงานลูกต้องมีของก่อนวันไหน"*

   ── หลักการ (เทียบ MRP backward pass) ────────────────────────────────────────────
     วันส่งลูกค้า (due)  ──หัก buffer STORE──▶  ยอดที่ต้องผลิตจริง
        └─ ต้องใช้กี่วันผลิต = ceil(ยอด ÷ กำลังต่อวันของไลน์นั้น)   ← **lead time มาจาก capacity ไม่ใช่ค่าคงที่**
             └─ วันเริ่มผลิต = ถอยหลังจาก due ตามจำนวนวันนั้น (นับเฉพาะ**วันทำงาน**)
                  └─ พาร์ทลูกต้องมีของ = ถอยอีก `transferDays` (เวลาขนย้าย/รอรับเข้าไลน์)
                       └─ ทำซ้ำลงไปทุกชั้นของ BOM

   🔴 กติกาที่ห้ามพลาด
   1. **lead time คำนวณจากกำลังผลิตจริง ไม่ใช่ค่าคงที่** — ของ 100 ชิ้นกับ 100,000 ชิ้น
      ใช้เวลาไม่เท่ากัน · ไลน์ที่ไม่รู้กำลัง = คิด 1 วันไว้ก่อน **แล้วต้องรายงานออกไป ห้ามเงียบ**
   2. **ถอยวันต้องข้ามวันหยุด** (ปฏิทินบริษัท) — ถอย 3 วันจากวันจันทร์ ต้องไปวันพุธก่อนหน้า ไม่ใช่วันศุกร์
      (ผู้เรียกส่ง `prevWorkDay` เข้ามา — ตัวนี้ไม่รู้จักปฏิทินเอง)
   3. **มีของใน STORE พอ = ตัดทั้งกิ่ง** — ไม่ต้องผลิตตัวแม่ ⇒ ไม่ต้องเบิกลูกของมันด้วย
      (ของกองเดียวใช้ได้ครั้งเดียว ⇒ เดินตามลำดับวันส่งจากเร็วไปช้าเสมอ)
   4. **ย้อนแล้วได้วันก่อนวันนี้ = สายแล้ว** — ต้องนับออกมาให้เห็น ไม่ใช่ปัดเข้าวันนี้เงียบๆ
      (จอต้องบอกว่า "ต้องเริ่มตั้งแต่เมื่อวาน" ไม่งั้นแผนจะดูเหมือนทันเสมอ)
   5. ทั้งไฟล์ pure — ไม่แตะ supabase/react/ปฏิทิน (มีเทส `__tests__/backwardPlan.test.mjs`)
   ═══════════════════════════════════════════════════════════════════════════════ */

const norm = (s) => String(s ?? '').trim().toUpperCase();

/**
 * @param {object} p
 * @param {Array<{mat_no, qty, due_date}>} p.demandRows ความต้องการตั้งต้น (FG + พาร์ทที่ลูกค้าสั่งตรง)
 * @param {object}   p.ix           ผลจาก buildBomIndex — ต้องมี bomOf + sheetFor
 * @param {Function} p.capPerDayOf  (mat) => กำลังผลิตต่อวัน (ชิ้น) · 0/undefined = ไม่รู้กำลัง
 * @param {Record<string,number>} [p.stock] mat → ยอดที่ STORE (หักก่อนสั่งผลิต)
 * @param {Function} p.prevWorkDay  (dateStr, n) => ถอยหลัง n **วันทำงาน**
 * @param {Function} [p.explode]    `explodeBom` — ส่งมาเพื่อใช้ **ตัวตรวจ "BOM แบนซ้ำ" ตัวเดียวกับระบบ**
 *   (หลานที่ถูกใส่ซ้ำไว้ชั้น 1 ของใบเดียวกัน ต้องไม่ถูกนับ 2 รอบ — กฎ "ต่อโซ่แบบ SAP")
 *   ไม่ส่ง = ไม่ตรวจ (ใช้ได้เมื่อรู้ว่าข้อมูลสะอาดแล้ว) แต่ผู้เรียกควรส่งเสมอ
 * @param {string}   p.today        วันนี้ (YYYY-MM-DD) — ใช้ตัดสินว่า "สายแล้ว"
 * @param {number}   [p.transferDays=1] วันขนย้าย/รอรับของระหว่างชั้น
 * @param {number}   [p.maxDepth=10]
 * @returns {{
 *   byDate: Record<string, Record<string, number>>,   // วันที่ต้องผลิต**เสร็จ** → mat → ชิ้น
 *   late: Array<{mat_no, qty, needBy, dueOfParent, root}>,  // ย้อนแล้วหลุดไปก่อนวันนี้
 *   absorbed: number, leftover: Record<string, number>,
 *   noCapMats: string[], flatDupes: Array<object>, cycles: number, maxLevel: number, childPcs: number,
 * }}
 */
export function scheduleBackward({
  demandRows = [], ix, capPerDayOf, stock = {}, prevWorkDay, today, explode,
  transferDays = 1, maxDepth = 10, maxLeadDays = 60,
}) {
  const byDate = {};
  const late = [];
  const noCap = new Set();
  const flatDupes = [];
  const left = { ...(stock || {}) };
  let absorbed = 0, cycles = 0, maxLevel = 1, childPcs = 0;

  /* ⚠️ ไม่มี BOM (หรือคนปิดสวิตช์ "รวมงานจาก BOM") **ต้องยังจัดตารางของตัวแม่ได้**
     — ไม่งั้นแผนรายวันจะว่างทั้งหน้าเมื่ออ่าน BOM ไม่ได้ ซึ่งแย่กว่าการไม่มีงานลูก */
  const hasBom = !!(ix && typeof ix.bomOf === 'function');
  const kidsOf = hasBom ? (m, sheet) => ix.bomOf(m, sheet) || [] : () => [];
  if (typeof prevWorkDay !== 'function' || typeof capPerDayOf !== 'function') {
    return { byDate, late, absorbed, leftover: left, noCapMats: [], flatDupes, cycles, maxLevel, childPcs };
  }

  const put = (date, mat, qty) => {
    const bag = byDate[date] || (byDate[date] = {});
    bag[mat] = (bag[mat] || 0) + qty;
  };

  /* แคชผลตรวจ "แบนซ้ำ" ต่อ root — ใช้ `explodeBom` ตัวเดียวกับที่ระบบใช้ ไม่เขียนตัวตรวจใหม่
     (ผลลัพธ์ = ชุด mat ที่ถูกใส่ไว้ทั้งชั้น 1 และชั้นลึกในใบเดียวกัน ⇒ ชั้น 1 ต้องไม่ถูกนับ) */
  const dupeCache = new Map();
  const dupesOf = (root) => {
    if (typeof explode !== 'function' || !hasBom) return null;
    if (!dupeCache.has(root)) {
      const res = explode(root, ix.bomOf, { sheetFor: ix.sheetFor, maxDepth });
      (res?.flatDupes || []).forEach(f => flatDupes.push({ ...f, root }));
      dupeCache.set(root, new Set((res?.flatDupes || []).map(f => norm(f.mat_no))));
    }
    return dupeCache.get(root);
  };

  /** ถอยจากวันครบกำหนด → วันเริ่มผลิต → วันที่ลูกต้องมีของ แล้วไล่ลงชั้นถัดไป */
  const walk = (mat, gross, dueDate, sheet, path, root) => {
    const level = path.length;
    if (level > maxDepth || !(gross > 0)) return;
    if (level > maxLevel) maxLevel = level;

    // ① หัก buffer ที่ STORE — ของพอ = ตัดทั้งกิ่ง (ไม่ต้องผลิต ไม่ต้องเบิกลูก)
    const have = Math.max(0, Number(left[mat]) || 0);
    const use = Math.max(0, Math.min(gross, have));
    if (use > 0) { left[mat] = have - use; absorbed += use; }
    const qty = gross - use;
    if (!(qty > 0)) return;

    put(dueDate, mat, qty);
    if (level > 1) childPcs += qty;

    // ② lead time = เวลาที่ไลน์นั้นใช้ผลิตยอดนี้จริง (ไม่ใช่ค่าคงที่)
    const perDay = Number(capPerDayOf(mat)) || 0;
    if (!(perDay > 0)) noCap.add(mat);
    const rawDays = perDay > 0 ? Math.max(1, Math.ceil(qty / perDay)) : 1;
    /* ⚠️ เพดานกันค่ากำลังผิดปกติ — พาร์ทที่นานๆ ผลิตทีจะมี median ต่ำมาก
       (วัดจริง 22/09: มี 1 ใบที่คิดออกมาได้ 285 กะ) ถ้าปล่อยไป วันย้อนจะหลุดไปเป็นปี
       แล้วงานทั้งก้อนไปกองเป็น backlog วันแรกจนอ่านแผนไม่ออก
       ⇒ ตัดที่ `maxLeadDays` แล้ว **ติดธง `capped` ให้เห็นบนจอ** ห้ามตัดเงียบ */
    const days = Math.min(rawDays, maxLeadDays);
    const capped = days < rawDays;

    // งานกินเวลา `days` วันทำงานโดย**จบที่ dueDate** ⇒ เริ่มที่ dueDate ถอยหลัง (days − 1)
    const start = prevWorkDay(dueDate, days - 1);
    if (start < today) late.push({ mat_no: mat, qty, needBy: start, dueOfParent: dueDate, root, days: rawDays, capped });

    // ③ ลูกต้องมีของก่อนเริ่มผลิต (เผื่อเวลาขนย้าย)
    const childDue = prevWorkDay(start, transferDays);
    const kids = kidsOf(mat, sheet);
    kids.forEach(k => {
      const cm = norm(k?.mat_no);
      const per = Number(k?.qty_per_unit) || 0;
      if (!cm || !(per > 0)) return;
      if (path.includes(cm)) { cycles++; return; }          // วนลูป — หยุดกิ่งนี้
      // ต่อโซ่แบบ SAP: หลานที่ถูกใส่ซ้ำไว้ชั้น 1 ของ root ⇒ ข้ามตัวที่ชั้น 1 (ตัวในโซ่ถือยอดแล้ว)
      if (level === 1 && dupesOf(root)?.has(cm)) return;
      const kidSheet = hasBom && typeof ix.sheetFor === 'function' ? ix.sheetFor(cm, sheet) : sheet;
      walk(cm, qty * per, childDue, kidSheet, [...path, cm], root);
    });
  };

  // เดินตามลำดับวันส่งจากเร็วไปช้า — ของกองเดียวต้องถูกจองโดยใบที่ถึงกำหนดก่อน
  [...demandRows]
    .filter(r => r && norm(r.mat_no) && (Number(r.qty) || 0) > 0 && r.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
    .forEach(r => {
      const m = norm(r.mat_no);
      const sheet = hasBom && typeof ix.sheetFor === 'function' ? ix.sheetFor(m, undefined) : undefined;
      walk(m, Number(r.qty) || 0, r.due_date, sheet, [m], m);
    });

  return { byDate, late, absorbed, leftover: left, noCapMats: [...noCap], flatDupes, cycles, maxLevel, childPcs };
}

/**
 * ตัวช่วยสร้าง `prevWorkDay` จากปฏิทินบริษัท
 * @param {Function} dayTypeOf (dateStr) => 'working' | 'ot15' | 'shutdown75' | …
 * @param {Function} addDays   (dateStr, n) => dateStr
 * @param {number}   [guard=400] เพดานกันวนไม่รู้จบเมื่อปฏิทินมาร์คหยุดยาวผิดปกติ
 *
 * ⚠️ "วันทำงาน" ที่นี่ = `day_type === 'working'` หรือ **วันที่ไม่มีแถวในปฏิทินและเป็น จ-ศ**
 *    (กฎเดียวกับ countWorkingDaysInMonth — วันหยุดทุกชนิดรวม shutdown75 ถือว่าหยุด)
 */
export function makePrevWorkDay(dayTypeOf, addDays, guard = 400) {
  const isWork = (d) => {
    const t = dayTypeOf ? dayTypeOf(d) : null;
    if (t) return t === 'working';
    const [y, m, dd] = String(d).split('-').map(Number);
    const dow = new Date(y, (m || 1) - 1, dd || 1).getDay();
    return dow >= 1 && dow <= 5;
  };
  return (dateStr, n) => {
    let cur = dateStr;
    let steps = Math.max(0, Math.floor(n) || 0);
    let spin = 0;
    while (steps > 0 && spin < guard) {
      cur = addDays(cur, -1); spin++;
      if (isWork(cur)) steps--;
    }
    return cur;
  };
}
