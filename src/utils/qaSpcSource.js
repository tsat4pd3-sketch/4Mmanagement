/* 📈 SPC จากค่าที่ QA กรอกในใบตรวจ (2026-11-13 · user ถาม "ค่าทั้งหมดพลอทกราฟ SPC รึป่าว" — ตอนนั้นยังไม่)
   เดิม SPC อ่านแค่ `qa_measurements` (กรอกซ้ำมือที่แท็บ SPC) = 0 แถว ขณะที่ใบตรวจมีค่าวัดหลายหมื่นค่า
   ⇒ ใบตรวจ = แหล่งค่าวัดจริงที่เดียว · SPC อ่านจาก `qa_inspection_results` ตรงๆ **ห้ามคัดลอกไปตารางอื่น**
   (2 ที่ = ค่าไม่ตรงกันเมื่อมีคนแก้ผลในใบตรวจ)

   รูปข้อมูล: 1 แถว = (ใบตรวจ 1 รอบ × จุดตรวจ 1 จุด) · `values_json[i]` = ค่าของชิ้นที่ i+1
   ใบตรวจหน้างานตรวจรอบละ 1 ชิ้น ⇒ ไม่มี subgroup ขนาดคงที่ ⇒ **ใช้ I-MR (n=1) เสมอ**
   — ทุกค่าวัด = 1 จุดบนกราฟ เรียงตาม วันงาน → กะ (เช้าก่อนดึก) → รอบ → ชิ้น
   🔴 ค่าว่าง/ไม่ใช่ตัวเลข/จุดที่กด "ข้าม" (`judgement='na'`) ไม่ใช่ค่าวัด ⇒ ไม่ลงกราฟ (ห้ามเดาเป็น 0) */

const SHIFT_ORDER = { day: 0, night: 1 };

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** แถวผลตรวจ (embed `qa_inspection_sheets`) → แถวค่าเดี่ยวสำหรับ computeSPC เรียงเก่า→ใหม่
 *  คืน [{ id, readings:[v], work_date, shift, round_no, piece_no, operator_name, judgement }] */
export function sheetResultsToRows(results) {
  const out = [];
  for (const r of results || []) {
    if (r?.judgement === 'na') continue;
    const s = r.qa_inspection_sheets || {};
    const vals = Array.isArray(r.values_json) ? r.values_json : [];
    vals.forEach((v, i) => {
      const n = num(v);
      if (n == null) return;
      out.push({
        id: `${r.id}:${i}`, readings: [n],
        work_date: s.work_date || null, shift: s.shift || null,
        round_no: s.round_no ?? null, piece_no: i + 1,
        operator_name: s.inspector_name || r.recorded_by || null,
        judgement: r.judgement || null, _t: r.recorded_at || '',
      });
    });
  }
  out.sort((a, b) =>
    String(a.work_date || '').localeCompare(String(b.work_date || ''))
    || (SHIFT_ORDER[a.shift] ?? 9) - (SHIFT_ORDER[b.shift] ?? 9)
    || (a.round_no ?? 0) - (b.round_no ?? 0)
    || a.piece_no - b.piece_no
    || String(a._t).localeCompare(String(b._t)));
  return out;
}

/** จุดตรวจ (embed `qa_parts`) → "จุดควบคุม" เสมือนสำหรับจอ SPC (n=1 · spec จากจุดตรวจเอง) */
export function itemAsChar(it) {
  if (!it) return null;
  const p = it.qa_parts || {};
  return {
    id: it.id, source: 'sheet',
    part_no: p.part_no || '', part_name: p.part_name || '', line_name: p.line_name || null,
    characteristic: it.characteristic || '', balloon_no: it.balloon_no || '',
    unit: it.unit || '', nominal: num(it.nominal), usl: num(it.usl), lsl: num(it.lsl),
    subgroup_size: 1, is_active: it.is_active !== false,
  };
}

