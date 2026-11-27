/* ═══════════════════════════════════════════════════════════════════════════
   🛠️ TPM — กฎกลางของ ① ระดับความสำคัญเครื่อง ② F-Tag ⑤ ปิดวงจรซ่อม (Why-Why)   2026-11-27
   📄 docs/modules/tpm.md · คำสั่ง user "เริ่มข้อ 1+2+5" (ตัดสินใจ 27/11 ดูหัว migration 20261127_tpm_*)

   🔴 ไฟล์นี้เป็นเจ้าของกฎ "เกรดเครื่อง" / "สถานะแท็ก" / "ใบนี้ต้องมี Why-Why ไหม" ที่เดียว —
      จอ /tpm และใบ MO (/mtn-repair) เรียกจากที่นี่ **ห้ามคิดเองในหน้า**
   🔴 เกรดไม่เก็บในฐาน (เก็บแค่คะแนนดิบ `machine_criticality.scores`) ⇒ แก้เกณฑ์แล้วทุกเครื่องตามเอง
   🔴 ข้อมูลไม่ครบ = `grade: null` + เหตุผล — **ห้ามเดาเกรด** (ประเมินไม่ครบ ≠ เกรด C)
   ⚠️ pure ทั้งไฟล์ (ไม่ import supabase) · ฟังก์ชันที่ใช้ "ตอนนี้" รับ `nowMs` เป็นพารามิเตอร์
   ═══════════════════════════════════════════════════════════════════════════ */
import { buildEquipIndex, resolveEquip } from './mtnMetrics.js';

/* ── ① ระดับความสำคัญเครื่อง ───────────────────────────────────────────── */

/** คะแนนรายหัวข้อ 1–3 (ความหมายแต่ละระดับอยู่ในทะเบียน `tpm_crit_factors.guide_1..3`) */
export const CRIT_SCORES = [1, 2, 3];

export const GRADE_META = {
  A: { label: 'A', color: 'var(--red)', hint: 'สำคัญมาก — เสียแล้วกระทบหนัก · ทำ PM/PdM เข้ม · MO ต้องมี Why-Why' },
  B: { label: 'B', color: 'var(--amber)', hint: 'สำคัญปานกลาง — PM ตามแผน' },
  C: { label: 'C', color: 'var(--green)', hint: 'สำคัญน้อย — ซ่อมเมื่อเสียได้' },
};

const validScore = (v) => CRIT_SCORES.includes(Number(v));

/** อ่านเกณฑ์ตัดเกรดจากแถว `tpm_settings` · ไม่มี = null (จอต้องบอก ห้ามใช้ค่าเดา) */
export function critThresholds(settingsRows = []) {
  const get = (k) => {
    const r = (settingsRows || []).find(s => s?.key === k);
    const n = r == null ? NaN : Number(r.value);
    return Number.isFinite(n) ? n : null;
  };
  const a = get('crit_a_min_pct');
  const b = get('crit_b_min_pct');
  if (a == null || b == null || b > a) return null;
  return { aMinPct: a, bMinPct: b };
}

/**
 * คะแนนดิบ → เกรด
 * @param {object} scores   { <factor key>: 1|2|3 }
 * @param {object[]} factors แถว tpm_crit_factors (กรอง is_active ให้เองที่นี่)
 * @param {{aMinPct:number,bMinPct:number}|null} th จาก critThresholds()
 * @returns {{ grade:'A'|'B'|'C'|null, reason:string, pct:number|null, total:number, max:number,
 *             missing:string[], forcedBy:string|null }}
 *   reason: 'ok' | 'forced' | 'incomplete' | 'no_factors' | 'no_thresholds' | 'not_assessed'
 *   pct = คะแนนถ่วงน้ำหนัก ÷ คะแนนเต็ม × 100 (ทุกข้อได้ 1 = 33% · ทุกข้อได้ 3 = 100%)
 */
export function critGrade(scores, factors = [], th = null) {
  const act = (factors || []).filter(f => f && f.is_active !== false);
  const base = { grade: null, pct: null, total: 0, max: 0, missing: [], forcedBy: null };
  if (!act.length) return { ...base, reason: 'no_factors' };
  if (!scores || !Object.keys(scores).length) return { ...base, reason: 'not_assessed', missing: act.map(f => f.key) };
  const missing = act.filter(f => !validScore(scores[f.key])).map(f => f.key);
  if (missing.length) return { ...base, reason: 'incomplete', missing };
  let total = 0, max = 0;
  for (const f of act) {
    const w = Math.max(1, Number(f.weight) || 1);
    total += Number(scores[f.key]) * w;
    max += 3 * w;
  }
  const pct = max ? Math.round((total / max) * 1000) / 10 : null;
  const forced = act.find(f => f.force_a && Number(scores[f.key]) === 3);
  if (forced) return { ...base, grade: 'A', reason: 'forced', pct, total, max, forcedBy: forced.key };
  if (!th) return { ...base, reason: 'no_thresholds', pct, total, max };
  const grade = pct >= th.aMinPct ? 'A' : pct >= th.bMinPct ? 'B' : 'C';
  return { ...base, grade, reason: 'ok', pct, total, max };
}

