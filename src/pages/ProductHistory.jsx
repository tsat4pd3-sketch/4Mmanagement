import { useState, useEffect, useMemo, useContext, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';

// ประวัติผลิตราย Product — ดูย้อนหลังว่าสินค้าตัวหนึ่งผลิตที่ไลน์ไหน/กะไหน เท่าไหร่ เสียเท่าไหร่ (2026-07-24)
// + ประวัติการแก้ master data ของสินค้านั้น (audit_log — ใครแก้ line_name/CT เมื่อไหร่)

const todayStr = () => {
  const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
const fmtDate = s => { if (!s) return '—'; const [, m, d] = s.split('-'); return `${+d}/${+m}`; };
const fmtDT = t => t ? new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const AUDIT_FIELD_TH = { line_name: 'ไลน์', cycle_time_sec: 'Cycle Time', name: 'ชื่อ', p_no: 'P/N', pair_mat_no: 'คู่ RH/LH', is_active: 'สถานะใช้งาน', customer: 'ลูกค้า' };

export default function ProductHistory() {
  const { role, lineId, sections } = useContext(UserContext);
  const scopeSecs = sections || [];

  const [products, setProducts] = useState([]);
  const [lines, setLines]       = useState([]);
  const [search, setSearch]     = useState('');
  const [selMat, setSelMat]     = useState(null);   // product object
  const [from, setFrom]         = useState(() => addDays(todayStr(), -90));
  const [to, setTo]             = useState(todayStr);
  const [orders, setOrders]     = useState([]);
  const [defects, setDefects]   = useState([]);
  const [audit, setAudit]       = useState([]);
  const [loading, setLoading]   = useState(false);

  // master lists
  useEffect(() => {
    supabaseDR.from('dr_products').select('id, mat_no, name, p_no, line_name, cycle_time_sec, is_active')
      .not('mat_no', 'is', null).order('name').then(({ data }) => setProducts(data || []));
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name')
      .then(({ data }) => setLines(data || []));
  }, []);

  // ไลน์ที่อยู่ใน scope ของผู้ใช้ (leader = family ตัวเอง · role อื่น = ตาม sections · ไม่มี scope = ทั้งหมด)
  const scopeLineNames = useMemo(() => {
    if (role === 'leader' && lineId) {
      const me = lines.find(l => String(l.id) === String(lineId));
      return me ? new Set(getLineFamilyNames(lines, me.name).map(n => n.toLowerCase())) : null;
    }
    if (scopeSecs.length) return new Set(lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name.toLowerCase()));
    return null; // ไม่จำกัด
  }, [role, lineId, lines, scopeSecs]);

  const loadHistory = useCallback(async (prod) => {
    if (!prod) return;
    setLoading(true);
    // ใบผลิตของ mat นี้ + join session (line/date/shift/oee)
    const { data: ord } = await supabaseDR.from('prod_orders')
      .select('id, prod_no, mat_no, machine_no, qty, qty_target, qty_actual, qty_ok, status, opened_at, confirmed_at, carry_over_note, production_sessions!inner(line_name, work_date, shift, oee, status)')
      .eq('mat_no', prod.mat_no)
      .gte('production_sessions.work_date', from).lte('production_sessions.work_date', to)
      .order('opened_at', { ascending: false }).limit(2000);
    const { data: def } = await supabaseDR.from('defect_logs')
      .select('prod_order_id, qty_ng, qty_suspect, dr_defect_types(name_th)')
      .eq('mat_no', prod.mat_no).limit(5000);
    // audit ของแถว dr_products นี้ (best-effort — ถ้ายังไม่ apply migration audit_log จะว่าง)
    let auditRows = [];
    try {
      const { data: a } = await supabaseDR.from('audit_log')
        .select('action, actor, changed_fields, old_data, new_data, changed_at')
        .eq('table_name', 'dr_products').eq('row_pk', String(prod.id))
        .order('changed_at', { ascending: false }).limit(200);
      auditRows = a || [];
    } catch { auditRows = []; }
    setOrders(ord || []); setDefects(def || []); setAudit(auditRows);
    setLoading(false);
  }, [from, to]);

  useEffect(() => { if (selMat) loadHistory(selMat); }, [selMat, loadHistory]);

  // กรอง scope + รวม NG ต่อ order
  const ngByOrder = useMemo(() => {
    const m = {};
    defects.forEach(d => { m[d.prod_order_id] = (m[d.prod_order_id] || 0) + (d.qty_ng || 0) + (d.qty_suspect || 0); });
    return m;
  }, [defects]);

  const rows = useMemo(() => {
    let r = orders.map(o => ({
      ...o, line: o.production_sessions?.line_name, work_date: o.production_sessions?.work_date,
      shift: o.production_sessions?.shift, sessOee: o.production_sessions?.oee,
      produced: o.status === 'confirmed' ? (o.qty_ok ?? o.qty) : (o.qty_actual ?? 0),
      target: o.qty_target ?? o.qty, ng: ngByOrder[o.id] || 0,
    }));
    if (scopeLineNames) r = r.filter(x => scopeLineNames.has((x.line || '').toLowerCase()));
    return r;
  }, [orders, ngByOrder, scopeLineNames]);

  const summary = useMemo(() => {
    const produced = rows.reduce((s, r) => s + (r.produced || 0), 0);
    const target = rows.reduce((s, r) => s + (r.target || 0), 0);
    const ng = rows.reduce((s, r) => s + (r.ng || 0), 0);
    const linesUsed = [...new Set(rows.map(r => r.line).filter(Boolean))];
    const byLine = {};
    rows.forEach(r => { const k = r.line || '—'; (byLine[k] = byLine[k] || { line: k, produced: 0, ng: 0, orders: 0 }); byLine[k].produced += r.produced || 0; byLine[k].ng += r.ng || 0; byLine[k].orders++; });
    return { produced, target, ng, orders: rows.length, linesUsed, byLine: Object.values(byLine).sort((a, b) => b.produced - a.produced) };
  }, [rows]);

  // trend รายวัน
  const daily = useMemo(() => {
    const m = {};
    rows.forEach(r => { if (!r.work_date) return; (m[r.work_date] = m[r.work_date] || { d: r.work_date, produced: 0, ng: 0 }); m[r.work_date].produced += r.produced || 0; m[r.work_date].ng += r.ng || 0; });
    return Object.values(m).sort((a, b) => a.d.localeCompare(b.d));
  }, [rows]);
  const dailyMax = Math.max(1, ...daily.map(d => d.produced));

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 50);
    return products.filter(p => (p.mat_no || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q) || (p.p_no || '').toLowerCase().includes(q)).slice(0, 50);
  }, [products, search]);

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' };
  const th = { textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, padding: '6px 8px', borderBottom: '1px solid var(--border2)', whiteSpace: 'nowrap' };
  const td = { fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };

  return (
    <div style={{ padding: '16px 20px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 4 }}>📜 ประวัติผลิต (by Product)</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>เลือกสินค้าเพื่อดูว่าเคยผลิตที่ไลน์ไหน/กะไหน เท่าไหร่ เสียเท่าไหร่ + ประวัติการแก้ไขข้อมูลสินค้า (ใครแก้เมื่อไหร่)</div>

      {/* ตัวเลือกสินค้า + ช่วงวันที่ */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ค้นหาสินค้า (MAT.NO / ชื่อ / P/N)</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="เช่น 50029377, REINF, B222"
              style={{ marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ตั้งแต่</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ marginTop: 4, width: 150 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ถึง</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ marginTop: 4, width: 150 }} />
          </div>
        </div>
        {/* ผลค้นหา */}
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {filteredProducts.map(p => (
            <button key={p.id} onClick={() => setSelMat(p)}
              style={{ fontSize: 11, padding: '5px 10px', borderRadius: 20, cursor: 'pointer', fontWeight: 700,
                background: selMat?.id === p.id ? 'var(--accent)' : 'var(--bg2)', color: selMat?.id === p.id ? '#08131f' : 'var(--text)',
                border: `1px solid ${selMat?.id === p.id ? 'var(--accent)' : 'var(--border2)'}` }}>
              {p.mat_no} · {p.name}{p.line_name ? ` · ${p.line_name}` : ''}
            </button>
          ))}
          {!filteredProducts.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่พบสินค้า</span>}
        </div>
      </div>

      {!selMat && <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', padding: 40 }}>เลือกสินค้าด้านบนเพื่อดูประวัติ</div>}

      {selMat && (
        <>
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{selMat.mat_no} · {selMat.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  P/N {selMat.p_no || '—'} · ไลน์ปัจจุบัน <b>{selMat.line_name || '—'}</b> · CT {selMat.cycle_time_sec || '—'}s {!selMat.is_active && '· ⛔ ปิดใช้งาน'}
                </div>
              </div>
            </div>
          </div>

          {/* สรุป */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'จำนวนใบ', value: summary.orders, color: 'var(--text)' },
              { label: 'ผลิตได้รวม', value: summary.produced.toLocaleString(), color: '#22c55e' },
              { label: 'เป้ารวม', value: summary.target.toLocaleString(), color: '#4d9fff' },
              { label: 'NG รวม', value: summary.ng.toLocaleString(), color: '#ef4444' },
              { label: 'ผลิตกี่ไลน์', value: summary.linesUsed.length, color: '#a78bfa' },
            ].map(s => (
              <div key={s.label} style={card}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* แยกตามไลน์ */}
          {summary.byLine.length > 0 && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>🏭 ผลิตแยกตามไลน์</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {summary.byLine.map(l => (
                  <div key={l.line} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 130, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.line}</div>
                    <div style={{ flex: 1, background: 'var(--bg2)', borderRadius: 6, height: 18, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round(l.produced / Math.max(1, summary.produced) * 100)}%`, background: 'var(--accent)', height: '100%' }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, width: 130, textAlign: 'right' }}>{l.produced.toLocaleString()} ชิ้น · {l.orders} ใบ{l.ng > 0 && ` · NG ${l.ng}`}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* trend รายวัน */}
          {daily.length > 0 && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>📈 ผลิตรายวัน</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 100, overflowX: 'auto' }}>
                {daily.map(d => (
                  <div key={d.d} title={`${d.d} · ผลิต ${d.produced}${d.ng ? ` · NG ${d.ng}` : ''}`}
                    style={{ minWidth: 14, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                    <div style={{ background: 'var(--accent)', height: `${Math.round(d.produced / dailyMax * 100)}%`, borderRadius: '3px 3px 0 0', minHeight: 2 }} />
                    <div style={{ fontSize: 8, color: 'var(--muted)', textAlign: 'center', marginTop: 2, whiteSpace: 'nowrap' }}>{fmtDate(d.d)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ตารางใบผลิต */}
          <div style={{ ...card, marginBottom: 16, overflowX: 'auto' }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>📋 รายการใบผลิต ({rows.length})</div>
            {loading ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>กำลังโหลด...</div> : rows.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>ไม่มีการผลิตในช่วงนี้</div> : (
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
                <thead><tr>
                  <th style={th}>วันที่</th><th style={th}>ไลน์</th><th style={th}>กะ</th><th style={th}>เครื่อง</th>
                  <th style={{ ...th, textAlign: 'right' }}>เป้า</th><th style={{ ...th, textAlign: 'right' }}>ผลิตได้</th>
                  <th style={{ ...th, textAlign: 'right' }}>NG</th><th style={th}>สถานะ</th><th style={th}>เปิด–ปิด</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td style={td}>{fmtDate(r.work_date)}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{r.line}</td>
                      <td style={td}>{r.shift === 'day' ? '☀️' : '🌙'}</td>
                      <td style={td}>{r.machine_no || '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{(r.target || 0).toLocaleString()}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#22c55e' }}>{(r.produced || 0).toLocaleString()}</td>
                      <td style={{ ...td, textAlign: 'right', color: r.ng ? '#ef4444' : 'var(--muted)' }}>{r.ng || '—'}</td>
                      <td style={td}>{r.status === 'confirmed' ? '✓ ปิด' : r.status === 'carry_over' ? '➡ ยกยอด' : r.status === 'cancelled' ? '✕ ยกเลิก' : r.status === 'open' ? '● ผลิต' : r.status}</td>
                      <td style={{ ...td, color: 'var(--muted)' }}>{fmtDT(r.opened_at)}{r.confirmed_at ? ` – ${fmtDT(r.confirmed_at)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ประวัติการแก้ไขข้อมูลสินค้า (audit) */}
          <div style={{ ...card }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>🕵️ ประวัติการแก้ไขข้อมูลสินค้า (ใครแก้อะไรเมื่อไหร่)</div>
            {audit.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                ยังไม่มีประวัติ — ระบบ audit เริ่มเก็บหลัง apply migration <code>20260724_audit_log_dr.sql</code> (การแก้ไขก่อนหน้านั้นไม่ถูกบันทึก)
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {audit.map((a, i) => (
                  <div key={i} style={{ borderLeft: '3px solid var(--accent2)', paddingLeft: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {fmtDT(a.changed_at)} · {a.action} · โดย <b>{a.actor || '(ไม่ทราบผู้แก้)'}</b>
                    </div>
                    {a.action === 'UPDATE' && (a.changed_fields || []).map(f => (
                      <div key={f} style={{ fontSize: 12 }}>
                        <b>{AUDIT_FIELD_TH[f] || f}</b>: <span style={{ color: '#ef4444' }}>{String(a.old_data?.[f] ?? '—')}</span> → <span style={{ color: '#22c55e' }}>{String(a.new_data?.[f] ?? '—')}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
