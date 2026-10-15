/* mtnTeamOwn — "แถวทะเบียนของช่างนี้ ใครแก้/ลบได้" (pure · ไม่ import อะไรเลย ⇒ เทสเรียกได้ตรงๆ)
   ตัว wrapper ที่ normalize ชื่อทีม→key อยู่ที่ `mtnTeams.js` (teamRowOwner / teamRowLockNote)
   — หน้าจอเรียกตัวนั้น ไม่ต้องเรียกไฟล์นี้ตรงๆ

   รอบแรก (2026-08-11) ใช้กับทะเบียนข้อมูลหลักใน `/mtn-repair?tab=master`
   รอบสอง (2026-10-14 · คำสั่ง user) ขยายมาคุม **คลังอะไหล่** ด้วย:
     user กำลังตั้งหัวหน้าแผนกผลิตเป็น `is_dept_admin` เพื่อให้ "เพิ่มอะไหล่เองได้"
     แต่ bucket dept_admin ถือ `mtn_repair:delete` ติดมาด้วย ⇒ ลบอะไหล่ของทีมอื่นได้
     คำพูด user: *"ให้เพิ่มได้ แต่จะลบมั่วไม่ได้ … เห็นข้ามกันหมด แต่ลบข้ามกันไม่ได้"*

   กติกา (ทะเบียนของช่างทุกตัวต้องใช้กฎเดียวกัน — ของเดียวกันคนละกฎ = คนจำไม่ได้):
     · แถวของทีมตัวเอง            → แก้/ลบได้
     · แถวของทีมอื่น              → **เห็นได้ แต่แก้/ลบไม่ได้** (ไม่ใช่ซ่อน — ต้องบอกเหตุผลบนจอ)
     · แถว 🌐 ของกลาง (ไม่มีทีม)  → เฉพาะ admin/manager (แก้ทีเดียวกระทบทุกทีม)

   🔴 fallback สำคัญ: user ที่ยังไม่ได้ตั้ง `profiles.mtn_teams` = **ไม่ล็อก** (`unscoped`)
      ไม่งั้นวันที่ deploy ช่างที่ยังไม่ถูกตั้งทีมจะแก้อะไรไม่ได้ทั้งระบบ — ห้ามเปลี่ยนเป็น false
   🔴 นี่คือด่าน "เจ้าของ" ล้วน **ไม่ได้แทนด่านสิทธิ์** — ต้องเช็ค can()/canDelete() คู่เสมอ */

/* 🔑 `strict` — สำหรับคีย์ที่ "เพิ่งเกิด" (`mtn_repair:spare_master` · 14/10)
   `unscoped` มีไว้กันของเก่าพัง: ผู้ถือ `manage_master` มีมาก่อนระบบทีม ⇒ ล็อกย้อนหลัง = ช่างทำงานไม่ได้
   แต่คีย์ใหม่ยัง**ไม่มีใครถือ** ⇒ ไม่มีของเก่าให้พัง ⇒ บังคับได้ตั้งแต่วันแรกว่า "ต้องมีทีมก่อน"
   (ถ้าปล่อย unscoped ด้วย: supervisor 79% ยังไม่ได้ตั้ง mtn_teams = ด่านไม่ทำงานกับคนที่เราเพิ่งให้คีย์
    ซึ่งแปลว่าด่านนี้แทบไม่มีผลเลย) · ไม่มีทีม = **เพิ่มของใหม่ได้ แต่ไปแก้/ลบของใครไม่ได้**
 * @param {string} rowTeamKey ทีมเจ้าของแถว (key ที่ normalize แล้ว · '' = ของกลาง)
 * @param {string[]} myTeamKeys ทีมของ user (key ที่ normalize แล้ว · [] = ยังไม่ตั้งทีม)
 * @returns {{ ok: boolean, code: 'boss'|'unscoped'|'own'|'other'|'common'|'no_team' }} */
export function teamRowOwnerKeys(rowTeamKey, myTeamKeys, role, { strict = false } = {}) {
  if (role === 'admin' || role === 'manager') return { ok: true, code: 'boss' }
  const mine = (Array.isArray(myTeamKeys) ? myTeamKeys : []).filter(Boolean)
  if (!mine.length) return strict ? { ok: false, code: 'no_team' } : { ok: true, code: 'unscoped' }
  const t = String(rowTeamKey || '').trim()
  if (!t) return { ok: false, code: 'common' }
  return mine.includes(t) ? { ok: true, code: 'own' } : { ok: false, code: 'other' }
}
