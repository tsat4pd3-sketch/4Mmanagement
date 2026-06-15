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

/* ─────────────────────────────────────────────────────────────────────────────
   TAB: STOCK (existing content)
   ───────────────────────────────────────────────────────────────────────────── */
function StockTab({ role }) {
  const { fullName } = useContext(UserContext);
  const canIssue = ['admin','manager','supervisor','leader'].includes(role);

  const [lines,   setLines]   = useState([]);
  const [stock,   setStock]   = useState([]);
  const [txns,    setTxns]    = useState([]);
  const [bomMap,  setBomMap]  = useState({});

  const [lineFilter, setLineFilter] = useState('');
  const [showTxn,    setShowTxn]    = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  const [matSearch,  setMatSearch]  = useState('');

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

  const matOptions = useMemo(() => {
    const q = matSearch.trim().toUpperCase();
    if (!q) return [];
    return Object.entries(bomMap).filter(([m]) => m.includes(q)).slice(0, 8);
  }, [matSearch, bomMap]);

  const filteredStock = useMemo(() => {
    return lineFilter ? stock.filter(s => s.line_name === lineFilter) : stock;
  }, [stock, lineFilter]);

  const stockByLine = useMemo(() => {
    const map = {};
    filteredStock.forEach(s => {
      (map[s.line_name] = map[s.line_name] || []).push(s);
    });
    return map;
  }, [filteredStock]);

  const totalLow = filteredStock.filter(s => (s.qty_on_hand || 0) <= 0).length;

  return (
    <>
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
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   TAB: KANBAN STD
   ───────────────────────────────────────────────────────────────────────────── */
const EMPTY_KBS = { mat_no:'', qty_per_kanban:'', uom:'' };

function KanbanStdTab({ canEdit, fullName }) {
  const [parts,     setParts]     = useState([]);
  const [standards, setStandards] = useState([]);
  const [search,    setSearch]    = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form,      setForm]      = useState(EMPTY_KBS);
  const [saving,    setSaving]    = useState(false);

  const load = useCallback(async () => {
    const [{ data: pm }, { data: ks }] = await Promise.all([
      supabaseDR.from('parts_master').select('mat_no, part_name, uom, supplier').eq('is_active', true).order('mat_no'),
      supabaseDR.from('kanban_standards').select('*').eq('is_active', true),
    ]);
    setParts(pm || []);
    setStandards(ks || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const merged = useMemo(() => {
    const ksMap = {};
    standards.forEach(s => { ksMap[s.mat_no] = s; });
    return parts.map(p => ({ ...p, ks: ksMap[p.mat_no] || null }));
  }, [parts, standards]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return merged;
    return merged.filter(r => r.mat_no.includes(q) || (r.part_name || '').toUpperCase().includes(q) || (r.supplier || '').toUpperCase().includes(q));
  }, [merged, search]);

  const openEdit = (row) => {
    setForm({
      mat_no:        row.mat_no,
      qty_per_kanban: row.ks ? String(row.ks.qty_per_kanban) : '',
      uom:           row.ks ? (row.ks.uom || '') : (row.uom || ''),
    });
    setShowModal(true);
  };

  const openNew = () => {
    setForm(EMPTY_KBS);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.mat_no.trim()) { toast.error('กรอก Mat No.'); return; }
    const qty = parseFloat(form.qty_per_kanban);
    if (!qty || qty <= 0) { toast.error('กรอก Qty/Kanban ให้ถูกต้อง'); return; }
    setSaving(true);
    const { error } = await supabaseDR.from('kanban_standards').upsert({
      mat_no:         form.mat_no.trim().toUpperCase(),
      qty_per_kanban: qty,
      uom:            form.uom.trim() || null,
      is_active:      true,
      updated_by:     fullName,
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'mat_no' });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึก Kanban Std แล้ว');
    setShowModal(false);
    load();
  };

  return (
    <>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:16 }}>
        <div>
          <h2 style={{ margin:0, fontSize:'clamp(16px,2vw,20px)', fontWeight:900, fontFamily:'var(--font-display)', color:'var(--text)' }}>
            🎴 Kanban Std — มาตรฐาน Qty/Kanban รายพาร์ท
          </h2>
          <p style={{ margin:'4px 0 0', fontSize:13, color:'var(--muted)' }}>ตั้งค่าจำนวนชิ้นต่อ 1 ใบ Kanban สำหรับแต่ละ Mat No.</p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input
            style={{ ...inputSt, width:220 }}
            placeholder="ค้นหา Mat No. / Part Name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {canEdit && (
            <button onClick={openNew} style={btn('#7c3aed')}>+ เพิ่ม Kanban Std</button>
          )}
        </div>
      </div>

      <div style={{ ...card, padding:0, overflow:'hidden' }}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'var(--bg2)' }}>
                {['Mat No.','Part Name','Supplier','UOM','Qty/Kanban','อัปเดต'].map(h => (
                  <th key={h} style={{ padding:'9px 14px', fontSize:11, fontWeight:800, color:'var(--muted)', textAlign:'left', whiteSpace:'nowrap', textTransform:'uppercase' }}>{h}</th>
                ))}
                {canEdit && <th style={{ padding:'9px 14px', width:80 }}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={canEdit ? 7 : 6} style={{ padding:30, textAlign:'center', color:'var(--muted)', fontSize:13 }}>ไม่พบข้อมูล</td></tr>
              )}
              {filtered.map(row => (
                <tr key={row.mat_no} style={{ opacity: row.ks ? 1 : 0.55 }}>
                  <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontFamily:'monospace', fontWeight:700, color:'#0ea5e9', fontSize:13 }}>{row.mat_no}</td>
                  <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontSize:13, color:'var(--text)' }}>{row.part_name || '—'}</td>
                  <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--text2)' }}>{row.supplier || '—'}</td>
                  <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)' }}>{row.ks ? (row.ks.uom || '—') : (row.uom || '—')}</td>
                  <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontWeight:900, fontSize:15, color: row.ks ? 'var(--accent)' : 'var(--muted)' }}>
                    {row.ks ? row.ks.qty_per_kanban.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontSize:11, color:'var(--muted)' }}>
                    {row.ks ? (
                      <span title={row.ks.updated_by || ''}>
                        {row.ks.updated_at ? new Date(row.ks.updated_at).toLocaleDateString('th-TH') : '—'}
                        {row.ks.updated_by ? <span style={{ display:'block', fontSize:10 }}>{row.ks.updated_by}</span> : null}
                      </span>
                    ) : '—'}
                  </td>
                  {canEdit && (
                    <td style={{ padding:'8px 14px', borderTop:'1px solid var(--border)' }}>
                      <button onClick={() => openEdit(row)}
                        style={{ ...btn('rgba(124,58,237,0.1)', '#7c3aed'), padding:'4px 10px', fontSize:11, border:'1px solid rgba(124,58,237,0.3)' }}>
                        ✏️ แก้ไข
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius:14, padding:24, width:'min(420px,100%)', maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:800, color:'var(--text)', marginBottom:16, fontFamily:'var(--font-display)' }}>
              🎴 {form.mat_no ? `แก้ไข Kanban Std — ${form.mat_no}` : 'เพิ่ม Kanban Std ใหม่'}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>Mat No. *</label>
                <input style={{ ...inputSt, fontFamily:'monospace', fontWeight:700 }}
                  value={form.mat_no}
                  onChange={e => setForm(f => ({ ...f, mat_no: e.target.value.toUpperCase() }))}
                  placeholder="เช่น 1234567890"
                />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:10 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>Qty / Kanban *</label>
                  <input type="number" min="1" step="1"
                    style={{ ...inputSt, fontSize:18, fontWeight:900, textAlign:'center' }}
                    value={form.qty_per_kanban}
                    onChange={e => setForm(f => ({ ...f, qty_per_kanban: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>UOM</label>
                  <input style={inputSt}
                    value={form.uom}
                    onChange={e => setForm(f => ({ ...f, uom: e.target.value }))}
                    placeholder="PCS"
                  />
                </div>
              </div>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:20 }}>
              <button onClick={() => setShowModal(false)} style={{ ...btn('var(--bg2)', 'var(--text)'), border:'1px solid var(--border)' }}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btn('#7c3aed'), opacity:saving ? 0.6 : 1 }}>
                {saving ? '...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   TAB: รอบจัดส่ง (Delivery Rounds)
   ───────────────────────────────────────────────────────────────────────────── */
const SHIFT_LABELS = { day:'☀️ กะเช้า', night:'🌙 กะดึก', all:'🔄 ทุกกะ' };
const EMPTY_RND = { line_name:'', shift:'day', round_no:'', cutoff_time:'', prep_minutes:'60', delivery_time:'', points_count:'1', time_per_point_min:'10', note:'' };

function addMins(timeStr, mins) {
  if (!timeStr || !mins) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + parseInt(mins || 0);
  return `${String(Math.floor(total/60)%24).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}

function DeliveryRoundsTab({ canEdit, fullName }) {
  const [rounds,     setRounds]     = useState([]);
  const [lines,      setLines]      = useState([]);
  const [lineFilter, setLineFilter] = useState('');
  const [showModal,  setShowModal]  = useState(false);
  const [form,       setForm]       = useState(EMPTY_RND);
  const [editId,     setEditId]     = useState(null);
  const [saving,     setSaving]     = useState(false);

  const load = useCallback(async () => {
    const [{ data: rnd }, { data: ln }] = await Promise.all([
      supabaseDR.from('kanban_delivery_rounds').select('*').eq('is_active', true).order('line_name').order('shift').order('round_no'),
      supabase.from('production_lines').select('name').order('name'),
    ]);
    setRounds(rnd || []);
    setLines(ln || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const filtered = lineFilter ? rounds.filter(r => r.line_name === lineFilter) : rounds;
    const map = {};
    filtered.forEach(r => {
      (map[r.line_name] = map[r.line_name] || []).push(r);
    });
    return map;
  }, [rounds, lineFilter]);

  const openNew = () => {
    setEditId(null);
    setForm({ ...EMPTY_RND, line_name: lineFilter || '' });
    setShowModal(true);
  };

  const openEdit = (r) => {
    setEditId(r.id);
    setForm({
      line_name:     r.line_name,
      shift:         r.shift,
      round_no:      String(r.round_no),
      cutoff_time:        r.cutoff_time || '',
      prep_minutes:       String(r.prep_minutes ?? 60),
      delivery_time:      r.delivery_time || '',
      points_count:       String(r.points_count ?? 1),
      time_per_point_min: String(r.time_per_point_min ?? 10),
      note:               r.note || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.line_name.trim()) { toast.error('กรอกชื่อไลน์'); return; }
    if (!form.round_no || parseInt(form.round_no) < 1) { toast.error('กรอก Round No.'); return; }
    if (!form.delivery_time) { toast.error('กรอกเวลาจัดส่ง'); return; }
    setSaving(true);
    const payload = {
      line_name:     form.line_name.trim(),
      shift:         form.shift,
      round_no:      parseInt(form.round_no),
      cutoff_time:        form.cutoff_time || null,
      prep_minutes:       parseInt(form.prep_minutes) || 60,
      delivery_time:      form.delivery_time,
      points_count:       parseInt(form.points_count) || 1,
      time_per_point_min: parseInt(form.time_per_point_min) || 10,
      note:               form.note.trim() || null,
      is_active:     true,
      created_by:    fullName,
    };
    let error;
    if (editId) {
      ({ error } = await supabaseDR.from('kanban_delivery_rounds').update(payload).eq('id', editId));
    } else {
      ({ error } = await supabaseDR.from('kanban_delivery_rounds').insert(payload));
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editId ? 'แก้ไขรอบจัดส่งแล้ว' : 'เพิ่มรอบจัดส่งแล้ว');
    setShowModal(false);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ยืนยันลบรอบจัดส่งนี้?')) return;
    const { error } = await supabaseDR.from('kanban_delivery_rounds').update({ is_active: false }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบรอบจัดส่งแล้ว');
    load();
  };

  const suggestRound = useCallback(() => {
    const existing = rounds.filter(r => r.line_name === form.line_name && r.shift === form.shift);
    const maxRound = existing.reduce((m, r) => Math.max(m, r.round_no || 0), 0);
    setForm(f => ({ ...f, round_no: String(maxRound + 1) }));
  }, [rounds, form.line_name, form.shift]);

  return (
    <>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:16 }}>
        <div>
          <h2 style={{ margin:0, fontSize:'clamp(16px,2vw,20px)', fontWeight:900, fontFamily:'var(--font-display)', color:'var(--text)' }}>
            ⏰ รอบจัดส่ง — Kanban Delivery Rounds
          </h2>
          <p style={{ margin:'4px 0 0', fontSize:13, color:'var(--muted)' }}>ตั้งค่าเวลาเตรียมและเวลาจัดส่งพาร์ทแต่ละรอบตามไลน์และกะ</p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <select value={lineFilter} onChange={e => setLineFilter(e.target.value)} style={{ ...inputSt, width:180 }}>
            <option value="">ทุกไลน์</option>
            {lines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
          {canEdit && (
            <button onClick={openNew} style={btn('#0284c7')}>+ เพิ่มรอบจัดส่ง</button>
          )}
        </div>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div style={{ ...card, padding:'40px 20px', textAlign:'center', color:'var(--muted)', fontSize:14 }}>
          ยังไม่มีรอบจัดส่ง{lineFilter ? ` สำหรับไลน์ ${lineFilter}` : ''} — กด "+ เพิ่มรอบจัดส่ง" เพื่อเริ่ม
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {Object.entries(grouped).map(([lineName, rndList]) => (
            <div key={lineName} style={{ ...card, padding:0, overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', background:'var(--bg2)', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontWeight:800, fontSize:15, fontFamily:'var(--font-display)', color:'var(--text)' }}>📍 {lineName}</div>
                <span style={{ fontSize:11, color:'var(--muted)' }}>{rndList.length} รอบ</span>
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ background:'var(--bg2)' }}>
                      {['กะ','รอบที่','ตัดยอด','เตรียม','ส่ง','จุด','เสร็จ~','หมายเหตุ'].map(h => (
                        <th key={h} style={{ padding:'8px 14px', fontSize:11, fontWeight:800, color:'var(--muted)', textAlign:'left', whiteSpace:'nowrap', textTransform:'uppercase' }}>{h}</th>
                      ))}
                      {canEdit && <th style={{ padding:'8px 14px', width:100 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rndList.map(r => (
                      <tr key={r.id}>
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)' }}>
                          <span style={{ fontSize:11, padding:'2px 9px', borderRadius:10, fontWeight:700,
                            background: r.shift==='day' ? 'rgba(234,179,8,0.12)' : r.shift==='night' ? 'rgba(99,102,241,0.12)' : 'rgba(34,197,94,0.1)',
                            color: r.shift==='day' ? '#ca8a04' : r.shift==='night' ? '#818cf8' : '#22c55e' }}>
                            {SHIFT_LABELS[r.shift] || r.shift}
                          </span>
                        </td>
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontWeight:900, fontSize:16, color:'#0ea5e9' }}>
                          #{r.round_no}
                        </td>
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontFamily:'monospace', fontSize:13, color:'var(--text2)' }}>
                          {r.cutoff_time?.slice(0,5) || '—'}
                        </td>
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontSize:13, color:'var(--muted)' }}>
                          {r.prep_minutes || 60} น.
                        </td>
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontFamily:'monospace', fontSize:14, fontWeight:700, color:'var(--accent)' }}>
                          {r.delivery_time?.slice(0,5) || '—'}
                        </td>
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontSize:13, color:'var(--text2)', textAlign:'center' }}>
                          {r.points_count || 1}×{r.time_per_point_min || 10}น.
                        </td>
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontFamily:'monospace', fontSize:13, color:'#f59e0b', fontWeight:700 }}>
                          {addMins(r.delivery_time?.slice(0,5), (r.points_count||1)*(r.time_per_point_min||10))}
                        </td>
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)' }}>
                          {r.note || '—'}
                        </td>
                        {canEdit && (
                          <td style={{ padding:'8px 14px', borderTop:'1px solid var(--border)' }}>
                            <div style={{ display:'flex', gap:6 }}>
                              <button onClick={() => openEdit(r)}
                                style={{ ...btn('rgba(2,132,199,0.1)', '#0284c7'), padding:'4px 8px', fontSize:11, border:'1px solid rgba(2,132,199,0.3)' }}>
                                ✏️
                              </button>
                              <button onClick={() => handleDelete(r.id)}
                                style={{ ...btn('rgba(239,68,68,0.1)', '#ef4444'), padding:'4px 8px', fontSize:11, border:'1px solid rgba(239,68,68,0.3)' }}>
                                🗑️
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius:14, padding:24, width:'min(460px,100%)', maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:800, color:'var(--text)', marginBottom:16, fontFamily:'var(--font-display)' }}>
              ⏰ {editId ? 'แก้ไขรอบจัดส่ง' : 'เพิ่มรอบจัดส่งใหม่'}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>ไลน์การผลิต *</label>
                <input
                  list="dl-lines"
                  style={inputSt}
                  value={form.line_name}
                  onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))}
                  placeholder="เลือกหรือพิมพ์ชื่อไลน์..."
                />
                <datalist id="dl-lines">
                  {lines.map(l => <option key={l.name} value={l.name} />)}
                </datalist>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>กะ *</label>
                  <select value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value }))} style={inputSt}>
                    <option value="day">☀️ กะเช้า (day)</option>
                    <option value="night">🌙 กะดึก (night)</option>
                    <option value="all">🔄 ทุกกะ (all)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>รอบที่ *</label>
                  <div style={{ display:'flex', gap:6 }}>
                    <input type="number" min="1" step="1"
                      style={{ ...inputSt, textAlign:'center', fontWeight:900 }}
                      value={form.round_no}
                      onChange={e => setForm(f => ({ ...f, round_no: e.target.value }))}
                      placeholder="1"
                    />
                    {form.line_name && (
                      <button onClick={suggestRound} title="แนะนำรอบถัดไป"
                        style={{ ...btn('var(--bg2)', 'var(--text)'), border:'1px solid var(--border)', padding:'6px 10px', fontSize:12, flexShrink:0 }}>
                        +1
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Shipping time chart */}
              <div style={{ background:'var(--bg2)', borderRadius:8, padding:12, border:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>⏰ Shipping Time Chart</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>ตัดยอดรับออเดอร์</label>
                    <input type="time" style={{ ...inputSt, fontFamily:'monospace' }}
                      value={form.cutoff_time}
                      onChange={e => {
                        const ct = e.target.value;
                        const dt = addMins(ct, form.prep_minutes);
                        setForm(f => ({ ...f, cutoff_time: ct, delivery_time: dt || f.delivery_time }));
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>เวลาเตรียมของ (นาที)</label>
                    <input type="number" min="1" style={{ ...inputSt, textAlign:'center' }}
                      value={form.prep_minutes}
                      onChange={e => {
                        const pm = e.target.value;
                        const dt = addMins(form.cutoff_time, pm);
                        setForm(f => ({ ...f, prep_minutes: pm, delivery_time: dt || f.delivery_time }));
                      }}
                    />
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:'var(--accent)', display:'block', marginBottom:4 }}>เวลาเริ่มส่ง *</label>
                    <input type="time" style={{ ...inputSt, fontFamily:'monospace', fontWeight:800, color:'var(--accent)' }}
                      value={form.delivery_time}
                      onChange={e => setForm(f => ({ ...f, delivery_time: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>จำนวนจุดส่ง</label>
                    <input type="number" min="1" style={{ ...inputSt, textAlign:'center' }}
                      value={form.points_count}
                      onChange={e => setForm(f => ({ ...f, points_count: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>นาที/จุด</label>
                    <input type="number" min="1" style={{ ...inputSt, textAlign:'center' }}
                      value={form.time_per_point_min}
                      onChange={e => setForm(f => ({ ...f, time_per_point_min: e.target.value }))}
                    />
                  </div>
                </div>
                {form.delivery_time && (
                  <div style={{ fontSize:12, color:'#f59e0b', fontWeight:700 }}>
                    🏁 เสร็จประมาณ {addMins(form.delivery_time, (parseInt(form.points_count)||1)*(parseInt(form.time_per_point_min)||10))}
                    {' '}({form.points_count||1} จุด × {form.time_per_point_min||10} น.)
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>หมายเหตุ</label>
                <input style={inputSt}
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="เช่น รอบก่อนปิดกะ, เร่งด่วน..."
                />
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:20 }}>
              <button onClick={() => setShowModal(false)} style={{ ...btn('var(--bg2)', 'var(--text)'), border:'1px solid var(--border)' }}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btn('#0284c7'), opacity:saving ? 0.6 : 1 }}>
                {saving ? '...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN EXPORT
   ───────────────────────────────────────────────────────────────────────────── */
const TABS = [
  { key:'stock',    label:'📦 Stock' },
  { key:'kanban',   label:'🎴 Kanban Std' },
  { key:'delivery', label:'⏰ รอบจัดส่ง' },
];

export default function LineStock() {
  const { role, fullName } = useContext(UserContext);
  const canEdit = ['admin','manager','supervisor'].includes(role);
  const [activeTab, setActiveTab] = useState('stock');

  return (
    <div style={{ padding:'clamp(12px,2vw,24px)', maxWidth:1300, margin:'0 auto' }}>
      {/* Tab bar */}
      <div style={{ display:'flex', gap:4, marginBottom:20, borderBottom:'2px solid var(--border)', paddingBottom:0 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding:'9px 20px',
              fontSize:13,
              fontWeight:700,
              fontFamily:'var(--font-body)',
              border:'none',
              borderBottom: activeTab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom:-2,
              cursor:'pointer',
              borderRadius:'8px 8px 0 0',
              background: activeTab === t.key ? 'var(--bg2)' : 'transparent',
              color: activeTab === t.key ? 'var(--text)' : 'var(--muted)',
              transition:'color 0.15s, background 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'stock'    && <StockTab role={role} />}
      {activeTab === 'kanban'   && <KanbanStdTab canEdit={canEdit} fullName={fullName} />}
      {activeTab === 'delivery' && <DeliveryRoundsTab canEdit={canEdit} fullName={fullName} />}
    </div>
  );
}
