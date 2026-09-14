/* ═══════════════════════════════════════════════════════════════════════════
   ใบแจ้งซ่อม MO — "ขั้นไหน ใครทำ" (source of truth เดียวของทั้งโมดูล)   2026-09-02

   ที่มา (คำสั่ง user — ไล่ทีละขั้นตามที่หน้างานทำจริง):
     1 เปิดใบ            → ใครก็ได้ (ส่วนใหญ่หัวหน้าไลน์ฝ่ายผลิต)
     2 รับงาน/จ่ายงาน     → หัวหน้าช่าง
     3 ลงมือซ่อม/อัพเดท   → ทีมช่างที่ไปทำ
     4 ตรวจรับงานหลังซ่อม → **คนที่เปิดใบแจ้งซ่อม**
     5 ตรวจคุณภาพ        → QA
     6 รับมอบ/ติดตามผล    → หัวหน้าแผนกของฝ่ายที่แจ้ง
     7 อนุมัติปิด         → หัวหน้าแผนก/ส่วน/ผจก. ของฝ่ายที่แจ้ง

   🔒 2026-09-07 — ขั้น 4/6/7 ("ฝ่ายที่แจ้ง") ผูกกับ scope จริงแล้ว: ผู้ถือคีย์ทำได้เฉพาะใบใน
      ส่วนงาน/ครอบครัวไลน์ของตัวเอง (`reporterSide` + `inReporterScope` · helper `orderInReporterScope`)
      ผู้เปิดใบและ manage_master ไม่ติด scope · ผู้ใช้ที่ไม่จำกัด scope (admin/ไม่มี sections) = ทั้งโรงงานตามเดิม

   ⚠️ ทำไมต้องเป็นไฟล์กลาง (ไม่ใช่เขียนใน MtnRepair.jsx):
      เกณฑ์นี้ถูกใช้ 2 ที่ที่ต้องตรงกันเป๊ะเสมอ — ตัวซ่อนปุ่มใน DetailDrawer
      กับ guard ชั้นสองใน StepModal.save() (RLS ของ mtn_orders ฝั่ง DR เป็น anon
      เปิดหมด → UI คือด่านเดียวจริงๆ) เดิมเขียนซ้ำ 2 ก้อนแล้ว**ต่างกันจริง**
      (ตัวซ่อนปุ่มมี branch step===1 ที่ guard ไม่มี) → ยุบมาที่นี่

   ⚠️ ไฟล์นี้ต้อง pure — ห้าม import supabaseClient / pmTeams / permissions
      (mtnTeams → pmTeams → supabaseClient ซึ่งพัง `import.meta.env` นอก Vite)
      ผู้เรียกคำนวณ `can` / `seeded` / `inOrderTeam` มาให้แทน → เทสได้ตรงๆ
   ═══════════════════════════════════════════════════════════════════════════ */

/** ขั้นที่ 1 ไม่อยู่ในตารางนี้ — เป็นการ "เปิดใบ" คุมด้วย mtn_repair:report ตรงๆ */
export const MTN_STEPS = {
  2: {
    key: 'assign', fallback: 'service', ownTeam: true, byReporter: false,
    icon: '🔧', title: 'รับงาน / จ่ายงาน',
    who: 'หัวหน้าช่าง (คนจ่ายงานให้ทีม)', whoShort: 'หัวหน้าช่าง',
  },
  3: {
    key: 'service', fallback: null, ownTeam: true, byReporter: false,
    icon: '🛠', title: 'ลงมือซ่อม / อัพเดทผล',
    who: 'ช่างที่ได้รับมอบหมาย', whoShort: 'ช่างที่รับงาน',
  },
  4: {
    key: 'accept_work', fallback: 'service', ownTeam: false, byReporter: true, reporterSide: true,
    icon: '☑️', title: 'ตรวจรับงานหลังซ่อม',
    who: 'ผู้เปิดใบแจ้งซ่อม (ฝ่ายที่แจ้ง)', whoShort: 'ผู้เปิดใบ',
  },
  5: {
    key: 'qa', fallback: null, ownTeam: false, byReporter: false,
    icon: '🧪', title: 'ตรวจคุณภาพหลังซ่อม',
    who: 'QA', whoShort: 'QA',
  },
  6: {
    key: 'handover', fallback: 'report', ownTeam: false, byReporter: true, reporterSide: true,
    icon: '🤝', title: 'รับมอบ / ติดตามผล',
    who: 'หัวหน้าแผนกของฝ่ายที่แจ้ง', whoShort: 'หัวหน้าแผนกผู้แจ้ง',
  },
  7: {
    key: 'approve', fallback: null, ownTeam: false, byReporter: false, reporterSide: true,
    icon: '✅', title: 'อนุมัติปิดใบ MO',
    who: 'หัวหน้าแผนก / หัวหน้าส่วน / ผจก. ของฝ่ายที่แจ้ง', whoShort: 'หัวหน้าส่วน / ผจก.',
  },
};

