/* ═══════════════════════════════════════════════════════════════════════════
   🧭 3 ระดับการบำรุงรักษา — Preventive → Predictive → Prescriptive      2026-09-23

   คำสั่ง user: "เรื่อง preventive - predictive - prescriptive maintenance" → เลือก
   "ทำจอ 3 ระดับ" (อ่านอย่างเดียว ไม่แตะแผนเดิม) · จอ = `src/pages/MaintenanceLevels.jsx`
   (แท็บ 🧭 ใน /pm) · roadmap เดิม = `docs/PM_PLAN_STRATEGY.md`

   ต่อ 1 อุปกรณ์ ตอบ 3 คำถาม:
     1) PREVENTIVE   "แผนบอกว่าถึงเวลาหรือยัง"      ← pm_plans / checklists / inspections
     2) PREDICTIVE   "ข้อมูลจริงบอกว่ากำลังแย่ลงไหม" ← downtime_logs (เสียจริง) เทียบ 2 ช่วงเวลา
     3) PRESCRIPTIVE "ควรทำอะไร ภายในเมื่อไหร่ เพราะอะไร" ← กฎที่อ่านออก (RULES ข้างล่าง)

   ── ทำไม Predictive มาจาก downtime ไม่ใช่ SPC/ยอดผลิต (วัดฐานจริง 23/09) ──────────
   · ผลวัดค่า (inspection_results.avg_value) = **0 แถว** ⇒ condition-based ยังทำไม่ได้
   · แผน usage = 0/142 (ทุกแผนเป็นเวลา) · prod_orders.machine_no กรอก 3.8%
   · downtime ที่ระบุเครื่อง = 8,216 แถว (ทะเบียนจับคู่ได้ ~86%) ⇒ มีจริงและพอ
   ⇒ ใช้ **อัตราเสียต่อชั่วโมงเดินเครื่อง** (reliability-based predictive) ก่อน
     สูตร MTBF/MTTR/ชั่วโมงเดิน **ใช้ `machineReliability()` ใน mtnMetrics.js เท่านั้น** — ห้ามคิดซ้ำที่นี่
     (มันหักพักตามนโยบาย · ยุบกะคู่ขนาน · ไม่นับ planned เป็น failure · รวมเครื่องที่ไม่เคยเสีย แล้ว)

   ── ความซื่อสัตย์ของจอ (กฎ OBEYA/ENGINEERING-PRINCIPLES) ─────────────────────
   · ทุกตัวเลขที่คำนวณไม่ได้ = **null ไม่ใช่ 0** · ทุกคำแนะนำต้องมี "เพราะอะไร" เป็นตัวเลขจริง
   · นี่คือ **กฎที่อ่านออก ไม่ใช่ ML** — "คาดเสียครั้งถัดไป" = ค่าเฉลี่ยทางสถิติ (MTBF) ไม่ใช่คำทำนายแม่น
   · **ห้ามเขียนผลกลับฐาน** (ห้ามให้ระบบเลื่อนแผน PM เอง — การตัดสินใจเป็นของช่าง ENGINEERING §2)

   ⚠️ pure ทั้งไฟล์ (ไม่ import supabase) · ทุกฟังก์ชันที่เกี่ยวกับ "วันนี้" รับ todayStr/nowMs
   ═══════════════════════════════════════════════════════════════════════════ */
import { machineReliability, normEquipKey, resolveEquip, buildEquipIndex } from './mtnMetrics.js';
import { resolvePlanDue, ymdBangkok, STATUS_META } from '../lib/pmSchedule.js';

/** หน้าต่างเปรียบเทียบ: 30 วันล่าสุด vs 60 วันก่อนหน้า (รวม 90 = เท่ากับที่ downtime มีข้อมูลสม่ำเสมอ
 *  เริ่ม 19/06) · ช่วงก่อนยาวกว่า 2 เท่าเพื่อให้ฐานนิ่ง ไม่แกว่งตามเดือนเดียว — เทียบกันด้วย "ต่อชั่วโมงเดิน" */
export const WINDOW = { recentDays: 30, baseDays: 60 };

