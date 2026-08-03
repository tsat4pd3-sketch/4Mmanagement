import { useRef, useState, useEffect } from 'react'

/* ─── useUndoHistory — undo/redo แบบ snapshot สำหรับหน้าตั้งค่าผัง/Floorplan ──────
   ใช้ร่วม: TransportMapEditor (ถนน/จุดจอด AMR) · FactoryMap setupMode (polygon ไลน์)
   · MtnMachineLayout setupMode (โซน/จุด facility) — pattern เดียวกันทุก editor

   หลักการ: editor พวกนี้เขียนลง DB ทันทีทุก action → undo ต้องเขียน "ย้อน" ลง DB ด้วย
   ไม่ใช่แค่ state ในเครื่อง — hook นี้เก็บ snapshot ของข้อมูลทั้งชุดก่อนทุก action
   แล้วให้ editor เป็นคน restore เอง (applySnapshot: diff ปัจจุบัน vs snapshot → เขียน DB)

   const hist = useUndoHistory({ snapOf, applySnapshot, enabled: canEdit })
     snapOf()               → คืนก้อนข้อมูลปัจจุบัน (deep copy — hook ไม่ clone ให้)
     applySnapshot(snap)    → async restore ทั้ง DB + state ให้ตรง snap · คืน true เมื่อสำเร็จ
                              (ล้มเหลว = คืน false แล้ว hook จะไม่แตะสแตค — แนะนำ reload ข้างใน)
   ใช้ในหน้า:
     hist.pushHistory(tag?) — เรียก "ก่อน" mutation แรกของ action นั้น (ก่อน setState/DB)
                              tag เดียวกันภายใน 1.2 วิ = coalesce (เช่นพิมพ์ชื่อทีละตัวอักษร)
     hist.pushSnapshot(snap, tag?) — push snapshot ที่ถ่ายไว้เอง (เคสลากย้าย: ถ่ายตอน pointerdown)
     hist.undo() / hist.redo() · hist.canUndo / hist.canRedo · hist.busy
   คีย์ลัด Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y ผูกให้อัตโนมัติ (ข้ามตอน focus ช่องพิมพ์)          */

const LIMIT = 40

export default function useUndoHistory({ snapOf, applySnapshot, enabled = true }) {
  const histRef = useRef({ undo: [], redo: [], lastTag: null, lastAt: 0 })
  // ขนาดสแตคเก็บเป็น state แยก (ห้ามอ่าน histRef ตอน render — react-hooks/refs)
  const [depth, setDepth] = useState({ undo: 0, redo: 0 })
  const [busy, setBusy] = useState(false)
  const fnRef = useRef({})           // undo/redo ล่าสุด (ให้ hotkey listener ที่ผูกครั้งเดียวเรียกได้)
  const syncDepth = () => setDepth({ undo: histRef.current.undo.length, redo: histRef.current.redo.length })

  const pushSnapshot = (snap, tag = null) => {
    const h = histRef.current
    h.undo.push(snap); if (h.undo.length > LIMIT) h.undo.shift()
    h.redo = []; h.lastTag = tag; h.lastAt = Date.now()
    syncDepth()
  }
  const pushHistory = (tag = null) => {
    const h = histRef.current
    if (tag && h.lastTag === tag && Date.now() - h.lastAt < 1200) { h.lastAt = Date.now(); return }
    pushSnapshot(snapOf(), tag)
  }

  const shift = async (fromKey, toKey) => {
    const h = histRef.current
    if (!h[fromKey].length || busy) return
    setBusy(true)
    const snap = h[fromKey][h[fromKey].length - 1]
    const cur = snapOf()
    const ok = await applySnapshot(snap)
    if (ok) { h[fromKey].pop(); h[toKey].push(cur); h.lastTag = null }
    setBusy(false); syncDepth()
  }
  const undo = () => shift('undo', 'redo')
  const redo = () => shift('redo', 'undo')
  useEffect(() => { fnRef.current = { undo, redo, enabled, busy } })   // sync ทุก render (ห้ามเขียน ref ตอน render ตรงๆ)

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const f = fnRef.current
      if (!f.enabled || f.busy) return
      if (/^(input|textarea|select)$/i.test(e.target?.tagName || '')) return   // อย่าแย่ง undo ของช่องพิมพ์
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); f.undo() }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); f.redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ล้างสแตคทั้งหมด — ใช้เมื่อ context เปลี่ยน (เช่นสลับโซน/ผังคนละแผ่น snapshot เก่าใช้ไม่ได้แล้ว)
  const clear = () => { histRef.current = { undo: [], redo: [], lastTag: null, lastAt: 0 }; syncDepth() }

  return {
    pushHistory, pushSnapshot, undo, redo, clear, busy,
    canUndo: depth.undo > 0,
    canRedo: depth.redo > 0,
  }
}

/* ปุ่ม undo/redo มาตรฐาน (สไตล์เดียวทุก editor) — ใช้: {...undoRedoBtnProps(hist)} ไม่ได้
   เพราะเป็น 2 ปุ่ม — ให้ copy JSX สั้นๆ นี้ไปใช้:
   <button onClick={hist.undo} disabled={!hist.canUndo || hist.busy} style={undoBtnStyle(hist.canUndo && !hist.busy)} title="Ctrl+Z">↩️ Undo</button>
   <button onClick={hist.redo} disabled={!hist.canRedo || hist.busy} style={undoBtnStyle(hist.canRedo && !hist.busy)} title="Ctrl+Y">↪️ Redo</button> */
export const undoBtnStyle = (on) => ({
  padding: '7px 11px', borderRadius: 8, cursor: on ? 'pointer' : 'not-allowed', fontSize: 12.5, fontWeight: 700,
  border: '1.5px solid var(--border2)', background: 'var(--bg3)', color: on ? 'var(--text2)' : 'var(--muted)',
  opacity: on ? 1 : 0.45,
})
