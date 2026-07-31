import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { getRoundStatus } from '../utils/deliveryRounds';

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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [editCarrier, setEditCarrier] = useState(null);
  const [busy, setBusy] = useState(null);
  const workDate = getWorkDate();

  const load = useCallback(async () => {
    const [{ data: veh }, { data: car }, { data: rds }, { data: dlv }, { data: asg }] = await Promise.all([
      supabaseDR.from('transport_vehicles').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('transport_carriers').select('*').order('name'),
      supabaseDR.from('kanban_delivery_rounds').select('*').eq('is_active', true).order('line_name').order('round_no'),
      supabaseDR.from('kanban_deliveries').select('*').eq('work_date', workDate),
      supabaseDR.from('transport_round_assignments').select('*').eq('work_date', workDate),
    ]);
    setVehicles(veh || []); setCarriers(car || []); setRounds(rds || []);
    setDeliveries(dlv || []); setAssigns(asg || []);
  }, [workDate]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => { load(); setNowMs(Date.now()); }, 60000); return () => clearInterval(t); }, [load]);

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
        {[['assign', `🗓️ มอบหมายวันนี้ (${nAssigned}/${nRounds})`], ['carriers', `👷 คนขับ/ยานพาหนะ (${carriers.filter(c => c.is_active).length})`]].map(([k, l]) => (
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
        <CarrierModal carrier={editCarrier} vehicles={vehicles} fullName={fullName}
          onClose={() => setEditCarrier(null)} onSaved={() => { setEditCarrier(null); load(); }} />
      )}
    </div>
  );
}

function CarrierModal({ carrier, vehicles, fullName, onClose, onSaved }) {
  const [f, setF] = useState({ ...carrier });
  const [saving, setSaving] = useState(false);
  const isNew = !carrier.id;
  const toggleVeh = (code) => setF(p => ({ ...p, vehicles: p.vehicles.includes(code) ? p.vehicles.filter(v => v !== code) : [...p.vehicles, code] }));

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
