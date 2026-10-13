/* 🏬 slocStockView — จัดกลุ่มยอดสต็อกตาม "พื้นที่ SAP (SLoc)" แทนรายไลน์ (2026-10-13 · feedback ทีมวางแผน)

   *"ในหน้า Monitor Stock ขอเป็นรูปแบบนี้ได้มั้ยคะ … แล้วก็แบ่งเป็นตาม Store Location ค่ะ"*
   (ใบที่ส่งมา = Location · ลำดับ · Mat'l SAP · Part Name · รูป · STD/กล่อง · MAX · MIN · คงเหลือ)

   🔴 ทำไมต้อง "รวมยอดข้ามไลน์ในพื้นที่เดียวกัน" ไม่ใช่แค่สลับหัวกลุ่ม:
   `kanban_standards.min_qty/max_qty` เป็นค่า **ต่อ MAT** (ระดับพื้นที่) ไม่ใช่ต่อไลน์ —
   วัดจริง 13/10: P411 มี 68 แถวจาก 31 MAT (Line 60 · Line 61 · SUB APRON ถือพาร์ทชุดเดียวกัน)
   ⇒ เทียบยอด "รายไลน์" กับ min ของทั้งพื้นที่ = ขึ้นแดงทั้งที่ของในพื้นที่พอ (จอโกหก)
   ⇒ โหมดพื้นที่ต้องรวมก่อนเทียบ แล้วกาง "ไลน์ไหนถืออยู่เท่าไหร่" ไว้ใต้แถว (ไม่ใช่ซ่อน)

   🔴 ไลน์ที่ยังไม่ผูกพื้นที่ **ห้ามหายจากจอ** — ไปอยู่กลุ่มท้ายลิสต์ (`code: null`) พร้อมชื่อไลน์
      (กฎความซื่อสัตย์ของจอ · `slocOfLine` คืน null = "ยังไม่ผูก" ไม่ใช่ "ไม่มีของ")

   ไฟล์นี้ pure — ห้าม import react/supabase (เทสตรงได้) */
import { slocOfLine, slocLabel } from './storageLoc.js';

const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);

/**
 * @param {Array} rows   แถว line_stock_summary — ต้องมี { line_name, mat_no, qty_on_hand, part_name? }
 * @param {{ slocs: Array, lines: Array }} reg  ทะเบียนรหัสคลัง + ทะเบียนไลน์ (ไว้ไล่สายบน)
 * @returns {Array<{key, code, name, kind, lineNames, parts}>}
 *   · `code: null` = กลุ่ม "ยังไม่ผูกพื้นที่" (อยู่ท้ายเสมอ)
 *   · parts[] = { mat_no, part_name, qty, lineQtys:[{line_name, qty}] } เรียงตาม mat_no
 */
export function groupStockBySloc(rows, { slocs = [], lines = [] } = {}) {
  const orderOf = {};
  (slocs || []).forEach((s, i) => {
    const c = slocLabel(s?.code);
    if (c) orderOf[c] = { sort: Number.isFinite(+s?.sort_order) ? +s.sort_order : 999, i, name: s?.name || '', kind: s?.kind || null };
  });

  const groups = new Map();   // key → group
  (rows || []).forEach(r => {
    const line = (r?.line_name ?? '').toString();
    const hit = slocOfLine(slocs, lines, line);
    const code = hit?.code || null;
    const key = code || '￿__none__';       // ￿ = ไม่ผูก ไปท้ายลิสต์เสมอ
    if (!groups.has(key)) {
      groups.set(key, {
        key, code, name: code ? (orderOf[code]?.name || '') : '', kind: code ? (orderOf[code]?.kind || null) : null,
        lineSet: new Set(), partMap: new Map(),
      });
    }
    const g = groups.get(key);
    if (line) g.lineSet.add(line);
    const mat = (r?.mat_no ?? '').toString();
    if (!g.partMap.has(mat)) g.partMap.set(mat, { mat_no: mat, part_name: r?.part_name || '', qty: 0, lineQtys: [] });
    const p = g.partMap.get(mat);
    if (!p.part_name && r?.part_name) p.part_name = r.part_name;
    const q = num(r?.qty_on_hand);
    p.qty += q;
    p.lineQtys.push({ line_name: line, qty: q });
  });

  const out = [...groups.values()].map(g => ({
    key: g.key, code: g.code, name: g.name, kind: g.kind,
    lineNames: [...g.lineSet],
    parts: [...g.partMap.values()]
      .map(p => ({ ...p, lineQtys: p.lineQtys.sort((a, b) => b.qty - a.qty || a.line_name.localeCompare(b.line_name)) }))
      .sort((a, b) => a.mat_no.localeCompare(b.mat_no)),
  }));
  // เรียงตาม sort_order ของทะเบียน แล้วค่อยรหัส · กลุ่ม "ยังไม่ผูก" ท้ายสุด
  out.sort((a, b) => {
    if (!a.code !== !b.code) return a.code ? -1 : 1;
    if (!a.code) return 0;
    return (orderOf[a.code]?.sort ?? 999) - (orderOf[b.code]?.sort ?? 999) || a.code.localeCompare(b.code);
  });
  return out;
}

/** ป้ายหัวกลุ่มของโหมดพื้นที่ — `code` ว่าง = ยังไม่ผูก (ต้องเขียนบนจอ ห้ามปล่อยว่าง) */
export function slocGroupTitle(g) {
  if (!g?.code) return '🏬 ยังไม่ผูกพื้นที่ SAP';
  return `🏬 ${g.code}${g.name ? ` · ${g.name}` : ''}`;
}
