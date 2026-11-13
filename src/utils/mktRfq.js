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

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

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
export const RFQ_STATUS_PHASE1 = ['received', 'assessing', 'pre_review', 'quoted', 'customer_review', 'design_change', 'declined'];
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

/* ═══ เฟส 2a (13/11 · feedback Marketing §10) — ชนิดงาน · อายุรุ่น · เอกสารแนบ · ใบประเมินของ IEC ═══ */

/** Q-neX โมดูล 1 "job type" — ตัวนี้บอกว่า IEC ต้องออกแบบก่อนคิดราคาไหม */
export const JOB_TYPES = {
  make_to_print: 'Make-to-print (ลูกค้าให้แบบสมบูรณ์มา ผลิตตามแบบ)',
  co_design:     'Co-design (ร่วมออกแบบกับลูกค้า — IEC ต้องออกแบบก่อนคิดราคา)',
};

/** ยอดรวมตลอดอายุรุ่น = volume/ปี × อายุรุ่น (ปี) — ตัวที่ใช้หารค่าแม่พิมพ์ต่อชิ้น · ขาดตัวใดตัวหนึ่ง = null ห้าม 0 */
export function lifetimeVolume(annualVolume, modelLifeYears) {
  const v = num(annualVolume), y = num(modelLifeYears);
  if (v == null || y == null) return null;
  return Math.round(v * y);
}

/** ชนิดเอกสารแนบ (= แกน access matrix) · `mktOnly` = ราคา เห็นเฉพาะ rfq:edit (RLS ตรงกัน) · `iec` = IEC แนบได้ (rfq:assess)
 *  🔴 เพิ่มชนิดใหม่ต้องเพิ่ม CHECK ใน mkt_rfq_files + policy ด้วย (migration 20261113a) */
export const FILE_KINDS = {
  rfq_letter:     { label: 'ใบ RFQ / จดหมายลูกค้า', icon: '📨' },
  drawing:        { label: 'แบบ (Drawing)',          icon: '📐' },
  cad:            { label: 'CAD / 3D data',           icon: '🧊' },
  spec:           { label: 'สเปค / มาตรฐานลูกค้า',    icon: '📋' },
  volume:         { label: 'Volume sheet',            icon: '📈' },
  customer_other: { label: 'เอกสารลูกค้าอื่นๆ',        icon: '📎' },
  assessment:     { label: 'เอกสารประเมินของ IEC',    icon: '📝', iec: true },
  cost:           { label: '🔒 Cost breakdown',       icon: '💰', mktOnly: true },
  quotation:      { label: '🔒 ใบเสนอราคา',           icon: '🧾', mktOnly: true },
  other:          { label: 'อื่นๆ',                    icon: '📄' },
};
export const fileKindMeta = (k) => FILE_KINDS[k] || { label: k || 'ไม่ระบุชนิด', icon: '📄' };
/** ใครแนบชนิดไหนได้ — ต้องตรงกับ policy mkt_rfq_files_ins (MKT ทุกชนิด · IEC เฉพาะ assessment) */
export const canUploadKind = (kind, { canEdit = false, canAssess = false } = {}) =>
  !!FILE_KINDS[kind] && (canEdit || (canAssess && !!FILE_KINDS[kind].iec));
export const visibleFileKinds = ({ canEdit = false } = {}) =>
  Object.keys(FILE_KINDS).filter(k => canEdit || !FILE_KINDS[k].mktOnly);

/** ผลประเมินความเป็นไปได้ · โทนอ้าง statusTone */
export const FEASIBLE = {
  yes:         { label: 'ผลิตได้',              tone: 'good' },
  conditional: { label: 'ได้แบบมีเงื่อนไข',     tone: 'warn' },
  no:          { label: 'ผลิตไม่ได้ / ไม่รับ',   tone: 'bad' },
};
export const TARGET_PRICE_FEASIBLE = {
  yes:     { label: 'เป็นไปได้',               tone: 'good' },
  no:      { label: 'ต่ำกว่าที่น่าจะทำได้',     tone: 'bad' },
  unknown: { label: 'ยังตอบไม่ได้ (รอคิดต้นทุน)', tone: 'none' },
};
export const ASSESS_STATUS = { draft: { label: 'IEC กำลังประเมิน', tone: 'warn' }, submitted: { label: 'ส่งผลแล้ว', tone: 'good' } };