/** ป้ายปุ่ม/หัวข้อขั้น — สร้างจากที่นี่ที่เดียว ห้ามพิมพ์ชื่อขั้นซ้ำในหน้า */
export const stepLabel = (step, { withWho = true } = {}) => {
  const m = MTN_STEPS[step];
  if (!m) return `ขั้น ${step}`;
  return `${m.icon} ${m.title} (ขั้น ${step}${withWho ? ` · ${m.whoShort}` : ''})`;
};

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * คนที่กำลังใช้งานอยู่ = คนที่เปิดใบนี้หรือเปล่า
 *
 * ⚠️ ยึด `reported_by_name` (ระบบ stamp ตอน insert) เป็นหลักเสมอ
 *    ส่วน `reporter_prod` เป็นช่องที่**พิมพ์แก้ได้** ในฟอร์มแจ้งซ่อม จึงใช้เป็น
 *    fallback เฉพาะใบเก่าที่ยังไม่มี reported_by_name เท่านั้น
 *    (ถ้าเอา reporter_prod มาเทียบด้วยเสมอ = พิมพ์ชื่อคนอื่นแล้วสวมสิทธิ์ได้)
 */
export function isOrderReporter(order, fullName) {
  const me = norm(fullName);
  if (!me) return false;
  const stamped = norm(order?.reported_by_name);
  if (stamped) return stamped === me;
  return norm(order?.reporter_prod) === me;   // ใบเก่าก่อนมีคอลัมน์ stamp
}

/**
 * ทำขั้นนี้ได้ไหม — ใช้ทั้งตอนซ่อนปุ่มและตอนกดบันทึก
 *
 * opts:
 *   order        แถว mtn_orders
 *   fullName     ชื่อผู้ใช้ปัจจุบัน
 *   can(action)  → boolean   (ผู้เรียกผูก role ไว้แล้ว เช่น a => can('mtn_repair', a, role))
 *   seeded(action) → boolean (คีย์นี้ถูก seed ในตาราง role_permissions แล้วหรือยัง)
 *   inOrderTeam  ผู้ใช้อยู่ทีมช่างเดียวกับใบนี้ไหม (ผู้เรียกคำนวณจาก profiles.mtn_teams)
 *
 * คืน { ok, code } — `code` ไว้ให้จอบอกเหตุผล ห้ามคืนแค่ boolean
 */
