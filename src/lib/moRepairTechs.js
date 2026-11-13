/* ── moRepairTechs — "ใครซ่อมจริง" ของใบ MO สำหรับเอกสารที่ export (2026-11-04) ──────────
 *
 * ที่มา (feedback ทีม MTN · `ESM_Feedback.pdf` ข้อ 2 "การปิด MO"):
 *   *"ช่างซ่อมหลักและช่างซ่อมรองที่ให้กรอก ไม่ได้แสดงในเอกสาร MO ที่ Export"*
 *   รอบ 02/11 แก้ **ใบพิมพ์** (FM-MTN-006 · ตารางค่าแรง) ไปแล้ว — รอบนี้ปิดฝั่ง **ไฟล์ Excel**
 *
 * 🔴 ทำไมต้องมีไฟล์นี้ (ห้ามเติม `tech_main`/`tech_secondary` เข้า `MO_LIST_COLS`):
 *   คิวรีรายการ MO ยิง ~1,389 ครั้ง/วัน ที่เพดาน 1000 ใบ — คอลัมน์ที่ "มีแต่ปุ่ม export อ่าน"
 *   ไปนั่งอยู่ในคิวรีนั้น = จ่าย egress ทุกครั้งที่เปิดจอ ให้คนที่ไม่ได้กด export
 *   (กฎเขียน DB ข้อ 11 · คอมเมนต์เหนือ `MO_LIST_COLS` เขียนห้ามไว้ตรงๆ)
 *   ⇒ โหลด **ตอนกดปุ่มเท่านั้น** เฉพาะใบที่อยู่บนจอ แบบเดียวกับ `loadMoCommentsFor`/`loadPrsForOrders`
 *
 * 🔴 **"ช่างที่มอบหมาย" ≠ "ช่างที่ซ่อมจริง"** — คนละคำถาม ห้ามยุบเป็นคอลัมน์เดียว
 *   · `assigned_techs`/`assigned_to` = ตอนขั้นรับงาน มอบหมายไว้ว่าใคร (มีอยู่ในไฟล์แล้ว)
 *   · `tech_main`/`tech_secondary` = ตอนปิดงาน ช่างกรอกว่าลงมือจริงใครบ้าง
 *   มอบหมาย 2 คน แล้วคนเดียวทำ / ส่งต่อให้คนอื่นทำ = เกิดเป็นปกติ ⇒ รายงานต้องเห็นทั้ง 2 แกน
 *
 * 🔴 อ่านไม่ได้ = ส่ง `error` ขึ้นไปให้ไฟล์เขียนกำกับในคอลัมน์ **ห้ามปล่อยให้ช่องว่างเฉยๆ**
 *   (ช่องว่าง 2 ความหมาย: "ไม่ได้กรอก" กับ "โหลดไม่ติด" — กฎความซื่อสัตย์ของจอ)
 */
import { supabaseDR } from '../supabaseClient';
import { fetchByIds } from '../utils/fetchByIds';

const COLS = 'id, tech_main, tech_secondary';

/** ชื่อช่างที่ซ่อมจริงของใบนี้ — เรียงหลักก่อนรอง · ไม่ซ้ำ · ว่าง = [] */
export function repairTechsOf(row) {
  const out = [];
  for (const n of [row?.tech_main, row?.tech_secondary]) {
    const s = String(n || '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * โหลด "ช่างซ่อมจริง" ของใบ MO หลายใบ — chunk `.in()` ให้เอง (กฎเขียน DB ข้อ 5)
 * @returns `{ byOrder: { [id]: { main, secondary, names } }, error, failed }`
 *          `error` ไม่เป็น null = ข้อมูลไม่ครบ **ผู้เรียกต้องเขียนกำกับในไฟล์**
 */
export async function loadRepairTechsFor(orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { byOrder: {}, error: null, failed: 0 };
  const { rows, error, failed, truncated } = await fetchByIds(
    ids,
    (chunk) => supabaseDR.from('mtn_orders').select(COLS).in('id', chunk),
  );
  const byOrder = {};
  (rows || []).forEach(r => {
    byOrder[String(r.id)] = {
      main: String(r.tech_main || '').trim() || null,
      secondary: String(r.tech_secondary || '').trim() || null,
      names: repairTechsOf(r),
    };
  });
  return {
    byOrder,
    error: error || (truncated ? 'ใบเยอะเกินเพดาน — โหลดชื่อช่างซ่อมได้ไม่ครบ' : null),
    failed: failed || 0,
  };
}
