/* ═══ ลูปปิด 8D → PFMEA / PFC / Control Plan — ตัวจับคู่ + ตัวเสนอ (pure) ═══
   2026-08-17 · แบบเต็ม: docs/CLOSED-LOOP-8D-PE.md

   ⚠️ กฎเหล็กของไฟล์นี้: **เสนอเท่านั้น ห้ามเขียน DB** — ไฟล์นี้ไม่ import supabase โดยตั้งใจ
      เอกสาร PE เป็นเอกสารควบคุม การแก้ต้องมีคนกดยืนยันเสมอ (หลักเดียวกับ AI intake)
   ⚠️ "จับคู่ไม่ได้" ไม่ใช่ความเงียบ — ต้องคืนข้อเสนอชนิด `missing` ออกไปให้จอขึ้นสีแดง
      เพราะนั่นคือคำตอบที่มีค่าที่สุด: *ตอนออกแบบไม่เคยคิดถึงอาการนี้เลย* */

import { noteSimilarity, normalizeNote, CLUSTER_THRESHOLD } from './textCluster.js'; // .js เพื่อให้ node:test resolve ได้ (bundler ไม่สน)

/* ── กลุ่มคำของชิ้นส่วน/อาการ ที่คนเขียนต่างกันได้ (ไทย/อังกฤษ) ──────────────
   จำเป็นเพราะ FMEA เขียน "Missing nut" แต่ลูกค้า/หน้างานเขียน "นัทไม่มี"
   ตัวจับคู่ n-gram ข้ามภาษาไม่ได้ · ใช้แค่ **โฟกัสว่าจุดไหนเกี่ยวข้อง** ไม่ได้ใช้สรุปสาเหตุ
   ⚠️ ย้ายมาจาก OrderTrace.jsx (2026-08-17) — เดิมนิยามในหน้า พอมีผู้ใช้รายที่ 2-3 ต้องรวมที่เดียว
      เพิ่มคำใหม่ให้เติมที่นี่ที่เดียว */
export const PART_WORDS = [
  { key: 'nut', label: 'นัท', w: ['nut', 'นัท', 'น็อต', 'น๊อต'] },
  { key: 'bolt', label: 'โบลท์/สลัก', w: ['bolt', 'โบลท์', 'สลัก'] },
  { key: 'stud', label: 'สตัด', w: ['stud', 'สตัด'] },
  { key: 'rivet', label: 'ริเวท', w: ['rivet', 'ริเวท', 'ย้ำ'] },
  { key: 'weld', label: 'รอยเชื่อม', w: ['weld', 'เชื่อม', 'สปอต', 'spot'] },
  { key: 'hole', label: 'รู/เจาะ', w: ['hole', 'รู', 'เจาะ', 'pierce'] },
  { key: 'burr', label: 'ครีบ/คม', w: ['burr', 'ครีบ', 'คม'] },
  { key: 'dim', label: 'ขนาด/รูปทรง', w: ['dimension', 'gap', 'ขนาด', 'เบี้ยว', 'บิด', 'offset'] },
  { key: 'crack', label: 'แตก/ร้าว', w: ['crack', 'แตก', 'ร้าว'] },
  { key: 'scratch', label: 'รอยขีดข่วน', w: ['scratch', 'ขีดข่วน', 'รอย'] },
  /* ── ฝั่ง "ตัวการ" (4M) — D4 มักพูดถึงอุปกรณ์/คน/วัสดุ ไม่ใช่ชื่ออาการ ── */
  { key: 'die', label: 'แม่พิมพ์', w: ['die', 'mold', 'punch', 'แม่พิมพ์', 'พั้นช์', 'คมตัด'] },
  { key: 'jig', label: 'จิ๊ก/ฟิกซ์เจอร์', w: ['jig', 'fixture', 'locator', 'clamp', 'จิ๊ก', 'ฟิกซ์เจอร์'] },
  { key: 'robot', label: 'โรบอท', w: ['robot', 'โรบอท', 'หุ่น'] },
  { key: 'machine', label: 'เครื่องจักร', w: ['machine', 'press', 'เครื่อง', 'ปั๊ม'] },
  { key: 'man', label: 'พนักงาน', w: ['operator', 'worker', 'พนักงาน', 'คนงาน', 'ลืม'] },
  { key: 'material', label: 'วัตถุดิบ', w: ['material', 'coil', 'sheet', 'วัตถุดิบ', 'วัสดุ', 'เหล็ก'] },
  { key: 'setting', label: 'การตั้งค่า', w: ['parameter', 'setting', 'พารามิเตอร์', 'ตั้งค่า', 'ปรับ'] },
  { key: 'temp', label: 'อุณหภูมิ', w: ['temperature', 'temp', 'อุณหภูมิ', 'ความร้อน'] },
];

