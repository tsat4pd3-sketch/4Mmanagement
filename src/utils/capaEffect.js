/* ═══════════════════════════════════════════════════════════════════════════
   วัดประสิทธิผลของ 8D/CAPA จากข้อมูลจริง — เฟส 4 ของลูปปิด 8D → PE
   (docs/CLOSED-LOOP-8D-PE.md · IATF 16949 §10.2.4 "ทวนสอบว่ามาตรการได้ผลจริง")

   โจทย์: ปิด 8D แล้ว "ของเสียลดจริงไหม" — เดิมตอบด้วยข้อความที่คนพิมพ์เองล้วน
   (`qa_capa.effectiveness`) ซึ่งไม่มีใครตรวจย้อนได้ว่าตัวเลขจริงเป็นยังไง

   วิธีวัด (ยืม pattern ที่พิสูจน์แล้วจาก /improvements):
     ก่อน = [pivot − window, pivot)   ·   หลัง = [pivot, min(วันนี้, pivot + window))
     หารด้วย **จำนวนวันที่ไลน์ผลิตจริง** (นับจาก production_sessions) ไม่ใช่วันปฏิทิน
     — ไลน์หยุด 5 วันแล้วของเสียเป็น 0 ไม่ได้แปลว่ามาตรการได้ผล

   ⚠️ กฎเหล็กของไฟล์นี้
   1. **"วัดไม่ได้" ต้องเป็นคำตอบของตัวเอง ห้ามแปลงเป็น "ไม่ได้ผล"**
      ข้อมูลน้อย / ยังไม่ถึงเวลา / ไม่มีฐานเทียบ = คนละเรื่องกับมาตรการล้มเหลว
      (หลักเดียวกับ OEE: ประเมินไม่ได้ = null ห้ามคืน 0)
   2. **pivot คือ "วันที่มาตรการมีผลจริง" (d6_effective_from) ไม่ใช่วันปิดใบ**
      ใบมักถูกปิดหลังมาตรการมีผลไปแล้วหลายสัปดาห์ — ใช้วันปิดจะวัดคร่อมช่วงผิด
   3. **ระบบไม่ตัดสินแทนคน** — คืน verdict + ตัวเลขให้คนอ่าน ไม่ auto-reopen ใบ
   ═══════════════════════════════════════════════════════════════════════════ */

/** วันผลิตขั้นต่ำต่อฝั่ง ที่ยอมให้ตัดสิน — น้อยกว่านี้ = ยังวัดไม่ได้
 *  (ต่ำกว่านี้ 1-2 วันที่บังเอิญดี/บังเอิญแย่ จะพลิกคำตอบได้ทั้งใบ) */
export const MIN_DAYS = 5;

/** เกณฑ์ตัดสิน — สัดส่วนที่ลดลง (0-1) */
export const DROP_OK = 0.5;      // ลด ≥50% = ได้ผล
export const DROP_PARTIAL = 0.2; // 20-50% = ดีขึ้นแต่ยังไม่พอ

/** หน้าต่างวัดผลเริ่มต้น (วันปฏิทิน) */
export const DEFAULT_WINDOW = 30;

export const VERDICTS = {
  effective:     { label: 'ได้ผล',                 short: '✅ ได้ผล',        color: '#22c55e', ok: true },
  partial:       { label: 'ดีขึ้น แต่ยังไม่พอ',      short: '🟡 ดีขึ้นบางส่วน', color: '#f59e0b', ok: false },
  not_effective: { label: 'ยังไม่ได้ผล',            short: '🔴 ยังไม่ลด',     color: '#ef4444', ok: false },
  worse:         { label: 'แย่ลงกว่าเดิม',          short: '🔴 แย่ลง',        color: '#dc2626', ok: false },
  too_early:     { label: 'ยังวัดไม่ได้ — ข้อมูลหลังยังน้อย', short: '⏳ ยังวัดไม่ได้', color: '#6b7280', ok: null },
  no_baseline:   { label: 'ไม่มีฐานเทียบก่อนแก้',    short: '❔ ไม่มีฐานเทียบ', color: '#6b7280', ok: null },
  no_data:       { label: 'ไม่มีข้อมูลการผลิตในช่วงนี้', short: '❔ ไม่มีข้อมูล',  color: '#6b7280', ok: null },
  no_pivot:      { label: 'ยังไม่ได้ระบุวันที่มาตรการมีผล', short: '⚙️ ยังไม่ตั้งค่า', color: '#6b7280', ok: null },
};

/* ── date helpers (local time — ห้าม toISOString ตามกฎโปรเจค) ───────────── */
export const ymd = (d) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const todayStr = () => ymd(new Date());
export const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/** ช่วงวันที่ที่ต้องดึงข้อมูล — คืน null ถ้ายังไม่มี pivot */
export function effectWindow(pivot, windowDays = DEFAULT_WINDOW, today = todayStr()) {
  if (!pivot) return null;
  const w = Math.max(7, Number(windowDays) || DEFAULT_WINDOW);
  const from = addDays(pivot, -w);
  const afterEnd = addDays(pivot, w - 1);
  const to = today < afterEnd ? today : afterEnd;
  return { from, to, pivot, windowDays: w, capped: today < afterEnd };
}

/**
 * ตัดสินผลจากตัวเลขที่วัดได้
 * @param {object} m  { beforeDays, afterDays, beforeTotal, afterTotal, beforePerDay, afterPerDay }
 * @returns {object}  { verdict, dropPct, ...VERDICTS[verdict], reason }
 */
