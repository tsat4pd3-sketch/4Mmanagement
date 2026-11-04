/* 🧾 ยอด "ตัดจ่ายใน SAP ไม่ได้" ของใบเบิก-ส่งพาร์ท (2026-11-04 · คำสั่ง user)
   user: *"ในเฟสจัดงาน อยากให้เพิ่มปุ่ม กรณีตัดจ่ายใน SAP ไม่ได้ และใส่ยอดว่าค้างตัดเท่าไหร่ และมีรีพอร์ทสรุปพวกยอดที่ค้าง"*
   · จดลงใบ `wip_replenish_requests.sap_pending_*` (Main) — **ไม่แตะ ledger สต็อกของ ESM** (ของส่งจริงแล้ว ค้างแค่ฝั่ง SAP)
   · เคลียร์ = ตั้ง `sap_cleared_at/by` (ห้ามลบยอดเดิม — ต้องย้อนดูได้ว่าเคยค้างเท่าไหร่)
   pure — เทส `__tests__/sapPending.test.mjs` */

/** ฟิลด์ที่จะเขียนลงใบตอนกดส่ง · ปิดสวิตช์ = {} · กรอกผิด = error (ห้ามส่ง) */
export function sapPendingFields({ on, qty, note, max, by, now = new Date() } = {}) {
  if (!on) return { fields: {}, error: null };
  const n = Number(String(qty ?? '').replace(/,/g, '').trim());
  if (!String(qty ?? '').trim() || !Number.isFinite(n) || n <= 0) return { fields: {}, error: 'ใส่ยอดค้างตัดใน SAP (มากกว่า 0)' };
  const cap = Number(max);
  if (Number.isFinite(cap) && cap > 0 && n > cap) return { fields: {}, error: `ยอดค้างตัด (${n.toLocaleString()}) มากกว่ายอดที่ส่ง (${cap.toLocaleString()})` };
  return {
    error: null,
    fields: {
      sap_pending_qty: n,
      sap_pending_note: String(note ?? '').trim() || null,
      sap_pending_at: now.toISOString(),
      sap_pending_by_name: by || null,
    },
  };
}

/** สรุปยอดค้าง (ยังไม่เคลียร์) รายพาร์ท — คีย์ = MAT · เรียงยอดมาก→น้อย */
export function summarizeSapPending(rows = []) {
  const open = (rows || []).filter(r => Number(r?.sap_pending_qty) > 0 && !r?.sap_cleared_at);
  const by = new Map();
  for (const r of open) {
    const k = String(r.mat_no || '').trim();
    const cur = by.get(k) || { mat_no: k, part_name: r.part_name || null, qty: 0, slips: 0, lines: new Set(), oldest: r.sap_pending_at };
    cur.qty += Number(r.sap_pending_qty);
    cur.slips += 1;
    if (r.line_name) cur.lines.add(r.line_name);
    if (r.sap_pending_at && (!cur.oldest || r.sap_pending_at < cur.oldest)) cur.oldest = r.sap_pending_at;
    by.set(k, cur);
  }
  const parts = [...by.values()].map(x => ({ ...x, lines: [...x.lines].sort() })).sort((a, b) => b.qty - a.qty || a.mat_no.localeCompare(b.mat_no));
  return { open, parts, totalSlips: open.length };
}
