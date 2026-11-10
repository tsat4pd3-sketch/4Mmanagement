/* ══ 📋 "ใบตรวจของเครื่องนี้ทำครบตามแพทเทินหรือยัง" ══════════════════  2026-11-10
   คำสั่ง user: *"แพทเทินการสร้างใบตรวจแต่ละเครื่อง ควรมีตัวอย่างมั้ย — เริ่มจากรูปหลักภาพใหญ่
   มุมที่ 1 และปักหมุดแต่ละจุดในมุมที่ 1 พร้อมภาพขยาย แล้วค่อยไปมุมที่ 2"*

   🔑 ชิ้นส่วนมีครบอยู่แล้ว (หลายมุม · หมุดผูกกับมุมที่วาง · รูปขยายรายจุด) — ที่ขาดคือ
      **ลำดับที่แนะนำ + ตัวบอกว่าทำครบหรือยัง** ⇒ ผลออกมาคนละมาตรฐานกันตามทีม
      วัดจริง DR 10/11 (จุดตรวจ 5,255 จุด / 286 ใบ):
        JIG MTN  157 ใบ · ปัก 93% · **มีรูปขยาย 98%**  ← ต้นแบบ (JHYD02-04 = 12 มุม/127 จุด/ขยาย 121)
        AM ผลิต   82 ใบ · ปัก 96% · มีรูปขยาย 44%
        DIE MTN   31 ใบ · ปัก 14% · **มีรูปขยาย 0%** (24/31 ใบไม่ปักเลย)
        MTN       16 ใบ · ปัก 66% · **มีรูปขยาย 0%**

   🔴 **ตัวเลขนี้เป็น "ตัวบอก" ไม่ใช่ "ด่าน"** — ห้ามเอาไปบล็อกการบันทึกใบตรวจ
      (ใบที่ยังปักไม่ครบก็ยังใช้ตรวจได้ · กฎจอ `/pm-check-data` ข้อ "ปักหมุดจำเป็นแค่กับการแตะหมุด")
   🔴 **ไม่มีรูปเลย (frames ว่าง) = ยังไม่เริ่ม ไม่ใช่ "ทำไม่ครบ"** — คนละข้อความกัน    */

/** คีย์มุมของจุดตรวจ 1 จุด — ไม่ได้ระบุ = ผูกมุมแรก (กติกาเดียวกับ SpinAnnotator/JigSpinCheck) */
export function cpFrameKey(cp, frames = []) {
  return cp?._frameKey ?? cp?.image_id ?? frames[0]?._key ?? frames[0]?.id ?? null
}

const frameKeyOf = (f) => f?._key ?? f?.id ?? null

/**
 * สรุปความครบของใบตรวจ 1 ใบ
 * @param {Array} checkpoints จุดตรวจ (ใช้ `x_pos` = ปักหมุดแล้ว · `image_path` = มีรูปขยาย)
 * @param {Array} frames มุม/รูปของเครื่อง
 * @returns {{cps:number, frames:number, pinned:number, unpinned:number, withPhoto:number,
 *            noPhoto:number, byFrame:Array<{key:string,title:string,n:number,idx:number}>,
 *            started:boolean, done:boolean, missing:string[]}}
 */
export function sheetCompleteness(checkpoints = [], frames = []) {
  const cps = Array.isArray(checkpoints) ? checkpoints : []
  const frs = Array.isArray(frames) ? frames : []
  let pinned = 0, withPhoto = 0
  const perFrame = new Map()
  for (const f of frs) perFrame.set(frameKeyOf(f), 0)
  for (const c of cps) {
    const isPinned = c?.x_pos != null && c?.y_pos != null
    if (isPinned) {
      pinned++
      const k = cpFrameKey(c, frs)
      if (perFrame.has(k)) perFrame.set(k, perFrame.get(k) + 1)
    }
    if (c?.image_path) withPhoto++
  }
  const byFrame = frs.map((f, idx) => ({
    key: frameKeyOf(f), idx,
    title: f?.title || `มุมที่ ${idx + 1}`,
    n: perFrame.get(frameKeyOf(f)) ?? 0,
  }))
  const unpinned = Math.max(0, cps.length - pinned)
  const noPhoto = Math.max(0, cps.length - withPhoto)

  /* ข้อความ "ยังขาดอะไร" — เรียงตามลำดับที่ควรทำ (รูป → ปักหมุด → รูปขยาย) */
  const missing = []
  if (!frs.length) missing.push('ยังไม่มีรูปเครื่อง — เริ่มที่ปุ่ม + เพิ่มรูป')
  else {
    if (unpinned > 0) missing.push(`ยังไม่ปักหมุด ${unpinned} จุด`)
    if (noPhoto > 0) missing.push(`ยังไม่มีรูปขยาย ${noPhoto} จุด`)
    const empty = byFrame.filter(f => f.n === 0)
    if (empty.length && pinned > 0) missing.push(`มุมที่ยังไม่มีหมุดเลย ${empty.length} มุม`)
  }
  return {
    cps: cps.length, frames: frs.length, pinned, unpinned, withPhoto, noPhoto, byFrame,
    started: frs.length > 0 && cps.length > 0,
    done: frs.length > 0 && cps.length > 0 && unpinned === 0 && noPhoto === 0,
    missing,
  }
}

/** ตัวกรอง "ดูเฉพาะจุดของมุมนี้" — `null` = ทุกมุม · `'unpinned'` = จุดที่ยังไม่ปักหมุด */
export const UNPINNED = 'unpinned'
export function cpInFrameFilter(cp, filter, frames = []) {
  if (filter == null) return true
  const isPinned = cp?.x_pos != null && cp?.y_pos != null
  if (filter === UNPINNED) return !isPinned
  if (!isPinned) return false              // จุดยังไม่ปัก = ไม่ได้อยู่มุมไหน ห้ามโผล่ในมุมใดมุมหนึ่ง
  return cpFrameKey(cp, frames) === filter
}
