/**
 * A3 Report ของโปรเจคปรับปรุง — กฎการ "เล่าเรื่อง" ให้ตรงกับสถานะจริง (pure · มีเทส)
 *
 * ทำไมแยกไฟล์จากตัวพิมพ์ (`src/lib/improvementA3Print.js`):
 *   ตัวพิมพ์แตะ window/DOM + supabase (ทะเบียนเอกสาร) เทสหน่วยเรียกไม่ได้
 *   ส่วน "ใบนี้ควรพูดว่าอะไร" คือกฎธุรกิจที่ห้ามพลาด ⇒ อยู่ที่นี่ ทดสอบได้
 *
 * 🔴 กฎเหล็กของใบ A3 (สืบทอดจากกฎการ์ดใน /improvements — ห้ามให้ใบพิมพ์พูดเกินจริง)
 *   1. ยังไม่ยืนยัน "เริ่มลงมือแก้จริง" (do_started_at) = ใบมีได้แค่ **ระดับปัจจุบัน + เป้าหมาย**
 *      ห้ามมีคำว่า "ผลลัพธ์/ประหยัดแล้ว" (บทเรียน 2026-08-26: การ์ดเคยโชว์ ▲95% ของงานที่ยังไม่ลงมือ)
 *   2. หลังแก้ < MIN_AFTER_DAYS วันผลิตจริง = ยังสรุป % / เงินที่ประหยัดไม่ได้ → ใบต้องเขียนว่า "รอผล n/5 วัน"
 *      และตัวเงินสลับเป็น "มูลค่าปัญหาก่อนแก้ (เพดานประหยัด)" เท่านั้น
 *   3. ไม่มีข้อมูลการผลิตในช่วงเทียบ = เขียนว่าไม่มีข้อมูล **ห้ามพิมพ์ 0** (0 อ่านเหมือน "ไม่มีปัญหาแล้ว")
 *
 * แผนงาน (`improvement_milestones.phase`) เก็บเป็น **PDCA** เสมอ — โหมด DMAIC เป็นการ "แสดงเทียบ"
 * ไม่ใช่ข้อมูลคนละชุด (ห้ามเขียน phase แบบ DMAIC ลง DB) ดู milestonePhaseLabel()
 */

/* หลังแก้ต้องมี "วันผลิตจริง" อย่างน้อยเท่านี้ ถึงสรุปผล/เงินที่ประหยัดได้
   (เกณฑ์เดียวกับ capaEffect — หลังแก้ 1 วัน 0 นาที = ▼100% ที่ยังพิสูจน์ไม่ได้)
   นิยามอยู่ที่นี่ที่เดียว · หน้า /improvements import ไปใช้ ห้ามพิมพ์เลข 5 ซ้ำในหน้า */
export const MIN_AFTER_DAYS = 5;

export const A3_FRAMEWORKS = {
  pdca:  { key: 'pdca',  label: 'PDCA (Plan-Do-Check-Act)', short: 'PDCA' },
  dmaic: { key: 'dmaic', label: 'DMAIC (Six Sigma)',        short: 'DMAIC' },
};

/** ค่ากรอบที่ใช้ได้จริง — ค่าแปลก/ว่าง = pdca (กรอบเดียวกับที่แผนงานเก็บ) */
export const normFramework = (f) => (f === 'dmaic' ? 'dmaic' : 'pdca');

export const PHASE_META = {
  // PDCA — ตรงกับ PHASES ใน Improvements.jsx (สีเดียวกัน)
  plan:    { s: 'P', label: 'Plan',    color: '#4d9fff' },
  do:      { s: 'D', label: 'Do',      color: '#f59e0b' },
  check:   { s: 'C', label: 'Check',   color: '#22c55e' },
  act:     { s: 'A', label: 'Act',     color: '#a855f7' },
  // DMAIC
  define:  { s: 'D', label: 'Define',  color: '#4d9fff' },
  measure: { s: 'M', label: 'Measure', color: '#38bdf8' },
  analyze: { s: 'A', label: 'Analyze', color: '#f59e0b' },
  improve: { s: 'I', label: 'Improve', color: '#22c55e' },
  control: { s: 'C', label: 'Control', color: '#a855f7' },
};

