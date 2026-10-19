import { calcOf, calcFormula, CALC_OP } from '../../utils/inspectCalc'

/* 🧮 ช่องตั้งสูตร "จุดคำนวณ" ในการ์ดจุดตรวจ — ตัวเดียวทั้ง PM และ QA (2026-10-19)
   ติ๊กแล้วเลือกจุด A กับจุด B → ตอนตรวจระบบเติมค่า A − B ให้เอง (คนตรวจไม่ต้องพิมพ์)
   `options` = จุดที่อ้างได้ [{ key, label }] — ตัวเรียกกรองเฉพาะจุดวัดตัวเลขที่ไม่ใช่จุดคำนวณ และไม่ใช่ตัวเอง
   กฎ/สูตร → `src/utils/inspectCalc.js` · 📄 docs/modules/inspection-point-setup.md §จุดคำนวณ */
export default function CalcFormulaField({ calc, onChange, options = [], problems = [] }) {
  const c = calcOf({ calc }) || (calc ? { op: CALC_OP, a: calc.a || '', b: calc.b || '', abs: !!calc.abs } : null)
  const on = !!calc
  const labelOf = (k) => options.find(o => o.key === k)?.label || '?'
  const set = (patch) => onChange({ op: CALC_OP, a: '', b: '', abs: false, ...(calc || {}), ...patch })
  const sel = { flex: '1 1 140px', minWidth: 0 }
  return (
    <div style={{ marginBottom: 8, padding: on ? '8px 10px' : 0, borderRadius: 8,
      background: on ? 'rgba(77,159,255,0.08)' : 'transparent', border: on ? '1px solid rgba(77,159,255,0.35)' : 'none' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: on ? '#4d9fff' : 'var(--text2)', cursor: 'pointer' }}>
        <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked ? { op: CALC_OP, a: '', b: '', abs: false } : null)} style={{ width: 'auto' }} />
        🧮 คำนวณจากจุดอื่น (ผลต่าง A − B) — ตอนตรวจไม่ต้องพิมพ์ ระบบคิดให้
      </label>
      {on && (
        <>
          {options.length < 2 ? (
            <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 6 }}>
              ต้องมีจุดวัดเป็นตัวเลขอย่างน้อย 2 จุดก่อน (จุดคำนวณอ้างจุดคำนวณด้วยกันไม่ได้)
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              <select value={c?.a || ''} onChange={e => set({ a: e.target.value })} style={sel} aria-label="จุด A">
                <option value="">— จุด A —</option>
                {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <span style={{ fontWeight: 800, fontSize: 14 }}>−</span>
              <select value={c?.b || ''} onChange={e => set({ b: e.target.value })} style={sel} aria-label="จุด B">
                <option value="">— จุด B —</option>
                {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={!!c?.abs} onChange={e => set({ abs: e.target.checked })} style={{ width: 'auto' }} /> ไม่คิดเครื่องหมาย |A − B|
              </label>
            </div>
          )}
          {c?.a && c?.b && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5 }}>
              ค่า = <b style={{ color: 'var(--text)' }}>{calcFormula(c, labelOf)}</b> · ตัดสินด้วย LSL/USL ของจุดนี้
            </div>
          )}
          {problems.map((m, i) => <div key={i} style={{ fontSize: 11.5, color: '#ef4444', marginTop: 4 }}>⚠️ {m}</div>)}
        </>
      )}
    </div>
  )
}