export function canDoStep(step, opts = {}) {
  const { order = {}, fullName = '', can = () => false, seeded = () => true, inOrderTeam = false, inReporterScope = null } = opts;

  // ขั้น 1 = แก้ข้อมูลการแจ้ง — ใครแจ้งได้ก็แก้ได้ (พฤติกรรมเดิม)
  if (Number(step) === 1) return can('report') ? { ok: true, code: 'report' } : { ok: false, code: 'denied' };

  const meta = MTN_STEPS[step];
  if (!meta) return { ok: false, code: 'unknown_step' };

  // หัวหน้า (ผู้ถือ manage_master) แก้ย้อนหลังได้ทุกขั้น — พฤติกรรมเดิม ห้ามถอด
  if (can('manage_master')) return { ok: true, code: 'manage_master' };

  // ผู้เปิดใบตรวจรับงานของตัวเองได้เสมอ (ขั้น 4, 6) — ไม่ต้องรอ admin ติ๊ก role และไม่ติด scope
  // (เช็คก่อน perm: เจ้าของใบต้องไม่ถูกล็อกออกด้วยเกณฑ์ scope ไม่ว่ากรณีไหน)
  if (meta.byReporter && isOrderReporter(order, fullName)) return { ok: true, code: 'reporter' };

  /* 🔒 ขั้นของ "ฝ่ายที่แจ้ง" (4/6/7) ทำได้เฉพาะใบในส่วนงานตัวเอง — 2026-09-07 (คำสั่ง user "ลุยข้อ 2")
     inReporterScope: true = ใบอยู่ในขอบเขต · false = อยู่นอกขอบเขต (ล็อก) · null = ตัดสินไม่ได้
     (ผู้ใช้ไม่จำกัด scope / ใบไม่ระบุไลน์ / ไลน์ไม่อยู่ในทะเบียน) = ปล่อยผ่านตามเดิม
     ผู้เรียกคำนวณผ่าน orderInReporterScope() ด้านล่าง — util นี้ยัง pure ไม่แตะทะเบียนไลน์เอง */
  const outOfScope = !!meta.reporterSide && inReporterScope === false;
  if (can(meta.key)) return outOfScope ? { ok: false, code: 'out_of_scope' } : { ok: true, code: 'perm' };

  /* ⚠️ deploy-safe: คีย์ใหม่ที่ยังไม่ apply migration = ไม่มีแถว = fail-closed
     ถ้าไม่ถอยไปคีย์เดิม ใบจะค้างขั้นนั้นทั้งระบบทันทีที่ deploy โค้ดก่อนรัน SQL
     (seed แล้วเมื่อไหร่ เกณฑ์ใหม่มีผลเอง — ไม่ต้องแก้โค้ดซ้ำ) */
  if (meta.fallback && !seeded(meta.key) && can(meta.fallback)) return outOfScope ? { ok: false, code: 'out_of_scope' } : { ok: true, code: 'fallback' };

  // ช่างของทีมนี้ทำขั้น 2-3 ของใบทีมตัวเองได้ (role + profiles.mtn_teams ต้องครบทั้งคู่)
  if (meta.ownTeam && can('service_own_team') && inOrderTeam) return { ok: true, code: 'own_team' };

  return { ok: false, code: 'denied' };
}

/**
 * ตีกลับใบให้ผู้แจ้ง ("Reject MO" ที่ขั้น 2) ได้ไหม — 2026-09-08 (feedback หน้างาน)
 *
 * ตีกลับ = ใบมาผิดแผนก ให้ผู้แจ้งเลือกแผนกใหม่แล้วส่งใหม่ (ไม่ทิ้งใบ · นาฬิกา KPI เริ่มนับใหม่)
 * ทำได้เฉพาะตอนใบ **ยังไม่เดินเลยขั้น 2** — ซ่อมไปแล้ว (ขั้น 3 ขึ้นไป) ตีกลับ = ผลงาน/ลายเซ็น
 * ที่ทำไปจริงหายจากสายตา (สถานะถอยกลับไปขั้น 1) · ปิด/ยกเลิกแล้วยิ่งตีกลับไม่ได้
 *
 * ⚠️ เกณฑ์นี้ต้องใช้ทั้งตอน "วาดกล่องเตือนบนฟอร์ม" และตอน "กดบันทึก" — ห้ามเขียนซ้ำในหน้า
 */
export function canBounceBack(order = {}) {
  if (['closed', 'rejected'].includes(order.status)) return false;
  return Number(order.current_step || 1) <= 2;
}