/* ช่องของใบ A3 — **ช่องเดียวกันทั้ง 2 กรอบ** เปลี่ยนแค่ป้ายขั้นตอน
   (ข้อมูลชุดเดียว เล่าคนละภาษา — ไม่ใช่ใบคนละใบ)
   key = ที่มาของเนื้อหา ห้ามเปลี่ยน (ผูกกับคอลัมน์/คีย์ใน improvements.a3) */
const SECTIONS = [
  { key: 'background',     title: 'ความเป็นมา / ปัญหาที่พบ',              pdca: 'plan',  dmaic: 'define' },
  { key: 'current',        title: 'สภาพปัจจุบัน (ข้อมูลจริงจากระบบ)',       pdca: 'plan',  dmaic: 'measure' },
  { key: 'target',         title: 'เป้าหมาย',                            pdca: 'plan',  dmaic: 'define' },
  { key: 'rootCause',      title: 'วิเคราะห์สาเหตุราก (5 Why / ก้างปลา)',   pdca: 'plan',  dmaic: 'analyze' },
  { key: 'countermeasure', title: 'มาตรการแก้ไข',                         pdca: 'do',    dmaic: 'improve' },
  { key: 'plan',           title: 'แผนดำเนินการ (ใคร / อะไร / เมื่อไหร่)',  pdca: 'do',    dmaic: 'improve' },
  { key: 'result',         title: 'ผลลัพธ์ (ระบบเทียบก่อน/หลังให้อัตโนมัติ)', pdca: 'check', dmaic: 'control' },
  { key: 'standardize',    title: 'มาตรฐาน & ขยายผล (Yokoten)',           pdca: 'act',   dmaic: 'control' },
];

/** ช่องทั้งหมดของใบพร้อมเลขลำดับ + ขั้นตามกรอบที่เลือก */
export function a3Sections(framework) {
  const fw = normFramework(framework);
  return SECTIONS.map((s, i) => {
    const phase = s[fw];
    return { no: i + 1, key: s.key, title: s.title, phase, meta: PHASE_META[phase] };
  });
}

/* แผนงานเก็บ phase เป็น PDCA — เวลาโชว์ในกรอบ DMAIC ต้องบอกว่าเทียบไปที่ขั้นไหน
   ขั้น Plan ของ PDCA ครอบ 3 ขั้นแรกของ DMAIC (Define/Measure/Analyze) — ยุบเป็นตัวเดียวไม่ได้
   ⇒ โชว์ "DMA" พร้อมคำเต็ม ห้ามเดาว่าขั้นนั้นคือ Define หรือ Analyze (ข้อมูลไม่ได้บอก) */
const DMAIC_OF_PDCA = {
  plan:  { s: 'DMA', label: 'Define–Measure–Analyze', color: PHASE_META.define.color },
  do:    { s: 'I',   label: 'Improve',                color: PHASE_META.improve.color },
  check: { s: 'C',   label: 'Control (ยืนยันผล)',      color: PHASE_META.control.color },
  act:   { s: 'C',   label: 'Control (คุมให้คงอยู่)',   color: PHASE_META.control.color },
};

/** ป้ายขั้นของ milestone ตามกรอบที่เลือก — ไม่ได้ระบุ phase = '–' (ห้ามเดาจากชื่อขั้น) */
export function milestonePhaseLabel(phase, framework) {
  if (!phase) return { s: '–', label: 'ยังไม่ระบุขั้น', color: '#8b8b96' };
  if (normFramework(framework) === 'dmaic') {
    return DMAIC_OF_PDCA[phase] || { s: '–', label: 'ยังไม่ระบุขั้น', color: '#8b8b96' };
  }
  const m = PHASE_META[phase];
  return m ? { s: m.s, label: m.label, color: m.color } : { s: '–', label: 'ยังไม่ระบุขั้น', color: '#8b8b96' };
}

/**
 * ใบนี้พูดเรื่องผลลัพธ์ได้แค่ไหน — ตัวตัดสินเดียวของทั้งใบ
 *   'nodata'    ไม่มีกะที่ปิดแล้วในช่วงเทียบ = วัดไม่ได้ (ห้ามพิมพ์ 0)
 *   'baseline'  ยังไม่ยืนยันเริ่มลงมือแก้ = มีแค่ระดับปัจจุบัน + เป้าหมาย
 *   'waiting'   ลงมือแล้วแต่ข้อมูลหลังแก้ยังไม่ถึง MIN_AFTER_DAYS วันผลิต = ยังสรุปไม่ได้
 *   'confirmed' สรุปผล/เงินที่ประหยัดได้
 */