/** คืนกลุ่มคำที่พบในข้อความ (ใช้ทั้งกับ failure_mode และรายละเอียดที่ผู้ใช้พิมพ์) */
export const wordGroups = (txt) => {
  const s = (txt || '').toLowerCase();
  return PART_WORDS.filter((g) => g.w.some((w) => s.includes(w)));
};

/** ข้อความสองก้อนพูดถึงชิ้นส่วน/อาการกลุ่มเดียวกันไหม (ใช้เสริมตอน n-gram ไม่ช่วย) */
export const shareWordGroup = (a, b) => {
  const ga = wordGroups(a).map((g) => g.key);
  return ga.length > 0 && wordGroups(b).some((g) => ga.includes(g.key));
};

/**
 * คะแนนความใกล้เคียงของ "อาการ/สาเหตุ" ระหว่างข้อความที่คนกรอก กับบรรทัดในเอกสาร
 *
 * ⚠️ กลุ่มคำ = **ตัวกรอง** · n-gram = **ตัวจัดอันดับ** — ห้ามเอามาบวกกันตรงๆ
 *    (เคยเขียนเป็น max(s, 0.405 + 0.1s) แล้วคะแนนไม่มีทางถึงเกณฑ์ 0.45 → ไม่แมตช์อะไรเลยสักเคส)
 *    ไทย↔อังกฤษ n-gram แทบเป็น 0 เสมอ ("นัทไม่มี" vs "Missing nut") จึงต้องให้กลุ่มคำยกพื้นให้
 *    แต่ยกได้แค่ระดับ "เบาะแส" (ต่ำกว่า STRONG) เพราะคำเดียวกันมีได้หลายสิบข้อในเอกสารเดียว
 */
export function matchScore(query, text) {
  const s = noteSimilarity(query, text);
  const gq = wordGroups(query).map((g) => g.key);
  const gt = wordGroups(text).map((g) => g.key);
  const shared = gq.filter((k) => gt.includes(k));
  if (!gq.length) return { score: s, via: 'text', shared: [] };
  if (!shared.length) return { score: s * 0.5, via: 'text', shared: [] };
  /* เทียบกับ "ฝั่งที่กลุ่มคำน้อยกว่า" — คนกรอกมักพูดถึงทั้งตัวการและอาการ ("แม่พิมพ์สึก → เป็นครีบ")
     แต่เอกสารเขียนอย่างเดียว (Burr) · หารด้วยจำนวนกลุ่มของ query อย่างเดียวจะโดนหักจนตกเกณฑ์ */
  const cover = shared.length / Math.max(1, Math.min(gq.length, gt.length));
  return {
    score: Math.min(1, 0.30 + 0.25 * cover + 0.35 * s),
    via: s > 0.3 ? 'both' : 'group',
    shared,
  };
}

/** เข้ากันได้กับของเดิม — คืนเฉพาะคะแนน */
export const symptomScore = (a, b) => matchScore(a, b).score;

export const STRONG = 0.6;          // มั่นใจ — ชี้บรรทัดได้เลย
export const WEAK = 0.45;           // พอเป็นเบาะแส — ต้องให้คนดู

/**
 * จัดอันดับบรรทัดในเอกสารตามความใกล้เคียง
 * @returns {{ hits, total }} hits = top N ที่ผ่านเกณฑ์ · total = จำนวนที่ผ่านเกณฑ์ทั้งหมด
 *   ⚠️ ต้องคืน `total` ด้วย — ถ้าคำนั้นมี 45 ข้อในเอกสาร ต้องบอกคนว่าแสดงแค่ 3 ข้อแรก
 *      ไม่ใช่ทำเหมือนเจอ 3 ข้อพอดี (จะดูแม่นเกินจริง)
 */
