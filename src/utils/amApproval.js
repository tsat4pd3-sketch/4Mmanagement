/* ═══ ✍️ สายอนุมัติผลตรวจ AM — ไล่ตามลำดับชั้น ห้ามข้ามไปผู้จัดการ ═══  2026-11-02 (ประชุมหน้างาน B2)
   ลำดับปกติของ AM: พนักงานตรวจทุกต้นกะ → **หัวหน้ากลุ่มรับทราบ (รายวัน)** → **หัวหน้าแผนก/ส่วนทบทวน (รายเดือน)**
   บั๊กที่หน้างานแจ้ง: คนตำแหน่งสูงกว่าเป็นคนตรวจเอง แล้วการอนุมัติ "กระโดดไปผู้จัดการ"
     ต้นเหตุ (โค้ดเดิม): ใบตรวจมีช่องอนุมัติช่องเดียว + ใครถือ `pm:approve` ก็กดได้ ไม่ดูว่าใครตรวจ
       และ role `leader` ไม่มี `pm:approve` ⇒ หัวหน้ากลุ่มกดรับทราบไม่ได้เลย งานจึงไปกองที่ supervisor/manager
   กติกา (ไฟล์นี้ที่เดียว · pure · ห้ามคิดเองในหน้า):
     · ผู้อนุมัติขั้นถัดไป = **ชั้นแรกในบันไดที่ "สูงกว่า" ตำแหน่งคนตรวจ** (`amNextApprover`)
       พนักงาน(10)/ช่าง(20)/วิศวกร(30) → หัวหน้ากลุ่ม(40) · หัวหน้ากลุ่ม → หัวหน้าแผนก/ส่วน(50) · หัวหน้าแผนก → ผู้จัดการ(60)
     · คนกดต้องอยู่ **ชั้นนั้นพอดี** — ต่ำกว่า = `rank_too_low` · สูงกว่า = `skip_level` (ข้ามขั้น = บั๊กที่แจ้ง)
     · ผู้จัดการตรวจเอง (ไม่มีชั้นเหนือในบันได) = ผู้จัดการคนอื่น/คนเดิมรับทราบได้ (`top`)
     · 🔴 **ไม่รู้ตำแหน่ง (`null`) = ไม่บล็อก แต่จอต้องเขียนว่าไม่ได้ตรวจ** — กติกาเดียวกับ `positionRank()`
       (utils/positions.js) และ `stepAssumptions()` ของ MO · `null` ≠ ตำแหน่งต่ำ
   ⚠️ ตำแหน่ง = `profiles.position` (ตำแหน่งที่ปฏิบัติงาน) ผ่าน `positionRank()` — ไฟล์นี้รับเป็น "ตัวเลข" เพื่อให้ pure
   ⚠️ สิทธิ์กด (ชั้น ②) ยังต้องผ่าน `can()` — ดู `amApproveAllowed()` (คีย์ `am:approve` · fallback `pm:approve`)
   ✅ ขั้น 3 "ทบทวนรายเดือน" ของหัวหน้าแผนก/ส่วน (2026-11-03) — `amMonthlySignoffVerdict()` ท้ายไฟล์
      ตาราง `am_monthly_signoffs` (Main) · จอ = แท็บ 📅 รายงานรายเดือน (`components/AmMonthlyReport.jsx`) */

import { normBadgeCode } from './badgeCheckin.js'

/** บันไดของ AM (rank ตาม POSITION_LEVELS ใน utils/positions.js) */
export const AM_APPROVAL_LADDER = [
  { rank: 40, key: 'leader',     label: 'หัวหน้ากลุ่ม',      action: 'รับทราบผลตรวจ (รายวัน)' },
  { rank: 50, key: 'supervisor', label: 'หัวหน้าแผนก/ส่วน', action: 'ทบทวน' },
  { rank: 60, key: 'manager',    label: 'ผู้จัดการ',         action: 'รับทราบ' },
]