/** ข้อความอธิบายเกรด (ทำไมได้เกรดนี้ / ทำไมยังไม่มีเกรด) — ให้จอใช้ตัวเดียวกันทุกที่ */
export function critReasonText(res, factors = []) {
  const name = (k) => (factors.find(f => f.key === k)?.label) || k;
  switch (res?.reason) {
    case 'forced': return `เกรด A ทันที เพราะ "${name(res.forcedBy)}" ได้ 3 คะแนน`;
    case 'ok': return `คะแนน ${res.total}/${res.max} (${res.pct}%)`;
    case 'incomplete': return `ยังให้คะแนนไม่ครบ ${res.missing.length} ข้อ: ${res.missing.map(name).join(', ')}`;
    case 'not_assessed': return 'ยังไม่ได้ประเมิน';
    case 'no_factors': return 'ยังไม่มีหัวข้อให้คะแนน (ตั้งที่แท็บ "เกณฑ์")';
    case 'no_thresholds': return 'อ่านเกณฑ์ตัดเกรดไม่ได้ — ตั้งค่า % ของเกรด A/B ที่แท็บ "เกณฑ์"';
    default: return '';
  }
}

/**
 * เกรดของ "เลขเครื่องที่คนกรอก" (เช่น `mtn_orders.machine_no`) — จับคู่ทะเบียนด้วย `resolveEquip()` ตัวกลาง
 * @returns {{ machine:object|null, res:object|null }}  ไม่เจอเครื่อง/ไม่เคยประเมิน = res.grade null
 */
export function gradeForMachineNo(machineNo, { machines = [], critRows = [], factors = [], th = null, index = null } = {}) {
  const idx = index || buildEquipIndex(machines);
  const { machine } = resolveEquip(machineNo, idx);
  if (!machine) return { machine: null, res: null };
  const row = (critRows || []).find(r => r?.machine_id === machine.id);
  return { machine, res: critGrade(row?.scores || null, factors, th) };
}

/* ── ② F-Tag ─────────────────────────────────────────────────────────── */

export const FTAG_COLORS = {
  red:   { label: 'แท็กแดง', color: 'var(--red)',  hint: 'ต้องใช้ช่าง — เปิดใบซ่อม MO' },
  white: { label: 'แท็กขาว', color: 'var(--text2)', hint: 'ผู้ปฏิบัติงานแก้เองได้ — ปิดในแท็ก' },
};

/** สถานะที่จอแสดง (คำนวณจากแท็ก + ใบ MO ที่ผูก) — `open` ของคำถาม "ยังค้างไหม" คือ OPEN_STATES */
export const FTAG_STATE_META = {
  open:        { label: 'เปิดอยู่',            color: 'var(--amber)' },
  in_repair:   { label: 'อยู่ในใบซ่อม',         color: 'var(--blue)' },
  mo_dropped:  { label: 'ใบซ่อมถูกยกเลิก/ตีกลับ', color: 'var(--red)' },
  mo_unknown:  { label: 'อ่านใบซ่อมไม่ได้',      color: 'var(--muted)' },
  closed:      { label: 'ปิดแล้ว',             color: 'var(--green)' },
  closed_by_mo:{ label: 'ปิดแล้ว (ใบซ่อมปิด)',   color: 'var(--green)' },
  cancelled:   { label: 'ยกเลิก',              color: 'var(--muted)' },
};
export const FTAG_OPEN_STATES = ['open', 'in_repair', 'mo_dropped', 'mo_unknown'];

/** สถานะ MO ที่ถือว่า "ไม่ได้ซ่อมต่อแล้ว" — แท็กกลับมาค้างให้คนตัดสินใจ (เปิดใบใหม่/ปิดพร้อมเหตุผล) */
const MO_DROPPED = ['cancelled', 'rejected'];

/**
 * @param {object} tag แถว tpm_ftags
 * @param {object|null|undefined} mo แถว mtn_orders ที่ `tag.mo_id` ชี้ (undefined = ยังไม่โหลด/อ่านไม่ได้)
 */
export function ftagState(tag, mo) {
  if (!tag) return null;
  if (tag.status === 'cancelled') return 'cancelled';
  if (tag.status === 'closed') return 'closed';
  if (tag.status === 'mo') {
    if (!mo) return 'mo_unknown';
    if (mo.status === 'closed') return 'closed_by_mo';
    if (MO_DROPPED.includes(mo.status)) return 'mo_dropped';
    return 'in_repair';
  }
  return 'open';
}

/** อายุแท็ก (วัน · ปัดลง) นับจากวันที่พบ ถึงวันปิด/ตอนนี้ */
export function ftagAgeDays(tag, nowMs, mo = null) {
  const start = Date.parse(tag?.found_at);
  if (!Number.isFinite(start)) return null;
  const endIso = tag?.closed_at || (mo?.status === 'closed' ? (mo.cost_mgr_at || mo.approve_at) : null);
  const end = endIso ? Date.parse(endIso) : nowMs;
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 86400000));
}

