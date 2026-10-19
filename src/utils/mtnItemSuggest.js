/* ═══ เลือกเครื่องแล้ว → เติม "ชนิดอุปกรณ์" ให้จากประวัติใบ MO ของเครื่องนั้น (pure · 2026-10-19) ═══
   คำสั่ง user: *"ที่จริงระบบเติมสิ่งที่เกี่ยวข้องพวกนั้นควรมี"*

   ทำไมเป็น "ประวัติ" ไม่ใช่ "ประเภทเครื่องในทะเบียน" (`machine_types`):
     ชื่อชนิดอุปกรณ์ **ต่างกันตามทีม** — เครื่อง Robot - Handling เดียวกัน AM เลือก `ROBOT HANDLING`
     ทีม MTN เลือก `Robot Handling [ ABB ]` ⇒ ผูก 1 ประเภทเครื่อง → 1 ชื่อ ไม่ได้ (รอ user ตัดสินเรื่องรวมทะเบียนก่อน)
     ประวัติของ "เครื่องตัวนี้" ตอบได้ตรงกว่า และกรองด้วยลิสต์ที่ทีมนั้นเลือกได้อยู่แล้ว

   🔴 กฎ:
     · ใช้เฉพาะชื่อที่ **ทีมที่แจ้งถึงเลือกได้จริง** (`allowed`) — ห้ามเติมชื่อที่ไม่มีใน dropdown
     · ตัด: ใบตีกลับ · ชื่อกำกวม (`isVague` — "เครื่องจักรอื่นๆ") ⇒ ห้ามเติม "อื่นๆ" ให้ (กฎถังขยะชั้น 1)
     · ต้องชนะขาด: ≥ MIN_VOTES ใบ และ ≥ MIN_SHARE ของใบที่นับได้ — ก้ำกึ่ง = null (ให้คนเลือกเอง ห้ามเดา)
     · เป็น "ค่าตั้งต้น" — จอต้องติดป้ายที่มา + เติมเฉพาะช่องที่ยังว่าง ไม่ทับที่คนเลือก
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { isVague } from './unclassified.js';

export const ITEM_SUGGEST_MIN_VOTES = 2;
export const ITEM_SUGGEST_MIN_SHARE = 0.6;

/**
 * @param rows     ใบ MO ของเครื่องนี้ [{ item_type, status }]
 * @param allowed  ชื่อชนิดที่ทีมนี้เลือกได้ (array/Set) · null = ไม่กรอง
 * @returns {{ itemType, votes, counted } | null}
 */
export function suggestItemTypeFromHistory(rows = [], { allowed = null } = {}) {
  const ok = allowed ? new Set([...allowed].map(s => String(s).trim())) : null;
  const tally = new Map();
  let counted = 0;
  for (const r of rows || []) {
    if (r?.status === 'rejected') continue;
    const it = String(r?.item_type ?? '').trim();
    if (!it || isVague(it)) continue;
    if (ok && !ok.has(it)) continue;
    counted++;
    tally.set(it, (tally.get(it) || 0) + 1);
  }
  if (!counted) return null;
  const [itemType, votes] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (votes < ITEM_SUGGEST_MIN_VOTES || votes / counted < ITEM_SUGGEST_MIN_SHARE) return null;
  return { itemType, votes, counted };
}
