/* ── permFreshness — "สิทธิ์/ขอบเขตของฉันถูกแก้ไปแล้วหรือยัง" (2026-11-03 · feedback ประชุมหน้างาน 02/11 ข้อ A5) ──
   อาการจริง: "cache ยังมีปัญหาเรื่องสิทธิ์" — แอดมินแก้ role/ขอบเขตที่ /add-user หรือติ๊กสิทธิ์ที่
   /permissions แล้ว **เครื่องของคนที่ถูกแก้ยังเห็นเมนู/ปุ่มชุดเดิม** จนกว่าจะรีเฟรช/ล้างข้อมูลเบราว์เซอร์

   ต้นเหตุ (ฝั่ง client — ฝั่ง DB `has_perm()` อ่านสดทุกคิวรีอยู่แล้ว):
   1. **โปรไฟล์ตัวเอง** (`role` · `sections` · `resp_cost_centers` · `is_dept_admin` · `line_id` · `mtn_teams`
      · `account_kind` · `scope_depth` + มอบหมาย `org_assignments`) โหลดครั้งเดียวใน `fetchProfile()` (App.jsx)
      ตอน auth event เท่านั้น ⇒ แท็บที่เปิดค้าง (แท็บเล็ต/จอ TV/PC ที่ไม่เคยปิด) ถือค่าเดิมไปเรื่อยๆ
      `profiles` **ไม่อยู่ใน publication realtime** และไม่ควรเข้า (ทุกแถวของทุกคนจะวิ่งถึงทุกเครื่อง)
   2. **`role_permissions`** มี realtime อยู่แล้ว แต่ realtime **ไม่ replay event ที่พลาด** ตอน socket หลุด
      (แท็บเล็ตพักจอ/เน็ตสะดุด) ⇒ เครื่องที่หลับตอนแอดมินติ๊ก = ค้างสิทธิ์เก่าเงียบๆ

   ทางแก้: "probe ลายเซ็น" ขนาดเล็ก (ไม่กี่สิบไบต์) ตอนกลับมาที่แท็บ / ทุกรอบกันเหนียว
     · โปรไฟล์ = `profiles.updated_at` (trigger `trg_set_updated_at` คุม) + แถว `org_assignments` ของตัวเอง
       (+ วันทำงาน เมื่อมีมอบหมาย — มอบหมายเริ่ม/หมดอายุตามวัน `isGranting()` ไม่มีแถวไหนเปลี่ยน)
     · สิทธิ์ = จำนวนแถว + `max(updated_at)` ของ `role_permissions` (trigger คุม · นับแถวไว้จับการลบ)
   ลายเซ็นเปลี่ยน ⇒ โหลดชุดเต็มใหม่ (โปรไฟล์ / ตารางสิทธิ์) — ไม่เปลี่ยน = ไม่ยิงชุดเต็ม (กฎ egress ข้อ 11)

   ไฟล์นี้ = กฎล้วน (pure · มีเทส) · ตัวยิงคิวรี/ผูกเหตุการณ์ = `usePermFreshness.js`
   🔴 ห้ามเอา probe นี้ไปตัดสินสิทธิ์ — มันตอบแค่ "ควรโหลดใหม่ไหม" · สิทธิ์จริงยังอยู่ `permissions.js` */

/** ลายเซ็นของแถวมอบหมาย — เรียงก่อนเสมอ (ลำดับจาก DB ไม่รับประกัน = จะดูเหมือนเปลี่ยนทุกรอบ) */
function assignKey(rows, today) {
  if (!Array.isArray(rows)) return null;
  if (!rows.length) return '∅';
  const parts = rows
    .map(r => [r?.id, r?.org_node_id, r?.kind, r?.scope_depth, r?.starts_on, r?.ends_on].map(v => v ?? '').join(','))
    .sort();
  /* มีมอบหมาย ⇒ ใส่วันทำงานด้วย: วันเริ่ม/วันหมดอายุมาถึงโดยไม่มีแถวไหนเปลี่ยน
     (overlay คิด `isGranting(row, today)` ตอนอ่าน — ไม่มี cron) ⇒ ข้ามวันต้องคิดขอบเขตใหม่ */
  return `${today || ''}#${parts.join(';')}`;
}

