import { useState, useEffect } from 'react'

/* จอกว้างพอให้ "รูปซ้าย · การ์ดขวา" — ต่ำกว่านี้รูปตรึงบนหัวแทน */
export default function useWideModal() {
  const q = '(min-width: 1180px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = e => setWide(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

