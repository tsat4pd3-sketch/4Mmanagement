/* ═══ 🎴 e-Kanban — กฎของ "ใบคัมบังรายใบ" (2026-11-25 · คำสั่ง user) ══════════════════
 *
 * user: *"อยากให้ระบบ gen ใบ e-kanban ในหน้าจอได้ เพื่อจะได้ไม่ต้องมีการส่งใบจริง"*
 *       *"อยากลดการเดินของพนักงาน"*
 *
 * ── ลูปจริงที่หน้างานทำอยู่ (user อธิบาย 25/11) ───────────────────────────────────
 *   การ์ดติดอยู่กับ**ตระกร้า/กล่อง**ที่สโตร์ → ส่งมาพร้อมกล่องถึงไลน์ →
 *   ไลน์ใช้หมด → **พักการ์ดขึ้นตู้** → **สโตร์เดินเก็บตามรอบ** → เตรียมของส่งใหม่
 *
 *   ⇒ 1 แถวใน `kanban_cards` = **1 กล่องที่หมุนอยู่ในลูป** (ไม่ใช่ 1 ช่องวาง)
 *
 * ── 🔴🔴 ป้ายที่หน้างานมี **2 ชนิด คนละหน้าที่ ห้ามปน** (user ยืนยัน 25/11) ────────
 *   | ป้าย | หน้าที่ | วนกลับ | ระบบนี้ |
 *   | **แท็ก one-way จาก SAP** (ติดตระกร้า/กล่องในสโตร์) | บอกว่ากล่องนี้คือพาร์ทอะไร | ❌ ไปกับของ | **ไม่แตะ** |
 *   | **ใบ PW KANBAN** | **สัญญาณเบิก** | ✅ ต้องวนกลับสโตร์ | ✅ แทนด้วยใบบนจอ |
 *   ⇒ ใบที่ e-kanban แทนคือ**ใบสัญญาณล้วน ไม่มีหน้าที่ทางกายภาพ** ⇒ แปลงเป็นดิจิทัลไม่เสียอะไร
 *   🔴 **ห้ามสร้างป้ายติดกล่องชุดที่ 2** — SAP ทำอยู่แล้ว · ของที่ระบบนี้ออกคือ
 *     **QR ถาวรติดชั้น/จุดวางที่ไลน์** (ให้คนยิงบอกว่าหมด) **ไม่ใช่ป้ายติดกล่อง**
 *   ⇒ ขาที่ e-kanban ตัดทิ้ง = **"เดินไปเก็บการ์ด"** (วัด: 30.5 เที่ยว/วัน · 10 ไลน์)
 *     สัญญาณถึงสโตร์วินาทีที่กล่องหมด แทนที่จะนอนในตู้รอคนมาเดินเก็บ
 *     **เหลือเฉพาะเที่ยวขนของจริง ซึ่งตัดไม่ได้**
 *
 * ── 🔴🔴 กฎเหล็ก — "ระบบเสนอ คนตัดสิน" (คำสั่ง user 25/11) ────────────────────────
 *   backflush บอกได้แค่ว่า *น่าจะ* ใช้ครบ 1 กล่องแล้ว ⇒ เขียน `suggested_at`/`suggest_reason`
 *   **ห้ามเปลี่ยน `state` ให้เอง** — คนหน้าไลน์ยืนยัน (= การนำการ์ดขึ้นตู้ของจริง)
 *   เหตุผล: BOM/backflush ยังเพี้ยนได้ · ถอดเองผิดจังหวะ = ของมาไม่ตรงเวลา **เงียบ**
 *
 * ── 🔴 สถานะวนกลับที่เดิม ห้ามข้ามขั้น ───────────────────────────────────────────
 *   at_line → in_box → picking → delivering → at_line
 *   ข้ามขั้น/ถอยหลัง = ใบเดินผิดจริง ⇒ `canMoveCard()` ปฏิเสธพร้อมเหตุผล
 *   (ของจริงย้อนได้เหมือนกัน เช่น สโตร์เก็บผิดใบ ⇒ ต้อง **เขียนเหตุผล** ผ่าน `allowBack`)
 *
 * ไฟล์นี้ pure — ห้าม import supabase/react · ฟังก์ชันที่กินเวลาปัจจุบันรับ `now` เสมอ
 * 📄 docs/modules/kanban-auto-calc.md §e-Kanban
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** ทะเบียนสถานะ — **เพิ่ม/เปลี่ยนที่นี่ที่เดียว** ห้าม hardcode สตริงสถานะในหน้า
 *  `where` = ของจริงอยู่ไหน · `act` = ปุ่มที่คนกดเพื่อไปขั้นถัดไป (คำบนปุ่มต้องตรงกับงานจริง) */
