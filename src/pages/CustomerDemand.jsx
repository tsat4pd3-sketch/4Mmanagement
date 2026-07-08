import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

/* ─── CUSTOMER DEMAND — Forecast & Shipping Orders ────────────────────────
   Sales อัพโหลด Excel 2 แบบ: (1) Forecast ล่วงหน้าจากลูกค้า (2) Order + รอบเวลาส่งงาน
   → ระบบทำ Forecast Planner (เทียบ forecast/order/กำลังผลิต) และ
     Shipping Time Chart ให้ฝ่าย Logistic ติดตามการส่งงานรายวัน */

const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 16,
};
const btn = (active) => ({
  padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
  background: active ? 'var(--accent)' : 'var(--bg2)', color: active ? '#08130a' : 'var(--text2)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
});
const inputSt = {
  padding: '8px 10px', borderRadius: 8, fontSize: 13, background: 'var(--bg2)',
  border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-body)',
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthFirst = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
const monthLabel = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${TH[m - 1]} ${y + 543}`;
};
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

/* ── Excel cell parsers — รองรับรูปแบบวันที่/เวลา ที่เจอบ่อยในไฟล์ลูกค้า ── */
const MONTH_EN = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function excelSerialToDate(n) {
  const d = new Date(Math.round((n - 25569) * 86400000));
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function parseDateCell(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'number' && v > 20000 && v < 80000) return excelSerialToDate(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);            // yyyy-mm[-dd]
  if (m) return new Date(+m[1], +m[2] - 1, +(m[3] || 1));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);                // dd/mm/yyyy (แบบไทย, รองรับ พ.ศ.)
  if (m) { let y = +m[3]; if (y < 100) y += 2000; if (y > 2400) y -= 543; return new Date(y, +m[2] - 1, +m[1]); }
  m = s.match(/^(\d{1,2})\/(\d{4})$/);                             // mm/yyyy
  if (m) { let y = +m[2]; if (y > 2400) y -= 543; return new Date(y, +m[1] - 1, 1); }
  m = s.toLowerCase().match(/^([a-z]{3,9})[\s.'-]*(\d{2,4})$/);    // Jan-26 / January 2026
  if (m && MONTH_EN[m[1].slice(0, 3)] != null) { let y = +m[2]; if (y < 100) y += 2000; if (y > 2400) y -= 543; return new Date(y, MONTH_EN[m[1].slice(0, 3)], 1); }
  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function parseTimeCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 1440);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  if (v instanceof Date && !isNaN(v)) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  const m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (m) return `${String(+m[1] % 24).padStart(2, '0')}:${m[2]}`;
  return null;
}
const numCell = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };

/* คอลัมน์ที่ map ได้ + ตัวเดารายชื่อหัวตาราง */
const FIELD_DEFS = {
  forecast: [
    { key: 'mat_no',   label: 'MAT No. *',   guess: /mat|material|part\s*no|p\/?n|item|รหัส/i },
    { key: 'part_name', label: 'ชื่อพาร์ท',  guess: /name|desc|ชื่อ|รายการ/i },
    { key: 'customer', label: 'ลูกค้า',      guess: /cust|ลูกค้า/i },
    { key: 'period',   label: 'เดือน',       guess: /month|period|เดือน/i },
    { key: 'qty',      label: 'จำนวน',       guess: /qty|quan|จำนวน|pcs|amount|volume/i },
  ],
  orders: [
    { key: 'order_no', label: 'เลขที่ Order', guess: /order|p\.?o\b|po\s*no|เลขที่/i },
    { key: 'mat_no',   label: 'MAT No. *',    guess: /mat|material|part\s*no|p\/?n|item|รหัส/i },
    { key: 'part_name', label: 'ชื่อพาร์ท',   guess: /name|desc|ชื่อ|รายการ/i },
    { key: 'customer', label: 'ลูกค้า',       guess: /cust|ลูกค้า/i },
    { key: 'qty',      label: 'จำนวน *',      guess: /qty|quan|จำนวน|pcs|amount/i },
    { key: 'due_date', label: 'วันที่ส่ง *',  guess: /due|deliv|ship.*date|ส่งมอบ|วันที่ส่ง|^date/i },
    { key: 'ship_time', label: 'รอบเวลาส่ง',  guess: /time|เวลา|รอบ/i },
  ],
};

/* ─── Upload Tab ──────────────────────────────────────────────────────────── */
function UploadTab({ canUpload, fullName, onImported }) {
  const [kind, setKind] = useState('forecast');   // 'forecast' | 'orders'
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);     // [{ idx, text }]
  const [rows, setRows] = useState([]);           // data rows (array of arrays)
  const [mapping, setMapping] = useState({});     // fieldKey → column idx (-1 = ไม่ใช้)
  const [wideMode, setWideMode] = useState(false);
  const [monthCols, setMonthCols] = useState([]); // [{ idx, month }] สำหรับ wide mode
  const [saving, setSaving] = useState(false);
  const [batches, setBatches] = useState([]);

  const loadBatches = useCallback(async () => {
    const { data } = await supabaseDR.from('demand_upload_batches').select('*').order('uploaded_at', { ascending: false }).limit(30);
    setBatches(data || []);
  }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  const handleFile = async (file, kindNow) => {
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      // หัวตาราง = แถวแรกที่มีข้อมูล ≥ 2 ช่อง
      const hIdx = matrix.findIndex(r => r.filter(c => String(c).trim() !== '').length >= 2);
      if (hIdx < 0) { toast.error('ไม่พบหัวตารางในไฟล์'); return; }
      const hd = matrix[hIdx].map((text, idx) => ({ idx, text: String(text).trim() }));
      const dataRows = matrix.slice(hIdx + 1).filter(r => r.some(c => String(c).trim() !== ''));
      setFileName(file.name);
      setHeaders(hd);
      setRows(dataRows);
      // auto-guess mapping จากชื่อหัวคอลัมน์
      const map = {};
      FIELD_DEFS[kindNow].forEach(f => {
        const hit = hd.find(h => h.text && f.guess.test(h.text));
        map[f.key] = hit ? hit.idx : -1;
      });
      setMapping(map);
      // forecast แบบ wide: หัวคอลัมน์ที่ parse เป็นเดือนได้ (เช่น Jan-26, 2026-07) → คอลัมน์ละเดือน
      const mc = hd
        .map(h => ({ idx: h.idx, d: parseDateCell(h.text) }))
        .filter(x => x.d && x.idx !== map.mat_no && x.idx !== map.part_name && x.idx !== map.customer)
        .map(x => ({ idx: x.idx, month: monthFirst(x.d), label: hd[x.idx].text }));
      setMonthCols(mc);
      setWideMode(kindNow === 'forecast' && mc.length >= 2);
      toast.info(`อ่านไฟล์แล้ว ${dataRows.length} แถว — ตรวจ mapping แล้วกดนำเข้า`);
    } catch (err) { toast.error('อ่านไฟล์ไม่สำเร็จ: ' + err.message); }
  };

  const buildRecords = () => {
    const out = [];
    let skipped = 0;
    const get = (r, key) => mapping[key] >= 0 ? r[mapping[key]] : '';
    rows.forEach(r => {
      const mat = String(get(r, 'mat_no') ?? '').trim();
      if (!mat) { skipped++; return; }
      const base = {
        mat_no: mat,
        part_name: String(get(r, 'part_name') ?? '').trim() || null,
        customer: String(get(r, 'customer') ?? '').trim() || null,
      };
      if (kind === 'forecast') {
        if (wideMode) {
          monthCols.forEach(mc => {
            const q = numCell(r[mc.idx]);
            if (q > 0) out.push({ ...base, period_month: mc.month, qty: q });
          });
        } else {
          const d = parseDateCell(get(r, 'period'));
          const q = numCell(get(r, 'qty'));
          if (!d || q <= 0) { skipped++; return; }
          out.push({ ...base, period_month: monthFirst(d), qty: q });
        }
      } else {
        const d = parseDateCell(get(r, 'due_date'));
        const q = numCell(get(r, 'qty'));
        if (!d || q <= 0) { skipped++; return; }
        out.push({
          ...base,
          order_no: String(get(r, 'order_no') ?? '').trim() || null,
          qty: q, due_date: dateStr(d),
          ship_time: parseTimeCell(get(r, 'ship_time')),
        });
      }
    });
    return { records: out, skipped };
  };

  const doImport = async () => {
    if (mapping.mat_no < 0) { toast.error('ต้อง map คอลัมน์ MAT No. ก่อน'); return; }
    if (kind === 'orders' && (mapping.due_date < 0 || mapping.qty < 0)) { toast.error('Order ต้อง map จำนวน และ วันที่ส่ง'); return; }
    if (kind === 'forecast' && !wideMode && (mapping.period < 0 || mapping.qty < 0)) { toast.error('Forecast ต้อง map เดือน และ จำนวน (หรือใช้โหมดหลายคอลัมน์เดือน)'); return; }
    const { records, skipped } = buildRecords();
    if (!records.length) { toast.error('ไม่มีแถวที่นำเข้าได้ — ตรวจ mapping อีกครั้ง'); return; }
    setSaving(true);
    try {
      const { data: batch, error: e1 } = await supabaseDR.from('demand_upload_batches')
        .insert({ kind, file_name: fileName, row_count: records.length, uploaded_by: fullName || 'Sales' })
        .select().single();
      if (e1) throw e1;
      const table = kind === 'forecast' ? 'customer_forecasts' : 'customer_shipping_orders';
      for (let i = 0; i < records.length; i += 500) {
        const { error: e2 } = await supabaseDR.from(table).insert(records.slice(i, i + 500).map(x => ({ ...x, batch_id: batch.id })));
        if (e2) throw e2;
      }
      toast.success(`✅ นำเข้า ${records.length} แถวสำเร็จ${skipped ? ` (ข้าม ${skipped} แถวที่ข้อมูลไม่ครบ)` : ''}`);
      setHeaders([]); setRows([]); setFileName('');
      await loadBatches();
      onImported?.();
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const deleteBatch = async (b) => {
    if (!window.confirm(`ลบชุดข้อมูล "${b.file_name}" (${b.row_count} แถว)? ข้อมูลที่นำเข้าจากไฟล์นี้จะถูกลบทั้งหมด`)) return;
    const { error } = await supabaseDR.from('demand_upload_batches').delete().eq('id', b.id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบชุดข้อมูลแล้ว');
    await loadBatches();
    onImported?.();
  };

  const fields = FIELD_DEFS[kind].filter(f => !(kind === 'forecast' && wideMode && (f.key === 'period' || f.key === 'qty')));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!canUpload && (
        <div style={{ ...card, borderColor: 'rgba(245,158,11,0.4)', fontSize: 13, color: '#f59e0b' }}>
          👁 โหมดดูอย่างเดียว — การอัพโหลดทำได้เฉพาะ role: Sale / Manager / Admin
        </div>
      )}
      {canUpload && (
        <div style={card}>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', marginBottom: 12, fontFamily: 'var(--font-display)' }}>📤 อัพโหลดไฟล์จากลูกค้า</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {[{ k: 'forecast', label: '📈 Forecast ล่วงหน้า' }, { k: 'orders', label: '🚚 Order + รอบส่งงาน' }].map(t => (
              <button key={t.k} onClick={() => { setKind(t.k); setHeaders([]); setRows([]); setFileName(''); }} style={btn(kind === t.k)}>{t.label}</button>
            ))}
            <label style={{ ...btn(false), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              📂 เลือกไฟล์ Excel/CSV
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={e => { handleFile(e.target.files?.[0], kind); e.target.value = ''; }} />
            </label>
            {fileName && <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--muted)' }}>📄 {fileName} · {rows.length} แถว</span>}
          </div>

          {headers.length > 0 && (
            <>
              {kind === 'forecast' && monthCols.length >= 2 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', marginBottom: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={wideMode} onChange={e => setWideMode(e.target.checked)} />
                  ไฟล์เป็นแบบ "เดือนละคอลัมน์" — พบคอลัมน์เดือน {monthCols.length} เดือน ({monthCols.slice(0, 4).map(m => m.label).join(', ')}{monthCols.length > 4 ? ' …' : ''})
                </label>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                {fields.map(f => (
                  <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>{f.label}</span>
                    <select value={mapping[f.key] ?? -1} onChange={e => setMapping(m => ({ ...m, [f.key]: Number(e.target.value) }))} style={{ ...inputSt, minWidth: 140 }}>
                      <option value={-1}>— ไม่ใช้ —</option>
                      {headers.map(h => <option key={h.idx} value={h.idx}>{h.text || `(คอลัมน์ ${h.idx + 1})`}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {/* preview 5 แถวแรก */}
              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 500 }}>
                  <thead><tr style={{ background: 'var(--bg2)' }}>
                    {headers.map(h => <th key={h.idx} style={{ padding: '6px 10px', color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h.text || `(${h.idx + 1})`}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {headers.map(h => <td key={h.idx} style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{r[h.idx] instanceof Date ? dateStr(r[h.idx]) : String(r[h.idx] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={doImport} disabled={saving}
                style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-body)', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'กำลังนำเข้า...' : `⬆ นำเข้าข้อมูล ${kind === 'forecast' ? 'Forecast' : 'Orders'}`}
              </button>
            </>
          )}
        </div>
      )}

      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', marginBottom: 10, fontFamily: 'var(--font-display)' }}>🗂 ประวัติการอัพโหลด</div>
        {batches.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีการอัพโหลด</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {batches.map(b => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.kind === 'forecast' ? '📈' : '🚚'} <strong>{b.file_name || '(ไม่มีชื่อไฟล์)'}</strong>
                  <span style={{ color: 'var(--muted)' }}> · {b.row_count} แถว · {b.uploaded_by} · {new Date(b.uploaded_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</span>
                </div>
                {canUpload && (
                  <button onClick={() => deleteBatch(b)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', flexShrink: 0, fontFamily: 'var(--font-body)' }}>🗑 ลบ</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Forecast Planner Tab ────────────────────────────────────────────────── */
function PlannerTab({ refreshKey }) {
  const [horizon, setHorizon] = useState(3);          // จำนวนเดือนล่วงหน้า
  const [forecasts, setForecasts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [ctByMat, setCtByMat] = useState({});
  const [focusMonth, setFocusMonth] = useState(() => monthFirst(new Date()));

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: horizon }, (_, i) => monthFirst(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  }, [horizon]);

  useEffect(() => {
    (async () => {
      const from = months[0];
      const toD = new Date(months[months.length - 1]);
      const to = monthFirst(new Date(toD.getFullYear(), toD.getMonth() + 1, 1));
      const [{ data: fc }, { data: od }] = await Promise.all([
        supabaseDR.from('customer_forecasts').select('*').gte('period_month', from).lt('period_month', to),
        supabaseDR.from('customer_shipping_orders').select('*').gte('due_date', from).lt('due_date', to),
      ]);
      setForecasts(fc || []);
      setOrders(od || []);
      const mats = [...new Set([...(fc || []), ...(od || [])].map(x => x.mat_no))];
      if (mats.length) {
        const { data: prods } = await supabaseDR.from('dr_products').select('mat_no, cycle_time_sec').in('mat_no', mats);
        const m = {};
        (prods || []).forEach(p => { m[p.mat_no] = p.cycle_time_sec || 0; });
        setCtByMat(m);
      } else setCtByMat({});
    })();
  }, [months, refreshKey]);

  const chartData = useMemo(() => months.map(m => {
    const fq = forecasts.filter(f => f.period_month === m).reduce((s, f) => s + Number(f.qty), 0);
    const oq = orders.filter(o => o.due_date.slice(0, 7) === m.slice(0, 7)).reduce((s, o) => s + Number(o.qty), 0);
    return { month: monthLabel(m), Forecast: fq, Orders: oq };
  }), [months, forecasts, orders]);

  // ตารางราย mat_no ของเดือนที่เลือก — forecast vs order จริง + ภาระชั่วโมงผลิต
  const matRows = useMemo(() => {
    const map = {};
    forecasts.filter(f => f.period_month === focusMonth).forEach(f => {
      const r = map[f.mat_no] = map[f.mat_no] || { mat_no: f.mat_no, part_name: f.part_name, customer: f.customer, forecast: 0, ordered: 0 };
      r.forecast += Number(f.qty);
      if (!r.part_name) r.part_name = f.part_name;
    });
    orders.filter(o => o.due_date.slice(0, 7) === focusMonth.slice(0, 7)).forEach(o => {
      const r = map[o.mat_no] = map[o.mat_no] || { mat_no: o.mat_no, part_name: o.part_name, customer: o.customer, forecast: 0, ordered: 0 };
      r.ordered += Number(o.qty);
      if (!r.part_name) r.part_name = o.part_name;
    });
    return Object.values(map).map(r => {
      const ct = ctByMat[r.mat_no] || 0;
      const planQty = Math.max(r.forecast, r.ordered);
      return { ...r, ct, loadHours: ct > 0 ? (planQty * ct) / 3600 : null, coverage: r.forecast > 0 ? (r.ordered / r.forecast) * 100 : null };
    }).sort((a, b) => (b.loadHours || 0) - (a.loadHours || 0) || b.forecast - a.forecast);
  }, [forecasts, orders, focusMonth, ctByMat]);

  const totalLoadHours = matRows.reduce((s, r) => s + (r.loadHours || 0), 0);
  const noCtCount = matRows.filter(r => !r.ct).length;
  // กำลังผลิตหยาบ ๆ: วันทำงาน ~26 วัน/เดือน × (กะเช้า 8.75 + กะดึก 8.75 ชม.) ต่อ 1 ไลน์
  const HOURS_PER_DAY = 17.5;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>ช่วงพยากรณ์:</span>
        {[3, 6, 12].map(h => <button key={h} onClick={() => setHorizon(h)} style={btn(horizon === h)}>{h} เดือน</button>)}
      </div>

      {/* กราฟ Forecast vs Orders รายเดือน */}
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', marginBottom: 10, fontFamily: 'var(--font-display)' }}>📊 Forecast vs Order จริง (ชิ้น/เดือน)</div>
        {chartData.every(d => !d.Forecast && !d.Orders) ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีข้อมูลในช่วงนี้ — อัพโหลดที่แท็บ 📤 อัพโหลด</div>
        ) : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Forecast" fill="#4d9fff" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Orders" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ตารางราย mat_no ต่อเดือน + ภาระการผลิต */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>🧠 แผนภาระการผลิตรายพาร์ท</div>
          <select value={focusMonth} onChange={e => setFocusMonth(e.target.value)} style={inputSt}>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {[
            { label: 'พาร์ทที่มี demand', value: matRows.length, icon: '🔩' },
            { label: 'ภาระรวม (ชม.เครื่อง)', value: fmt(totalLoadHours), icon: '⏱' },
            { label: `≈ วันผลิต (${HOURS_PER_DAY} ชม./วัน/ไลน์)`, value: fmt(totalLoadHours / HOURS_PER_DAY), icon: '📅' },
            ...(noCtCount ? [{ label: 'พาร์ทไม่มี cycle time', value: noCtCount, icon: '⚠️', warn: true }] : []),
          ].map(c => (
            <div key={c.label} style={{ flex: '1 1 150px', background: 'var(--bg2)', border: `1px solid ${c.warn ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`, borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{c.icon} {c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: c.warn ? '#f59e0b' : 'var(--text)', fontFamily: 'var(--font-display)' }}>{c.value}</div>
            </div>
          ))}
        </div>
        {matRows.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่มีข้อมูลเดือนนี้</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr style={{ background: 'var(--bg2)' }}>
                {['พาร์ท', 'ลูกค้า', 'Forecast', 'Order จริง', 'Coverage', 'ภาระ (ชม.)'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: h === 'พาร์ท' || h === 'ลูกค้า' ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {matRows.map(r => (
                  <tr key={r.mat_no}>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#0ea5e9' }}>{r.mat_no}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.part_name || ''}</div>
                    </td>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)' }}>{r.customer || '—'}</td>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#4d9fff' }}>{fmt(r.forecast)}</td>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#22c55e' }}>{fmt(r.ordered)}</td>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 12, fontWeight: 800, textAlign: 'right', color: r.coverage == null ? 'var(--muted)' : r.coverage > 110 ? '#ef4444' : r.coverage >= 80 ? '#22c55e' : '#f59e0b' }}>
                      {r.coverage == null ? '—' : `${fmt(r.coverage)}%`}
                    </td>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 12, fontWeight: 700, textAlign: 'right', color: r.loadHours == null ? '#f59e0b' : 'var(--text)' }}>
                      {r.loadHours == null ? 'ไม่มี CT' : fmt(r.loadHours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
          Coverage = Order จริง ÷ Forecast · เกิน 110% (แดง) = ลูกค้าสั่งเกินที่พยากรณ์ ควรเช็คกำลังผลิต · ต่ำกว่า 80% (เหลือง) = order ยังมาไม่ครบตาม forecast
        </div>
      </div>
    </div>
  );
}

/* ─── Shipping Time Chart Tab (Logistic) ──────────────────────────────────── */
const SHIP_STATUS = {
  pending:  { label: '🕐 รอเตรียม',  color: '#f59e0b', next: 'prepared', nextLabel: '📦 เตรียมของแล้ว' },
  prepared: { label: '📦 เตรียมแล้ว', color: '#0ea5e9', next: 'shipped',  nextLabel: '🚚 ส่งงานแล้ว' },
  shipped:  { label: '✅ ส่งแล้ว',    color: '#22c55e', next: null,       nextLabel: null },
};
function ShippingTab({ fullName, refreshKey }) {
  const [day, setDay] = useState(todayStr());
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabaseDR.from('customer_shipping_orders').select('*').eq('due_date', day).order('ship_time', { ascending: true, nullsFirst: false });
    setOrders(data || []);
  }, [day]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const shiftDay = (n) => {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + n);
    setDay(dateStr(d));
  };

  const advance = async (o) => {
    const st = SHIP_STATUS[o.status] || SHIP_STATUS.pending;
    if (!st.next) return;
    setBusy(o.id);
    const payload = { status: st.next };
    if (st.next === 'shipped') { payload.shipped_at = new Date().toISOString(); payload.shipped_by = fullName || 'Logistic'; }
    const { error } = await supabaseDR.from('customer_shipping_orders').update(payload).eq('id', o.id);
    if (error) toast.error(error.message);
    else { toast.success(st.next === 'shipped' ? `🚚 ส่ง ${o.mat_no} แล้ว` : `📦 เตรียม ${o.mat_no} แล้ว`); await load(); }
    setBusy(null);
  };

  const now = new Date();
  const isToday = day === todayStr();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const timeMins = (t) => t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null;
  const isOverdue = (o) => isToday && o.status !== 'shipped' && timeMins(o.ship_time) != null && timeMins(o.ship_time) < nowMins;

  const byCustomer = useMemo(() => {
    const m = {};
    orders.forEach(o => { (m[o.customer || '— ไม่ระบุลูกค้า —'] = m[o.customer || '— ไม่ระบุลูกค้า —'] || []).push(o); });
    return m;
  }, [orders]);

  const shippedCount = orders.filter(o => o.status === 'shipped').length;
  const overdueCount = orders.filter(isOverdue).length;
  // timeline 06:00–22:00 (ช่วงรอบส่งปกติ) — ถ้ามีรอบนอกช่วงจะขยายให้เอง
  const mins = orders.map(o => timeMins(o.ship_time)).filter(v => v != null);
  const tStart = Math.min(6 * 60, ...(mins.length ? [Math.floor(Math.min(...mins) / 60) * 60] : [6 * 60]));
  const tEnd = Math.max(22 * 60, ...(mins.length ? [Math.ceil((Math.max(...mins) + 30) / 60) * 60] : [22 * 60]));
  const span = tEnd - tStart;
  const hourMarks = [];
  for (let h = tStart / 60; h <= tEnd / 60; h++) hourMarks.push(h);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => shiftDay(-1)} style={btn(false)}>◀</button>
        <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} style={inputSt} />
        <button onClick={() => shiftDay(1)} style={btn(false)}>▶</button>
        {!isToday && <button onClick={() => setDay(todayStr())} style={btn(true)}>วันนี้</button>}
        <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
          🚚 {orders.length} รอบส่ง · ✅ {shippedCount} ส่งแล้ว
          {overdueCount > 0 && <span style={{ color: '#ef4444' }}> · 🔴 {overdueCount} เลยเวลา</span>}
        </span>
      </div>

      {orders.length === 0 ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          ไม่มีรอบส่งงานวันที่ {day} — อัพโหลด Order ที่แท็บ 📤 อัพโหลด
        </div>
      ) : (
        <>
          {/* Shipping time chart — บล็อกตามเวลารอบส่ง แยกแถวตามลูกค้า */}
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border2)', fontWeight: 800, fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
              🕐 Shipping Time Chart — {day}
            </div>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)' }}>
              <div style={{ width: 120, flexShrink: 0, padding: '4px 10px', fontSize: 9, fontWeight: 700, color: 'var(--muted)', borderRight: '1px solid var(--border2)' }}>ลูกค้า</div>
              <div style={{ flex: 1, position: 'relative', height: 20 }}>
                {hourMarks.map(h => (
                  <span key={h} style={{ position: 'absolute', left: `${((h * 60 - tStart) / span) * 100}%`, fontSize: 8, color: 'var(--muted)', transform: 'translateX(-50%)', top: 4 }}>
                    {String(h).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
            </div>
            {Object.entries(byCustomer).map(([cust, list]) => (
              <div key={cust} style={{ display: 'flex', minHeight: 40, borderTop: '1px solid var(--border)' }}>
                <div style={{ width: 120, flexShrink: 0, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', borderRight: '1px solid var(--border2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', alignSelf: 'center' }}>
                  {cust}
                  <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 600 }}>{list.length} รอบ</div>
                </div>
                <div style={{ flex: 1, position: 'relative', minHeight: 40 }}>
                  {hourMarks.map(h => (
                    <div key={h} style={{ position: 'absolute', top: 0, bottom: 0, left: `${((h * 60 - tStart) / span) * 100}%`, width: 1, background: 'var(--border)' }} />
                  ))}
                  {isToday && nowMins >= tStart && nowMins <= tEnd && (
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${((nowMins - tStart) / span) * 100}%`, width: 1.5, background: 'rgba(77,159,255,0.8)', zIndex: 2 }} />
                  )}
                  {list.map(o => {
                    const tm = timeMins(o.ship_time);
                    const st = SHIP_STATUS[o.status] || SHIP_STATUS.pending;
                    const od = isOverdue(o);
                    const color = od ? '#ef4444' : st.color;
                    const left = tm == null ? 0 : ((tm - tStart) / span) * 100;
                    return (
                      <div key={o.id}
                        title={`${o.ship_time || 'ไม่ระบุเวลา'} · ${o.order_no || ''} ${o.mat_no} · ${fmt(o.qty)} ชิ้น · ${st.label}${od ? ' · 🔴 เลยเวลาแล้วยังไม่ส่ง' : ''}`}
                        style={{
                          position: 'absolute', top: 5, bottom: 5, left: `calc(${Math.min(left, 96)}% )`, minWidth: 54, maxWidth: 110,
                          background: `${color}22`, border: `1.5px solid ${color}cc`, borderRadius: 6, zIndex: 1,
                          display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 6px', overflow: 'hidden', cursor: 'default',
                          boxShadow: od ? `0 0 6px ${color}55` : 'none',
                        }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {o.ship_time || '—'} {o.status === 'shipped' ? '✅' : od ? '🔴' : ''}
                        </div>
                        <div style={{ fontSize: 8, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace' }}>{o.mat_no}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* รายการรอบส่ง + ปุ่มอัปเดตสถานะ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {orders.map(o => {
              const st = SHIP_STATUS[o.status] || SHIP_STATUS.pending;
              const od = isOverdue(o);
              return (
                <div key={o.id} style={{ background: `${od ? '#ef4444' : st.color}0f`, border: `1px solid ${od ? '#ef4444' : st.color}55`, borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ height: 4, background: od ? '#ef4444' : st.color }} />
                  <div style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)' }}>🕐 {o.ship_time || 'ไม่ระบุเวลา'}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.12)', color: od ? '#ef4444' : st.color }}>{od ? '🔴 เลยเวลา' : st.label}</span>
                    </div>
                    <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#0ea5e9', fontWeight: 700, marginTop: 4 }}>{o.mat_no}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{o.part_name || ''}{o.order_no ? ` · ${o.order_no}` : ''}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{fmt(o.qty)} <span style={{ fontSize: 10, color: 'var(--muted)' }}>ชิ้น</span></span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6' }}>{o.customer || ''}</span>
                    </div>
                    {o.shipped_by && <div style={{ fontSize: 10, color: '#22c55e', marginTop: 4 }}>✓ {o.shipped_by} · {o.shipped_at ? new Date(o.shipped_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : ''}</div>}
                    {st.next && (
                      <button onClick={() => advance(o)} disabled={busy === o.id}
                        style={{ marginTop: 8, width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: 'rgba(0,0,0,0.12)', color: st.color, border: `1px solid ${st.color}55`, fontFamily: 'var(--font-body)' }}>
                        {busy === o.id ? '...' : st.nextLabel}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function CustomerDemand() {
  const { role, fullName } = useContext(UserContext);
  const [tab, setTab] = useState('planner');
  const [refreshKey, setRefreshKey] = useState(0);
  const canUpload = ['admin', 'manager', 'sale'].includes(role);

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 'min(96vw, 1600px)', margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          🚚 Customer Demand — Forecast & Shipping
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          Sales อัพโหลด Forecast/Order จากลูกค้า → ระบบวางแผนภาระการผลิต และ Logistic ติดตามรอบส่งงานรายวัน
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'planner',  label: '📈 Forecast Planner' },
          { id: 'shipping', label: '🕐 Shipping Chart' },
          { id: 'upload',   label: '📤 อัพโหลด (Sales)' },
        ].map(t => <button key={t.id} onClick={() => setTab(t.id)} style={btn(tab === t.id)}>{t.label}</button>)}
      </div>

      {tab === 'upload' && <UploadTab canUpload={canUpload} fullName={fullName} onImported={() => setRefreshKey(k => k + 1)} />}
      {tab === 'planner' && <PlannerTab refreshKey={refreshKey} />}
      {tab === 'shipping' && <ShippingTab fullName={fullName} refreshKey={refreshKey} />}
    </div>
  );
}
