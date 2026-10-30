/* ═══════════════════════════════════════════════════════════════════════════════════════
   💼 mktRfq — กฎ/สูตรกลางของโมดูล Marketing (Q-neX เฟส 1 · 2026-10-30)
   pure ล้วน (ไม่แตะ DB/UI) · เทส src/utils/__tests__/mktRfq.test.mjs
   📄 แบบเต็ม: docs/MARKETING-QNEX-DESIGN.md · กฎโมดูล: docs/modules/mkt-rfq.md

   ของที่อยู่ที่นี่ที่เดียว (ห้ามคิดซ้ำในหน้า):
   · สถานะ RFQ + ข้อความ/โทนสี (โทนอ้าง statusTone.js — ห้ามตั้ง hex เอง)
   · เลข running ของ RFQ และใบแจ้งจัดทำ (เลขสูงสุด+1 · ห้าม count()+1)
   · ยอดขายต่อปี = volume × ราคาชิ้น (ขาดตัวใดตัวหนึ่ง = null ห้าม 0)
   · สรุป won/lost แบบ Model Report
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/** สถานะ RFQ — ถอดจาก flowchart Q-neX (§6.2) · `tone` = คีย์ของ statusTone (good/warn/bad/none) */
export const RFQ_STATUS = {
  received:        { label: 'รับ RFQ แล้ว',          tone: 'none', stage: 1 },
  assessing:       { label: 'IEC/แผนกกำลังประเมิน',  tone: 'warn', stage: 2 },
  pre_review:      { label: 'MKT ทบทวน concept/cost', tone: 'warn', stage: 3 },
  costing:         { label: 'คิดต้นทุน',              tone: 'warn', stage: 4 },
  quote_review:    { label: 'MKT Engineer ทบทวนราคา', tone: 'warn', stage: 5 },
  quote_approval:  { label: 'รอ MKT Manager อนุมัติ', tone: 'warn', stage: 6 },
  quoted:          { label: 'ส่งใบเสนอราคาแล้ว',      tone: 'good', stage: 7 },
  customer_review: { label: 'ลูกค้ากำลังพิจารณา',    tone: 'warn', stage: 8 },
  design_change:   { label: 'ลูกค้าขอแก้แบบ',        tone: 'warn', stage: 8 },
  declined:        { label: 'ปฏิเสธงาน (TS)',         tone: 'none', stage: 9, closed: true },
  awarded:         { label: 'ได้งาน',                 tone: 'good', stage: 9, closed: true },
  lost:            { label: 'ไม่ได้งาน',               tone: 'bad',  stage: 9, closed: true },
  cancelled:       { label: 'ลูกค้ายกเลิกโครงการ',    tone: 'none', stage: 9, closed: true },
};
/** เฟส 1 จอให้เลือกแค่ชุดนี้ (ชั้นมอบงาน/ต้นทุน/อนุมัติ 2 ชั้นมาเฟส 2-3) — ค่าอื่นที่มีในฐานยังอ่านออก */
export const RFQ_STATUS_PHASE1 = ['received', 'assessing', 'quoted', 'customer_review', 'design_change', 'declined'];
export const RFQ_OUTCOMES = {
  awarded:   { label: 'ได้งาน (AWARDED)',    tone: 'good' },
  lost:      { label: 'ไม่ได้งาน (LOST)',    tone: 'bad' },
  cancelled: { label: 'ยกเลิก (CANCELLED)', tone: 'none' },
};
export const PROCESS_TYPES = { steel: 'งานปั๊มเหล็ก (Steel Stamping)', plastic: 'งานฉีดพลาสติก (Plastic Injection)' };
export const PRIORITIES = { normal: 'ปกติ (24-48 ชม.)', urgent: 'ด่วน (12 ชม.)' };
/** 🔴 volume ต้องบอกที่มา — ชุดตัวอย่าง FORD มี 3 ชุดคนละค่า (RFQ 67k · ประมาณการขาย 471k/7 ปี · Model Report 10k) */
export const VOLUME_SOURCES = {
  rfq:            'จาก RFQ ลูกค้า (annual volume)',
  sales_estimate: 'ประมาณการขายของ MKT',
  model_report:   'ตัวเลขใน Model Report',
  other:          'อื่นๆ (ระบุในหมายเหตุ)',
};

