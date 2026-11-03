/**
 * amMonthlySignoff — ✍️ หัวหน้าแผนก/ส่วน "ลงนามทบทวน AM รายเดือน" (ขั้น 3 ของสาย AM · 2026-11-03)
 * ตาราง `am_monthly_signoffs` — **Main** ("MAIN" · ewhdfqwfwofivojtsizn) เพราะลายเซ็นต้องผูกตัวตนที่ login จริง
 *   (`auth.uid()` + `has_perm('am:monthly_signoff')`) · ฝั่ง DR เป็น anon เสมอ = ตรวจตัวคนไม่ได้
 *   อ้างอิงไลน์/เดือน/กะเป็น text (ใบตรวจอยู่ DR ข้าม project ผูก FK ไม่ได้)
 * migration `supabase/migrations/20261103_am_monthly_signoffs_main.sql`
 *
 * 🔴 กฎของโมดูลนี้ (📄 docs/modules/am-pm-linkage-audit.md §7)
 *   1. ลงนาม = **บันทึก** — เก็บ `snapshot` สรุปของไลน์ ณ ตอนลงนาม · ตัวเลขสดต่างจาก snapshot = จอเขียนบอก
 *   2. **ห้ามลบ** — เพิกถอน = `status='revoked'` + เหตุผล (ไม่มี policy/GRANT delete · trigger ล็อกเนื้อแถว)
 *   3. ด่านซ้ำตอนเขียนจริง: ผู้เรียกต้องส่ง verdict ที่คิด **ตอนกด** (`amMonthlySignoffVerdict`) — ไม่ ok = ไม่เขียน
 *   4. ตารางยังไม่ apply = `missing:true` → จอเขียนบอก ห้ามเงียบ / ห้ามโชว์ "ยังไม่มีใครลงนาม"
 */
import { supabase } from '../supabaseClient'
import { toast } from '../components/Toast'
import { checkWriteRows } from '../utils/dbWrite'
import { amMonthlySignoffText } from '../utils/amApproval'

export const AM_SIGNOFF_TABLE = 'am_monthly_signoffs'
const COLS = 'id, month, line_name, shift, snapshot, signed_by, signed_by_name, position, position_rank, signature_url, signed_at, note, status, revoked_by, revoked_by_name, revoked_at, revoke_reason'

/** error นี้แปลว่า "ตารางยังไม่ถูกสร้าง" ไหม (42P01 = Postgres · PGRST205 = PostgREST schema cache) */
export const isMissingTableError = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205'
  || (/am_monthly_signoffs/.test(String(e.message || '')) && /does not exist|could not find/i.test(String(e.message || ''))))

/**
 * โหลดลายเซ็นของเดือน+กะ (ทั้งที่มีผลและที่เพิกถอนแล้ว — จอโชว์ประวัติการเพิกถอน)
 * @returns {Promise<{ ok:boolean, rows:object[], missing:boolean, error?:string }>}
 */
export async function loadAmMonthlySignoffs({ month, shift }) {
  const { data, error } = await supabase.from(AM_SIGNOFF_TABLE).select(COLS)
    .eq('month', month).eq('shift', shift)
    .order('signed_at', { ascending: false })
  if (error) return { ok: false, rows: [], missing: isMissingTableError(error), error: error.message || String(error) }
  return { ok: true, rows: data || [], missing: false }
}

/** แถวที่มีผลอยู่ของแต่ละไลน์ (status='signed') + จำนวนที่เคยเพิกถอน */
export function signoffsByLine(rows = []) {
  const m = new Map()
  for (const r of rows) {
    const k = r.line_name
    if (!m.has(k)) m.set(k, { active: null, revoked: [] })
    const e = m.get(k)
    if (r.status === 'signed') { if (!e.active) e.active = r } else e.revoked.push(r)
  }
  return m
}

/**
 * ลงนาม — ⚠️ ผู้เรียกต้องคิด `verdict` ใหม่ตอนกด (ไม่ใช่ค่าที่คิดตอน render) แล้วส่งมา
 * @returns {Promise<boolean>} true = บันทึกสำเร็จจริง (นับแถวแล้ว)
 */
export async function signAmMonthly({ verdict, opensOn, month, shift, lineName, snapshot, userId,
  fullName, position, positionRank, signatureUrl, note }) {
  if (!verdict?.ok) { toast.error(amMonthlySignoffText(verdict, { opensOn }) || 'ลงนามไม่ได้'); return false }
  if (!snapshot || !userId) { toast.error('ลงนามไม่ได้ — ยังไม่มีสรุปของไลน์นี้ หรือยังไม่รู้ตัวตนผู้ลงนาม'); return false }
  const res = await supabase.from(AM_SIGNOFF_TABLE).insert({
    month, shift, line_name: lineName, snapshot,
    signed_by: userId, signed_by_name: fullName || null,
    position: position || null, position_rank: positionRank ?? null,
    signature_url: signatureUrl || null, note: (note || '').trim() || null,
    status: 'signed',
  }).select('id')
  if (res.error?.code === '23505') {
    toast.error('ไลน์นี้มีคนลงนามเดือน/กะนี้ไปแล้ว (เพิ่งลงนามระหว่างที่คุณเปิดจออยู่) — รีเฟรชเพื่อดูลายเซ็นล่าสุด')
    return false
  }
  if (isMissingTableError(res.error)) {
    toast.error('ยังลงนามไม่ได้ — ตาราง am_monthly_signoffs ยังไม่ถูกสร้างบน Main (รอ admin apply migration)')
    return false
  }
  return checkWriteRows(res, 'ลงนามทบทวน AM รายเดือน')
}

/**
 * เพิกถอน (ห้ามลบ) — เขียนเฉพาะแถวที่ยังมีผล (`.eq('status','signed')`) ⇒ คนอื่นเพิกถอนไปก่อน = 0 แถว = แจ้ง
 * @returns {Promise<boolean>}
 */
export async function revokeAmMonthly({ verdict, id, reason, userId, fullName }) {
  if (!verdict?.ok) { toast.error(amMonthlySignoffText(verdict) || 'เพิกถอนไม่ได้'); return false }
  const res = await supabase.from(AM_SIGNOFF_TABLE).update({
    status: 'revoked', revoked_by: userId, revoked_by_name: fullName || null,
    revoked_at: new Date().toISOString(), revoke_reason: String(reason || '').trim(),
  }).eq('id', id).eq('status', 'signed').select('id')
  return checkWriteRows(res, 'เพิกถอนลายเซ็น', {
    zeroMsg: 'เพิกถอนไม่สำเร็จ: ลายเซ็นนี้ถูกเพิกถอนไปแล้ว หรือบัญชีนี้ไม่มีสิทธิ์ "AM: ลงนามทบทวนรายเดือน" — รีเฟรชแล้วลองใหม่',
  })
}
