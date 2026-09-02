/* ═══ ⏳ WIP Runout Forecast — "ไลน์จะขาดของชิ้นไหน เมื่อไหร่" ═══════════════════
   ที่มา (user 2026-08-27): "เมื่อผลิตสแกน order เหมือนหักลบแล้ว ไม่มี WIP เพียงพอ
   หรือ forecast จาก cycle time ได้ว่าจะหมดเมื่อไหร่ จาก WIP ที่เหลือ
   ก็จะจัดลำดับการไปส่งของให้"

   ⇒ ไทม์ไลน์ของโหมด "ส่งตามคำขอ" **เวลามาจากการคำนวณ ไม่ใช่จากรอบที่ตั้งไว้**
      ลำดับส่งของ = ใครจะขาดก่อน ไม่ใช่ใครนัดไว้ก่อน

   ── โมเดล ────────────────────────────────────────────────────────────────────
   1) หัก WIP ด้วยของที่ผลิตไปแล้ววันนี้  (backflush แบบคำนวณ)
   2) ไล่ใบผลิตที่ยังไม่ปิด "ตามลำดับที่ไลน์จะทำ" แล้วเดินเวลาไปข้างหน้า
      ระหว่างทำ FG ตัวหนึ่ง พาร์ทลูกถูกกินที่อัตรา  qty_per_unit / CT  ต่อวินาที
   3) พาร์ทไหน WIP หมดตอนไหน = **เวลานั้นคือ runout** → เอาไปพลอตบนไทม์ไลน์

   ⚠️⚠️ ทำไมต้องหักเอง ไม่อ่านยอดคงเหลือจาก ledger ตรงๆ
   `fn_explode_child_demand` หักมินิสโตร์ด้วยชื่อ "ไลน์ที่เปิดกะ" แต่ Store จ่ายของเข้า
   "ไลน์แม่" → หากันไม่เจอ ⇒ **backflush ไม่เคยเกิดจริง** (issue 5,908 แถว : consume 40)
   ยอดใน `line_stock_summary` จึงไม่เคยลด · เชื่อตรงๆ = forecast บอกว่า "ของพอตลอดกาล"
   ซึ่งเป็นคำโกหกที่อันตรายกว่าไม่มี forecast เลย
   → หักด้วยยอดที่ผลิตจริงวันนี้ (สูตรบังคับ `confirmed ? (qty_ok ?? qty) : (qty_actual ?? 0)`)
   **จอต้องเขียนกำกับว่าเป็นยอดที่คำนวณ ไม่ใช่ยอดใน ledger**

   ⚠️ กฎ "ไม่รู้ ≠ ไม่มี" บังคับใช้เต็มที่ในไฟล์นี้:
   • พาร์ทไม่มีแถวสต็อกที่ไลน์  → `unknown` **ห้ามตีเป็น 0 แล้วบอกว่าขาดแล้ว**
   • FG ไม่ได้ตั้ง CT           → คำนวณเวลาไม่ได้ → `no_ct` **ห้ามเดา CT**
   • ไลน์ไม่มีใบเปิด            → ไม่มีการกิน → `idle` (ไม่ใช่ "ของพอ")

   ── 📥 โหมด `assumeZeroWip` — "ยังไม่ตั้งจุด WIP ก็ให้เห็น workflow ไปก่อน" ────
   ที่มา (user 2026-09-01): "ทางสโตร์ไม่เห็นความต้องการจากฝ่ายผลิตเลย ถ้ายังไม่ตั้งจุด WIP
   ถ้าจะให้เห็นการจำลอง workflow เรามอง WIP=0 ไปก่อนได้มั้ย เพราะยังไง BOM ของ FG
   ก็มีครบแตกหาพาร์ทย่อยหมดแล้ว"  — ถูกต้อง: **ความต้องการ (need) จาก BOM แม่นอยู่แล้ว
   ที่ไม่รู้คือ "หักได้เท่าไหร่"** ⇒ WIP=0 = ยอด gross ซึ่งเป็นความจริงที่ยังไม่หัก
   ไม่ใช่การเดา (สภาพจริง 31/08: LINE APRON ASSY 31 พาร์ท เช็คสโตร์ได้ 2 · อีก 29 ไม่มีแถว
   → จอโล่งจนสโตร์อ่านไม่ออกว่าผลิตต้องใช้อะไร)

   🔴 กฎเหล็กของโหมดนี้ — **`assumed` เป็นสถานะของตัวเอง ห้ามยุบเข้า `out`**
   `out` = ยืนยันแล้วว่าของหมด (มีแถวสต็อกและยอดเป็น 0) · `assumed` = ยังไม่รู้ว่ามีเท่าไหร่
   ยุบรวมเมื่อไหร่ = จอยืนยันสิ่งที่ไม่จริง แล้วสโตร์วิ่งส่งของที่อาจมีอยู่ที่ไลน์แล้ว
   (กฎเดิม "ไม่รู้ ≠ ไม่มี" ยังอยู่ครบ — เปลี่ยนแค่ "ไม่รู้แล้วเงียบ" เป็น "ไม่รู้แล้วบอกกำหนดส่ง")

   ⭐ ทำไม WIP=0 ยัง "จัดลำดับ" ได้ (จุดที่ไม่ชัดถ้าไม่อ่านโค้ด):
   `left <= 0` → `runoutMs = cursor` ซึ่ง cursor คือ **เวลาที่ใบแรกที่ต้องใช้พาร์ทนั้นเริ่มทำ**
   ไม่ใช่ "ตอนนี้" ทั้งหมด ⇒ พาร์ทที่ไลน์จะหยิบใช้ตอนบ่ายยังอยู่หลังพาร์ทที่ใช้ตอนเช้า
   **ลำดับส่งของยังถูกต้อง** แค่ตัวเลขเป็น gross (ยังไม่หักของที่อาจมีอยู่ที่ไลน์)
   ⇒ จอต้องเขียนกำกับว่า "ยังไม่หัก WIP ที่ไลน์" ทุกที่ที่แสดงยอดนี้ **ห้ามถอด**
   ═══════════════════════════════════════════════════════════════════════════ */