export const rfqStatusMeta = (s) => RFQ_STATUS[s] || { label: s || '—', tone: 'none', stage: 0 };
/** ผล award เขียนทับสถานะ RFQ เสมอ (awarded/lost/cancelled = สถานะปิด) */
export const isClosed = (status) => !!RFQ_STATUS[status]?.closed;

/** RFQ-YYYY-### — เลขสูงสุดของปีนั้น + 1 (รูปแบบเดียวกับ nextProjectCode ของ NPI) */
export function nextRfqNo(existingNos, today) {
  const y = String(today || '').slice(0, 4) || String(new Date().getFullYear());
  const re = new RegExp(`^RFQ-${y}-(\\d{3,})$`);
  const max = (existingNos || []).reduce((m, c) => { const x = re.exec(c || ''); return x ? Math.max(m, +x[1]) : m; }, 0);
  return `RFQ-${y}-${String(max + 1).padStart(3, '0')}`;
}

/**
 * เลขใบแจ้งจัดทำ — รูปแบบของจริง `MKT1./366/05/2020` คือ <หน่วย>/<running>/<เดือน>/<ปี>
 * เราออกเป็น `MKT/<running 3 หลัก>/<MM>/<YYYY>` · running = เลขสูงสุดของ "ปีเดียวกัน" + 1 (ไม่รีเซ็ตรายเดือน —
 * ของจริงเลข 366 ในเดือน 05 บอกว่าเป็น running รายปี) · ⚠️ รูปแบบเป๊ะยังต้องถาม Marketing (§9 ข้อ 6)
 */