/** เกณฑ์ตัดสิน — ที่มาแต่ละตัว:
 *  minStops 3   : ต่ำกว่า 3 ครั้ง "เสียบ่อยขึ้น 2 เท่า" = 1→2 ครั้ง ซึ่งเป็นเรื่องบังเอิญได้
 *  worseRatio 1.5 / betterRatio 0.5 : ขยับ ≥50% ต่อชั่วโมงเดิน จึงนับว่าเปลี่ยนจริง
 *  repeatShare 0.5 : สาเหตุเดียวกิน ≥ครึ่งของการเสีย = ปัญหาเรื้อรัง ไม่ใช่สุ่ม
 *  waitShare 0.5   : เวลารอช่าง ≥ครึ่งของเวลาหยุด = คอขวดอยู่ที่การตอบสนอง ไม่ใช่ตัวเครื่อง
 *  soonDays 7      : เท่ากับ lead time ขั้นต่ำที่ planner ต้องใช้กันของ (pm-forecast lead 10 วัน)
 *  quietMinRunH 40 : "ไม่เสียเลย 90 วัน" ต้องเดินจริง ≥40 ชม. ไม่งั้นแปลว่าแค่ไม่ได้ใช้ */
export const THRESH = {
  minStops: 3, worseRatio: 1.5, betterRatio: 0.5,
  repeatShare: 0.5, waitShare: 0.5, soonDays: 7, quietMinRunH: 40,
};

/** รอบ PM ที่แนะนำเป็นจุดตั้งต้น — เลือกค่าที่ ≤ ครึ่งของ MTBF ตามปฏิทิน (PM ต้องมาก่อนเสีย) */
export const SUGGEST_CYCLES = [7, 14, 30, 60, 90];

export const PRIORITY = {
  1: { key: 1, label: 'ด่วน',          color: '#ef4444', hint: 'ทำภายในวันนี้-พรุ่งนี้' },
  2: { key: 2, label: 'ภายในสัปดาห์', color: '#f59a3f', hint: 'ก่อนเสี่ยงเสียครั้งถัดไป' },
  3: { key: 3, label: 'ปรับปรุง',      color: '#4a90e0', hint: 'ลดการเสียระยะยาว / ลดงานที่ไม่จำเป็น' },
};

export const TREND_META = {
  worse:  { label: 'แย่ลง',        icon: '▲', color: '#ef4444' },
  new:    { label: 'เริ่มเสียใหม่', icon: '▲', color: '#ef4444' },
  stable: { label: 'ทรงตัว',       icon: '■', color: '#9aa3a0' },
  better: { label: 'ดีขึ้น',        icon: '▼', color: '#3dd65c' },
  quiet:  { label: 'ไม่เสียเลย',    icon: '●', color: '#3dd65c' },
  nodata: { label: 'ไม่รู้ชั่วโมงเดิน', icon: '?', color: '#9aa3a0' },
};

const DAY_MS = 86400000;
const addYmd = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
};
/** วันทำงาน (ตัด 08:00 ไทย) ของ timestamp — เหมือน getWorkDate แต่ pure ไม่พึ่ง timezone เครื่อง */
export const workYmdOf = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? null : ymdBangkok(new Date(t - 8 * 3600000).toISOString());
};

/**
 * แบ่ง downtime/กะ ออกเป็น 2 ช่วง ด้วย "วันทำงาน" (ไม่ใช่วันปฏิทิน — กะดึกหลังเที่ยงคืนเป็นของวันก่อน)
 * recent = [today-(recentDays-1) … today] · base = [recentFrom-baseDays … recentFrom-1]
 */
export function splitWindows({ downtimes = [], sessions = [], todayStr, w = WINDOW }) {
  const recentFrom = addYmd(todayStr, -(w.recentDays - 1));
  const baseFrom = addYmd(recentFrom, -w.baseDays);
  const bucket = (ymd) => (!ymd || ymd > todayStr || ymd < baseFrom ? null : ymd >= recentFrom ? 'recent' : 'base');
  const out = { recent: { downtimes: [], sessions: [] }, base: { downtimes: [], sessions: [] }, recentFrom, baseFrom };
  for (const d of downtimes) { const b = bucket(workYmdOf(d?.started_at)); if (b) out[b].downtimes.push(d); }
  for (const s of sessions) { const b = bucket(s?.work_date ? String(s.work_date).slice(0, 10) : null); if (b) out[b].sessions.push(s); }
  return out;
}