/**
 * ส่งต่อใบให้ทีมช่างอื่นได้ไหม — "ช่างฝ่ายผลิตดูแล้วเกินมือ ส่งต่อช่างเฉพาะทาง" (2026-09-14 · คำสั่ง user)
 *
 * ⚠️ คนละเรื่องกับ `canBounceBack` (ตีกลับ) — อย่ารวมสองอันนี้เข้าด้วยกัน:
 *   ตีกลับ  = "แจ้งผิดแผนกตั้งแต่แรก" ⇒ ถอยใบไปขั้น 1 หาผู้แจ้ง · ล็อกไว้ที่ขั้น ≤2 เพราะถ้าถอยหลัง
 *             จากขั้น 3 ผลงาน/ลายเซ็นที่ทำจริงจะหายจากใบ
 *   ส่งต่อ  = "แจ้งถูกแล้ว ทีมแรกเข้าไปดูจริงแล้วแต่แก้ไม่ได้" ⇒ **เก็บผลตรวจเบื้องต้นไว้**
 *             (snapshot ลง mtn_order_handoffs) แล้วส่งให้ทีมใหม่รับงานต่อ
 *
 * ทำได้ตั้งแต่รับงานแล้ว (ขั้น 2) จนถึงซ่อม/ตรวจหน้างานเสร็จ (ขั้น 3) — เลยขั้น 4 ไปแล้ว
 * (ฝ่ายที่แจ้งตรวจรับงานแล้ว) ถือว่างานรอบนั้นจบ ถ้ายังมีปัญหาให้ใช้ผลติดตามขั้น 6 หรือเปิดใบใหม่
 */
export function canHandoff(order = {}) {
  if (['closed', 'rejected', 'returned'].includes(String(order?.status || '').trim())) return false;
  const step = Number(order?.current_step || 1);
  return step >= 2 && step <= 3;
}

/**
 * ใบนี้อยู่ใน "ฝ่ายที่แจ้ง" ของผู้ใช้ไหม — ใช้กับขั้น 4/6/7 (reporterSide) เท่านั้น
 *
 * คืน true / false / **null = ตัดสินไม่ได้ → canDoStep ปล่อยผ่านตามเดิม** (หลัก "ไม่รู้ ≠ ไม่ใช่"
 * — การรัดที่ล็อกคนออกต้องมีหลักฐานว่าใบเป็นของฝ่ายอื่นจริง ไม่ใช่แค่หาไม่เจอ)
 *
 * ลำดับตัดสิน:
 *   1. scopeLineNames = null (ผู้ใช้ไม่จำกัด: admin / หน่วยงานช่าง / ไม่มี sections) → null
 *   2. `order.line_name` อยู่ในทะเบียนไลน์ (knownLineNames) → อยู่ในไลน์ที่ผู้ใช้เห็นไหม
 *      (ผู้เรียกกาง scope เป็นครอบครัวไลน์/ไลน์ในส่วนงานมาแล้ว — กฎเหล็ก leader = ทั้งครอบครัว)
 *   3. ไลน์ไม่อยู่ในทะเบียน (แม่พิมพ์ผูก "LINE A ( 800 Ton )" / แผนกสนับสนุน) แต่ใบมี `dept_section`
 *      และผู้ใช้มี sections → เทียบ section ตรงๆ
 *   4. นอกนั้น → null
 *
 * ⚠️ ห้ามเทียบ `order.dept_section` ก่อน `line_name` — ช่อง "แผนก (PD)" ในฟอร์มแจ้งซ่อมพิมพ์แก้ได้
 *    (ข้อมูลจริง 60 วัน: ว่าง ~60% ของใบ) ไลน์ที่เลือกจาก dropdown เชื่อถือได้กว่า
 */
export function orderInReporterScope(order, { scopeLineNames = null, knownLineNames = [], sections = [] } = {}) {
  if (!Array.isArray(scopeLineNames)) return null;
  const ln = norm(order?.line_name);
  if (ln && (knownLineNames || []).some(n => norm(n) === ln)) return scopeLineNames.some(n => norm(n) === ln);
  const ds = norm(order?.dept_section);
  if (ds && (sections || []).length) return sections.some(x => norm(x) === ds);
  return null;
}

