/* 📈 แท็บ "SPC อุปกรณ์" ใน PM hub (/pm?tab=spc · 26/11 · คำสั่ง user)
   แหล่ง: ① ค่าตัวเลขจากใบตรวจ AM/PM (jig_checkpoints ชนิด variable/measure ที่ไม่ได้ปิด spc_enabled)
          ② ค่าชิมรวมหลังทำ (fixture_shim_events) ต่อจุดชิม — เพดานชิม = USL
   สูตร = `equipSpc()` (src/utils/equipSpc.js → spcCalc.js ตัวเดียวกับ QA) · กราฟ = <EquipSpcChart>
   🔴 อ่านไม่ได้ = เขียนบอกบนจอ · ไม่มีข้อมูล = บอกตรงๆ ว่ายังไม่มี (ห้ามโชว์กราฟว่างเหมือนปกติ)
   📄 docs/modules/equipment-spc.md */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMergeParams } from '../utils/useTabParam'
import { supabaseDR } from '../supabaseClient'
import { tr } from '../utils/i18n'
import { fetchByIds } from '../utils/fetchByIds'
import { pmTeamsSync, loadPmTeams } from '../utils/pmTeams'
import { loadSpcCatalog, loadSpcSeries, loadShimCatalog, loadShimEvents } from '../lib/equipSpcLoad'
import { equipSpc, shimRows } from '../utils/equipSpc'
import FilterBar from './FilterBar'
import Segmented from './Segmented'
import SearchInput from './SearchInput'
import EquipSpcChart from './EquipSpcChart'

const SRC_OPTS = [{ value: 'insp', label: 'ค่าจากใบตรวจ' }, { value: 'shim', label: 'ค่าชิม (Shim Record)' }]
const norm = (s) => String(s || '').toLowerCase()