/**
 * ผู้อนุมัติขั้นถัดไปของใบที่คนตำแหน่ง `inspectorRank` ตรวจ
 * @returns {{ step: object|null, top: boolean, known: boolean }}
 *   step = ชั้นที่ต้องกด · top = คนตรวจอยู่ชั้นบนสุดแล้ว · known=false = ไม่รู้ตำแหน่งคนตรวจ (ถือว่าเริ่มที่ชั้นแรก)
 */
export function amNextApprover(inspectorRank) {
  if (inspectorRank == null || !Number.isFinite(Number(inspectorRank))) {
    return { step: AM_APPROVAL_LADDER[0], top: false, known: false }
  }
  const r = Number(inspectorRank)
  const step = AM_APPROVAL_LADDER.find(s => s.rank > r) || null
  return { step, top: !step, known: true }
}

/**
 * คนนี้กดอนุมัติ/ตีกลับใบ AM ใบนี้ได้ไหม (ชั้น "ลำดับขั้น" เท่านั้น — สิทธิ์ `can()` + ทีม เช็คแยก)
 * @param {{ inspectorRank:number|null, approverRank:number|null, isSelf?:boolean }} p
 * @returns {{ ok:boolean, code:string, need:object|null, assumed:string[] }}
 *   code: ok · top · rank_too_low · skip_level · self
 */
export function amApprovalVerdict({ inspectorRank = null, approverRank = null, isSelf = false } = {}) {
  const nx = amNextApprover(inspectorRank)
  const assumed = []
  if (!nx.known) assumed.push('inspector')
  if (approverRank == null) assumed.push('approver')
  if (nx.top) {
    // ชั้นบนสุดตรวจเอง — ต้องเป็นชั้นเดียวกันขึ้นไป (ไม่รู้ตำแหน่ง = ไม่บล็อก)
    if (approverRank != null && approverRank < Number(inspectorRank)) return { ok: false, code: 'rank_too_low', need: null, assumed }
    return { ok: true, code: 'top', need: null, assumed }
  }
  // รับทราบใบที่ตัวเองตรวจ = ไม่มีคนที่สองดู (ชั้นเดียวกันกับคนตรวจ ⇒ ไม่ใช่ขั้นถัดไปอยู่แล้ว)
  if (isSelf) return { ok: false, code: 'self', need: nx.step, assumed }
  if (approverRank == null || !nx.known) return { ok: true, code: 'ok', need: nx.step, assumed }
  if (approverRank < nx.step.rank) return { ok: false, code: 'rank_too_low', need: nx.step, assumed }
  if (approverRank > nx.step.rank) return { ok: false, code: 'skip_level', need: nx.step, assumed }
  return { ok: true, code: 'ok', need: nx.step, assumed }
}

/** ข้อความบนจอของ verdict (ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล) */
export function amApprovalText(v) {
  if (!v) return ''
  const need = v.need ? `${v.need.label}${v.need.action ? ` ${v.need.action}` : ''}` : ''
  switch (v.code) {
    case 'self': return `รับทราบใบที่ตัวเองตรวจไม่ได้ — รอ${need}`
    case 'rank_too_low': return need ? `ขั้นนี้ต้องให้${need}` : 'ตำแหน่งต่ำกว่าคนตรวจ — รับทราบไม่ได้'
    case 'skip_level': return `ข้ามขั้นไม่ได้ — ใบนี้ต้องผ่าน${need}ก่อน (ไม่ส่งตรงถึงผู้บังคับบัญชาชั้นบน)`
    case 'top': return 'คนตรวจอยู่ระดับผู้จัดการ — ผู้จัดการรับทราบได้'
    default: return need ? `ขั้นนี้: ${need}` : ''
  }
}

/** ข้อความเตือนเมื่อระบบ "ปล่อยผ่านเพราะไม่รู้ตำแหน่ง" — ต้องขึ้นบนจอเสมอ */
export function amApprovalAssumptionText(assumed = []) {
  if (!assumed?.length) return null
  const who = []
  if (assumed.includes('inspector')) who.push('คนตรวจ')
  if (assumed.includes('approver')) who.push('บัญชีของคุณ')
  return `⚠️ ระบบไม่รู้ตำแหน่งของ${who.join(' และ ')} จึงไม่ได้ตรวจลำดับขั้น — ให้ admin เติมตำแหน่งที่ /add-user`
}