export function judgeEffect(m) {
  const V = (verdict, reason, extra = {}) => ({ verdict, reason, ...VERDICTS[verdict], ...extra });
  if (!m) return V('no_pivot', 'ยังไม่ได้ระบุวันที่มาตรการมีผล (D6)');
  const { beforeDays = 0, afterDays = 0, beforeTotal = 0, afterTotal = 0 } = m;
  const bpd = Number(m.beforePerDay) || 0;
  const apd = Number(m.afterPerDay) || 0;

  if (!beforeDays && !afterDays) return V('no_data', 'ไม่พบกะที่เปิดผลิตของไลน์นี้ในช่วงที่วัด');
  // ── ยังไม่ถึงเวลา: ต้องมีวันผลิตหลังมาตรการพอสมควรก่อนจึงจะตัดสินได้ ──
  if (afterDays < MIN_DAYS)
    return V('too_early', `หลังมาตรการมีวันผลิตแค่ ${afterDays} วัน (ต้องมีอย่างน้อย ${MIN_DAYS} วัน)`, { needDays: MIN_DAYS - afterDays });
  // ── ไม่มีฐานเทียบ: ก่อนหน้าข้อมูลน้อย หรือไม่เคยมีของเสียเลย ──
  if (beforeDays < MIN_DAYS)
    return V('no_baseline', `ก่อนมาตรการมีวันผลิตแค่ ${beforeDays} วัน — เทียบไม่ได้`);
  if (beforeTotal <= 0)
    return V('no_baseline', afterTotal > 0
      ? `ก่อนมาตรการไม่มีของเสียในเกณฑ์ที่วัด แต่หลังมาตรการพบ ${afterTotal} ชิ้น — ตรวจว่าตั้งเกณฑ์วัดถูกไหม`
      : 'ไม่พบของเสียทั้งก่อนและหลัง — เกณฑ์ที่ตั้งไว้อาจไม่ตรงกับอาการที่เคลม');

  const dropPct = (bpd - apd) / bpd; // >0 = ลดลง
  const base = { dropPct, beforePerDay: bpd, afterPerDay: apd };
  if (apd > bpd)         return V('worse',         `ของเสียต่อวันเพิ่มขึ้น ${Math.abs(dropPct * 100).toFixed(0)}%`, base);
  if (dropPct >= DROP_OK) return V('effective',     `ของเสียต่อวันลดลง ${(dropPct * 100).toFixed(0)}%`, base);
  if (dropPct >= DROP_PARTIAL) return V('partial',  `ลดลง ${(dropPct * 100).toFixed(0)}% — ยังไม่ถึงเกณฑ์ ${DROP_OK * 100}%`, base);
  return V('not_effective', dropPct > 0
    ? `ลดลงแค่ ${(dropPct * 100).toFixed(0)}% — แทบไม่ต่างจากก่อนแก้`
    : 'ของเสียต่อวันไม่ลดลงเลย', base);
}

/**
 * แยกกะ + รวมของเสีย เป็นตัวเลขก่อน/หลัง
 * @param {Array} sessions  [{ id, work_date }]        ของไลน์ในช่วง from..to
 * @param {Array} defects   [{ session_id, qty_ng, qty_suspect, is_trial, dr_defect_types:{excl_from_q} }]
 * @param {string} pivot    วันที่มาตรการมีผล (YYYY-MM-DD)
 * @param {function} qtyOf  ตัวรวมจำนวน (ฉีดเข้ามาเพื่อ reuse sumDefectQty ของ oee.js โดยไม่ import วน)
 */
export function splitBeforeAfter(sessions, defects, pivot, qtyOf) {
  const beforeDays = new Set(), afterDays = new Set(), afterIds = new Set();
  (sessions || []).forEach((s) => {
    if (s.work_date < pivot) beforeDays.add(s.work_date);
    else { afterDays.add(s.work_date); afterIds.add(s.id); }
  });
  const bRows = [], aRows = [];
  (defects || []).forEach((d) => (afterIds.has(d.session_id) ? aRows : bRows).push(d));
  const beforeTotal = qtyOf(bRows);
  const afterTotal = qtyOf(aRows);
  return {
    beforeDays: beforeDays.size, afterDays: afterDays.size,
    beforeTotal, afterTotal,
    beforeCount: bRows.length, afterCount: aRows.length,
    beforePerDay: beforeDays.size ? beforeTotal / beforeDays.size : 0,
    afterPerDay: afterDays.size ? afterTotal / afterDays.size : 0,
  };
}

/** ข้อความสรุปสำหรับเติมลงช่อง "ผลตรวจติดตามประสิทธิผล" (คนแก้ต่อได้) */
export function effectSummaryText(m, j, opt = {}) {
  const { pivot, windowDays, typeLabel } = opt;
  const n = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const scope = typeLabel ? `เกณฑ์วัด: ${typeLabel}` : 'เกณฑ์วัด: ของเสียทุกประเภทของพาร์ทนี้';
  return [
    `[วัดจากข้อมูลจริง ${todayStr()}] ${VERDICTS[j.verdict]?.label || j.verdict}`,
    `มาตรการมีผล ${pivot} · หน้าต่างเทียบ ${windowDays} วัน · ${scope}`,
    `ก่อน: ${m.beforeTotal} ชิ้น / ${m.beforeDays} วันผลิต = ${n(m.beforePerDay)} ชิ้น/วัน`,
    `หลัง: ${m.afterTotal} ชิ้น / ${m.afterDays} วันผลิต = ${n(m.afterPerDay)} ชิ้น/วัน`,
    j.reason,
  ].join('\n');
}