export default function EquipSpcTab() {
  const [sp] = useSearchParams()
  const setParams = useMergeParams()
  const src = sp.get('src') === 'shim' ? 'shim' : 'insp'
  const [teams, setTeams] = useState(pmTeamsSync())
  useEffect(() => { let a = true; loadPmTeams().then(() => { if (a) setTeams(pmTeamsSync()) }).catch(() => {}); return () => { a = false } }, [])
  const dept = sp.get('dept') || teams[0]?.key || 'maintenance'
  const selId = sp.get('cp') || ''
  const [q, setQ] = useState('')

  // ① แคตตาล็อกข้อตัวเลขของทีม + ชื่อเครื่อง
  const [cat, setCat] = useState({ key: '', loading: true, cps: [], countByCp: {}, jigById: {}, err: '' })
  useEffect(() => {
    if (src !== 'insp') return undefined
    let alive = true
    setCat(c => ({ ...c, key: dept, loading: true, err: '' }))
    ;(async () => {
      const r = await loadSpcCatalog({ department: dept })
      let jigById = {}
      if (r.ok && r.cps.length) {
        const j = await fetchByIds([...new Set(r.cps.map(c => c.jig_id))], c => supabaseDR.from('jigs').select('id, name, machine_no, line_name').in('id', c))
        jigById = Object.fromEntries((j.rows || []).map(x => [x.id, x]))
      }
      if (alive) setCat({ key: dept, loading: false, cps: r.cps, countByCp: r.countByCp || {}, jigById, err: r.ok ? (r.countError || '') : (r.error || 'error') })
    })()
    return () => { alive = false }
  }, [dept, src])

  // ② จุดชิม
  const [shim, setShim] = useState({ loading: true, points: [], countByPoint: {}, err: '' })
  useEffect(() => {
    if (src !== 'shim') return undefined
    let alive = true
    loadShimCatalog().then(r => { if (alive) setShim({ loading: false, points: r.points, countByPoint: r.countByPoint, err: r.ok ? '' : (r.error || 'error') }) })
    return () => { alive = false }
  }, [src])

  const list = useMemo(() => {
    if (src === 'shim') {
      return shim.points.map(p => ({ id: p.id, title: `${p.point_no || ''} ${p.name || ''}`.trim(), sub: '', n: shim.countByPoint[p.id] || 0, cp: { id: p.id, name: p.name || p.point_no, unit: 'mm', usl: p.max_shim_mm, lsl: null } }))
        .filter(x => !q || norm(x.title).includes(norm(q)))
        .sort((a, b) => b.n - a.n)
    }
    return cat.cps.map(c => {
      const j = cat.jigById[c.jig_id]
      return { id: c.id, title: c.name, sub: j ? `${j.machine_no || ''} ${j.name || ''}`.trim() : '', line: j?.line_name || '', n: cat.countByCp[c.id] || 0, cp: c }
    })
      .filter(x => !q || norm(`${x.title} ${x.sub} ${x.line}`).includes(norm(q)))
      .sort((a, b) => b.n - a.n || String(a.sub).localeCompare(String(b.sub), 'th', { numeric: true }))
  }, [src, cat, shim, q])
  const sel = list.find(x => x.id === selId) || null

  // ③ ค่าวัดของข้อที่เลือก
  const [series, setSeries] = useState({ id: '', loading: false, rows: [], err: '' })
  useEffect(() => {
    if (!sel) return undefined
    let alive = true
    setSeries({ id: sel.id, loading: true, rows: [], err: '' })
    const p = src === 'shim'
      ? loadShimEvents(sel.id).then(r => ({ ok: r.ok, rows: shimRows(r.events), error: r.error }))
      : loadSpcSeries(sel.cp)
    p.then(r => { if (alive) setSeries({ id: sel.id, loading: false, rows: r.rows || [], err: r.ok ? '' : (r.error || 'error') }) })
    return () => { alive = false }
  }, [sel?.id, src]) // eslint-disable-line react-hooks/exhaustive-deps

  const loading = src === 'shim' ? shim.loading : (cat.loading || cat.key !== dept)
  const err = src === 'shim' ? shim.err : cat.err
  const withData = list.filter(x => x.n > 0).length

  return (
    <div>
      <FilterBar noClear>
        <Segmented value={src} onChange={v => setParams({ src: v === 'insp' ? null : v, cp: null })} options={SRC_OPTS} label={tr('แหล่งข้อมูล')} />
        {src === 'insp' && (
          <select value={dept} onChange={e => setParams({ dept: e.target.value, cp: null })} aria-label={tr('ทีม')}>
            {teams.map(t => <option key={t.key} value={t.key}>{tr(t.label)}</option>)}
          </select>
        )}
        <SearchInput value={q} onChange={setQ} fields={src === 'shim' ? 'จุดชิม' : 'ข้อ / เครื่อง / ไลน์'} />
      </FilterBar>

      <div style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 10px' }}>
        {tr('ทุกข้อที่เป็นตัวเลขขึ้นอัตโนมัติ (ปิดรายข้อได้ที่ ตั้งค่าจุดตรวจ) · เส้นควบคุมคิดจากข้อมูลย้อนหลัง 180 วัน · ครบ 20 จุดจึงตัดสิน in/out of control')}
      </div>
      {err && <div style={{ fontSize: 12.5, color: 'var(--amber)', marginBottom: 8 }}>⚠ {tr('อ่านข้อมูลไม่สำเร็จ')} ({err})</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) minmax(0, 2.4fr)', gap: 14, alignItems: 'start' }} className="mgrid">
        <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 8, maxHeight: '70vh', overflowY: 'auto' }}>
          {loading ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('กำลังโหลด…')}</div>
            : !list.length ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{src === 'shim' ? tr('ยังไม่มีจุดชิมในทะเบียน') : tr('ทีมนี้ยังไม่มีข้อที่เป็นตัวเลข')}</div>
              : <>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '2px 6px 6px' }}>{list.length} {tr('รายการ')} · {tr('มีค่าวัด')} {withData}</div>
                  {list.map(x => (
                    <button key={x.id} type="button" onClick={() => setParams({ cp: x.id })} aria-current={x.id === selId ? 'true' : undefined}
                      style={{ display: 'flex', width: '100%', textAlign: 'left', gap: 8, alignItems: 'center', padding: '7px 9px', marginBottom: 4, borderRadius: 'var(--r-md)', cursor: 'pointer',
                        border: `1px solid ${x.id === selId ? 'var(--accent)' : 'var(--border)'}`, background: x.id === selId ? 'var(--accent-dim)' : 'var(--bg3)', color: 'var(--text)' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, wordBreak: 'break-word' }}>{x.title}</span>
                        {(x.sub || x.line) && <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{x.sub}{x.line ? ` · ${x.line}` : ''}</span>}
                      </span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: x.n ? 'var(--text2)' : 'var(--muted)' }}>{x.n}</span>
                    </button>
                  ))}
                </>}
        </div>

        <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 14, minHeight: 200 }}>
          {!sel ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('เลือกข้อทางซ้ายเพื่อดูกราฟ')}</div>
            : <>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>📈 {sel.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{sel.sub}{sel.line ? ` · ${sel.line}` : ''}</div>
                {series.id !== sel.id || series.loading ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('กำลังโหลด…')}</div>
                  : series.err ? <div style={{ color: 'var(--amber)', fontSize: 13 }}>⚠ {tr('อ่านค่าวัดไม่สำเร็จ')} ({series.err})</div>
                    : <EquipSpcChart cp={sel.cp} result={equipSpc(sel.cp, series.rows)} />}
              </>}
        </div>
      </div>
    </div>
  )
}
