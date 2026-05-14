import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const TABS = [
  { id: 'daily',    label: '📅 รายวัน' },
  { id: 'employee', label: '👤 รายพนักงาน' },
  { id: 'range',    label: '📊 สรุปช่วงเวลา' },
];

const today = new Date().toISOString().split('T')[0];

function ppeStatus(row) {
  const ok = row.has_helmet && row.has_boots && row.has_gloves;
  return ok ? '✅ ครบ' : '⚠️ ไม่ครบ';
}

export default function Report() {
  const [tab, setTab] = useState('daily');

  // Daily
  const [dailyDate, setDailyDate] = useState(today);
  const [dailyRows, setDailyRows] = useState([]);
  const [dailyFilter, setDailyFilter] = useState('all');
  const [dailyLoading, setDailyLoading] = useState(false);

  // Per employee
  const [employees, setEmployees] = useState([]);
  const [selEmp, setSelEmp] = useState('');
  const [empFrom, setEmpFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().split('T')[0];
  });
  const [empTo, setEmpTo] = useState(today);
  const [empRows, setEmpRows] = useState([]);
  const [empLoading, setEmpLoading] = useState(false);

  // Range summary
  const [rangeFrom, setRangeFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().split('T')[0];
  });
  const [rangeTo, setRangeTo] = useState(today);
  const [rangeRows, setRangeRows] = useState([]);
  const [rangeLoading, setRangeLoading] = useState(false);

  // Load employees list once
  useEffect(() => {
    supabase.from('employees').select('id, name, employee_id_code, image_url')
      .eq('is_active', true).order('employee_id_code')
      .then(({ data }) => {
        setEmployees(data || []);
        if (data?.length) setSelEmp(data[0].id);
      });
  }, []);

  // ── Fetch daily ──────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'daily') return;
    setDailyLoading(true);
    supabase.from('daily_production_logs')
      .select('*, employees(id, name, employee_id_code, image_url)')
      .eq('work_date', dailyDate)
      .order('is_present', { ascending: false })
      .then(({ data }) => { setDailyRows(data || []); setDailyLoading(false); });
  }, [tab, dailyDate]);

  // ── Fetch per-employee ───────────────────────────────────
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

  // ── Fetch range summary ──────────────────────────────────
  const fetchRange = async () => {
    setRangeLoading(true);
    const { data } = await supabase.from('daily_production_logs')
      .select('employee_id, is_present, employees(id, name, employee_id_code, image_url)')
      .gte('work_date', rangeFrom).lte('work_date', rangeTo);

    // Group by employee
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

  // ── Helpers ──────────────────────────────────────────────
  const filteredDaily = dailyRows.filter(r =>
    dailyFilter === 'all' ? true :
    dailyFilter === 'present' ? r.is_present :
    !r.is_present
  );

  const empInfo = employees.find(e => e.id === selEmp);
  const empPresent = empRows.filter(r => r.is_present).length;
  const empAbsent  = empRows.filter(r => !r.is_present).length;

  return (
    <div className="page-content">
      <h2 style={{ margin: '0 0 16px', fontFamily: 'var(--font-display)', fontSize: 'clamp(16px, 3vw, 22px)', color: 'var(--text)' }}>
        📋 รายงานการมาทำงาน
      </h2>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
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

      {/* ════════════ TAB: DAILY ════════════ */}
      {tab === 'daily' && (
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <input type="date" value={dailyDate}
              onChange={e => setDailyDate(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--accent)', fontWeight: 700, fontSize: 14 }}
            />
            {['all','present','absent'].map(f => (
              <button key={f} onClick={() => setDailyFilter(f)} style={{
                padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: dailyFilter === f ? '1px solid var(--accent)' : '1px solid var(--border2)',
                background: dailyFilter === f ? 'rgba(227,25,55,0.12)' : 'var(--bg3)',
                color: dailyFilter === f ? 'var(--accent)' : 'var(--text2)',
              }}>
                {f === 'all' ? `ทั้งหมด (${dailyRows.length})` :
                 f === 'present' ? `✅ มาทำงาน (${dailyRows.filter(r=>r.is_present).length})` :
                 `❌ ขาดงาน (${dailyRows.filter(r=>!r.is_present).length})`}
              </button>
            ))}
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            {dailyLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>กำลังโหลด...</div>
            ) : (
              <table style={{ minWidth: 540 }}>
                <thead>
                  <tr>
                    <th></th>
                    <th>ID</th>
                    <th>ชื่อ</th>
                    <th style={{ textAlign: 'center' }}>สถานะ</th>
                    <th style={{ textAlign: 'center' }}>PPE</th>
                    <th>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDaily.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>ไม่มีข้อมูล</td></tr>
                  )}
                  {filteredDaily.map(row => (
                    <tr key={row.id}>
                      <td>
                        <img src={row.employees?.image_url || ''}
                          style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border2)' }} />
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--blue)', fontSize: 12 }}>
                        {row.employees?.employee_id_code}
                      </td>
                      <td style={{ fontWeight: 600 }}>{row.employees?.name ?? '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: row.is_present ? 'rgba(34,197,94,0.15)' : 'rgba(231,76,60,0.12)',
                          color: row.is_present ? 'var(--green)' : 'var(--red)',
                          border: row.is_present ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(231,76,60,0.25)',
                        }}>
                          {row.is_present ? '✅ มา' : '❌ ขาด'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontSize: 12 }}>
                        {row.is_present ? ppeStatus(row) : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{row.remark || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ════════════ TAB: PER EMPLOYEE ════════════ */}
      {tab === 'employee' && (
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <select value={selEmp} onChange={e => setSelEmp(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', fontSize: 13, minWidth: 200 }}>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.employee_id_code} — {e.name}</option>
              ))}
            </select>
            <input type="date" value={empFrom} onChange={e => setEmpFrom(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', fontSize: 13 }} />
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>ถึง</span>
            <input type="date" value={empTo} onChange={e => setEmpTo(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', fontSize: 13 }} />
          </div>

          {/* Employee summary card */}
          {empInfo && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={summaryCard}>
                <img src={empInfo.image_url || ''} style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', border: '2px solid var(--border2)' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{empInfo.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{empInfo.employee_id_code}</div>
                </div>
              </div>
              <div style={{ ...kpiSmall, borderColor: 'var(--green)' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)', fontFamily: 'var(--font-display)' }}>{empPresent}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>วันที่มา</div>
              </div>
              <div style={{ ...kpiSmall, borderColor: 'var(--red)' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--red)', fontFamily: 'var(--font-display)' }}>{empAbsent}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>วันที่ขาด</div>
              </div>
              <div style={{ ...kpiSmall, borderColor: 'var(--blue)' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--blue)', fontFamily: 'var(--font-display)' }}>
                  {empPresent + empAbsent > 0 ? Math.round(empPresent / (empPresent + empAbsent) * 100) : 0}%
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>อัตรามา</div>
              </div>
            </div>
          )}

          <div className="card" style={{ overflowX: 'auto' }}>
            {empLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>กำลังโหลด...</div>
            ) : (
              <table style={{ minWidth: 420 }}>
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th style={{ textAlign: 'center' }}>สถานะ</th>
                    <th style={{ textAlign: 'center' }}>PPE</th>
                    <th>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {empRows.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>ไม่มีข้อมูลในช่วงนี้</td></tr>
                  )}
                  {empRows.map((row, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-display)' }}>
                        {new Date(row.work_date).toLocaleDateString('th-TH', { weekday: 'short', year: '2-digit', month: 'short', day: 'numeric' })}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: row.is_present ? 'rgba(34,197,94,0.15)' : 'rgba(231,76,60,0.12)',
                          color: row.is_present ? 'var(--green)' : 'var(--red)',
                          border: row.is_present ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(231,76,60,0.25)',
                        }}>
                          {row.is_present ? '✅ มา' : '❌ ขาด'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontSize: 12 }}>
                        {row.is_present ? ppeStatus(row) : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{row.remark || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ════════════ TAB: RANGE SUMMARY ════════════ */}
      {tab === 'range' && (
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', fontSize: 13 }} />
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>ถึง</span>
            <input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', fontSize: 13 }} />
            <button onClick={fetchRange}
              style={{ padding: '7px 18px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              🔍 โหลดข้อมูล
            </button>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            {rangeLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>กำลังโหลด...</div>
            ) : (
              <table style={{ minWidth: 480 }}>
                <thead>
                  <tr>
                    <th></th>
                    <th>ID</th>
                    <th>ชื่อ</th>
                    <th style={{ textAlign: 'center' }}>วันที่มา</th>
                    <th style={{ textAlign: 'center' }}>วันที่ขาด</th>
                    <th style={{ textAlign: 'center' }}>อัตรามา</th>
                  </tr>
                </thead>
                <tbody>
                  {rangeRows.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>ไม่มีข้อมูล</td></tr>
                  )}
                  {rangeRows.map((row, i) => {
                    const total = row.present + row.absent;
                    const pct   = total > 0 ? Math.round(row.present / total * 100) : 0;
                    const color = pct >= 90 ? 'var(--green)' : pct >= 70 ? 'var(--amber)' : 'var(--red)';
                    return (
                      <tr key={i}>
                        <td>
                          <img src={row.emp?.image_url || ''}
                            style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border2)' }} />
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--blue)', fontSize: 12 }}>
                          {row.emp?.employee_id_code}
                        </td>
                        <td style={{ fontWeight: 600 }}>{row.emp?.name ?? '—'}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--green)' }}>{row.present}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--red)' }}>{row.absent}</td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                            <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--border2)', overflow: 'hidden' }}>
                              <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 32 }}>{pct}%</span>
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
    </div>
  );
}

const summaryCard = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '12px 16px', background: 'var(--card)',
  border: '1px solid var(--border)', borderRadius: 10,
};

const kpiSmall = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: '10px 20px', background: 'var(--card)',
  border: '1px solid', borderRadius: 10, minWidth: 80,
};
