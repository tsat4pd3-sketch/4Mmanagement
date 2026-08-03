import { useState, useEffect, useRef, useCallback, useContext, useMemo } from 'react'
import { supabase, supabaseDR } from '../supabaseClient'
import { UserContext } from '../App'
import { can } from '../utils/permissions'
import { toast } from '../components/Toast'
import { NODE_KINDS, nodeKind, buildAdj, edgeWeight, segIntersect, closestPointOnSeg } from '../utils/transportGraph'
import useUndoHistory, { undoBtnStyle } from '../utils/useUndoHistory'

/* ─── TransportMapEditor — วาดกราฟถนน/ทางเดินรถบนผังใหญ่ (Store/AMR) ──────────
   ใช้รูปผังตัวเดียวกับ /factory-map (factory_map ฝั่ง Main) เป็นฉากหลัง
   node/edge เก็บฝั่ง DR (transport_nodes/transport_edges) พิกัด % 0-100
   ผูก Transport เฟส 1: จุด kind='stop' ใช้เป็นจุดจอดของรอบส่ง (Transport route tab)
   ดู docs/TRANSPORT_AMR_DESIGN.md · migration 20260731_transport_route_graph.sql   */

const MODES = [
  ['select', '✋ เลือก/ย้าย'],
  ['draw',   '✏️ วาดถนนต่อเนื่อง'],
  ['node',   '➕ เพิ่มจุดเดี่ยว'],
  ['edge',   '🔗 เชื่อม 2 จุด'],
  ['delete', '🗑 ลบ'],
]
const SNAP_PCT = 2.8   // ระยะ snap เข้าจุดเดิม (หน่วย % ของผัง)

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
  const [chainLast, setChainLast] = useState(null)   // โหมดวาดต่อเนื่อง: node id ล่าสุดในเส้นที่กำลังวาด
  const [drawHover, setDrawHover] = useState(null)   // { x, y } ตำแหน่งเคอร์เซอร์ (เส้น preview)
  const [mpu, setMpu] = useState(null)               // meters per unit (มาตราส่วน)
  const [scaleMode, setScaleMode] = useState(false)  // กำลังตั้งมาตราส่วน (คลิก 2 จุด)
  const [scalePts, setScalePts] = useState([])       // [{x,y}...] จุดอ้างอิงมาตราส่วน
  const [scaleMeters, setScaleMeters] = useState('') // input เมตรจริงของ 2 จุด

  const wrapRef = useRef(null)
  const dragRef = useRef(null)                         // { id } กำลังลากย้าย node
  const nodesRef = useRef([])                          // sync ล่าสุด (รวม node ที่เพิ่งสร้างในคลิกเดียวกัน) กัน stale
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  const edgesRef = useRef([])
  useEffect(() => { edgesRef.current = edges }, [edges])
  const getNode = (id) => nodesRef.current.find(n => n.id === id)

  // ─── Undo/Redo (snapshot ทั้งกราฟก่อนทุก action — restore = diff แล้วเขียนย้อนลง DB) ───
  const snapOf = () => ({ nodes: nodesRef.current.map(n => ({ ...n })), edges: edgesRef.current.map(e => ({ ...e })) })
  const NODE_FIELDS = ['kind', 'x', 'y', 'name', 'line_name', 'is_active']
  const EDGE_FIELDS = ['a_node', 'b_node', 'bidir', 'is_active', 'weight']
  const pick = (row, fields) => Object.fromEntries(fields.map(f => [f, row[f] ?? null]))
  const applySnapshot = async (snap) => {
    const curN = nodesRef.current, curE = edgesRef.current
    const sN = new Map(snap.nodes.map(n => [n.id, n])), cN = new Map(curN.map(n => [n.id, n]))
    const sE = new Map(snap.edges.map(e => [e.id, e])), cE = new Map(curE.map(e => [e.id, e]))
    const delE = curE.filter(e => !sE.has(e.id)).map(e => e.id)
    const delN = curN.filter(n => !sN.has(n.id)).map(n => n.id)
    const insN = snap.nodes.filter(n => !cN.has(n.id))
    const insE = snap.edges.filter(e => !cE.has(e.id))
    const updN = snap.nodes.filter(n => { const c = cN.get(n.id); return c && NODE_FIELDS.some(f => (c[f] ?? null) !== (n[f] ?? null)) })
    const updE = snap.edges.filter(e => { const c = cE.get(e.id); return c && EDGE_FIELDS.some(f => (c[f] ?? null) !== (e[f] ?? null)) })
    try {
      // ลำดับสำคัญ (FK edge→node): ลบเส้นก่อนจุด · คืนจุดก่อนเส้น
      if (delE.length) { const { error } = await supabaseDR.from('transport_edges').delete().in('id', delE); if (error) throw error }
      if (delN.length) { const { error } = await supabaseDR.from('transport_nodes').delete().in('id', delN); if (error) throw error }
      if (insN.length) { const { error } = await supabaseDR.from('transport_nodes').insert(insN); if (error) throw error }
      if (insE.length) { const { error } = await supabaseDR.from('transport_edges').insert(insE); if (error) throw error }
      for (const n of updN) { const { error } = await supabaseDR.from('transport_nodes').update({ ...pick(n, NODE_FIELDS), updated_by_name: fullName }).eq('id', n.id); if (error) throw error }
      for (const e of updE) { const { error } = await supabaseDR.from('transport_edges').update({ ...pick(e, EDGE_FIELDS), updated_by_name: fullName }).eq('id', e.id); if (error) throw error }
    } catch (err) { toast.error('ย้อนไม่สำเร็จ: ' + err.message); await load(); return false }
    nodesRef.current = snap.nodes; edgesRef.current = snap.edges
    setNodes(snap.nodes); setEdges(snap.edges)
    setSel(null); setEdgeFrom(null); setChainLast(null); setDrawHover(null)
    return true
  }
  const hist = useUndoHistory({ snapOf, applySnapshot, enabled: canEdit })
  const { pushHistory, pushSnapshot } = hist

  const resetChain = () => { setChainLast(null); setDrawHover(null) }
  // Esc = จบเส้นที่กำลังวาด
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') resetChain() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: fm }, { data: nd }, { data: eg }, { data: ln }, { data: ts }] = await Promise.all([
      supabase.from('factory_map').select('image_url').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabaseDR.from('transport_nodes').select('*'),
      supabaseDR.from('transport_edges').select('*'),
      supabase.from('production_lines').select('name').order('name'),
      supabaseDR.from('transport_settings').select('meters_per_unit').eq('id', 1).maybeSingle(),
    ])
    setImageUrl(fm?.image_url || null)
    setNodes(nd || [])
    setEdges(eg || [])
    setLineNames((ln || []).map(l => l.name).filter(Boolean))
    setMpu(ts?.meters_per_unit ?? null)
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
  const createNodeRow = async (x, y, kind) => {
    const payload = { kind, x: +x.toFixed(2), y: +y.toFixed(2), is_active: true, updated_by_name: fullName }
    const { data, error } = await supabaseDR.from('transport_nodes').insert(payload).select('*').single()
    if (error) { toast.error(error.message); return null }
    nodesRef.current = [...nodesRef.current, data]   // อัปเดตทันที กัน stale ในคลิกเดียวกัน
    setNodes(p => [...p, data])
    return data
  }
  const addNode = async (x, y) => {
    setBusy(true)
    pushHistory()
    const d = await createNodeRow(x, y, addKind)
    if (d) setSel({ type: 'node', id: d.id })
    setBusy(false)
  }
  // จุดที่ใกล้ (x,y) ที่สุดในระยะ snap — คืน node หรือ null (ใช้ต่อถนน/บรรจบ)
  const nearestNode = (x, y) => {
    let best = null, bd = SNAP_PCT
    for (const n of nodes) { if (n.is_active === false) continue; const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n } }
    return best
  }
  // ถนนเดิมที่ (x,y) อยู่ใกล้ที่สุดในระยะ snap — คืน { edge, pt } หรือ null (ใช้วางจุดลงบนถนน = สามแยก)
  const nearestEdge = (x, y) => {
    let best = null, bd = SNAP_PCT
    for (const e of edges) {
      if (e.is_active === false) continue
      const a = nById[e.a_node], b = nById[e.b_node]; if (!a || !b) continue
      const c = closestPointOnSeg({ x, y }, a, b)
      if (c.dist < bd) { bd = c.dist; best = { edge: e, pt: { x: c.x, y: c.y } } }
    }
    return best
  }
  // โหมดวาดต่อเนื่อง: คลิก 1 ที = วางจุด (หรือ snap จุดเดิม/แทรกลงบนถนนเดิม) + ต่อเส้นจากจุดก่อนหน้า
  const drawStep = async (x, y, existing) => {
    setBusy(true)
    pushHistory()
    let target = existing || nearestNode(x, y)
    if (!target) {
      const onEdge = nearestEdge(x, y)
      target = onEdge ? await splitEdgeAt(onEdge.edge, onEdge.pt)   // คลิกลงบนถนนเดิม → แตกเป็นสามแยก
        : await createNodeRow(x, y, 'junction')
    }
    if (target) {
      if (chainLast && chainLast !== target.id) await addEdge(chainLast, target.id, true)
      setChainLast(target.id)
    }
    setBusy(false)
  }
  const moveNode = async (id, x, y) => {
    setNodes(p => p.map(n => n.id === id ? { ...n, x, y } : n))   // optimistic
    const { error } = await supabaseDR.from('transport_nodes')
      .update({ x, y, updated_by_name: fullName, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) toast.error(error.message)
  }
  const patchNode = async (id, patch) => {
    pushHistory(`patchNode:${id}:${Object.keys(patch).join()}`)
    setNodes(p => p.map(n => n.id === id ? { ...n, ...patch } : n))
    const { error } = await supabaseDR.from('transport_nodes')
      .update({ ...patch, updated_by_name: fullName, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) toast.error(error.message)
  }
  const delNode = async (id) => {
    pushHistory()
    const { error } = await supabaseDR.from('transport_nodes').delete().eq('id', id)
    if (error) return toast.error(error.message)
    setNodes(p => p.filter(n => n.id !== id))
    setEdges(p => p.filter(e => e.a_node !== id && e.b_node !== id))  // cascade ฝั่ง DB แล้ว sync local
    setSel(null)
  }
  // แทรกถนน 1 เส้น (ไม่ตรวจจุดตัด) — คืน row หรือ null
  const insertEdge = async (a, b, curEdges) => {
    if (a === b) return null
    if ((curEdges || edges).some(e => (e.a_node === a && e.b_node === b) || (e.a_node === b && e.b_node === a))) return null
    const { data, error } = await supabaseDR.from('transport_edges')
      .insert({ a_node: a, b_node: b, bidir: true, is_active: true, updated_by_name: fullName }).select('*').single()
    if (error) { toast.error(error.message); return null }
    setEdges(p => [...p, data])
    return data
  }
  // ตัดถนนเดิมตรงจุด pt → แทรก node (แยก) + แทน edge เดิมด้วย 2 ท่อน · คืน node ใหม่
  const splitEdgeAt = async (edge, pt) => {
    const node = await createNodeRow(pt.x, pt.y, 'junction')
    if (!node) return null
    const bidir = edge.bidir !== false
    await supabaseDR.from('transport_edges').delete().eq('id', edge.id)
    const { data: two, error } = await supabaseDR.from('transport_edges').insert([
      { a_node: edge.a_node, b_node: node.id, bidir, is_active: true, updated_by_name: fullName },
      { a_node: node.id, b_node: edge.b_node, bidir, is_active: true, updated_by_name: fullName },
    ]).select('*')
    if (error) { toast.error(error.message); return null }
    setEdges(p => p.filter(e => e.id !== edge.id).concat(two || []))
    return node
  }
  // เพิ่มถนน a→b พร้อม auto-junction: ถ้าเส้นใหม่ตัดถนนเดิม แทรกแยกตรงจุดตัดแล้วเชื่อมให้ครบ
  const addEdge = async (aId, bId, silent = false) => {
    if (aId === bId) return
    if (edges.some(e => (e.a_node === aId && e.b_node === bId) || (e.a_node === bId && e.b_node === aId))) {
      if (!silent) toast.info('มีถนนเชื่อมคู่นี้แล้ว'); return
    }
    const A = getNode(aId), B = getNode(bId)
    if (!A || !B) return
    if (!silent) pushHistory()   // เรียกจากโหมดเชื่อม 2 จุด (โหมดวาด: drawStep push ให้แล้ว)
    // หา edge เดิมที่ตัดกับ A-B (ข้ามเส้นที่แชร์ปลายกับ A หรือ B อยู่แล้ว)
    const crossings = []
    for (const e of edges) {
      if (e.is_active === false) continue
      if ([e.a_node, e.b_node].includes(aId) || [e.a_node, e.b_node].includes(bId)) continue
      const P = getNode(e.a_node), Q = getNode(e.b_node)
      if (!P || !Q) continue
      const x = segIntersect(A, B, P, Q)
      if (x) crossings.push({ edge: e, pt: { x: x.x, y: x.y }, t: x.t })
    }
    if (crossings.length === 0) { await insertEdge(aId, bId); return }
    // เรียงตามระยะจาก A → สร้างแยกทีละจุด + ต่อเป็นลูกโซ่ A—X1—X2—…—B
    crossings.sort((c1, c2) => c1.t - c2.t)
    let prev = aId
    for (const c of crossings) {
      const jn = await splitEdgeAt(c.edge, c.pt)
      if (jn) { await insertEdge(prev, jn.id); prev = jn.id }
    }
    await insertEdge(prev, bId)
  }
  const patchEdge = async (id, patch) => {
    pushHistory(`patchEdge:${id}:${Object.keys(patch).join()}`)
    setEdges(p => p.map(e => e.id === id ? { ...e, ...patch } : e))
    const { error } = await supabaseDR.from('transport_edges')
      .update({ ...patch, updated_by_name: fullName, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) toast.error(error.message)
  }
  const delEdge = async (id) => {
    pushHistory()
    const { error } = await supabaseDR.from('transport_edges').delete().eq('id', id)
    if (error) return toast.error(error.message)
    setEdges(p => p.filter(e => e.id !== id))
    setSel(null)
  }

  const addScalePt = (x, y) => setScalePts(prev => prev.length >= 2 ? [{ x, y }] : [...prev, { x, y }])
  const saveScale = async (metersPerUnit) => {
    const { error } = await supabaseDR.from('transport_settings')
      .upsert({ id: 1, meters_per_unit: metersPerUnit, updated_by_name: fullName, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (error) return toast.error(error.message)
    setMpu(metersPerUnit); setScaleMode(false); setScalePts([]); setScaleMeters(''); toast.success('บันทึกมาตราส่วนแล้ว')
  }

  // ─── pointer handlers ───
  const onMapClick = (e) => {
    if (!canEdit || dragRef.current) return
    if (scaleMode) { const p = pctFromEvent(e.clientX, e.clientY); addScalePt(+p.x.toFixed(2), +p.y.toFixed(2)); return }
    if (e.target.closest('[data-node]')) return       // คลิกโดนจุด ไม่เพิ่มใหม่ (node handler จัดการ)
    const p = pctFromEvent(e.clientX, e.clientY)
    if (mode === 'node') addNode(p.x, p.y)
    else if (mode === 'draw') drawStep(p.x, p.y)
  }
  const onNodeClick = (e, node) => {
    e.stopPropagation()
    if (scaleMode) { addScalePt(node.x, node.y); return }   // ใช้พิกัดจุดเป็นอ้างอิงมาตราส่วน
    if (!canEdit) { setSel({ type: 'node', id: node.id }); return }
    if (mode === 'delete') return delNode(node.id)
    if (mode === 'draw') { drawStep(node.x, node.y, node); return }   // คลิกจุดเดิม = ต่อถนนเข้าจุดนั้น (บรรจบ/สี่แยก)
    if (mode === 'edge') {
      if (!edgeFrom) { setEdgeFrom(node.id) }
      else if (edgeFrom === node.id) { setEdgeFrom(null) }
      else { addEdge(edgeFrom, node.id); setEdgeFrom(null) }
      return
    }
    setSel({ type: 'node', id: node.id })
  }
  const onNodePointerDown = (e, node) => {
    if (!canEdit || mode !== 'select' || scaleMode) return
    e.stopPropagation()
    dragRef.current = { id: node.id, moved: false, snap: snapOf() }   // ถ่าย snapshot ก่อนลาก (undo คืนที่เดิม)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMapPointerMove = (e) => {
    if (dragRef.current) {
      const p = pctFromEvent(e.clientX, e.clientY)
      dragRef.current.moved = true
      setNodes(prev => prev.map(n => n.id === dragRef.current.id ? { ...n, x: +p.x.toFixed(2), y: +p.y.toFixed(2) } : n))
      return
    }
    if (mode === 'draw' && chainLast && e.pointerType === 'mouse') {   // เส้น preview ตามเคอร์เซอร์ (เมาส์เท่านั้น)
      const p = pctFromEvent(e.clientX, e.clientY)
      setDrawHover({ x: p.x, y: p.y })
    }
  }
  const onMapPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d && d.moved) {
      if (d.snap) pushSnapshot(d.snap)
      const n = nById[d.id]; if (n) moveNode(d.id, n.x, n.y)
    }
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
            <button key={k} onClick={() => { setMode(k); setEdgeFrom(null); setSel(null); resetChain() }} style={btn(mode === k)}>{l}</button>
          ))}
          {mode === 'draw' && chainLast && (
            <button onClick={resetChain} style={{ padding: '7px 13px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, border: '1.5px solid var(--accent)', background: 'var(--accent)', color: '#08130a' }}>✓ จบเส้น (Esc)</button>
          )}
          {mode === 'node' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text2)' }}>
              ชนิดจุด:
              <select value={addKind} onChange={e => setAddKind(e.target.value)} style={{ width: 150, padding: '5px 8px', borderRadius: 7, fontSize: 12.5, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {NODE_KINDS.map(n => <option key={n.key} value={n.key}>{n.icon} {n.label}</option>)}
              </select>
            </label>
          )}
          <button onClick={() => { setScaleMode(v => !v); setScalePts([]); setScaleMeters('') }}
            style={btn(scaleMode)}>📏 มาตราส่วน</button>
          <button onClick={hist.undo} disabled={!hist.canUndo || hist.busy || busy} style={undoBtnStyle(hist.canUndo && !hist.busy && !busy)} title="ย้อนกลับ (Ctrl+Z)">↩️ Undo</button>
          <button onClick={hist.redo} disabled={!hist.canRedo || hist.busy || busy} style={undoBtnStyle(hist.canRedo && !hist.busy && !busy)} title="ทำซ้ำ (Ctrl+Y)">↪️ Redo</button>
          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
            {nodes.length} จุด · {edges.length} เส้น · 📍 {graphStat.stops} จุดจอด{graphStat.isolated ? ` · ⚠ ${graphStat.isolated} จุดยังไม่เชื่อมถนน` : ''}
            {mpu ? ` · 📏 1 หน่วย ≈ ${mpu.toFixed(2)} ม.` : ' · 📏 ยังไม่ตั้งมาตราส่วน'}
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>🔒 ดูอย่างเดียว (ต้องมีสิทธิ์ transport:manage เพื่อแก้)</div>
      )}
      {canEdit && scaleMode && (
        <div style={{ fontSize: 12, color: '#f0abfc', background: 'rgba(217,70,239,0.1)', border: '1px solid rgba(217,70,239,0.4)', borderRadius: 8, padding: '7px 11px' }}>
          📏 คลิก 2 จุดบนผังที่รู้ระยะจริง (เช่น ความกว้างช่องจอด/ความยาวไลน์) แล้วกรอกระยะเป็นเมตร — {scalePts.length}/2 จุด
        </div>
      )}
      {canEdit && !scaleMode && (
        <div style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 11px' }}>
          {mode === 'draw' && (chainLast
            ? '✏️ คลิกจุดถัดไปตามแนวถนน — ทางเลี้ยว/หัวโค้งให้คลิกตรงมุมทุกจุด เส้นจะหักตาม (ไม่ตัดทะลุ) · คลิกใกล้จุดเดิม = บรรจบ/สี่แยก · กด "✓ จบเส้น" หรือ Esc เพื่อขึ้นเส้นใหม่'
            : '✏️ คลิกจุดเริ่มต้นบนแนวถนน แล้วคลิกไล่ไปตามถนน (คลิกทุกมุมที่เลี้ยว) ระบบวางจุด+ต่อเส้นให้อัตโนมัติ')}
          {mode === 'node' && '👉 คลิกบนผังเพื่อวางจุดเดี่ยว (เลือกชนิดจุดจาก dropdown)'}
          {mode === 'edge' && (edgeFrom ? '👉 คลิกจุดปลายทางเพื่อเชื่อมถนน (คลิกจุดเดิมซ้ำ = ยกเลิก)' : '👉 คลิกจุดต้นทางเพื่อเริ่มเชื่อม 2 จุด')}
          {mode === 'select' && '👉 คลิกจุด/เส้นเพื่อแก้ไข · ลากจุดเพื่อย้าย'}
          {mode === 'delete' && '👉 คลิกจุด (ลบจุด+ถนนที่ต่ออยู่) หรือคลิกเส้นเพื่อลบถนน'}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* map */}
        <div ref={wrapRef} onClick={onMapClick} onPointerMove={onMapPointerMove} onPointerUp={onMapPointerUp} onPointerCancel={onMapPointerUp}
          style={{ position: 'relative', flex: '1 1 560px', minWidth: 320, maxWidth: 1100, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', touchAction: 'none', cursor: (mode === 'node' || mode === 'draw') ? 'crosshair' : 'default' }}>
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
            {/* เส้น preview ตอนวาดต่อเนื่อง (จากจุดล่าสุด → เคอร์เซอร์) */}
            {mode === 'draw' && chainLast && drawHover && nById[chainLast] && (
              <line x1={nById[chainLast].x} y1={nById[chainLast].y} x2={drawHover.x} y2={drawHover.y}
                stroke="#4ade80" strokeOpacity="0.8" strokeWidth="2" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
            )}
            {/* เส้นอ้างอิงมาตราส่วน */}
            {scalePts.length === 2 && (
              <line x1={scalePts[0].x} y1={scalePts[0].y} x2={scalePts[1].x} y2={scalePts[1].y}
                stroke="#e879f9" strokeWidth="2.5" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {scalePts.map((p, i) => (
            <div key={`sp${i}`} style={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%,-50%)', width: 14, height: 14, borderRadius: '50%', background: '#e879f9', border: '2px solid #fff', zIndex: 3 }} />
          ))}
          {/* nodes (HTML markers) */}
          {nodes.map(n => {
            const k = nodeKind(n.kind)
            const dim = n.is_active === false
            const selected = sel?.type === 'node' && sel.id === n.id
            const isFrom = edgeFrom === n.id || (mode === 'draw' && chainLast === n.id)
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

      {/* modal ตั้งมาตราส่วน */}
      {canEdit && scaleMode && scalePts.length === 2 && (() => {
        const unitDist = Math.hypot(scalePts[0].x - scalePts[1].x, scalePts[0].y - scalePts[1].y)
        const m = parseFloat(scaleMeters)
        const ok = m > 0 && unitDist > 1e-6
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, width: 'min(94vw, 380px)' }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 900, color: 'var(--text)' }}>📏 ตั้งมาตราส่วน</h3>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>ระยะ 2 จุดที่เลือก = <b style={{ color: 'var(--text2)' }}>{unitDist.toFixed(2)}</b> หน่วยผัง</div>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>ระยะจริงของ 2 จุดนี้ (เมตร)</span>
              <input type="number" min="0" step="0.1" autoFocus value={scaleMeters} onChange={e => setScaleMeters(e.target.value)}
                placeholder="เช่น 25" style={inp} />
              {ok && <div style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 700, marginTop: 8 }}>→ 1 หน่วยผัง ≈ {(m / unitDist).toFixed(2)} ม. (ทั้งผังกว้าง ≈ {(m / unitDist * 100).toFixed(0)} ม.)</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button onClick={() => setScalePts([])} style={{ padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)' }}>เลือกจุดใหม่</button>
                <button onClick={() => ok && saveScale(m / unitDist)} disabled={!ok} style={{ padding: '8px 18px', borderRadius: 8, cursor: ok ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, background: ok ? 'var(--accent)' : 'var(--bg2)', color: ok ? '#08130a' : 'var(--muted)', border: 'none' }}>💾 บันทึก</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

const inp = { width: '100%', padding: '6px 9px', borderRadius: 7, fontSize: 12.5, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', marginTop: 3 }
const delBtn = { marginTop: 8, width: '100%', padding: '7px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)' }
function FieldLbl({ t, children }) {
  return <div style={{ marginBottom: 7 }}><span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>{t}</span>{children}</div>
}