export const CARD_STATES = {
  at_line:    { key: 'at_line',    label: 'อยู่ที่ไลน์',   where: 'การ์ดติดกล่องอยู่ที่ไลน์ กำลังใช้',      act: 'ใช้หมดแล้ว — ขึ้นตู้', color: 'var(--green)' },
  in_box:     { key: 'in_box',     label: 'อยู่ในตู้',     where: 'ใช้หมดแล้ว รอสโตร์รับคิว',               act: 'สโตร์รับคิว',          color: 'var(--amber)' },
  picking:    { key: 'picking',    label: 'สโตร์เตรียมของ', where: 'สโตร์รับคิวแล้ว กำลังหยิบของ',          act: 'ออกเดินส่ง',           color: 'var(--blue)' },
  delivering: { key: 'delivering', label: 'กำลังส่ง',      where: 'ของกำลังเดินทางไปไลน์',                  act: 'ถึงไลน์แล้ว',          color: 'var(--accent)' },
};

/** ลำดับการเดินของใบ — วนกลับที่เดิม */
export const CARD_FLOW = ['at_line', 'in_box', 'picking', 'delivering'];

/** สถานะถัดไปตามลูป (วนกลับ at_line) · สถานะไม่รู้จัก = `null` ห้ามเดา */
export function nextCardState(state) {
  const i = CARD_FLOW.indexOf(String(state ?? ''));
  if (i < 0) return null;
  return CARD_FLOW[(i + 1) % CARD_FLOW.length];
}

/** ย้ายใบจากสถานะหนึ่งไปอีกสถานะได้ไหม
 *  @param {boolean} [allowBack] ถอยหลังได้เมื่อมีเหตุผล (เก็บผิดใบ/ส่งผิดไลน์) — ผู้เรียกต้องบังคับให้กรอกเหตุผล
 *  @returns {{ ok:boolean, why:string|null }}
 */
export function canMoveCard(from, to, { allowBack = false } = {}) {
  const a = CARD_FLOW.indexOf(String(from ?? ''));
  const b = CARD_FLOW.indexOf(String(to ?? ''));
  if (a < 0) return { ok: false, why: `ไม่รู้จักสถานะต้นทาง "${from}"` };
  if (b < 0) return { ok: false, why: `ไม่รู้จักสถานะปลายทาง "${to}"` };
  if (a === b) return { ok: false, why: 'ใบนี้อยู่สถานะนี้อยู่แล้ว' };
  if (nextCardState(from) === to) return { ok: true, why: null };
  if (allowBack) return { ok: true, why: null };
  return { ok: false, why: `ใบต้องเดินทีละขั้น — จาก "${CARD_STATES[from]?.label || from}" ไปได้แค่ "${CARD_STATES[nextCardState(from)]?.label}"` };
}

/** เลขใบที่คนอ่าน — MAT + ลำดับ 2 หลัก (ตรงกับที่พิมพ์บนใบจริง) */
export function cardNo(matNo, seq) {
  const m = String(matNo ?? '').trim();
  const s = Number(seq);
  if (!m || !Number.isFinite(s) || s < 1) return null;
  return `${m}-${String(s).padStart(2, '0')}`;
}

/* ── 🧾 ออกชุดใบ — "ระบบเสนอ" เท่านั้น ไม่เขียน DB เอง ───────────────────────── */

/** ชุดใบที่ *ควรมี* ของคู่ (พาร์ท, ไลน์) เทียบกับที่มีอยู่แล้ว
 *  🔴 ทะเบียนไม่ได้ตั้ง `total_kanban`/`qty_per_kanban` = **ออกใบไม่ได้ ห้ามเดา**
 *  🔴 ใบที่มีอยู่แล้วห้ามแตะ — ใบคือของจริงที่หมุนอยู่ ลดจำนวนใบ = **เสนอให้ถอนออก ไม่ลบให้เอง**
 *  @returns {{ ok:boolean, why:string|null, toCreate:Array, toRetire:Array, keep:number }}
 */
export function planCards({ matNo, lineName, totalCards = null, qtyPerCard = null, fromLocation = null, existing = [] } = {}) {
  const bad = (why) => ({ ok: false, why, toCreate: [], toRetire: [], keep: 0 });
  const mat = String(matNo ?? '').trim();
  const line = String(lineName ?? '').trim();
  if (!mat || !line) return bad('ยังไม่ได้เลือกพาร์ท/ไลน์');
  const n = Number(totalCards);
  const q = Number(qtyPerCard);
  if (!Number.isFinite(n) || n < 1) return bad('ทะเบียนยังไม่ได้ตั้ง "จำนวนใบ" (total_kanban) — ออกใบไม่ได้');
  if (!Number.isFinite(q) || q <= 0) return bad('ทะเบียนยังไม่ได้ตั้ง "ชิ้นต่อใบ" (qty_per_kanban) — ออกใบไม่ได้');

  const live = (existing || []).filter(c => c && c.is_active !== false);
  const bySeq = new Map(live.map(c => [Number(c.seq), c]));
  const toCreate = [];
  for (let s = 1; s <= n; s += 1) {
    if (bySeq.has(s)) continue;
    toCreate.push({ card_no: cardNo(mat, s), mat_no: mat, line_name: line, from_location: fromLocation || null,
      qty_per_card: q, seq: s, total_cards: n, state: 'at_line' });
  }
  /* ใบเกินจำนวนที่ทะเบียนบอก = **เสนอให้ถอน** (คนตัดสิน) — ของจริงอาจยังมีกล่องหมุนอยู่ */
  const toRetire = live.filter(c => Number(c.seq) > n);
  return { ok: true, why: null, toCreate, toRetire, keep: live.length - toRetire.length };
}

