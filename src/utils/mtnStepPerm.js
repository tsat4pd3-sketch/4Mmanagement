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

/* ═══ ขั้น 5 (QA) เป็นขั้น "เงื่อนไข" — เข้าเฉพาะใบที่ขั้น 4 ระบุว่าเกี่ยวกับคุณภาพ ═══
   ค่าที่เก็บใน mtn_orders.quality_related (ข้อความไทยตามฟอร์มกระดาษ — เปลี่ยนแล้วใบเก่าเพี้ยนทั้งฐาน)
   ⚠️ nextStepFor / ปุ่มข้าม / StepBox ต้องเทียบผ่านตัวนี้ ห้ามพิมพ์ข้อความซ้ำในหน้า */
export const QA_RELATED = 'เกี่ยวกับคุณภาพ';
export const QA_NOT_RELATED = 'ไม่เกี่ยวกับคุณภาพ';

/** ใบนี้ค้างรอ QA อยู่ไหม = ผ่านขั้น 4 แล้ว (status checked) และขั้น 4 ระบุว่าเกี่ยวกับคุณภาพ */
export const isWaitingQa = (order) =>
  order?.status === 'checked' && String(order?.quality_related || '').trim() === QA_RELATED;

/** ใบนี้เคยถูก "ข้าม QA" (ไม่เกี่ยวกับคุณภาพ — แก้การตัดสินใจของขั้น 4 ทีหลัง) */
export const isQaSkipped = (order) => !!order?.qa_skipped_at;

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
 * ใครข้ามได้ = คนที่ตัดสินเรื่องนี้ได้ในขั้น 4 (ผู้เปิดใบ / accept_work) **หรือ** QA เอง (ขั้น 5)
 * — QA เห็นว่างานไม่ใช่ของตัวเองก็ปล่อยผ่านได้โดยไม่ต้องเซ็นรับรองคุณภาพที่ไม่ได้ตรวจ
 * ช่างที่ซ่อม (service) ข้ามไม่ได้ — เหตุผลเดียวกับที่ช่างตรวจรับงานตัวเองไม่ได้
 */
export function canSkipQa(opts = {}) {
  if (!isWaitingQa(opts.order)) return { ok: false, code: 'not_waiting_qa' };
  const v4 = canDoStep(4, opts);
  if (v4.ok) return { ok: true, code: `step4:${v4.code}` };
  const v5 = canDoStep(5, opts);
  if (v5.ok) return { ok: true, code: `step5:${v5.code}` };
  return { ok: false, code: 'denied' };
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