/** ยอดที่ผลิตไปแล้วของใบหนึ่ง — สูตรบังคับของโปรเจค ห้ามเขียนเอง */
export function producedOf(o) {
  return o?.confirmed ? (o.qtyOk ?? o.qty ?? 0) : (o.qtyActual ?? 0);
}

/** ยอดที่ยังเหลือต้องทำของใบหนึ่ง (ใบปิดแล้ว = 0) */
export function remainingOf(o) {
  if (o?.confirmed) return 0;
  return Math.max(0, (Number(o?.qty) || 0) - (Number(o?.qtyActual) || 0));
}

export const RUNOUT_REASON = {
  out:     { key: 'out',     icon: '🚨', label: 'ขาดแล้ว',        tone: 'crit'  },
  soon:    { key: 'soon',    icon: '⏳', label: 'จะขาด',          tone: 'warn'  },
  enough:  { key: 'enough',  icon: '✅', label: 'พอถึงสิ้นแผน',    tone: 'ok'    },
  unknown: { key: 'unknown', icon: '❔', label: 'ยังเช็คไม่ได้',   tone: 'muted' },
  no_ct:   { key: 'no_ct',   icon: '⚠️', label: 'ยังไม่ตั้ง CT',   tone: 'warn'  },
  idle:    { key: 'idle',    icon: '⏸️', label: 'ไลน์ยังไม่เดิน',  tone: 'muted' },
  // 📥 โหมดมอง WIP=0 — "ไลน์ต้องใช้ตอนนี้ แต่ยังไม่รู้ว่ามีอยู่ที่ไลน์เท่าไหร่"
  // ⚠️ คนละความหมายกับ out (ยืนยันแล้วว่าหมด) ห้ามยุบรวม — ดูกฎหัวไฟล์
  assumed: { key: 'assumed', icon: '📥', label: 'ต้องส่งก่อนเวลานี้', tone: 'warn' },
};

