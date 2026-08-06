/* ══════════════════════════════════════════════════════════════════════
   สเกลทักษะพนักงาน — source of truth เดียวของทั้งระบบ (2026-08-06)

   เดิมนิยามซ้ำใน Report.jsx (Skill Matrix/ค่าฝีมือ/Multi-Skill) กับ
   operator.jsx (ฐานข้อมูลพนักงาน) แล้วเริ่ม drift กัน — operator มีคำอธิบาย
   (desc/band) + หมวด allowance_skill ที่ Report ไม่มี → เกณฑ์เดียวกันแต่
   แสดงผลไม่ตรงกัน · หน้าใหม่ที่แตะคะแนนสกิลให้ import จากไฟล์นี้เท่านั้น
   ห้ามนิยาม SKILL_LEVELS / getLevel / หมวดสกิล ซ้ำในหน้าใดๆ อีก
   ══════════════════════════════════════════════════════════════════════ */

/* 5 ระดับมาตรฐานตามฟอร์มกระดาษของโรงงาน (band/desc ใช้ในหน้าตั้งค่าสกิล) */
export const SKILL_LEVELS = [
  { min: 100, label: 'ผู้เชี่ยวชาญ',   color: '#a855f7', bg: 'rgba(168,85,247,0.15)',  band: 4, desc: 'ผ่านอบรมเฉพาะทาง + สอบ' },
  { min: 75,  label: 'แก้ปัญหาได้',    color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   band: 3, desc: 'ทำงานได้ + แก้ไขปัญหา' },
  { min: 50,  label: 'มาตรฐาน',        color: '#84cc16', bg: 'rgba(132,204,18,0.15)',  band: 2, desc: 'ทำงานตามมาตรฐานอิสระ' },
  { min: 25,  label: 'ต้องดูแล',       color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  band: 1, desc: 'OJT แล้ว ยังต้องดูแล' },
  { min: 0,   label: 'ยังไม่ผ่าน OJT', color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   band: 0, desc: 'ต้องผ่านการ OJT ก่อน' },
];

/* ระดับที่ต้องขออนุมัติข้ามขั้น (ดู "Employee Skills & EXP Farming" ใน CLAUDE.md) */
export const SKILL_GATES = [25, 50, 75, 100];

export const getLevel = (score) => SKILL_LEVELS.find(l => score >= l.min) ?? SKILL_LEVELS[4];

/* เพดานของขั้นปัจจุบัน — farm ขึ้นได้ถึงค่านี้ แล้วต้องรออนุมัติ level up */
export const getBandCeiling = (score) => (score < 25 ? 24 : score < 50 ? 49 : score < 75 ? 74 : 99);

/* ── หมวดสกิล ──
   SKILL_CAT_META      = 4 หมวดที่นับเป็น "ทักษะการทำงาน" (Skill Matrix / radar / ใบประเมินรายบุคคล)
   SKILL_CAT_META_FULL = + allowance_skill (ใบเซอร์ค่าฝีมือ — มี/ไม่มี ใช้ตัดสินสิทธิ์ค่าฝีมือ
                           ไม่ใช่ระดับทักษะ จึงไม่เข้า matrix/radar โดยตั้งใจ) */
export const SKILL_CAT_META = {
  hard_skill:    { label: 'Hard Skill',    color: '#ef4444', icon: '🔧', desc: 'ทักษะการทำงานรูปแบบต่างๆ' },
  machine_skill: { label: 'Machine Skill', color: '#f97316', icon: '⚙️', desc: 'ใช้ ปรับตั้ง ควบคุมเครื่องจักร' },
  product_skill: { label: 'Product Skill', color: '#3b82f6', icon: '📦', desc: 'คุณภาพกระบวนการผลิต' },
  soft_skill:    { label: 'Soft Skill',    color: '#a855f7', icon: '🧠', desc: 'หลักการคิด ระบบการทำงาน' },
};

export const ALLOWANCE_CAT_META = { label: 'ใบเซอร์ค่าฝีมือ', color: '#22c55e', icon: '🎫', desc: 'มี/ไม่มี — ใช้ตัดสินสิทธิ์ค่าฝีมือ' };

export const SKILL_CAT_META_FULL = { ...SKILL_CAT_META, allowance_skill: ALLOWANCE_CAT_META };

