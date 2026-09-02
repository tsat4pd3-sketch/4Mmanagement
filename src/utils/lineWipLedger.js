/* ═══ 📦 WIP ที่ไลน์ — สโตร์ส่งมาเท่าไหร่ · ใช้ไปเท่าไหร่ · ค้างเท่าไหร่ ═══════════
   ที่มา (user 2026-09-01): "ในส่วนของผลิต เพิ่ม feature WIP monitoring ด้วยได้มั้ย
   มอนิเตอร์ว่า สโตร์ส่งมาเท่าไหร่ เหลือค้างในพื้นที่เท่าไหร่ ตัดไปเป็น FG เท่าไหร่"

   ── สมการที่ใช้ ────────────────────────────────────────────────────────────────
     รับเข้า  = Σ issue + Σ adjust − Σ return        ← จาก ledger = ข้อเท็จจริง
     ใช้ไป    = Σ (ยอดผลิต FG × qty_per_unit)        ← **คำนวณ** จากใบผลิต
     ควรเหลือ = รับเข้า − ใช้ไป

   ⚠️⚠️ ทำไม "ใช้ไป" ต้องคำนวณเอง ไม่อ่าน `consume` จาก ledger
   `fn_explode_child_demand` หักมินิสโตร์ด้วยชื่อ "ไลน์ที่เปิดกะ" แต่ Store จ่ายเข้า "ไลน์แม่"
   → หากันไม่เจอ ⇒ **backflush ไม่เคยเกิดจริง** (issue 5,908 แถว : consume 40)
   ⇒ `line_stock_summary.qty_on_hand` = แทบเท่ากับยอดที่รับเข้าล้วน ไม่เคยลด
   **ยอดในระบบจึงสูงกว่าความจริงเสมอ — ห้ามเอาไปตอบว่า "ค้างที่ไลน์เท่าไหร่"**

   ⭐ ส่วนต่าง (`gap` = ใช้ไปจริง − consume ที่บันทึก) คือ **ยอดที่ backflush ยังไม่ได้หัก**
   แสดงไว้เพื่อให้ปัญหาเชิงระบบตัวนี้มีตัวเลขบนจอ ไม่ใช่ซ่อนไว้ (กฎ "ห้ามล้มเหลวเงียบ")

   ⚠️ กฎ "ไม่รู้ ≠ ไม่มี" ในไฟล์นี้:
   • ไม่มีแถว issue เลยแต่ไลน์ใช้ของไปแล้ว = `never_issued` — **ไม่ใช่ "ของหมด"**
     แปลว่าสโตร์ส่งของจริงแต่ไม่ได้บันทึก (ช่องว่างการลงข้อมูล) → เป็น worklist ไม่ใช่ alarm
   • `ควรเหลือ` ติดลบ = ใช้มากกว่าที่รับเข้า → **โชว์ติดลบพร้อม ⚠ ห้ามปัดเป็น 0**
     (หลักเดียวกับ wipChain — ตัวเลขติดลบคือสัญญาณว่าข้อมูลยังไม่ครบ ไม่ใช่ค่าที่ต้องเก็บกวาด)

   pure ทั้งไฟล์ — ไม่แตะ supabase/react (เทสตรงๆ ได้)
   ═══════════════════════════════════════════════════════════════════════════════ */

/** ทิศของ transaction ต่อยอดคงเหลือ — ตรงกับ view `line_stock_summary` เป๊ะ
 *  (`sum(case when type in ('issue','adjust') then qty when type in ('consume','return') then -qty end)`)
 *  ⚠️ แก้ตรงนี้ต้องแก้ view ด้วย ไม่งั้นจอกับฐานตอบคนละเลข */
export const TXN_SIGN = { issue: 1, adjust: 1, consume: -1, return: -1 };

/** ยอดผลิตของใบ 1 ใบ — สูตรบังคับของโปรเจค ห้ามเขียนเอง */
export const producedOf = (o) =>
  o?.confirmed ? Number(o.qtyOk ?? o.qty ?? 0) : Number(o.qtyActual ?? 0);

const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);

export const WIP_STATUS = {
  ok:           { key: 'ok',           icon: '✅', label: 'ปกติ',                tone: 'ok'    },
  low:          { key: 'low',          icon: '⚠️', label: 'ใกล้หมด',              tone: 'warn'  },
  negative:     { key: 'negative',     icon: '🔴', label: 'ใช้เกินที่รับเข้า',     tone: 'crit'  },
  never_issued: { key: 'never_issued', icon: '📭', label: 'ไม่มีบันทึกรับเข้า',    tone: 'warn'  },
  idle:         { key: 'idle',         icon: '⏸️', label: 'ยังไม่ได้ใช้',          tone: 'muted' },
};

/**
 * @param {object}   a
 * @param {Array}    a.txns    line_stock_transactions (status approved แล้ว) ของไลน์ในครอบครัว
 *                             `{ mat_no, type, qty, work_date, part_name? }`
 * @param {Array}    a.orders  ใบผลิต FG ของไลน์ในครอบครัว
 *                             `{ matNo, qty, qtyOk, qtyActual, confirmed, workDate }`
 * @param {Function} a.bomOf   (mat) => [{ mat_no, qty_per_unit }]
 * @param {string?}  a.from    'YYYY-MM-DD' — ช่วงของคอลัมน์ "ในช่วงที่เลือก" (รวมวันนี้)
 * @param {string?}  a.to
 * @returns {{ parts: Array, totals: object, chainMats: string[] }}
 */