export function rankItems(query, items, getText, topN = 3, dedupe = true) {
  if (!String(query || '').trim()) return { hits: [], total: 0 };
  const scored = items
    .map((it) => ({ it, ...matchScore(query, getText(it)) }))
    .filter((x) => x.score >= WEAK)
    .sort((a, b) => b.score - a.score);
  if (!dedupe) return { hits: scored.slice(0, topN), total: scored.length };
  /* ⚠️ ฟอร์มจริงมีข้อความเดียวกันซ้ำหลาย OP (เช่น "Burr over 0.3 mm." อยู่ที่ OP 40/50/60)
     เสนอซ้ำ 3 รายการที่อ่านเหมือนกันเป๊ะ = ขยะ · ยุบเหลือรายการเดียวแล้วบอกว่าเจอที่ OP ไหนบ้าง */
  const byText = new Map();
  for (const x of scored) {
    const k = normalizeNote(getText(x.it)).slice(0, 80);
    if (!byText.has(k)) byText.set(k, { ...x, dupes: [] });
    else byText.get(k).dupes.push(x.it);
  }
  return { hits: [...byText.values()].slice(0, topN), total: scored.length, groups: byText.size };
}

/** หาชุดเอกสาร PE ของพาร์ท (เทียบแบบตัดขีด/ช่องว่าง/ตัวพิมพ์ — เลขพาร์ทเขียนไม่เหมือนกันทุกที่) */
export const normPart = (s) => String(s ?? '').toUpperCase().replace(/[\s-]/g, '');
export function matchDocSet(sets = [], partNo, lineName) {
  const p = normPart(partNo);
  if (p) {
    const exact = sets.find((s) => normPart(s.part_no) === p);
    if (exact) return { set: exact, how: 'part_no', confidence: 1 };
    const byMat = sets.find((s) => s.mat_no && normPart(s.mat_no) === p);
    if (byMat) return { set: byMat, how: 'mat_no', confidence: 0.95 };
  }
  if (lineName) {
    const hits = sets.filter((s) => s.line_name && s.line_name === lineName);
    if (hits.length === 1) return { set: hits[0], how: 'line_name', confidence: 0.5 };
    if (hits.length > 1) return { set: null, how: 'ambiguous_line', confidence: 0, candidates: hits };
  }
  return { set: null, how: 'none', confidence: 0 };
}

/* ── ตัวช่วยอ่านความ "หลวม" ของจุดควบคุม ───────────────────────────────────── */
const LOOSE_FREQ = ['EVERY LOT', 'EVERY SHIFT', 'RANDOM', 'A.Q.L', 'AQL', '1 TIME', 'FIRST'];
const WEAK_METHOD = ['VISUAL', 'ตรวจด้วยตา', 'ดูด้วยตา'];
const isLooseFreq = (f) => LOOSE_FREQ.some((k) => String(f || '').toUpperCase().includes(k));
const isWeakMethod = (m) => WEAK_METHOD.some((k) => String(m || '').toUpperCase().includes(k.toUpperCase()));

const sug = (o) => ({ origin: 'suggested', ...o });

/**
 * เสนอรายการแก้เอกสารจากปัญหาที่ปิดไปแล้ว — แยก 3 ขาตาม 8D
 *
 * @param {object} src  { symptom, rootCause, corrective, isCustomer, severity }
 *        symptom   = อาการ (NCR.defect_desc / CAPA.d2_problem)
 *        rootCause = D4 · corrective = D5
 * @param {object} pe   { set, processes, fmeaItems, cpItems }  ของพาร์ทนั้น
 * @param {Array}  otherFmea  แถว FMEA ของ "พาร์ทอื่น" (สำหรับขา systemic/yokoten)
 *                            แต่ละแถวต้องมี set_id + _setLabel + _opNo ติดมาด้วย
 * @returns {Array} suggestions — ยังไม่มี ref_kind/ref_id/set_id ผู้เรียกเป็นคนเติม
 */