/**
 * สิทธิ์กด (ชั้น ②) ของใบ AM — คีย์ `am:approve` (migration 20261102_am_approve_permission_main.sql)
 * ยังไม่ seed = ถอยไปใช้ `pm:approve` (พฤติกรรมเดิมเป๊ะ)
 * @param {{ can:(r:string,a:string)=>boolean, isSeeded:(r:string,a:string)=>boolean }} fns
 */
export function amApproveAllowed({ can, isSeeded }) {
  if (isSeeded?.('am', 'approve')) return !!can?.('am', 'approve')
  return !!can?.('pm', 'approve')
}

/* ═══ 🪪 B4 — หัวหน้าถือ handheld ทวนสอบ "หน้าเครื่อง" (2026-11-10 · user ตัดสิน) ═══════════════════════
   หน้างานมี handheld เครื่องเดียว ⇒ หัวหน้าเดินไล่ทีละเครื่อง: สแกน QR เครื่อง → **สแกนบัตรผู้ตรวจ** →
   ไล่ติ๊กเช็คชีทพร้อมพนักงาน → กดบันทึก = ได้ 2 ชื่อในใบเดียว (ผู้ตรวจตามบัตร · ผู้ทวนสอบ = บัญชีที่ login)
   กติกา (user 10/11):
     · 🔴 **ใบ AM ต้องมีรหัสบัตรผู้ตรวจทุกใบ = มาตรฐานเดียว** — หัวหน้าตรวจแทนพนักงาน ก็สแกนบัตรตัวเอง
       รหัสต้องชี้พนักงานได้ **1 คนพอดี** (ไม่พบ/ซ้ำ/อ่านทะเบียนไม่ได้ = บันทึกไม่ได้ — ไม่รู้ว่าใครตรวจ)
     · ไม่เตือนเรื่อง "คนประจำเครื่อง" — แค่บันทึกว่าใครมาตรวจ (ฐานไม่มีข้อมูลผูกคนกับเครื่องอยู่แล้ว)
     · 🔴 **ผู้ตรวจ = คนตามบัตร ไม่ใช่บัญชีที่ login** — ตำแหน่ง/ใบตัวเอง ของสายอนุมัติ (B2) ต้องคิดจากคนตามบัตร
       (ไม่งั้นหัวหน้าที่ถือเครื่องกลายเป็น "คนตรวจ" ⇒ รับทราบไม่ได้ (`self`) + ใบเลื่อนไปรอหัวหน้าแผนก)
     · กดบันทึก = **หัวหน้ากลุ่มรับทราบรายวันไปพร้อมกัน** เมื่อผ่าน `amApprovalVerdict` + สิทธิ์ `am:approve`
       ไม่ผ่าน (ข้ามขั้น/ใบตัวเอง/ไม่มีสิทธิ์/บัญชีกลาง/อ่านไม่ได้ว่าใช่ตัวเองไหม) = บันทึกได้ แต่ใบ **รออนุมัติตามเดิม** + จอบอกเหตุผล
     · นาฬิกา 60 นาที (`dailyAmBoard`) ไม่เปลี่ยน */

/** รหัสบัตรผู้ตรวจของใบ AM ใช้ได้ไหม
 * @param {{ code?:string, employee?:object|null, hits?:number, loadError?:boolean }} p
 *   employee = พนักงานที่จับคู่ได้ 1 คน (`findByBadge`) · hits = จำนวนแถวที่รหัสตรง (แยก "ไม่พบ" กับ "ซ้ำ")
 * @returns {{ ok:boolean, code:'ok'|'no_code'|'unreadable'|'not_found'|'ambiguous', text:string }} */
/* `kind` = ป้ายใบในข้อความ (11/11 · ใบ PM ของช่างใช้ด่านเดียวกัน — คำสั่ง user "บังคับสแกนบัตรก่อน")
   ไม่ส่ง = 'AM' = ข้อความเดิมเป๊ะ */
