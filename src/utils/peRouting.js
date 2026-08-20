/**
 * peRouting — เสนอ routing (part_routings) จากรายการ OP ของ PFC ใน /pe-docs
 * (คำขอ user 2026-08-20 หลัง audit: FG 44 ตัวยังไม่มี routing เลย แต่ PFC ลงละเอียดถึง OP แล้ว
 *  — เส้นทางลงข้อมูลที่เร็วสุดคือแปลง PFC → routing แล้วให้คนยืนยัน)
 *
 * ⚠️ กฎเหล็ก: ระบบ "เสนอ" เท่านั้น — insert ลง part_routings ได้ต่อเมื่อคนตรวจ/ติ๊ก/กดยืนยัน
 *    (หลักเดียวกับ AI intake + missingLinksFromRouting ใน CLAUDE.md)
 *
 * pure ไม่ import supabase/react — เทสได้ด้วย node:test · การเขียน DB อยู่ที่
 * components/PeRoutingSuggest.jsx (ฝั่ง DR — part_routings อยู่ใน DR_AUDIT_TABLES แล้ว)
 *
 * import ต้องมีนามสกุล .js (node ESM ใช้ resolve แบบเต็ม — bundler ไม่สน แต่ node:test พังถ้าไม่มี)
 */
import { normPart } from './peLink.js';

/** kind ของ pe_processes ที่กลายเป็น "กล่องกระบวนการ" บนใบ VSM */
export const ROUTE_KINDS = new Set(['process', 'inspection']);

/**
 * แปลงรายการ OP ของ PFC → ร่างขั้น routing
 * กติกา map (ถอดจากความหมายของ kind ในฟอร์ม PFC จริง):
 *  · process / inspection  → ขั้น routing (คนติ๊กออกได้ — inspection บางใบไม่ต้องเป็นกล่องแยก)
 *  · storage               → "จุดพัก" หลังขั้นก่อนหน้า (wip_label) ไม่ใช่กล่องของตัวเอง
 *  · incoming_insp         → ฝั่งทางเข้า child part (supplier side ของ VSM) — ข้าม
 *  · transport / rework / warehouse / delivery → ไม่ใช่ขั้นผลิตบนสาย — ข้าม
 * ทุกตัวที่ข้ามถูกรายงานใน `skipped` — ห้ามตัดเงียบ (กฎ CLAUDE.md)
 *
 * @param {array} procs แถว pe_processes ของชุดเอกสาร
 * @returns { steps: [{op_no,name,kind,line_name,machine_no,wip_label,include}], skipped: [{op_no,name,kind,reason}] }
 */
export function proposeRoutingFromPfc(procs = []) {
  const sorted = [...procs].sort((a, b) =>
    ((Number(a.seq) || 0) - (Number(b.seq) || 0))
    || String(a.op_no || '').localeCompare(String(b.op_no || ''), undefined, { numeric: true }));
  const steps = [], skipped = [];
  for (const p of sorted) {
    const kind = p.kind || 'process';
    if (ROUTE_KINDS.has(kind)) {
      steps.push({
        op_no: p.op_no, name: p.name || `OP ${p.op_no}`, kind,
        line_name: p.line_name || null, machine_no: p.machine_no || null,
        wip_label: null, include: true,
      });
    } else if (kind === 'storage') {
      const last = steps[steps.length - 1];
      if (last) {
        if (!last.wip_label) last.wip_label = p.name || 'Store';
        skipped.push({ op_no: p.op_no, name: p.name, kind, reason: 'wip', target: last.op_no });
      } else {
        // storage ก่อนขั้นแรก = คลังวัตถุดิบ (ฝั่ง supplier ของ VSM มีอยู่แล้ว) — ไม่มีขั้นให้เกาะ
        skipped.push({ op_no: p.op_no, name: p.name, kind, reason: 'storage_no_prev' });
      }
    } else {
      skipped.push({ op_no: p.op_no, name: p.name, kind, reason: kind });
    }
  }
  return { steps, skipped };
}

/**
 * หาเลข MAT SAP ของชุดเอกสาร — ใช้ผูก routing เข้ากับข้อมูลผลิต
 * ลำดับ: pe_doc_sets.mat_no (ผูกตรง) → เทียบ part_no กับ dr_products.p_no แบบ normalize
 * กำกวมหลายตัว = ไม่เลือกให้ (ห้ามเดา — master p_no ยังไม่ unique จริง ดูกฎ matResolve)
 */
export function resolveMatForSet(set, products = []) {
  if (set?.mat_no) {
    const product = products.find(p => p.mat_no === set.mat_no) || null;
    return { matNo: set.mat_no, how: 'set_mat', product };
  }
  const p = normPart(set?.part_no);
  if (!p) return { matNo: null, how: 'none', product: null };
  const hits = products.filter(x => x.p_no && normPart(x.p_no) === p);
  if (hits.length === 1) return { matNo: hits[0].mat_no, how: 'p_no', product: hits[0] };
  if (hits.length > 1) return { matNo: null, how: 'ambiguous', product: null, candidates: hits };
  return { matNo: null, how: 'none', product: null };
}

/**
 * แปลงขั้นที่คนติ๊กไว้ → แถว insert ของ part_routings (renumber seq 1..n เฉพาะที่ติ๊ก)
 * ค่า ct/setup/lot/operators ไม่ใส่ = null = "ให้ระบบไปหาจากข้อมูลจริง" (กติกาของตาราง)
 */
export function toRoutingRows(matNo, steps = []) {
  return steps.filter(s => s.include).map((s, i) => ({
    mat_no: matNo,
    seq: i + 1,
    step_name: s.name,
    line_name: s.line_name || null,
    machine_no: s.machine_no || null,
    process_type: null,
    is_outsourced: false,
    wip_label: s.wip_label || null,
    note: s.op_no ? `จาก PFC OP ${s.op_no}` : 'จาก PFC',
    is_active: true,
  }));
}
