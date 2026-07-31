import { useState, useEffect, useRef, useCallback, useContext, useMemo } from 'react'
import { supabase, supabaseDR } from '../supabaseClient'
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import { toast } from '../components/Toast'
import { NODE_KINDS, nodeKind, buildAdj, edgeWeight } from '../utils/transportGraph'

/* ─── TransportMapEditor — วาดกราฟถนน/ทางเดินรถบนผังใหญ่ (Store/AMR) ──────────
   ใช้รูปผังตัวเดียวกับ /factory-map (factory_map ฝั่ง Main) เป็นฉากหลัง
   node/edge เก็บฝั่ง DR (transport_nodes/transport_edges) พิกัด % 0-100
   ผูก Transport เฟส 1: จุด kind='stop' ใช้เป็นจุดจอดของรอบส่ง (Transport route tab)
   ดู docs/TRANSPORT_AMR_DESIGN.md · migration 20260731_transport_route_graph.sql   */

const MODES = [
  ['select', '✋ เลือก/ย้าย'],
  ['node',   '➕ เพิ่มจุด'],
  ['edge',   '🔗 เชื่อมถนน'],
  ['delete', '🗑 ลบ'],
]

export default function TransportMapEditor() {
  const { role, fullName } = useContext(UserContext)
  const canEdit = can('transport', 'manage', role)

  const [imageUrl, setImageUrl] = useState(null)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [lineNames, setLineNames] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('select')
  const [addKind, setAddKind] = useState('stop')
  const [edgeFrom, setEdgeFrom] = useState(null)     // node id ที่เลือกไว้ตอนเชื่อมถนน
  const [sel, setSel] = useState(null)               // { type:'node'|'edge', id }
  const [busy, setBusy] = useState(false)

  const wrapRef = useRef(null)
  const dragRef = useRef(null)                         // { id } กำลังลากย้าย node

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: fm }, { data: nd }, { data: eg }, { data: ln }] = await Promise.all([
      supabase.from('factory_map').select('image_url').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabaseDR.from('transport_nodes').select('*'),
      supabaseDR.from('transport_edges').select('*'),
      supabase.from('production_lines').select('name').order('name'),
    ])
    setImageUrl(fm?.image_url || null)
    setNodes(nd || [])
    setEdges(eg || [])
    setLineNames((ln || []).map(l => l.name).filter(Boolean))
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const nById = useMemo(() => { const m = {}; nodes.forEach(n => { m[n.id] = n }); return m }, [nodes])
  const graphStat = useMemo(() => {
    const { adj } = buildAdj(nodes.filter(n => n.is_active !== false), edges)
    const isolated = nodes.filter(n => n.is_active !== false && (adj[n.id] || []).length === 0).length
    return { stops: nodes.filter(n => n.kind === 'stop' && n.is_active !== false).length, isolated }
  }, [nodes, edges])

  const pctFromEvent = (clientX, clientY) => {
    const r = wrapRef.current.getBoundingClientRect()
    return {
      x: Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)),
      y: Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100)),
    }
  }

  // ─── persist helpers (DR · stamp updated_by_name เอง เหมือน Transport.jsx) ───
  const addNode = async (x, y) => {
    setBusy(true)
    try {
      const payload = { kind: addKind, x, y, is_active: true, updated_by_name: fullName }
      const { data, error } = await supabaseDR.from('transport_nodes').insert(payload).select('*').single()
      if (error) throw error
      setNodes(p => [...p, data])
      setSel({ type: 'node', id: data.id })
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  const moveNode = async (id, x, y) => {
    setNodes(p => p.map(n => n.id === id ? { ...n, x, y } : n))   // optimistic
    const { error } = await supabaseDR.from('transport_nodes')
      .update({ x, y, updated_by_name: fullName, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) toast.error(error.message)
  }
  const patchNode = async (id, patch) => {
    setNodes(p => p.map(n => n.id === id ? { ...n, ...patch } : n))
    const { error } = await supabaseDR.from('transport_nodes')
      .update({ ...patch, updated_by_name: fullName, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) toast.error(error.message)
  }
  const delNode = async (id) => {
    const { error } = await supabaseDR.from('transport_nodes').delete().eq('id', id)
    if (error) return toast.error(error.message)
    setNodes(p => p.filter(n => n.id !== id))
    setEdges(p => p.filter(e => e.a_node !== id && e.b_node !== id))  // cascade ฝั่ง DB แล้ว sync local
    setSel(null)
  }
  const addEdge = async (a, b) => {
    if (a === b) return
    if (edges.some(e => (e.a_node === a && e.b_node === b) || (e.a_node === b && e.b_node === a))) {
      toast.info('มีถนนเชื่อมคู่นี้แล้ว'); return
    }
    setBusy(true)
    try {
      const { data, error } = await supabaseDR.from('transport_edges')
        .insert({ a_node: a, b_node: b, bidir: true, is_active: true, updated_by_name: fullName }).select('*').single()
      if (error) throw error
      setEdges(p => [...p, data])
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  const patchEdge = async (id, patch) => {
    setEdges(p => p.map(e => e.id === id ? { ...e, ...patch } : e))
    const { error } = await supabaseDR.from('transport_edges')
      .update({ ...patch, updated_by_name: fullName, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) toast.error(error.message)
  }
  const delEdge = async (id) => {
    const { error } = await supabaseDR.from('transport_edges').delete().eq('id', id)
    if (error) return toast.error(error.message)
    setEdges(p => p.filter(e => e.id !== id))
    setSel(null)
  }

  // ─── pointer handlers ───
  const onMapClick = (e) => {
    if (!canEdit || mode !== 'node' || dragRef.current) return
    if (e.target.closest('[data-node]')) return       // คลิกโดนจุด ไม่เพิ่มใหม่
    const p = pctFromEvent(e.clientX, e.clientY)
    addNode(+p.x.toFixed(2), +p.y.toFixed(2))
  }
  const onNodeClick = (e, node) => {
    e.stopPropagation()
    if (!canEdit) { setSel({ type: 'node', id: node.id }); return }
    if (mode === 'delete') return delNode(node.id)
    if (mode === 'edge') {
      if (!edgeFrom) { setEdgeFrom(node.id) }
      else if (edgeFrom === node.id) { setEdgeFrom(null) }
      else { addEdge(edgeFrom, node.id); setEdgeFrom(null) }
      return
    }
    setSel({ type: 'node', id: node.id })
  }
  const onNodePointerDown = (e, node) => {
    if (!canEdit || mode !== 'select') return
    e.stopPropagation()
    dragRef.current = { id: node.id, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMapPointerMove = (e) => {
    if (!dragRef.current) return
    const p = pctFromEvent(e.clientX, e.clientY)
    dragRef.current.moved = true
    setNodes(prev => prev.map(n => n.id === dragRef.current.id ? { ...n, x: +p.x.toFixed(2), y: +p.y.toFixed(2) } : n))
  }
  const onMapPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d && d.moved) { const n = nById[d.id]; if (n) moveNode(d.id, n.x, n.y) }
  }
  const onEdgeClick = (e, edge) => {
    e.stopPropagation()
    if (!canEdit) return
    if (mode === 'delete') return delEdge(edge.id)
    setSel({ type: 'edge', id: edge.id })
  }

  const btn = (on) => ({
    padding: '7px 13px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
    border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
    background: on ? 'var(--accent-dim, rgba(74,222,128,.15))' : 'var(--bg3)', color: on ? 'var(--accent)' : 'var(--muted)',
  })

  if (loading) return <div style={{ padding: 30, color: 'var(--muted)' }}>กำลังโหลดผัง…</div>
  if (!imageUrl) return (
    <div style={{ padding: 30, borderRadius: 12, border: '1px dashed var(--border2)', background: 'var(--card)', color: 'var(--muted)', maxWidth: 640 }}>
      ยังไม่มีรูปผังโรงงาน — อัปโหลดที่แท็บ <b style={{ color: 'var(--text2)' }}>🗺️ ภาพรวมโรงงาน</b> ก่อน แล้วกลับมาวาดถนนทับผังเดียวกัน
    </div>
  )

  const selNode = sel?.type === 'node' ? nById[sel.id] : null
  const selEdge = sel?.type === 'edge' ? edges.find(e => e.id === sel.id) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* toolbar */}
      {canEdit ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {MODES.map(([k, l]) => (
            <button key={k} onClick={() => { setMode(k); setEdgeFrom(null); setSel(null) }} style={btn(mode === k)}>{l}</button>
          ))}
          {mode === 'node' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text2)' }}>
              ชนิดจุด:
              <select value={addKind} onChange={e => setAddKind(e.target.value)} style={{ width: 150, padding: '5px 8px', borderRadius: 7, fontSize: 12.5, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {NODE_KINDS.map(n => <option key={n.key} value={n.key}>{n.icon} {n.label}</option>)}
              </select>
            </label>
          )}
          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
            {nodes.length} จุด · {edges.length} เส้น · 📍 {graphStat.stops} จุดจอด{graphStat.isolated ? ` · ⚠ ${graphStat.isolated} จุดยังไม่เชื่อมถนน` : ''}
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>🔒 ดูอย่างเดียว (ต้องมีสิทธิ์ transport:manage เพื่อแก้)</div>
      )}
      {canEdit && (
        <div style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 11px' }}>
          {mode === 'node' && '👉 คลิกบนผังเพื่อวางจุด (แยก/จุดจอด/ท่าโหลด/จุดชาร์จ)'}
          {mode === 'edge' && (edgeFrom ? '👉 คลิกจุดปลายทางเพื่อเชื่อมถนน (คลิกจุดเดิมซ้ำ = ยกเลิก)' : '👉 คลิกจุดต้นทางเพื่อเริ่มเชื่อมถนน')}
          {mode === 'select' && '👉 คลิกจุด/เส้นเพื่อแก้ไข · ลากจุดเพื่อย้าย'}
          {mode === 'delete' && '👉 คลิกจุด (ลบจุด+ถนนที่ต่ออยู่) หรือคลิกเส้นเพื่อลบถนน'}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* map */}
        <div ref={wrapRef} onClick={onMapClick} onPointerMove={onMapPointerMove} onPointerUp={onMapPointerUp} onPointerCancel={onMapPointerUp}
          style={{ position: 'relative', flex: '1 1 560px', minWidth: 320, maxWidth: 1100, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', touchAction: 'none', cursor: mode === 'node' ? 'crosshair' : 'default' }}>
          <img src={imageUrl} alt="ผังถนนโรงงาน" style={{ display: 'block', width: '100%', height: 'auto', pointerEvents: 'none', userSelect: 'none' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,14,0.28)', pointerEvents: 'none' }} />
          {/* edges */}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <defs>
              <marker id="trArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#f59e0b" />
              </marker>
            </defs>
            {edges.map(e => {
              const a = nById[e.a_node], b = nById[e.b_node]
              if (!a || !b) return null
              const on = sel?.type === 'edge' && sel.id === e.id
              const dead = e.is_active === false
              return (
                <g key={e.id}>
                  {/* hit area (คลิกเลือก/ลบ) */}
                  {canEdit && (mode === 'select' || mode === 'delete') && (
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="3"
                      vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'stroke', cursor: 'pointer', strokeWidth: 14 }}
                      onClick={(ev) => onEdgeClick(ev, e)} />
                  )}
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={dead ? '#64748b' : on ? '#fbbf24' : '#f59e0b'} strokeOpacity={dead ? 0.4 : on ? 1 : 0.8}
                    strokeWidth={on ? 3 : 2} strokeDasharray={dead ? '4 3' : undefined}
                    markerEnd={e.bidir === false ? 'url(#trArrow)' : undefined}
                    vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
                </g>
              )
            })}
          </svg>
          {/* nodes (HTML markers) */}
          {nodes.map(n => {
            const k = nodeKind(n.kind)
            const dim = n.is_active === false
            const selected = sel?.type === 'node' && sel.id === n.id
            const isFrom = edgeFrom === n.id
            return (
              <div key={n.id} data-node onClick={(e) => onNodeClick(e, n)} onPointerDown={(e) => onNodePointerDown(e, n)}
                title={n.name || k.label}
                style={{
                  position: 'absolute', left: `${n.x}%`, top: `${n.y}%`, transform: 'translate(-50%,-50%)',
                  width: n.kind === 'junction' ? 15 : 22, height: n.kind === 'junction' ? 15 : 22, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                  background: k.color, opacity: dim ? 0.4 : 1,
                  border: `2px solid ${isFrom ? '#fff' : selected ? '#fbbf24' : 'rgba(0,0,0,0.5)'}`,
                  boxShadow: (isFrom || selected) ? '0 0 0 3px rgba(251,191,36,0.5)' : '0 1px 4px rgba(0,0,0,0.5)',
                  cursor: canEdit ? (mode === 'select' ? 'grab' : 'pointer') : 'default', touchAction: 'none', zIndex: 2,
                }}>
                {n.kind !== 'junction' && <span style={{ pointerEvents: 'none' }}>{k.icon}</span>}
                {n.name && (
                  <span style={{ position: 'absolute', top: '105%', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 700, color: '#fff', background: 'rgba(9,11,18,0.82)', padding: '1px 5px', borderRadius: 4, pointerEvents: 'none' }}>{n.name}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* side editor */}
        <div style={{ flex: '0 0 250px', minWidth: 230, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text2)', marginBottom: 8 }}>สัญลักษณ์</div>
            {NODE_KINDS.map(k => (
              <div key={k.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                <span style={{ width: 15, height: 15, borderRadius: '50%', background: k.color, display: 'inline-block' }} /> {k.icon} {k.label}
              </div>
            ))}
          </div>

          {canEdit && selNode && (
            <div style={{ background: 'var(--card)', border: '1px solid var(--accent)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>✏️ แก้ไขจุด</div>
              <FieldLbl t="ชื่อจุด">
                <input value={selNode.name || ''} onChange={e => patchNode(selNode.id, { name: e.target.value })} placeholder="เช่น STORE-IN, แยก A" style={inp} />
              </FieldLbl>
              <FieldLbl t="ชนิด">
                <select value={selNode.kind} onChange={e => patchNode(selNode.id, { kind: e.target.value })} style={inp}>
                  {NODE_KINDS.map(n => <option key={n.key} value={n.key}>{n.icon} {n.label}</option>)}
                </select>
              </FieldLbl>
              <FieldLbl t="ผูกไลน์/สโตร์ (optional)">
                <input list="tr-lines" value={selNode.line_name || ''} onChange={e => patchNode(selNode.id, { line_name: e.target.value || null })} placeholder="ไลน์ที่จุดจอดนี้บริการ" style={inp} />
                <datalist id="tr-lines">{lineNames.map(l => <option key={l} value={l} />)}</datalist>
              </FieldLbl>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text2)', margin: '6px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={selNode.is_active !== false} onChange={e => patchNode(selNode.id, { is_active: e.target.checked })} style={{ width: 'auto' }} /> ใช้งาน
              </label>
              <button onClick={() => delNode(selNode.id)} style={delBtn}>🗑 ลบจุดนี้</button>
            </div>
          )}
          {canEdit && selEdge && (
            <div style={{ background: 'var(--card)', border: '1px solid var(--accent)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>✏️ แก้ไขถนน</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                {(nById[selEdge.a_node]?.name || 'จุด')} ↔ {(nById[selEdge.b_node]?.name || 'จุด')}<br />
                ระยะ (หน่วยผัง) ≈ {edgeWeight(selEdge, nById).toFixed(1)}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text2)', margin: '6px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={selEdge.bidir === false} onChange={e => patchEdge(selEdge.id, { bidir: !e.target.checked })} style={{ width: 'auto' }} /> เดินทางเดียว (one-way {(nById[selEdge.a_node]?.name || 'A')}→{(nById[selEdge.b_node]?.name || 'B')})
              </label>
              <button onClick={() => delEdge(selEdge.id)} style={delBtn}>🗑 ลบถนนนี้</button>
            </div>
          )}
          {canEdit && !sel && (
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 2px' }}>เลือกจุด/เส้นบนผังเพื่อแก้ไข</div>
          )}
        </div>
      </div>
    </div>
  )
}

const inp = { width: '100%', padding: '6px 9px', borderRadius: 7, fontSize: 12.5, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', marginTop: 3 }
const delBtn = { marginTop: 8, width: '100%', padding: '7px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)' }
function FieldLbl({ t, children }) {
  return <div style={{ marginBottom: 7 }}><span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>{t}</span>{children}</div>
}
