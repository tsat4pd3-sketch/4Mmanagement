import { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';

/* ─── LINE STOCK — Stock พาร์ทย่อยคงเหลือในแต่ละไลน์ผลิต ─────────────────
   Store จ่ายพาร์ทเข้าไลน์ → บันทึก transaction type='issue'
   ระบบหักอัตโนมัติตอน close กะ   → type='consume'
   ไลน์คืนพาร์ท                  → type='return'
   ปรับยอด stocktake              → type='adjust'

   Stock คงเหลือ = SUM(issue+adjust) - SUM(consume+return)
   ─────────────────────────────────────────────────────────────────────────── */

function getToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

const card = { background:'var(--card)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:16 };
const inputSt = { width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg2)', color:'var(--text)', fontSize:13, boxSizing:'border-box', fontFamily:'var(--font-body)' };
const btn = (bg, color='#fff') => ({ padding:'8px 16px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:700, background:bg, color, fontFamily:'var(--font-body)' });

const TYPE_LABEL = { issue:'📦 จ่ายเข้าไลน์', consume:'⚙️ ใช้ผลิต (Auto)', return:'↩️ คืน Store', adjust:'🔧 ปรับยอด' };
const TYPE_COLOR = { issue:'#22c55e', consume:'#94a3b8', return:'#f59e0b', adjust:'#a855f7' };

const EMPTY_FORM = { line_name:'', mat_no:'', part_name:'', qty:'', type:'issue', note:'', work_date: getToday() };

export default function LineStock() {
  const { role, fullName } = useContext(UserContext);
  const canIssue = ['admin','manager','supervisor','leader'].includes(role);

  const [lines,   setLines]   = useState([]);
  const [stock,   setStock]   = useState([]);   // line_stock_summary rows
  const [txns,    setTxns]    = useState([]);   // recent transactions
  const [bomMap,  setBomMap]  = useState({});   // mat_no → part_name (from bom_items)

  const [lineFilter, setLineFilter] = useState('');
  const [showTxn,    setShowTxn]    = useState(false);  // history panel
  const [showForm,   setShowForm]   = useState(false);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  const [matSearch,  setMatSearch]  = useState('');     // autocomplete

  /* ── load ── */
  const load = useCallback(async () => {
    const [{ data: ln }, { data: stk }, { data: boms }] = await Promise.all([
      supabase.from('production_lines').select('name').order('name'),
      supabaseDR.from('line_stock_summary').select('*').order('line_name').order('mat_no'),
      supabaseDR.from('bom_items').select('mat_no, part_name').eq('is_active', true),
    ]);
    setLines(ln || []);
    setStock(stk || []);
    const bm = {};
    (boms || []).forEach(b => { if (!bm[b.mat_no]) bm[b.mat_no] = b.part_name; });
    setBomMap(bm);
  }, []);

  const loadTxns = useCallback(async () => {
    const q = supabaseDR.from('line_stock_transactions').select('*').order('created_at', { ascending: false }).limit(100);
    if (lineFilter) q.eq('line_name', lineFilter);
    const { data } = await q;
    setTxns(data || []);
  }, [lineFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (showTxn) loadTxns(); }, [showTxn, loadTxns, lineFilter]);

  /* ── save transaction ── */
  const handleSave = async () => {
    if (!form.line_name) { toast.error('เลือกไลน์ก่อน'); return; }
    if (!form.mat_no.trim()) { toast.error('กรอก Mat No.'); return; }
    const qty = parseFloat(form.qty);
    if (!qty || qty <= 0) { toast.error('จำนวนต้องมากกว่า 0'); return; }
    setSaving(true);
    const { error } = await supabaseDR.from('line_stock_transactions').insert({
      line_name:  form.line_name,
      mat_no:     form.mat_no.trim().toUpperCase(),
      part_name:  form.part_name.trim() || bomMap[form.mat_no.trim().toUpperCase()] || null,
      qty,
      type:       form.type,
      work_date:  form.work_date,
      note:       form.note.trim() || null,
      created_by: fullName,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(TYPE_LABEL[form.type] + ' — บันทึกแล้ว');
    setShowForm(false);
    setForm(EMPTY_FORM);
    load();
    if (showTxn) loadTxns();
  };

  /* ── mat_no autocomplete ── */
  const matOptions = useMemo(() => {
    const q = matSearch.trim().toUpperCase();
    if (!q) return [];
    return Object.entries(bomMap).filter(([m]) => m.includes(q)).slice(0, 8);
  }, [matSearch, bomMap]);

  /* ── filtered stock ── */
  const filteredStock = useMemo(() => {
    return lineFilter ? stock.filter(s => s.line_name === lineFilter) : stock;
  }, [stock, lineFilter]);

  /* ── group stock by line ── */
  const stockByLine = useMemo(() => {
    const map = {};
    filteredStock.forEach(s => {
      (map[s.line_name] = map[s.line_name] || []).push(s);
    });
    return map;
  }, [filteredStock]);

  const totalLow = filteredStock.filter(s => (s.qty_on_hand || 0) <= 0).length;

  return (
    <div style={{ padding:'clamp(12px,2vw,24px)', maxWidth:1300, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', gap:12, flexWrap:'wrap', marginBottom:18 }}>
        <div>
          <h1 style={{ margin:0, fontSize:'clamp(18px,2.5vw,24px)', fontWeight:900, fontFamily:'var(--font-display)', color:'var(--text)' }}>
            📦 Line Stock — พาร์ทย่อยคงเหลือในไลน์
          </h1>
          <p style={{ margin:'4px 0 0', fontSize:13, color:'var(--muted)' }}>
            Store จ่ายพาร์ทเข้าไลน์ · ระบบหักอัตโนมัติตอน close กะ (BOM × qty_ok)
          </p>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={() => setShowTxn(v => !v)} style={btn(showTxn ? 'var(--accent)' : 'var(--bg2)', showTxn ? '#08130a' : 'var(--text)')}>
            {showTxn ? '📊 ดู Stock' : '📋 ประวัติ Transaction'}
          </button>
          {canIssue && (
            <button onClick={() => { setForm({ ...EMPTY_FORM, type:'issue', work_date:getToday() }); setShowForm(true); }} style={btn('#16a34a')}>
              + จ่ายพาร์ทเข้าไลน์
            </button>
          )}
        </div>
      </div>

      {/* Summary chips */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:10, marginBottom:16 }}>
        {[
          { label:'ไลน์ที่มี stock', value: Object.keys(stockByLine).length, icon:'🏭' },
          { label:'รายการพาร์ท', value: filteredStock.length, icon:'🔩' },
          { label:'Stock หมด / ติดลบ', value: totalLow, icon:'⚠️', warn: totalLow > 0 },
        ].map(c => (
          <div key={c.label} style={{ ...card, padding:'12px 16px', borderColor: c.warn ? 'rgba(239,68,68,0.4)' : 'var(--border)' }}>
            <div style={{ fontSize:11, color:'var(--muted)', fontWeight:700 }}>{c.icon} {c.label}</div>
            <div style={{ fontSize:26, fontWeight:900, fontFamily:'var(--font-display)', color: c.warn ? '#ef4444' : 'var(--text)', marginTop:2 }}>{c.value}</div>
          </div>
        ))}
        <div style={{ ...card, padding:'10px 16px' }}>
          <div style={{ fontSize:11, color:'var(--muted)', fontWeight:700, marginBottom:4 }}>🔍 กรองไลน์</div>
          <select value={lineFilter} onChange={e => setLineFilter(e.target.value)} style={{ ...inputSt, padding:'5px 8px' }}>
            <option value="">ทุกไลน์</option>
            {lines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </div>
      </div>

      {/* ── Stock view ── */}
      {!showTxn && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {Object.keys(stockByLine).length === 0 ? (
            <div style={{ ...card, padding:'40px 20px', textAlign:'center', color:'var(--muted)', fontSize:14 }}>
              ยังไม่มีข้อมูล Stock{lineFilter ? ` ในไลน์ ${lineFilter}` : ''} — กด "+ จ่ายพาร์ทเข้าไลน์" เพื่อเริ่ม
            </div>
          ) : (
            Object.entries(stockByLine).map(([lineName, parts]) => {
              const lowParts = parts.filter(p => (p.qty_on_hand || 0) <= 0);
              return (
                <div key={lineName} style={{ ...card, padding:0, overflow:'hidden' }}>
                  <div style={{ padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', background:'var(--bg2)', borderBottom:'1px solid var(--border)' }}>
                    <div style={{ fontWeight:800, fontSize:15, fontFamily:'var(--font-display)', color:'var(--text)' }}>📍 {lineName}</div>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      {lowParts.length > 0 && <span style={{ fontSize:11, padding:'2px 9px', borderRadius:10, background:'rgba(239,68,68,0.12)', color:'#ef4444', fontWeight:700 }}>⚠️ {lowParts.length} รายการหมด</span>}
                      <span style={{ fontSize:11, color:'var(--muted)' }}>{parts.length} พาร์ท</span>
                    </div>
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse' }}>
                      <thead>
                        <tr style={{ background:'var(--bg2)' }}>
                          {['Mat SAP','Part Name','คงเหลือ (ชิ้น)','สถานะ'].map(h => (
                            <th key={h} style={{ padding:'8px 14px', fontSize:11, fontWeight:800, color:'var(--muted)', textAlign: h==='คงเหลือ (ชิ้น)' ? 'right' : 'left', whiteSpace:'nowrap', textTransform:'uppercase' }}>{h}</th>
                          ))}
                          {canIssue && <th style={{ padding:'8px 14px', width:90 }}></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {parts.map(p => {
                          const qty = parseFloat(p.qty_on_hand) || 0;
                          const isLow = qty <= 0;
                          return (
                            <tr key={p.mat_no} style={{ opacity: isLow ? 0.7 : 1 }}>
                              <td style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', fontFamily:'monospace', fontWeight:700, color:'#0ea5e9', fontSize:13 }}>{p.mat_no}</td>
                              <td style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', fontSize:13, color:'var(--text)' }}>{p.part_name || bomMap[p.mat_no] || '—'}</td>
                              <td style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', textAlign:'right', fontSize:16, fontWeight:900, color: isLow ? '#ef4444' : qty < 10 ? '#f59e0b' : 'var(--accent)' }}>{qty.toLocaleString()}</td>
                              <td style={{ padding:'10px 14px', borderTop:'1px solid var(--border)' }}>
                                <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:700,
                                  background: isLow ? 'rgba(239,68,68,0.1)' : qty < 10 ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)',
                                  color: isLow ? '#ef4444' : qty < 10 ? '#f59e0b' : '#22c55e' }}>
                                  {isLow ? '🔴 หมด/ติดลบ' : qty < 10 ? '🟡 เหลือน้อย' : '🟢 ปกติ'}
                                </span>
                              </td>
                              {canIssue && (
                                <td style={{ padding:'8px 14px', borderTop:'1px solid var(--border)' }}>
                                  <button onClick={() => { setForm({ ...EMPTY_FORM, line_name: lineName, mat_no: p.mat_no, part_name: p.part_name || bomMap[p.mat_no] || '', type:'issue', work_date:getToday() }); setShowForm(true); }}
                                    style={{ ...btn('rgba(34,197,94,0.1)', '#22c55e'), padding:'4px 10px', fontSize:11, border:'1px solid rgba(34,197,94,0.3)' }}>
                                    + จ่าย
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Transaction history ── */}
      {showTxn && (
        <div style={{ ...card, padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', background:'var(--bg2)', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontWeight:700, fontSize:14 }}>📋 ประวัติ Transaction ล่าสุด 100 รายการ</div>
            {canIssue && (
              <div style={{ display:'flex', gap:6 }}>
                {['issue','return','adjust'].map(t => (
                  <button key={t} onClick={() => { setForm({ ...EMPTY_FORM, type:t, work_date:getToday() }); setShowForm(true); }}
                    style={{ ...btn('var(--bg)', TYPE_COLOR[t]), border:`1px solid ${TYPE_COLOR[t]}40`, fontSize:11, padding:'4px 10px' }}>
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'var(--bg2)' }}>
                  {['วันที่','ไลน์','Mat SAP','Part Name','ประเภท','จำนวน','หมายเหตุ','โดย'].map(h => (
                    <th key={h} style={{ padding:'8px 12px', fontSize:11, fontWeight:800, color:'var(--muted)', textAlign:'left', whiteSpace:'nowrap', textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txns.length === 0 && (
                  <tr><td colSpan={8} style={{ padding:30, textAlign:'center', color:'var(--muted)', fontSize:13 }}>ยังไม่มีข้อมูล</td></tr>
                )}
                {txns.map(t => (
                  <tr key={t.id}>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)', whiteSpace:'nowrap' }}>{t.work_date}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:13, fontWeight:600 }}>{t.line_name}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontFamily:'monospace', fontSize:12, color:'#0ea5e9', fontWeight:700 }}>{t.mat_no}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--text2)' }}>{t.part_name || '—'}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)' }}>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:700, background:`${TYPE_COLOR[t.type]}18`, color:TYPE_COLOR[t.type] }}>{TYPE_LABEL[t.type]}</span>
                    </td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontWeight:800, fontSize:14, color: t.type === 'consume' ? '#94a3b8' : t.type === 'return' ? '#f59e0b' : '#22c55e', textAlign:'right' }}>
                      {t.type === 'consume' || t.type === 'return' ? '-' : '+'}{parseFloat(t.qty).toLocaleString()}
                    </td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)' }}>{t.note || '—'}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)' }}>{t.created_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Issue / Adjust modal ── */}
      {showForm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius:14, padding:24, width:'min(480px,100%)', maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:800, color:'var(--text)', marginBottom:16, fontFamily:'var(--font-display)' }}>
              {TYPE_LABEL[form.type]}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {/* Type selector */}
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:6 }}>ประเภท</label>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {['issue','return','adjust'].map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, type:t }))}
                      style={{ padding:'6px 14px', borderRadius:8, border:`1px solid ${form.type===t ? TYPE_COLOR[t] : 'var(--border)'}`, cursor:'pointer', fontSize:12, fontWeight:700,
                        background: form.type===t ? `${TYPE_COLOR[t]}18` : 'var(--bg2)',
                        color: form.type===t ? TYPE_COLOR[t] : 'var(--muted)',
                        fontFamily:'var(--font-body)' }}>
                      {TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>ไลน์การผลิต *</label>
                  <select value={form.line_name} onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))} style={inputSt}>
                    <option value="">เลือกไลน์...</option>
                    {lines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>วันที่</label>
                  <input type="date" style={inputSt} value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date:e.target.value }))} />
                </div>
              </div>

              {/* Mat No. with autocomplete */}
              <div style={{ position:'relative' }}>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>MAT SAP *</label>
                <input style={{ ...inputSt, fontFamily:'monospace', fontWeight:700 }}
                  value={form.mat_no}
                  onChange={e => { const v = e.target.value.toUpperCase(); setForm(f => ({ ...f, mat_no:v, part_name: bomMap[v] || f.part_name })); setMatSearch(v); }}
                  placeholder="พิมพ์เพื่อค้นหา..."
                />
                {matOptions.length > 0 && (
                  <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:8, zIndex:100, maxHeight:160, overflowY:'auto' }}>
                    {matOptions.map(([m, name]) => (
                      <div key={m} onClick={() => { setForm(f => ({ ...f, mat_no:m, part_name:name })); setMatSearch(''); }}
                        style={{ padding:'8px 12px', cursor:'pointer', fontSize:13, display:'flex', gap:10, alignItems:'center' }}
                        onMouseEnter={e => e.currentTarget.style.background='var(--bg2)'}
                        onMouseLeave={e => e.currentTarget.style.background=''}>
                        <span style={{ fontFamily:'monospace', fontWeight:700, color:'#0ea5e9' }}>{m}</span>
                        <span style={{ color:'var(--muted)', fontSize:12 }}>{name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>Part Name</label>
                <input style={inputSt} value={form.part_name} onChange={e => setForm(f => ({ ...f, part_name:e.target.value }))} placeholder="กรอกหรือเลือกจาก Mat SAP" />
              </div>

              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>จำนวน (ชิ้น) *</label>
                <input type="number" min="0.001" step="any" style={{ ...inputSt, fontSize:20, fontWeight:900, textAlign:'center' }}
                  value={form.qty} onChange={e => setForm(f => ({ ...f, qty:e.target.value }))} placeholder="0" />
              </div>

              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>หมายเหตุ</label>
                <input style={inputSt} value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} placeholder="เช่น Kanban ใบที่ 3, Lot A001..." />
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:20 }}>
              <button onClick={() => setShowForm(false)} style={{ ...btn('var(--bg2)', 'var(--text)'), border:'1px solid var(--border)' }}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btn(TYPE_COLOR[form.type]), opacity:saving ? 0.6 : 1 }}>
                {saving ? '...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