export function amBadgeGate({ code = '', employee = null, hits = 0, loadError = false, kind = 'AM' } = {}) {
  const c = normBadgeCode(code)
  if (!c) return { ok: false, code: 'no_code', text: kind === 'AM'
    ? 'ใบตรวจ AM ต้องสแกนบัตรผู้ตรวจก่อนบันทึก (หัวหน้าตรวจแทน = สแกนบัตรตัวเอง)'
    : `ใบตรวจ ${kind} ต้องสแกนบัตรผู้ตรวจก่อนบันทึก (สแกนบัตรของช่างที่ตรวจจริง)` }
  if (loadError) return { ok: false, code: 'unreadable', text: `อ่านทะเบียนพนักงานไม่ได้ — ยืนยันไม่ได้ว่ารหัส ${c} คือใคร ยังบันทึกไม่ได้ ลองใหม่อีกครั้ง` }
  if (employee?.id) return { ok: true, code: 'ok', text: '' }
  if (hits > 1) return { ok: false, code: 'ambiguous', text: `รหัส ${c} ซ้ำกันหลายคนในทะเบียนพนักงาน — ระบบไม่เดา ให้ admin แก้ทะเบียนก่อน` }
  return { ok: false, code: 'not_found', text: `ไม่พบรหัส ${c} ในทะเบียนพนักงาน — ตรวจรหัสบนบัตร หรือเพิ่มพนักงานในทะเบียนก่อน` }
}

/** กดบันทึกหน้าเครื่องแล้ว "รับทราบรายวัน" ให้เลยไหม (B4)
 * @param {{ inspectorRank:number|null, approverRank:number|null, isSelf:boolean|null, canApprove:boolean, isShared?:boolean }} p
 *   isSelf = บัตรเป็นของบัญชีที่ login ไหม · `null` = อ่านไม่ได้ (ไม่ถือว่าไม่ใช่ตัวเอง)
 * @returns {{ approve:boolean, code:string, text:string, verdict:object|null }} */
export function amOnSiteApproval({ inspectorRank = null, approverRank = null, isSelf = null, canApprove = false, isShared = false } = {}) {
  const wait = (code, why) => ({ approve: false, code, text: `${why} — ใบนี้รออนุมัติตามขั้นปกติ`, verdict: null })
  if (isShared) return wait('shared', 'บัญชีกลางรับทราบแทนคนไม่ได้ (ลายเซ็นต้องผูกตัวคน)')
  if (!canApprove) return wait('no_perm', 'บัญชีนี้ไม่มีสิทธิ์รับทราบผลตรวจ AM')
  if (isSelf == null) return wait('self_unknown', 'อ่านไม่ได้ว่าบัตรที่สแกนเป็นของบัญชีนี้หรือไม่')
  const verdict = amApprovalVerdict({ inspectorRank, approverRank, isSelf })
  if (!verdict.ok) return { approve: false, code: verdict.code, text: `${amApprovalText(verdict)} — ใบนี้รออนุมัติตามขั้นปกติ`, verdict }
  return { approve: true, code: verdict.code, text: '', verdict }
}

/** ผู้ตรวจ "ตัวจริง" ของใบ — มีรหัสบัตร = คนตามบัตรชนะบัญชีที่ login (B4)
 * @param {{ inspector_id?:string, inspector_code?:string }} insp
 * @param {{ empByCode?:Record<string,{id:string,position?:string}>, posByUid?:Record<string,string>, myUid?:string|null, myEmployeeId?:string|null }} ctx
 *   empByCode คีย์ = `normBadgeCode(code)`
 * @returns {{ position:string|null, isSelf:boolean, byBadge:boolean }} */
export function amInspectorIdentity(insp, { empByCode = {}, posByUid = {}, myUid = null, myEmployeeId = null } = {}) {
  const c = normBadgeCode(insp?.inspector_code)
  if (c) {
    const e = empByCode[c] || null
    return { position: e?.position || null, isSelf: !!(e?.id && myEmployeeId && e.id === myEmployeeId), byBadge: true }
  }
  return { position: posByUid[insp?.inspector_id] || null, isSelf: !!(myUid && insp?.inspector_id === myUid), byBadge: false }
}