export function buildLineWip({ txns = [], orders = [], bomOf, from = null, to = null }) {
  const bom = typeof bomOf === 'function' ? bomOf : () => [];
  const acc = {};
  const touch = (mat) => (acc[mat] = acc[mat] || {
    mat_no: mat, part_name: '',
    inQty: 0, adjQty: 0, retQty: 0, outLedger: 0,      // จาก ledger
    usedCalc: 0,                                       // คำนวณจากใบผลิต
    inPeriod: 0, usedPeriod: 0,
    fgSources: {},                                     // fgMat → ชิ้นที่ถูกกินไป
  });

  // ── 1) ฝั่งรับเข้า: อ่านจาก ledger ตรงๆ (ข้อเท็จจริง) ──
  txns.forEach(t => {
    const mat = String(t?.mat_no ?? '').trim();
    if (!mat) return;
    const q = Number(t.qty) || 0;
    const r = touch(mat);
    if (t.part_name && !r.part_name) r.part_name = t.part_name;
    if (t.type === 'issue')        { r.inQty  += q; if (inRange(t.work_date, from, to)) r.inPeriod += q; }
    else if (t.type === 'adjust')  { r.adjQty += q; }
    else if (t.type === 'return')  { r.retQty += q; }
    else if (t.type === 'consume') { r.outLedger += q; }
  });

  // ── 2) ฝั่งใช้ไป: คำนวณจากใบผลิต × BOM (backflush ยังไม่ทำงาน อ่าน consume ไม่ได้) ──
  orders.forEach(o => {
    const made = producedOf(o);
    if (!(made > 0)) return;
    const within = inRange(o.workDate, from, to);
    (bom(o.matNo) || []).forEach(b => {
      const per = Number(b?.qty_per_unit) || 0;
      if (!(per > 0)) return;
      const mat = String(b.mat_no ?? '').trim();
      if (!mat) return;
      const r = touch(mat);
      const used = made * per;
      r.usedCalc += used;
      r.fgSources[o.matNo] = (r.fgSources[o.matNo] || 0) + used;
      if (within) r.usedPeriod += used;
    });
  });

  /* ── 3) ตรวจ BOM ซ้อนชั้น — ลูกตัวหนึ่งถูกนับทั้งทางตรงและผ่านขั้นกลางของ FG เดียวกัน
     พบจริง 2026-09-01: 19 จาก 22 FG มี BOM นับซ้ำ 2–4 เท่า (ขั้นกลางถูกใส่แบนไว้ด้วย)
     ⇒ `usedCalc` ของพาร์ทกลุ่มนี้จะสูงเกินจริง — **ต้องติดธงบอก ห้ามแก้ตัวเลขให้เอง**
        (จะต่อโซ่หรือแบน เป็นการตัดสินใจของ PE/Planning ที่ยังค้างอยู่) */
  const chainMats = new Set();
  const fgMats = [...new Set(orders.map(o => o.matNo).filter(Boolean))];
  fgMats.forEach(fg => {
    const kids = (bom(fg) || []).map(b => String(b.mat_no ?? '').trim()).filter(Boolean);
    if (kids.length < 2) return;
    const kidSet = new Set(kids);
    kids.forEach(k => {
      (bom(k) || []).forEach(gb => {
        const g = String(gb?.mat_no ?? '').trim();
        if (g && kidSet.has(g)) chainMats.add(g);   // หลานอยู่ในลิสต์ลูกด้วย = นับซ้ำ
      });
    });
  });

  const parts = Object.values(acc).filter(r =>
    // แถวที่ไม่มีทั้งรับเข้า ไม่มีทั้งการใช้ = ไม่มีข้อมูลอะไรเลย ตัดทิ้ง (ไม่ใช่การซ่อนของจริง)
    r.inQty || r.adjQty || r.retQty || r.outLedger || r.usedCalc
  ).map(r => {
    const received = r.inQty + r.adjQty - r.retQty;
    const onHandLedger = received - r.outLedger;      // = qty_on_hand ใน view
    const shouldRemain = received - r.usedCalc;
    const hasIn = r.inQty !== 0 || r.adjQty !== 0;
    const status = !hasIn && r.usedCalc > 0 ? 'never_issued'
      : shouldRemain < 0                    ? 'negative'
      : r.usedCalc <= 0                     ? 'idle'
      : shouldRemain === 0                  ? 'low'
      :                                       'ok';
    return {
      ...r,
      received,
      onHandLedger,
      shouldRemain,
      // ยอดที่ backflush ยังไม่ได้หัก (ทำไมยอดในระบบถึงสูงกว่าที่ควรเหลือ)
      gap: r.usedCalc - r.outLedger,
      chainWarn: chainMats.has(r.mat_no),
      status,
    };
  }).sort((a, b) => {
    const rank = { negative: 0, never_issued: 1, low: 2, ok: 3, idle: 4 };
    const d = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    return d || b.usedCalc - a.usedCalc;
  });

  const sum = (f) => parts.reduce((s, p) => s + f(p), 0);
  const totals = {
    parts: parts.length,
    received:     sum(p => p.received),
    usedCalc:     sum(p => p.usedCalc),
    shouldRemain: sum(p => p.shouldRemain),
    onHandLedger: sum(p => p.onHandLedger),
    gap:          sum(p => p.gap),
    inPeriod:     sum(p => p.inPeriod),
    usedPeriod:   sum(p => p.usedPeriod),
    neverIssued:  parts.filter(p => p.status === 'never_issued').length,
    negative:     parts.filter(p => p.status === 'negative').length,
    chainWarn:    parts.filter(p => p.chainWarn).length,
  };

  return { parts, totals, chainMats: [...chainMats] };
}
