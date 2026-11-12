/* ═══════════════════════════════════════════════════════════════════════════
   🔗 "ส่งต่อแล้ว แต่ปลายทางไม่มีใครทำ" — โซ่ส่งต่อ MO ที่ขาด · pure (2026-11-11 · คำสั่ง user)

   โมเดลส่งต่อ (ดู `MtnRepair.doHandoff`): **1 ปัญหา หลายใบผูกกันเป็นสาย**
     ใบเดิม → `status='transferred'` (**สถานะจบ** — อยู่ใน `MO_DONE_STATUSES`)
     ใบใหม่ของทีมปลายทาง → ผูกด้วย `mtn_order_handoffs (from_order_id → to_order_id)`

   🔴 รูที่เจอจริง (วัด 11/11 · DR): ใบแม่ 31 ใบที่ `transferred` เกิน 7 วัน
        · 25 ใบ ปลายทางปิดงานแล้ว ✅
        · 2 ใบ ปลายทางยังเปิดอยู่จริง (รอรับมอบ)
        · **4 ใบ ปลายทางหายไป** — `to_order_id` เป็น null
     ต้นเหตุ: `mtn_order_handoffs.to_order_id` ประกาศไว้ `on delete set null`
     ⇒ **ใบลูกถูกลบ = ลิงก์ถูกล้างเงียบๆ** · ใบแม่ยังเป็น `transferred` = จบแล้ว
     ⇒ ปัญหาหลุดจากคิวของทุกคน **และไม่มีจอไหนบอก** (ผลิตแจ้งแล้ว ส่งต่อแล้ว ไม่มีใบไหนรับผิดชอบ)
     พิสูจน์จาก `audit_log`: ใบลูกถูก DELETE จริง 3/4 ใบ — **ทีม JIG ทั้งหมด ลบตอนยัง `pending`**
     (ลบได้เพราะใบลูกยังไม่ออกเลข MO ⇒ `moRemoveMode` ให้ลบได้ · ปิดรูแล้วที่นั้นด้วย)
     ของจริงที่ค้าง: Reed ชำรุด (Line 61 · 22/09) · น้ำมันรั่ว HDF (24/09) · บูท Swing แคลมป์ (24/10)

   ─── 🔴 กฎที่ไฟล์นี้ยึด ──────────────────────────────────────────────────────
   1. **ไม่ยิงคิวรี** — รับแถวที่หน้าโหลดมาแล้ว (เหมือน `moChase.js`)
   2. **"ปลายทางตายแล้ว" มี 2 แบบ ห้ามยุบเป็นอันเดียว** — `missing` (ใบหาย/ลิงก์ว่าง)
      กับ `void` (ใบยังอยู่ แต่ถูกยกเลิก/ตีกลับ) · คนละการแก้: แบบแรกต้องเปิดใบใหม่
      แบบที่สองมีเหตุผลบันทึกไว้แล้ว อ่านได้ว่าทำไมถึงไม่ทำ
   3. 🔴 **อ่านใบลูกไม่ได้ = `unknown` ห้ามบีบเป็น "หาย"** (คิวรีใบลูกล้ม/ยังโหลดไม่เสร็จ
      แล้วรายงานว่าหาย = จอโกหกในทางที่ทำให้คนไปเปิดใบซ้ำ) — จอต้องเขียนบอกแยก
   4. **รับ `now` เป็นพารามิเตอร์** (เทสรอบ "นาฬิกา +400 วัน")
   5. **สีคืนเป็น tone** ('bad'/'warn'/'none') ให้จอแปลงผ่าน `statusTone.js` ห้ามคืน hex
   ═══════════════════════════════════════════════════════════════════════════ */
import { isMoVoid, MO_STATUS_LABEL } from './mtnStepPerm.js';

/** ชนิดของโซ่ที่ขาด — เรียงตาม "ต้องลงมือก่อน" */
export const HANDOFF_GAP_KINDS = Object.freeze([
  { key: 'missing', icon: '🕳️', label: 'ใบปลายทางหายไป', tone: 'bad',
    hint: 'ส่งต่อแล้วแต่ไม่มีใบของทีมปลายทางในระบบ (ถูกลบ) — ปัญหานี้ไม่อยู่ในคิวของใครเลย ต้องเปิดใบใหม่ให้' },
  { key: 'void', icon: '🚫', label: 'ใบปลายทางถูกยกเลิก/ตีกลับ', tone: 'warn',
    hint: 'ทีมปลายทางยกเลิกหรือตีกลับใบที่รับไป — อ่านเหตุผลในใบนั้น แล้วตัดสินว่าจะเปิดใหม่ไหม' },
  { key: 'unknown', icon: '❓', label: 'อ่านใบปลายทางไม่ได้', tone: 'warn',
    hint: 'โหลดใบปลายทางไม่สำเร็จ — ยังไม่รู้ว่าปลายทางทำงานอยู่หรือไม่ (ไม่ใช่ว่าหาย)' },
]);
const KIND_META = Object.fromEntries(HANDOFF_GAP_KINDS.map(k => [k.key, k]));
export const handoffGapMeta = (key) => KIND_META[key] || KIND_META.unknown;