export function suggestChanges(src = {}, pe = {}, otherFmea = []) {
  const { symptom = '', rootCause = '', corrective = '', isCustomer = false } = src;
  const { processes = [], fmeaItems = [], cpItems = [] } = pe;
  const out = [];
  const procById = Object.fromEntries(processes.map((p) => [p.id, p]));
  const opOf = (id) => (procById[id] ? `OP ${procById[id].op_no} ${procById[id].name}` : '—');

  /* ── ขา ① Occurrence: ทำไมถึงเกิด → PFMEA causes ───────────────────────── */
  /* ⚠️ ค้นด้วย "สาเหตุ + อาการ" คู่กัน — แถว FMEA จับคู่ failure_mode กับ causes อยู่แล้ว
     ใช้ D4 อย่างเดียวจะพลาดเคสที่ D4 พูดถึงตัวการ (แม่พิมพ์สึก) แต่ FMEA เขียนเป็นอาการ (Burr) */
  const causeQ = `${rootCause} ${symptom}`.trim();
  const cause = rankItems(causeQ, fmeaItems, (f) => `${f.causes || ''} ${f.failure_mode || ''}`);
  const more = (r) => (r.total > r.hits.length ? ` · พบทั้งหมด ${r.total} ข้อ แสดง ${r.hits.length} ข้อแรก — ตรวจเพิ่มที่ /pe-docs` : '');

  const dupNote = (x) => (x.dupes?.length ? ` · ข้อความเดียวกันมีอีก ${x.dupes.length} แถว (${[...new Set(x.dupes.map((d) => opOf(d.process_id)))].slice(0, 3).join(', ')})` : '');
  for (const h of cause.hits) {
    const { it: f, score: s, via } = h;
    const o = f.occurrence;
    out.push(sug({
      doc_type: 'fmea', leg: 'occurrence', fmea_item_id: f.id, process_id: f.process_id,
      confidence: Math.min(1, s),
      match_note: `จับคู่ D4 กับสาเหตุใน PFMEA (${opOf(f.process_id)})${via === 'group' ? ' · จับจากคำที่ใช้ร่วมกัน ไม่ใช่ข้อความตรงกัน' : ''}${dupNote(h)}${more(cause)}`,
      proposal: `ทบทวน Occurrence ของ "${(f.failure_mode || '').slice(0, 60)}"`
        + (o ? ` — ปัจจุบัน O=${o}` : ' — ยังไม่ได้ให้คะแนน O')
        + ` · เกิดจริงแล้วแปลว่าค่าที่ประเมินไว้อาจต่ำเกิน และ/หรือมาตรการป้องกันไม่พอ`
        + (corrective.trim() ? `\nมาตรการที่ทำจริง (D5): ${corrective.trim().slice(0, 200)}` : ''),
    }));
  }
  if (causeQ && rootCause.trim() && !cause.hits.length) {
    out.push(sug({
      doc_type: 'fmea', leg: 'occurrence', confidence: 0,
      match_note: 'ค้นแล้วไม่พบสาเหตุนี้ในเอกสาร',
      proposal: `🔴 สาเหตุนี้ไม่เคยอยู่ใน PFMEA — ต้องเพิ่มแถวใหม่\nสาเหตุ (D4): ${rootCause.trim().slice(0, 300)}`
        + `\n(ไม่เคยถูกคาดไว้ตอนออกแบบ = ต้องทบทวนวิธีทำ FMEA ไม่ใช่แค่เติมแถว)`,
    }));
  }

  /* ── ขา ② Detection: ทำไมหลุดออกไป → Control Plan + PFMEA detection ────── */
  const mode = rankItems(symptom, fmeaItems, (f) => f.failure_mode);
  const touchedProc = [...new Set(mode.hits.map((x) => x.it.process_id).filter(Boolean))];
  for (const pid of touchedProc) {
    const cps = cpItems.filter((c) => c.process_id === pid);
    /* ⚠️ เอาเฉพาะจุดควบคุมที่แตะอาการเดียวกันจริง — เดิม fallback เป็น "เอาทั้งหมด"
       ทำให้เสนอจุดควบคุมทั่วไป (DIMENSION/APPEARANCE) ที่ไม่เกี่ยวกับอาการ = คนเลิกเชื่อระบบ */
    const pool = cps.filter((c) => shareWordGroup(symptom, `${c.product_char} ${c.process_char} ${c.method}`));

    if (!cps.length) {
      out.push(sug({
        doc_type: 'cp', leg: 'detection', process_id: pid, confidence: 0.5,
        match_note: `${opOf(pid)} ไม่มีจุดควบคุมใน Control Plan เลย`,
        proposal: `🔴 เพิ่มจุดควบคุมที่ ${opOf(pid)} — อาการ "${symptom.trim().slice(0, 60)}" หลุดออกไปโดยไม่มีด่านตรวจ`,
      }));
      continue;
    }
    if (!pool.length) {
      out.push(sug({
        doc_type: 'cp', leg: 'detection', process_id: pid, confidence: 0.4,
        match_note: `${opOf(pid)} มีจุดควบคุม ${cps.length} จุด แต่ไม่มีจุดไหนแตะอาการนี้`,
        proposal: `พิจารณาเพิ่มจุดควบคุมสำหรับ "${symptom.trim().slice(0, 60)}" ที่ ${opOf(pid)}`
          + `\n(จุดที่มีอยู่คุมเรื่องอื่น — อาการนี้จึงไม่มีด่านตรวจของตัวเอง)`,
      }));
      continue;
    }
    for (const c of pool.slice(0, 3)) {
      const why = [];
      if (isLooseFreq(c.frequency)) why.push(`ความถี่ "${c.frequency}" อาจหลวมเกินไป`);
      if (isWeakMethod(c.method)) why.push(`วิธีตรวจเป็น "${c.method}" (ตรวจด้วยสายตา) อาจจับอาการนี้ไม่ได้`);
      if (!why.length && !isCustomer) continue;
      if (isCustomer) why.push('ของหลุดถึงลูกค้า = ด่านตรวจไม่ทำงาน');
      out.push(sug({
        doc_type: 'cp', leg: 'detection', process_id: pid, cp_item_id: c.id,
        confidence: isCustomer ? 0.7 : 0.5,
        match_note: `จุดควบคุม #${c.char_no ?? '—'} ที่ ${opOf(pid)}`,
        proposal: `ทบทวนจุดควบคุม #${c.char_no ?? '—'} "${(c.product_char || c.process_char || '').slice(0, 50)}"\n· ${why.join('\n· ')}`,
      }));
    }
  }
  for (const h of mode.hits) {
    const { it: f, score: s, via } = h;
    out.push(sug({
      doc_type: 'fmea', leg: 'detection', fmea_item_id: f.id, process_id: f.process_id,
      confidence: Math.min(1, s),
      match_note: `อาการตรงกับ failure mode ใน PFMEA (${opOf(f.process_id)})${via === 'group' ? ' · จับจากคำที่ใช้ร่วมกัน' : ''}${dupNote(h)}${more(mode)}`,
      proposal: `ทบทวน Detection ของ "${(f.failure_mode || '').slice(0, 60)}"`
        + (f.detection ? ` — ปัจจุบัน D=${f.detection}` : '')
        + (f.detection_ctrl ? `\nการตรวจที่ระบุไว้: ${String(f.detection_ctrl).slice(0, 120)}` : '\n(ยังไม่ระบุวิธีตรวจ)'),
    }));
  }
  if (symptom.trim() && !mode.hits.length) {
    out.push(sug({
      doc_type: 'fmea', leg: 'detection', confidence: 0,
      match_note: 'ค้นแล้วไม่พบอาการนี้ในเอกสาร',
      proposal: `🔴 อาการ "${symptom.trim().slice(0, 80)}" ไม่มีใน PFMEA ของพาร์ทนี้ — เพิ่ม failure mode ใหม่พร้อมกำหนดการตรวจจับ`,
    }));
  }

  /* ── ขา ③ Systemic (yokoten): พาร์ทอื่นมีอาการเดียวกันไหม ───────────────── */
  if (symptom.trim() && otherFmea.length) {
    const seen = new Set();
    const cross = rankItems(symptom, otherFmea, (f) => f.failure_mode, 40).hits.filter((x) => x.score >= STRONG);
    for (const { it: f, score: s } of cross) {
      if (seen.has(f.set_id)) continue;      // พาร์ทละ 1 ข้อเสนอพอ (ไม่งั้นท่วมจอ)
      seen.add(f.set_id);
      out.push(sug({
        doc_type: 'fmea', leg: 'systemic', fmea_item_id: f.id, process_id: f.process_id,
        set_id: f.set_id, confidence: Math.min(1, s),
        match_note: `พาร์ทอื่น: ${f._setLabel || f.set_id}${f._opNo ? ` · OP ${f._opNo}` : ''}`,
        proposal: `พาร์ทนี้มี failure mode เดียวกัน ("${(f.failure_mode || '').slice(0, 50)}") แต่ยังใช้การควบคุมแบบเดิม`
          + `\n→ พิจารณา deploy มาตรการเดียวกันไปด้วย (yokoten / lessons learned ตาม IATF §10.2.3)`,
      }));
      if (seen.size >= 6) break;
    }
  }

  return out;
}

