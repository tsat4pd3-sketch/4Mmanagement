import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';

/* ─── RACK CENTER — เรียกภาชนะ/แร็คเปล่าคืนกลับมาใช้ ──────────────────────
   ไลน์ผลิตส่งกล่อง/ถาด/แร็คเปล่ากลับ rack center → ขอภาชนะชุดใหม่กลับมาใช้
   วงจร: requested → preparing → delivered → received (หรือ cancelled)
   แพทเทินเดียวกับ Heijunka Kanban (ฝั่งพาร์ท) แต่ไม่มีรอบจัดส่งตามเวลา
   เพราะเป็นการเรียกแบบ ad-hoc ตามรอบที่ภาชนะในไลน์ใกล้หมด
   ─────────────────────────────────────────────────────────────────────────── */

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 };
const inputSt = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box', fontFamily: 'var(--font-body)' };
const btn = (bg, color = '#fff') => ({ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: bg, color, fontFamily: 'var(--font-body)' });

const STATUS_COLS = [
  { key: 'requested', label: '🔔 เรียกแล้ว',     color: '#f59e0b' },
  { key: 'preparing', label: '🔧 กำลังเตรียม',   color: '#0ea5e9' },
  { key: 'delivered', label: '🚚 จัดส่งแล้ว',     color: '#a855f7' },
  { key: 'received',  label: '✅ รับแล้ว',        color: '#22c55e' },
];

