import { useState, useEffect, useContext, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';

/* ─── Constants ──────────────────────────────────────────────── */
const CAT_META = {
  A: { label: 'Normal Process',      labelTh: 'กระบวนการปกติ',            color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   icon: '🔄' },
  B: { label: 'Intentional Stop',    labelTh: 'หยุดโดยตัดสินใจก่อน',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '🔧' },
  C: { label: 'Unplanned / Accident',labelTh: 'อุบัติเหตุ / ไม่ได้วางแผน', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  icon: '🚨' },
};

const STATUS_META = {
  pending:     { label: 'รอดำเนินการ', color: '#aaa',     bg: 'rgba(128,128,128,0.12)' },
  in_progress: { label: 'กำลังดำเนินการ', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  approved:    { label: 'อนุมัติแล้ว',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  rejected:    { label: 'ปฏิเสธ',        color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
};

const ROLE_META = {
  O:   { label: 'Operator / Production', color: '#4d9fff', bg: 'rgba(77,159,255,0.12)'  },
  QT:  { label: 'Quality Technician',    color: '#a855f7', bg: 'rgba(168,85,247,0.12)'  },
  JME: { label: 'JIG Maintenance',       color: '#f97316', bg: 'rgba(249,115,22,0.12)'  },
  ME:  { label: 'Manufacturing Eng.',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
};

// Map system role → CQI role keys they can approve
const ROLE_CAN_APPROVE = {
  admin:      ['O','QT','JME','ME'],
  manager:    ['O','QT','JME','ME'],
  supervisor: ['O','JME'],
  leader:     ['O'],
  qa:         ['QT'],
};

function toLocalDateStr(d = new Date()) {
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// Compute duration from event start (work_date + event_time) to approved_at
function calcDuration(workDate, eventTime, approvedAt) {
  if (!approvedAt || !workDate) return null;
  const start = new Date(`${workDate}T${eventTime || '00:00'}:00`);
  const end = new Date(approvedAt);
  const diffMs = end - start;
  if (diffMs < 0) return null;
  const totalMin = Math.round(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}

/* ─── Main Component ─────────────────────────────────────────── */
export default function EventLog() {
  const { role, fullName } = useContext(UserContext);
  const [tab, setTab] = useState('list');           // list | create
  const [logs, setLogs]           = useState([]);
  const [eventDefs, setEventDefs] = useState([]);
  const [checkItems, setCheckItems] = useState([]);
  const [matrix, setMatrix]       = useState([]);   // cqi15_event_check_matrix
  const [lines, setLines]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);  // for detail modal

  // Create form state
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    work_date: today,
    event_time: new Date().toTimeString().slice(0,5),
    line_name: '',
    station_number: '',
    weld_cell_operator: '',
    event_no: '',
    issue_description: '',
    qty_total: 0, qty_ok: 0, qty_ng: 0, qty_rework: 0, qty_scrap: 0,
    remark: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [
      { data: logData },
      { data: defData },
      { data: chkData },
      { data: matData },
      { data: lineData },
    ] = await Promise.all([
      supabase.from('cqi15_event_logs')
        .select(`*, cqi15_event_definitions(*), cqi15_event_approvals(*), profiles!cqi15_event_logs_reported_by_fkey(full_name)`)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('cqi15_event_definitions').select('*').order('event_no'),
      supabase.from('cqi15_check_items').select('*').order('check_no'),
      supabase.from('cqi15_event_check_matrix').select('*'),
      supabase.from('production_lines').select('id, name').order('name'),
    ]);
    setLogs(logData || []);
    setEventDefs(defData || []);
    setCheckItems(chkData || []);
    setMatrix(matData || []);
    setLines(lineData || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── Submit new event ── */
  const handleSubmit = async () => {
    if (!form.line_name || !form.event_no) {
      toast.error('กรุณาเลือก ไลน์ผลิต และ Event ให้ครบ');
      return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Insert event log
      const { data: newLog, error: logErr } = await supabase
        .from('cqi15_event_logs')
        .insert({
          work_date: form.work_date,
          event_time: form.event_time || null,
          line_name: form.line_name,
          station_number: form.station_number,
          weld_cell_operator: form.weld_cell_operator,
          reported_by: user.id,
          event_no: parseInt(form.event_no),
          issue_description: form.issue_description,
          qty_total: parseInt(form.qty_total) || 0,
          qty_ok: parseInt(form.qty_ok) || 0,
          qty_ng: parseInt(form.qty_ng) || 0,
          qty_rework: parseInt(form.qty_rework) || 0,
          qty_scrap: parseInt(form.qty_scrap) || 0,
          overall_status: 'pending',
          remark: form.remark,
          created_by: user.id,
        })
        .select()
        .single();

      if (logErr) throw logErr;

      // 2. Determine which roles are needed for this event
      const eventChecks = matrix.filter(m => m.event_no === parseInt(form.event_no));
      const rolesNeeded = new Set();
      eventChecks.forEach(ch => {
        ch.responsible.split('/').forEach(r => {
          const key = r.replace('*','').trim();
          if (ROLE_META[key]) rolesNeeded.add(key);
        });
      });

      // 3. Insert approval records for each needed role
      if (rolesNeeded.size > 0) {
        await supabase.from('cqi15_event_approvals').insert(
          [...rolesNeeded].map(rk => ({
            event_log_id: newLog.id,
            role_key: rk,
            status: 'pending',
          }))
        );
      }

      // 4. Initialize check completions
      if (eventChecks.length > 0) {
        await supabase.from('cqi15_check_completions').insert(
          eventChecks.map(ch => ({
            event_log_id: newLog.id,
            check_no: ch.check_no,
            result: 'pending',
          }))
        );
      }

      // 5. Update to in_progress
      await supabase.from('cqi15_event_logs').update({ overall_status: 'in_progress' }).eq('id', newLog.id);

      // 6. Send notification via edge function
      const evDef = eventDefs.find(d => d.event_no === parseInt(form.event_no));
      try {
        await supabase.functions.invoke('send-cqi15-notification', {
          body: {
            event: 'new_event',
            log: { ...newLog, overall_status: 'in_progress' },
            event_def: evDef,
            roles_needed: [...rolesNeeded],
          },
        });
      } catch (_) { /* notification failure is non-critical */ }

      toast.success('บันทึก Event สำเร็จ');
      setTab('list');
      setForm({ work_date: today, event_time: new Date().toTimeString().slice(0,5), line_name: '', station_number: '', weld_cell_operator: '', event_no: '', issue_description: '', qty_total: 0, qty_ok: 0, qty_ng: 0, qty_rework: 0, qty_scrap: 0, remark: '' });
      fetchAll();
    } catch (e) {
      console.error(e);
      toast.error('บันทึกไม่สำเร็จ: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const groupedEvents = { A: [], B: [], C: [] };
  eventDefs.forEach(e => { if (groupedEvents[e.category]) groupedEvents[e.category].push(e); });

  /* ── Stats ── */
  const stats = {
    total: logs.length,
    pending: logs.filter(l => l.overall_status === 'pending' || l.overall_status === 'in_progress').length,
    approved: logs.filter(l => l.overall_status === 'approved').length,
    catC: logs.filter(l => l.cqi15_event_definitions?.category === 'C').length,
  };

  return (
    <div className="page-content">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 'clamp(18px,3vw,24px)', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)', letterSpacing: '-0.5px' }}>
            CQI-15 Event Log
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>งานเชื่อม · บันทึกเหตุการณ์ตาม Welding Event Matrix</div>
        </div>
        <button
          onClick={() => setTab(tab === 'create' ? 'list' : 'create')}
          style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: tab === 'create' ? 'var(--bg3)' : 'var(--accent)', color: tab === 'create' ? 'var(--text2)' : '#000', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          {tab === 'create' ? '← กลับรายการ' : '+ บันทึก Event ใหม่'}
        </button>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'ทั้งหมด',       value: stats.total,    color: '#4d9fff' },
          { label: 'รออนุมัติ',      value: stats.pending,  color: '#f59e0b' },
          { label: 'อนุมัติแล้ว',    value: stats.approved, color: '#22c55e' },
          { label: 'Cat C (ฉุกเฉิน)', value: stats.catC,    color: '#ef4444' },
        ].map(k => (
          <div key={k.label} className="card" style={{ borderTop: `3px solid ${k.color}`, padding: '14px 18px' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{k.label}</div>
            <div style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text)', lineHeight: 1.2, marginTop: 4 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {tab === 'create' ? (
        <CreateEventForm
          form={form} setForm={setForm}
          groupedEvents={groupedEvents} lines={lines}
          matrix={matrix} checkItems={checkItems} eventDefs={eventDefs}
          onSubmit={handleSubmit} submitting={submitting}
        />
      ) : (
        <EventList
          logs={logs} loading={loading}
          onSelect={setSelectedLog}
          role={role}
        />
      )}

      {selectedLog && (
        <EventDetailModal
          log={selectedLog}
          matrix={matrix}
          checkItems={checkItems}
          eventDefs={eventDefs}
          role={role}
          onClose={() => setSelectedLog(null)}
          onRefresh={() => { fetchAll(); setSelectedLog(null); }}
        />
      )}
    </div>
  );
}

/* ─── Create Form ──────────────────────────────────────────────── */
function CreateEventForm({ form, setForm, groupedEvents, lines, matrix, checkItems, eventDefs, onSubmit, submitting }) {
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const selectedEvent = eventDefs.find(d => d.event_no === parseInt(form.event_no));
  const eventChecks = selectedEvent
    ? matrix.filter(m => m.event_no === selectedEvent.event_no)
    : [];

  // Group checks by role
  const checksByRole = {};
  eventChecks.forEach(ch => {
    const roles = ch.responsible.split('/').map(r => r.replace('*','').trim());
    roles.forEach(rk => {
      if (!checksByRole[rk]) checksByRole[rk] = [];
      const item = checkItems.find(c => c.check_no === ch.check_no);
      if (item) checksByRole[rk].push({ ...item, is_critical: ch.is_critical });
    });
  });

  const catMeta = selectedEvent ? CAT_META[selectedEvent.category] : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Left: Form fields */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>📋 ข้อมูล Event</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>วันที่</label>
            <input type="date" value={form.work_date} onChange={e => f('work_date', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>เวลา</label>
            <input type="time" value={form.event_time} onChange={e => f('event_time', e.target.value)} />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ไลน์ผลิต *</label>
          <select value={form.line_name} onChange={e => f('line_name', e.target.value)}>
            <option value="">-- เลือกไลน์ --</option>
            {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Station Number</label>
            <input type="text" placeholder="เช่น SP-67" value={form.station_number} onChange={e => f('station_number', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Weld Cell Operator</label>
            <input type="text" placeholder="ชื่อพนักงาน" value={form.weld_cell_operator} onChange={e => f('weld_cell_operator', e.target.value)} />
          </div>
        </div>

        {/* Event selector */}
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Event *</label>
          <select value={form.event_no} onChange={e => f('event_no', e.target.value)}>
            <option value="">-- เลือก Event --</option>
            {Object.entries(groupedEvents).map(([cat, evs]) => (
              <optgroup key={cat} label={`Category ${cat}: ${CAT_META[cat].labelTh}`}>
                {evs.map(ev => (
                  <option key={ev.event_no} value={ev.event_no}>
                    #{ev.event_no} {ev.name_th || ev.name_en}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {catMeta && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: catMeta.bg, border: `1px solid ${catMeta.color}40`, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 20 }}>{catMeta.icon}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: catMeta.color }}>Category {selectedEvent.category} · {catMeta.labelTh}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{selectedEvent.name_th}</div>
            </div>
          </div>
        )}

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Issue / สาเหตุ</label>
          <textarea rows={3} placeholder="อธิบายปัญหาที่เกิดขึ้น..." value={form.issue_description}
            onChange={e => f('issue_description', e.target.value)}
            style={{ resize: 'vertical' }} />
        </div>

        {/* Qty */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 700 }}>จำนวนชิ้นงาน</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
            {[
              { k: 'qty_total',  label: 'ทั้งหมด', color: '#4d9fff' },
              { k: 'qty_ok',     label: 'OK',       color: '#22c55e' },
              { k: 'qty_ng',     label: 'NG',        color: '#ef4444' },
              { k: 'qty_rework', label: 'Rework',   color: '#f59e0b' },
              { k: 'qty_scrap',  label: 'Scrap',    color: '#a855f7' },
            ].map(q => (
              <div key={q.k} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: q.color, marginBottom: 4 }}>{q.label}</div>
                <input type="number" min={0} value={form[q.k]}
                  onChange={e => f(q.k, e.target.value)}
                  style={{ textAlign: 'center', padding: '6px 4px', fontSize: 14, fontWeight: 700 }} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Remark</label>
          <input type="text" value={form.remark} onChange={e => f('remark', e.target.value)} placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)" />
        </div>

        <button
          onClick={onSubmit}
          disabled={submitting || !form.line_name || !form.event_no}
          style={{ padding: '12px 0', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#000', fontWeight: 800, fontSize: 15, cursor: 'pointer', marginTop: 4 }}>
          {submitting ? 'กำลังบันทึก...' : '✓ บันทึก Event & ส่ง Notification'}
        </button>
      </div>

      {/* Right: Checklist preview */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>
          📋 Checklist ตาม Matrix
          {selectedEvent && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>Event #{selectedEvent.event_no} · {eventChecks.length} รายการ</span>}
        </div>

        {!selectedEvent ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
            เลือก Event เพื่อดู Checklist
          </div>
        ) : Object.keys(checksByRole).length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
            ไม่มี Checklist สำหรับ Event นี้
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Object.entries(checksByRole).map(([rk, items]) => {
              const rm = ROLE_META[rk] || { label: rk, color: '#aaa', bg: 'rgba(128,128,128,0.1)' };
              return (
                <div key={rk}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: rm.bg, color: rm.color, border: `1px solid ${rm.color}40` }}>
                      {rk} · {rm.label}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>{items.length} รายการ</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {items.map(item => (
                      <div key={item.check_no} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px', borderRadius: 6, background: 'var(--bg3)', borderLeft: `3px solid ${rm.color}` }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: rm.color, minWidth: 20, marginTop: 1 }}>#{item.check_no}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.4 }}>{item.name_th}</div>
                          {item.is_critical && (
                            <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 700 }}>⚠ ต้องตรวจสอบชิ้นงานหลัง event</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Event List ─────────────────────────────────────────────── */
function EventList({ logs, loading, onSelect, role }) {
  const [filterCat, setFilterCat] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDate, setFilterDate] = useState('');

  const filtered = logs.filter(l => {
    const cat = l.cqi15_event_definitions?.category;
    if (filterCat !== 'all' && cat !== filterCat) return false;
    if (filterStatus !== 'all' && l.overall_status !== filterStatus) return false;
    if (filterDate && l.work_date !== filterDate) return false;
    return true;
  });

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>กรอง:</span>
        {/* Category */}
        <div style={{ display: 'flex', gap: 4 }}>
          {['all','A','B','C'].map(c => (
            <button key={c} onClick={() => setFilterCat(c)}
              style={{ padding: '4px 12px', borderRadius: 20, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                background: filterCat === c ? (c === 'all' ? 'var(--border2)' : CAT_META[c]?.bg) : 'transparent',
                color: filterCat === c ? (c === 'all' ? 'var(--text)' : CAT_META[c]?.color) : 'var(--muted)' }}>
              {c === 'all' ? 'ทั้งหมด' : `Cat ${c}`}
            </button>
          ))}
        </div>
        {/* Status */}
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '4px 10px', fontSize: 12, width: 'auto', minWidth: 130 }}>
          <option value="all">ทุกสถานะ</option>
          <option value="pending">รอดำเนินการ</option>
          <option value="in_progress">กำลังดำเนินการ</option>
          <option value="approved">อนุมัติแล้ว</option>
          <option value="rejected">ปฏิเสธ</option>
        </select>
        <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
          style={{ padding: '4px 10px', fontSize: 12, width: 'auto', minWidth: 140 }} />
        {filterDate && (
          <button onClick={() => setFilterDate('')} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: 'none', background: 'var(--bg3)', color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{filtered.length} รายการ</span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)' }}>กำลังโหลด...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>ไม่มีข้อมูล</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>วันที่ / เวลา</th>
                <th>ไลน์</th>
                <th>Station</th>
                <th>Event</th>
                <th>Issue</th>
                <th style={{ textAlign: 'center' }}>Qty OK/NG</th>
                <th>Approval</th>
                <th>สถานะ</th>
                <th>ผู้บันทึก</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(log => {
                const def = log.cqi15_event_definitions;
                const cat = def?.category;
                const cm = cat ? CAT_META[cat] : null;
                const sm = STATUS_META[log.overall_status] || STATUS_META.pending;
                const approvals = log.cqi15_event_approvals || [];
                const approvedRoles = approvals.filter(a => a.status === 'approved').map(a => a.role_key);
                const pendingRoles  = approvals.filter(a => a.status === 'pending').map(a => a.role_key);
                return (
                  <tr key={log.id} onClick={() => onSelect(log)} style={{ cursor: 'pointer' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{log.work_date}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{log.event_time || '—'}</div>
                      {log.approved_at && (() => {
                        const dur = calcDuration(log.work_date, log.event_time, log.approved_at);
                        return dur ? (
                          <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 700, marginTop: 2 }}>⏱ {dur}</div>
                        ) : null;
                      })()}
                    </td>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{log.line_name}</td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{log.station_number || '—'}</td>
                    <td>
                      {cm && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: cm.bg, color: cm.color, whiteSpace: 'nowrap' }}>
                            {cm.icon} Cat {cat}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text2)' }}>#{def?.event_no}</span>
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text)', marginTop: 2, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {def?.name_th || def?.name_en || '—'}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.issue_description || '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 12 }}>
                        <span style={{ color: '#22c55e', fontWeight: 700 }}>{log.qty_ok}</span>
                        <span style={{ color: 'var(--muted)' }}> / </span>
                        <span style={{ color: '#ef4444', fontWeight: 700 }}>{log.qty_ng}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {approvals.map(a => {
                          const rm = ROLE_META[a.role_key] || { color: '#aaa', bg: '' };
                          const icon = a.status === 'approved' ? '✓' : a.status === 'rejected' ? '✗' : '…';
                          return (
                            <span key={a.role_key} style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                              background: a.status === 'approved' ? rm.bg : a.status === 'rejected' ? 'rgba(239,68,68,0.12)' : 'var(--bg3)',
                              color: a.status === 'approved' ? rm.color : a.status === 'rejected' ? '#ef4444' : 'var(--muted)',
                              border: `1px solid ${a.status === 'approved' ? rm.color + '40' : 'transparent'}` }}>
                              {icon} {a.role_key}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: sm.bg, color: sm.color }}>
                        {sm.label}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {log.profiles?.full_name || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Event Detail Modal ─────────────────────────────────────── */
function EventDetailModal({ log, matrix, checkItems, eventDefs, role, onClose, onRefresh }) {
  const { fullName } = useContext(UserContext);
  const [approvals, setApprovals]       = useState(log.cqi15_event_approvals || []);
  const [completions, setCompletions]   = useState([]);
  const [loadingChecks, setLoadingChecks] = useState(true);
  const [approvingRole, setApprovingRole] = useState(null);
  const [rejectNote, setRejectNote]     = useState('');
  const [showReject, setShowReject]     = useState(null);

  const def  = log.cqi15_event_definitions;
  const cat  = def?.category;
  const cm   = cat ? CAT_META[cat] : null;
  const sm   = STATUS_META[log.overall_status] || STATUS_META.pending;

  const myApproveKeys = ROLE_CAN_APPROVE[role] || [];

  useEffect(() => {
    const loadData = async () => {
      setLoadingChecks(true);
      const [{ data: appData }, { data: chkData }] = await Promise.all([
        supabase.from('cqi15_event_approvals').select('*, profiles(full_name)').eq('event_log_id', log.id),
        supabase.from('cqi15_check_completions').select('*, profiles(full_name)').eq('event_log_id', log.id),
      ]);
      setApprovals(appData || []);
      setCompletions(chkData || []);
      setLoadingChecks(false);
    };
    loadData();
  }, [log.id]);

  const handleApprove = async (roleKey, status) => {
    setApprovingRole(roleKey);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('cqi15_event_approvals')
        .update({ status, approved_by: user.id, approved_at: new Date().toISOString(), notes: rejectNote || null })
        .eq('event_log_id', log.id)
        .eq('role_key', roleKey);
      if (error) throw error;

      // Refresh approvals
      const { data: newApprovals } = await supabase
        .from('cqi15_event_approvals').select('*, profiles(full_name)').eq('event_log_id', log.id);
      setApprovals(newApprovals || []);

      // Check if all approved → update log status
      const all = newApprovals || [];
      const allApproved = all.length > 0 && all.every(a => a.status === 'approved');
      const anyRejected = all.some(a => a.status === 'rejected');
      if (allApproved || anyRejected) {
        const finalUpdate = { overall_status: anyRejected ? 'rejected' : 'approved' };
        if (allApproved) finalUpdate.approved_at = new Date().toISOString();
        await supabase.from('cqi15_event_logs')
          .update(finalUpdate)
          .eq('id', log.id);
        // Notify via edge function
        try {
          await supabase.functions.invoke('send-cqi15-notification', {
            body: { event: 'approval_update', log_id: log.id, role_key: roleKey, status, approver: fullName },
          });
        } catch (_) {}
        toast.success(status === 'approved' ? 'อนุมัติสำเร็จ' : 'ปฏิเสธแล้ว');
        onRefresh();
      } else {
        toast.success(status === 'approved' ? `อนุมัติ [${roleKey}] สำเร็จ` : `ปฏิเสธ [${roleKey}]`);
      }
      setShowReject(null);
      setRejectNote('');
    } catch (e) {
      toast.error('เกิดข้อผิดพลาด: ' + e.message);
    } finally {
      setApprovingRole(null);
    }
  };

  const handleCheckResult = async (checkNo, result) => {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('cqi15_check_completions')
      .upsert({ event_log_id: log.id, check_no: checkNo, result, completed_by: user.id, completed_at: new Date().toISOString() },
               { onConflict: 'event_log_id,check_no' });
    const { data } = await supabase.from('cqi15_check_completions')
      .select('*, profiles(full_name)').eq('event_log_id', log.id);
    setCompletions(data || []);
  };

  // Checks for this event grouped by role
  const eventChecks = matrix.filter(m => m.event_no === def?.event_no);
  const checksByRole = {};
  eventChecks.forEach(ch => {
    ch.responsible.split('/').map(r => r.replace('*','').trim()).forEach(rk => {
      if (!checksByRole[rk]) checksByRole[rk] = [];
      const item = checkItems.find(c => c.check_no === ch.check_no);
      if (item && !checksByRole[rk].find(x => x.check_no === item.check_no)) {
        checksByRole[rk].push({ ...item, is_critical: ch.is_critical });
      }
    });
  });

  return (
    <div className="overlay" onClick={onClose} style={{ zIndex: 2000, alignItems: 'flex-start', overflowY: 'auto', padding: '24px 16px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 28,
          width: 'min(95vw,860px)', boxShadow: 'var(--shadow-lg)', marginTop: 20, marginBottom: 20 }}>

        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              {cm && <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: cm.bg, color: cm.color }}>{cm.icon} Category {cat} · {cm.labelTh}</span>}
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: sm.bg, color: sm.color }}>{sm.label}</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>Event #{def?.event_no} · {def?.name_th}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{log.line_name} · {log.station_number || 'ไม่ระบุ Station'} · {log.work_date} {log.event_time || ''}</div>
            {log.approved_at && (() => {
              const dur = calcDuration(log.work_date, log.event_time, log.approved_at);
              const approvedTime = new Date(log.approved_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
              return (
                <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, background: 'rgba(34,197,94,0.12)', padding: '3px 10px', borderRadius: 20 }}>
                    ✓ อนุมัติสำเร็จ {approvedTime} น.
                  </span>
                  {dur && (
                    <span style={{ fontSize: 11, color: '#4d9fff', fontWeight: 700, background: 'rgba(77,159,255,0.12)', padding: '3px 10px', borderRadius: 20 }}>
                      ⏱ รวมเวลา {dur}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', padding: '0 4px' }}>✕</button>
        </div>

        {/* Info row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Qty ทั้งหมด', value: log.qty_total, color: '#4d9fff' },
            { label: 'OK',          value: log.qty_ok,    color: '#22c55e' },
            { label: 'NG',          value: log.qty_ng,    color: '#ef4444' },
            { label: 'Rework',      value: log.qty_rework, color: '#f59e0b' },
            { label: 'Scrap',       value: log.qty_scrap, color: '#a855f7' },
          ].map(q => (
            <div key={q.label} style={{ background: 'var(--card)', borderRadius: 8, padding: '10px 14px', textAlign: 'center', border: `1px solid ${q.color}30` }}>
              <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{q.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: q.color, fontFamily: 'var(--font-display)' }}>{q.value}</div>
            </div>
          ))}
        </div>

        {log.issue_description && (
          <div style={{ padding: '10px 14px', background: 'var(--card)', borderRadius: 8, marginBottom: 20, borderLeft: '3px solid var(--amber)' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>ISSUE</div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>{log.issue_description}</div>
          </div>
        )}

        {/* Approval section */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
            ✅ การอนุมัติตาม Role
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
            {approvals.map(appr => {
              const rm = ROLE_META[appr.role_key] || { label: appr.role_key, color: '#aaa', bg: 'rgba(128,128,128,0.1)' };
              const canApprove = myApproveKeys.includes(appr.role_key) && appr.status === 'pending';
              return (
                <div key={appr.role_key} style={{ background: 'var(--card)', borderRadius: 10, padding: '14px 16px', border: `1px solid ${appr.status === 'approved' ? rm.color + '40' : appr.status === 'rejected' ? '#ef444440' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: rm.color }}>{appr.role_key}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: appr.status === 'approved' ? rm.bg : appr.status === 'rejected' ? 'rgba(239,68,68,0.12)' : 'var(--bg3)',
                      color: appr.status === 'approved' ? rm.color : appr.status === 'rejected' ? '#ef4444' : 'var(--muted)' }}>
                      {appr.status === 'approved' ? '✓ อนุมัติ' : appr.status === 'rejected' ? '✗ ปฏิเสธ' : '⋯ รอ'}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 10 }}>{rm.label}</div>
                  {appr.status !== 'pending' && appr.profiles?.full_name && (
                    <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 6 }}>โดย: {appr.profiles.full_name}</div>
                  )}
                  {appr.notes && (
                    <div style={{ fontSize: 10, color: '#ef4444', marginBottom: 6, fontStyle: 'italic' }}>หมายเหตุ: {appr.notes}</div>
                  )}
                  {canApprove && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <button
                        disabled={approvingRole === appr.role_key}
                        onClick={() => handleApprove(appr.role_key, 'approved')}
                        style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', background: rm.bg, color: rm.color, fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                        ✓ อนุมัติ
                      </button>
                      <button
                        disabled={approvingRole === appr.role_key}
                        onClick={() => setShowReject(appr.role_key)}
                        style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid var(--border2)', background: 'transparent', color: '#ef4444', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                        ✗ ปฏิเสธ
                      </button>
                    </div>
                  )}
                  {showReject === appr.role_key && (
                    <div style={{ marginTop: 8 }}>
                      <input type="text" placeholder="เหตุผลที่ปฏิเสธ..." value={rejectNote}
                        onChange={e => setRejectNote(e.target.value)}
                        style={{ fontSize: 12, marginBottom: 6 }} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => handleApprove(appr.role_key, 'rejected')}
                          style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: 'none', background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                          ยืนยันปฏิเสธ
                        </button>
                        <button onClick={() => setShowReject(null)}
                          style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: '1px solid var(--border2)', background: 'transparent', color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}>
                          ยกเลิก
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Checklist */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
            📋 Checklist ({completions.filter(c => c.result !== 'pending').length}/{eventChecks.length} รายการเสร็จ)
          </div>
          {loadingChecks ? (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>กำลังโหลด...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {Object.entries(checksByRole).map(([rk, items]) => {
                const rm = ROLE_META[rk] || { label: rk, color: '#aaa', bg: 'rgba(128,128,128,0.1)' };
                const canCheck = myApproveKeys.includes(rk);
                return (
                  <div key={rk}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: rm.bg, color: rm.color, border: `1px solid ${rm.color}40` }}>
                        {rk} · {rm.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {items.map(item => {
                        const comp = completions.find(c => c.check_no === item.check_no);
                        const result = comp?.result || 'pending';
                        return (
                          <div key={item.check_no} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8,
                            background: result === 'ok' ? 'rgba(34,197,94,0.08)' : result === 'ng' ? 'rgba(239,68,68,0.08)' : result === 'na' ? 'rgba(128,128,128,0.06)' : 'var(--card)',
                            border: `1px solid ${result === 'ok' ? '#22c55e30' : result === 'ng' ? '#ef444430' : 'var(--border)'}` }}>
                            <span style={{ fontSize: 10, fontWeight: 800, color: rm.color, minWidth: 22 }}>#{item.check_no}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4 }}>{item.name_th}</div>
                              {item.is_critical && <div style={{ fontSize: 9, color: '#ef4444', fontWeight: 700 }}>⚠ ตรวจสอบชิ้นงานหลัง event</div>}
                              {comp?.profiles?.full_name && <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>โดย: {comp.profiles.full_name}</div>}
                            </div>
                            {canCheck ? (
                              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                {[['ok','✓','#22c55e'],['ng','✗','#ef4444'],['na','N/A','#aaa']].map(([r,lbl,c]) => (
                                  <button key={r} onClick={() => handleCheckResult(item.check_no, r)}
                                    style={{ padding: '4px 8px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700,
                                      background: result === r ? `${c}22` : 'var(--bg3)',
                                      color: result === r ? c : 'var(--muted)',
                                      outline: result === r ? `2px solid ${c}` : 'none' }}>
                                    {lbl}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <span style={{ fontSize: 11, fontWeight: 700, color: result === 'ok' ? '#22c55e' : result === 'ng' ? '#ef4444' : 'var(--muted)', flexShrink: 0 }}>
                                {result === 'ok' ? '✓' : result === 'ng' ? '✗' : result === 'na' ? 'N/A' : '—'}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
