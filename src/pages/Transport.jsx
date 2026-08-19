import { useState, useEffect, useCallback, useMemo, useContext, useRef } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { getRoundStatus } from '../utils/deliveryRounds';
import { routeThroughStops, nodeKind, bestStopOrder } from '../utils/transportGraph';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import { visibleInterval } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';

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

  const [tab, setTab] = useTabParam(['assign', 'route', 'carriers'], 'assign');
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
  const [mpu, setMpu] = useState(null);            // meters per unit (มาตราส่วนผัง)
  const [dwellMin, setDwellMin] = useState(0);     // เวลาแวะต่อจุดจอด (นาที)
  const workDate = getWorkDate();

  // แก้ความเร็วยานพาหนะ (km/h)
  const saveVehSpeed = async (code, kmh) => {
    const { error } = await supabaseDR.from('transport_vehicles').update({ speed_kmh: kmh }).eq('code', code);
    if (error) return toast.error(error.message);
    setVehicles(vs => vs.map(v => v.code === code ? { ...v, speed_kmh: kmh } : v));
  };
  // แก้ความจุ (กล่อง/kanban ต่อเที่ยว) — ใช้คำนวณ load รอบส่ง (ต้อง apply migration 20260803 ก่อน)
  const saveVehCapacity = async (code, cap) => {
    const { error } = await supabaseDR.from('transport_vehicles').update({ capacity_pkg: cap }).eq('code', code);
    if (error) return toast.error(error.message.includes('capacity_pkg') ? 'ยังไม่ apply migration ความจุรถ (20260803_transport_vehicle_capacity)' : error.message);
    setVehicles(vs => vs.map(v => v.code === code ? { ...v, capacity_pkg: cap } : v));
  };
  const saveDwell = async (min) => {
    setDwellMin(min);
    await supabaseDR.from('transport_settings').upsert({ id: 1, dwell_min: min, updated_by_name: fullName, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  };

  const load = useCallback(async () => {
    const [{ data: veh }, { data: car }, { data: rds }, { data: dlv }, { data: asg }, { data: nd }, { data: eg }, { data: rs }, { data: settings }] = await Promise.all([
      supabaseDR.from('transport_vehicles').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('transport_carriers').select('*').order('name'),
      supabaseDR.from('kanban_delivery_rounds').select('*').eq('is_active', true).order('line_name').order('round_no'),
      supabaseDR.from('kanban_deliveries').select('*').eq('work_date', workDate),
      supabaseDR.from('transport_round_assignments').select('*').eq('work_date', workDate),
      supabaseDR.from('transport_nodes').select('*'),
      supabaseDR.from('transport_edges').select('*'),
      supabaseDR.from('transport_round_stops').select('*').order('seq'),
      supabaseDR.from('transport_settings').select('meters_per_unit, dwell_min').eq('id', 1).maybeSingle(),
    ]);
    setVehicles(veh || []); setCarriers(car || []); setRounds(rds || []);
    setDeliveries(dlv || []); setAssigns(asg || []);
    setNodes(nd || []); setEdges(eg || []); setRoundStops(rs || []);
    setMpu(settings?.meters_per_unit ?? null); setDwellMin(settings?.dwell_min ?? 0);
    // รูปผังจาก Main (factory_map) — best-effort (ไม่มีรูปก็ใช้ route tab ได้แค่ไม่มีแผนที่)
    const { data: fm } = await supabase.from('factory_map').select('image_url').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    setImageUrl(fm?.image_url || null);
  }, [workDate]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => visibleInterval(() => { load(); setNowMs(Date.now()); }, RATE.ANALYTIC), [load]);
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
  // actionByNode: คงค่า load/drop เดิมของแต่ละจุดไว้ตอนเรียงใหม่ (คอลัมน์ action — migration 20260803)
  const saveStops = async (roundId, orderedNodeIds, actionByNode = {}) => {
    setBusy(roundId);
    try {
      // ใส่คีย์ action เฉพาะเมื่อคอลัมน์มีจริง (แถวที่ select มามีคีย์นี้) — ยังไม่ apply migration ก็ยังบันทึกได้
      const hasActionCol = roundStops.some(s => 'action' in s);
      await supabaseDR.from('transport_round_stops').delete().eq('round_id', roundId);
      if (orderedNodeIds.length) {
        const rows = orderedNodeIds.map((nid, i) => ({
          round_id: roundId, seq: i, node_id: nid, updated_by_name: fullName,
          ...(hasActionCol ? { action: actionByNode[nid] ?? null } : {}),
        }));
        const { error } = await supabaseDR.from('transport_round_stops').insert(rows);
        if (error) throw error;
      }
      await load();
    } catch (err) { toast.error(err.message); }
    setBusy(null);
  };
  // สลับบทบาทจุดจอด load ⇄ drop (เก็บต่อแถว stop ของรอบนั้น)
  const saveStopAction = async (stopId, action) => {
    const { error } = await supabaseDR.from('transport_round_stops').update({ action, updated_by_name: fullName }).eq('id', stopId);
    if (error) return toast.error(error.message.includes('action') ? 'ยังไม่ apply migration บทบาทจุดจอด (20260803_transport_stop_action)' : error.message);
    await load();
  };

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 'min(96vw, 1500px)', margin: '0 auto' }}>
      <PageHeader
        title="มอบหมายขนส่ง (Transport)" icon="🚚"
        sub="มอบหมายคนขับ/ผู้ขน (carrier) ให้รอบส่งภายในของวันนี้ · ยึดรอบส่งที่ตั้งไว้แล้ว (📦 Line Stock → รอบจัดส่ง) · เฟส 1"
        tabs={[
          { key: 'assign', label: `🗓️ มอบหมายวันนี้ (${nAssigned}/${nRounds})` },
          { key: 'route', label: `🗺️ เส้นทางรอบส่ง (${nRoutes})` },
          { key: 'carriers', label: `👷 คนขับ/ยานพาหนะ (${carriers.filter(c => c.is_active).length})` },
        ]}
        tab={tab} onTab={setTab}
      />

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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(280px, 100%), 1fr))', gap: 10, padding: 12 }}>
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
          nodes={nodes} edges={edges} imageUrl={imageUrl} canManage={canManage} busy={busy} saveStops={saveStops}
          mpu={mpu} vehicles={vehicles} dwellMin={dwellMin} saveVehSpeed={saveVehSpeed} saveVehCapacity={saveVehCapacity} saveDwell={saveDwell} saveStopAction={saveStopAction} />
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(260px, 100%), 1fr))', gap: 10 }}>
              {carriers.map(c => (
                <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg2)', opacity: c.is_active ? 1 : 0.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>👷 {c.name}</span>
                    {canManage && <button className="tbtn" onClick={() => setEditCarrier(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>✏️</button>}
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
function RouteTab({ byLine, stopsByRound, stopNodes, nById, nodes, edges, imageUrl, canManage, busy, saveStops, mpu, vehicles = [], dwellMin = 0, saveVehSpeed, saveVehCapacity, saveDwell, saveStopAction }) {
  const [selRound, setSelRound] = useState(null);
  const [vehCode, setVehCode] = useState('');
  const [simFrac, setSimFrac] = useState(0);
  const [simRun, setSimRun] = useState(false);
  const rafRef = useRef(null);
  const rounds = useMemo(() => byLine.flatMap(g => g.rounds.map(r => ({ ...r, _line: g.line }))), [byLine]);
  const round = rounds.find(r => r.id === selRound) || null;
  const stops = useMemo(() => (round ? stopsByRound[round.id] || [] : []), [round, stopsByRound]);
  const stopIds = useMemo(() => stops.map(s => s.node_id), [stops]);
  const route = useMemo(() => routeThroughStops(nodes, edges, stopIds), [nodes, edges, stopIds]);
  const hasGraph = nodes.length > 0;

  // polyline + ระยะเรขาคณิตสะสม (ไว้จำลองตำแหน่ง)
  const routePts = useMemo(() => route.nodePath.map(id => nById[id]).filter(Boolean), [route, nById]);
  const geo = useMemo(() => {
    const seg = []; let total = 0;
    for (let i = 1; i < routePts.length; i++) { const d = Math.hypot(routePts[i].x - routePts[i - 1].x, routePts[i].y - routePts[i - 1].y); seg.push(d); total += d; }
    return { seg, total };
  }, [routePts]);

  // ระยะจริง + เวลา
  const veh = vehicles.find(v => v.code === vehCode) || vehicles[0] || null;
  const speedKmh = veh?.speed_kmh || 0;
  const realDist = mpu ? route.distance * mpu : null;                 // เมตร
  const moveMin = (realDist && speedKmh > 0) ? realDist / (speedKmh * 1000 / 60) : null;
  const dwellTotal = dwellMin > 0 ? dwellMin * stopIds.length : 0;
  const totalMin = moveMin != null ? moveMin + dwellTotal : null;

  // default เลือกยานพาหนะคันแรก
  useEffect(() => { if (!vehCode && vehicles.length) setVehCode(vehicles[0].code); }, [vehicles, vehCode]);
  // reset จำลองเมื่อเปลี่ยนรอบ/เส้นทาง — key ด้วย "เนื้อ" เส้นทาง (string) ไม่ใช่ object identity
  // (เดิมผูก [route] ซึ่งเป็น object ใหม่แทบทุก render → กดเล่นแล้วโดน reset ทันที รถไม่วิ่ง)
  const routeKey = route.nodePath.join('>');
  useEffect(() => { setSimRun(false); setSimFrac(0); }, [selRound, routeKey]);

  // ระยะสะสม (หน่วยผัง) ณ จุดจอดแต่ละจุดบน nodePath — ใช้สร้าง timeline "วิ่ง+แวะ"
  const stopMarks = useMemo(() => {
    if (!routePts.length) return null;
    const marks = []; let want = 0, acc = 0;
    routePts.forEach((p, i) => {
      if (i > 0) acc += geo.seg[i - 1];
      if (want < stopIds.length && p.id === stopIds[want]) { marks.push(acc); want++; }
    });
    return marks.length === stopIds.length ? marks : null;   // จับคู่ไม่ครบ (เส้นขาด) = ไม่มี timeline
  }, [routePts, geo, stopIds]);

  // timeline นาทีจำลอง: แวะจุด 1 → วิ่ง → แวะจุด 2 → … (รวมเวลาแวะต่อจุดจริง ไม่ใช่แค่เวลาวิ่ง)
  const simTimeline = useMemo(() => {
    if (moveMin == null || !stopMarks || geo.total <= 0) return null;
    const evs = []; let t = 0;
    stopMarks.forEach((dist, i) => {
      if (dwellMin > 0) { evs.push({ kind: 'dwell', start: t, end: t + dwellMin, dist, stopNo: i + 1 }); t += dwellMin; }
      if (i < stopMarks.length - 1) {
        const legMin = moveMin * (stopMarks[i + 1] - dist) / geo.total;
        evs.push({ kind: 'move', start: t, end: t + legMin, d0: dist, d1: stopMarks[i + 1] });
        t += legMin;
      }
    });
    return evs.length ? { evs, total: t } : null;
  }, [moveMin, stopMarks, geo, dwellMin]);
  const simTotalMin = simTimeline?.total ?? moveMin;   // = วิ่ง + แวะ×จำนวนจุด (ตรงกับ "⏱️ เวลา" ที่โชว์)

  // animation loop
  useEffect(() => {
    if (!simRun) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    const durMs = Math.max(1200, (simTotalMin || 1) * 250);          // 1 นาทีจำลอง ≈ 250ms (อย่างน้อย 1.2s)
    const start = performance.now() - simFrac * durMs;
    const tick = (now) => {
      const f = Math.min(1, (now - start) / durMs);
      setSimFrac(f);
      if (f >= 1) { setSimRun(false); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [simRun]);   // eslint-disable-line react-hooks/exhaustive-deps

  // สถานะจำลอง ณ เวลา f: อยู่ที่ระยะไหน + กำลังแวะจอดจุดไหนอยู่
  const simState = useMemo(() => {
    if (simTimeline) {
      const t = simFrac * simTimeline.total;
      const ev = simTimeline.evs.find(e => t >= e.start && t <= e.end) || simTimeline.evs[simTimeline.evs.length - 1];
      if (ev.kind === 'dwell') return { dist: ev.dist, dwellAt: ev.stopNo };
      const p = (t - ev.start) / ((ev.end - ev.start) || 1);
      return { dist: ev.d0 + (ev.d1 - ev.d0) * p, dwellAt: null };
    }
    return { dist: simFrac * geo.total, dwellAt: null };             // ไม่มี timeline (ยังไม่ตั้ง scale/ความเร็ว) = วิ่งตามระยะเฉยๆ
  }, [simTimeline, simFrac, geo]);

  const simDist = simState.dist;
  const simPos = useMemo(() => {
    if (routePts.length === 0) return null;
    if (routePts.length === 1 || geo.total === 0) return routePts[0];
    let target = simDist, acc = 0;
    for (let i = 0; i < geo.seg.length; i++) {
      if (acc + geo.seg[i] >= target) { const t = (target - acc) / (geo.seg[i] || 1); return { x: routePts[i].x + (routePts[i + 1].x - routePts[i].x) * t, y: routePts[i].y + (routePts[i + 1].y - routePts[i].y) * t }; }
      acc += geo.seg[i];
    }
    return routePts[routePts.length - 1];
  }, [simDist, routePts, geo]);
  const simMinNow = simTotalMin != null ? (simFrac * simTotalMin) : null;
  const fmtMin = (m) => m == null ? '—' : (m >= 60 ? `${Math.floor(m / 60)} ชม. ${Math.round(m % 60)} น.` : `${m.toFixed(1)} น.`);

  // บทบาทจุดจอด: ค่าที่ตั้งไว้ต่อรอบ (transport_round_stops.action) → ไม่ตั้ง = เดาจากชนิดจุด (ท่าโหลด/สโตร์ = รับของ)
  const actionOf = (s) => s?.action || (nById[s?.node_id]?.kind === 'dock' ? 'load' : 'drop');
  const actionByNode = useMemo(() => Object.fromEntries(stops.map(s => [s.node_id, s.action ?? null])), [stops]);
  const setOrder = (ids) => round && saveStops(round.id, ids, actionByNode);
  const addStop = (nid) => setOrder([...stopIds, nid]);
  const removeStop = (i) => setOrder(stopIds.filter((_, k) => k !== i));
  const moveStop = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= stopIds.length) return;
    const a = [...stopIds]; [a[i], a[j]] = [a[j], a[i]]; setOrder(a);
  };
  // ✨ หาลำดับแวะที่ระยะรวมสั้นสุด (TSP บนกราฟถนนจริง) — ล็อกจุดแรกเป็นต้นทาง (มักเป็น Store)
  const optimizeOrder = () => {
    const res = bestStopOrder(nodes, edges, stopIds);
    if (!res) return toast.error('เรียงให้ไม่ได้ — ถนนขาดช่วง หรือจุดจอดน้อยกว่า 3 จุด');
    const cur = route.ok ? route.distance : Infinity;
    if (res.order.join() === stopIds.join() || res.distance >= cur - 1e-9) return toast.info('ลำดับปัจจุบันสั้นที่สุดแล้ว ✅');
    setOrder(res.order);
    toast.success(`✨ เรียงใหม่ให้สั้นสุด: ${cur === Infinity ? '—' : cur.toFixed(1)} → ${res.distance.toFixed(1)} หน่วยผัง`);
  };

  if (!hasGraph) return (
    <div style={{ ...card, padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
      ยังไม่มีถนน/จุดจอดบนผัง — วาดก่อนที่ <b style={{ color: 'var(--text2)' }}>ตั้งค่าผัง/Floorplan → 📦 Store / AMR</b>
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* left: เลือกรอบ + จัดลำดับจุดจอด */}
      {/* '0 1 320px' + minWidth:0 — desktop กว้าง 320 เท่าเดิม แต่จอ 320px ยอมหดแทนที่จะดันล้น
          (เดิม '0 0 320px' + minWidth:280 = ไม่ยอมหดเลย ล้นออกนอกจอ 37px) */}
      <div style={{ ...card, flex: '0 1 320px', minWidth: 0, maxWidth: '100%' }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>ลำดับจุดจอด ({stopIds.length})</span>
              {canManage && stopIds.length >= 3 && (
                <button onClick={optimizeOrder} disabled={busy === round.id}
                  title="ให้ระบบหาลำดับแวะที่ระยะรวมสั้นสุด (จุดแรกคงเป็นต้นทางเดิม)"
                  style={{ padding: '3px 9px', borderRadius: 14, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, background: 'var(--accent-dim, rgba(74,222,128,.15))', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                  ✨ เรียงให้สั้นสุด
                </button>
              )}
            </div>
            {stopIds.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>ยังไม่มีจุดจอด — เพิ่มจากด้านล่าง</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
              {stops.map((s, i) => {
                const n = nById[s.node_id]; const k = nodeKind(n?.kind);
                const seg = i > 0 ? route.segments[i - 1] : null;
                const broken = seg && !seg.ok;
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, background: 'var(--bg2)', border: `1px solid ${broken ? '#ef4444' : 'var(--border)'}`, borderRadius: 8, padding: '5px 8px' }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: k.color, color: '#08130a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flex: '0 0 auto' }}>{i + 1}</span>
                    {(() => {
                      const act = actionOf(s);
                      const isLoad = act === 'load';
                      return (
                        <button onClick={() => canManage && saveStopAction?.(s.id, isLoad ? 'drop' : 'load')}
                          disabled={!canManage || busy === round.id}
                          title={canManage ? 'คลิกสลับ รับของ ⇄ ส่งของ' : undefined}
                          style={{ flex: '0 0 auto', padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 800, cursor: canManage ? 'pointer' : 'default',
                            background: isLoad ? 'rgba(56,189,248,0.15)' : 'rgba(74,222,128,0.15)',
                            color: isLoad ? '#38bdf8' : 'var(--accent)',
                            border: `1px solid ${isLoad ? 'rgba(56,189,248,0.5)' : 'var(--accent)'}` }}>
                          {isLoad ? '⬆ รับ' : '⬇ ส่ง'}
                        </button>
                      );
                    })()}
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
            {canManage && (() => {
              // จุดที่ "ผูกไลน์" ตรงกับไลน์ของรอบนี้ ขึ้นก่อน + ป้าย 🎯 — นี่คือหน้าที่ของช่อง
              // "ผูกไลน์/สโตร์" ตอนวาดจุด (จุดจอดรู้ว่าบริการไลน์ไหน → จัดรอบของไลน์นั้นเจอทันที)
              const norm = (s) => String(s || '').trim().toLowerCase();
              const isOfLine = (n) => round && norm(n.line_name) && norm(n.line_name) === norm(round._line);
              const addables = stopNodes.filter(n => !stopIds.includes(n.id))
                .sort((a, b) => (isOfLine(b) ? 1 : 0) - (isOfLine(a) ? 1 : 0));
              return (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 5 }}>
                    ➕ เพิ่มจุดจอด{addables.some(isOfLine) ? <span style={{ fontWeight: 400 }}> · 🎯 = จุดที่ผูกไลน์ {round._line}</span> : ''}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {addables.map(n => {
                      const mine = isOfLine(n);
                      return (
                        <button key={n.id} onClick={() => addStop(n.id)} disabled={busy === round.id}
                          style={{ padding: '4px 9px', borderRadius: 16, cursor: 'pointer', fontSize: 11.5, fontWeight: 700,
                            background: mine ? 'var(--accent-dim, rgba(74,222,128,.15))' : 'var(--bg2)',
                            color: mine ? 'var(--accent)' : 'var(--text2)',
                            border: `1px solid ${mine ? 'var(--accent)' : 'var(--border)'}` }}>
                          {mine ? '🎯 ' : ''}{nodeKind(n.kind).icon} {n.name || n.line_name || 'จุด'}
                        </button>
                      );
                    })}
                    {addables.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>เพิ่มครบทุกจุดจอดแล้ว</span>}
                  </div>
                </>
              );
            })()}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border2)', fontSize: 12.5 }}>
              {stopIds.length < 2 ? (
                <span style={{ color: 'var(--muted)' }}>ต้องมี ≥ 2 จุดจอดเพื่อคำนวณเส้นทาง</span>
              ) : route.ok ? (
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✅ เส้นทางรวม ≈ {route.distance.toFixed(1)} หน่วยผัง · {route.nodePath.length - 1} ช่วง</span>
              ) : (
                <span style={{ color: '#ef4444', fontWeight: 700 }}>⚠ ถนนขาดช่วง — จุดจอดบางคู่ยังเชื่อมกันไม่ถึง (เพิ่มถนนที่หน้า Store/AMR)</span>
              )}
            </div>

            {stopIds.length >= 2 && route.ok && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>
                  📏 ระยะจริง: {realDist != null
                    ? <b style={{ color: 'var(--text)' }}>{realDist >= 1000 ? (realDist / 1000).toFixed(2) + ' กม.' : realDist.toFixed(0) + ' ม.'}</b>
                    : <span style={{ color: 'var(--muted)' }}>ยังไม่ตั้งมาตราส่วน (ตั้งที่ Store/AMR)</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13 }}>🚗</span>
                  <select value={vehCode} onChange={e => setVehCode(e.target.value)} style={{ flex: '1 1 110px', padding: '5px 7px', borderRadius: 7, fontSize: 12, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                    {vehicles.map(v => <option key={v.code} value={v.code}>{v.icon} {v.name}</option>)}
                  </select>
                  {canManage ? (
                    <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="number" min="0" step="0.5" defaultValue={speedKmh || ''} key={(veh?.code || '') + String(speedKmh)}
                        onBlur={e => { const v = parseFloat(e.target.value); if (v > 0 && veh) saveVehSpeed(veh.code, v); }}
                        style={{ width: 54, padding: '4px 6px', borderRadius: 6, fontSize: 12, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }} /> กม./ชม.
                    </label>
                  ) : <span style={{ fontSize: 12, color: 'var(--muted)' }}>{speedKmh || '—'} กม./ชม.</span>}
                  {canManage ? (
                    <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      จุ
                      <input type="number" min="0" step="1" defaultValue={veh?.capacity_pkg || ''} key={'cap' + (veh?.code || '') + String(veh?.capacity_pkg ?? '')}
                        onBlur={e => { const v = parseFloat(e.target.value); if (v > 0 && veh) saveVehCapacity(veh.code, v); }}
                        style={{ width: 50, padding: '4px 6px', borderRadius: 6, fontSize: 12, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }} /> กล่อง/เที่ยว
                    </label>
                  ) : <span style={{ fontSize: 12, color: 'var(--muted)' }}>จุ {veh?.capacity_pkg || '—'} กล่อง/เที่ยว</span>}
                </div>
                {totalMin != null ? (
                  <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
                    ⏱️ เวลา: <b>{fmtMin(totalMin)}</b>
                    <span style={{ color: 'var(--muted)' }}> (วิ่ง {fmtMin(moveMin)}{dwellTotal > 0 ? ` + แวะ ${fmtMin(dwellTotal)}` : ''})</span>
                  </div>
                ) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>⏱️ ตั้งมาตราส่วน + ความเร็ว เพื่อดูเวลา</div>}
                {canManage && (
                  <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    เวลาแวะต่อจุด:
                    <input type="number" min="0" step="0.5" defaultValue={dwellMin || ''} key={'dwell' + dwellMin}
                      onBlur={e => { const v = parseFloat(e.target.value) || 0; if (v !== dwellMin) saveDwell(v); }}
                      style={{ width: 50, padding: '4px 6px', borderRadius: 6, fontSize: 12, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }} /> น.
                  </label>
                )}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                  <button onClick={() => { if (simFrac >= 1) setSimFrac(0); setSimRun(r => !r); }} style={{ padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, background: 'var(--accent)', color: '#08130a', border: 'none' }}>
                    {simRun ? '⏸ หยุด' : '▶ จำลองการวิ่ง'}
                  </button>
                  <button onClick={() => { setSimRun(false); setSimFrac(0); }} style={{ padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)' }}>↺</button>
                  {simMinNow != null && (
                    <span style={{ fontSize: 12, color: simState.dwellAt ? '#f59e0b' : 'var(--accent)', fontWeight: 700 }}>
                      ⏱ {fmtMin(simMinNow)}{simState.dwellAt ? ` · ⏸ แวะจุด ${simState.dwellAt}` : ''}
                    </span>
                  )}
                </div>
                <div style={{ height: 5, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${simFrac * 100}%`, background: 'var(--accent)', transition: 'width 0.1s linear' }} />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* right: แผนที่เส้นทาง */}
      {/* minWidth:0 — จอ 320px มีพื้นที่จริง 283px ถ้าคง minWidth:320 จะดันล้นออกนอกจอ */}
      <div style={{ flex: '1 1 480px', minWidth: 0 }}>
        {imageUrl ? (
          <>
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <img src={imageUrl} alt="แผนที่เส้นทาง" style={{ display: 'block', width: '100%', height: 'auto' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,14,0.35)' }} />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {/* ถนนทั้งโรงงาน — เห็นครบทุกเส้น เส้นที่ไม่ได้ใช้ = เทาบาง (คำสั่ง user 2026-08-03) */}
              {edges.map(e => { const a = nById[e.a_node], b = nById[e.b_node]; if (!a || !b) return null;
                return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#94a3b8" strokeOpacity="0.55" strokeWidth="2" vectorEffect="non-scaling-stroke" />; })}
              {/* เส้นทางที่เลือก (เด่น) */}
              {routePts.length > 1 && (
                <polyline points={routePts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#4ade80" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            {/* node markers ทั้งหมด (จาง) + จุดจอดของรอบ (เลขลำดับ + บทบาท ⬆รับ/⬇ส่ง) */}
            {nodes.map(n => { const k = nodeKind(n.kind); const idx = stopIds.indexOf(n.id);
              const act = idx >= 0 ? actionOf(stops[idx]) : null;
              return (
                <div key={n.id} title={idx >= 0 ? `${idx + 1}. ${n.name || n.line_name || ''} · ${act === 'load' ? '⬆ รับของ' : '⬇ ส่งของ'}` : undefined}
                  style={{ position: 'absolute', left: `${n.x}%`, top: `${n.y}%`, transform: 'translate(-50%,-50%)',
                  width: idx >= 0 ? 22 : 10, height: idx >= 0 ? 22 : 10, borderRadius: '50%', background: idx >= 0 ? k.color : '#64748b',
                  opacity: idx >= 0 ? 1 : 0.55, border: idx >= 0 ? '2px solid #fff' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, color: '#08130a', boxShadow: idx >= 0 ? '0 1px 5px rgba(0,0,0,0.5)' : 'none', zIndex: idx >= 0 ? 2 : 1 }}>
                  {idx >= 0 ? idx + 1 : ''}
                  {idx >= 0 && (
                    <span style={{ position: 'absolute', top: -7, right: -8, width: 14, height: 14, borderRadius: '50%',
                      background: act === 'load' ? '#38bdf8' : '#4ade80', border: '1.5px solid #fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: '#08130a' }}>
                      {act === 'load' ? '⬆' : '⬇'}
                    </span>
                  )}
                </div>
              );
            })}
            {/* จุดจำลองการวิ่ง — ไอคอนตามยานพาหนะที่เลือก · แวะจอด = วงส้ม */}
            {simPos && simFrac > 0 && (
              <div title={simState.dwellAt ? `⏸ แวะจอดจุด ${simState.dwellAt} (${dwellMin} น.)` : undefined}
                style={{ position: 'absolute', left: `${simPos.x}%`, top: `${simPos.y}%`, transform: 'translate(-50%,-50%)', width: 28, height: 28, borderRadius: '50%',
                  background: simState.dwellAt ? '#f59e0b' : '#22d3ee', border: '2px solid #fff',
                  boxShadow: simState.dwellAt ? '0 0 12px 3px rgba(245,158,11,0.75)' : '0 0 12px 3px rgba(34,211,238,0.7)',
                  zIndex: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{veh?.icon || '🚚'}</div>
            )}
          </div>
          {/* legend ใต้แผนที่ */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginTop: 7, fontSize: 11.5, color: 'var(--muted)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 22, height: 3.5, borderRadius: 2, background: '#4ade80', display: 'inline-block' }} /> เส้นทางรอบนี้
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 22, height: 2, borderRadius: 2, background: '#94a3b8', opacity: 0.7, display: 'inline-block' }} /> ถนนทั้งโรงงาน (ไม่ได้ใช้รอบนี้)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 13, height: 13, borderRadius: '50%', background: '#38bdf8', color: '#08130a', fontSize: 11, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>⬆</span> รับของ (load)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 13, height: 13, borderRadius: '50%', background: '#4ade80', color: '#08130a', fontSize: 11, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>⬇</span> ส่งของ (drop)
            </span>
          </div>
          </>
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
    // ฟอร์มกรอกข้อมูล — ไม่ปิดจาก backdrop (UI-CONVENTIONS §5) · z ≥2000 กันกระดิ่งทับ (§7)
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
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