/* ═══ ขั้น 5 (QA) — ทุกใบต้องผ่าน QA · "ไม่เกี่ยวกับคุณภาพ" เป็นคำตัดสินของ QA เท่านั้น ═══
   🔴 เปลี่ยน 2026-09-14 (คำสั่ง user): *"คนเลือกว่าเกี่ยวกับคุณภาพต้องเป็น QA เท่านั้น ไม่ใช่คนแจ้ง ·
      คนจะปฏิเสธว่าไม่เกี่ยวต้องเป็น QA เท่านั้น"*
   เดิมช่อง `quality_related` ถูกเลือกที่ **ขั้น 4 โดยผู้เปิดใบ/ฝ่ายที่แจ้ง** ⇒ ผู้แจ้งตัดสินเองได้ว่า
   ใบของตัวเองไม่ต้องให้ QA ตรวจ (วัดจริง 14/09: 152 ใบเลือก "ไม่เกี่ยว" = 61% ของใบที่ผ่านขั้น 4)
   = ด่านคุณภาพที่ผู้ถูกตรวจเป็นคนเปิดเอง · ผังกระบวนการทางการของโรงงานก็ไม่มีกล่อง "ข้าม QA" เลย
   ทั้งสายช่าง PD และสาย MTN — "หน่วยงานคุณภาพตรวจรับงานหลังซ่อม (QA)" อยู่ในเส้นทางหลักทั้งคู่
   ⇒ ใบที่ผ่านขั้น 4 **จอดรอ QA เสมอ** จนกว่า QA จะตรวจจริง หรือ QA กดว่าไม่เกี่ยวกับคุณภาพ

   ค่าที่เก็บใน mtn_orders.quality_related (ข้อความไทยตามฟอร์มกระดาษ — เปลี่ยนแล้วใบเก่าเพี้ยนทั้งฐาน)
   ตอนนี้ **QA เป็นคนเขียนค่านี้ที่ขั้น 5** ไม่ใช่ผู้ตรวจรับที่ขั้น 4 อีกต่อไป
   ⚠️ nextStepFor / ปุ่มข้าม / StepBox ต้องเทียบผ่านตัวนี้ ห้ามพิมพ์ข้อความซ้ำในหน้า */
export const QA_RELATED = 'เกี่ยวกับคุณภาพ';
export const QA_NOT_RELATED = 'ไม่เกี่ยวกับคุณภาพ';

/** ใบนี้ค้างรอ QA อยู่ไหม = ผ่านขั้น 4 แล้ว (status checked) และ QA ยังไม่ได้ตัดสินว่าไม่ต้องตรวจ
 *  ⚠️ ไม่ดู `quality_related` แล้ว — ช่องนั้นเป็นคำตอบของ QA ไม่ใช่ตัวกำหนดว่าจะได้เจอ QA หรือเปล่า
 *  (ใบเก่าที่ข้ามไปก่อนเปลี่ยนกฎถูก stamp `qa_skipped_at` ไว้ใน migration 20260914 จึงไม่ถูกดึงกลับ) */
export const isWaitingQa = (order) =>
  order?.status === 'checked' && !order?.qa_skipped_at;

/** ใบนี้เคยถูก "ข้าม QA" (ไม่เกี่ยวกับคุณภาพ — แก้การตัดสินใจของขั้น 4 ทีหลัง) */
export const isQaSkipped = (order) => !!order?.qa_skipped_at;

/** เหตุผลมาตรฐานของใบเก่าที่ "ข้าม QA" จากการเลือกที่ขั้น 4 — ข้อความเดียวทั้งระบบ
 *  ⚠️ legacy ตั้งแต่ 2026-09-14: ขั้น 4 เลือกเองไม่ได้แล้ว (QA เท่านั้น) ค่านี้เหลือไว้แสดงใบเก่า */
export const QA_SKIP_REASON_STEP4 = 'ขั้น 4 ระบุว่าไม่เกี่ยวกับคุณภาพ';

/** ใบเดินผ่านขั้น 4 (ตรวจรับงานหลังซ่อม) ไปแล้วหรือยัง — ใช้ตัดสินว่า quality_related มีความหมายแล้ว */
const passedStep4 = (order) =>
  ['checked', 'qa', 'handover', 'closed'].includes(String(order?.status || '').trim())
  || Number(order?.current_step || 0) >= 4;

