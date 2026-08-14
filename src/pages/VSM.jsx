/**
 * VSM — แผนผังสายธารคุณค่า (Value Stream Mapping) · เฟส 1 = Current state + พิมพ์ A3
 * ออกแบบ: docs/VSM-DESIGN.md
 *
 * flow: เลือก FG (100xxxxx) + เดือน → สร้างร่างจากข้อมูลจริง → แก้ค่าที่ระบบไม่รู้ → บันทึก → พิมพ์
 *
 * ⚠️ สูตรทั้งหมดอยู่ `src/lib/vsmModel.js` (ซึ่ง reuse utils/oee, stdManpower, companyCalendar)
 *    หน้านี้ทำหน้าที่ "โหลดข้อมูล + แสดงผล" เท่านั้น ห้ามคำนวณ OEE/CT/AT เองที่นี่
 */
import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { loadCompanyCalendar, countWorkingDaysInMonth } from '../utils/companyCalendar';
import { groupRoutings } from '../utils/routing';
import { buildVsmModel } from '../lib/vsmModel';
import { printVsm } from '../lib/vsmPrint';
import { printVsmA3 } from '../lib/vsmA3Print';
import VsmCanvas, { VsmLegend, PALETTE_DARK, PALETTE_LIGHT } from '../components/VsmCanvas';

const monthKeyNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthBounds = mk => {
  const [y, m] = mk.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${mk}-01`, to: `${mk}-${String(last).padStart(2, '0')}` };
};
const STATES = [
  { key: 'current', label: '📍 Current state' },
  { key: 'future', label: '🎯 Future state' },
  { key: 'ideal', label: '✨ Ideal state' },
];
const WARN_STYLE = {
  error: { bg: 'rgba(239,68,68,0.12)', bd: '#ef4444', icon: '⛔' },
  warn: { bg: 'rgba(245,158,11,0.12)', bd: '#f59e0b', icon: '⚠️' },
  info: { bg: 'rgba(59,130,246,0.10)', bd: '#3b82f6', icon: 'ℹ️' },
};

export default function VSM() {
  const { role, lineId, sections, fullName } = useContext(UserContext);
  const scopeSecs = sections || [];
  const canManage = can('vsm', 'manage', role);

  const [lines, setLines] = useState([]);
  const [products, setProducts] = useState([]);
  const [savedMaps, setSavedMaps] = useState([]);

  const [matNo, setMatNo] = useState('');
  const [monthKey, setMonthKey] = useState(monthKeyNow());
  const [state, setState] = useState('current');
  const [search, setSearch] = useState('');

  const [model, setModel] = useState(null);
  const [mapMeta, setMapMeta] = useState(null);       // แถว vsm_maps ที่กำลังแก้ (null = ยังไม่บันทึก)
  const [overrides, setOverrides] = useState({});
  const [busy, setBusy] = useState(false);
  const [rawRef, setRawRef] = useState(null);         // ข้อมูลดิบที่ใช้ generate (คำนวณซ้ำตอนแก้ override)
  const [showLoad, setShowLoad] = useState(false);
  const [a3, setA3] = useState({});                    // เนื้อหา A3 Report (เก็บใน vsm_maps.data.a3)
  const [showA3, setShowA3] = useState(false);

  const printRef = useRef(null);
  const isLight = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light';
  const palette = isLight ? PALETTE_LIGHT : PALETTE_DARK;

  /* ── master ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name, std_day_shift, std_night_shift')
      .order('name').then(({ data }) => setLines(data || []));
    supabaseDR.from('dr_products')
      .select('id, mat_no, name, p_no, customer, line_name, cycle_time_sec, process_type, is_active')
      .not('mat_no', 'is', null).order('name').then(({ data }) => setProducts(data || []));
    loadCompanyCalendar();
  }, []);

  // scope มาตรฐาน: leader = family ไลน์ตัวเอง · role อื่น = ตาม sections · ไม่มี scope = ทั้งหมด
  const scopeLineNames = useMemo(() => {
    if (role === 'leader' && lineId) {
      const me = lines.find(l => String(l.id) === String(lineId));
      return me ? new Set(getLineFamilyNames(lines, me.name).map(n => n.toLowerCase())) : null;
    }
    if (scopeSecs.length) return new Set(lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name.toLowerCase()));
    return null;
  }, [role, lineId, lines, scopeSecs]);

  // ตัวเลือก FG — เฉพาะเบอร์ 1 (สินค้าสำเร็จรูป) + กรองตาม scope (กฎ dropdown-scope)
  const fgOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (p.is_active === false) return false;
      if (!String(p.mat_no).startsWith('1')) return false;
      if (scopeLineNames && p.line_name && !scopeLineNames.has(String(p.line_name).toLowerCase())) return false;
      if (!q) return true;
      return [p.mat_no, p.name, p.p_no].some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [products, search, scopeLineNames]);

  const fgByLine = useMemo(() => {
    const g = {};
    fgOptions.forEach(p => { (g[p.line_name || '— ไม่ระบุไลน์'] ||= []).push(p); });
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]));
  }, [fgOptions]);

  const loadSaved = useCallback(async () => {
    const { data } = await supabaseDR.from('vsm_maps')
      .select('id, mat_no, title, state, period_from, period_to, status, updated_at, updated_by_name')
      .order('updated_at', { ascending: false }).limit(100);
    setSavedMaps(data || []);
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  /* ── สร้างร่างจากข้อมูลจริง ─────────────────────────────────────────────── */
  const generate = useCallback(async (keepOverrides = false) => {
    const fg = products.find(p => p.mat_no === matNo);
    if (!fg) { toast.error('เลือกสินค้า (FG) ก่อน'); return; }
    setBusy(true);
    try {
      const { from, to } = monthBounds(monthKey);
      const famNames = fg.line_name ? getLineFamilyNames(lines, fg.line_name) : [];

      // BOM ของ FG → รู้ว่าต้องดึง routing/สต๊อกของพาร์ทลูกตัวไหนบ้าง
      const { data: bomItems = [] } = await supabaseDR.from('bom_items')
        .select('mat_no, part_no, part_name, qty_per_unit, supplier, source_line')
        .eq('product_id', fg.id).eq('is_active', true);

      const allMats = [fg.mat_no, ...bomItems.map(b => b.mat_no)].filter(Boolean);
      const childLines = bomItems
        .map(b => products.find(p => p.mat_no === b.mat_no)?.line_name).filter(Boolean);
      const lineScope = [...new Set([...famNames, ...childLines.flatMap(n => getLineFamilyNames(lines, n))])];

      const [rt, ks, pm, sess, stock, fc, so, bp, dr] = await Promise.all([
        supabaseDR.from('part_routings').select('*').in('mat_no', allMats).eq('is_active', true).order('seq'),
        supabaseDR.from('kanban_standards').select('mat_no, lot_size, qty_per_kanban, total_kanban, min_qty, max_qty').in('mat_no', allMats),
        supabaseDR.from('parts_master').select('mat_no, part_name, part_no, uom, qty_per_pkg, supplier').in('mat_no', allMats),
        lineScope.length
          ? supabaseDR.from('production_sessions')
              .select('id, line_name, work_date, shift, shift_min, oee, oee_a, oee_p, oee_q, actual_qty, qty_ng, status')
              .in('line_name', lineScope).eq('status', 'closed')
              .gte('work_date', from).lte('work_date', to)
          : Promise.resolve({ data: [] }),
        supabaseDR.from('line_stock_summary').select('mat_no, qty_on_hand').in('mat_no', allMats),
        supabaseDR.from('customer_forecasts').select('mat_no, qty, period_month, source').eq('mat_no', fg.mat_no),
        supabaseDR.from('customer_shipping_orders').select('mat_no, qty, due_date').eq('mat_no', fg.mat_no)
          .gte('due_date', from).lte('due_date', to),
        supabaseDR.from('break_policies').select('*').eq('is_active', true),
        supabaseDR.from('kanban_delivery_rounds').select('id, line_name').eq('is_active', true).limit(200),
      ]);

      const sessions = sess.data || [];
      const sessionIds = sessions.map(s => s.id);
      // downtime — join ประเภทเพื่อเอา category (planned → เวลารับภาระ) + six_big_loss (setup → C/O)
      let dtRaw = [];
      for (let i = 0; i < sessionIds.length; i += 900) {        // .in() ยาวเกินไปจะโดนตัด
        const { data } = await supabaseDR.from('downtime_logs')
          .select('session_id, duration_min, dr_downtime_types(category, six_big_loss)')
          .in('session_id', sessionIds.slice(i, i + 900));
        dtRaw = dtRaw.concat(data || []);
      }
      const lineOf = Object.fromEntries(sessions.map(s => [s.id, s.line_name]));
      const downtimes = dtRaw.map(d => ({
        line_name: lineOf[d.session_id],
        duration_min: d.duration_min,
        category: d.dr_downtime_types?.category || null,
        six_big_loss: d.dr_downtime_types?.six_big_loss || null,
      }));
      // เวลารับภาระต่อกะ (ตัวถ่วงน้ำหนัก OEE ตามกฎ CLAUDE.md) = shift_min − planned downtime
      const plannedBySess = {};
      dtRaw.forEach(d => {
        if (d.dr_downtime_types?.category === 'planned')
          plannedBySess[d.session_id] = (plannedBySess[d.session_id] || 0) + (Number(d.duration_min) || 0);
      });
      sessions.forEach(s => { s.plannedMin = plannedBySess[s.id] || 0; });

      const stockByMat = {};
      (stock.data || []).forEach(r => { stockByMat[r.mat_no] = (stockByMat[r.mat_no] || 0) + (Number(r.qty_on_hand) || 0); });

      const raw = {
        fg, bomItems, products, partsMaster: pm.data || [], routings: groupRoutings(rt.data || []),
        kanbanStds: ks.data || [], lines, sessions, downtimes,
        breakPolicies: bp.data || [], stockByMat,
        forecasts: fc.data || [], shippingOrders: so.data || [],
        monthKey, workingDays: countWorkingDaysInMonth(monthKey, 0),
        deliveryRounds: (dr.data || []).filter(r => famNames.includes(r.line_name)),
      };
      const ov = keepOverrides ? overrides : {};
      setRawRef(raw);
      setOverrides(ov);
      setModel(buildVsmModel({ ...raw, overrides: ov }));
      if (!keepOverrides) setMapMeta(null);
      toast.success('สร้างร่างจากข้อมูลจริงแล้ว');
    } catch (e) {
      toast.error(e.message || 'สร้างร่างไม่สำเร็จ');
    } finally { setBusy(false); }
  }, [matNo, monthKey, products, lines, overrides]);

  // แก้ override → คำนวณใหม่ทันทีจากข้อมูลดิบชุดเดิม (ไม่ยิง DB ซ้ำ)
  const setOv = useCallback((key, field, value) => {
    setOverrides(prev => {
      const next = { ...prev, [key]: { ...(prev[key] || {}), [field]: value } };
      if (value === '' || value == null) delete next[key][field];
      if (rawRef) setModel(buildVsmModel({ ...rawRef, overrides: next }));
      return next;
    });
  }, [rawRef]);

  // override ระดับใบ (ไม่ผูกกับขั้น) — รอบส่ง supplier/ลูกค้า ที่ระบบไม่มีข้อมูล
  const setTopOv = useCallback((key, value) => {
    setOverrides(prev => {
      const next = { ...prev, [key]: value };
      if (value === '' || value == null) delete next[key];
      if (rawRef) setModel(buildVsmModel({ ...rawRef, overrides: next }));
      return next;
    });
  }, [rawRef]);

  const setSupPattern = useCallback((matNo, value) => {
    setOverrides(prev => {
      const pat = { ...(prev.__supplier_pattern || {}) };
      if (value) pat[matNo] = value; else delete pat[matNo];
      const next = { ...prev, __supplier_pattern: pat };
      if (rawRef) setModel(buildVsmModel({ ...rawRef, overrides: next }));
      return next;
    });
  }, [rawRef]);

  /* ── บันทึก / โหลด / พิมพ์ ──────────────────────────────────────────────── */
  const save = useCallback(async () => {
    if (!model || !rawRef) return;
    setBusy(true);
    const { from, to } = monthBounds(monthKey);
    const payload = {
      mat_no: matNo, state,
      title: mapMeta?.title || `${model.header.partName} · ${monthKey}`,
      period_from: from, period_to: to,
      effective_date: mapMeta?.effective_date || null,
      approved_by: mapMeta?.approved_by || null,
      checked_by: mapMeta?.checked_by || null,
      issued_by: mapMeta?.issued_by || fullName || null,
      data: { model, overrides, monthKey, a3 },
      generated_at: new Date().toISOString(),
      updated_by_name: fullName || null,
    };
    const q = mapMeta?.id
      ? supabaseDR.from('vsm_maps').update(payload).eq('id', mapMeta.id).select().single()
      : supabaseDR.from('vsm_maps').insert(payload).select().single();
    const { data, error } = await q;
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setMapMeta(data);
    toast.success('บันทึกใบ VSM แล้ว');
    loadSaved();
  }, [model, rawRef, matNo, state, monthKey, overrides, mapMeta, fullName, loadSaved]);

  const openSaved = useCallback(async (id) => {
    const { data, error } = await supabaseDR.from('vsm_maps').select('*').eq('id', id).single();
    if (error) { toast.error(error.message); return; }
    setMapMeta(data);
    setMatNo(data.mat_no);
    setState(data.state);
    setMonthKey(data.data?.monthKey || monthKeyNow());
    setOverrides(data.data?.overrides || {});
    setModel(data.data?.model || null);
    setA3(data.data?.a3 || {});
    setRawRef(null);                 // snapshot — ต้องกด "สร้างร่างใหม่" ถึงจะดึงข้อมูลสดอีกรอบ
    setShowLoad(false);
    toast.info('เปิดใบที่บันทึกไว้ (ตัวเลขเป็น snapshot ตอนบันทึก)');
  }, []);

  // ผังที่พิมพ์ = clone SVG ตัวจริงบนจอ (ชุดสีสว่างที่ render ซ่อนไว้) ห้ามวาด layout ใหม่ในตัวพิมพ์
  const printPayload = useCallback(() => {
    const host = printRef.current;
    const svgEl = host?.querySelector('svg');
    const legendEl = host?.querySelector('[data-legend]');
    if (!svgEl) return null;
    return {
      map: { ...(mapMeta || { state, title: `${model.header.partName} · ${monthKey}`, ...monthBounds(monthKey) }), a3 },
      model, svgHtml: svgEl.outerHTML, legendHtml: legendEl?.innerHTML || '',
    };
  }, [model, mapMeta, state, monthKey, a3]);

  const doPrint = useCallback(async (kind) => {
    if (!model) return;
    const payload = printPayload();
    if (!payload) { toast.error('ยังไม่มีผังให้พิมพ์'); return; }
    const ok = await (kind === 'a3' ? printVsmA3(payload) : printVsm(payload));
    if (!ok) toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup ของเว็บนี้ก่อน');
  }, [model, printPayload]);

  /* ── UI ─────────────────────────────────────────────────────────────────── */
  const S = { card: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14 } };
  const btn = (bg, extra = {}) => ({
    padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 700, background: bg, color: '#08130a', fontFamily: 'var(--font-body)', ...extra,
  });

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 'min(98vw, 2200px)', margin: '0 auto' }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          🗺️ แผนผังสายธารคุณค่า (Value Stream Map)
        </h1>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          เลือกสินค้าสำเร็จรูป → ระบบดึง CT · %OEE · C/O · LOT · คงคลัง · TT จากข้อมูลจริงมาสร้างผังให้
        </div>
      </div>

      {/* ── แถบควบคุม ── */}
      <div style={{ ...S.card, marginBottom: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 320px', minWidth: 260 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>สินค้าสำเร็จรูป (FG · เบอร์ 1)</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหา MAT / ชื่อ / P/N…"
            style={{ marginBottom: 6, fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }} />
          <select value={matNo} onChange={e => setMatNo(e.target.value)}
            style={{ fontSize: 13, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }}>
            <option value="">— เลือกสินค้า —</option>
            {fgByLine.map(([ln, ps]) => (
              <optgroup key={ln} label={ln}>
                {ps.map(p => <option key={p.id} value={p.mat_no}>{p.mat_no} · {p.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>เดือนข้อมูล</label>
          <input type="month" value={monthKey} onChange={e => setMonthKey(e.target.value)}
            style={{ width: 150, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>สถานะผัง</label>
          <select value={state} onChange={e => setState(e.target.value)}
            style={{ width: 170, fontSize: 13, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }}>
            {STATES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => generate(false)} disabled={!matNo || busy} style={btn('var(--accent)', { opacity: (!matNo || busy) ? 0.5 : 1 })}>
            {busy ? '⏳ กำลังดึง…' : '⚡ สร้างร่างจากข้อมูลจริง'}
          </button>
          {model && rawRef && (
            <button onClick={() => generate(true)} disabled={busy} style={btn('var(--bg3)', { color: 'var(--text)' })}>↻ ดึงข้อมูลใหม่</button>
          )}
          {model && canManage && <button onClick={save} disabled={busy} style={btn('#3b82f6', { color: '#fff' })}>💾 บันทึก</button>}
          {model && <button onClick={() => doPrint('a3')} style={btn('#f59e0b')}>📋 A3 Report (Toyota)</button>}
          {model && <button onClick={() => doPrint('sheet')} style={btn('var(--bg3)', { color: 'var(--text)' })}>🖨️ ใบ VSM</button>}
          {model && <button onClick={() => setShowA3(v => !v)} style={btn('var(--bg3)', { color: 'var(--text)' })}>✍️ เนื้อหา A3</button>}
          <button onClick={() => setShowLoad(v => !v)} style={btn('var(--bg3)', { color: 'var(--text)' })}>📂 ใบที่บันทึกไว้ ({savedMaps.length})</button>
        </div>
      </div>

      {showLoad && (
        <div style={{ ...S.card, marginBottom: 14, maxHeight: 260, overflowY: 'auto' }}>
          {!savedMaps.length && <div style={{ fontSize: 13, color: 'var(--muted)' }}>ยังไม่มีใบที่บันทึกไว้</div>}
          {savedMaps.map(m => (
            <div key={m.id} onClick={() => openSaved(m.id)}
              style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 8px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)' }}>
              <span style={{ fontWeight: 700, minWidth: 92 }}>{m.mat_no}</span>
              <span style={{ flex: 1 }}>{m.title}</span>
              <span style={{ color: 'var(--muted)' }}>{STATES.find(s => s.key === m.state)?.label}</span>
              <span style={{ color: 'var(--muted)' }}>{m.period_from} → {m.period_to}</span>
              <span style={{ color: 'var(--muted)' }}>{m.updated_by_name || ''}</span>
            </div>
          ))}
        </div>
      )}

      {!model && (
        <div style={{ ...S.card, textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 14 }}>
          เลือกสินค้าสำเร็จรูปแล้วกด <b style={{ color: 'var(--text)' }}>⚡ สร้างร่างจากข้อมูลจริง</b>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            ลำดับกระบวนการ (ปั๊ม → ประกอบ → …) ตั้งที่ <b>Product Master → 🔀 Routing</b> —
            ยังไม่ได้ตั้ง ระบบจะใช้ไลน์เดียวจาก Product Master ไปก่อนแล้วเตือนไว้
          </div>
        </div>
      )}

      {model && showA3 && (
        <div style={{ ...S.card, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>✍️ เนื้อหา A3 Report (Toyota / Denso)</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>
            ช่อง <b>② สภาพปัจจุบัน</b> ระบบสรุปข้อเท็จจริง + ผัง VSM ให้เอง — ที่เหลือเป็นการวิเคราะห์ของคน ระบบไม่เดาให้
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, alignContent: 'start' }}>
            {[
              ['title', 'หัวเรื่อง A3', 'เช่น ลด Lead time สาย REINF ASY BDY SD RR', 2],
              ['background', '① ความเป็นมา / เหตุผลที่ต้องทำ', 'ทำไมต้องทำเรื่องนี้ · กระทบใคร · เกี่ยวกับนโยบายอะไร', 4],
              ['target', '③ เป้าหมาย (วัดได้)', 'เช่น ลด PLT จาก 81 → 60 วัน ภายใน ธ.ค.', 3],
              ['rootCause', '④ วิเคราะห์สาเหตุราก (5 Why / ก้างปลา)', 'ทำไม → ทำไม → ทำไม …', 4],
              ['countermeasures', '⑤ มาตรการแก้ไข', 'จะแก้ที่จุดไหน ด้วยวิธีอะไร', 4],
              ['followup', '⑦ ติดตามผล', 'วัดผลเมื่อไหร่ ด้วยตัวชี้วัดอะไร ใครตรวจ', 3],
            ].map(([k, label, ph, rows]) => (
              <div key={k} style={{ gridColumn: k === 'title' ? '1 / -1' : undefined }}>
                <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{label}</label>
                <textarea rows={rows} value={a3[k] || ''} onChange={e => setA3(v => ({ ...v, [k]: e.target.value }))}
                  placeholder={ph}
                  style={{ width: '100%', fontSize: 12.5, padding: '7px 10px', borderRadius: 6, resize: 'vertical',
                    border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontFamily: 'var(--font-body)' }} />
              </div>
            ))}
          </div>

          {/* ⑥ แผนดำเนินการ */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>⑥ แผนดำเนินการ (ใคร / อะไร / เมื่อไหร่)</label>
              <button onClick={() => setA3(v => ({ ...v, plan: [...(v.plan || []), { what: '', who: '', when: '', status: '' }] }))}
                style={{ padding: '4px 12px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>
                + เพิ่มแถว
              </button>
            </div>
            {(a3.plan || []).map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 120px 110px 32px', gap: 6, marginBottom: 5 }}>
                {[['what', 'สิ่งที่ต้องทำ'], ['who', 'ผู้รับผิดชอบ'], ['when', 'กำหนดเสร็จ'], ['status', 'สถานะ']].map(([f, ph]) => (
                  <input key={f} value={r[f] || ''} placeholder={ph}
                    onChange={e => setA3(v => ({ ...v, plan: v.plan.map((x, j) => j === i ? { ...x, [f]: e.target.value } : x) }))}
                    style={{ fontSize: 12, padding: '5px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }} />
                ))}
                <button onClick={() => setA3(v => ({ ...v, plan: v.plan.filter((_, j) => j !== i) }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>🗑</button>
              </div>
            ))}
            {!(a3.plan || []).length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีแถว — กด "+ เพิ่มแถว"</div>}
          </div>
        </div>
      )}

      {model && <>
        {/* ── ช่องที่ระบบไม่มีข้อมูล (ห้ามเดาแทนผู้ใช้) ── */}
        {!!model.warnings.length && (
          <div style={{ marginBottom: 12, display: 'grid', gap: 6 }}>
            {model.warnings.map((w, i) => {
              const st = WARN_STYLE[w.level] || WARN_STYLE.info;
              return <div key={i} style={{ background: st.bg, borderLeft: `3px solid ${st.bd}`, borderRadius: 6, padding: '7px 12px', fontSize: 12.5, color: 'var(--text)' }}>
                {st.icon} {w.text}
              </div>;
            })}
          </div>
        )}

        {/* ── ผัง ── */}
        <div style={{ ...S.card, padding: 8, marginBottom: 14, overflowX: 'auto' }}>
          <VsmCanvas model={model} palette={palette} />
        </div>

        {/* ── ตารางแก้ค่า ── */}
        <div style={{ ...S.card, marginBottom: 14, overflowX: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>ปรับค่าในกล่องกระบวนการ</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
            ช่องว่าง = ใช้ค่าที่ระบบคำนวณให้ · กรอกทับเมื่อค่าจริงไม่ตรง ·
            <b style={{ color: '#f59e0b' }}> คงคลังระหว่างทาง (WIP) ระบบไม่ได้เก็บ ต้องกรอกเอง</b>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr style={{ background: 'var(--bg2)' }}>
              {['ขั้น', 'กระบวนการ', 'ไลน์', 'C/T (sec)', 'C/O (sec)', '%OEE', 'LOT', 'คน', 'คงคลังหลังขั้นนี้ (pcs)'].map(h =>
                <th key={h} style={{ padding: '7px 8px', fontSize: 11.5, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {model.chain.map((b, i) => {
                const ov = overrides[b.key] || {};
                const cell = (field, val, src) => (
                  <td style={{ padding: '4px 6px', borderTop: '1px solid var(--border)' }}>
                    <input value={ov[field] ?? ''} onChange={e => setOv(b.key, field, e.target.value)}
                      placeholder={val == null ? '—' : String(Math.round(val * 10) / 10)}
                      title={src ? `ค่าที่ระบบคำนวณ: ${val ?? '—'} (จาก ${src})` : 'ระบบไม่มีข้อมูล'}
                      style={{
                        width: 82, fontSize: 12, padding: '4px 6px', borderRadius: 5, background: 'var(--bg2)', color: 'var(--text)',
                        border: `1px solid ${val == null && !ov[field] ? '#f59e0b' : 'var(--border)'}`,
                      }} />
                  </td>
                );
                const isLast = i === model.chain.length - 1;
                return <tr key={b.key}>
                  <td style={{ padding: '6px 8px', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>{i + 1}</td>
                  <td style={{ padding: '6px 8px', fontSize: 12.5, fontWeight: 700, color: 'var(--text)', borderTop: '1px solid var(--border)' }}>
                    {b.name}{b.isOutsourced && <span style={{ color: '#a78bfa', fontWeight: 400 }}> · จ้างนอก</span>}
                    {b.isFallback && <span style={{ color: '#ef4444', fontWeight: 400, fontSize: 11 }}> · ยังไม่ลง routing</span>}
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>{b.line || '—'}</td>
                  {cell('ct_sec', b.ct, b.ctSrc)}
                  {cell('setup_sec', b.setupSec, b.setupSrc)}
                  {cell('oee_pct', b.oeePct, b.oeeSrc)}
                  {cell('lot_size', b.lotSize, b.lotSrc)}
                  {cell('operators', b.operators, b.opSrc)}
                  <td style={{ padding: '4px 6px', borderTop: '1px solid var(--border)' }}>
                    {isLast ? <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ใช้ยอด FG Warehouse</span> : cell('wip_qty', b.wipQty, b.wipQty != null ? 'routing' : null)}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>

        {/* ── ข้อมูลที่ระบบไม่มี ต้องกรอกเอง ── */}
        <div style={{ ...S.card, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>รอบส่ง (ระบบยังไม่เก็บ — กรอกเอง)</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
            รูปแบบตามใบเดิมของบริษัท เช่น <b>7:1:1</b> (ผู้ส่งมอบ) · <b>1:4:2</b> (ลูกค้า)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, alignContent: 'start' }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                🚚 ลูกค้า — {model.customer.name || model.header.customer || 'ไม่ระบุ'}
              </label>
              <input value={overrides.__customer_pattern || ''} onChange={e => setTopOv('__customer_pattern', e.target.value)}
                placeholder={model.customer.roundsPerDay ? `ระบบเห็น ${model.customer.roundsPerDay} รอบ/วัน` : 'เช่น 1:4:2'}
                style={{ width: '100%', fontSize: 12.5, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }} />
            </div>
            {model.suppliers.map(sp => (
              <div key={sp.matNo}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  🏭 {sp.supplier || 'ยังไม่ระบุผู้ส่งมอบ'} · {sp.matNo}
                </label>
                <input value={(overrides.__supplier_pattern || {})[sp.matNo] || ''} onChange={e => setSupPattern(sp.matNo, e.target.value)}
                  placeholder="เช่น 7:1:1"
                  style={{ width: '100%', fontSize: 12.5, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }} />
              </div>
            ))}
            {!model.suppliers.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>BOM ของสินค้านี้ยังไม่มีพาร์ทซื้อนอก</div>}
          </div>
        </div>

        {/* ── สรุป + สัญลักษณ์ ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: 14, alignItems: 'start', marginBottom: 14 }}>
          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>สรุปสายธาร</div>
            {[
              ['PLT (Production Lead Time)', model.totals.pltDays == null ? '—' : `${model.totals.pltDays} วัน`],
              ['PT (Processing Time)', `${(model.totals.ptSec || 0).toLocaleString('th-TH')} sec`],
              ['%VA (Value Added)', model.totals.vaPct == null ? '—' : `${model.totals.vaPct}%`],
              ['Takt Time', model.info.ttSec == null ? '—' : `${model.info.ttSec} sec`],
              ['Available Time', model.info.atSec == null ? '—' : `${model.info.atSec.toLocaleString('th-TH')} sec/วัน`],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                <span style={{ color: 'var(--muted)' }}>{k}</span>
                <span style={{ color: 'var(--text)', fontWeight: 700 }}>{v}</span>
              </div>
            ))}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
              %VA = VA ÷ (VA + NVA) × 100 &nbsp;โดย NVA = PLT × A/T
              <br />(สูตรเดียวกับใบ VSM กระดาษของบริษัท)
            </div>
          </div>
          <div data-legend><VsmLegend palette={palette} /></div>
        </div>
      </>}

      {/* ── ตัวพิมพ์: render ซ้ำด้วยชุดสีสว่าง แล้วให้ vsmPrint clone outerHTML ไปใช้ ── */}
      <div ref={printRef} style={{ position: 'absolute', left: -99999, top: 0, width: 1600, pointerEvents: 'none' }} aria-hidden>
        {model && <>
          <VsmCanvas model={model} palette={PALETTE_LIGHT} />
          <div data-legend><VsmLegend palette={PALETTE_LIGHT} /></div>
        </>}
      </div>
    </div>
  );
}