export function resultMode(r, started, minAfterDays = MIN_AFTER_DAYS) {
  if (!r || r.noData) return 'nodata';
  if (!started) return 'baseline';
  if ((r.afterDays || 0) < minAfterDays) return 'waiting';
  return 'confirmed';
}

/** % ที่ลดลง (บวก = ดีขึ้น) — ไม่มีฐานเทียบ = null ห้ามคืน 0 */
export function resultPct(r) {
  if (!r || r.noData || !(r.beforePerDay > 0)) return null;
  return Math.round(((r.beforePerDay - r.afterPerDay) / r.beforePerDay) * 100);
}

/**
 * หัวข้อของบล็อกเงินบนใบ — ผูกกับ mode เท่านั้น
 * potential = true ⇒ ตัวเลขที่ส่งมาต้องมาจาก costSavingOf(..., potential=true) (เพดานจาก baseline)
 */
export function moneyHeadline(mode, totalPerDay) {
  if (mode === 'confirmed') {
    if (totalPerDay == null) return { label: 'ยังคำนวณเป็นบาทไม่ได้', tone: 'muted', potential: false };
    if (totalPerDay > 0) return { label: 'ประหยัดได้', tone: 'good', potential: false };
    if (totalPerDay < 0) return { label: 'ต้นทุนเพิ่มขึ้น', tone: 'bad', potential: false };
    return { label: 'เท่าเดิม (±0)', tone: 'muted', potential: false };
  }
  return {
    label: 'มูลค่าปัญหานี้ก่อนแก้ (เพดานถ้าแก้หายหมด)',
    tone: 'warn', potential: true,
  };
}

/** ข้อความกำกับใต้บล็อกผล/เงิน — ต้องมีเสมอเมื่อยังสรุปไม่ได้ (ห้ามเงียบ) */
export function modeNote(mode, r, minAfterDays = MIN_AFTER_DAYS) {
  switch (mode) {
    case 'nodata':
      return 'ยังไม่มีกะที่ปิดแล้วในช่วงเทียบ — ระบบยังวัดผลก่อน/หลังไม่ได้ (ตัวเลขที่ว่างคือ "ไม่มีข้อมูล" ไม่ใช่ศูนย์)';
    case 'baseline':
      return 'ยังไม่ได้ยืนยัน "เริ่มลงมือแก้จริง" — ตัวเลขในใบนี้คือระดับปัจจุบัน (ก่อนแก้) และเป้าหมายที่ตั้งไว้ ยังไม่ใช่ผลลัพธ์';
    case 'waiting':
      return `ลงมือแก้แล้ว แต่มีข้อมูลหลังแก้เพียง ${r?.afterDays || 0}/${minAfterDays} วันผลิต — ยังสรุป % และเงินที่ประหยัดไม่ได้`;
    default:
      return '';
  }
}

/** สรุปแผนงาน (ใช้ทั้งหัวใบและช่อง ⑥) — ไม่มีขั้นเลย = pct null ไม่ใช่ 0% */
export function planProgress(milestones = []) {
  const total = milestones.length;
  const done = milestones.filter(m => m.status === 'done').length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : null };
}

/** ขั้นที่เลยกำหนดแล้วยังไม่ปิด (today = 'YYYY-MM-DD' — ฉีดเวลาเข้ามา ห้ามอ่านนาฬิกาในฟังก์ชัน) */
export const overdueMilestones = (milestones = [], today) =>
  milestones.filter(m => m.status !== 'done' && m.planned_end && m.planned_end < today);

/** เนื้อหาที่คนเขียนเอง (improvements.a3 jsonb) — ยังไม่ apply migration = undefined ต้องไม่ล้ม */
export function a3Data(imp) {
  const a = (imp && typeof imp.a3 === 'object' && imp.a3) || {};
  return {
    framework: normFramework(a.framework),
    background: a.background || '',
    root_cause: a.root_cause || '',
    countermeasures: a.countermeasures || '',
    standardize: a.standardize || '',
    team: a.team || '',
  };
}
