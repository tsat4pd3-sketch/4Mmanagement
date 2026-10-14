/* 🗂️ ลิสต์อุปกรณ์ในจอตั้งค่าจุดตรวจ PM (`/pm?tab=setup`) — ตาราง + ตัวกรอง (2026-10-13 · feedback ทีม JIG MTN)
   *"ข้อมูลเยอะจนเลื่อนหาไม่เจอ ช่างรู้ว่าอุปกรณ์นี้อยู่ไลน์ 297 ของ PD4 แต่ไม่มีระบบให้กรอง"*
   pure — จอ (`PMSetup.jsx`) โหลด/วาด · ที่นี่ตัดสินสถานะ · กรอง · จัดกลุ่มตามไลน์

   🔴 อุปกรณ์ที่ `line_name` ว่าง/ไม่ตรงทะเบียนไลน์ = **ห้ามหายจากจอ** (CLAUDE.md "ตะกร้ารับท้ายลิสต์")
      ไม่กรองตามไลน์ = ต่อท้ายเป็นกลุ่มของตัวเอง (known:false) · เลือกกรองไลน์อยู่ = หลุดจากผลกรอง
      ⇒ จอต้องเขียนว่าหลุดกี่ตัว แล้วมีตัวเลือกสถานะ `no_line` ให้เปิดดู */
import { sortLineNames, lineNameCompare } from './lineHierarchy.js';

/** สถานะที่ "ยังต้องทำอะไรต่อ" — null = พร้อมใช้ · ไม่มีจุดตรวจ ชนะ ยังไม่ลงทะเบียน AM
    ⚠️ ไม่มีสถานะ "ยังไม่ปักหมุด" โดยตั้งใจ — `layout_type` (รูป+หมุด / รายการ) ไม่ได้ถูกเก็บลงฐาน
    แยกไม่ได้ว่าไม่ปักเพราะลืม หรือเพราะเป็นแบบรายการ ⇒ ธงนี้จะเตือนผิด (จอแค่โชว์ 📍 ตัวที่ปักแล้ว) */
export const EQUIP_STATUS_META = {
  no_cp:      { icon: '⚪', label: 'ยังไม่มีจุดตรวจ', color: 'var(--muted)' },
  am_pending: { icon: '⚠', label: 'ยังไม่ลงทะเบียน AM', color: '#f59e0b' },
};

export function equipStatusOf({ cpCount = 0, amPending = false } = {}) {
  if (!cpCount) return 'no_cp'
  if (amPending) return 'am_pending'
  return null
}

const norm = (v) => String(v ?? '').trim().toLowerCase()

/** ชื่อไลน์ของอุปกรณ์อยู่ในทะเบียนไหม (เทียบตัดช่องว่าง ไม่สนตัวพิมพ์) */
export function lineKnownSet(lines) {
  return new Set((lines || []).map(l => norm(l?.name)).filter(Boolean))
}

/**
 * @param rows   [{ jig, cpCount, hasPins, status, lineKnown }]
 * @param opt.q          คำค้น — ชื่อ / No. / เลขเครื่อง / ไลน์ / พาร์ท
 * @param opt.scopeNames ชื่อไลน์ในขอบเขตที่เลือก (จาก <LineScopeSelect>) · null/ว่าง = ไม่กรองไลน์
 * @param opt.status     '' | 'ready' | 'no_cp' | 'am_pending' | 'no_line'
 * @returns { rows, droppedNoLine } — droppedNoLine = ตัวที่หลุดเพราะกรองไลน์แต่ไลน์ไม่อยู่ทะเบียน (จอต้องบอก)
 */
export function filterEquipRows(rows, { q = '', scopeNames = null, status = '' } = {}) {
  const needle = norm(q)
  const scope = scopeNames && scopeNames.length ? new Set(scopeNames.map(norm)) : null
  let droppedNoLine = 0
  const out = (rows || []).filter(r => {
    const j = r.jig || {}
    if (status === 'no_line') { if (r.lineKnown) return false }
    else if (status === 'ready') { if (r.status) return false }
    else if (status && r.status !== status) return false
    if (needle && ![j.name, j.jig_no, j.machine_no, j.line_name, j.part_no, j.part_name].some(v => norm(v).includes(needle))) return false
    if (scope && status !== 'no_line' && !scope.has(norm(j.line_name))) {
      if (!r.lineKnown) droppedNoLine++
      return false
    }
    return true
  })
  return { rows: out, droppedNoLine }
}

/** จัดกลุ่มตามไลน์ — ลำดับไลน์ตามทะเบียน (ส่วนงาน→แม่→ลูก) · ไลน์นอกทะเบียน/ว่าง ต่อท้าย · ในกลุ่มเรียง No./ชื่อแบบธรรมชาติ */
export function groupEquipRowsByLine(rows, lines = []) {
  const byNorm = new Map((lines || []).filter(l => l?.name).map(l => [norm(l.name), l]))
  const map = new Map()
  for (const r of rows || []) {
    const raw = String(r.jig?.line_name ?? '').trim()
    const reg = byNorm.get(norm(raw))
    const key = reg ? reg.name : (raw || '')
    if (!map.has(key)) map.set(key, { key: key || '__none__', name: key, known: !!reg, section: reg?.section || null, rows: [] })
    map.get(key).rows.push(r)
  }
  const order = sortLineNames([...map.keys()].filter(Boolean), lines)
  const groups = [...order.map(n => map.get(n)), ...(map.has('') ? [map.get('')] : [])]
  for (const g of groups) {
    g.label = g.name || '(ไม่ระบุไลน์)'
    g.rows.sort((a, b) => lineNameCompare(a.jig?.jig_no || a.jig?.name || '', b.jig?.jig_no || b.jig?.name || ''))
  }
  // ไลน์ในทะเบียนมาก่อน ไลน์นอกทะเบียนต่อท้าย (sortLineNames ทำให้แล้ว) — กลุ่ม "ไม่ระบุไลน์" ท้ายสุด
  return groups
}