/** รอบล่าสุด / รอบถัดไป ของใบประเมิน (1 รอบ = 1 แถว · ขอแก้แบบ = รอบใหม่) */
export const latestAssessment = (list) => (list || []).reduce((m, a) => (!m || (a.round ?? 0) > (m.round ?? 0) ? a : m), null);
export const nextAssessmentRound = (list) => ((latestAssessment(list)?.round ?? 0) + 1);

/** ก่อนส่งผล — ช่องที่ยังขาด (จอเขียนบอก · ว่าง = ส่งได้) · ราคาเป้าหมายต้องตอบเมื่อ RFQ มีราคาเป้าหมาย */
export function assessmentMissing(a, rfq = {}) {
  const out = [];
  if (!a?.feasible) out.push('ผลิตได้ไหม');
  if (a?.feasible && a.feasible !== 'no') {
    if (!a.ref_line_name) out.push('ไลน์อ้างอิง');
    if (!(Array.isArray(a.process_flow) && a.process_flow.some(r => r?.process))) out.push('ร่าง process flow อย่างน้อย 1 ขั้น');
  }
  if (a?.feasible === 'no' && !a.feasible_note) out.push('เหตุผลที่ผลิตไม่ได้');
  if (rfq?.customer_target_price != null && !a?.target_price_feasible) out.push('ราคาเป้าหมายลูกค้าเป็นไปได้ไหม');
  return out;
}

/**
 * ด่านเปลี่ยนสถานะ RFQ — "ข้ามขั้นประเมินไม่ได้" (feedback 12/11: ประเมิน (IEC) ✗ — เดิม MKT กดข้ามจาก received ไป quoted ได้)
 * · ไปสถานะที่ stage > 2 (หลังประเมิน) ต้องมีใบประเมินที่ **ส่งผลแล้ว** อย่างน้อย 1 รอบ
 * · ยกเว้น declined/cancelled (ปิดงานโดยไม่ประเมินได้) และ assessing (= การส่งประเมินเอง)
 * @returns { ok, reason }
 */
export function assessmentGate(nextStatus, { assessments = [] } = {}) {
  const meta = RFQ_STATUS[nextStatus];
  if (!meta) return { ok: false, reason: `สถานะ ${nextStatus} ไม่อยู่ในชุดที่ระบบรู้จัก` };
  if (nextStatus === 'declined' || nextStatus === 'cancelled' || meta.stage <= 2) return { ok: true, reason: null };
  const submitted = (assessments || []).some(a => a?.status === 'submitted');
  if (!submitted) return { ok: false, reason: 'ยังไม่มีผลประเมินจาก IEC — ต้องส่งให้ IEC ประเมิน (ขั้น 2) และได้ผลกลับมาก่อน จึงจะเดินต่อขั้น 3 ขึ้นไปได้' };
  return { ok: true, reason: null };
}

/** 🧑‍💼 คนในโมดูลนี้ = บัญชีที่ role การตลาด (feedback Marketing 12/11 "ข้อมูลคนที่ขึ้นยังเป็นคนในบริษัทเรา")
 *  Marketing ไม่อยู่ในทะเบียนพนักงาน/ผังองค์กรของโรงงาน ⇒ ช่อง "ผู้รับผิดชอบ" ต้อง `strict` ด้วยชุดนี้
 *  ชื่อนอกลิสต์ยังพิมพ์เองได้ (ติดป้ายไม่ได้อยู่ในทะเบียน) — ห้ามถอด strict กลับไปโชว์ทั้งโรงงาน */
