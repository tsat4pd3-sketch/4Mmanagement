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