/**
 * ขั้น 5 (QA) ของใบนี้อยู่ในสถานะไหน — จุดเดียวที่ตัดสิน "ตรวจแล้ว / ข้าม / ยังรอ"
 *
 * 🔴 ที่มา 2026-09-09: จอเดิมใช้ `current_step >= 5` เป็นเกณฑ์ "ขั้น 5 เสร็จ" แต่ใบที่ **ข้าม QA**
 *    ไม่เคยขยับ current_step ออกจาก 4 (ข้าม = แก้การตัดสินใจของขั้น 4 ไม่ใช่ขั้นใหม่) ⇒ พอใบเดินต่อไป
 *    ขั้น 6-7 แล้ว current_step ก็เกิน 5 เอง กล่องขั้น 5 จึงขึ้น ✅ เขียว **เหมือน QA ตรวจจริง**
 *    ทั้งที่ไม่มีใครตรวจ (ไม่มีลายเซ็น/ผลคุณภาพ) = ใบพิมพ์/จอโกหกผู้ตรวจสอบ
 *
 * คืน:
 *   'done'    QA ตรวจจริง (มี qa_at / ผลคุณภาพ)
 *   'skipped' ไม่ต้องตรวจ — กด ⏭ ข้าม หรือขั้น 4 ระบุว่า "ไม่เกี่ยวกับคุณภาพ"
 *   'waiting' ค้างรอ QA ตรวจอยู่ (ขั้น 4 ระบุว่าเกี่ยวกับคุณภาพ)
 *   'none'    ใบยังเดินไม่ถึงขั้น 4 — ยังไม่ถึงคิวตัดสิน
 */
export function moQaState(order) {
  if (order?.qa_at || order?.qa_result) return 'done';
  if (isQaSkipped(order)) return 'skipped';
  if (!passedStep4(order)) return 'none';
  // ผ่านขั้น 4 แล้วและยังไม่มีคำตัดสินของ QA = รอ QA เสมอ (2026-09-14 · ไม่ดู quality_related อีกต่อไป)
  return 'waiting';
}

/* ═══ ป้ายสถานะใบ MO — source of truth เดียวของ "ใบนี้รออะไรอยู่" (2026-09-09) ════════════
   🔴 ที่มา (วัดฐานจริง 09/09): ใบค้าง `checked` 76 ใบ + `qa` 64 ใบ = 140 ใบรอขั้น 6 โตวันละ ~20
   ต้นเหตุข้อ 1 = ป้ายเดียว "🧪 รอคุณภาพ/รับมอบ" ใช้กับ 2 สถานการณ์ที่คนละคนต้องกด:
     · ขั้น 4 ระบุ "เกี่ยวกับคุณภาพ"    → รอ QA จริง (ขั้น 5)
     · ขั้น 4 ระบุ "ไม่เกี่ยวกับคุณภาพ" → ไม่ต้องรอ QA เลย รอ **ฝ่ายที่แจ้ง** มารับมอบ (ขั้น 6)
   หน้างานอ่านป้ายเดียวกันว่า "ยังรอ QA" แล้วไม่มีใครกดขั้น 6 → ใบกองค้าง
   ⚠️ **ห้ามเพิ่มค่า `status` ใหม่เพื่อแยก 2 เคสนี้** (KPI/Andon/dieStatus/FactoryMap/TvBoard/edge อ่าน
      status ตรงๆ) — แยกที่ "ป้าย" อย่างเดียว โดย derive จาก status + quality_related เหมือนที่
      `nextStepFor()` ใน MtnRepair.jsx ทำอยู่แล้ว (ป้ายกับปุ่มขั้นถัดไปต้องพูดตรงกันเสมอ)
   ⚠️ ทุกจอที่โชว์ป้ายสถานะ MO ต้องเรียก `moStatusLabel(order)` — ห้ามอ่าน MO_STATUS_LABEL[status]
      ตรงๆ ถ้ามีตัวใบอยู่ในมือ (แผนที่นี้ไว้ใช้เฉพาะที่ไม่มีใบ เช่น dropdown ฟิลเตอร์/หัวกลุ่มสรุป) */