/** อัตราเสีย ต่อ 100 ชั่วโมงเดินเครื่อง · ไม่รู้ชั่วโมงเดิน/เดิน 0 = null (ห้ามเป็น 0) */
export const ratePer100h = (stops, upMin) => (upMin > 0 ? (stops / (upMin / 60)) * 100 : null);

/**
 * สัญญาณ Predictive ของอุปกรณ์ 1 ตัว
 * @param rec  แถว machineReliability ของช่วงล่าสุด (หรือ null = ไม่มีข้อมูลช่วงนี้)
 * @param base แถวของช่วงก่อน (หรือ null)
 */
export function predictiveOf(rec, base, { nowMs, w = WINDOW, t = THRESH } = {}) {
  const stopsR = rec?.stops ?? 0, stopsB = base?.stops ?? 0;
  const rateR = ratePer100h(stopsR, rec?.upMin ?? null);
  const rateB = ratePer100h(stopsB, base?.upMin ?? null);
  const ratio = rateR != null && rateB > 0 ? rateR / rateB : null;
  let trend;
  if (rateR == null) trend = 'nodata';
  else if (stopsR === 0 && stopsB === 0) trend = 'quiet';
  else if (stopsB === 0 && stopsR >= t.minStops && rateB != null) trend = 'new';
  else if (ratio != null && ratio >= t.worseRatio && stopsR >= t.minStops) trend = 'worse';
  else if (ratio != null && ratio <= t.betterRatio && stopsB >= t.minStops) trend = 'better';
  else trend = 'stable';

  // นาทีเดินเครื่องต่อ "วันปฏิทิน" — แปลง MTBF (นาทีเดิน) กลับเป็นจำนวนวันจริง
  const opPerDay = rec?.opMin > 0 ? rec.opMin / w.recentDays : null;
  const mtbfMin = rec?.mtbfMin ?? null;
  const mtbfDays = mtbfMin != null && opPerDay ? mtbfMin / opPerDay : null;
  // คาดเสียครั้งถัดไป = เสียล่าสุด + MTBF (ต้องมี ≥2 ครั้งในช่วง ไม่งั้นค่าเฉลี่ยจากครั้งเดียวไม่มีความหมาย)
  let etaMs = null, etaDays = null;
  if (stopsR >= 2 && mtbfDays != null && rec?.lastAt) {
    etaMs = rec.lastAt + mtbfDays * DAY_MS;
    etaDays = nowMs != null ? Math.floor((etaMs - nowMs) / DAY_MS) : null;
  }
  // ความเสี่ยง 30 วัน = คาดจำนวนครั้ง × MTTR (นาที) — ใช้จัดลำดับว่าอะไรคุ้มทำก่อน
  const mttr = rec?.mttrMin ?? base?.mttrMin ?? null;
  const expStops30 = rateR != null && opPerDay ? (rateR / 100 / 60) * opPerDay * 30 : null;
  const riskMin30 = expStops30 != null && mttr != null ? Math.round(expStops30 * mttr) : null;

  // สัดส่วนเวลารอช่าง (ช่วงย่อย) — วัดได้เฉพาะครั้งที่กดครบทุกจังหวะ
  const phaseTot = rec && rec.phaseN > 0 && rec.mttaMin != null
    ? (rec.mttaMin || 0) + (rec.mttrPureMin || 0) + (rec.restartMin || 0) : null;
  const waitShare = phaseTot > 0 ? rec.mttaMin / phaseTot : null;

  return {
    stopsR, stopsB, rateR, rateB, ratio, trend,
    upHoursR: rec?.upMin != null ? rec.upMin / 60 : null,
    upHoursB: base?.upMin != null ? base.upMin / 60 : null,
    mtbfMin, mtbfDays, mttrMin: mttr, dtMinR: rec?.dtMin ?? 0,
    etaMs, etaDays, riskMin30,
    topCause: rec?.topCause || null, topCauseN: rec?.topCauseN || 0,
    waitShare, phaseN: rec?.phaseN || 0, mttaMin: rec?.mttaMin ?? null,
    lastAt: rec?.lastAt || null,
  };
}

/** รอบ PM เริ่มต้นที่แนะนำ — ค่ามากสุดใน SUGGEST_CYCLES ที่ ≤ ครึ่ง MTBF(วัน) · MTBF สั้นกว่า 14 วัน = 7 */
export function suggestCycleDays(mtbfDays) {
  if (!(mtbfDays > 0)) return null;
  const half = mtbfDays / 2;
  let pick = SUGGEST_CYCLES[0];
  for (const c of SUGGEST_CYCLES) if (c <= half) pick = c;
  return pick;
}

