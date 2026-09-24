/* 🔭 แกน "ระดับ → เห็นกว้างแค่ไหน" — src/utils/scopeDepth.js          2026-09-24
 *
 * ที่มา (user): *"job level manager (role manager) มองได้หมด ซึ่งความจริงต้องดูด้วยว่า
 *                เค้าอยู่แผนกไหน ส่วนงานไหน"* + *"ไม่งั้นตั้งการแจ้งเตือนมันจะมั่ว"*
 *
 * ── แกนนี้แยกจาก role โดยตั้งใจ ────────────────────────────────────────────
 *   `role`        ตอบ "ทำอะไรได้"        (role_permissions)
 *   `scope_depth` ตอบ "เห็นกว้างแค่ไหน"  (ไฟล์นี้)
 * เอา 2 อย่างมารวมใน role = ต้องสร้าง `manager_PD3` `manager_PD4` … = **role explosion**
 * ที่ NIST เตือนไว้ (docs/ACCESS-CONTROL-STANDARDS.md §2.1)
 *
 * ── 🔴 กฎเหล็กของแกนนี้: ขอบเขต "ตัดให้แคบลง" เท่านั้น ห้ามขยาย ───────────
 * สูตรทั้งระบบคือ **(สิทธิ์) ∩ (สังกัด × ระดับ)** — เครื่องหมาย ∩ คือหัวใจ
 * ⇒ **"ไม่ตั้งค่า" ต้องแปลว่าแคบ ไม่ใช่กว้าง** (deny by default · OWASP A01)
 *   ของเดิมกลับด้าน: `sections = []` ⇒ ทุกตัวกรองผ่านหมด ⇒ เห็นทั้งโรงงาน
 *   วัดจริง 24/09: 12/97 บัญชีกว้างเพราะ "ไม่เคยตั้ง" (มี role manager/leader อยู่ด้วย)
 *   ⇒ แถวพวกนั้นถูกมาร์คเป็น `scope_depth_src = 'legacy_open'` ไว้ให้ไล่ทบทวน
 */

export const SCOPE_DEPTHS = ['self', 'unit', 'branch', 'all'];

export const SCOPE_DEPTH_META = {
  self:   { label: 'เฉพาะของตัวเอง', icon: '👤', short: 'ตัวเอง',
            desc: 'เห็นเฉพาะงาน/ข้อมูลที่เป็นของตัวเอง' },
  unit:   { label: 'หน่วยที่สังกัด',  icon: '📍', short: 'หน่วยตัวเอง',
            desc: 'เห็นเฉพาะไลน์/ทีม/แผนกที่ตัวเองสังกัด — ไม่เห็นหน่วยอื่น' },
  branch: { label: 'สังกัด + ใต้ลงไป', icon: '🌳', short: 'ทั้งสาย',
            desc: 'เห็นหน่วยตัวเองและทุกหน่วยที่อยู่ใต้ลงไปทั้งหมด (เช่น ผจก. PD3 เห็นทุกแผนก/ไลน์ใต้ PD3)' },
  all:    { label: 'ทั้งโรงงาน',      icon: '🏭', short: 'ทั้งโรงงาน',
            desc: 'เห็นทุกส่วนงาน — ให้เฉพาะคนที่ต้องดูข้ามฝ่ายจริงๆ' },
};

export const scopeDepthLabel = (d) => (SCOPE_DEPTH_META[d] || SCOPE_DEPTH_META.unit).label;

/** ลำดับความกว้าง — ใช้เทียบว่าอันไหนกว้างกว่า (ไม่ใช่คะแนน ห้ามเอาไปบวกลบ) */
export const depthRank = (d) => Math.max(0, SCOPE_DEPTHS.indexOf(d));
export const isWiderThan = (a, b) => depthRank(a) > depthRank(b);

/**
 * ค่าเริ่มต้นที่ "แนะนำ" ตามระดับพนักงาน (`positions.level`)
 * — เป็นแค่ข้อเสนอ **ตั้งทับรายบัญชีได้เสมอ** (user เคาะ 23/09: *"ผูกระดับ + override รายคนได้"*)
 *   ของจริงมีข้อยกเว้นเสมอ เช่น QA ต้องเห็นข้ามฝ่ายทั้งที่ระดับไม่สูง ·
 *   ผู้จัดการโรงงาน (`g`) กับผู้จัดการฝ่าย (`manager`) อยู่ level เดียวกันแต่ต้องกว้างไม่เท่ากัน
 *
 * ⚠️ **ไม่รู้ระดับ = คืน `unit` (แคบ) ห้ามคืน `all`** — เดาให้กว้างคือบั๊กที่เราเพิ่งแก้
 */
const LEVEL_DEFAULT = {
  operator:   'self',
  technician: 'unit',
  staff:      'unit',     // เจ้าหน้าที่ · ธุรการ · เลขา
  engineer:   'unit',
  leader:     'unit',     // หัวหน้าไลน์
  supervisor: 'branch',   // หัวหน้าแผนก · หัวหน้าส่วน
  manager:    'branch',   // ผู้จัดการฝ่าย — "ทั้งสายของฝ่ายตัวเอง" ไม่ใช่ทั้งโรงงาน
};

export function depthForLevel(level) {
  return LEVEL_DEFAULT[String(level || '').trim()] || 'unit';
}

/**
 * แถวไหนที่ "กว้างโดยไม่มีใครตั้งใจ" — คิวงานทบทวนสิทธิ์ (ISO 27001 A.5.18)
 * `legacy_open` = ได้ `all` มาจากพฤติกรรมเดิมที่อนุมานจากการเว้นว่าง ไม่ใช่การตัดสินใจของใคร
 */
export const needsScopeReview = (p) =>
  p?.scope_depth_src === 'legacy_open' && p?.scope_depth === 'all';
