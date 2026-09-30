/* ── partOptions — option "เลขพาร์ท (P/N ลูกค้า)" สำหรับ <PartSelect> (pure · ไม่ import supabase/react) ──
   (2026-09-07 · single-source audit) กุญแจ = part_no (P/N ลูกค้า) ไม่ใช่ mat_no — ใช้กับ qa_capa / qa_ncr /
   qa_characteristics / qa_claims ที่ matchDocSet (PeChangeRequests) + CapaEffectiveness เทียบ text ตรงๆ
   ทะเบียน 3 แหล่งรวมกัน: pe_doc_sets (Main) ∪ qa_parts (Main) ∪ dr_products (DR — p_no fallback mat_no)
   ห้าม map เองในหน้า — เดิมซ้ำ 2 ไฟล์ (QualityControl · QaClaims) */
export const partKey = (v) => String(v ?? '').trim().toUpperCase();

export function buildPartOptions({ products = [], sets = [], qaParts = [] } = {}) {
  const out = []; const byKey = new Map();
  const push = (o) => {
    const k = partKey(o.part_no); if (!k) return;
    const ex = byKey.get(k);
    if (ex) {
      ex.keywords += ` ${o.keywords || ''}`;
      if (!ex.part_name && o.part_name) { ex.part_name = o.part_name; ex.title = o.part_name; }
      // ⚠️ แหล่งแรกอาจไม่มี MAT (ชุดเอกสาร PE ที่ยังไม่ผูก) — แหล่งถัดมามีก็ต้องเติมบรรทัด 2 ให้ด้วย
      //    ไม่งั้นแถวนั้นจะ "ไม่มีเลข MAT" ทั้งที่ทะเบียนมี (feedback 30/09 ขอเห็น MAT ทุกแถว)
      if (!ex.mat_no && o.mat_no) { ex.mat_no = o.mat_no; ex.code = `MAT ${o.mat_no}`; }
      if (!ex.sub && o.sub) ex.sub = o.sub;
      return;
    }
    const row = { ...o, id: `pn:${k}`, key: k, label: String(o.part_no).trim() };
    byKey.set(k, row); out.push(row);
  };
  /* 🔴 2 บรรทัด · รหัสห้ามถูกตัด (2026-09-30) — `label` = part_no อยู่แล้ว จึงเป็น `lead` ของบรรทัด 1
     บรรทัด 1 = Part No. (ห้ามตัด) + ชื่อพาร์ท (ตัดได้) · บรรทัด 2 = MAT SAP (ห้ามตัด) + ลูกค้า/ไลน์ */
  const shape = (part_no, part_name, mat_no, customer, line_name) => ({
    lead: part_no, title: part_name || '',
    code: mat_no ? `MAT ${mat_no}` : null,
    sub: [customer, line_name].filter(Boolean).join(' · '),
    keywords: `${part_name || ''} ${mat_no || ''} ${customer || ''} ${line_name || ''}`,
  });
  (sets || []).filter(x => x?.part_no && x.status !== 'obsolete').forEach(x => push({
    part_no: x.part_no, part_name: x.part_name || '', mat_no: x.mat_no || null, group: '📘 ชุดเอกสาร PE (PFC / FMEA / CP)', badge: '📘',
    ...shape(x.part_no, x.part_name, x.mat_no, x.customer, x.line_name),
  }));
  (qaParts || []).filter(x => x?.part_no && x.is_active !== false).forEach(x => push({
    part_no: x.part_no, part_name: x.part_name || '', mat_no: x.mat_no || null, group: '🔍 มาตรฐานตรวจ QA (qa_parts)', badge: '🔍',
    ...shape(x.part_no, x.part_name, x.mat_no, x.customer, x.line_name),
  }));
  (products || []).filter(p => p?.mat_no && !p.is_operation && p.is_active !== false).forEach(p => push({
    part_no: p.p_no || p.mat_no, part_name: p.name || '', mat_no: p.mat_no, group: '📦 Product Master (P/N ลูกค้า · MAT)', badge: p.customer || null,
    ...shape(p.p_no || p.mat_no, p.name, p.mat_no, p.customer, p.line_name),
  }));
  return out;
}
