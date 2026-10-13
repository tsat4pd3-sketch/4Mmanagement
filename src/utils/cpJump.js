/* 🎯 ทางลัด "ไปที่จุดตรวจ" ในจอตั้งค่าจุดตรวจ PM (2026-10-13 · feedback ทีม MTN/JIG)
   *"จุดเยอะแล้ว ต้อง scroll จนเมื่อยนิ้ว ถ้ามีระบบ jump ไปหาจุดนั้นได้จะดีมาก"*
   pure — จอเป็นคนเลื่อน (`PMSetup.jsx`) · ที่นี่ตัดสินแค่ "คำค้นนี้ตรงจุดไหนบ้าง เรียงยังไง"

   กติกาจับคู่ (q = ที่พิมพ์ ตัดช่องว่าง ไม่สนตัวพิมพ์):
   1. เลขจุดตรงตัว (`1.3` · `7`) = อันดับแรก — Enter แล้วต้องไปจุดที่พิมพ์เลขเป๊ะ
   2. เลขกลุ่ม (`2` → `2.1 2.2 …`) — พิมพ์เลข Item เดียวแล้วเห็นทั้งกลุ่ม
   3. ชื่อจุด / ชื่อกลุ่ม มีคำค้นอยู่ (`LP` · `Locate`)
   คำค้นว่าง = คืนทุกจุดตามลำดับเดิม (แถบชิปยังต้องโชว์ครบ ห้ามว่าง) */
export function cpJumpMatches(q, ordered, labels) {
  const list = Array.isArray(ordered) ? ordered : []
  const needle = String(q ?? '').trim().toLowerCase()
  if (!needle) return list
  const exact = [], group = [], text = []
  for (const cp of list) {
    const label = String(labels?.[cp._key] ?? '').toLowerCase()
    if (label && label === needle) exact.push(cp)
    else if (label && label.startsWith(needle + '.')) group.push(cp)
    else if (String(cp.name ?? '').toLowerCase().includes(needle)
      || String(cp.group_name ?? '').toLowerCase().includes(needle)) text.push(cp)
  }
  return [...exact, ...group, ...text]
}