/* ═══ ✍️ ขั้น 3 — หัวหน้าแผนก/ส่วน "ทบทวนรายเดือน" (2026-11-03 · user ตัดสิน 03/11) ═══════════════
   ลงนามต่อ **เดือน × ไลน์ × กะ** บนแท็บ 📅 รายงานรายเดือน · บันทึกที่ `am_monthly_signoffs` (Main)
   กติกา (pure · ด่านซ้ำตอนเขียนจริงใน `lib/amMonthlySignoff.js` — ซ่อนปุ่มอย่างเดียวไม่พอ):
     · สิทธิ์ชั้น ② = คีย์ `am:monthly_signoff` (`canSeeded` — ยังไม่ seed = ปิด ไม่ใช่ถอยไปคีย์อื่น)
     · 🔴 บัญชีกลาง (shared) ลงนามไม่ได้ — ลายเซ็นต้องผูกตัวคน
     · ชั้น ③ ขอบเขต = `canWriteLine()` ของไลน์นั้น (ผู้เรียกส่งผลมาเป็น `scopeOk`)
     · ตำแหน่ง ≥ หัวหน้าแผนก/ส่วน (rank 50) · **"หรือสูงกว่า" ได้** (ผู้จัดการลงนามแทนได้ — ไม่ใช่ข้ามขั้น
       เพราะขั้นนี้คือขั้นสุดท้ายของสาย ไม่มีใครรออยู่ข้างบน)
     · 🔴 ไม่รู้ตำแหน่ง (`null`) = ไม่บล็อก แต่จอต้องเขียนว่าไม่ได้ตรวจ (กติกาเดียวกับ `amApprovalVerdict`)
       — ชั้น role (`am:monthly_signoff` seed เฉพาะ supervisor/manager) ยังกั้นอยู่
     · 🔴 เดือนยังไม่จบ = ลงนามไม่ได้ (`month_running`) — snapshot ของเดือนที่ยังเดินคือตัวเลขที่ยังขยับ
     · มีลายเซ็นที่ยังมีผลอยู่แล้ว = ต้องเพิกถอนก่อน (`already_signed`) · ฐานมี unique index กันซ้ำอีกชั้น
   เพิกถอน (`amMonthlyRevokeVerdict`): ห้ามลบแถว — เปลี่ยนเป็น `revoked` + เหตุผล ≥ 5 ตัวอักษร
     · ผู้ลงนามเพิกถอนของตัวเองได้ · คนอื่นต้องมีตำแหน่ง ≥ ผู้ลงนาม (หัวหน้าแผนกล้มลายเซ็นผู้จัดการไม่ได้) */

export const AM_MONTHLY_SIGNOFF_MIN_RANK = 50
export const AM_REVOKE_REASON_MIN = 5

/**
 * คนนี้ลงนามทบทวน AM รายเดือนของไลน์นี้ได้ไหม
 * @param {{ permitted:boolean, sharedAccount?:boolean, scopeOk?:boolean, signerRank:number|null,
 *           monthComplete:boolean, alreadySigned?:boolean }} p
 * @returns {{ ok:boolean, code:string, assumed:string[] }}
 *   code: ok · no_perm · shared_account · scope · rank_too_low · month_running · already_signed
 */
export function amMonthlySignoffVerdict({ permitted = false, sharedAccount = false, scopeOk = true,
  signerRank = null, monthComplete = false, alreadySigned = false } = {}) {
  const known = signerRank != null && Number.isFinite(Number(signerRank))
  const assumed = known ? [] : ['approver']
  if (!permitted) return { ok: false, code: 'no_perm', assumed }
  if (sharedAccount) return { ok: false, code: 'shared_account', assumed }
  if (!scopeOk) return { ok: false, code: 'scope', assumed }
  if (known && Number(signerRank) < AM_MONTHLY_SIGNOFF_MIN_RANK) return { ok: false, code: 'rank_too_low', assumed }
  if (!monthComplete) return { ok: false, code: 'month_running', assumed }
  if (alreadySigned) return { ok: false, code: 'already_signed', assumed }
  return { ok: true, code: 'ok', assumed }
}

