import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { getRoundStatus } from '../utils/deliveryRounds';
import { routeThroughStops, nodeKind } from '../utils/transportGraph';

/* ─── TRANSPORT — มอบหมายขนส่ง (Teiki-bin phase 1: ก) ─────────────────────────
   ชั้น carrier (คนขับ/ผู้ขน) + สกิลยานพาหนะ + มอบหมาย carrier ให้ "รอบส่ง" ที่มีอยู่
   ต่อยอดบน kanban_delivery_rounds ไม่สร้างคิว/บอร์ดใหม่ · ตาราง DR (anon)
   ดู docs/TRANSPORT_AMR_DESIGN.md — เฟสถัดไป: Dispatch Board รวม / empty_return / KPI */

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 };
const getWorkDate = () => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const SHIFTS = [['day', '☀️ กะเช้า'], ['night', '🌙 กะดึก'], ['both', '🔄 ทั้งสองกะ']];

export default function Transport() {
  const { role, fullName } = useContext(UserContext);
  const canManage = can('transport', 'manage', role);

  const [tab, setTab] = useState('assign');
  const [vehicles, setVehicles] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [assigns, setAssigns] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [roundStops, setRoundStops] = useState([]);
  const [imageUrl, setImageUrl] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [editCarrier, setEditCarrier] = useState(null);
  const [busy, setBusy] = useState(null);
  const workDate = getWorkDate();

  const load = useCallback(async () => {
    const [{ data: veh }, { data: car }, { data: rds }, { data: dlv }, { data: asg }, { data: nd }, { data: eg }, { data: rs }] = await Promise.all([
      supabaseDR.from('transport_vehicles').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('transport_carriers').select('*').order('name'),
      supabaseDR.from('kanban_delivery_rounds').select('*').eq('is_active', true).order('line_name').order('round_no'),
      supabaseDR.from('kanban_deliveries').select('*').eq('work_date', workDate),
      supabaseDR.from('transport_round_assignments').select('*').eq('work_date', workDate),
      supabaseDR.from('transport_nodes').select('*'),
      supabaseDR.from('transport_edges').select('*'),
      supabaseDR.from('transport_round_stops').select('*').order('seq'),
    ]);
    setVehicles(veh || []); setCarriers(car || []); setRounds(rds || []);
    setDeliveries(dlv || []); setAssigns(asg || []);
    setNodes(nd || []); setEdges(eg || []); setRoundStops(rs || []);
    // รูปผังจาก Main (factory_map) — best-effort (ไม่มีรูปก็ใช้ route tab ได้แค่ไม่มีแผนที่)
    const { data: fm } = await supabase.from('factory_map').select('image_url').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    setImageUrl(fm?.image_url || null);
  }, [workDate]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => { load(); setNowMs(Date.now()); }, 60000); return () => clearInterval(t); }, [load]);
  // ฐานพนักงาน (Main) โหลดครั้งเดียว — ใช้เลือกคนขับจาก employees แทนพิมพ์เอง
  useEffect(() => {
    supabase.from('employees').select('id, name, employee_id_code, section').eq('is_active', true).order('name')
      .then(({ data }) => setEmployees(data || []));
  }, []);

  const vehMap = useMemo(() => { const m = {}; vehicles.forEach(v => { m[v.code] = v; }); return m; }, [vehicles]);
  const vehLabel = (code) => vehMap[code] ? `${vehMap[code].icon} ${vehMap[code].name}` : code;
  const carrierMap = useMemo(() => { const m = {}; carriers.forEach(c => { m[c.id] = c; }); return m; }, [carriers]);
  const assignMap = useMemo(() => { const m = {}; assigns.forEach(a => { m[a.round_id] = a; }); return m; }, [assigns]);
  const confirmedSet = useMemo(() => { const s = new Set(); deliveries.forEach(d => s.add(`${d.line_name}|${d.shift}|${d.round_no}`)); return s; }, [deliveries]);
  const dlvMap = useMemo(() => { const m = {}; deliveries.forEach(d => { m[`${d.line_name}|${d.shift}|${d.round_no}`] = d; }); return m; }, [deliveries]);

  const byLine = useMemo(() => {
    const m = {};
    rounds.forEach(r => { (m[r.line_name] = m[r.line_name] || []).push(r); });
    return Object.keys(m).sort().map(ln => ({ line: ln, rounds: m[ln] }));
  }, [rounds]);

  const carrierOptsFor = (shift) => carriers.filter(c => c.is_active && (!c.shift || c.shift === 'both' || c.shift === shift));

  const assignCarrier = async (round, carrierId) => {
    setBusy(round.id);
    try {
      const { error } = await supabaseDR.from('transport_round_assignments')
        .upsert({ work_date: workDate, round_id: round.id, carrier_id: carrierId || null, assigned_by: fullName, assigned_at: new Date().toISOString(), updated_by_name: fullName },
          { onConflict: 'work_date,round_id' });
      if (error) throw error;
      await load();
    } catch (err) { toast.error(err.message); }
    setBusy(null);
  };

  const nAssigned = byLine.reduce((s, g) => s + g.rounds.filter(r => assignMap[r.id]?.carrier_id).length, 0);
  const nRounds = rounds.length;

  // ─── route tab data ───
  const nById = useMemo(() => { const m = {}; nodes.forEach(n => { m[n.id] = n; }); return m; }, [nodes]);
  const stopNodes = useMemo(() => nodes.filter(n => (n.kind === 'stop' || n.kind === 'dock') && n.is_active !== false), [nodes]);
  const stopsByRound = useMemo(() => {
    const m = {};
    roundStops.forEach(s => { (m[s.round_id] = m[s.round_id] || []).push(s); });
    Object.values(m).forEach(arr => arr.sort((a, b) => a.seq - b.seq));
    return m;
  }, [roundStops]);
  const nRoutes = useMemo(() => Object.values(stopsByRound).filter(a => a.length >= 2).length, [stopsByRound]);

  // เขียนลำดับจุดจอดใหม่ทั้งรอบ (delete-then-insert — กัน unique(round_id,seq) ชน)
  const saveStops = async (roundId, orderedNodeIds) => {
    setBusy(roundId);
    try {
      await supabaseDR.from('transport_round_stops').delete().eq('round_id', roundId);
      if (orderedNodeIds.length) {
        const rows = orderedNodeIds.map((nid, i) => ({ round_id: roundId, seq: i, node_id: nid, updated_by_name: fullName }));
        const { error } = await supabaseDR.from('transport_round_stops').insert(rows);
        if (error) throw error;
      }
      await load();
    } catch (err) { toast.error(err.message); }
    setBusy(null);
  };

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 'min(96vw, 1500px)', margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          🚚 มอบหมายขนส่ง (Transport)
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          มอบหมายคนขับ/ผู้ขน (carrier) ให้รอบส่งภายในของวันนี้ · ยึดรอบส่งที่ตั้งไว้แล้ว (📦 Line Stock → รอบจัดส่ง) · เฟส 1
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {[['assign', `🗓️ มอบหมายวันนี้ (${nAssigned}/${nRounds})`], ['route', `🗺️ เส้นทางรอบส่ง (${nRoutes})`], ['carriers', `👷 คนขับ/ยานพาหนะ (${carriers.filter(c => c.is_active).length})`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-body)',
            background: tab === k ? 'var(--accent)' : 'var(--bg2)', color: tab === k ? '#08130a' : 'var(--text2)',
            border: `1px solid ${tab === k ? 'var(--accent)' : 'var(--border)'}`,
          }}>{l}</button>
        ))}
      </div>

      {tab === 'assign' && (
        byLine.length === 0 ? (
          <div style={{ ...card, padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            ยังไม่มีรอบจัดส่ง — ตั้งค่าที่ 📦 Line Stock → ⏰ รอบจัดส่ง
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {byLine.map(g => (
              <div key={g.line} style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--border2)', fontWeight: 800, fontSize: 14, color: '#f59e0b', background: 'var(--bg2)' }}>🏭 {g.line}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 10, padding: 12 }}>
                  {g.rounds.map(r => {
                    const st = getRoundStatus(r, confirmedSet, dlvMap, workDate, nowMs);
                    const asg = assignMap[r.id];
                    const carrier = asg?.carrier_id ? carrierMap[asg.carrier_id] : null;
                    const opts = carrierOptsFor(r.shift);
                    return (
                      <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 11, background: 'var(--bg2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{r.shift === 'night' ? '🌙' : '☀️'} รอบ {r.round_no}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>{st.label}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          ตัดยอด {(r.cutoff_time || '').slice(0, 5) || '—'} · ส่ง {(r.delivery_time || '').slice(0, 5) || '—'} · {r.points_count || 1} จุด
                        </div>
                        <div style={{ marginTop: 8 }}>
                          {canManage ? (
                            <select value={asg?.carrier_id || ''} disabled={busy === r.id}
                              onChange={e => assignCarrier(r, e.target.value)}
                              style={{ width: '100%', padding: '6px 8px', borderRadius: 7, fontSize: 12.5, background: 'var(--card)', border: `1px solid ${carrier ? 'var(--accent)' : 'var(--border)'}`, color: 'var(--text)' }}>
                              <option value="">— ยังไม่มอบหมาย —</option>
                              {opts.map(c => <option key={c.id} value={c.id}>{c.name}{c.emp_code ? ` (${c.emp_code})` : ''}</option>)}
                            </select>
                          ) : (
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: carrier ? 'var(--text)' : 'var(--muted)' }}>
                              {carrier ? `👷 ${carrier.name}` : '— ยังไม่มอบหมาย —'}
                            </div>
                          )}
                          {carrier && carrier.vehicles?.length > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{carrier.vehicles.map(vehLabel).join(' · ')}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'route' && (
        <RouteTab byLine={byLine} stopsByRound={stopsByRound} stopNodes={stopNodes} nById={nById}
          nodes={nodes} edges={edges} imageUrl={imageUrl} canManage={canManage} busy={busy} saveStops={saveStops} />
      )}

      {tab === 'carriers' && (
        <div style={{ ...card }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>👷 คนขับ / ผู้ขน</span>
            {canManage && (
              <button onClick={() => setEditCarrier({ name: '', emp_code: '', shift: 'day', vehicles: [], section: '', is_active: true, note: '' })}
                style={{ padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: 'var(--accent)', color: '#08130a', border: 'none' }}>
                ➕ เพิ่มคนขับ
              </button>
            )}
          </div>
          {carriers.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีคนขับ — กด "➕ เพิ่มคนขับ"</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
              {carriers.map(c => (
                <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg2)', opacity: c.is_active ? 1 : 0.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>👷 {c.name}</span>
                    {canManage && <button onClick={() => setEditCarrier(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>✏️</button>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                    {c.emp_code ? `${c.emp_code} · ` : ''}{SHIFTS.find(s => s[0] === c.shift)?.[1] || 'ทุกกะ'}{c.section ? ` · ${c.section}` : ''}{!c.is_active ? ' · ⛔ ปิด' : ''}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 6 }}>
                    {c.vehicles?.length ? c.vehicles.map(vehLabel).join(' · ') : <span style={{ color: 'var(--muted)' }}>— ยังไม่ระบุยานพาหนะ —</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editCarrier && (
        <CarrierModal carrier={editCarrier} vehicles={vehicles} employees={employees} fullName={fullName}
          onClose={() => setEditCarrier(null)} onSaved={() => { setEditCarrier(null); load(); }} />
      )}
    </div>
  );
}

// ─── RouteTab — กำหนดจุดจอด (ordered) ต่อรอบส่ง + แสดงเส้นทางที่คำนวณจากกราฟถนน ──
function RouteTab({ byLine, stopsByRound, stopNodes, nById, nodes, edges, imageUrl, canManage, busy, saveStops }) {
  const [selRound, setSelRound] = useState(null);
  const rounds = useMemo(() => byLine.flatMap(g => g.rounds.map(r => ({ ...r, _line: g.line }))), [byLine]);
  const round = rounds.find(r => r.id === selRound) || null;
  const stops = round ? (stopsByRound[round.id] || []) : [];
  const stopIds = stops.map(s => s.node_id);
  const route = useMemo(() => routeThroughStops(nodes, edges, stopIds), [nodes, edges, stopIds]);
  const hasGraph = nodes.length > 0;

  const setOrder = (ids) => round && saveStops(round.id, ids);
  const addStop = (nid) => setOrder([...stopIds, nid]);
  const removeStop = (i) => setOrder(stopIds.filter((_, k) => k !== i));
  const moveStop = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= stopIds.length) return;
    const a = [...stopIds]; [a[i], a[j]] = [a[j], a[i]]; setOrder(a);
  };

  // polyline ของ route บนผัง (nodePath → จุด %)
  const routePts = route.nodePath.map(id => nById[id]).filter(Boolean);

  if (!hasGraph) return (
    <div style={{ ...card, padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
      ยังไม่มีถนน/จุดจอดบนผัง — วาดก่อนที่ <b style={{ color: 'var(--text2)' }}>ตั้งค่าผัง/Floorplan → 📦 Store / AMR</b>
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* left: เลือกรอบ + จัดลำดับจุดจอด */}
      <div style={{ ...card, flex: '0 0 320px', minWidth: 280 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>เลือกรอบส่ง</div>
        <select value={selRound || ''} onChange={e => setSelRound(e.target.value || null)}
          style={{ width: '100%', padding: '7px 9px', borderRadius: 8, fontSize: 13, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', marginBottom: 12 }}>
          <option value="">— เลือกรอบ —</option>
          {byLine.map(g => (
            <optgroup key={g.line} label={g.line}>
              {g.rounds.map(r => <option key={r.id} value={r.id}>{r.shift === 'night' ? '🌙' : '☀️'} รอบ {r.round_no} · ส่ง {(r.delivery_time || '').slice(0, 5) || '—'} ({(stopsByRound[r.id] || []).length} จุด)</option>)}
            </optgroup>
          ))}
        </select>

        {!round ? (
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>เลือกรอบส่งเพื่อกำหนดจุดจอดตามลำดับ</div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>ลำดับจุดจอด ({stopIds.length})</div>
            {stopIds.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>ยังไม่มีจุดจอด — เพิ่มจากด้านล่าง</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
              {stops.map((s, i) => {
                const n = nById[s.node_id]; const k = nodeKind(n?.kind);
                const seg = i > 0 ? route.segments[i - 1] : null;
                const broken = seg && !seg.ok;
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, background: 'var(--bg2)', border: `1px solid ${broken ? '#ef4444' : 'var(--border)'}`, borderRadius: 8, padding: '5px 8px' }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: k.color, color: '#08130a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flex: '0 0 auto' }}>{i + 1}</span>
                    <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {k.icon} {n?.name || n?.line_name || '(จุดไม่มีชื่อ)'}
                      {broken && <span style={{ color: '#ef4444', fontSize: 11 }}> · ⚠ ถนนขาด</span>}
                    </span>
                    {canManage && <>
                      <button onClick={() => moveStop(i, -1)} disabled={i === 0 || busy === round.id} style={miniBtn}>▲</button>
                      <button onClick={() => moveStop(i, 1)} disabled={i === stopIds.length - 1 || busy === round.id} style={miniBtn}>▼</button>
                      <button onClick={() => removeStop(i)} disabled={busy === round.id} style={{ ...miniBtn, color: '#ef4444' }}>✕</button>
                    </>}
                  </div>
                );
              })}
            </div>
            {canManage && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 5 }}>➕ เพิ่มจุดจอด</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {stopNodes.filter(n => !stopIds.includes(n.id)).map(n => (
                    <button key={n.id} onClick={() => addStop(n.id)} disabled={busy === round.id} style={{ padding: '4px 9px', borderRadius: 16, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)' }}>
                      {nodeKind(n.kind).icon} {n.name || n.line_name || 'จุด'}
                    </button>
                  ))}
                  {stopNodes.filter(n => !stopIds.includes(n.id)).length === 0 && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>เพิ่มครบทุกจุดจอดแล้ว</span>}
                </div>
              </>
            )}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border2)', fontSize: 12.5 }}>
              {stopIds.length < 2 ? (
                <span style={{ color: 'var(--muted)' }}>ต้องมี ≥ 2 จุดจอดเพื่อคำนวณเส้นทาง</span>
              ) : route.ok ? (
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✅ เส้นทางรวม ≈ {route.distance.toFixed(1)} หน่วยผัง · {route.nodePath.length - 1} ช่วง</span>
              ) : (
                <span style={{ color: '#ef4444', fontWeight: 700 }}>⚠ ถนนขาดช่วง — จุดจอดบางคู่ยังเชื่อมกันไม่ถึง (เพิ่มถนนที่หน้า Store/AMR)</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* right: แผนที่เส้นทาง */}
      <div style={{ flex: '1 1 480px', minWidth: 320 }}>
        {imageUrl ? (
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <img src={imageUrl} alt="แผนที่เส้นทาง" style={{ display: 'block', width: '100%', height: 'auto' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,14,0.35)' }} />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {/* ถนนทั้งหมด (จาง) */}
              {edges.map(e => { const a = nById[e.a_node], b = nById[e.b_node]; if (!a || !b) return null;
                return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#64748b" strokeOpacity="0.4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />; })}
              {/* เส้นทางที่เลือก (เด่น) */}
              {routePts.length > 1 && (
                <polyline points={routePts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#4ade80" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            {/* node markers ทั้งหมด (จาง) + จุดจอดของรอบ (เลขลำดับ) */}
            {nodes.map(n => { const k = nodeKind(n.kind); const idx = stopIds.indexOf(n.id);
              return (
                <div key={n.id} style={{ position: 'absolute', left: `${n.x}%`, top: `${n.y}%`, transform: 'translate(-50%,-50%)',
                  width: idx >= 0 ? 22 : 10, height: idx >= 0 ? 22 : 10, borderRadius: '50%', background: idx >= 0 ? k.color : '#64748b',
                  opacity: idx >= 0 ? 1 : 0.55, border: idx >= 0 ? '2px solid #fff' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, color: '#08130a', boxShadow: idx >= 0 ? '0 1px 5px rgba(0,0,0,0.5)' : 'none', zIndex: idx >= 0 ? 2 : 1 }}>
                  {idx >= 0 ? idx + 1 : ''}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ ...card, padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            ยังไม่มีรูปผัง — อัปโหลดที่ ตั้งค่าผัง/Floorplan → 🗺️ ภาพรวมโรงงาน (คำนวณระยะยังทำได้จากพิกัดจุด)
          </div>
        )}
      </div>
    </div>
  );
}
const miniBtn = { padding: '2px 6px', borderRadius: 6, cursor: 'pointer', fontSize: 11, background: 'var(--card)', color: 'var(--text2)', border: '1px solid var(--border)', flex: '0 0 auto' };

function CarrierModal({ carrier, vehicles, employees = [], fullName, onClose, onSaved }) {
  const [f, setF] = useState({ ...carrier });
  const [saving, setSaving] = useState(false);
  const [empQ, setEmpQ] = useState('');
  const isNew = !carrier.id;
  const toggleVeh = (code) => setF(p => ({ ...p, vehicles: p.vehicles.includes(code) ? p.vehicles.filter(v => v !== code) : [...p.vehicles, code] }));

  const empMatches = useMemo(() => {
    const q = empQ.trim().toLowerCase();
    if (!q) return [];
    return employees.filter(e => (e.name || '').toLowerCase().includes(q) || (e.employee_id_code || '').toLowerCase().includes(q)).slice(0, 15);
  }, [empQ, employees]);
  const pickEmp = (e) => { setF(p => ({ ...p, name: e.name, emp_code: e.employee_id_code || '', section: e.section || p.section })); setEmpQ(''); };

  const save = async () => {
    if (!f.name?.trim()) return toast.error('กรอกชื่อคนขับ');
    setSaving(true);
    try {
      const payload = { name: f.name.trim(), emp_code: f.emp_code?.trim() || null, shift: f.shift || null,
        vehicles: f.vehicles || [], section: f.section?.trim() || null, is_active: !!f.is_active,
        note: f.note?.trim() || null, updated_by_name: fullName, updated_at: new Date().toISOString() };
      const { error } = isNew
        ? await supabaseDR.from('transport_carriers').insert(payload)
        : await supabaseDR.from('transport_carriers').update(payload).eq('id', carrier.id);
      if (error) throw error;
      toast.success('บันทึกแล้ว');
      onSaved();
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', marginTop: 4 };
  const lbl = { fontSize: 12, fontWeight: 700, color: 'var(--muted)' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, width: 'min(94vw, 440px)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 17, fontWeight: 900, color: 'var(--text)' }}>{isNew ? '➕ เพิ่มคนขับ' : '✏️ แก้ไขคนขับ'}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ position: 'relative' }}>
            <span style={lbl}>🔎 เลือกจากฐานพนักงาน</span>
            <input value={empQ} onChange={e => setEmpQ(e.target.value)} placeholder="ค้นหาชื่อ / รหัสพนักงาน…" style={inp} />
            {empMatches.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, marginTop: 2, maxHeight: 220, overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.4)' }}>
                {empMatches.map(e => (
                  <button key={e.id} onClick={() => pickEmp(e)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', fontSize: 12.5, background: 'none', border: 'none', borderBottom: '1px solid var(--border2)', color: 'var(--text)', cursor: 'pointer' }}>
                    {e.name} {e.employee_id_code ? <span style={{ color: 'var(--muted)' }}>· {e.employee_id_code}</span> : ''}{e.section ? <span style={{ color: 'var(--muted)' }}> · {e.section}</span> : ''}
                  </button>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>เลือกแล้วเติมชื่อ+รหัสให้อัตโนมัติ · หรือพิมพ์เองด้านล่างเผื่อคนขับ outsource</div>
          </div>
          <div><span style={lbl}>ชื่อ *</span><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={inp} /></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><span style={lbl}>รหัสพนักงาน</span><input value={f.emp_code || ''} onChange={e => setF({ ...f, emp_code: e.target.value })} style={inp} /></div>
            <div style={{ flex: 1 }}><span style={lbl}>กะ</span>
              <select value={f.shift || ''} onChange={e => setF({ ...f, shift: e.target.value })} style={inp}>
                {SHIFTS.map(s => <option key={s[0]} value={s[0]}>{s[1]}</option>)}
              </select>
            </div>
          </div>
          <div><span style={lbl}>ส่วนงาน (optional)</span><input value={f.section || ''} onChange={e => setF({ ...f, section: e.target.value })} style={inp} /></div>
          <div>
            <span style={lbl}>🚚 ยานพาหนะที่ขับได้ (สกิล)</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {vehicles.map(v => {
                const on = f.vehicles.includes(v.code);
                return (
                  <button key={v.code} onClick={() => toggleVeh(v.code)} style={{
                    padding: '6px 11px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                    background: on ? 'var(--accent)' : 'var(--bg2)', color: on ? '#08130a' : 'var(--text2)',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  }}>{v.icon} {v.name}</button>
                );
              })}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} style={{ width: 'auto' }} /> ใช้งาน (active)
          </label>
          <div><span style={lbl}>หมายเหตุ</span><input value={f.note || ''} onChange={e => setF({ ...f, note: e.target.value })} style={inp} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)' }}>ยกเลิก</button>
          <button onClick={save} disabled={saving} style={{ padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: 'var(--accent)', color: '#08130a', border: 'none' }}>{saving ? 'กำลังบันทึก...' : '💾 บันทึก'}</button>
        </div>
      </div>
    </div>
  );
}