/* ── 🤖 ระบบเสนอให้ถอดป้าย — คนยืนยัน ────────────────────────────────────────── */

/** ใบนี้ "น่าจะใช้หมดแล้ว" หรือยัง
 *  🔴 คืนแค่ข้อเสนอ — **ผู้เรียกห้ามเอาไปเปลี่ยน state เอง**
 *  @param {number|null} a.consumedSince ชิ้นที่ถูก consume ที่ไลน์นี้ นับจากครั้งที่ใบถึงไลน์
 *  @returns {{ suggest:boolean, reason:string|null, ratio:number|null }}
 */
export function suggestWithdraw({ card, consumedSince = null, atRatio = 1 } = {}) {
  const none = { suggest: false, reason: null, ratio: null };
  if (!card || card.state !== 'at_line') return none;        // ใบที่ไม่ได้อยู่ที่ไลน์ ไม่มีอะไรให้ถอด
  const q = Number(card.qty_per_card);
  const used = Number(consumedSince);
  /* 🔴 ไม่รู้ว่ากินไปเท่าไหร่ = **ไม่เสนอ** ห้ามเดาว่าหมด (ของจริงอาจยังเต็มกล่อง) */
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(used) || used < 0) return none;
  const ratio = used / q;
  if (ratio < atRatio) return { suggest: false, reason: null, ratio };
  return {
    suggest: true,
    ratio,
    reason: `ผลิตไปแล้ว ${Math.round(used).toLocaleString()} ชิ้น ตั้งแต่ใบนี้ถึงไลน์ (1 กล่อง = ${Math.round(q).toLocaleString()} ชิ้น)`,
  };
}

/* ── 🚶 ลดการเดิน — จัดคิวหยิบให้เดินรอบเดียว ───────────────────────────────── */

/** เรียงใบในตู้ตาม "โซนหยิบ" เพื่อให้สโตร์เดินรอบเดียวครบ (เป้าหมาย user: ลดการเดิน)
 *  🔴 ใบที่ไม่รู้โซน **ห้ามทิ้ง** — ไปท้ายคิวพร้อมธง `zoneUnknown` ให้จอเขียนบอก
 *  @param {Function} [zoneOf] (card) → รหัสโซน/ที่เก็บ · ไม่ส่ง = ใช้ `from_location`
 *  @returns {{ rows:Array, zones:number, unknown:number }}
 */
export function pickWalkOrder(cards = [], zoneOf = null) {
  const zone = (c) => {
    const z = typeof zoneOf === 'function' ? zoneOf(c) : c?.from_location;
    const s = String(z ?? '').trim();
    return s || null;
  };
  const rows = (cards || []).map(c => ({ ...c, _zone: zone(c), zoneUnknown: !zone(c) }));
  rows.sort((a, b) => {
    if (a.zoneUnknown !== b.zoneUnknown) return a.zoneUnknown ? 1 : -1;   // ไม่รู้โซน = ท้ายคิว
    const z = String(a._zone ?? '').localeCompare(String(b._zone ?? ''));
    if (z) return z;
    const l = String(a.line_name ?? '').localeCompare(String(b.line_name ?? ''));
    if (l) return l;
    return String(a.card_no ?? '').localeCompare(String(b.card_no ?? ''));
  });
  return {
    rows,
    zones: new Set(rows.filter(r => !r.zoneUnknown).map(r => r._zone)).size,
    unknown: rows.filter(r => r.zoneUnknown).length,
  };
}

/** สรุปตู้ของไลน์ — "ตู้นี้มีกี่ใบรอสโตร์ · รออยู่นานสุดกี่นาที"
 *  🔴 อ่านใบไม่ได้ = คืน `null` ห้ามคืน 0 (ตู้ว่าง กับ อ่านไม่ได้ คนละเรื่อง) */
export function cabinetSummary(cards, now = null) {
  if (!Array.isArray(cards)) return null;
  const t = now ? Date.parse(now) : Date.now();
  let waiting = 0, oldestMin = null, suggested = 0;
  cards.forEach(c => {
    if (c?.suggested_at && c.state === 'at_line') suggested += 1;
    if (c?.state !== 'in_box') return;
    waiting += 1;
    const at = Date.parse(c.state_at || '');
    if (!Number.isFinite(at) || !Number.isFinite(t)) return;
    const m = Math.max(0, Math.round((t - at) / 60000));
    if (oldestMin == null || m > oldestMin) oldestMin = m;
  });
  return { waiting, oldestMin, suggested, total: cards.length };
}