/**
 * เพิกถอนลายเซ็นทบทวนรายเดือนได้ไหม
 * @param {{ permitted:boolean, sharedAccount?:boolean, scopeOk?:boolean, revokerRank:number|null,
 *           signerRank:number|null, isSigner?:boolean, reason?:string }} p
 * @returns {{ ok:boolean, code:string, assumed:string[] }} code: ok · no_perm · shared_account · scope · rank_too_low · reason
 */
export function amMonthlyRevokeVerdict({ permitted = false, sharedAccount = false, scopeOk = true,
  revokerRank = null, signerRank = null, isSigner = false, reason = '' } = {}) {
  const known = revokerRank != null && Number.isFinite(Number(revokerRank))
  const assumed = known ? [] : ['approver']
  if (!permitted) return { ok: false, code: 'no_perm', assumed }
  if (sharedAccount) return { ok: false, code: 'shared_account', assumed }
  if (!scopeOk) return { ok: false, code: 'scope', assumed }
  if (!isSigner && known) {
    const r = Number(revokerRank)
    if (r < AM_MONTHLY_SIGNOFF_MIN_RANK) return { ok: false, code: 'rank_too_low', assumed }
    if (signerRank != null && r < Number(signerRank)) return { ok: false, code: 'rank_too_low', assumed }
  }
  if (String(reason || '').trim().length < AM_REVOKE_REASON_MIN) return { ok: false, code: 'reason', assumed }
  return { ok: true, code: 'ok', assumed }
}

/** ข้อความบนจอของ verdict ลงนาม/เพิกถอนรายเดือน (ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล) */
export function amMonthlySignoffText(v, { opensOn = '' } = {}) {
  if (!v || v.ok) return ''
  switch (v.code) {
    case 'no_perm': return 'ลงนามทบทวนรายเดือนได้เฉพาะผู้ถือสิทธิ์ "AM: ลงนามทบทวนรายเดือน" (ตั้งที่ /permissions)'
    case 'shared_account': return 'บัญชีกลางลงนามไม่ได้ — ลายเซ็นต้องผูกกับตัวคน ให้เข้าด้วยบัญชีของตัวเอง'
    case 'scope': return 'ไลน์นี้อยู่นอกขอบเขตที่คุณรับผิดชอบ — ดูได้ แต่ลงนามไม่ได้'
    case 'rank_too_low': return 'ขั้นนี้ต้องให้หัวหน้าแผนก/ส่วน (หรือสูงกว่า) ทบทวน'
    case 'month_running': return `เดือนนี้ยังไม่จบ — ลงนามได้${opensOn ? `ตั้งแต่ ${opensOn}` : 'หลังสิ้นเดือน'} (ตัวเลขยังขยับได้)`
    case 'already_signed': return 'ไลน์นี้ลงนามแล้ว — ต้องเพิกถอนลายเซ็นเดิมก่อนจึงลงนามใหม่ได้'
    case 'reason': return `ต้องระบุเหตุผลการเพิกถอนอย่างน้อย ${AM_REVOKE_REASON_MIN} ตัวอักษร`
    default: return ''
  }
}

