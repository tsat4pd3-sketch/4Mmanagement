import { useState, useEffect, useContext, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';

/* ─── Helpers ────────────────────────────────────────────────── */
const today = () => new Date().toISOString().split('T')[0];
const nowTime = () => new Date().toTimeString().slice(0, 5);
const fmtMin = (min) => {
  if (!min && min !== 0) return '—';
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`;
};

const CAT_META = {
  unplanned: { label: 'นอกแผน', color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  planned:   { label: 'ในแผน',  color: '#22c55e', bg: 'rgba(34,197,94,0.10)' },
};

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════ */
export default function DailyReport() {
  const { role } = useContext(UserContext);
  const [tab, setTab] = useState('live');

  const canSetup = ['admin', 'manager', 'supervisor'].includes(role);

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px)', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            📊 Daily Production Report
          </h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            บันทึกผลผลิตและ Downtime แบบ Real-time รายกะ
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', borderRadius: 10, padding: 4 }}>
          {[
            { key: 'live',    label: '⚡ Live กะนี้' },
            { key: 'history', label: '📋 ประวัติ' },
            ...(canSetup ? [{ key: 'setup', label: '⚙️ ตั้งค่า' }] : []),
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: tab === t.key ? 'var(--accent)' : 'transparent',
                color: tab === t.key ? '#fff' : 'var(--muted)' }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'live'    && <LiveTab role={role} />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'setup'   && canSetup && <SetupTab role={role} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LIVE TAB
═══════════════════════════════════════════════════════════════ */
function LiveTab({ role }) {
  const { fullName } = useContext(UserContext);
  const [lines, setLines]           = useState([]);
  const [products, setProducts]     = useState([]);
  const [dtTypes, setDtTypes]       = useState([]);
  const [sessions, setSessions]     = useState([]);
  const [dtLogs, setDtLogs]         = useState([]);
  const [selSession, setSelSession] = useState(null);
  const [loading, setLoading]       = useState(true);

  const [showOpen, setShowOpen] = useState(false);
  const [openForm, setOpenForm] = useState({ work_date: today(), line_name: '', shift: 'day', product_id: '', target_qty: '', start_time: nowTime() });

  const [showDT, setShowDT]   = useState(false);
  const [dtForm, setDtForm]   = useState({ downtime_type_id: '', started_at: '', ended_at: '', duration_min: '', machine_no: '', description: '' });
  const [savingDT, setSavingDT] = useState(false);

  const [qtyEdit, setQtyEdit]     = useState({ actual_qty: '', qty_ng_rh: '', qty_ng_lh: '' });
  const [savingQty, setSavingQty] = useState(false);

  // Prod Orders (replaces kanban targets/scans)
  const [prodOrders, setProdOrders]   = useState([]);
  const [kanbanStds, setKanbanStds]   = useState([]);

  // Scan Open modal
  const [showScanOpen, setShowScanOpen]   = useState(false);
  const [openProdForm, setOpenProdForm]   = useState({ prod_no: '', mat_no: '', qty: '' });
  const [openProdStd, setOpenProdStd]     = useState(null);
  const [savingProdOpen, setSavingProdOpen] = useState(false);

  // Scan Close modal
  const [showScanClose, setShowScanClose] = useState(false);
  const [closeProdNo, setCloseProdNo]     = useState('');
  const [closeMatch, setCloseMatch]       = useState(null); // found open order
  const [savingProdClose, setSavingProdClose] = useState(false);

  const canManage = ['admin', 'manager', 'supervisor'].includes(role);
  const canScan   = ['admin', 'manager', 'supervisor', 'leader'].includes(role);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ln }, { data: pr }, { data: dt }, { data: ss }, { data: ks }] = await Promise.all([
      supabase.from('production_lines').select('id, name').order('name'),
      supabaseDR.from('dr_products').select('*').eq('is_active', true).order('name'),
      supabaseDR.from('dr_downtime_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('production_sessions')
        .select('*, dr_products(name, cycle_time_sec, target_per_shift, process_type)')
        .eq('status', 'open')
        .order('created_at', { ascending: false }),
      supabaseDR.from('kanban_standards').select('*').eq('is_active', true).order('mat_no'),
    ]);
    setLines(ln || []);
    setProducts(pr || []);
    setDtTypes(dt || []);
    setSessions(ss || []);
    setKanbanStds(ks || []);
    if (ss?.length) {
      const first = ss[0];
      setSelSession(first);
      setQtyEdit({ actual_qty: first.actual_qty ?? '', qty_ng_rh: first.qty_ng_rh ?? '', qty_ng_lh: first.qty_ng_lh ?? '' });
    }
    setLoading(false);
  }, []);

  const loadDT = useCallback(async (sessionId) => {
    if (!sessionId) return;
    const { data } = await supabaseDR.from('downtime_logs')
      .select('*, dr_downtime_types(name_th, color, category)')
      .eq('session_id', sessionId)
      .order('started_at', { ascending: false });
    setDtLogs(data || []);
  }, []);

  const loadProdOrders = useCallback(async (sessionId) => {
    if (!sessionId) return;
    const { data } = await supabaseDR.from('prod_orders')
      .select('*')
      .eq('session_id', sessionId)
      .order('opened_at');
    setProdOrders(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (selSession) {
      loadDT(selSession.id);
      loadProdOrders(selSession.id);
    }
  }, [selSession, loadDT, loadProdOrders]);

  // Realtime
  useEffect(() => {
    const ch = supabaseDR.channel('live-dr')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_logs' },       () => { if (selSession) loadDT(selSession.id); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_sessions' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prod_orders' },         () => { if (selSession) loadProdOrders(selSession.id); })
      .subscribe();
    return () => supabaseDR.removeChannel(ch);
  }, [selSession, load, loadDT, loadProdOrders]);

  const handleOpenSession = async () => {
    if (!openForm.line_name) { toast.error('เลือกไลน์ก่อน'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabaseDR.from('production_sessions').insert({
      work_date:      openForm.work_date,
      line_name:      openForm.line_name,
      shift:          openForm.shift,
      product_id:     openForm.product_id || null,
      target_qty:     parseInt(openForm.target_qty) || 0,
      start_time:     openForm.start_time,
      opened_by_name: fullName,
      opened_by_uid:  user?.id,
      status:         'open',
    }).select('*, dr_products(name, cycle_time_sec, target_per_shift)').single();
    if (error) { toast.error('เปิดกะไม่สำเร็จ: ' + error.message); return; }
    toast.success('เปิดกะสำเร็จ');
    setShowOpen(false);
    setSessions(s => [data, ...s]);
    setSelSession(data);
    setQtyEdit({ actual_qty: 0, qty_ng_rh: 0, qty_ng_lh: 0 });
    setDtLogs([]);
  };

  const handleSaveQty = async () => {
    if (!selSession) return;
    setSavingQty(true);
    const { error } = await supabaseDR.from('production_sessions').update({
      actual_qty: parseInt(qtyEdit.actual_qty) || 0,
      qty_ng_rh:  parseInt(qtyEdit.qty_ng_rh)  || 0,
      qty_ng_lh:  parseInt(qtyEdit.qty_ng_lh)  || 0,
    }).eq('id', selSession.id);
    setSavingQty(false);
    if (error) { toast.error(error.message); return; }
    toast.success('อัปเดตยอดผลิตแล้ว');
    setSelSession(s => ({ ...s, ...qtyEdit }));
  };

  const handleAddDT = async () => {
    if (!selSession || !dtForm.downtime_type_id) { toast.error('เลือกประเภท Downtime'); return; }
    setSavingDT(true);
    const { data: { user } } = await supabase.auth.getUser();
    const startedAt = dtForm.started_at ? new Date(dtForm.started_at).toISOString() : new Date().toISOString();
    const endedAt   = dtForm.ended_at   ? new Date(dtForm.ended_at).toISOString()   : null;
    const durMin    = dtForm.duration_min
      ? parseFloat(dtForm.duration_min)
      : (endedAt ? (new Date(endedAt) - new Date(startedAt)) / 60000 : null);

    const { error } = await supabaseDR.from('downtime_logs').insert({
      session_id:       selSession.id,
      downtime_type_id: dtForm.downtime_type_id,
      started_at:       startedAt,
      ended_at:         endedAt,
      duration_min:     durMin,
      machine_no:       dtForm.machine_no || null,
      description:      dtForm.description || null,
      reported_by_name: fullName,
      reported_by_uid:  user?.id,
    });
    setSavingDT(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึก Downtime แล้ว');
    setShowDT(false);
    setDtForm({ downtime_type_id: '', started_at: '', ended_at: '', duration_min: '', machine_no: '', description: '' });
    loadDT(selSession.id);
  };

  // ── Scan OPEN handler ──────────────────────────────────────────
  const handleOpenProdMatNoChange = (val) => {
    const upper = val.toUpperCase();
    const std = kanbanStds.find(s => s.mat_no === upper) || null;
    setOpenProdStd(std);
    setOpenProdForm(f => ({
      ...f,
      mat_no: upper,
      qty:    std ? String(std.qty_per_kanban) : f.qty,
    }));
  };

  const handleScanOpen = async () => {
    const prodNo = openProdForm.prod_no.trim();
    const matNo  = openProdForm.mat_no.trim();
    if (!prodNo) { toast.error('สแกนหรือกรอก PROD.NO ก่อน'); return; }
    if (!matNo)  { toast.error('สแกนหรือกรอก MAT.NO ก่อน');  return; }
    if (!openProdForm.qty || parseInt(openProdForm.qty) < 1) { toast.error('ระบุจำนวนชิ้น'); return; }

    // ตรวจว่า PROD.NO นี้เปิดซ้ำในกะไม่
    const dup = prodOrders.find(o => o.prod_no === prodNo);
    if (dup) {
      toast.error(`PROD.NO ${prodNo} เปิดไปแล้วในกะนี้ (${dup.status === 'confirmed' ? 'ปิดแล้ว' : 'กำลังผลิต'})`);
      return;
    }

    setSavingProdOpen(true);
    const std = kanbanStds.find(s => s.mat_no === matNo);
    const { error } = await supabaseDR.from('prod_orders').insert({
      session_id:  selSession.id,
      prod_no:     prodNo,
      mat_no:      matNo,
      part_name:   std?.part_name || openProdStd?.part_name || null,
      p_no:        std?.p_no      || openProdStd?.p_no      || null,
      customer:    std?.customer  || openProdStd?.customer  || null,
      qty:         parseInt(openProdForm.qty),
      status:      'open',
      opened_by:   fullName,
    });
    setSavingProdOpen(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`เปิด Order ${prodNo} · ${matNo} · ${openProdForm.qty} ชิ้น ✓`);
    // keep modal open for fast multi-scan
    setOpenProdForm(f => ({ prod_no: '', mat_no: f.mat_no, qty: f.qty }));
    loadProdOrders(selSession.id);
  };

  // ── Scan CLOSE handler ─────────────────────────────────────────
  const handleCloseProdNoChange = (val) => {
    const v = val.trim();
    setCloseProdNo(v);
    const found = prodOrders.find(o => o.prod_no === v && o.status === 'open');
    setCloseMatch(found || null);
  };

  const handleScanClose = async () => {
    if (!closeMatch) { toast.error('ไม่พบ PROD.NO นี้ หรือปิดไปแล้ว'); return; }
    setSavingProdClose(true);
    const { error } = await supabaseDR.from('prod_orders').update({
      status:       'confirmed',
      confirmed_by: fullName,
      confirmed_at: new Date().toISOString(),
    }).eq('id', closeMatch.id);
    setSavingProdClose(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`ปิด Order ${closeMatch.prod_no} · ${closeMatch.qty} ชิ้น ✓`);
    // keep modal open for fast multi-scan — clear input
    setCloseProdNo('');
    setCloseMatch(null);
    loadProdOrders(selSession.id);
  };

  const handleDeleteProdOrder = async (id) => {
    if (!window.confirm('ลบ Prod Order นี้?')) return;
    const { error } = await supabaseDR.from('prod_orders').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    loadProdOrders(selSession.id);
  };

  const handleCloseSession = async () => {
    if (!selSession) return;
    if (!window.confirm('ปิดกะนี้? จะไม่สามารถเพิ่ม Downtime ได้อีก')) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabaseDR.from('production_sessions').update({
      status:         'closed',
      closed_by_name: fullName,
      closed_by_uid:  user?.id,
      closed_at:      new Date().toISOString(),
      end_time:       nowTime(),
    }).eq('id', selSession.id);
    if (error) { toast.error(error.message); return; }
    toast.success('ปิดกะสำเร็จ');
    load();
    setSelSession(null);
    setDtLogs([]);
  };

  const handleDeleteDT = async (id) => {
    if (!window.confirm('ลบ Downtime นี้?')) return;
    const { error } = await supabaseDR.from('downtime_logs').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    loadDT(selSession.id);
  };

  const totalDT      = dtLogs.reduce((s, d) => s + (d.duration_min || 0), 0);
  const unplannedDT  = dtLogs.filter(d => d.dr_downtime_types?.category === 'unplanned').reduce((s, d) => s + (d.duration_min || 0), 0);

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: sessions.length > 1 ? '220px 1fr' : '1fr', gap: 16 }}>
      {sessions.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>กะที่เปิดอยู่</div>
          {sessions.map(s => (
            <button key={s.id} onClick={() => { setSelSession(s); setQtyEdit({ actual_qty: s.actual_qty, qty_ng_rh: s.qty_ng_rh, qty_ng_lh: s.qty_ng_lh }); }}
              style={{ padding: '10px 12px', borderRadius: 8, border: `2px solid ${selSession?.id === s.id ? 'var(--accent)' : 'var(--border)'}`,
                background: selSession?.id === s.id ? 'var(--accent-dim)' : 'var(--card)', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{s.line_name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {s.work_date}</div>
            </button>
          ))}
        </div>
      )}

      <div>
        {sessions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏭</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>ยังไม่มีกะที่เปิดอยู่</div>
            <div style={{ fontSize: 13, marginBottom: 24 }}>เปิดกะเพื่อเริ่มบันทึกผลผลิตและ Downtime</div>
            {canManage && (
              <button onClick={() => setShowOpen(true)} style={saveBtnStyle}>+ เปิดกะใหม่</button>
            )}
          </div>
        )}

        {selSession && (
          <>
            {/* Session header */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>● LIVE</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {selSession.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {selSession.work_date} · เริ่ม {selSession.start_time}
                    </span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{selSession.line_name}</div>
                  {selSession.dr_products?.name && (
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                      🔩 {selSession.dr_products.name}
                      {selSession.dr_products.cycle_time_sec && ` · CT ${selSession.dr_products.cycle_time_sec}s`}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {canManage && <button onClick={() => setShowOpen(true)} style={saveBtnStyle}>+ เปิดกะใหม่</button>}
                  {canManage && (
                    <button onClick={handleCloseSession} style={cancelBtnStyle}>🔒 ปิดกะ</button>
                  )}
                </div>
              </div>
            </div>

            {/* KPI summary from prod_orders */}
            {(() => {
              const totalTarget    = prodOrders.reduce((s, o) => s + o.qty, 0);
              const totalConfirmed = prodOrders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0);
              const pct = totalTarget > 0 ? Math.min(100, Math.round((totalConfirmed / totalTarget) * 100)) : 0;
              const barClr = pct >= 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#4d9fff';
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12, marginBottom: 16 }}>
                  {[
                    { label: 'เปิด Order', value: prodOrders.filter(o => o.status === 'open').length, unit: 'ใบ', color: '#f59e0b' },
                    { label: 'ปิดแล้ว',   value: prodOrders.filter(o => o.status === 'confirmed').length, unit: 'ใบ', color: '#22c55e' },
                    { label: 'เป้ารวม',   value: totalTarget,    unit: 'ชิ้น', color: '#4d9fff' },
                    { label: 'ผลิตได้',   value: totalConfirmed, unit: 'ชิ้น', color: '#22c55e' },
                    { label: 'Downtime',  value: fmtMin(totalDT), unit: '',    color: '#a855f7', small: true },
                    { label: 'นอกแผน',   value: fmtMin(unplannedDT), unit: '', color: '#ef4444', small: true },
                  ].map(k => (
                    <div key={k.label} style={{ background: 'var(--card)', border: `1px solid ${k.color}25`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{k.label}</div>
                      <div style={{ fontSize: k.small ? 13 : 22, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value ?? 0}</div>
                      {k.unit && <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{k.unit}</div>}
                    </div>
                  ))}
                  {/* Overall progress bar */}
                  {prodOrders.length > 0 && (
                    <div style={{ gridColumn: '1/-1', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                        <span style={{ color: 'var(--muted)' }}>ความคืบหน้ากะนี้</span>
                        <span style={{ fontWeight: 800, color: barClr }}>{totalConfirmed} / {totalTarget} ชิ้น ({pct}%)</span>
                      </div>
                      <div style={{ height: 10, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: barClr, borderRadius: 99, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Prod Orders panel */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  📦 Prod Orders ({prodOrders.length} ใบ)
                </div>
                {canScan && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setShowScanOpen(true); setOpenProdForm({ prod_no: '', mat_no: '', qty: '' }); setOpenProdStd(null); }}
                      style={{ background: '#f59e0b', color: '#000', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      📥 Scan เปิด Order
                    </button>
                    <button onClick={() => { setShowScanClose(true); setCloseProdNo(''); setCloseMatch(null); }}
                      style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      📤 Scan ปิด / Confirm
                    </button>
                  </div>
                )}
              </div>

              {prodOrders.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--muted)', fontSize: 13 }}>
                  ยังไม่มี Prod Order — กด <b>📥 Scan เปิด Order</b> เพื่อเริ่มสแกน Tag Card
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {prodOrders.map(o => {
                  const confirmed = o.status === 'confirmed';
                  return (
                    <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'var(--bg2)', borderRadius: 8,
                      border: `1px solid ${confirmed ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
                      borderLeft: `4px solid ${confirmed ? '#22c55e' : '#f59e0b'}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{o.prod_no}</span>
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{o.mat_no}</span>
                          {o.part_name && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {o.part_name}</span>}
                          {o.customer && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontWeight: 700 }}>{o.customer}</span>}
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                            background: confirmed ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                            color: confirmed ? '#22c55e' : '#f59e0b' }}>
                            {confirmed ? '✓ ปิดแล้ว' : '● กำลังผลิต'}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                          เปิด {new Date(o.opened_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} {o.opened_by && `· ${o.opened_by}`}
                          {confirmed && o.confirmed_at && ` · ปิด ${new Date(o.confirmed_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · ${o.confirmed_by}`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: confirmed ? '#22c55e' : '#f59e0b', lineHeight: 1 }}>{o.qty}</div>
                        <div style={{ fontSize: 9, color: 'var(--muted)' }}>ชิ้น</div>
                      </div>
                      {canManage && (
                        <button onClick={() => handleDeleteProdOrder(o.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Downtime list */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>⏱ Downtime ({dtLogs.length} รายการ)</div>
                <button onClick={() => { setShowDT(true); setDtForm({ downtime_type_id: '', started_at: '', ended_at: '', duration_min: '', machine_no: '', description: '' }); }}
                  style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  + บันทึก Downtime
                </button>
              </div>
              {dtLogs.length === 0 && <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มี Downtime ในกะนี้</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dtLogs.map(d => {
                  const cat = CAT_META[d.dr_downtime_types?.category] || CAT_META.unplanned;
                  return (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8, borderLeft: `3px solid ${d.dr_downtime_types?.color || '#aaa'}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: cat.bg, color: cat.color }}>{cat.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{d.dr_downtime_types?.name_th || '—'}</span>
                          {d.machine_no && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {d.machine_no}</span>}
                        </div>
                        {d.description && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{d.description}</div>}
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {new Date(d.started_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                          {d.ended_at && ` – ${new Date(d.ended_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`}
                          {d.reported_by_name && ` · ${d.reported_by_name}`}
                        </div>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: d.dr_downtime_types?.color || '#aaa', minWidth: 64, textAlign: 'right' }}>
                        {fmtMin(d.duration_min)}
                      </div>
                      {canManage && (
                        <button onClick={() => handleDeleteDT(d.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Open session modal */}
        {showOpen && (
          <div className="overlay" onClick={() => setShowOpen(false)} style={{ zIndex: 2000 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,480px)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>🏭 เปิดกะผลิตใหม่</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="วันที่ผลิต">
                  <input type="date" value={openForm.work_date} onChange={e => setOpenForm(f => ({ ...f, work_date: e.target.value }))} style={inputStyle} />
                </Field>
                <Field label="ไลน์การผลิต">
                  <select value={openForm.line_name} onChange={e => setOpenForm(f => ({ ...f, line_name: e.target.value }))} style={inputStyle}>
                    <option value="">เลือกไลน์...</option>
                    {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                  </select>
                </Field>
                <Field label="กะทำงาน">
                  <select value={openForm.shift} onChange={e => setOpenForm(f => ({ ...f, shift: e.target.value }))} style={inputStyle}>
                    <option value="day">☀️ กะเช้า (08:00–20:00)</option>
                    <option value="night">🌙 กะดึก (20:00–08:00)</option>
                  </select>
                </Field>
                <Field label="สินค้า / Model">
                  <select value={openForm.product_id} onChange={e => setOpenForm(f => ({ ...f, product_id: e.target.value }))} style={inputStyle}>
                    <option value="">เลือกสินค้า...</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}
                  </select>
                </Field>
                <Field label="เป้าหมาย (ชิ้น)">
                  <input type="number" min="0" value={openForm.target_qty} onChange={e => setOpenForm(f => ({ ...f, target_qty: e.target.value }))} placeholder="0" style={inputStyle} />
                </Field>
                <Field label="เวลาเริ่มต้น">
                  <input type="time" value={openForm.start_time} onChange={e => setOpenForm(f => ({ ...f, start_time: e.target.value }))} style={inputStyle} />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowOpen(false)} style={cancelBtnStyle}>ยกเลิก</button>
                <button onClick={handleOpenSession} disabled={!openForm.line_name}
                  style={{ ...saveBtnStyle, opacity: !openForm.line_name ? 0.5 : 1 }}>เปิดกะ</button>
              </div>
            </div>
          </div>
        )}

        {/* ── SCAN OPEN modal ─────────────────────────────────── */}
        {showScanOpen && (
          <div className="overlay" onClick={() => setShowScanOpen(false)} style={{ zIndex: 2000 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(245,158,11,0.4)', borderRadius: 14, padding: 24, width: 'min(95vw,460px)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2, color: '#f59e0b' }}>📥 Scan เปิด Prod Order</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>สแกนทีละใบ — Modal จะไม่ปิดเพื่อสแกนต่อได้เลย</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="PROD.NO (สแกน barcode PROD.NO บน Tag Card) *">
                  <input autoFocus value={openProdForm.prod_no}
                    onChange={e => setOpenProdForm(f => ({ ...f, prod_no: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && openProdForm.prod_no) document.getElementById('open-mat-input')?.focus(); }}
                    placeholder="สแกน PROD.NO..."
                    style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700, fontSize: 15 }} />
                </Field>

                <Field label="MAT.NO (สแกน barcode MAT.NO บน Tag Card) *">
                  <div style={{ position: 'relative' }}>
                    <input id="open-mat-input" value={openProdForm.mat_no}
                      onChange={e => handleOpenProdMatNoChange(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && openProdForm.mat_no) document.getElementById('open-qty-input')?.focus(); }}
                      placeholder="สแกน MAT.NO..."
                      style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700, fontSize: 15, paddingRight: 120 }} />
                    {openProdStd && (
                      <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, background: 'rgba(34,197,94,0.15)', color: '#22c55e', borderRadius: 20, padding: '2px 8px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        ✓ {openProdStd.qty_per_kanban} ชิ้น/ใบ
                      </span>
                    )}
                    {openProdForm.mat_no && !openProdStd && (
                      <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', borderRadius: 20, padding: '2px 8px', fontWeight: 700 }}>
                        ⚠ ไม่มีใน Std
                      </span>
                    )}
                  </div>
                </Field>

                {openProdStd && (
                  <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--muted)' }}>
                    {openProdStd.part_name && <span style={{ color: 'var(--text)', fontWeight: 600 }}>{openProdStd.part_name} </span>}
                    {openProdStd.customer && <span>· {openProdStd.customer} </span>}
                    {openProdStd.p_no && <span>· P.NO: {openProdStd.p_no}</span>}
                  </div>
                )}

                <Field label={openProdStd ? `Qty (auto จาก Standard: ${openProdStd.qty_per_kanban} ชิ้น)` : 'Qty ต่อ Tag Card (ชิ้น) *'}>
                  <input id="open-qty-input" type="number" min="1" value={openProdForm.qty}
                    onChange={e => setOpenProdForm(f => ({ ...f, qty: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') handleScanOpen(); }}
                    style={{ ...inputStyle, fontSize: 22, fontWeight: 900, textAlign: 'center',
                      background: openProdStd ? 'rgba(34,197,94,0.08)' : 'var(--bg)',
                      color: openProdStd ? '#22c55e' : 'var(--text)' }} />
                </Field>

                {/* Duplicate warning */}
                {openProdForm.prod_no && prodOrders.find(o => o.prod_no === openProdForm.prod_no) && (
                  <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
                    ⚠ PROD.NO นี้เปิดไปแล้วในกะนี้
                  </div>
                )}
              </div>

              {/* Running count */}
              {prodOrders.filter(o => o.status === 'open').length > 0 && (
                <div style={{ marginTop: 12, padding: '6px 12px', background: 'rgba(245,158,11,0.1)', borderRadius: 8, fontSize: 12, color: '#f59e0b', fontWeight: 700 }}>
                  เปิดในกะนี้แล้ว {prodOrders.filter(o => o.status === 'open').length} ใบ · {prodOrders.filter(o => o.status === 'open').reduce((s, o) => s + o.qty, 0)} ชิ้น
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowScanOpen(false)} style={cancelBtnStyle}>ปิด</button>
                <button onClick={handleScanOpen}
                  disabled={savingProdOpen || !openProdForm.prod_no || !openProdForm.mat_no || !openProdForm.qty || !!prodOrders.find(o => o.prod_no === openProdForm.prod_no)}
                  style={{ ...saveBtnStyle, background: '#f59e0b', color: '#000', fontSize: 14,
                    opacity: (savingProdOpen || !openProdForm.prod_no || !openProdForm.mat_no || !openProdForm.qty) ? 0.5 : 1 }}>
                  {savingProdOpen ? '...' : '📥 เปิด Order'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── SCAN CLOSE modal ────────────────────────────────── */}
        {showScanClose && (
          <div className="overlay" onClick={() => setShowScanClose(false)} style={{ zIndex: 2000 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(34,197,94,0.4)', borderRadius: 14, padding: 24, width: 'min(95vw,420px)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2, color: '#22c55e' }}>📤 Scan ปิด / Confirm</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>สแกน PROD.NO ทีละใบ — Modal จะไม่ปิดเพื่อสแกนต่อได้เลย</div>

              <Field label="PROD.NO (สแกน barcode PROD.NO บน Tag Card)">
                <input autoFocus value={closeProdNo}
                  onChange={e => handleCloseProdNoChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && closeMatch) handleScanClose(); }}
                  placeholder="สแกน PROD.NO..."
                  style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700, fontSize: 15 }} />
              </Field>

              {/* Match preview */}
              {closeProdNo && (
                <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 8,
                  background: closeMatch ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${closeMatch ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                  {closeMatch ? (
                    <>
                      <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, marginBottom: 6 }}>✓ พบ Order — กด Enter หรือปุ่มด้านล่างเพื่อปิด</div>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{closeMatch.mat_no}</div>
                          {closeMatch.part_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{closeMatch.part_name}</div>}
                        </div>
                        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                          <div style={{ fontSize: 28, fontWeight: 900, color: '#22c55e', lineHeight: 1 }}>{closeMatch.qty}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>ชิ้น</div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
                      {prodOrders.find(o => o.prod_no === closeProdNo && o.status === 'confirmed')
                        ? '⚠ PROD.NO นี้ปิดไปแล้ว'
                        : '✕ ไม่พบ PROD.NO นี้ในกะปัจจุบัน'}
                    </div>
                  )}
                </div>
              )}

              {/* Running count */}
              {prodOrders.filter(o => o.status === 'confirmed').length > 0 && (
                <div style={{ marginTop: 12, padding: '6px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: 8, fontSize: 12, color: '#22c55e', fontWeight: 700 }}>
                  ปิดในกะนี้แล้ว {prodOrders.filter(o => o.status === 'confirmed').length} ใบ · {prodOrders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0)} ชิ้น
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowScanClose(false)} style={cancelBtnStyle}>ปิด</button>
                <button onClick={handleScanClose} disabled={savingProdClose || !closeMatch}
                  style={{ ...saveBtnStyle, background: '#22c55e', fontSize: 14, opacity: (!closeMatch || savingProdClose) ? 0.5 : 1 }}>
                  {savingProdClose ? '...' : '📤 Confirm ปิด Order'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add downtime modal */}
        {showDT && (
          <div className="overlay" onClick={() => setShowDT(false)} style={{ zIndex: 2000 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,500px)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>⏱ บันทึก Downtime</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="ประเภท Downtime *">
                  {(() => {
                    const pt = selSession?.dr_products?.process_type || 'welding_assembly';
                    const filtered = dtTypes.filter(t =>
                      t.process_type === pt || t.process_type === 'common'
                    );
                    const ptLabel = pt === 'metal_forming' ? 'Metal Forming' : 'Welding / Assembly';
                    return (
                      <>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6 }}>
                          แสดงประเภทสำหรับ: <b style={{ color: 'var(--accent)' }}>{ptLabel}</b>
                          {!selSession?.product_id && ' (ไม่ได้เลือกสินค้า — แสดงแบบ Welding/Assembly)'}
                        </div>
                        <select value={dtForm.downtime_type_id} onChange={e => setDtForm(f => ({ ...f, downtime_type_id: e.target.value }))} style={inputStyle}>
                          <option value="">เลือกประเภท...</option>
                          {['unplanned', 'planned'].map(cat => (
                            <optgroup key={cat} label={cat === 'unplanned' ? '⚠ นอกแผน (Unplanned)' : '📋 ในแผน (Planned)'}>
                              {filtered.filter(t => t.category === cat).map(t => (
                                <option key={t.id} value={t.id}>{t.name_th}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </>
                    );
                  })()}
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="เวลาเริ่มหยุด">
                    <input type="datetime-local" value={dtForm.started_at} onChange={e => setDtForm(f => ({ ...f, started_at: e.target.value }))} style={inputStyle} />
                  </Field>
                  <Field label="เวลาเริ่มเดิน">
                    <input type="datetime-local" value={dtForm.ended_at} onChange={e => setDtForm(f => ({ ...f, ended_at: e.target.value }))} style={inputStyle} />
                  </Field>
                </div>
                <Field label="ระยะเวลา (นาที) — กรอกถ้าไม่ได้ใส่เวลาเริ่ม/สิ้นสุด">
                  <input type="number" min="0" step="0.5" value={dtForm.duration_min} onChange={e => setDtForm(f => ({ ...f, duration_min: e.target.value }))} placeholder="เช่น 30" style={inputStyle} />
                </Field>
                <Field label="หมายเลขเครื่อง">
                  <input type="text" value={dtForm.machine_no} onChange={e => setDtForm(f => ({ ...f, machine_no: e.target.value }))} placeholder="เช่น MC-01" style={inputStyle} />
                </Field>
                <Field label="รายละเอียด">
                  <textarea value={dtForm.description} onChange={e => setDtForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="อธิบายสาเหตุ..." style={{ ...inputStyle, resize: 'vertical' }} />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowDT(false)} style={cancelBtnStyle}>ยกเลิก</button>
                <button onClick={handleAddDT} disabled={savingDT || !dtForm.downtime_type_id}
                  style={{ ...saveBtnStyle, background: '#ef4444', opacity: (!dtForm.downtime_type_id || savingDT) ? 0.5 : 1 }}>
                  {savingDT ? '...' : 'บันทึก Downtime'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HISTORY TAB
═══════════════════════════════════════════════════════════════ */
function HistoryTab() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState({ date: '', line_name: '' });
  const [lineNames, setLineNames] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [dtMap, setDtMap]       = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabaseDR.from('production_sessions')
      .select('*, dr_products(name)')
      .eq('status', 'closed')
      .order('work_date', { ascending: false })
      .limit(100);
    if (filter.date)      q = q.eq('work_date', filter.date);
    if (filter.line_name) q = q.eq('line_name', filter.line_name);
    const [{ data: ss }, { data: ln }] = await Promise.all([
      q,
      supabase.from('production_lines').select('name').order('name'),
    ]);
    setSessions(ss || []);
    setLineNames((ln || []).map(l => l.name));
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const loadDT = async (sessionId) => {
    if (dtMap[sessionId]) return;
    const { data } = await supabaseDR.from('downtime_logs')
      .select('*, dr_downtime_types(name_th, color, category)')
      .eq('session_id', sessionId)
      .order('started_at');
    setDtMap(m => ({ ...m, [sessionId]: data || [] }));
  };

  const handleExpand = (id) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    loadDT(id);
  };

  if (loading) return <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>กำลังโหลด...</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="date" value={filter.date} onChange={e => setFilter(f => ({ ...f, date: e.target.value }))} style={{ ...inputStyle, width: 160 }} />
        <select value={filter.line_name} onChange={e => setFilter(f => ({ ...f, line_name: e.target.value }))} style={{ ...inputStyle, width: 200 }}>
          <option value="">ทุกไลน์</option>
          {lineNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onClick={() => setFilter({ date: '', line_name: '' })} style={cancelBtnStyle}>ล้าง</button>
      </div>

      {sessions.length === 0 && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>ไม่พบข้อมูล</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sessions.map(s => {
          const dts = dtMap[s.id] || [];
          const totalDT  = dts.reduce((acc, d) => acc + (d.duration_min || 0), 0);
          const ngTotal  = (s.qty_ng_rh || 0) + (s.qty_ng_lh || 0);
          const defRate  = s.actual_qty > 0 ? ((ngTotal / s.actual_qty) * 100).toFixed(1) : 0;
          return (
            <div key={s.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div onClick={() => handleExpand(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', cursor: 'pointer' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{s.line_name}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{s.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {s.work_date}</span>
                    {s.dr_products?.name && <span style={{ fontSize: 11, color: '#4d9fff' }}>· {s.dr_products.name}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}>
                  <Stat label="ผลิต" value={s.actual_qty} color="#4d9fff" />
                  <Stat label="NG%" value={`${defRate}%`} color={defRate > 1 ? '#ef4444' : '#22c55e'} />
                  <Stat label="DT" value={fmtMin(totalDT)} color="#a855f7" small />
                  <span style={{ color: 'var(--muted)', fontSize: 16 }}>{expanded === s.id ? '▲' : '▼'}</span>
                </div>
              </div>
              {expanded === s.id && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', background: 'var(--bg2)' }}>
                  {dts.length === 0 ? (
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>ไม่มี Downtime ในกะนี้</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {dts.map(d => {
                        const cat = CAT_META[d.dr_downtime_types?.category] || CAT_META.unplanned;
                        return (
                          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'var(--card)', borderRadius: 6, borderLeft: `3px solid ${d.dr_downtime_types?.color || '#aaa'}` }}>
                            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: cat.bg, color: cat.color, fontWeight: 700 }}>{cat.label}</span>
                            <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{d.dr_downtime_types?.name_th}</span>
                            {d.description && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{d.description}</span>}
                            <span style={{ fontSize: 13, fontWeight: 700, color: d.dr_downtime_types?.color || '#aaa' }}>{fmtMin(d.duration_min)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SETUP TAB
═══════════════════════════════════════════════════════════════ */
function SetupTab({ role }) {
  const [subTab, setSubTab] = useState('products');
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', borderRadius: 8, padding: 4, marginBottom: 20, width: 'fit-content', flexWrap: 'wrap' }}>
        {[
          { key: 'products',  label: '🔩 สินค้า / Model' },
          { key: 'kanban',    label: '📦 Kanban Standard' },
          { key: 'downtime',  label: '⏱ ประเภท Downtime' },
        ].map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: subTab === t.key ? 'var(--accent)' : 'transparent',
              color: subTab === t.key ? '#fff' : 'var(--muted)' }}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab === 'products' && <ProductSetup role={role} />}
      {subTab === 'kanban'   && <KanbanStandardSetup role={role} />}
      {subTab === 'downtime' && <DowntimeTypeSetup role={role} />}
    </div>
  );
}

/* ── Product Setup ── */
function ProductSetup({ role }) {
  const [items, setItems]   = useState([]);
  const [lines, setLines]   = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm]     = useState({ name: '', code: '', line_name: '', cycle_time_sec: '', target_per_shift: '', is_active: true });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: pr }, { data: ln }] = await Promise.all([
      supabaseDR.from('dr_products').select('*').order('name'),
      supabase.from('production_lines').select('id, name').order('name'),
    ]);
    setItems(pr || []);
    setLines(ln || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (item = null) => {
    setEditing(item?.id || 'new');
    setForm(item
      ? { name: item.name, code: item.code || '', line_name: item.line_name || '', cycle_time_sec: item.cycle_time_sec || '', target_per_shift: item.target_per_shift || '', process_type: item.process_type || 'welding_assembly', is_active: item.is_active }
      : { name: '', code: '', line_name: '', cycle_time_sec: '', target_per_shift: '', process_type: 'welding_assembly', is_active: true });
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('กรอกชื่อสินค้า'); return; }
    setSaving(true);
    const payload = {
      name: form.name, code: form.code || null, line_name: form.line_name || null,
      cycle_time_sec: form.cycle_time_sec ? parseFloat(form.cycle_time_sec) : null,
      target_per_shift: form.target_per_shift ? parseInt(form.target_per_shift) : null,
      process_type: form.process_type || 'welding_assembly',
      is_active: form.is_active,
    };
    const { error } = editing === 'new'
      ? await supabaseDR.from('dr_products').insert(payload)
      : await supabaseDR.from('dr_products').update(payload).eq('id', editing);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึกสำเร็จ');
    setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ลบสินค้านี้?')) return;
    const { error } = await supabaseDR.from('dr_products').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const canEdit = ['admin', 'manager'].includes(role);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>{items.length} สินค้า</div>
        {canEdit && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่มสินค้า</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
        {items.map(item => (
          <div key={item.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', opacity: item.is_active ? 1 : 0.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{item.name}</div>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                    background: item.process_type === 'metal_forming' ? 'rgba(251,191,36,0.15)' : 'rgba(34,197,94,0.12)',
                    color: item.process_type === 'metal_forming' ? '#fbbf24' : '#22c55e' }}>
                    {item.process_type === 'metal_forming' ? '⚙ Metal Forming' : '🔥 Welding/Assy'}
                  </span>
                </div>
                {item.code && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.code}</div>}
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  {item.line_name && `📍 ${item.line_name}`}
                  {item.cycle_time_sec && ` · CT ${item.cycle_time_sec}s`}
                  {item.target_per_shift && ` · Target ${item.target_per_shift} ชิ้น/กะ`}
                </div>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                  <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="overlay" onClick={() => setEditing(null)} style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,460px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>{editing === 'new' ? '+ เพิ่มสินค้า' : 'แก้ไขสินค้า'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="ชื่อสินค้า / Model *"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} /></Field>
              <Field label="รหัสสินค้า (Code)"><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="เช่น HDF-001" style={inputStyle} /></Field>
              <Field label="ประเภทกระบวนการ *">
                <select value={form.process_type} onChange={e => setForm(f => ({ ...f, process_type: e.target.value }))} style={inputStyle}>
                  <option value="welding_assembly">🔥 Welding / Assembly</option>
                  <option value="metal_forming">⚙ Metal Forming</option>
                </select>
              </Field>
              <Field label="ไลน์ผลิตหลัก">
                <select value={form.line_name} onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))} style={inputStyle}>
                  <option value="">ไม่ระบุ</option>
                  {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Cycle Time (วินาที)"><input type="number" min="0" step="0.1" value={form.cycle_time_sec} onChange={e => setForm(f => ({ ...f, cycle_time_sec: e.target.value }))} placeholder="เช่น 45.5" style={inputStyle} /></Field>
                <Field label="Target ต่อกะ (ชิ้น)"><input type="number" min="0" value={form.target_per_shift} onChange={e => setForm(f => ({ ...f, target_per_shift: e.target.value }))} placeholder="เช่น 500" style={inputStyle} /></Field>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={cancelBtnStyle}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...saveBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'บันทึก'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Downtime Type Setup ── */
function DowntimeTypeSetup({ role }) {
  const [items, setItems]   = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm]     = useState({ name_th: '', name_en: '', category: 'unplanned', process_type: 'welding_assembly', color: '#ef4444', sort_order: 0, is_active: true });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabaseDR.from('dr_downtime_types').select('*').order('category').order('sort_order');
    setItems(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (item = null) => {
    setEditing(item?.id || 'new');
    setForm(item
      ? { name_th: item.name_th, name_en: item.name_en || '', category: item.category, process_type: item.process_type || 'welding_assembly', color: item.color, sort_order: item.sort_order, is_active: item.is_active }
      : { name_th: '', name_en: '', category: 'unplanned', process_type: 'welding_assembly', color: '#ef4444', sort_order: items.length + 1, is_active: true });
  };

  const handleSave = async () => {
    if (!form.name_th) { toast.error('กรอกชื่อประเภท'); return; }
    setSaving(true);
    const { error } = editing === 'new'
      ? await supabaseDR.from('dr_downtime_types').insert(form)
      : await supabaseDR.from('dr_downtime_types').update(form).eq('id', editing);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึกสำเร็จ');
    setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ลบประเภทนี้?')) return;
    const { error } = await supabaseDR.from('dr_downtime_types').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const canEdit = ['admin', 'manager'].includes(role);

  const processGroups = [
    { key: 'welding_assembly', label: '🔥 Welding / Assembly', color: '#f97316' },
    { key: 'metal_forming',   label: '⚙ Metal Forming',       color: '#3b82f6' },
    { key: 'common',          label: '🔗 Common (ทุกประเภท)', color: '#6b7280' },
  ];

  function DowntimeRow({ item }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, borderLeft: `4px solid ${item.color}`, opacity: item.is_active ? 1 : 0.5 }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.name_th}</div>
          {item.name_en && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.name_en}</div>}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', background: item.category === 'unplanned' ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)', borderRadius: 4, padding: '2px 6px' }}>
          {item.category === 'unplanned' ? '⚠ นอกแผน' : '📋 ในแผน'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>#{item.sort_order}</div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
            <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>{items.length} ประเภท</div>
        {canEdit && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่มประเภท</button>}
      </div>

      {processGroups.map(pg => {
        const pgItems = items.filter(i => i.process_type === pg.key);
        if (pgItems.length === 0) return null;
        const upItems = pgItems.filter(i => i.category === 'unplanned');
        const plItems = pgItems.filter(i => i.category === 'planned');
        return (
          <div key={pg.key} style={{ marginBottom: 24, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: pg.color }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{pg.label}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{pgItems.length} รายการ</span>
            </div>
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {upItems.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>⚠ นอกแผน ({upItems.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{upItems.map(i => <DowntimeRow key={i.id} item={i} />)}</div>
                </div>
              )}
              {plItems.length > 0 && (
                <div style={{ marginTop: upItems.length > 0 ? 10 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>📋 ในแผน ({plItems.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{plItems.map(i => <DowntimeRow key={i.id} item={i} />)}</div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {editing && (
        <div className="overlay" onClick={() => setEditing(null)} style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,440px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>{editing === 'new' ? '+ เพิ่มประเภท Downtime' : 'แก้ไขประเภท'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="ชื่อไทย *"><input value={form.name_th} onChange={e => setForm(f => ({ ...f, name_th: e.target.value }))} style={inputStyle} /></Field>
              <Field label="ชื่ออังกฤษ"><input value={form.name_en} onChange={e => setForm(f => ({ ...f, name_en: e.target.value }))} style={inputStyle} /></Field>
              <Field label="กระบวนการ">
                <select value={form.process_type} onChange={e => setForm(f => ({ ...f, process_type: e.target.value }))} style={inputStyle}>
                  <option value="welding_assembly">🔥 Welding / Assembly</option>
                  <option value="metal_forming">⚙ Metal Forming</option>
                  <option value="common">🔗 Common (ทุกกระบวนการ)</option>
                </select>
              </Field>
              <Field label="หมวดหมู่">
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                  <option value="unplanned">⚠ นอกแผน (Unplanned)</option>
                  <option value="planned">📋 ในแผน (Planned)</option>
                </select>
              </Field>
              <Field label="สี">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    style={{ width: 44, height: 36, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'none' }} />
                  <input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="#ef4444" style={{ ...inputStyle, flex: 1 }} />
                </div>
              </Field>
              <Field label="ลำดับ">
                <input type="number" min="0" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} style={inputStyle} />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={cancelBtnStyle}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...saveBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'บันทึก'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   KANBAN STANDARD SETUP
═══════════════════════════════════════════════════════════════ */
function KanbanStandardSetup({ role }) {
  const [items, setItems]     = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState({ mat_no: '', part_name: '', p_no: '', customer: '', qty_per_kanban: 1, is_active: true });
  const [saving, setSaving]   = useState(false);
  const [search, setSearch]   = useState('');

  const load = useCallback(async () => {
    const { data } = await supabaseDR.from('kanban_standards').select('*').order('mat_no');
    setItems(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (item = null) => {
    setEditing(item?.id || 'new');
    setForm(item
      ? { mat_no: item.mat_no, part_name: item.part_name || '', p_no: item.p_no || '', customer: item.customer || '', qty_per_kanban: item.qty_per_kanban, is_active: item.is_active }
      : { mat_no: '', part_name: '', p_no: '', customer: '', qty_per_kanban: 1, is_active: true });
  };

  const handleSave = async () => {
    if (!form.mat_no) { toast.error('กรอก MAT.NO ก่อน'); return; }
    if (!form.qty_per_kanban || form.qty_per_kanban < 1) { toast.error('Qty/Kanban ต้องมากกว่า 0'); return; }
    setSaving(true);
    const payload = { ...form, mat_no: form.mat_no.trim().toUpperCase(), qty_per_kanban: parseInt(form.qty_per_kanban), updated_at: new Date().toISOString() };
    const { error } = editing === 'new'
      ? await supabaseDR.from('kanban_standards').insert(payload)
      : await supabaseDR.from('kanban_standards').update(payload).eq('id', editing);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึกสำเร็จ');
    setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ลบ Standard นี้?')) return;
    const { error } = await supabaseDR.from('kanban_standards').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const canEdit = ['admin', 'manager'].includes(role);
  const filtered = items.filter(i =>
    !search ||
    i.mat_no.toLowerCase().includes(search.toLowerCase()) ||
    (i.part_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (i.customer  || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 200 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหา MAT.NO / ชื่อ / Customer..."
            style={{ ...inputStyle, maxWidth: 300 }} />
          <div style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'center', whiteSpace: 'nowrap' }}>{filtered.length} รายการ</div>
        </div>
        {canEdit && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่ม Standard</button>}
      </div>

      {/* Info banner */}
      <div style={{ background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#38bdf8' }}>
        📌 ตั้งค่า Qty/Kanban ของแต่ละ MAT.NO ไว้ที่นี่ — เมื่อหัวหน้าเพิ่มเป้าหมาย ระบบจะดึงข้อมูลมาอัตโนมัติ ลด Human Error
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีข้อมูล</div>}
        {filtered.map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 9, opacity: item.is_active ? 1 : 0.5 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{item.mat_no}</span>
                {item.part_name && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{item.part_name}</span>}
                {item.customer && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontWeight: 700 }}>{item.customer}</span>
                )}
                {!item.is_active && <span style={{ fontSize: 10, color: '#ef4444' }}>(ปิดใช้งาน)</span>}
              </div>
              {item.p_no && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>P.NO: {item.p_no}</div>}
            </div>
            <div style={{ textAlign: 'center', minWidth: 80 }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#0ea5e9', lineHeight: 1 }}>{item.qty_per_kanban}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>ชิ้น / Kanban</div>
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 15 }}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="overlay" onClick={() => setEditing(null)} style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,460px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>
              {editing === 'new' ? '+ เพิ่ม Kanban Standard' : 'แก้ไข Kanban Standard'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="MAT.NO *">
                  <input autoFocus value={form.mat_no} onChange={e => setForm(f => ({ ...f, mat_no: e.target.value }))}
                    placeholder="เช่น 10100335" style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700 }}
                    disabled={editing !== 'new'} />
                </Field>
                <Field label="Qty / Kanban Card *">
                  <input type="number" min="1" value={form.qty_per_kanban} onChange={e => setForm(f => ({ ...f, qty_per_kanban: e.target.value }))}
                    style={{ ...inputStyle, fontSize: 18, fontWeight: 800, textAlign: 'center' }} />
                </Field>
              </div>
              <Field label="ชื่อชิ้นงาน / Part Name">
                <input value={form.part_name} onChange={e => setForm(f => ({ ...f, part_name: e.target.value }))} placeholder="เช่น RB3B 16E061 BA" style={inputStyle} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="P.NO">
                  <input value={form.p_no} onChange={e => setForm(f => ({ ...f, p_no: e.target.value }))} placeholder="เช่น RB3B16E061BA" style={inputStyle} />
                </Field>
                <Field label="Customer">
                  <input value={form.customer} onChange={e => setForm(f => ({ ...f, customer: e.target.value }))} placeholder="เช่น FORD" style={inputStyle} />
                </Field>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={cancelBtnStyle}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving || !form.mat_no || !form.qty_per_kanban}
                style={{ ...saveBtnStyle, opacity: (saving || !form.mat_no || !form.qty_per_kanban) ? 0.5 : 1 }}>
                {saving ? '...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Shared UI helpers ──────────────────────────────────────── */
function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, color, small }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: small ? 12 : 16, fontWeight: 800, color }}>{value ?? 0}</div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
const saveBtnStyle = {
  background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8,
  padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const cancelBtnStyle = {
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer',
};
