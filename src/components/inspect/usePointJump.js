import { useRef, useState, useEffect, useCallback } from 'react'

/* 🎯 "ไปที่จุดตรวจ" — เลื่อนรายการไปการ์ดจุดนั้น + เรืองกรอบ 2.5 วิ
   ของกลางของจอตั้งค่าจุดตรวจทุกระบบ (PM `PMSetup` · QA `QaPointsEditor`) — 📄 docs/modules/inspection-point-setup.md
   🔴 เลื่อน **เฉพาะ body ของโมดัล** ด้วย scrollTo — ห้าม scrollIntoView (เลื่อนหน้าข้างหลังโมดัลไปด้วย)
      และต้องหัก padding บนของ body + `top` ของแถบที่ตรึง + ความสูงแถบ ไม่งั้นการ์ดไปจมใต้แถบ (UI §6.23 ข้อ 3)
   onReveal(key) = เรียกตอนกระโดด (เช่น หมุนรูปไปเฟรมที่หมุดของจุดนั้นอยู่) */
export default function usePointJump({ onReveal } = {}) {
  const bodyRef = useRef(null)
  const stickyRef = useRef(null)
  const cardRefs = useRef({})
  const revealRef = useRef(onReveal)
  useEffect(() => { revealRef.current = onReveal })
  const [flashKey, setFlashKey] = useState(null)
  const [pending, setPending] = useState(null)   // จุดที่เพิ่งเพิ่ม — รอ render เสร็จค่อยเลื่อนไป

  const jumpTo = useCallback((key) => {
    const box = bodyRef.current, el = cardRefs.current[key]
    revealRef.current?.(key)
    if (!box || !el) return
    const st = stickyRef.current
    const stickyH = st ? (parseFloat(getComputedStyle(box).paddingTop) || 0) + (parseFloat(getComputedStyle(st).top) || 0) + st.offsetHeight : 0
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - stickyH - 8
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    box.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
    setFlashKey(key)
  }, [])

  useEffect(() => {
    if (!pending) return
    jumpTo(pending)
    setPending(null)
  }, [pending, jumpTo])
  useEffect(() => {
    if (!flashKey) return
    const t = setTimeout(() => setFlashKey(null), 2500)
    return () => clearTimeout(t)
  }, [flashKey])

  const cardRef = useCallback(key => el => {
    if (el) cardRefs.current[key] = el; else delete cardRefs.current[key]
  }, [])
  const scrollTop = useCallback(() => bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), [])

  return { bodyRef, stickyRef, flashKey, jumpTo, jumpLater: setPending, cardRef, scrollTop }
}