function timeAgo(iso) {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ชม.ที่แล้ว`;
  return new Date(iso).toLocaleDateString('th-TH');
}

const EMPTY_FORM = { line_name: '', container_type_id: '', qty: '1', note: '' };

export default function RackCenter() {
  const { fullName } = useContext(UserContext);

  const [lines,          setLines]          = useState([]);
  const [containerTypes, setContainerTypes] = useState([]);
  const [requests,       setRequests]       = useState([]);
  const [lineFilter,     setLineFilter]     = useState('');
  const [showForm,       setShowForm]       = useState(false);
  const [form,           setForm]           = useState(EMPTY_FORM);
  const [saving,         setSaving]         = useState(false);
  const [busyId,         setBusyId]         = useState(null);
  const [showDone,       setShowDone]       = useState(false);
  const [pkgReqs,        setPkgReqs]        = useState([]);   // packaging_withdrawal_requests
  const [pkgBusy,        setPkgBusy]        = useState(null);

  const load = useCallback(async () => {
    const [{ data: ln }, { data: ct }, { data: req }, { data: pkg }] = await Promise.all([
      supabase.from('production_lines').select('name').order('name'),
      supabaseDR.from('container_types').select('*').eq('is_active', true).order('name'),
      supabaseDR.from('rack_requests').select('*').order('requested_at', { ascending: false }).limit(200),
      supabaseDR.from('packaging_withdrawal_requests').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    setLines(ln || []);
    setContainerTypes(ct || []);
    setRequests(req || []);
    setPkgReqs(pkg || []);
  }, []);

  const issuePkg = async (p) => {
    setPkgBusy(p.id);
    try {
      const { error } = await supabaseDR.from('packaging_withdrawal_requests').update({ status: 'issued' }).eq('id', p.id);
      if (error) throw error;
      toast.success(`จ่าย packaging ${p.packaging_code} แล้ว`);
      await load();
    } catch (err) { toast.error(err.message); }
    setPkgBusy(null);
  };

  useEffect(() => { load(); }, [load]);

  // live refresh เมื่อมีไลน์/rack center อื่นกดเปลี่ยนสถานะ
  useEffect(() => {
    const ch = supabaseDR.channel('rack-requests-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rack_requests' }, load)
      .subscribe();
    return () => { supabaseDR.removeChannel(ch); };
  }, [load]);

  const filtered = useMemo(() => {
    return lineFilter ? requests.filter(r => r.line_name === lineFilter) : requests;
  }, [requests, lineFilter]);

  const byStatus = useMemo(() => {
    const m = { requested: [], preparing: [], delivered: [], received: [] };
    filtered.forEach(r => {
      if (r.status === 'cancelled') return;
      if (r.status === 'received' && !showDone) return;
      (m[r.status] = m[r.status] || []).push(r);
    });
    return m;
  }, [filtered, showDone]);

  const handleRequest = async () => {
    if (!form.line_name) { toast.error('เลือกไลน์ก่อน'); return; }
    if (!form.container_type_id) { toast.error('เลือกชนิดภาชนะ'); return; }
    const qty = parseInt(form.qty) || 0;
    if (qty <= 0) { toast.error('จำนวนต้องมากกว่า 0'); return; }
    const ctype = containerTypes.find(c => c.id === form.container_type_id);
    setSaving(true);
    const { error } = await supabaseDR.from('rack_requests').insert({
      line_name: form.line_name,
      container_type_id: form.container_type_id,
      container_name: ctype?.name || '—',
      qty,
      note: form.note.trim() || null,
      requested_by: fullName,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('🔔 เรียกภาชนะแล้ว — รอ Rack Center เตรียม');
    setShowForm(false);
    setForm(EMPTY_FORM);
    load();
  };

  const advance = async (r) => {
    const next = { requested: 'preparing', preparing: 'delivered', delivered: 'received' }[r.status];
    if (!next) return;
    setBusyId(r.id);
    const payload = { status: next };
    if (next === 'preparing') { payload.prepared_by = fullName; payload.prepared_at = new Date().toISOString(); }
    if (next === 'delivered') { payload.delivered_by = fullName; payload.delivered_at = new Date().toISOString(); }
    if (next === 'received')  { payload.received_by  = fullName; payload.received_at  = new Date().toISOString(); }
    const { error } = await supabaseDR.from('rack_requests').update(payload).eq('id', r.id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const cancel = async (r) => {
    if (!window.confirm('ยืนยันยกเลิกการเรียกภาชนะนี้?')) return;
    setBusyId(r.id);
    const { error } = await supabaseDR.from('rack_requests').update({
      status: 'cancelled', cancelled_by: fullName, cancelled_at: new Date().toISOString(),
    }).eq('id', r.id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const ACTION_LABEL = { requested: '🔧 เริ่มเตรียม', preparing: '🚚 จัดส่งแล้ว', delivered: '✅ รับแล้ว' };

  return (
    <div style={{ padding: 'clamp(12px,2vw,24px)', maxWidth: 'min(96vw, 2000px)', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 'clamp(18px,2.5vw,24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
            🗃️ Rack Center — เรียกภาชนะ
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            ไลน์ผลิตเรียกภาชนะ/แร็คเปล่าคืน · Rack Center เตรียม-จัดส่ง · ไลน์ยืนยันรับ
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={lineFilter} onChange={e => setLineFilter(e.target.value)} style={{ ...inputSt, width: 160 }}>
            <option value="">ทุกไลน์</option>
            {lines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
            แสดงที่รับแล้ว
          </label>
          <button onClick={() => { setForm({ ...EMPTY_FORM, line_name: lineFilter }); setShowForm(true); }} style={btn('#16a34a')}>
            🔔 เรียกภาชนะ
          </button>
        </div>
      </div>

      {/* Packaging withdrawal requests (auto จากการผลิต FG) */}
      {(() => {
        const pending = pkgReqs.filter(p => p.status !== 'issued');
        if (pending.length === 0) return null;
        return (
          <div style={{ ...card, marginBottom: 16, borderColor: 'rgba(245,158,11,0.4)' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#f59e0b', marginBottom: 10, fontFamily: 'var(--font-display)' }}>
              📦 ใบเบิก Packaging จากการผลิต <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>({pending.length} รายการ)</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
              {pending.map(p => (
                <div key={p.id} style={{ background: 'var(--bg2)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#f59e0b' }}>{p.packaging_code}</span>
                    <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{p.qty}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{p.packaging_name || ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    {p.source_line ? `🏭 ${p.source_line}` : ''}{p.product_name ? ` · ${p.product_name}` : ''}
                    {p.source_prod_no ? ` · FG ${p.source_prod_no}` : ''}
                  </div>
                  <button onClick={() => issuePkg(p)} disabled={pkgBusy === p.id}
                    style={{ marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                    {pkgBusy === p.id ? '...' : '✔ จ่าย Packaging'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Kanban board: 4 status columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14 }}>
        {STATUS_COLS.map(col => (
          <div key={col.key} style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: 'var(--bg2)', borderBottom: `2px solid ${col.color}40`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: col.color, fontFamily: 'var(--font-display)' }}>{col.label}</div>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{(byStatus[col.key] || []).length}</span>
            </div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 80, maxHeight: 560, overflowY: 'auto' }}>
              {(byStatus[col.key] || []).length === 0 ? (
                <div style={{ padding: '16px 8px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>—</div>
              ) : (
                (byStatus[col.key] || []).map(r => (
                  <div key={r.id} style={{ background: 'var(--bg2)', border: `1px solid ${col.color}30`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)' }}>📍 {r.line_name}</div>
                      <span style={{ fontSize: 11, fontWeight: 800, color: col.color }}>×{r.qty}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{r.container_name}</div>
                    {r.note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>📝 {r.note}</div>}
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
                      {r.requested_by ? `โดย ${r.requested_by} · ` : ''}{timeAgo(r.requested_at)}
                    </div>
                    {col.key !== 'received' && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button onClick={() => advance(r)} disabled={busyId === r.id}
                          style={{ ...btn(col.color), flex: 1, padding: '6px 10px', fontSize: 12, opacity: busyId === r.id ? 0.6 : 1 }}>
                          {ACTION_LABEL[r.status]}
                        </button>
                        {col.key !== 'delivered' && (
                          <button onClick={() => cancel(r)} disabled={busyId === r.id}
                            style={{ ...btn('rgba(239,68,68,0.1)', '#ef4444'), border: '1px solid rgba(239,68,68,0.3)', padding: '6px 10px', fontSize: 12 }}>
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Request modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(420px,100%)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 16, fontFamily: 'var(--font-display)' }}>
              🔔 เรียกภาชนะ
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ไลน์การผลิต *</label>
                <select value={form.line_name} onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))} style={inputSt}>
                  <option value="">เลือกไลน์...</option>
                  {lines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ชนิดภาชนะ *</label>
                <select value={form.container_type_id} onChange={e => setForm(f => ({ ...f, container_type_id: e.target.value }))} style={inputSt}>
                  <option value="">เลือกภาชนะ...</option>
                  {containerTypes.map(c => <option key={c.id} value={c.id}>{c.name}{c.capacity ? ` (จุ ${c.capacity})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>จำนวน (ใบ/ใบ) *</label>
                <input type="number" min="1" step="1" style={{ ...inputSt, fontSize: 20, fontWeight: 900, textAlign: 'center' }}
                  value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
                <input style={inputSt} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="เช่น ด่วน, จุดส่ง..." />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowForm(false)} style={{ ...btn('var(--bg2)', 'var(--text)'), border: '1px solid var(--border)' }}>ยกเลิก</button>
              <button onClick={handleRequest} disabled={saving} style={{ ...btn('#16a34a'), opacity: saving ? 0.6 : 1 }}>
                {saving ? '...' : '🔔 เรียกภาชนะ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
