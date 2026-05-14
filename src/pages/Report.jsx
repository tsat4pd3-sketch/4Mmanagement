import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const TABS = [
  { id: 'daily',    label: '📅 รายวัน' },
  { id: 'employee', label: '👤 รายพนักงาน' },
  { id: 'range',    label: '📊 สรุปช่วงเวลา' },
  { id: 'fourm',    label: '🚨 4M Changes' },
];

const CAT_META = {
  Man:      { color: '#4d9fff', bg: 'rgba(77,159,255,0.12)',  border: 'rgba(77,159,255,0.35)',  label: '👤 Man' },
  Machine:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.35)',  label: '🔧 Machine' },
  Material: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)',  border: 'rgba(139,92,246,0.35)',  label: '📦 Material' },
  Method:   { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.35)',   label: '📋 Method' },
};

const today = new Date().toISOString().split('T')[0];

function ppeStatus(row) {
  return (row.has_helmet && row.has_boots && row.has_gloves) ? '✅ ครบ' : '⚠️ ไม่ครบ';
}

function defaultFrom(days = 29) {
  const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0];
}

export default function Report() {
  const [tab, setTab] = useState('daily');

  // ── Daily
  const [dailyDate, setDailyDate] = useState(today);
  const [dailyRows, setDailyRows] = useState([]);
  const [dailyFilter, setDailyFilter] = useState('all');
  const [dailyLoading, setDailyLoading] = useState(false);

  // ── Per employee
  const [employees, setEmployees] = useState([]);
  const [selEmp, setSelEmp] = useState('');
  const [empFrom, setEmpFrom] = useState(defaultFrom);
  const [empTo,   setEmpTo]   = useState(today);
  const [empRows, setEmpRows] = useState([]);
  const [empLoading, setEmpLoading] = useState(false);

  // ── Range summary
  const [rangeFrom, setRangeFrom] = useState(defaultFrom);
  const [rangeTo,   setRangeTo]   = useState(today);
  const [rangeRows, setRangeRows] = useState([]);
  const [rangeLoading, setRangeLoading] = useState(false);

  // ── 4M
  const [lines,       setLines]       = useState([]);
  const [fourmFrom,   setFourmFrom]   = useState(defaultFrom);
  const [fourmTo,     setFourmTo]     = useState(today);
  const [fourmLine,   setFourmLine]   = useState('all');
  const [fourmCat,    setFourmCat]    = useState('all');
  const [fourmRows,   setFourmRows]   = useState([]);
  const [fourmLoading, setFourmLoading] = useState(false);

  // ── Load reference data once
  useEffect(() => {
    supabase.from('employees').select('id, name, employee_id_code, image_url')
      .eq('is_active', true).order('employee_id_code')
      .then(({ data }) => { setEmployees(data || []); if (data?.length) setSelEmp(data[0].id); });
    supabase.from('production_lines').select('id, name').order('name')
      .then(({ data }) => setLines(data || []));
  }, []);

  // ── Fetch daily
  useEffect(() => {
    if (tab !== 'daily') return;
    setDailyLoading(true);
    supabase.from('daily_production_logs')
      .select('*, employees(id, name, employee_id_code, image_url)')
      .eq('work_date', dailyDate)
      .order('is_present', { ascending: false })
      .then(({ data }) => { setDailyRows(data || []); setDailyLoading(false); });
  }, [tab, dailyDate]);

  // ── Fetch per-employee
  useEffect(() => {
    if (tab !== 'employee' || !selEmp) return;
    setEmpLoading(true);
    supabase.from('daily_production_logs')
      .select('work_date, is_present, has_helmet, has_boots, has_gloves, remark')
      .eq('employee_id', selEmp)
      .gte('work_date', empFrom).lte('work_date', empTo)
      .order('work_date', { ascending: false })
      .then(({ data }) => { setEmpRows(data || []); setEmpLoading(false); });
  }, [tab, selEmp, empFrom, empTo]);

  // ── Fetch range
  const fetchRange = async () => {
    setRangeLoading(true);
    const { data } = await supabase.from('daily_production_logs')
      .select('employee_id, is_present, employees(id, name, employee_id_code, image_url)')
      .gte('work_date', rangeFrom).lte('work_date', rangeTo);
    const map = {};
    (data || []).forEach(row => {
      const id = row.employee_id;
      if (!map[id]) map[id] = { emp: row.employees, present: 0, absent: 0 };
      row.is_present ? map[id].present++ : map[id].absent++;
    });
    setRangeRows(Object.values(map).sort((a, b) => b.present - a.present));
    setRangeLoading(false);
  };
  useEffect(() => { if (tab === 'range') fetchRange(); }, [tab, rangeFrom, rangeTo]);

  // ── Fetch 4M
  const fetchFourM = async () => {
    setFourmLoading(true);
    let q = supabase.from('four_m_logs').select('*')
      .gte('work_date', fourmFrom).lte('work_date', fourmTo)
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (fourmLine !== 'all') q = q.eq('line_name', fourmLine);
    if (fourmCat  !== 'all') q = q.eq('category', fourmCat);
    const { data } = await q;
    setFourmRows(data || []);
    setFourmLoading(false);
  };
  useEffect(() => { if (tab === 'fourm') fetchFourM(); }, [tab, fourmFrom, fourmTo, fourmLine, fourmCat]);

  // ── Helpers
  const filteredDaily = dailyRows.filter(r =>
    dailyFilter === 'all' ? true : dailyFilter === 'present' ? r.is_present : !r.is_present
  );
  const empInfo    = employees.find(e => e.id === selEmp);
  const empPresent = empRows.filter(r => r.is_present).length;
  const empAbsent  = empRows.filter(r => !r.is_present).length;

  // 4M KPI counts
  const fourmKpi = Object.keys(CAT_META).map(cat => ({
    cat, ...CAT_META[cat],
    count: fourmRows.filter(r => r.category === cat).length,
  }));

  return (
    <div className="page-content">
      <h2 style={{ margin: '0 0 16px', fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>
        📋 รายงาน
      </h2>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '7px 16px', borderRadius: 8, fontWeight: 600, fontSize: 13,
            border: tab === t.id ? '1px solid var(--accent)' : '1px solid var(--border2)',
            background: tab === t.id ? 'rgba(227,25,55,0.12)' : 'var(--bg3)',
            color: tab === t.id ? 'var(--accent)' : 'var(--text2)',
            cursor: 'pointer', transition: 'all 0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ══════════ DAILY ══════════ */}
      {tab === 'daily' && (
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <input type="date" value={dailyDate} onChange={e => setDailyDate(e.target.value)}
              style={inputSt({ accent: true })} />
            {['all','present','absent'].map(f => (
              <button key={f} onClick={() => setDailyFilter(f)} style={filterBtn(dailyFilter === f)}>
                {f === 'all'     ? `ทั้งหมด (${dailyRows.length})` :
                 f === 'present' ? `✅ มาทำงาน (${dailyRows.filter(r=>r.is_present).length})` :
                                   `❌ ขาดงาน (${dailyRows.filter(r=>!r.is_present).length})`}
              </button>
            ))}
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            {dailyLoading ? <Loader /> : (
              <table style={{ minWidth: 540 }}>
                <thead><tr><th></th><th>ID</th><th>ชื่อ</th><th style={{textAlign:'center'}}>สถานะ</th><th style={{textAlign:'center'}}>PPE</th><th>หมายเหตุ</th></tr></thead>
                <tbody>
                  {filteredDaily.length === 0 && <EmptyRow cols={6} />}
                  {filteredDaily.map(row => (
                    <tr key={row.id}>
                      <td><Thumb src={row.employees?.image_url} /></td>
                      <td style={{ fontWeight:700, color:'var(--blue)', fontSize:12 }}>{row.employees?.employee_id_code}</td>
                      <td style={{ fontWeight:600 }}>{row.employees?.name ?? '—'}</td>
                      <td style={{ textAlign:'center' }}><StatusBadge present={row.is_present} /></td>
                      <td style={{ textAlign:'center', fontSize:12 }}>{row.is_present ? ppeStatus(row) : '—'}</td>
                      <td style={{ fontSize:12, color:'var(--muted)' }}>{row.remark || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════ PER EMPLOYEE ══════════ */}
      {tab === 'employee' && (
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <select value={selEmp} onChange={e => setSelEmp(e.target.value)} style={inputSt()}>
              {employees.map(e => <option key={e.id} value={e.id}>{e.employee_id_code} — {e.name}</option>)}
            </select>
            <input type="date" value={empFrom} onChange={e => setEmpFrom(e.target.value)} style={inputSt()} />
            <span style={{ color:'var(--muted)', fontSize:13 }}>ถึง</span>
            <input type="date" value={empTo}   onChange={e => setEmpTo(e.target.value)}   style={inputSt()} />
          </div>
          {empInfo && (
            <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
              <div style={summaryCard}>
                <img src={empInfo.image_url||''} style={{ width:48,height:48,borderRadius:12,objectFit:'cover',border:'2px solid var(--border2)' }} />
                <div>
                  <div style={{ fontWeight:700,fontSize:15,color:'var(--text)' }}>{empInfo.name}</div>
                  <div style={{ fontSize:12,color:'var(--muted)' }}>{empInfo.employee_id_code}</div>
                </div>
              </div>
              <KpiSmall value={empPresent} label="วันที่มา" color="var(--green)" />
              <KpiSmall value={empAbsent}  label="วันที่ขาด" color="var(--red)" />
              <KpiSmall value={(empPresent+empAbsent>0 ? Math.round(empPresent/(empPresent+empAbsent)*100) : 0)+'%'} label="อัตรามา" color="var(--blue)" />
            </div>
          )}
          <div className="card" style={{ overflowX:'auto' }}>
            {empLoading ? <Loader /> : (
              <table style={{ minWidth:420 }}>
                <thead><tr><th>วันที่</th><th style={{textAlign:'center'}}>สถานะ</th><th style={{textAlign:'center'}}>PPE</th><th>หมายเหตุ</th></tr></thead>
                <tbody>
                  {empRows.length === 0 && <EmptyRow cols={4} />}
                  {empRows.map((row, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight:600,fontSize:13,fontFamily:'var(--font-display)' }}>
                        {new Date(row.work_date).toLocaleDateString('th-TH',{weekday:'short',year:'2-digit',month:'short',day:'numeric'})}
                      </td>
                      <td style={{ textAlign:'center' }}><StatusBadge present={row.is_present} /></td>
                      <td style={{ textAlign:'center',fontSize:12 }}>{row.is_present ? ppeStatus(row) : '—'}</td>
                      <td style={{ fontSize:12,color:'var(--muted)' }}>{row.remark||'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════ RANGE SUMMARY ══════════ */}
      {tab === 'range' && (
        <div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:16 }}>
            <input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} style={inputSt()} />
            <span style={{ color:'var(--muted)',fontSize:13 }}>ถึง</span>
            <input type="date" value={rangeTo}   onChange={e => setRangeTo(e.target.value)}   style={inputSt()} />
            <button onClick={fetchRange} style={actionBtn}>🔍 โหลดข้อมูล</button>
          </div>
          <div className="card" style={{ overflowX:'auto' }}>
            {rangeLoading ? <Loader /> : (
              <table style={{ minWidth:480 }}>
                <thead><tr><th></th><th>ID</th><th>ชื่อ</th><th style={{textAlign:'center'}}>วันที่มา</th><th style={{textAlign:'center'}}>วันที่ขาด</th><th style={{textAlign:'center'}}>อัตรามา</th></tr></thead>
                <tbody>
                  {rangeRows.length === 0 && <EmptyRow cols={6} />}
                  {rangeRows.map((row, i) => {
                    const total = row.present + row.absent;
                    const pct   = total > 0 ? Math.round(row.present/total*100) : 0;
                    const c     = pct >= 90 ? 'var(--green)' : pct >= 70 ? 'var(--amber)' : 'var(--red)';
                    return (
                      <tr key={i}>
                        <td><Thumb src={row.emp?.image_url} size={34} /></td>
                        <td style={{ fontWeight:700,color:'var(--blue)',fontSize:12 }}>{row.emp?.employee_id_code}</td>
                        <td style={{ fontWeight:600 }}>{row.emp?.name??'—'}</td>
                        <td style={{ textAlign:'center',fontWeight:700,color:'var(--green)' }}>{row.present}</td>
                        <td style={{ textAlign:'center',fontWeight:700,color:'var(--red)' }}>{row.absent}</td>
                        <td style={{ textAlign:'center' }}>
                          <div style={{ display:'flex',alignItems:'center',gap:6,justifyContent:'center' }}>
                            <div style={{ width:60,height:6,borderRadius:3,background:'var(--border2)',overflow:'hidden' }}>
                              <div style={{ width:pct+'%',height:'100%',background:c,borderRadius:3,transition:'width 0.4s' }} />
                            </div>
                            <span style={{ fontSize:12,fontWeight:700,color:c,minWidth:32 }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════ 4M CHANGES ══════════ */}
      {tab === 'fourm' && (
        <div>
          {/* Filters */}
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:16 }}>
            <input type="date" value={fourmFrom} onChange={e => setFourmFrom(e.target.value)} style={inputSt()} />
            <span style={{ color:'var(--muted)',fontSize:13 }}>ถึง</span>
            <input type="date" value={fourmTo}   onChange={e => setFourmTo(e.target.value)}   style={inputSt()} />
            <select value={fourmLine} onChange={e => setFourmLine(e.target.value)} style={inputSt()}>
              <option value="all">ทุกไลน์</option>
              {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
            <select value={fourmCat} onChange={e => setFourmCat(e.target.value)} style={inputSt()}>
              <option value="all">ทุกประเภท</option>
              {Object.entries(CAT_META).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          {/* KPI summary cards */}
          {!fourmLoading && (
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
              <div style={{ ...kpiSmall, borderColor:'var(--border2)', minWidth:90 }}>
                <div style={{ fontSize:24,fontWeight:800,color:'var(--text)',fontFamily:'var(--font-display)' }}>{fourmRows.length}</div>
                <div style={{ fontSize:11,color:'var(--muted)' }}>ทั้งหมด</div>
              </div>
              {fourmKpi.map(k => (
                <div key={k.cat} style={{ ...kpiSmall, borderColor: k.border, background: k.bg, minWidth:90 }}>
                  <div style={{ fontSize:24,fontWeight:800,color:k.color,fontFamily:'var(--font-display)' }}>{k.count}</div>
                  <div style={{ fontSize:11,color:k.color,fontWeight:600 }}>{k.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Table */}
          <div className="card" style={{ overflowX:'auto' }}>
            {fourmLoading ? <Loader /> : (
              <table style={{ minWidth:560 }}>
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>ไลน์</th>
                    <th style={{textAlign:'center'}}>ประเภท</th>
                    <th>รายละเอียดการเปลี่ยนแปลง</th>
                    <th style={{textAlign:'right',whiteSpace:'nowrap'}}>เวลาบันทึก</th>
                  </tr>
                </thead>
                <tbody>
                  {fourmRows.length === 0 && <EmptyRow cols={5} />}
                  {fourmRows.map(row => {
                    const meta = CAT_META[row.category] ?? { color:'var(--muted)', bg:'transparent', border:'var(--border2)', label: row.category };
                    return (
                      <tr key={row.id}>
                        <td style={{ fontWeight:600, fontSize:13, whiteSpace:'nowrap', fontFamily:'var(--font-display)' }}>
                          {new Date(row.work_date).toLocaleDateString('th-TH',{weekday:'short',year:'2-digit',month:'short',day:'numeric'})}
                        </td>
                        <td style={{ fontSize:13, color:'var(--text2)' }}>{row.line_name}</td>
                        <td style={{ textAlign:'center' }}>
                          <span style={{
                            display:'inline-block',
                            padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700,
                            background: meta.bg, color: meta.color,
                            border:`1px solid ${meta.border}`,
                            whiteSpace:'nowrap',
                          }}>
                            {meta.label}
                          </span>
                        </td>
                        <td style={{ fontSize:13, color:'var(--text)', maxWidth:380 }}>{row.description}</td>
                        <td style={{ fontSize:11, color:'var(--muted)', textAlign:'right', whiteSpace:'nowrap' }}>
                          {row.created_at ? new Date(row.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shared mini-components ─────────────────────────────── */
const Loader = () => <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>กำลังโหลด...</div>;
const EmptyRow = ({ cols }) => <tr><td colSpan={cols} style={{ textAlign:'center', padding:32, color:'var(--muted)' }}>ไม่มีข้อมูล</td></tr>;
const Thumb = ({ src, size=36 }) => <img src={src||''} style={{ width:size,height:size,borderRadius:8,objectFit:'cover',border:'1px solid var(--border2)' }} />;
const StatusBadge = ({ present }) => (
  <span style={{
    padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700,
    background: present ? 'rgba(34,197,94,0.15)' : 'rgba(231,76,60,0.12)',
    color:      present ? 'var(--green)' : 'var(--red)',
    border:     present ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(231,76,60,0.25)',
  }}>
    {present ? '✅ มา' : '❌ ขาด'}
  </span>
);
const KpiSmall = ({ value, label, color }) => (
  <div style={{ ...kpiSmall, borderColor: color }}>
    <div style={{ fontSize:22,fontWeight:800,color,fontFamily:'var(--font-display)' }}>{value}</div>
    <div style={{ fontSize:11,color:'var(--muted)' }}>{label}</div>
  </div>
);

/* ── Style helpers ─────────────────────────────────────── */
const inputSt = (opts={}) => ({
  padding:'7px 12px', borderRadius:8,
  background:'var(--bg3)', border:'1px solid var(--border2)',
  color: opts.accent ? 'var(--accent)' : 'var(--text)',
  fontWeight: opts.accent ? 700 : 400,
  fontSize:13,
});
const filterBtn = (active) => ({
  padding:'6px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer',
  border:      active ? '1px solid var(--accent)' : '1px solid var(--border2)',
  background:  active ? 'rgba(227,25,55,0.12)'   : 'var(--bg3)',
  color:       active ? 'var(--accent)'           : 'var(--text2)',
});
const actionBtn = {
  padding:'7px 18px', borderRadius:8, background:'var(--accent)',
  color:'#fff', border:'none', fontWeight:700, fontSize:13, cursor:'pointer',
};
const summaryCard = {
  display:'flex', alignItems:'center', gap:12,
  padding:'12px 16px', background:'var(--card)',
  border:'1px solid var(--border)', borderRadius:10,
};
const kpiSmall = {
  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
  padding:'10px 20px', background:'var(--card)',
  border:'1px solid', borderRadius:10, minWidth:80,
};
