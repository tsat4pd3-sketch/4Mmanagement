/* ── 🏷️ "ป้ายราคา" ของกฎแจ้งเตือน — src/utils/notifReach.js (2026-09-17) ───────────
 *
 * คำสั่ง user: *"ป้ายราคาโชว์ตอนเลือกติ๊กคอนฟิค จะได้รู้"* + *"ตอนนี้มันเลือกแค่ role
 * แต่ไม่เลือกส่วนงานหรือแผนก มันเลยข้ามกันหมด บางอย่างเกี่ยวกับเลเวล supervisor
 * แต่ไม่เกี่ยวกับแผนกนั้นก็ไม่ควรแจ้ง"*
 *
 * ที่มา (วัดจริง 17/09): เหตุการณ์จริงทั้งระบบมีแค่ ~69/วัน แต่กลายเป็น **3,844 แถว/วัน**
 * เพราะตัวคูณผู้รับเฉลี่ย 56 คน/เหตุการณ์ (ใบซ่อม = 99 คน/ใบ · 8 ขั้น × ~50 คน)
 * **คนอ่านแค่ 8%** · 41 กฎที่มีผู้รับ — 19 กฎไม่กรองอะไรเลย · ระบุส่วนงาน/แผนกเอง **0 กฎ**
 * ⇒ ไม่มีใครตั้งผิด แค่ "ติ๊กเผื่อไว้ก่อน" เพราะตอนติ๊กไม่เห็นว่าแปลว่ากี่แถว/วัน
 *
 * ไฟล์นี้ = สูตร + เกณฑ์เตือน (pure · มีเทส) · ตัวเลขดิบมาจาก RPC `notif_rule_reach()`
 * **ห้ามคำนวณซ้ำในหน้า** — หน้าแค่เอาผลลัพธ์ไปวาด
 */

/** ต่ำกว่านี้ = ยังไม่พอบอกอะไร (เพิ่งเปิดใช้/เหตุการณ์ไม่เคยเกิด) — ห้ามสรุปว่า "ไม่มีคนอ่าน" */
export const MIN_ROWS_FOR_READ = 30;
/** ผู้รับต่อเหตุการณ์เกินนี้ = กว้างผิดปกติ (ทั้งระบบมี 94 คน) */
export const WIDE_AUDIENCE = 30;
/** อ่านต่ำกว่านี้ = สัญญาณว่าคนเลิกอ่าน */
export const LOW_READ_PCT = 20;
/** สัดส่วนแถวที่ส่งให้ "คนที่ไม่เคยเปิดอ่านเรื่องนี้เลย" เกินนี้ = ยิงผิดคน ไม่ใช่แค่ยิงเยอะ (2026-09-23) */
export const HIGH_WASTE_PCT = 50;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const div = (a, b) => (b > 0 ? a / b : null);

/**
 * แปลงแถวดิบจาก RPC + กฎ → ตัวเลขที่คนตั้งค่าต้องเห็น
 * @param {object} rule  แถว notification_rules (inapp_roles/inapp_sections/inapp_depts/inapp_match_section)
 * @param {object} raw   แถวจาก notif_rule_reach() ของ event_key เดียวกัน (ไม่มี = null)
 */