/**
 * @param {object}   a
 * @param {Array}    a.orders   ใบผลิตของกลุ่มไลน์เดียว
 *   { matNo, qty, qtyOk, qtyActual, confirmed, openedAt }  ← openedAt = ลำดับที่ไลน์ทำ
 * @param {Function} a.bomOf    (fgMat) => [{ mat_no, qty_per_unit }]
 * @param {Function} a.wipOf    (childMat) => number | null   (null = ไม่มีแถวสต็อก = ไม่รู้)
 * @param {Function} a.ctOf     (fgMat) => วินาที/ชิ้น (0 = ไม่รู้)
 * @param {number}   a.nowMs
 * @param {boolean}  a.assumeZeroWip  พาร์ทที่ไม่มีแถวสต็อก → มองเป็น 0 (gross) แทน `unknown`
 *                                    ดูกฎหัวไฟล์ · ผลลัพธ์ติดธง `assumed` เสมอ
 * @returns {{ parts: Array, firstRunoutMs: number|null, horizonMs: number|null,
 *             noCtMats: string[], counts: object, assumedCount: number }}
 */
export function forecastRunout({ orders = [], bomOf, wipOf, ctOf, nowMs = Date.now(), assumeZeroWip = false }) {
  const acc = {};   // childMat → { consumedDone, need, wipLedger, assumed }
  const touch = (mat) => (acc[mat] = acc[mat] || { consumedDone: 0, need: 0, wipLedger: undefined, assumed: false });

  // ── 1) หักของที่ผลิตไปแล้ววันนี้ออกจาก WIP (backflush แบบคำนวณ) ──
  orders.forEach(o => {
    const made = producedOf(o);
    if (made <= 0) return;
    (bomOf(o.matNo) || []).forEach(b => {
      const t = touch(b.mat_no);
      t.consumedDone += made * (Number(b.qty_per_unit) || 0);
    });
  });

  // ── 2) ไล่ใบที่ยังไม่ปิด ตามลำดับที่ไลน์จะทำ ──
  //    ใบที่ไม่มีเวลาสแกน (kanban_targets) ไปท้ายสุด — ไม่รู้ว่าจะทำเมื่อไหร่
  const open = orders
    .filter(o => remainingOf(o) > 0)
    .sort((a, b) => (a.openedAt ? new Date(a.openedAt).getTime() : Infinity)
                  - (b.openedAt ? new Date(b.openedAt).getTime() : Infinity));

  const wipLeft = {};                 // childMat → WIP ที่เหลือระหว่างเดินเวลา (undefined = ไม่รู้)
  const runoutMs = {};                // childMat → เวลาที่ของหมด
  const noCtMats = new Set();
  let cursor = nowMs;
  let cutShort = false;               // เจอ FG ที่ไม่มี CT → เวลาหลังจากนั้นคำนวณต่อไม่ได้

  const wipOfCached = (mat) => {
    const t = touch(mat);
    if (t.wipLedger === undefined) {
      const raw = wipOf(mat);
      t.wipLedger = (raw === null || raw === undefined) ? null : (Number(raw) || 0);
    }
    return t.wipLedger;
  };

  // WIP ที่ใช้ได้จริงตอนนี้ = ledger − ที่ผลิตไปแล้ว (ไม่ต่ำกว่า 0) · null = ไม่รู้
  // โหมด assumeZeroWip: ไม่มีแถวสต็อก → มองเป็น 0 แล้ว **ติดธง assumed ไว้เสมอ**
  // (ธงนี้คือสิ่งที่ทำให้จอแยก "ยังไม่รู้" ออกจาก "ยืนยันแล้วว่าหมด" ได้ — ห้ามถอด)
  const wipNowOf = (mat) => {
    const led = wipOfCached(mat);
    if (led === null) {
      if (!assumeZeroWip) return null;
      touch(mat).assumed = true;
      return 0;
    }
    return Math.max(0, led - (acc[mat]?.consumedDone || 0));
  };

  open.forEach(o => {
    const rem = remainingOf(o);
    const bom = bomOf(o.matNo) || [];
    bom.forEach(b => { touch(b.mat_no).need += rem * (Number(b.qty_per_unit) || 0); });

    if (cutShort) return;                       // เลยจุดที่คำนวณเวลาได้แล้ว — นับ need ต่อ แต่ไม่พลอตเวลา
    const ct = Number(ctOf(o.matNo)) || 0;
    if (ct <= 0) { noCtMats.add(o.matNo); cutShort = true; return; }

    const durMs = rem * ct * 1000;
    bom.forEach(b => {
      const mat = b.mat_no;
      const per = Number(b.qty_per_unit) || 0;
      if (per <= 0) return;
      if (runoutMs[mat] != null) return;        // หมดไปแล้ว
      if (!(mat in wipLeft)) wipLeft[mat] = wipNowOf(mat);
      const left = wipLeft[mat];
      if (left === null) return;                // ไม่รู้ WIP → ไม่พลอต
      const ratePerMs = per / (ct * 1000);      // ชิ้นลูกต่อ ms
      if (left <= 0) { runoutMs[mat] = cursor; return; }
      const msToEmpty = left / ratePerMs;
      if (msToEmpty <= durMs) { runoutMs[mat] = cursor + msToEmpty; wipLeft[mat] = 0; }
      else wipLeft[mat] = left - ratePerMs * durMs;
    });
    cursor += durMs;
  });

  const horizonMs = open.length && !cutShort ? cursor : null;   // เวลาที่แผนวันนี้จะจบ

  // ── 3) สรุปรายพาร์ท ──
  const parts = Object.entries(acc)
    .filter(([, v]) => v.need > 0)
    .map(([mat, v]) => {
      const wipNow = wipNowOf(mat);
      let reason;
      if (wipNow === null) reason = 'unknown';
      // ⚠️ พาร์ทที่ถูกสมมติ WIP=0 ต้องเป็น `assumed` ห้ามตกไปเป็น out/soon
      //    (out = ยืนยันแล้วว่าหมด · assumed = ยังไม่รู้ว่ามีเท่าไหร่ — คนละคำตอบ)
      else if (runoutMs[mat] != null) reason = v.assumed ? 'assumed' : (runoutMs[mat] <= nowMs ? 'out' : 'soon');
      else if (!open.length) reason = 'idle';
      else if (cutShort) reason = 'no_ct';
      else reason = 'enough';
      return {
        mat_no: mat,
        need: v.need,
        wipLedger: v.wipLedger,     // null = ไม่มีแถวสต็อกที่ไลน์ (คงความจริงไว้เสมอ)
        consumedDone: v.consumedDone,
        wipNow,
        assumed: !!v.assumed,       // true = ตัวเลขนี้ยังไม่หัก WIP ที่ไลน์ (gross)
        runoutMs: runoutMs[mat] ?? null,
        reason,
      };
    })
    .sort((a, b) => {
      const A = a.runoutMs ?? Infinity, B = b.runoutMs ?? Infinity;
      if (A !== B) return A - B;
      return b.need - a.need;
    });

  const counts = { out: 0, soon: 0, enough: 0, unknown: 0, no_ct: 0, idle: 0, assumed: 0 };
  parts.forEach(p => { counts[p.reason] = (counts[p.reason] || 0) + 1; });

  const timed = parts.filter(p => p.runoutMs != null);
  return {
    parts,
    firstRunoutMs: timed.length ? timed[0].runoutMs : null,
    horizonMs,
    noCtMats: [...noCtMats],
    counts,
    // จำนวนพาร์ทที่ตัวเลขยังไม่หัก WIP ที่ไลน์ — จอต้องเอาไปบอกผู้ใช้ ห้ามกลืน
    assumedCount: parts.filter(p => p.assumed).length,
  };
}

/** เรียงกลุ่มไลน์: ใครจะขาดก่อน ไปก่อน · ไม่มีเวลา (ไม่รู้/พอ) ไปท้าย
 *  ⚠️ ชั้นที่ 3 จำเป็นสำหรับโหมด assumeZeroWip — ทุกกลุ่มได้ firstRunoutMs เท่ากัน (= ตอนนี้)
 *     และ unknown เป็น 0 หมด ⇒ ถ้าไม่มีชั้นนี้ ลำดับจะกลายเป็นสุ่มตามลำดับ object */
export function byUrgency(a, b) {
  const A = a.firstRunoutMs ?? Infinity, B = b.firstRunoutMs ?? Infinity;
  if (A !== B) return A - B;
  const un = (b.counts?.unknown || 0) - (a.counts?.unknown || 0);
  if (un) return un;
  const urgent = (x) => (x?.counts?.out || 0) + (x?.counts?.assumed || 0) + (x?.counts?.soon || 0);
  return urgent(b) - urgent(a);
}