/* จัดกลุ่ม skillDefs ตามหมวด (คงลำดับ sort_order ภายในกลุ่ม)
   meta = SKILL_CAT_META (default, ไม่รวมค่าฝีมือ) หรือ SKILL_CAT_META_FULL */
export const groupSkillsByCategory = (defs, meta = SKILL_CAT_META) =>
  Object.entries(meta)
    .map(([k, m]) => ({ key: k, ...m, skills: defs.filter(s => (s.category || 'hard_skill') === k) }))
    .filter(g => g.skills.length > 0);

/* ══════════════════════════════════════════════════════════════════════
   วงกลมแบ่ง 4 ส่วน (skill gauge) — ตามฟอร์ม MULTI SKILL OF OPERATORS
   ระดับ 0-4 ใช้ทั้งบนจอและในไฟล์พิมพ์ (SVG string)
   ══════════════════════════════════════════════════════════════════════ */

export const MS_LEVELS = [
  { level: 4, pct: '100%',   label: 'สามารถสอนงานผู้อื่นได้',                          color: '#166534', bg: '#bbf7d0', border: '#16a34a' },
  { level: 3, pct: '75-99%', label: 'สามารถแก้ปัญหาและตัดสินใจในการทำงานได้',          color: '#1e3a5f', bg: '#bfdbfe', border: '#3b82f6' },
  { level: 2, pct: '50-74%', label: 'ปฏิบัติงานได้โดยไม่ต้องมีผู้แนะนำ',              color: '#713f12', bg: '#fef9c3', border: '#eab308' },
  { level: 1, pct: '25-49%', label: 'ผ่านการอบรม(OJT)และปฏิบัติงานได้โดยมีผู้แนะนำ', color: '#7c2d12', bg: '#fed7aa', border: '#f97316' },
  { level: 0, pct: '0-24%',  label: 'อยู่ระหว่างการฝึกอบรม',                           color: '#7f1d1d', bg: '#fecaca', border: '#ef4444' },
];

export function scoreToLevel(score) {
  if (score === undefined || score === null) return 0;
  if (score >= 100) return 4;
  if (score >= 75)  return 3;
  if (score >= 50)  return 2;
  if (score >= 25)  return 1;
  return 0;
}

export const msStyle = (lv) => MS_LEVELS.find(l => l.level === lv) || { bg: '#fff', color: '#999', border: '#ccc' };

/* ไล่สีตามระดับ · เติมตามเข็มนาฬิกา: ล่างซ้าย → ล่างขวา → บนขวา → บนซ้าย */
export const GAUGE_FILL   = ['none', '#f97316', '#eab308', '#3b82f6', '#22c55e'];
export const GAUGE_STROKE = ['#9ca3af', '#f97316', '#ca8a04', '#2563eb', '#16a34a'];

/* SVG arc path ของแต่ละเสี้ยว (cx=17, cy=17, r=15) */
export const Q_PATHS = [
  'M17,17 L2,17 A15,15 0 0,1 17,32 Z',   // bottom-left
  'M17,17 L17,32 A15,15 0 0,1 32,17 Z',  // bottom-right
  'M17,17 L32,17 A15,15 0 0,1 17,2 Z',   // top-right
  'M17,17 L17,2 A15,15 0 0,1 2,17 Z',    // top-left
];

/* inline SVG string สำหรับฝังในหน้าพิมพ์ (หน้าต่างพิมพ์ไม่มี React) */
export function skillGaugeSvgStr(lv) {
  const fill   = GAUGE_FILL[lv]   || 'none';
  const stroke = GAUGE_STROKE[lv] || '#9ca3af';
  const sectors = Q_PATHS.slice(0, lv)
    .map(d => `<path d="${d}" fill="${fill}" opacity="0.85"/>`)
    .join('');
  return `<svg width="26" height="26" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">
    <circle cx="17" cy="17" r="15" fill="none" stroke="${stroke}" stroke-width="1.5"/>
    ${sectors}
    <line x1="17" y1="2" x2="17" y2="32" stroke="${stroke}" stroke-width="1"/>
    <line x1="2" y1="17" x2="32" y2="17" stroke="${stroke}" stroke-width="1"/>
    <circle cx="17" cy="17" r="15" fill="none" stroke="${stroke}" stroke-width="1.5"/>
  </svg>`;
}