export const MO_STATUS_LABEL = {
  pending:   '📣 รอรับงาน',
  assigned:  '🔧 รับงานแล้ว/รอซ่อม',
  repairing: '🔧 กำลังซ่อม',
  repaired:  '🔎 รอตรวจหลังซ่อม',
  // ไม่มีตัวใบให้ดู = แยกไม่ได้ว่ารอ QA หรือรอรับมอบ → บอกทั้ง 2 ทาง ห้ามเดาทางใดทางหนึ่ง
  checked:   '🧪 รอตรวจคุณภาพ / รอรับมอบ',
  qa:        '🤝 รอรับมอบ',
  handover:  '✍️ รออนุมัติปิด',
  closed:    '✅ ปิด MO',
  returned:  '↩️ ตีกลับ (ผิดแผนก)',
  rejected:  '⛔ Reject MO',
};

export const MO_LABEL_WAIT_QA = '🧪 รอตรวจคุณภาพ (ขั้น 5)';
export const MO_LABEL_WAIT_HANDOVER = '🤝 รอรับมอบ (ขั้น 6)';

/**
 * ป้ายสถานะของใบนี้ (ใช้ที่การ์ด/หัว drawer/บอร์ด/ใบพิมพ์)
 *
 * ⚠️ แถวที่ query มาแบบเลือกคอลัมน์ (`select('id, status, ...')`) อาจไม่มี `quality_related` ติดมาเลย
 *    (= undefined ไม่ใช่ null) → **ห้ามเดา** ให้ถอยไปใช้ป้ายรวมของ MO_STATUS_LABEL
 *    ค่าที่มีจริงแต่ว่าง/null = "ไม่เกี่ยวกับคุณภาพ" ตามเกณฑ์เดียวกับ nextStepFor/isWaitingQa
 */
export function moStatusLabel(order) {
  const st = String(order?.status || '').trim();
  if (st !== 'checked') return MO_STATUS_LABEL[st] || st || MO_STATUS_LABEL.pending;
  // แถวที่ไม่ได้ select `qa_skipped_at` มาด้วย = ตัดสินไม่ได้ว่าข้ามหรือยัง → ใช้ป้ายรวม ห้ามเดา
  if (order?.qa_skipped_at === undefined) return MO_STATUS_LABEL.checked;
  return isWaitingQa(order) ? MO_LABEL_WAIT_QA : MO_LABEL_WAIT_HANDOVER;
}

/**
 * ข้าม QA (ขั้น 5) ไปรับมอบ (ขั้น 6) ได้ไหม — 2026-09-03 (คำสั่ง user: "เรื่องที่ไม่เกี่ยวกับ QA
 * ต้องกดข้ามไปขั้น 6 ได้ ตอนนี้ไม่ได้")
 *
 * ที่มา: ขั้น 4 เลือก "เกี่ยวกับคุณภาพ" แล้วใบไปค้างรอ QA — ถ้าเลือกผิดหรืองานไม่เกี่ยว QA จริง
 *        ไม่มีใครเลื่อนต่อได้นอกจาก QA (ตรวจฐาน 2026-09-03: ค้าง 26 ใบ ทีม PRODUCTION ทั้งหมด)
 *
 * การข้าม = **แก้การตัดสินใจของขั้น 4** ไม่ใช่ขั้นใหม่ → status คง `checked` แล้วพลิก
 * quality_related เป็น "ไม่เกี่ยว" + บันทึกเหตุผล/คน/เวลา (qa_skip_reason/qa_skipped_by/qa_skipped_at)
 * ⇒ nextStepFor พาไปขั้น 6 เอง ไม่ต้องเพิ่ม status ใหม่ (KPI/Andon/ใบพิมพ์ไม่กระทบ)
 *
 * 🔴 ใครข้ามได้ = **ผู้มีสิทธิ์ขั้น 5 (QA) เท่านั้น** — เปลี่ยน 2026-09-14 ตามคำสั่ง user
 *    เดิมยอมให้ผู้ถือสิทธิ์ขั้น 4 (ผู้เปิดใบ / ฝ่ายที่แจ้ง) กดข้ามได้ด้วย ⇒ ฝ่ายที่ถูกตรวจเป็นคน
 *    ตัดสินเองว่าไม่ต้องถูกตรวจ · ตอนนี้ทั้ง "เกี่ยว" และ "ไม่เกี่ยว" เป็นคำตัดสินของ QA ฝั่งเดียว
 *    (หัวหน้าผู้ถือ manage_master ยังผ่านได้ผ่าน canDoStep(5) ตามกฎเดิมของทั้งโมดูล)
 */
