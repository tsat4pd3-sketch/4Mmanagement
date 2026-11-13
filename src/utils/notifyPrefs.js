/* ══ 🔕 ตั้งค่าแจ้งเตือนของฉัน — กฎการแบ่งชั้น (2026-11-03 · ข้อเสนอจากหน้างาน ข้อ 4) ══════
 *
 * หน้างานขอ: *"ได้การกรองบาง User ที่แจ้งเตือนเฉพาะเกิด Downtime อย่างเดียว ไม่ต้องแจ้งเตือน Stock
 *   หรือข้อมูลอื่น · เอาไว้ให้หน่วยงาน Support Log in ใน Handheld เวลาออกไปซ่อม"*
 *
 * 🔴 **ห้ามแก้ด้วยการตั้ง role ใหม่** — role ในระบบนี้คือ "ชุดสิทธิ์ใช้ระบบ" เปลี่ยน role เพื่อคุมกระดิ่ง
 *    = สิทธิ์เข้าหน้าของคนนั้นเปลี่ยนตามไปด้วย (CLAUDE.md §Organizational Hierarchy)
 *
 * ── 🔒 "งานที่รอเรา" ปิดไม่ได้ — ล็อก 2 ชั้น (คำสั่ง user 03/11) ─────────────────────────
 *  ชั้นที่ 1 **โครงสร้าง ไม่ต้องมีใครมาติ๊ก** — แจ้งเตือนที่ยิงถึง *เจ้าของงานโดยตรง*
 *    (`extra_user_ids` ใน edge `send-event-notification`) ไม่เคยผ่าน `notify_recipients`
 *    ⇒ ตัวกรองรายคนอยู่ใน RPC นั้น จึงแตะไม่ถึง = **ปิดไม่ได้โดยอัตโนมัติ**
 *  ชั้นที่ 2 **ทะเบียน** — `notification_rules.can_mute = false` สำหรับ "คิวงาน" ที่ยิงตาม role ล้วน
 *    (ไม่มีตัวเจ้าของงาน) เช่น "ใบ MO รอเปิด PR" ที่ยิงหาแอดมินช่างทั้ง role
 *    · admin แก้ได้ที่ `/notification-config` — **เป็นทะเบียน ไม่ใช่โค้ด ห้าม hardcode รายชื่อเรื่องที่นี่**
 *
 * 🔴 ตัวกรองจริงอยู่ฝั่ง DB (`notify_recipients` · migration `20261103_notification_user_prefs_main.sql`)
 *    ไฟล์นี้มีแต่กฎของ "จอ" — ใครเห็นสวิตช์อะไรบ้าง · ห้ามเขียนตรรกะการส่งซ้ำที่นี่
 */

/** ป้ายหมวดของทะเบียนแจ้งเตือน — ของกลาง (จอตั้งค่าแอดมิน + จอของผู้ใช้ อ่านชุดเดียวกัน) */
export const NOTIFY_CATEGORY_LABEL = {
  manpower: '🧑‍🏭 Manpower', production: '🏭 Production', quality: '🔍 Quality',
  maintenance: '🔧 Maintenance', pull: '🎴 Pull System', stock: '📦 Stock',
  logistic: '🚚 Logistic',
  safety: '🛡️ Safety',
  kpi: '📊 KPI / Obeya',
  workflow: '🧩 e-Workflow',
};
export const notifyCategoryLabel = (c) => NOTIFY_CATEGORY_LABEL[c] ?? (c || 'อื่นๆ');

/**
 * เรื่องที่ "คนนี้มีสิทธิ์ได้รับ" — คือเรื่องที่ role ของเขาอยู่ใน `inapp_roles` และทะเบียนเปิดอยู่
 * 🔴 ไม่โชว์เรื่องที่เขาไม่มีทางได้รับอยู่แล้ว — สวิตช์ที่กดแล้วไม่มีผลคือสวิตช์หลอก
 * 🔴 `can_mute === false` = ล็อก (ยังโชว์ แต่กดไม่ได้ + บอกเหตุผล) **ห้ามซ่อน** —
 *    ซ่อนแล้วคนจะคิดว่าปิดได้ทุกอย่างแล้วยังมีแจ้งเตือนโผล่ = งงกว่าเดิม
 * @returns [{ event_key, label, category, locked }] เรียงตามหมวด → sort_order เดิมของทะเบียน
 */
export function myNotifyRows(rules = [], role = '') {
  const r = String(role || '');
  return (rules || [])
    .filter(x => x && x.is_enabled !== false && Array.isArray(x.inapp_roles) && x.inapp_roles.includes(r))
    .map(x => ({
      event_key: x.event_key,
      label: x.label || x.event_key,
      category: x.category || '',
      locked: x.can_mute === false,     // undefined (ยังไม่มีคอลัมน์) = ปิดได้ตามเดิม
    }));
}

/** จัดกลุ่มตามหมวด — คงลำดับที่ส่งเข้ามา (ทะเบียน order ด้วย sort_order แล้ว) */
export function groupNotifyRows(rows = []) {
  const out = [];
  const idx = new Map();
  for (const row of rows || []) {
    const c = row?.category || '';
    if (!idx.has(c)) { idx.set(c, out.length); out.push({ category: c, label: notifyCategoryLabel(c), rows: [] }); }
    out[idx.get(c)].rows.push(row);
  }
  return out;
}

/** แถว prefs จากฐาน → Set ของเรื่องที่ "ปิดอยู่" (ไม่มีแถว = รับตามปกติ) */
export const mutedSetOf = (prefRows = []) =>
  new Set((prefRows || []).filter(p => p && p.muted).map(p => p.event_key));

/**
 * สรุปให้จอเขียนบอก — "ปิดอยู่กี่เรื่อง จากกี่เรื่องที่ปิดได้"
 * 🔴 นับเฉพาะเรื่องที่คนนี้เห็นจริง (ล็อกไม่นับเป็นตัวเลือก) · ไม่มีอะไรให้ปิด = `total 0`
 */
export function muteSummary(rows = [], muted = new Set()) {
  const openable = (rows || []).filter(x => !x.locked);
  return {
    total: openable.length,
    muted: openable.filter(x => muted.has(x.event_key)).length,
    locked: (rows || []).length - openable.length,
  };
}