export function reachOf(rule, raw) {
  const roles = Array.isArray(rule?.inapp_roles) ? rule.inapp_roles : [];
  const peopleAll = num(raw?.people_all);
  const noSection = num(raw?.people_no_section);
  const adminMgr  = num(raw?.people_admin_mgr);
  const nSections = Math.max(1, num(raw?.n_sections) || 1);
  const days      = Math.max(1, num(raw?.days_n) || 14);
  const rows      = num(raw?.rows_n);
  const read      = num(raw?.read_n);
  const events    = num(raw?.events_n);
  /* 🗑️ ความเสียเปล่า — แถวที่ส่งให้คนที่ **ไม่เคยเปิดอ่านเรื่องนี้เลยสักครั้ง** ในช่วงที่วัด
     ต่างจาก readPct ตรงที่มันชี้ "ยิงผิดคน" ไม่ใช่ "ยิงถูกคนแต่เขาไม่ว่าง"
     (RPC `notif_rule_reach` คืน waste_n/dead_n ตั้งแต่ migration 20260923c) */
  const waste     = num(raw?.waste_n);
  const deadUsers = num(raw?.dead_n);

  /* กรองตามส่วนงานจริงไหม — `inapp_sections`/`inapp_depts` = ระบุเองแบบตายตัว
     `inapp_match_section` = ตามส่วนงานที่เกิดเหตุ */
  const pinned   = (rule?.inapp_sections?.length || 0) + (rule?.inapp_depts?.length || 0) > 0;
  const matchSec = !!rule?.inapp_match_section;
  const scoped   = pinned || matchSec;
  /* `inapp_scope_strict` (2026-09-21) = กฎนี้ไม่ยกเว้น admin/ผจก. จากการกรองส่วนงาน
     ⇒ กลุ่มที่ "ผ่านตัวกรองเสมอ" เหลือแค่คนที่ยังไม่ได้ตั้งส่วนงาน (และเป็น scope_depth='all') */
  const strict   = !!rule?.inapp_scope_strict;

  /* ผู้รับต่อ 1 เหตุการณ์:
     ไม่กรอง            → ทุกคนที่ role ตรง
     กรองตามที่เกิดเหตุ → คนที่ "รั่วผ่านตัวกรองเสมอ" + ส่วนแบ่งของคนที่มีส่วนงานจริง
       · 🔭 25/09: ทั้ง 2 กลุ่มนี้รั่วได้**ต่อเมื่อ `profiles.scope_depth='all'`** แล้ว
         (migration 20260925_notify_recipients_scope_depth_main) — RPC `notif_rule_reach`
         นับเงื่อนไขเดียวกัน ⇒ ตัวเลขที่เข้ามาที่นี่คือ "คนที่รั่วได้จริง" ไม่ใช่ทุก admin/ผจก.
       · admin/manager ที่ประกาศว่าทั้งโรงงาน → `notify_recipients()` ยกเว้นจากการกรอง
       · คนที่ไม่มี section เลย + ประกาศทั้งโรงงาน → ปล่อยผ่านทุกส่วนงาน (ช่างซ่อม 9 คน)
     `inapp_sections`/`inapp_depts` ระบุเอง = ประมาณไม่ได้จากตัวเลขชุดนี้ → คืน null (ไม่เดา) */
  const alwaysThrough = Math.min(peopleAll, (strict ? 0 : adminMgr) + noSection);
  let perEvent = peopleAll;
  if (pinned) perEvent = null;                       // ระบุส่วนงาน/แผนกเอง = ประมาณไม่ได้ ห้ามเดา
  else if (matchSec) {
    const rest = Math.max(0, peopleAll - alwaysThrough);
    perEvent = Math.round(alwaysThrough + rest / nSections);
  }

  const eventsPerDay = div(events, days);
  const rowsPerDay   = div(rows, days);
  const estRowsPerDay = perEvent != null && eventsPerDay != null ? perEvent * eventsPerDay : null;
  const readPct  = rows >= MIN_ROWS_FOR_READ ? Math.round((read / rows) * 100) : null;
  const wastePct = rows >= MIN_ROWS_FOR_READ ? Math.round((waste / rows) * 100) : null;

  return {
    roles, peopleAll, perEvent, scoped, pinned, matchSec, strict,
    alwaysThrough,
    noSection, adminMgr, nSections,
    eventsPerDay, rowsPerDay, estRowsPerDay, readPct,
    waste, deadUsers, wastePct,
    rows, days,
    /** ยังไม่มีประวัติพอจะบอกอะไร — จอต้องเขียนว่า "ยังไม่รู้" ห้ามโชว์ 0 */
    thin: rows < MIN_ROWS_FOR_READ,
  };
}

/**
 * คำเตือนที่ต้องขึ้นข้างป้ายราคา — เรียงจากแรงไปเบา
 * คืน [{ level:'red'|'amber', text }] · ไม่มีปัญหา = []
 */