/**
 * ทำอะไรกับแท็กนี้ได้บ้าง (ตามสถานะ · ไม่รวมสิทธิ์ — สิทธิ์ใช้ can() + writeScope ที่จอ)
 * 🔴 แท็กแดงปิดเองไม่ได้ ต้องผ่าน MO (หรือเปลี่ยนเป็นขาวถ้าติดผิดสี) · แท็กขาวเปิด MO ไม่ได้ (เปลี่ยนเป็นแดงก่อน)
 */
export function ftagActions(tag, state) {
  const open = state === 'open';
  return {
    toMo: tag?.color === 'red' && (open || state === 'mo_dropped'),
    close: (tag?.color === 'white' && open) || state === 'mo_dropped',
    cancel: open || state === 'mo_dropped',
    recolor: open,
  };
}

export const FTAG_NOTE_MIN = 5;   // เหตุผลปิด/ยกเลิก ต้องเป็นประโยค ไม่ใช่ "ok" (แบบเดียวกับเหตุผลไม่เปิด MO ของ AM)
export const noteOk = (s) => String(s ?? '').trim().length >= FTAG_NOTE_MIN;

/* ── ⑤ ปิดวงจรซ่อม — Why-Why ในใบ MO ───────────────────────────────────── */

export const PREVENT_ACTIONS = [
  { key: 'pm_plan', label: 'เพิ่ม/แก้แผน PM หรือจุดตรวจ AM' },
  { key: 'opl',     label: 'ทำ OPL / สอนวิธีใหม่' },
  { key: 'design',  label: 'แก้ไขเครื่อง / Kaizen ถาวร' },
  { key: 'none',    label: 'ไม่ต้องทำเพิ่ม (ระบุเหตุผล)' },
];
export const preventLabel = (k) => PREVENT_ACTIONS.find(p => p.key === k)?.label || k || '';

/** ถาม "ทำไม" อย่างน้อยกี่ชั้น — 3 = ผ่านอาการไปถึงกลไก (ชั้นเดียวมักได้แค่อาการซ้ำ) · เพดาน 5 ตามแบบ 5-Why */
export const WHY_MIN = 3;
export const WHY_MAX = 5;

export const whyList = (v) => (Array.isArray(v) ? v : []).map(s => String(s ?? '').trim());

/**
 * ใบนี้ยังขาดอะไรบ้างสำหรับ Why-Why — คืนลิสต์ข้อความ (ว่าง = ครบ)
 * @param {object} mo หรือฟอร์มที่มี failure_mode / why_why / prevent_action / prevent_note
 */
export function whyWhyMissing(mo) {
  const miss = [];
  if (!String(mo?.failure_mode ?? '').trim()) miss.push('อาการเสีย (failure mode)');
  const n = whyList(mo?.why_why).filter(Boolean).length;
  if (n < WHY_MIN) miss.push(`ทำไม-ทำไม อย่างน้อย ${WHY_MIN} ชั้น (มี ${n})`);
  if (!PREVENT_ACTIONS.some(p => p.key === mo?.prevent_action)) miss.push('การป้องกันเกิดซ้ำ');
  else if (mo.prevent_action === 'none' ? !noteOk(mo?.prevent_note) : !String(mo?.prevent_note ?? '').trim())
    miss.push(mo.prevent_action === 'none' ? 'เหตุผลที่ไม่ต้องป้องกันเพิ่ม' : 'รายละเอียดการป้องกัน');
  return miss;
}

/**
 * ด่านปิดใบ MO — บังคับ Why-Why เฉพาะเครื่องเกรด A (ตัดสินใจกับ user 27/11)
 * 🔴 ไม่รู้เกรด (เครื่องไม่อยู่ในทะเบียน / ยังไม่ประเมิน / อ่านทะเบียนไม่ได้) = **ไม่บังคับ** แต่จอต้องบอกเหตุผล
 *    (บังคับทั้งที่ไม่รู้ = ใบซ่อมทั้งโรงงานปิดไม่ได้ ซึ่งเป็นงานหลักกว่า)
 * @returns {{ required:boolean, ok:boolean, missing:string[], why:string }}
 */
export function closeGate({ gradeRes = null, mo = null, critLoadFailed = false } = {}) {
  if (critLoadFailed) return { required: false, ok: true, missing: [], why: 'อ่านทะเบียนเกรดเครื่องไม่ได้ — ไม่บังคับ Why-Why รอบนี้' };
  if (!gradeRes) return { required: false, ok: true, missing: [], why: 'เครื่องของใบนี้ไม่อยู่ในทะเบียน — ไม่รู้เกรด' };
  if (gradeRes.grade !== 'A') {
    return { required: false, ok: true, missing: [],
      why: gradeRes.grade ? `เครื่องเกรด ${gradeRes.grade} — ไม่บังคับ` : 'เครื่องยังไม่มีเกรด — ไม่บังคับ' };
  }
  const missing = whyWhyMissing(mo);
  return { required: true, ok: missing.length === 0, missing, why: 'เครื่องเกรด A — ต้องมี Why-Why ก่อนปิดใบ' };
}
