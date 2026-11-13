/**
 * pmMonthlySignoff — ✍️ ลงนามรายเดือนของใบ PM ช่าง ขั้น ③ (ทีม) / ④ (ส่วนงาน) · PM รอบ 2 · 2026-11-13
 * ตาราง `pm_monthly_signoffs` — **Main** ("MAIN" · ewhdfqwfwofivojtsizn) · migration `20261113c_pm_monthly_signoffs_main.sql`
 * กฎเหมือน `amMonthlySignoff.js`: ลงนาม = บันทึก (snapshot) · ห้ามลบ · เพิกถอน = revoked + เหตุผล ·
 *   ผู้เรียกต้องส่ง verdict ที่คิด **ตอนกด** · ตารางยังไม่ apply = `missing:true` ให้จอเขียนบอก
 */
import { supabase } from '../supabaseClient'
import { toast } from '../components/Toast'
import { checkWriteRows } from '../utils/dbWrite'
import { pmMonthlyText } from './pmMonthly'

export const PM_SIGNOFF_TABLE = 'pm_monthly_signoffs'
const COLS = 'id, month, kind, scope_key, snapshot, signed_by, signed_by_name, position, position_rank, signature_url, signed_at, note, status, revoked_by_name, revoked_at, revoke_reason'

export const isMissingPmSignoffTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205'
  || (/pm_monthly_signoffs/.test(String(e.message || '')) && /does not exist|could not find/i.test(String(e.message || ''))))

export async function loadPmMonthlySignoffs(month) {
  const { data, error } = await supabase.from(PM_SIGNOFF_TABLE).select(COLS).eq('month', month).order('signed_at', { ascending: false })
  if (error) return { ok: false, rows: [], missing: isMissingPmSignoffTable(error), error: error.message || String(error) }
  return { ok: true, rows: data || [], missing: false }
}

/** แถวที่มีผล: key `${kind}|${scope_key}` → row · revoked เก็บไว้ดูประวัติ */
export function activeSignoffs(rows = []) {
  const m = new Map()
  for (const r of rows) {
    const k = `${r.kind}|${r.scope_key}`
    if (!m.has(k)) m.set(k, { active: null, revoked: [] })
    const e = m.get(k)
    if (r.status === 'signed') { if (!e.active) e.active = r } else e.revoked.push(r)
  }
  return m
}

export async function signPmMonthly({ verdict, kind, month, scopeKey, snapshot, userId, fullName, position, positionRank, signatureUrl, note, opensOn }) {
  if (!verdict?.ok) { toast.error(pmMonthlyText(verdict, { opensOn, kind }) || 'ลงนามไม่ได้'); return false }
  if (!snapshot || !userId) { toast.error('ลงนามไม่ได้ — ยังไม่มีสรุป หรือยังไม่รู้ตัวตนผู้ลงนาม'); return false }
  const res = await supabase.from(PM_SIGNOFF_TABLE).insert({
    month, kind, scope_key: scopeKey, snapshot,
    signed_by: userId, signed_by_name: fullName || null,
    position: position || null, position_rank: positionRank ?? null,
    signature_url: signatureUrl || null, note: (note || '').trim() || null, status: 'signed',
  }).select('id')
  if (res.error?.code === '23505') { toast.error('มีคนลงนามช่องนี้ไปแล้ว (ระหว่างที่คุณเปิดจออยู่) — รีเฟรชเพื่อดูลายเซ็นล่าสุด'); return false }
  if (isMissingPmSignoffTable(res.error)) { toast.error('ยังลงนามไม่ได้ — ตาราง pm_monthly_signoffs ยังไม่ถูกสร้างบน Main'); return false }
  return checkWriteRows(res, kind === 'section_ack' ? 'รับทราบผลตรวจ PM รายเดือน' : 'อนุมัติผลตรวจ PM รายเดือน')
}

export async function revokePmMonthly({ verdict, id, reason, userId, fullName }) {
  if (!verdict?.ok) { toast.error(pmMonthlyText(verdict) || 'เพิกถอนไม่ได้'); return false }
  const res = await supabase.from(PM_SIGNOFF_TABLE).update({
    status: 'revoked', revoked_by: userId, revoked_by_name: fullName || null,
    revoked_at: new Date().toISOString(), revoke_reason: String(reason || '').trim(),
  }).eq('id', id).eq('status', 'signed').select('id')
  return checkWriteRows(res, 'เพิกถอนลายเซ็น', {
    zeroMsg: 'เพิกถอนไม่สำเร็จ: ลายเซ็นนี้ถูกเพิกถอนไปแล้ว หรือบัญชีนี้ไม่มีสิทธิ์ — รีเฟรชแล้วลองใหม่',
  })
}