export function reachWarnings(rule, raw) {
  const r = reachOf(rule, raw);
  const out = [];
  if (!r.roles.length) return out;            // ยังไม่เลือกผู้รับ = ไม่ต้องเตือนอะไร

  if (!r.scoped && r.peopleAll > WIDE_AUDIENCE) {
    out.push({ level: 'red',
      text: `ไม่ได้จำกัดส่วนงาน — ${r.roles.join('/')} ทุกแผนกได้รับหมด (${r.peopleAll} คน) แม้ไม่เกี่ยวกับแผนกตัวเอง` });
  } else if (!r.scoped) {
    out.push({ level: 'amber', text: `ยังไม่จำกัดส่วนงาน — ทุกแผนกได้รับ (${r.peopleAll} คน)` });
  }

  if (r.matchSec && r.alwaysThrough > 0) {
    const bits = [];
    if (!r.strict && r.adminMgr > 0) bits.push(`admin/ผจก. ${r.adminMgr} คน ที่ตั้งขอบเขต “ทั้งโรงงาน”`);
    if (r.noSection > 0) bits.push(`คนที่ยังไม่ได้ตั้งส่วนงาน ${r.noSection} คน`);
    out.push({ level: 'amber',
      text: `ตัวกรองส่วนงานไม่มีผลกับ ${bits.join(' · ')} — กลุ่มนี้ได้รับทุกส่วนงาน` });
  }

  /* 🗑️ ยิงผิดคน — ชี้ตรงกว่า "อ่านน้อย" เพราะบอกว่ามีคนกลุ่มหนึ่งที่ไม่เคยแตะเรื่องนี้เลย
     รูทคอส: ทะเบียนถามว่า "คนประเภทไหนควรรู้" แทน "ใครต้องลงมือกับรายการนี้"
     ⇒ ทางแก้ที่ถูกคือส่งถึงเจ้าของงาน (`inapp_cast = 'fallback'`) ไม่ใช่เล็ม role ไปเรื่อยๆ */
  if (r.wastePct != null && r.wastePct >= HIGH_WASTE_PCT) {
    out.push({ level: 'red',
      text: `${r.waste.toLocaleString()} จาก ${r.rows.toLocaleString()} ครั้ง (${r.wastePct}%) ส่งให้คน ${r.deadUsers} คน`
          + ` ที่ไม่เคยเปิดอ่านเรื่องนี้เลยสักครั้งใน ${r.days} วัน — คนกลุ่มนี้ไม่ใช่คนที่ต้องลงมือ` });
  } else if (r.readPct != null && r.readPct < LOW_READ_PCT) {
    out.push({ level: 'amber',
      text: `${r.days} วันที่ผ่านมาส่งไป ${r.rows.toLocaleString()} ครั้ง คนเปิดอ่าน ${r.readPct}% — ลองลดผู้รับ หรือเปลี่ยนเป็นสรุปรายรอบ` });
  }
  return out;
}

/** ข้อความป้ายราคาแบบสั้น (ใต้แถวติ๊ก role) */
export function reachLabel(rule, raw) {
  const r = reachOf(rule, raw);
  if (!r.roles.length) return 'ยังไม่เลือกผู้รับ — เรื่องนี้ไม่เข้ากระดิ่ง';
  const parts = [];
  parts.push(r.perEvent == null
    ? `≤ ${r.peopleAll} คน (จำกัดส่วนงานไว้)`
    : `≈ ${r.perEvent} คน/ครั้ง`);
  if (r.eventsPerDay != null && r.eventsPerDay > 0) {
    const ev = r.eventsPerDay >= 1 ? Math.round(r.eventsPerDay) : r.eventsPerDay.toFixed(1);
    parts.push(`เกิด ${ev} ครั้ง/วัน`);
    if (r.estRowsPerDay != null) parts.push(`≈ ${Math.round(r.estRowsPerDay).toLocaleString()} แจ้งเตือน/วัน`);
  } else {
    parts.push(`ยังไม่มีสถิติ ${r.days} วันล่าสุด`);
  }
  if (r.readPct != null) parts.push(`เปิดอ่าน ${r.readPct}%`);
  return parts.join(' · ');
}