/** ป้ายกำกับของแต่ละขา (ใช้ทั้งจอ QA และจอ PE — ห้ามนิยามซ้ำ) */
export const LEG_META = {
  occurrence: { label: 'ทำไมถึงเกิด', short: 'Occurrence', color: '#f59e0b', hint: 'แก้ที่สาเหตุ → PFMEA / ผังกระบวนการ' },
  detection: { label: 'ทำไมหลุดออกไป', short: 'Detection', color: '#0891b2', hint: 'แก้ที่ด่านตรวจ → Control Plan / ใบตรวจ' },
  systemic: { label: 'พาร์ทอื่นเป็นด้วยไหม', short: 'Systemic', color: '#7c3aed', hint: 'ขยายผลข้ามพาร์ท (yokoten)' },
};

export const CR_STATUS = {
  proposed: { label: 'รอพิจารณา', color: '#f59e0b' },
  accepted: { label: 'รับเรื่องแล้ว', color: '#4d9fff' },
  applied: { label: 'แก้เอกสารแล้ว', color: '#22c55e' },
  rejected: { label: 'ไม่แก้', color: '#6b7280' },
};

export const DOC_LABEL = { fmea: 'PFMEA', cp: 'Control Plan', pfc: 'ผังกระบวนการ (PFC)' };