const txt = (v) => String(v ?? '').trim();
const dayMs = 86400000;

/** ส่งต่อมากี่วันแล้ว — `null` = ไม่มีวันเวลาให้นับ (ห้ามเดา 0) */
export function handoffAgeDays(h, now = Date.now()) {
  const t = Date.parse(h?.handed_at || '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Number(now) - t) / dayMs));
}

/**
 * โซ่นี้ขาดไหม — `null` = ปลายทางยังทำงานอยู่ (ไม่ใช่เรื่องของแผงนี้)
 * @param h        แถว `mtn_order_handoffs` ({ to_order_id, … })
 * @param childBy  map `id → ใบลูก` ของใบที่โหลดมาได้ · `loadedIds` = ชุด id ที่ "ยืนยันว่าโหลดแล้ว"
 */
export function handoffGapKind(h, { childBy = {}, loadedIds = null } = {}) {
  const toId = txt(h?.to_order_id);
  if (!toId) return 'missing';                       // ลิงก์ว่าง = ใบลูกถูกลบ (on delete set null)
  const child = childBy[toId];
  if (child) return isMoVoid(child) ? 'void' : null; // ปลายทางยังทำงานอยู่ = ไม่ใช่โซ่ขาด
  /* 🔴 ไม่เจอใน map มี 2 ความหมาย — "ยืนยันแล้วว่าไม่มีแถวนี้" vs "ยังไม่ได้โหลด/โหลดล้ม"
     ผู้เรียกต้องส่ง `loadedIds` มาเพื่อแยก · ไม่ส่ง = ตอบ unknown (fail-safe ทางที่ไม่โกหก) */
  if (loadedIds && !loadedIds.has(toId)) return 'unknown';
  if (!loadedIds) return 'unknown';
  return 'missing';                                  // อยู่ในชุดที่โหลดแล้วแต่ไม่มีแถว = ถูกลบจริง
}

/**
 * แผง "โซ่ส่งต่อที่ขาด"
 * @param handoffs แถว `mtn_order_handoffs`
 * @param opts.parentBy map id → ใบแม่ (เอาไว้โชว์เลข MO/ไลน์/เครื่อง) · ไม่มี = โชว์เท่าที่รู้
 * @param opts.childBy  map id → ใบลูก · opts.loadedIds = Set ของ id ที่ยืนยันว่าโหลดแล้ว
 * @param opts.teamName (key) => ชื่อทีมไทย
 * @returns `{ rows, groups, total, byKind }` — `rows` เรียงส่งต่อนานสุดก่อน
 */
export function buildHandoffGapBoard(handoffs, opts = {}) {
  const { parentBy = {}, childBy = {}, loadedIds = null, teamName = (k) => k, now = Date.now() } = opts;
  const rows = [];
  for (const h of handoffs || []) {
    const kind = handoffGapKind(h, { childBy, loadedIds });
    if (!kind) continue;
    const parent = parentBy[txt(h?.from_order_id)] || null;
    const child = childBy[txt(h?.to_order_id)] || null;
    rows.push({
      id: txt(h?.id) || `${txt(h?.from_order_id)}→${txt(h?.to_order_id)}`,
      kind,
      days: handoffAgeDays(h, now),
      fromOrderId: txt(h?.from_order_id) || null,
      toDept: txt(h?.to_dept) || null,
      toDeptLabel: txt(h?.to_dept) ? teamName(txt(h.to_dept)) : null,
      handedBy: txt(h?.handed_by) || null,
      reason: txt(h?.reason) || null,
      /* ใบแม่ = ที่เดียวที่ยังมีเนื้อปัญหาอยู่ครบ ⇒ จอต้องเปิดใบนี้ให้คนอ่าน */
      moNo: txt(parent?.mo_no) || null,
      lineName: txt(parent?.line_name) || null,
      machineNo: txt(parent?.machine_no) || null,
      problem: txt(parent?.problem_characteristic) || txt(parent?.report_note) || null,
      childStatus: child ? txt(child.status) : null,
      childStatusLabel: child ? (MO_STATUS_LABEL[txt(child.status)] || txt(child.status)) : null,
      childReason: txt(child?.reject_reason) || null,
    });
  }
  /* เรียง "ส่งต่อนานสุดก่อน" · นับวันไม่ได้ต่อท้าย (ห้ามตัดทิ้ง — กฎข้อ 3 ของ moChase) */
  rows.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

  const byKind = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  const groups = HANDOFF_GAP_KINDS
    .filter(k => byKind[k.key])
    .map(k => ({ ...k, n: byKind[k.key], rows: rows.filter(r => r.kind === k.key) }));

  return { rows, groups, total: rows.length, byKind };
}