export const MKT_PEOPLE_ROLES = ['marketing'];

/** ขั้นของสายธาร RFQ (แถบ ✓→⑦ บนใบ · ถอดจาก flowchart Q-neX) — `stage` ใน RFQ_STATUS ชี้มาที่ลำดับนี้ */
export const RFQ_FLOW_STEPS = [
  { n: 1, label: 'รับ RFQ' },
  { n: 2, label: 'IEC ประเมิน' },
  { n: 3, label: 'MKT ทบทวน' },
  { n: 4, label: 'คิดต้นทุน' },
  { n: 5, label: 'ทบทวนราคา' },
  { n: 6, label: 'อนุมัติราคา' },
  { n: 7, label: 'ส่งใบเสนอราคา' },
  { n: 8, label: 'ลูกค้าพิจารณา' },
  { n: 9, label: 'ผลตัดสิน' },
];
/** "⏳ รอ: ใคร — ทำอะไร" ต่อสถานะ (ข้อความเดียวทั้งระบบ · ห้ามแต่งในหน้า) */
const RFQ_WAITING = {
  received:        'MKT — ส่ง CRD ให้ IEC/แผนกที่เกี่ยวข้องประเมิน',
  assessing:       'IEC/แผนก — ประเมินความเป็นไปได้ + ต้นทุนเบื้องต้น',
  pre_review:      'MKT — ทบทวน concept/cost ก่อนคิดราคา',
  costing:         'CSC — คิดต้นทุน (Cost Breakdown)',
  quote_review:    'MKT Engineer — ทบทวนราคาเสนอ',
  quote_approval:  'MKT Manager — อนุมัติใบเสนอราคา',
  quoted:          'ลูกค้า — ตอบใบเสนอราคา',
  customer_review: 'ลูกค้า — ตัดสินผล (nomination)',
  design_change:   'MKT — รับแบบที่แก้แล้วส่งประเมินใหม่',
};

/**
 * แถบขั้นตอนของใบ RFQ 1 ใบ → { steps:[{n,label,state:'done'|'current'|'todo',tone?}], waiting, closed }
 * · ขั้นก่อนสถานะปัจจุบัน = done (ทำนอกระบบก็นับว่าผ่านแล้ว — เฟส 1 ยังไม่มีขั้น 3-6 ในจอ)
 * · ขั้น 9 ปิดแล้ว = ใส่ tone ของผล (ได้งาน good · ไม่ได้ bad · ยกเลิก/ปฏิเสธ none) และ label เป็นผลจริง
 * · `award` ส่งมาเมื่อได้งาน: ยังไม่ออกใบแจ้งจัดทำ = ยังมีคนต้องทำต่อ (ไม่ใช่ "จบแล้ว")
 * · สถานะที่ไม่รู้จัก = ไม่มี current (ทุกขั้น todo) + waiting = null — จอเขียนว่าสถานะอ่านไม่ออก ห้ามเดา
 */
export function rfqFlow(status, { award = null } = {}) {
  const meta = RFQ_STATUS[status];
  const cur = meta?.stage || 0;
  const closed = !!meta?.closed;
  const steps = RFQ_FLOW_STEPS.map(s => {
    let state = s.n < cur ? 'done' : s.n === cur ? 'current' : 'todo';
    if (closed && s.n === 9) state = 'done';
    const out = { n: s.n, label: s.label, state };
    if (closed && s.n === 9) { out.label = meta.label; out.tone = meta.tone; }
    return out;
  });
  let waiting = null;
  if (!meta) waiting = null;
  else if (status === 'awarded') waiting = award?.production_order_no ? null : 'MKT — ออกใบแจ้งจัดทำ (F-MKT-001/002) ส่งโรงงาน';
  else if (closed) waiting = null;
  else waiting = RFQ_WAITING[status] || null;
  return { steps, waiting, closed, known: !!meta };
}
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
