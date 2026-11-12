/* ══ 🩺 userIssues — "บัญชีนี้มีอะไรต้องแก้" ของหน้า /add-user (2026-11-03 · ประชุมหน้างาน 02/11 ข้อ A6) ══
   ปัญหาจริง: แอดมินเปิดหน้าจัดการผู้ใช้แล้วเจอป้าย/หมายเหตุ 7-8 กอง (ตัวตนไม่ตรง · ฐานพนักงานยังไม่กรอก ·
   ทำงานคนละตำแหน่ง · ขอบเขตไม่มีผล ฯลฯ) **สีส้มเท่ากันหมด** ⇒ แยกไม่ออกว่าอันไหน "ระบบทำงานผิดอยู่"
   อันไหน "แค่ข้อมูลประกอบ" ⇒ ไม่รู้จะเริ่มแก้ตรงไหน

   ไฟล์นี้ตอบ **การนำเสนอ** อย่างเดียว:
   · แต่ละกองเป็น "ต้องแก้" (`fix` — ระบบเห็น/ตัดสินผิดอยู่ตอนนี้) หรือ "ข้อมูลประกอบ" (`info` — ไม่มีผลกับสิทธิ์)
   · ประโยคเดียวต่อเรื่อง: ผิดอะไร + ทางแก้ทางเดียว
   🔴 **ไม่ได้ตัดสินว่าใครผิด** — ตัวตัดสินยังเป็นของกลางเดิม (`identityDiff` · `identityFallbacks` ·
      `dualMeaningInfo` · `unlinkedTriage` · `scopeIneffective` · `scopeTooWide` · `needsScopeReview`)
      หน้าจอส่ง "ใครติดกองไหน" มา ไฟล์นี้จัดกลุ่ม/เรียง/นับให้ **ห้ามเขียนเงื่อนไขกองซ้ำที่นี่**
   🔴 ข้อมูลประกอบ "พับไว้" ได้ แต่ **ห้ามหาย** — ตัวนับต้องอยู่บนจอเสมอ (กฎความซื่อสัตย์ของจอ)
   ════════════════════════════════════════════════════════════════════════════════════════════════ */

export const SEV_FIX = 'fix';
export const SEV_INFO = 'info';

/**
 * ทะเบียนกอง — ลำดับในลิสต์ = ลำดับที่จอแสดง (สำคัญสุดก่อน)
 * `what` = ผิดอะไร (สั้น ภาษาคน) · `fix` = ทางแก้ทางเดียว · `chip` = ป้ายสั้นบนชิป
 * เพิ่มกองใหม่ = เพิ่ม 1 แถวที่นี่ + ส่งรายชื่อเข้ามาจากหน้า
 */
export const USER_ISSUES = [
  { key: 'toowide',  sev: SEV_FIX,  icon: '🔓', chip: 'หัวหน้าหน้างานเห็นทั้งโรงงาน',
    what: 'หัวหน้ากลุ่ม/หัวหน้างาน ถูกตั้งให้เห็นทั้งโรงงาน',
    fix: 'กด ✏️ แก้ไข → ช่อง ② เลือกความกว้างแค่หน่วยของตัวเอง' },
  { key: 'ghost',    sev: SEV_FIX,  icon: '🚩', chip: 'ตั้งขอบเขตแล้วไม่มีผล',
    what: 'ตั้งขอบเขตแคบไว้แต่ไม่ได้เลือกหน่วย ⇒ ยังเห็นทั้งโรงงาน',
    fix: 'กด ✏️ แก้ไข → ติ๊ก Cost Center ที่ดูแล' },
  { key: 'unlinked', sev: SEV_FIX,  icon: '🪪', chip: 'บัญชีของคนแต่ยังไม่ผูกพนักงาน',
    what: 'ติดป้ายว่าเป็นบัญชีของคน แต่ยังไม่ผูกกับรายชื่อพนักงาน',
    fix: 'กด ✏️ แก้ไข → ช่อง ① เลือกพนักงาน' },
  { key: 'unknown',  sev: SEV_FIX,  icon: '❓', chip: 'ยังไม่รู้ว่าเป็นใคร',
    what: 'ยังไม่รู้ว่าบัญชีนี้เป็นของใคร (ทีม/ไลน์อาจเพี้ยนโดยไม่มีใครรู้)',
    fix: 'ผูกกับพนักงาน หรือกด "🖥️ เป็นบัญชีกลาง" ถ้าเป็นจอ TV/เครื่องกลาง' },
  { key: 'review',   sev: SEV_FIX,  icon: '🔭', chip: 'ยังไม่ได้ทบทวนขอบเขต',
    what: 'เห็นทั้งโรงงานเพราะไม่เคยตั้งขอบเขต (ไม่ใช่เพราะมีคนตั้งใจให้)',
    fix: 'กด ✏️ แก้ไข → เลือกขอบเขตให้ตรงงานจริง แล้วบันทึก' },
  { key: 'fallback', sev: SEV_INFO, icon: '🧩', chip: 'ฐานพนักงานยังกรอกไม่ครบ',
    what: 'ฐานพนักงานยังว่างบางช่อง ระบบจึงใช้ค่าในบัญชีไปก่อน',
    fix: 'เติมช่องที่ขาดที่หน้าฐานพนักงาน (/operator)' },
  { key: 'mismatch', sev: SEV_INFO, icon: '🔁', chip: 'บัญชีมีค่าเก่าค้าง',
    what: 'ค่าในบัญชีไม่ตรงฐานพนักงาน — ระบบใช้ฐานพนักงานอยู่แล้ว ไม่มีผลกับสิทธิ์',
    fix: 'กด "ใช้ค่าจากฐานพนักงาน" เพื่อล้างค่าเก่า (ไม่บังคับ)' },
  { key: 'dual',     sev: SEV_INFO, icon: '🧭', chip: 'ทำงานคนละตำแหน่งกับที่บรรจุ',
    what: 'ตำแหน่งที่ปฏิบัติงานต่างจากตำแหน่งที่บริษัทบรรจุ — ไม่ใช่ข้อผิดพลาด',
    fix: 'ไม่ต้องทำอะไร (ระบบตัดสินสิทธิ์จากตำแหน่งที่ปฏิบัติงาน)' },
];

