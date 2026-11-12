import { supabase } from '../supabaseClient'

/* ══ 🔔 แจ้งเตือนของงานตรวจอุปกรณ์ (PM/AM) ══════════════════════════════ แก้ 2026-11-09

   🔴 **เลิกหาผู้รับเองในไฟล์นี้แล้ว** — ของเดิม `notifyDepartment()` รับ `department` เข้ามา
      แต่เอาไปใช้แค่เลือก "คีย์สิทธิ์" แล้วดึง profiles ด้วย `role` ล้วน **ไม่มีเงื่อนไข
      ส่วนงาน/ทีม/ไลน์เลย** ⇒ ใบ "ผลตรวจ NG" 1 ใบ ยิงถึง **83 คน ข้าม 12 ส่วนงาน**
      (วัด 30 วัน: 1,617 แถว / 9 เหตุการณ์ / อ่าน 4%) · ซ้ำร้าย 4 ใน 5 ทีมแม็ปคีย์เดียวกัน
      (`pm:record`) ⇒ `department` ไม่ได้แยกผู้รับเลยแม้แต่น้อย
   🔴 และเพราะไม่ผ่าน `notify_recipients` ⇒ **ค่าที่ตั้งใน /notification-config ไม่มีผล
      และตัวกรอง "ปิดแจ้งเตือนรายเรื่อง" ของผู้ใช้ก็ไม่ทำงาน** (กฎ CLAUDE.md §Edge Functions)

   ✅ ตอนนี้ยิงผ่าน `notifyEvent()` → edge กลาง → `notify_recipients` เหมือนทั้งระบบ
      ผู้รับ = **ทีมเจ้าของอุปกรณ์ + หัวหน้าส่วนงานนั้น** (คำสั่ง user 09/11)
      · **หัวหน้าส่วนงาน** มาจากทะเบียน (`inapp_match_section`)
      · **ช่างของทีม** ส่งผ่าน `extra_user_ids` (ช่อง "เจ้าของงานของรายการนี้")
        🔑 ทำไมต้องแยก 2 ช่อง: ใน `notify_recipients` แกน "ทีม" กับ "ส่วนงาน" เป็น **AND**
           ส่ง `p_team` ไป = หัวหน้าส่วนงาน (ที่ `mtn_teams` เป็น production) ถูกตัดทิ้ง
           ไม่ส่ง = ช่างถูกตัดทิ้ง (ส่วนงานช่างคือ JIG MTN/Die MTN ไม่ใช่ PD3)
           ⇒ วัดจริง PD3+jig: ส่ง p_team = 12 คน (หัวหน้าหายเหลือ 2) · ไม่ส่ง = 14 คน (ช่างหาย)
      · 🔴 **`extra_user_ids` ฝั่ง edge ตัดที่ 20 คน** — ทีมที่ใหญ่กว่านั้นจะขาด ⇒ เขียนบนจอเตือน
      · อ่านรายชื่อช่างไม่ได้ = ไม่ส่งช่อง extra ไป (ทะเบียนยังยิงหัวหน้าให้) **ไม่เงียบทั้งใบ**
   ⚠️ `createNotification()` ข้างล่างยิงหา "คนเดียวที่ระบุตัว" (ผู้ตรวจ) — ถูกต้องอยู่แล้ว ไม่ต้องแก้
   📄 docs/modules/notify-inapp-audit.md §รอบ 5                                              */
import notifyEvent from '../utils/notifyEvent'

export async function createNotification(userId, { title, body, type = 'info', refTable, refId }) {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    title,
    body,
    type,
    ref_table: refTable ?? null,
    ref_id: refId ?? null,
  })
  if (error) throw error
}

/**
 * แจ้งผลตรวจอุปกรณ์ — ทีมเจ้าของอุปกรณ์ + หัวหน้าส่วนงานของอุปกรณ์นั้น
 * @param {string} department ทีมช่างเจ้าของอุปกรณ์ (mtn_teams.key)
 * @param {{event:string,title:string,body?:string,type?:string,refTable?:string,refId?:string,lineName?:string}} p
 * @returns {Promise<{ownersCapped:boolean, owners:number}>} ให้หน้าจอเตือนได้เมื่อรายชื่อช่างถูกตัด
 */
export async function notifyDepartment(department, { event, title, body, type = 'info', refTable, refId, lineName }) {
  if (!event) throw new Error('notifyDepartment: ต้องระบุ event (คีย์ใน notification_rules)')
  /* ช่างของทีมนี้ = "เจ้าของงาน" ของใบตรวจ — อ่านไม่ได้ก็ยังยิงหัวหน้าตามทะเบียนต่อ (ห้ามเงียบทั้งใบ) */
  let owners = []
  try {
    const { data, error } = await supabase.from('profiles').select('id').contains('mtn_teams', [department])
    if (error) throw error
    owners = (data ?? []).map(r => r.id)
  } catch { owners = [] }

  notifyEvent({
    event,
    title,
    lines: [body].filter(Boolean),
    type,
    line_name: lineName || undefined,
    ref_table: refTable, ref_id: refId,
    extra_user_ids: owners.slice(0, 20),
  })
  return { owners: owners.length, ownersCapped: owners.length > 20 }
}