export function canSkipQa(opts = {}) {
  if (!isWaitingQa(opts.order)) return { ok: false, code: 'not_waiting_qa' };
  const v5 = canDoStep(5, opts);
  if (v5.ok) return { ok: true, code: `step5:${v5.code}` };
  return { ok: false, code: 'qa_only' };
}

/**
 * ข้อความบอกเหตุผลเมื่อทำไม่ได้ (UI-CONVENTIONS §6.9 — ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล)
 * คืนเป็นโครงสร้าง ไม่ใช่ JSX — ให้หน้าจอวาดเอง
 */
export function stepDenyHint(step, { teamName = '', reporterName = '', outOfScope = false, orderLine = '', orderSection = '' } = {}) {
  const meta = MTN_STEPS[step];
  if (!meta) return null;
  const lines = [`ขั้นนี้เป็นหน้าที่ของ: ${meta.who}`];
  if (outOfScope) {
    // มีสิทธิ์ตามขั้น แต่ใบเป็นของฝ่ายอื่น — บอกให้ตรงเหตุ ไม่งั้นคนจะไปขอ role เพิ่มทั้งที่ไม่ใช่ปัญหา role
    const where = [orderLine, orderSection].filter(Boolean).join(' · ');
    lines.push(`ใบนี้เป็นของ${where ? ` ${where}` : 'ฝ่ายอื่น'} — คุณทำขั้นนี้ได้เฉพาะใบของส่วนงานตัวเอง`);
    if (reporterName) lines.push(`ให้ผู้เปิดใบ “${reporterName}” หรือหัวหน้าของฝ่ายนั้นเป็นคนกด · ถ้าต้องดูแลข้ามส่วนงานจริง ให้ admin เพิ่มส่วนงานให้บัญชีนี้ที่ /add-user`);
    else lines.push('ให้หัวหน้าของฝ่ายนั้นเป็นคนกด · ถ้าต้องดูแลข้ามส่วนงานจริง ให้ admin เพิ่มส่วนงานให้บัญชีนี้ที่ /add-user');
    return lines;
  }
  if (meta.byReporter) {
    lines.push(reporterName
      ? `ใบนี้เปิดโดย “${reporterName}” — เจ้าตัวกดได้เลยโดยไม่ต้องขอสิทธิ์`
      : 'คนที่เปิดใบนี้กดได้เลยโดยไม่ต้องขอสิทธิ์');
    lines.push(`ถ้าเป็นหัวหน้าที่ต้องทำแทน ให้ admin เปิดสิทธิ์ mtn_repair:${meta.key} ให้ role นี้ที่ /permissions`);
  } else if (meta.ownTeam) {
    lines.push(`ถ้าเป็นช่างของทีม ${teamName || 'นี้'} ต้องครบ 2 อย่าง:`);
    lines.push('① เปิดสิทธิ์ mtn_repair:service_own_team ให้ role นี้ที่ /permissions');
    lines.push(`② ตั้ง “🔧 ทีมช่างซ่อม” ของบัญชีนี้เป็น ${teamName || '—'} ที่ /add-user`);
  } else {
    lines.push(`ต้องมีสิทธิ์ mtn_repair:${meta.key} — ให้ admin เปิดให้ role นี้ที่ /permissions`);
  }
  return lines;
}