const DEF_BY_KEY = Object.fromEntries(USER_ISSUES.map((d, i) => [d.key, { ...d, order: i }]));
export const issueDef = (key) => DEF_BY_KEY[key] || null;

/** ประโยคเดียวต่อเรื่อง: "ผิดอะไร → ทางแก้" (detail = รายละเอียดเฉพาะคน เช่นช่องที่ขาด) */
export function issueLine(def, detail) {
  if (!def) return '';
  const what = detail ? `${def.what} (${detail})` : def.what;
  return `${what} → ${def.fix}`;
}

const idOf = (x) => (x && typeof x === 'object' ? x.id : x);
const detailOf = (x) => (x && typeof x === 'object' ? (x.detail || null) : null);

/**
 * จัดกลุ่มกองงานค้างของทะเบียนบัญชี
 * @param {Record<string, Array<string|{id:string, detail?:string}>>} members  key กอง → รายชื่อ id บัญชีที่ติด
 *   (กองที่ไม่รู้จักถูกข้าม · ไม่ส่งกองไหนมา = ถือว่ากองนั้นว่าง)
 * @returns {{
 *   byUser: Record<string, Array<{key,sev,icon,what,fix,chip,detail,line}>>,  // เรียง fix ก่อน info ตามลำดับทะเบียน
 *   groups: { fix: Array<def & {count}>, info: Array<def & {count}> },          // เฉพาะกองที่มีคน
 *   fixUsers: number, infoUsers: number,   // นับ "บัญชี" ไม่ซ้ำ (บัญชีที่ติด fix ไม่ถูกนับใน infoUsers)
 *   fixTotal: number, infoTotal: number,   // นับ "เรื่อง" (1 บัญชีติดได้หลายเรื่อง)
 * }}
 */
export function buildUserIssues(members = {}) {
  const byUser = {};
  const groups = { fix: [], info: [] };
  let fixTotal = 0, infoTotal = 0;
  for (const def of USER_ISSUES) {
    const list = Array.isArray(members?.[def.key]) ? members[def.key] : [];
    const seen = new Set();
    for (const m of list) {
      const id = idOf(m);
      if (id == null || id === '' || seen.has(String(id))) continue;
      seen.add(String(id));
      const detail = detailOf(m);
      (byUser[id] ||= []).push({ ...DEF_BY_KEY[def.key], detail, line: issueLine(def, detail) });
    }
    if (!seen.size) continue;
    groups[def.sev === SEV_FIX ? 'fix' : 'info'].push({ ...DEF_BY_KEY[def.key], count: seen.size });
    if (def.sev === SEV_FIX) fixTotal += seen.size; else infoTotal += seen.size;
  }
  for (const id of Object.keys(byUser)) {
    byUser[id].sort((a, b) => (a.sev === b.sev ? a.order - b.order : a.sev === SEV_FIX ? -1 : 1));
  }
  const ids = Object.keys(byUser);
  const fixUsers = ids.filter(id => byUser[id].some(i => i.sev === SEV_FIX)).length;
  const infoUsers = ids.length - fixUsers;
  return { byUser, groups, fixUsers, infoUsers, fixTotal, infoTotal };
}

/** ข้อความสรุปบนสุดของจอ — ศูนย์ต้องพูดว่าศูนย์ (ห้ามซ่อนแถบทั้งแถบแล้วให้คนเดาว่าไม่มีหรือโหลดไม่ขึ้น) */
export function issueSummaryText({ fixUsers = 0, infoUsers = 0, fixTotal = 0, infoTotal = 0 } = {}) {
  const fix = fixUsers
    ? `ต้องแก้ ${fixUsers} บัญชี (${fixTotal} เรื่อง)`
    : 'ไม่มีบัญชีที่ต้องแก้';
  const info = infoTotal
    ? `ข้อมูลประกอบ ${infoTotal} เรื่อง${infoUsers ? ` · ${infoUsers} บัญชีมีแต่ข้อมูลประกอบ` : ''}`
    : 'ไม่มีข้อมูลประกอบ';
  return `${fix} · ${info}`;
}
