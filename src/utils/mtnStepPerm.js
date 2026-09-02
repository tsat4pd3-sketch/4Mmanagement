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
    key: 'accept_work', fallback: 'service', ownTeam: false, byReporter: true,
    icon: '☑️', title: 'ตรวจรับงานหลังซ่อม',
    who: 'ผู้เปิดใบแจ้งซ่อม (ฝ่ายที่แจ้ง)', whoShort: 'ผู้เปิดใบ',
  },
  5: {
    key: 'qa', fallback: null, ownTeam: false, byReporter: false,
    icon: '🧪', title: 'ตรวจคุณภาพหลังซ่อม',
    who: 'QA', whoShort: 'QA',
  },
  6: {
    key: 'handover', fallback: 'report', ownTeam: false, byReporter: true,
    icon: '🤝', title: 'รับมอบ / ติดตามผล',
    who: 'หัวหน้าแผนกของฝ่ายที่แจ้ง', whoShort: 'หัวหน้าแผนกผู้แจ้ง',
  },
  7: {
    key: 'approve', fallback: null, ownTeam: false, byReporter: false,
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
  const { order = {}, fullName = '', can = () => false, seeded = () => true, inOrderTeam = false } = opts;

  // ขั้น 1 = แก้ข้อมูลการแจ้ง — ใครแจ้งได้ก็แก้ได้ (พฤติกรรมเดิม)
  if (Number(step) === 1) return can('report') ? { ok: true, code: 'report' } : { ok: false, code: 'denied' };

  const meta = MTN_STEPS[step];
  if (!meta) return { ok: false, code: 'unknown_step' };

  // หัวหน้า (ผู้ถือ manage_master) แก้ย้อนหลังได้ทุกขั้น — พฤติกรรมเดิม ห้ามถอด
  if (can('manage_master')) return { ok: true, code: 'manage_master' };

  if (can(meta.key)) return { ok: true, code: 'perm' };

  /* ⚠️ deploy-safe: คีย์ใหม่ที่ยังไม่ apply migration = ไม่มีแถว = fail-closed
     ถ้าไม่ถอยไปคีย์เดิม ใบจะค้างขั้นนั้นทั้งระบบทันทีที่ deploy โค้ดก่อนรัน SQL
     (seed แล้วเมื่อไหร่ เกณฑ์ใหม่มีผลเอง — ไม่ต้องแก้โค้ดซ้ำ) */
  if (meta.fallback && !seeded(meta.key) && can(meta.fallback)) return { ok: true, code: 'fallback' };

  // ผู้เปิดใบตรวจรับงานของตัวเองได้เสมอ (ขั้น 4, 6) — ไม่ต้องรอ admin ติ๊ก role
  if (meta.byReporter && isOrderReporter(order, fullName)) return { ok: true, code: 'reporter' };

  // ช่างของทีมนี้ทำขั้น 2-3 ของใบทีมตัวเองได้ (role + profiles.mtn_teams ต้องครบทั้งคู่)
  if (meta.ownTeam && can('service_own_team') && inOrderTeam) return { ok: true, code: 'own_team' };

  return { ok: false, code: 'denied' };
}

/**
 * ข้อความบอกเหตุผลเมื่อทำไม่ได้ (UI-CONVENTIONS §6.9 — ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล)
 * คืนเป็นโครงสร้าง ไม่ใช่ JSX — ให้หน้าจอวาดเอง
 */
export function stepDenyHint(step, { teamName = '', reporterName = '' } = {}) {
  const meta = MTN_STEPS[step];
  if (!meta) return null;
  const lines = [`ขั้นนี้เป็นหน้าที่ของ: ${meta.who}`];
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