/**
 * สร้างลายเซ็นจากผล probe — ส่วนที่อ่านไม่ได้ (คิวรีล้ม) = `null` = "ไม่รู้" ไม่ใช่ "เปลี่ยน"
 * @param {object} p
 * @param {string|null} p.profileUpdatedAt  profiles.updated_at ของตัวเอง (null = อ่านไม่ได้)
 * @param {Array|null}  p.assignRows        แถว org_assignments ของตัวเอง (null = อ่านไม่ได้)
 * @param {string}      p.today             วันทำงาน (getWorkDate) — ใช้เมื่อมีมอบหมายเท่านั้น
 * @param {number|null} p.permCount         จำนวนแถว role_permissions (null = อ่านไม่ได้)
 * @param {string|null} p.permMaxUpdatedAt  max(updated_at) ของ role_permissions
 * @returns {{ profile: string|null, perms: string|null }}
 */
export function permProbeSignature({ profileUpdatedAt, assignRows, today, permCount, permMaxUpdatedAt } = {}) {
  const ak = assignKey(assignRows, today);
  const profile = (profileUpdatedAt == null || ak == null) ? null : `${profileUpdatedAt}|${ak}`;
  const perms = (permCount == null || !Number.isFinite(Number(permCount)))
    ? null : `${Number(permCount)}|${permMaxUpdatedAt ?? ''}`;
  return { profile, perms };
}

/**
 * เทียบลายเซ็นรอบก่อนกับรอบนี้ → ส่วนไหนต้องโหลดใหม่
 *  · รอบแรก (prev ว่าง/ส่วนนั้นยังไม่มี baseline) = **ไม่โหลด** — แค่จดเป็น baseline
 *    (ตอน login `fetchProfile`/`loadPermissions` โหลดชุดเต็มไปแล้ว)
 *  · ส่วนที่รอบนี้อ่านไม่ได้ (`null`) = ไม่โหลด และคง baseline เดิมไว้ (ดู mergePermSignature)
 */
export function diffPermSignature(prev, next) {
  const changed = (k) => !!(prev && prev[k] != null && next && next[k] != null && prev[k] !== next[k]);
  return { profile: changed('profile'), perms: changed('perms') };
}

/** baseline ใหม่หลัง probe — ส่วนที่อ่านไม่ได้รอบนี้ คงของเดิม (เน็ตสะดุดต้องไม่ลบ baseline) */
export function mergePermSignature(prev, next) {
  return {
    profile: next?.profile ?? prev?.profile ?? null,
    perms:   next?.perms   ?? prev?.perms   ?? null,
  };
}

/** probe รอบนี้ได้ไหม — เพดานกันยิงรัว (focus + visibilitychange มาคู่กันเสมอ) */
export function shouldProbe(now, lastProbeAt, minGapMs) {
  if (!lastProbeAt) return true;
  return now - lastProbeAt >= minGapMs;
}

/**
 * "ขอบเขต/ตัวตนที่มีผลกับสิทธิ์" ของบัญชี — ใช้ตัดสินว่าจะเตือนผู้ใช้ไหมหลังโหลดโปรไฟล์ใหม่
 * (updated_at ขยับได้จากการแก้ของตัวเอง เช่น รูปโปรไฟล์/ลายเซ็น — แบบนั้น**ไม่ต้อง**เตือน)
 */
export function profileScopeKey(p = {}) {
  const arr = (v) => (Array.isArray(v) ? [...v].map(String).sort().join(',') : '');
  return [
    p.role ?? '', p.lineId ?? '', p.team ?? '', p.section ?? '',
    arr(p.sections), arr(p.respCcs), p.isDeptAdmin ? '1' : '0',
    arr(p.mtnTeams), p.accountKind ?? '', p.scopeDepth ?? '',
  ].join('|');
}
