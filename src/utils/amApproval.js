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
   🔜 ยังไม่ทำ: ขั้น "ทบทวนรายเดือน" ของหัวหน้าแผนก/ส่วน (ต้องมีตารางลายเซ็นรายเดือน · รอ user) */

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