/* ═══ ✍️ ใบ PM ของช่าง — ขั้น 2 "หัวหน้าผู้ตรวจ ตรวจสอบและยืนยัน" (ทีละใบ · 2026-11-11 · คำสั่ง user) ═══
   สาย PM: ① ผู้ตรวจ (สแกนบัตร) → ② **หัวหน้าผู้ตรวจยืนยัน (ทีละใบ · ไฟล์นี้)** →
           ③ ผจก.ส่วนของผู้ตรวจ อนุมัติ (รายเดือน) → ④ ผจก.ส่วนที่ถูกตรวจ รับทราบ (รายเดือน) — ③④ ยังไม่ทำ (รอบ 2)
   user 11/11: *"มันมีระดับรึป่าว เหมือนใบ MO ยังมีช่าง มี หัวหน้าช่าง มี ผจก ช่าง"*
   ⇒ ใช้เกณฑ์ระดับชุดเดียวกับ "หัวหน้าแผนกช่าง" ของใบ MO ทีม JIG/DIE (`mtnStepPerm` TOOL_FORM_STEPS ขั้น 4 · minRank 30)
     — โรงงานนี้วิศวกรอยู่ระดับเดียวกับหัวหน้าแผนก · ทีม DIE ไม่มี dept_head เลย (ล็อก 50 = ไม่มีใครกดได้)
   กติกา (ไม่ใช่บันไดตายตัวแบบ AM เพราะทีมช่างไม่มีชั้นหัวหน้ากลุ่ม 40 — ล็อกแบบ AM = ใบ JIG ค้างทุกใบ · วัดบัญชีจริง 11/11):
     · คนกดต้องระดับ ≥ 30 (วิศวกร/หัวหน้าแผนกขึ้นไป) · **ไม่ต่ำกว่าคนตรวจ** · **ไม่ใช่ใบที่ตัวเองตรวจ**
     · ทีม = ด่าน `canWriteTeam` เดิมของหน้า (ทีมช่างเดียวกับใบ) · สิทธิ์ ② = `pm:approve` เดิม
     · 🔴 ไม่รู้ตำแหน่ง (`null`) = ไม่บล็อก แต่จอต้องเขียนบอก (กติกาเดียวกับทั้งระบบ) */
export const PM_HEAD_MIN_RANK = 30
export const PM_HEAD_STEP = { rank: PM_HEAD_MIN_RANK, key: 'pm_head', label: 'หัวหน้าผู้ตรวจ', action: 'ตรวจสอบและยืนยัน' }

/** @param {{ inspectorRank:number|null, approverRank:number|null, isSelf?:boolean }} p
 *  @returns {{ ok:boolean, code:string, need:object, assumed:string[] }}  code: ok · self · rank_too_low · below_inspector */
export function pmConfirmVerdict({ inspectorRank = null, approverRank = null, isSelf = false, isShared = false } = {}) {
  const need = PM_HEAD_STEP
  const assumed = []
  // บัญชีกลางยืนยันแทนคนไม่ได้ — ลายเซ็นต้องผูกตัวคน (กติกาเดียวกับ amOnSiteApproval)
  if (isShared) return { ok: false, code: 'shared', need, assumed }
  if (inspectorRank == null) assumed.push('inspector')
  if (approverRank == null) assumed.push('approver')
  if (isSelf) return { ok: false, code: 'self', need, assumed }
  if (approverRank == null) return { ok: true, code: 'ok', need, assumed }
  if (approverRank < PM_HEAD_MIN_RANK) return { ok: false, code: 'rank_too_low', need, assumed }
  if (inspectorRank != null && approverRank < inspectorRank) return { ok: false, code: 'below_inspector', need, assumed }
  return { ok: true, code: 'ok', need, assumed }
}

/** ข้อความบนจอของ `pmConfirmVerdict` */
export function pmConfirmText(v) {
  if (!v) return ''
  switch (v.code) {
    case 'shared': return 'บัญชีกลางยืนยันผลตรวจแทนคนไม่ได้ — ให้หัวหน้าผู้ตรวจ login ด้วยบัญชีของตัวเอง'
    case 'self': return 'ยืนยันใบที่ตัวเองตรวจไม่ได้ — รอหัวหน้าผู้ตรวจ (วิศวกร/หัวหน้าแผนกขึ้นไปในทีมเดียวกัน)'
    case 'rank_too_low': return 'ขั้นนี้ต้องเป็นหัวหน้าผู้ตรวจ — ระดับวิศวกร/หัวหน้าแผนกขึ้นไปในทีมช่างเดียวกัน'
    case 'below_inspector': return 'ตำแหน่งต่ำกว่าคนตรวจ — ยืนยันใบนี้ไม่ได้'
    default: return 'ขั้นนี้: หัวหน้าผู้ตรวจ ตรวจสอบและยืนยัน'
  }
}