export function nextProductionOrderNo(existingNos, today) {
  const ym = String(today || '').slice(0, 7);
  const [y, mo] = ym.split('-');
  if (!y || !mo) return null;
  const re = new RegExp(`^MKT/(\\d+)/\\d{2}/${y}$`);
  const max = (existingNos || []).reduce((m, c) => { const x = re.exec(c || ''); return x ? Math.max(m, +x[1]) : m; }, 0);
  return `MKT/${String(max + 1).padStart(3, '0')}/${mo}/${y}`;
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** ยอดขายต่อปี = volume × ราคาชิ้น · ขาดตัวใดตัวหนึ่ง = null (ห้ามคืน 0 — 0 แปลว่า "ขายได้ศูนย์บาท")
 *  ปัดเป็นสตางค์ (2 ตำแหน่ง) — 10000 × 32.23 ใน float = 322299.99999999994 (Model Report ของจริงก็โชว์เลขนี้) */
export function annualSales(volume, unitPrice) {
  const v = num(volume), p = num(unitPrice);
  if (v == null || p == null) return null;
  return Math.round(v * p * 100) / 100;
}

/**
 * สรุปแบบ Model Report: { total, awarded, lost, cancelled, sales:{awarded,lost}, tooling:{awarded,lost}, unknownSales }
 * unknownSales = จำนวนใบที่ตัดสินแล้วแต่คิดยอดไม่ได้ (ขาด volume/ราคา) — จอต้องเขียนบอก ไม่ใช่กลืนเป็น 0
 */
export function awardSummary(awards) {
  const out = { total: 0, awarded: 0, lost: 0, cancelled: 0, sales: { awarded: 0, lost: 0 }, tooling: { awarded: 0, lost: 0 }, unknownSales: 0 };
  for (const a of awards || []) {
    if (!a || !RFQ_OUTCOMES[a.outcome]) continue;
    out.total++; out[a.outcome]++;
    if (a.outcome === 'cancelled') continue;
    const s = a.annual_sales != null ? num(a.annual_sales) : annualSales(a.annual_volume, a.unit_price);
    if (s == null) out.unknownSales++; else out.sales[a.outcome] += s;
    const t = num(a.tooling_price); if (t != null) out.tooling[a.outcome] += t;
  }
  return out;
}

/** ค่าที่ควรส่งไปตั้งโปรเจค NPI ตอนส่ง CRD / ได้งาน — ระบบ "เสนอ" คนแก้ได้ในโมดัล (ห้ามเขียนตรงโดยไม่ให้ดู) */
export function npiProjectDraftFromRfq(rfq, parts = []) {
  const main = (parts || []).filter(p => !p.parent_part_id);
  const first = main[0] || parts[0] || null;
  return {
    name: [rfq?.customer, rfq?.model, first?.part_name || first?.part_no].filter(Boolean).join(' · ') || rfq?.rfq_no || '',
    customer: rfq?.customer || '',
    model: rfq?.model || '',
    sop_date: rfq?.sop_date_customer || '',
    description: `จาก ${rfq?.rfq_no || 'RFQ'}${rfq?.crd_no ? ` · CRD ${rfq.crd_no}` : ''}`,
    parts: main.map(p => ({ part_no: p.part_no, part_name: p.part_name || null })),
  };
}

/** ใบแจ้งจัดทำ F-MKT-001/002 — เนื้อใบ (snapshot) ประกอบจากข้อมูล ณ วันออกใบ · พิมพ์ซ้ำอ่านจากตรงนี้ */
export function buildProductionOrderSnapshot({ rfq, parts = [], award, issuedBy = null, issuedAt = null }) {
  const main = (parts || []).filter(p => !p.parent_part_id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const subsOf = (id) => (parts || []).filter(p => p.parent_part_id === id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return {
    v: 1,
    rfq_no: rfq?.rfq_no || null, customer: rfq?.customer || null, model: rfq?.model || null,
    process_type: rfq?.process_type || null,
    annual_volume: award?.annual_volume ?? rfq?.annual_volume ?? null,
    volume_source: rfq?.volume_source || null,
    apw: rfq?.apw ?? null, mpw: rfq?.mpw ?? null,
    sop_date_customer: rfq?.sop_date_customer || null,
    unit_price: award?.unit_price ?? null, tooling_price: award?.tooling_price ?? null,
    po_no: award?.po_no || null, to_no: award?.to_no || null,
    npi_project_id: rfq?.npi_project_id || null,
    parts: main.map(p => ({
      part_no: p.part_no, part_name: p.part_name || null, material_spec: p.material_spec || null,
      thickness_mm: p.thickness_mm ?? null, coating: p.coating || null, cad_revision: p.cad_revision || null,
      subs: subsOf(p.id).map(s => ({ part_no: s.part_no, part_name: s.part_name || null, qty_per: s.qty_per ?? 1,
        material_spec: s.material_spec || null, thickness_mm: s.thickness_mm ?? null })),
    })),
    issued_by: issuedBy, issued_at: issuedAt,
  };
}

/** ความต่างระหว่างใบที่ออกไปแล้ว กับข้อมูลปัจจุบัน — มี = จอต้องเขียนบอก (พิมพ์ซ้ำยังเป็นใบเดิม) */
export function snapshotDrift(snapshot, { rfq, parts = [], award }) {
  if (!snapshot) return [];
  const now = buildProductionOrderSnapshot({ rfq, parts, award });
  const out = [];
  const cmp = (k, label) => { if ((snapshot[k] ?? null) !== (now[k] ?? null)) out.push(label); };
  cmp('customer', 'ลูกค้า'); cmp('model', 'รุ่น'); cmp('annual_volume', 'volume/ปี');
  cmp('unit_price', 'ราคาชิ้น'); cmp('tooling_price', 'ราคาแม่พิมพ์'); cmp('po_no', 'เลข PO');
  const a = (snapshot.parts || []).map(p => p.part_no).join('|'), b = now.parts.map(p => p.part_no).join('|');
  if (a !== b) out.push('รายการพาร์ท');
  return out;
}