/** ป้ายจุดตรวจในตัวเลือก — "#12 ระยะรู (mm)" */
export function itemLabel(it) {
  const b = it?.balloon_no ? `#${it.balloon_no} ` : '';
  return `${b}${it?.characteristic || '—'}${it?.unit ? ` (${it.unit})` : ''}`;
}

const normPart = (s) => String(s || '').toUpperCase().replace(/[\s-]+/g, '');

/** จุดควบคุมที่ตั้งเองตรงกับจุดตรวจไหนในใบตรวจ (ปุ่ม "ส่งเข้า SPC" เก็บ `Dwg balloon #X` ไว้ใน control_method)
 *  — จับด้วยพาร์ท (ไม่สนช่องว่าง/ขีด) + เลขบอลลูน ก่อน ไม่มีบอลลูนค่อยใช้ชื่อจุดตรงตัว · หลายตัว/ไม่เจอ = null (ไม่เดา) */
export function matchCharToItem(char, items) {
  if (!char) return null;
  const pk = normPart(char.part_no);
  const same = (items || []).filter(it => normPart(it.qa_parts?.part_no) === pk);
  const m = String(char.control_method || '').match(/#\s*([^\s,·]+)/);
  if (m) {
    const hit = same.filter(it => String(it.balloon_no || '').trim() === m[1]);
    if (hit.length === 1) return hit[0];
  }
  const byName = same.filter(it => String(it.characteristic || '').trim() === String(char.characteristic || '').trim());
  return byName.length === 1 ? byName[0] : null;
}

/** ผลตรวจของ "ทั้งชิ้นงาน" → Map(item_id → แถวค่าเดี่ยวเรียงเก่า→ใหม่) — ใช้ทำตารางสรุปทุกจุดในครั้งเดียว */
export function groupRowsByItem(results) {
  const by = new Map();
  for (const r of results || []) {
    if (!r?.item_id) continue;
    if (!by.has(r.item_id)) by.set(r.item_id, []);
    by.get(r.item_id).push(r);
  }
  const out = new Map();
  for (const [id, list] of by) out.set(id, sheetResultsToRows(list));
  return out;
}

/* ตัวกรองตารางจุด (ไทยเก็บที่นี่ · จอแปลตอนวาด) — 'low' = Cpk < 1.33 · 'oos' = มีค่าหลุด spec · 'nodata' = ยังไม่มีค่า */
export const POINT_FILTERS = [
  { value: 'all', label: 'ทุกจุด' },
  { value: 'low', label: 'Cpk < 1.33' },
  { value: 'oos', label: 'มีค่าหลุด spec' },
  { value: 'nodata', label: 'ยังไม่มีค่า' },
];
export const CPK_OK = 1.33;

/** จุดนี้ผ่านตัวกรองไหม — `st` = { n, cpk, oos } · Cpk คิดไม่ได้ (null) ไม่นับเป็น "ต่ำ" (ไม่รู้ ≠ แย่) */
export function pointPasses(st, filter) {
  if (filter === 'low') return st.cpk != null && st.cpk < CPK_OK;
  if (filter === 'oos') return (st.oos || 0) > 0;
  if (filter === 'nodata') return !st.n;
  return true;
}

/** เรียงจุด: แย่สุดขึ้นก่อน — หลุด spec → Cpk น้อย→มาก → คิด Cpk ไม่ได้ → ไม่มีค่า · เสมอกันเรียงเลขบอลลูน */
export function sortPoints(list) {
  const rank = (s) => (!s.n ? 3 : s.oos > 0 ? 0 : s.cpk != null ? 1 : 2);
  return [...(list || [])].sort((a, b) =>
    rank(a) - rank(b)
    || (rank(a) <= 1 ? (a.cpk ?? 0) - (b.cpk ?? 0) : 0)
    || String(a.balloon || '').localeCompare(String(b.balloon || ''), undefined, { numeric: true }));
}