/** สรุป Preventive ต่ออุปกรณ์ (อุปกรณ์ 1 ตัวมีได้หลายใบตรวจ — เอาสถานะที่แย่สุด) */
export function preventiveOf(checks = []) {
  if (!checks.length) return { hasPlan: false, hasCycle: false, status: 'none', dueYmd: null, daysTo: null, n: 0, checks };
  const ord = (s) => STATUS_META[s]?.order ?? 9;
  const worst = [...checks].sort((a, b) => ord(a.status) - ord(b.status)
    || (a.daysTo ?? 1e9) - (b.daysTo ?? 1e9))[0];
  const withDue = checks.filter(c => c.dueYmd).sort((a, b) => a.dueYmd.localeCompare(b.dueYmd));
  return {
    hasPlan: true,
    hasCycle: checks.some(c => c.hasCycle),
    status: worst.status,
    dueYmd: withDue[0]?.dueYmd || null,
    daysTo: withDue[0]?.daysTo ?? null,
    lastYmd: checks.map(c => c.lastYmd).filter(Boolean).sort().pop() || null,
    n: checks.length, checks,
  };
}

const fmtN = (n, d = 1) => (n == null ? '—' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: d }));
const fmtYmd = (ymd) => {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('th-TH', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};
const trendWhy = (pd) => (pd.trend === 'new'
  ? `ช่วงก่อนไม่เสียเลย · 30 วันล่าสุดเสีย ${pd.stopsR} ครั้ง`
  : `เสีย ${pd.stopsR} ครั้ง/30 วัน = ${fmtN(pd.rateR)} ครั้งต่อ 100 ชม.เดิน`
    + (pd.ratio != null ? ` (${fmtN(pd.ratio)} เท่าของช่วงก่อน)` : ''));

/* ═══ กฎ Prescriptive — เพิ่มกฎใหม่ = เพิ่ม 1 entry (ENGINEERING §4) ═══════════════════════
   แต่ละกฎ: when(ctx) → true/false · make(ctx) → { priority, action, why, byYmd, link, linkLabel }
   ctx = { e (อุปกรณ์), pv (preventive), pd (predictive), todayStr, t }
   ⚠️ why ต้องเป็นตัวเลขจริงจากข้อมูล — คำแนะนำที่ไม่บอกเหตุผล คนหน้างานไม่เชื่อ (และไม่ควรเชื่อ) */
export const RULES = [
  {
    key: 'pm_overdue',
    when: ({ pv }) => pv.status === 'overdue',
    make: ({ pv, todayStr }) => ({
      priority: 1, action: 'ทำ PM ที่เลยกำหนด',
      why: `แผน PM ครบกำหนด ${fmtYmd(pv.dueYmd)} — เลยมา ${Math.abs(pv.daysTo ?? 0)} วัน`,
      byYmd: todayStr, link: '/pm?tab=plan', linkLabel: 'แผน PM',
    }),
  },
  {
    // ข้อมูลจริงบอกว่าจะเสียก่อนถึงรอบ PM ⇒ ดึง PM เข้ามา (หัวใจของ predictive → prescriptive)
    key: 'pull_in',
    when: ({ pv, pd, t }) => pv.dueYmd && pv.status !== 'overdue'
      && (pd.trend === 'worse' || pd.trend === 'new' || (pd.etaDays != null && pd.etaDays <= t.soonDays))
      && pd.etaMs != null && ymdBangkok(new Date(pd.etaMs).toISOString()) < pv.dueYmd,
    make: ({ pv, pd, todayStr }) => {
      const eta = ymdBangkok(new Date(pd.etaMs).toISOString());
      const by = eta < todayStr ? todayStr : eta;
      return {
        priority: pd.etaDays != null && pd.etaDays <= 3 ? 1 : 2,
        action: 'ดึง PM ขึ้นมาทำก่อนรอบ',
        why: `${trendWhy(pd)} · คาดเสียครั้งถัดไป ~${fmtYmd(eta)} แต่ PM รอบถัดไป ${fmtYmd(pv.dueYmd)}`,
        byYmd: by, link: '/pm?tab=coord', linkLabel: 'นัด PM',
      };
    },
  },
  {
    key: 'need_cycle',
    when: ({ pv, pd, t }) => !pv.hasCycle && pd.stopsR >= t.minStops,
    make: ({ pv, pd, todayStr }) => {
      const c = suggestCycleDays(pd.mtbfDays);
      return {
        priority: pd.trend === 'worse' || pd.trend === 'new' ? 2 : 3,
        action: pv.hasPlan ? 'ตั้งรอบให้แผน PM (ตอนนี้ไม่มีรอบ)' : 'สร้างแผน PM ให้อุปกรณ์นี้',
        why: `${trendWhy(pd)} · ${pv.hasPlan ? 'แผนเดิมเป็น "ตามรอบ" ไม่มีวันครบกำหนด' : 'ยังไม่มีแผน PM เลย'}`
          + (c ? ` · จุดตั้งต้นที่แนะนำ: ทุก ${c} วัน (≈ครึ่งของ MTBF ${fmtN(pd.mtbfDays, 0)} วัน)` : ''),
        byYmd: addYmd(todayStr, 7), link: '/pm?tab=setup', linkLabel: 'ตั้งค่า PM',
      };
    },
  },
  {
    key: 'first_check',
    when: ({ pv }) => pv.status === 'never',
    make: ({ todayStr }) => ({
      priority: 2, action: 'เริ่มตรวจ PM รอบแรก',
      why: 'มีแผนแบบมีรอบ แต่ยังไม่เคยบันทึกผลตรวจ — ระบบนับรอบถัดไปไม่ได้จนกว่าจะตรวจครั้งแรก',
      byYmd: addYmd(todayStr, 7), link: '/pm?tab=check', linkLabel: 'ตรวจอุปกรณ์',
    }),
  },
  {
    key: 'root_cause',
    when: ({ pd, t }) => pd.topCause && pd.topCauseN >= t.minStops && pd.stopsR > 0
      && pd.topCauseN / pd.stopsR >= t.repeatShare,
    make: ({ pd, todayStr }) => ({
      priority: pd.trend === 'worse' || pd.trend === 'new' ? 2 : 3,
      action: `หาต้นเหตุ "${pd.topCause}"`,
      why: `อาการเดิมซ้ำ ${pd.topCauseN} จาก ${pd.stopsR} ครั้ง (${Math.round((pd.topCauseN / pd.stopsR) * 100)}%) ใน 30 วัน — PM ตามรอบแก้ปัญหาเรื้อรังไม่ได้ ต้องแก้ที่ต้นเหตุ`,
      byYmd: addYmd(todayStr, 14), link: '/mtn-analysis?tab=qc7', linkLabel: 'QC 7 Tools',
    }),
  },
  {
    key: 'slow_response',
    when: ({ pd, t }) => pd.waitShare != null && pd.phaseN >= t.minStops && pd.waitShare >= t.waitShare,
    make: ({ pd, todayStr }) => ({
      priority: 3, action: 'ลดเวลารอช่าง',
      why: `เวลาหยุดเฉลี่ยเป็น "รอช่างรับงาน" ${Math.round(pd.waitShare * 100)}% (≈${fmtN(pd.mttaMin, 0)} นาที/ครั้ง จาก ${pd.phaseN} ครั้งที่วัดได้) — คอขวดอยู่ที่การตอบสนอง ไม่ใช่ตัวเครื่อง`,
      byYmd: addYmd(todayStr, 30), link: '/mtn-analysis?tab=kpi', linkLabel: 'KPI ช่าง',
    }),
  },
  {
    // ด้านกลับของ prescriptive: ลดงาน PM ที่ไม่ได้ช่วยอะไร (ยืดรอบ) — ต้องเดินจริงพอ ไม่ใช่แค่ไม่ได้ใช้
    key: 'extend_cycle',
    when: ({ pv, pd, t }) => pv.hasCycle && ['ok', 'due_soon'].includes(pv.status) && pd.trend === 'quiet'
      && pd.stopsB === 0 && (pd.upHoursR ?? 0) + (pd.upHoursB ?? 0) >= t.quietMinRunH,
    make: ({ pd, todayStr }) => ({
      priority: 3, action: 'พิจารณายืดรอบ PM',
      why: `ไม่เสียเลย 90 วัน ทั้งที่เดินเครื่อง ${fmtN((pd.upHoursR ?? 0) + (pd.upHoursB ?? 0), 0)} ชม. — รอบปัจจุบันอาจถี่เกินจำเป็น (ให้ช่างตัดสินจากสภาพจริงก่อน)`,
      byYmd: addYmd(todayStr, 30), link: '/pm?tab=setup', linkLabel: 'ตั้งค่า PM',
    }),
  },
];

/**
 * ประกอบทั้งจอ — ผู้เรียกโหลดข้อมูลดิบมาให้ (จอ MaintenanceLevels)
 * @param p.checklists  checklists (module mtn) { id, equipment_id, frequency, name, department }
 * @param p.jigs        jigs ที่ checklist ชี้ { id, name, machine_id, machine_no, line_name, equipment_type }
 * @param p.plans       pm_plans ทั้งหมดของ checklists ข้างบน
 * @param p.lastInspByChecklist  { [checklist_id]: inspected_at } (ไม่นับที่ถูก reject)
 * @param p.machines / downtimes / sessions / breakPolicies / lineFamilyOf / sessionLineOf  → machineReliability
 * @returns {{ items, actions, summary }}
 */
export function buildMaintenanceLevels({
  checklists = [], jigs = [], plans = [], lastInspByChecklist = {},
  machines = [], downtimes = [], sessions = [], breakPolicies = [],
  lineFamilyOf = null, sessionLineOf = null,
  todayStr, nowMs, w = WINDOW, t = THRESH,
} = {}) {
  const win = splitWindows({ downtimes, sessions, todayStr, w });
  const relArgs = { machines, lineFamilyOf, sessionLineOf, breakPolicies, includeIdle: true };
  const R = machineReliability({ ...relArgs, downtimes: win.recent.downtimes, sessions: win.recent.sessions });
  const B = machineReliability({ ...relArgs, downtimes: win.base.downtimes, sessions: win.base.sessions });
  const recByKey = new Map(R.rows.map(r => [r.key, r]));
  const baseByKey = new Map(B.rows.map(r => [r.key, r]));

  // ── Preventive: checklist → อุปกรณ์ (คีย์เดียวกับ reliability = เลขเครื่องในทะเบียน) ──
  const index = buildEquipIndex(machines);
  const machineById = new Map(machines.map(m => [m.id, m]));
  const jigById = new Map(jigs.map(j => [j.id, j]));
  const planByCl = new Map(plans.filter(p => p.is_active !== false).map(p => [p.checklist_id, p]));
  const checksByKey = new Map();
  const equipMeta = new Map();
  let checklistNoEquip = 0;
  for (const cl of checklists) {
    const j = jigById.get(cl.equipment_id);
    if (!j) { checklistNoEquip++; continue; }
    const m = (j.machine_id && machineById.get(j.machine_id)) || resolveEquip(j.machine_no, index).machine;
    const key = m ? normEquipKey(m.machine_no) : `JIG:${j.id}`;
    const due = resolvePlanDue({
      frequency: cl.frequency, plan: planByCl.get(cl.id) || null,
      lastInspectedAt: lastInspByChecklist[cl.id] || null, todayStr,
    });
    if (!checksByKey.has(key)) checksByKey.set(key, []);
    checksByKey.get(key).push({ ...due, checklistId: cl.id, name: cl.name, department: cl.department, frequency: cl.frequency });
    if (!equipMeta.has(key)) {
      equipMeta.set(key, {
        machineNo: m?.machine_no || j.machine_no || j.jig_no || j.name,
        machineName: m?.machine_name || j.name || '',
        kind: m?.equipment_kind || j.equipment_type || 'machine',
        lineName: m?.line_name || j.line_name || '',
        inMaster: !!m,
      });
    }
  }

  // ── ประกอบรายอุปกรณ์: ทุกตัวที่มีแผน PM หรือมีข้อมูลเสีย/เดิน ใน 90 วัน ──
  const keys = new Set([...checksByKey.keys(), ...recByKey.keys(), ...baseByKey.keys()]);
  const items = [];
  const actions = [];
  for (const key of keys) {
    const rec = recByKey.get(key) || null;
    const base = baseByKey.get(key) || null;
    const src = rec || base;
    const meta = equipMeta.get(key) || {
      machineNo: src?.machineNo, machineName: src?.machineName || '',
      kind: src?.kind || (src?.kindKnown ? 'machine' : null), lineName: src?.lineName || '', inMaster: !!src?.inMaster,
    };
    const pv = preventiveOf(checksByKey.get(key) || []);
    const pd = predictiveOf(rec, base, { nowMs, w, t });
    // เครื่องที่ไม่มีแผน และไม่เคยเสียทั้ง 90 วัน = ไม่มีอะไรจะบอก ⇒ ไม่ขึ้นรายการ (แต่นับในสรุป)
    if (!pv.hasPlan && pd.stopsR === 0 && pd.stopsB === 0) continue;
    const item = { key, ...meta, pv, pd, actions: [] };
    for (const rule of RULES) {
      if (!rule.when({ e: item, pv, pd, todayStr, t })) continue;
      const a = { key: `${key}|${rule.key}`, rule: rule.key, equipKey: key, ...rule.make({ e: item, pv, pd, todayStr, t }) };
      item.actions.push(a);
      actions.push({ ...a, item });
    }
    items.push(item);
  }

  actions.sort(byActionOrder);
  items.sort((a, b) => (Math.min(...a.actions.map(x => x.priority), 9) - Math.min(...b.actions.map(x => x.priority), 9))
    || (b.pd.riskMin30 ?? -1) - (a.pd.riskMin30 ?? -1) || b.pd.stopsR - a.pd.stopsR);

  return {
    items, actions,
    summary: summarizeItems(items, t),
    coverage: {
      recentFrom: win.recentFrom, baseFrom: win.baseFrom, todayStr,
      checklistNoEquip,
      unmatched: R.summary.unmatched,                                   // เลขที่กรอกแต่ไม่อยู่ในทะเบียน
      unknownShifts: R.summary.unknownShifts + B.summary.unknownShifts,  // กะที่หาชั่วโมงไม่ได้
      hasBreakPolicy: R.summary.hasBreakPolicy,
    },
  };
}


/** ตัวเลขหัวการ์ด 3 ระดับ — คิดจาก "รายการที่จอกรองอยู่" (ไลน์/ชนิด/ขอบเขต) ไม่ใช่ทั้งโรงงานเสมอ */
export function summarizeItems(items = [], t = THRESH) {
  const cnt = (f) => items.filter(f).length;
  const acts = items.flatMap(i => i.actions);
  return {
    preventive: {
      withPlan: cnt(i => i.pv.hasPlan), withCycle: cnt(i => i.pv.hasCycle),
      overdue: cnt(i => i.pv.status === 'overdue'), dueSoon: cnt(i => i.pv.status === 'due_soon'),
      never: cnt(i => i.pv.status === 'never'),
      failingNoPlan: cnt(i => !i.pv.hasCycle && i.pd.stopsR >= t.minStops),
    },
    predictive: {
      analysed: cnt(i => i.pd.trend !== 'nodata'),
      worse: cnt(i => i.pd.trend === 'worse' || i.pd.trend === 'new'),
      better: cnt(i => i.pd.trend === 'better'),
      etaSoon: cnt(i => i.pd.etaDays != null && i.pd.etaDays <= t.soonDays),
      nodata: cnt(i => i.pd.trend === 'nodata'),
      riskMin30: items.reduce((s, i) => s + (i.pd.riskMin30 || 0), 0),
    },
    prescriptive: {
      total: acts.length,
      p1: acts.filter(a => a.priority === 1).length,
      p2: acts.filter(a => a.priority === 2).length,
      p3: acts.filter(a => a.priority === 3).length,
      equip: cnt(i => i.actions.length > 0),
    },
  };
}

/** ลำดับคิวคำแนะนำ: ความด่วน → นาทีเสี่ยง 30 วัน (คุ้มทำก่อน) → จำนวนครั้งที่เสีย — จุดเดียว */
export const byActionOrder = (a, b) => a.priority - b.priority
  || (b.item.pd.riskMin30 ?? -1) - (a.item.pd.riskMin30 ?? -1)
  || b.item.pd.stopsR - a.item.pd.stopsR;

/** คิวคำแนะนำของรายการที่จอกรองอยู่ (เรียงแล้ว) */
export const actionsOf = (items = []) =>
  items.flatMap(i => i.actions.map(a => ({ ...a, item: i }))).sort(byActionOrder);