/* ── เคลมซ้ำ (repeat claim) ─────────────────────────────────────────────────
   พาร์ทเดิม + อาการคล้ายเดิม ภายใน REPEAT_MONTHS = 8D ครั้งก่อน "ไม่ได้ผลจริง"
   ⚠️ ใช้เกณฑ์ STRONG เท่านั้น — เป็นข้อกล่าวหาที่หนัก เตือนพร่ำเพรื่อแล้วคนจะเลิกสนใจ
   ⚠️ อยู่ที่นี่ (ไม่ใช่ในหน้า) เพราะเป็น logic บริสุทธิ์ที่ต้องเทสได้ และจะถูกใช้ซ้ำ
      ตอนทำการวัด effectiveness อัตโนมัติ (เฟส 4) */
export const REPEAT_MONTHS = 12;

const monthsAgoStr = (n, from = new Date()) => {
  const d = new Date(from);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * หาเคลมเก่าที่ซ้ำกับใบนี้ (ใหม่→เก่า) — แนบ `_score` / `_sure` ไปกับแต่ละใบ
 *
 * ⚠️ **เกณฑ์เดียวแยกไม่ได้ — วัดจริงแล้ว** (ข้อความเคลมจริงแบบไทย):
 *      "นัทไม่มี…" ↔ "นัทหาย 2 ตัว"        = 0.56  ← ซ้ำจริง
 *      "นัทไม่มี…" ↔ "นัทเชื่อมเยื้องศูนย์"  = 0.56  ← **คนละอาการ**
 *    คะแนนเท่ากันเพราะทั้งคู่แมตช์แค่ "กลุ่มคำ" (นัท) · ลดเกณฑ์ = เตือนผิด · ขึ้นเกณฑ์ = พลาดของจริง
 *    → แยกเป็น 2 ระดับตาม `via` แทน:
 *      `both`  (ข้อความ + กลุ่มคำ ตรงกัน) = **ซ้ำแน่** (แดง)
 *      `group` (ตรงแค่กลุ่มคำ)            = **อาจซ้ำ ต้องให้คนดู** (เหลือง)
 *    ห้ามยุบสองระดับนี้เป็นระดับเดียว — เคลมซ้ำเป็นข้อกล่าวหาที่หนัก (แปลว่า 8D ก่อนไม่ได้ผล)
 */
export function findRepeats(claim, all = [], months = REPEAT_MONTHS) {
  if (!claim?.part_no || !claim?.defect_desc) return [];
  const since = monthsAgoStr(months);
  return all
    .filter((c) => c.id !== claim.id && c.part_no === claim.part_no && c.claim_date >= since)
    .map((c) => { const m = matchScore(claim.defect_desc, c.defect_desc); return { ...c, _score: m.score, _sure: m.via === 'both' && m.score >= STRONG }; })
    .filter((c) => c._sure || c._score >= WEAK)
    .sort((a, b) => (b._sure - a._sure) || (a.claim_date < b.claim_date ? 1 : -1));
}

/** เคลมที่ "ซ้ำแน่" เท่านั้น (ใช้กับตัวนับ/แถบเตือนสีแดง) */
export const sureRepeats = (list) => list.filter((c) => c._sure);
