// ─── Transport route graph helpers (pure) ───────────────────────────────────
// กราฟถนน/ทางเดินรถในโรงงาน — node(%coord) + edge → คำนวณเส้นทางสั้นสุด (Dijkstra)
// ใช้ร่วม: TransportMapEditor (วาด/แสดง) + Transport route tab (route ต่อรอบส่ง)
//
// พิกัดเป็น % ของรูปผัง (0-100) เหมือน factory_line_regions → ระยะทางเป็น "หน่วยผัง"
// (relative) ไม่ใช่เมตรจริง จนกว่าจะมี scale calibration — ให้ label ว่า relative เสมอ

export const NODE_KINDS = [
  { key: 'junction', label: 'แยก/ทางผ่าน', icon: '⚬', color: '#94a3b8' },
  { key: 'stop',     label: 'จุดจอด/ส่ง',   icon: '📍', color: '#f59e0b' },
  { key: 'dock',     label: 'ท่าโหลด/สโตร์', icon: '🏬', color: '#38bdf8' },
  { key: 'charge',   label: 'จุดชาร์จ AMR',  icon: '🔌', color: '#4ade80' },
]
export const nodeKind = (k) => NODE_KINDS.find(n => n.key === k) || NODE_KINDS[0]

// ระยะทาง euclidean ในหน่วย %coord
export const nodeDist = (a, b) => {
  const dx = Number(a.x) - Number(b.x)
  const dy = Number(a.y) - Number(b.y)
  return Math.sqrt(dx * dx + dy * dy)
}

// น้ำหนัก edge = weight ที่ตั้งไว้ (ถ้ามี) หรือระยะทางจริงจากพิกัด
export const edgeWeight = (edge, nById) => {
  if (edge.weight != null && edge.weight !== '') return Number(edge.weight)
  const a = nById[edge.a_node], b = nById[edge.b_node]
  if (!a || !b) return Infinity
  return nodeDist(a, b)
}

// สร้าง adjacency list จาก nodes + edges (เฉพาะ active)
//   คืน { [nodeId]: [{ to, w }] } · edge undirected (bidir) → เพิ่มทั้งสองทาง
export function buildAdj(nodes, edges) {
  const nById = {}
  nodes.forEach(n => { if (n.is_active !== false) nById[n.id] = n })
  const adj = {}
  Object.keys(nById).forEach(id => { adj[id] = [] })
  edges.forEach(e => {
    if (e.is_active === false) return
    if (!nById[e.a_node] || !nById[e.b_node]) return
    const w = edgeWeight(e, nById)
    adj[e.a_node].push({ to: e.b_node, w })
    if (e.bidir !== false) adj[e.b_node].push({ to: e.a_node, w })
  })
  return { adj, nById }
}

// Dijkstra: เส้นทางสั้นสุด startId → endId
//   คืน { path: [nodeId...], distance } · หาไม่เจอ → { path: [], distance: Infinity }
export function shortestPath(adj, startId, endId) {
  if (startId === endId) return { path: [startId], distance: 0 }
  if (!adj[startId] || !adj[endId]) return { path: [], distance: Infinity }
  const dist = {}, prev = {}, visited = {}
  Object.keys(adj).forEach(id => { dist[id] = Infinity })
  dist[startId] = 0
  // simple O(V^2) — กราฟผังโรงงานเล็ก (สิบ-ร้อย node) พอเพียง ไม่ต้อง heap
  const N = Object.keys(adj).length
  for (let i = 0; i < N; i++) {
    let u = null, best = Infinity
    for (const id in dist) { if (!visited[id] && dist[id] < best) { best = dist[id]; u = id } }
    if (u == null) break
    if (u === endId) break
    visited[u] = true
    for (const { to, w } of adj[u]) {
      if (visited[to]) continue
      const nd = dist[u] + w
      if (nd < dist[to]) { dist[to] = nd; prev[to] = u }
    }
  }
  if (dist[endId] === Infinity) return { path: [], distance: Infinity }
  const path = []
  let cur = endId
  while (cur != null) { path.unshift(cur); cur = prev[cur] }
  return { path, distance: dist[endId] }
}

// route ผ่านลำดับ stop (node ids) — pathfind ทีละคู่ที่ติดกันแล้วต่อกัน
//   คืน { segments:[{from,to,path,distance,ok}], nodePath:[...], distance, ok, brokenAt }
//   ok=false ถ้ามีคู่ใดหากันไม่เจอ (ถนนขาด) — brokenAt = index ของ stop คู่ที่ขาด
export function routeThroughStops(nodes, edges, stopNodeIds) {
  const ids = (stopNodeIds || []).filter(Boolean)
  const { adj } = buildAdj(nodes, edges)
  const out = { segments: [], nodePath: [], distance: 0, ok: true, brokenAt: -1 }
  if (ids.length === 0) return out
  if (ids.length === 1) { out.nodePath = [ids[0]]; return out }
  for (let i = 0; i < ids.length - 1; i++) {
    const from = ids[i], to = ids[i + 1]
    const { path, distance } = shortestPath(adj, from, to)
    const okSeg = path.length > 0 && distance < Infinity
    out.segments.push({ from, to, path, distance, ok: okSeg })
    if (!okSeg) { out.ok = false; if (out.brokenAt < 0) out.brokenAt = i; continue }
    out.distance += distance
    // ต่อ node path (กันซ้ำจุดเชื่อมระหว่าง segment)
    const add = out.nodePath.length ? path.slice(1) : path
    out.nodePath.push(...add)
  }
  return out
}

// ประเมินเวลา (นาที) จากระยะทางผัง — carrier ความเร็ว unitPerMin (หน่วยผัง/นาที)
//   default = null (ไม่ประเมิน) เพราะยังไม่ได้ calibrate scale
export const estMinutes = (distance, unitPerMin) =>
  (unitPerMin && unitPerMin > 0 && distance < Infinity) ? distance / unitPerMin : null
