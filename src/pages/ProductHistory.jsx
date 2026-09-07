import { useState, useEffect, useMemo, useContext, useCallback, Fragment } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import CollapseCardBase from '../components/CollapseCard';
import PageHeader from '../components/PageHeader';
import DailyBars from '../components/DailyBars';
import DemandVsProduction from '../components/DemandVsProduction';
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';

// ประวัติผลิตราย Product — ดูย้อนหลังว่าสินค้าตัวหนึ่งผลิตที่ไลน์ไหน/กะไหน เท่าไหร่ เสียเท่าไหร่ (2026-07-24)
// + ประวัติการแก้ master data ของสินค้านั้น (audit_log — ใครแก้ line_name/CT เมื่อไหร่)

const todayStr = () => {
  const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
const fmtDate = s => { if (!s) return '—'; const [, m, d] = s.split('-'); return `${+d}/${+m}`; };
const fmtDayFull = s => { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('th-TH', { weekday: 'short', day: '2-digit', month: '2-digit' }); };
const STATUS_TH = s => s === 'confirmed' ? '✓ ปิด' : s === 'carry_over' ? '➡ ยกยอด' : s === 'cancelled' ? '✕ ยกเลิก' : s === 'open' ? '● ผลิต' : s;
const fmtDT = t => t ? new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const AUDIT_FIELD_TH = { line_name: 'ไลน์', cycle_time_sec: 'Cycle Time', name: 'ชื่อ', p_no: 'P/N', pair_mat_no: 'คู่ RH/LH', is_active: 'สถานะใช้งาน', customer: 'ลูกค้า' };

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' };

// Section ย่อ/ขยายได้ — ย้ายเป็น component กลาง src/components/CollapseCard.jsx (ใช้ร่วมกับ OrderTrace · 2026-07-30)
const CollapseCard = (props) => <CollapseCardBase storePrefix="ph" {...props} />;

export default function ProductHistory() {
  const { role, lineId, sections } = useContext(UserContext);
  const scopeSecs = sections || [];

  const [products, setProducts] = useState([]);
  const [lines, setLines]       = useState([]);
  const [search, setSearch]     = useState('');
  const [filterLine, setFilterLine] = useState('');
  const [selMat, setSelMat]     = useState(null);   // product object
  /* โหมดรวมกลุ่ม (2026-08-19 · คำสั่ง user "บางรายการเป็น product เดียวกัน ต่างที่ปลายทางที่ส่งลูกค้า
     เลยต้องแยก mat sap") — จับกลุ่มด้วย p_no (เลขพาร์ทลูกค้า) เพราะเป็นตัวที่ลูกค้าสั่งจริง
     ⚠️ ไม่ใช่แค่ความสะดวก: ออเดอร์มักถูกบันทึกใต้ mat ตัวเดียวของกลุ่ม (ข้อมูลจริง RB3B-16E060-BA
     → ออเดอร์ 7,350 อยู่ใต้ 10100384 ทั้งหมด) ดูราย mat จึงเห็น "ขาด/เกิน" ที่ไม่จริง */
  const [groupMode, setGroupMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(true);  // เลือกสินค้าแล้วพับลิสต์อัตโนมัติ (ข้อมูลเยอะ)
  const [showAllDays, setShowAllDays] = useState(false); // ตารางใบผลิตแสดง 45 วันแรกก่อน
  const [openDays, setOpenDays]     = useState(() => new Set());   // drill: วัน → ไลน์·กะ → ใบ
  const [openShifts, setOpenShifts] = useState(() => new Set());
  const toggleSet = (setter, key) => setter(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const [from, setFrom]         = useState(() => addDays(todayStr(), -90));
  const [to, setTo]             = useState(todayStr);
  const [orders, setOrders]     = useState([]);
  const [defects, setDefects]   = useState([]);
  const [audit, setAudit]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [loadWarn, setLoadWarn] = useState('');   // โหลดไม่ครบ → แถบเตือน (ห้ามเงียบ)

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

  /* พี่น้องในกลุ่มเดียวกัน = p_no ตรงกัน (normalize ขีด/ช่องว่าง) · ไม่มี p_no = อยู่ตัวเดียว */
  const normPn = (v) => String(v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const groupMats = useMemo(() => {
    if (!selMat) return [];
    const k = normPn(selMat.p_no);
    if (!k) return [selMat];
    return products.filter(p => normPn(p.p_no) === k);
  }, [selMat, products]);
  const canGroup = groupMats.length > 1;
  /* mat ที่ query จริง — โหมดกลุ่ม = ทุกตัวในกลุ่ม · โหมดเดี่ยว = ตัวที่เลือก */
  const activeMats = useMemo(
    () => (groupMode && canGroup ? groupMats : selMat ? [selMat] : []),
    [groupMode, canGroup, groupMats, selMat],
  );

  const loadHistory = useCallback(async (mats) => {
    if (!mats?.length) return;
    setLoading(true);
    // ใบผลิตของ mat ที่เลือก (เดี่ยวหรือทั้งกลุ่ม) + join session (line/date/shift/oee)
    /* ⚠️ ต้องแบ่งหน้า — `.limit(2000)` ใช้ไม่ได้จริง PostgREST clamp ที่ 1000 เสมอ (audit 2026-09-02)
       วัดฐานจริง: ช่วง default 90 วัน มีใบผลิต **10,980 ใบ** ⇒ เดิมเห็นแค่ 9%
       ⇒ "ผลิตรวม/เป้ารวม/NG รวม" ต่ำกว่าจริงมหาศาล และ `prodByDay` ที่ป้อน <DemandVsProduction>
          ก็ขาดไปด้วย ขณะที่ฝั่ง demand ดึงครบ → สต็อกจำลองติดลบ → ขึ้น "🔴 ขาด N" ทั้งที่ผลิตครบ
          = สั่งเร่งผลิตซ้ำโดยไม่จำเป็น
       (`id` ปิดท้าย order เสมอ — `opened_at` ซ้ำกันได้เพราะสแกนรวบ ถ้าไม่มีคีย์ unique แถวจะหลุด/ซ้ำระหว่างหน้า) */
    const ordRes = await fetchAllPages(() => supabaseDR.from('prod_orders')
      .select('id, prod_no, mat_no, machine_no, qty, qty_target, qty_actual, qty_ok, status, opened_at, confirmed_at, carry_over_note, production_sessions!inner(line_name, work_date, shift, oee, status)')
      .in('mat_no', mats.map(m => m.mat_no))
      .gte('production_sessions.work_date', from).lte('production_sessions.work_date', to),
      { orderBy: ['opened_at', 'id'] });
    // fetchAllPages เรียงขึ้นเสมอ (ต้องคงที่คู่กับ .range) — ใบล่าสุดขึ้นก่อนเป็นเรื่องการแสดงผล เรียงกลับที่นี่
    const ord = ordRes.rows.slice().reverse();
    const ordWarn = ordRes.error ? 'โหลดใบผลิตไม่สำเร็จ' : (ordRes.truncated ? 'ใบผลิตโหลดได้ไม่ครบ' : '');
    /* ⚠️ defect_logs **ไม่มีคอลัมน์ mat_no** — ผูกกับสินค้าผ่าน prod_order_id เท่านั้น
       เดิม .eq('mat_no', …) → 42703 → def = [] เงียบๆ → "NG รวม" ขึ้น 0 เสมอ ทุกสินค้า
       (เจอจากภาพหน้าจอจริง: 1,000 ใบ แต่ NG รวม = 0) */
    const oIds = (ord || []).map(o => o.id);
    /* แบ่งก้อน id อย่างเดียวไม่พอ — ต้องแบ่งหน้าด้วย (120 ใบ × ของเสียใบละหลายแถว เกิน 1000 ได้)
       ⇒ ใช้ fetchByIds ที่ทำครบ 3 ชั้น (ก้อน id + หน้า + order คงที่) ในบรรทัดเดียว */
    const defRes = await fetchByIds(oIds, (c) => supabaseDR.from('defect_logs')
      .select('prod_order_id, qty_ng, qty_suspect, dr_defect_types(name_th)')
      .in('prod_order_id', c));
    const def = defRes.rows;
    const defWarn = defRes.error ? 'โหลดของเสียไม่สำเร็จ' : (defRes.truncated ? 'ของเสียโหลดได้ไม่ครบ' : '');
    // audit ของแถว dr_products นี้ (best-effort — ถ้ายังไม่ apply migration audit_log จะว่าง)
    let auditRows = [];
    try {
      const { data: a } = await supabaseDR.from('audit_log')
        .select('action, actor, changed_fields, old_data, new_data, changed_at')
        .eq('table_name', 'dr_products').in('row_pk', mats.map(m => String(m.id)))
        .order('changed_at', { ascending: false }).limit(200);
      auditRows = a || [];
    } catch { auditRows = []; }
    setOrders(ord || []); setDefects(def); setAudit(auditRows);
    // ⚠️ โหลดไม่ครบ = ตัวเลขบนหน้านี้ต่ำกว่าจริง ต้องบอกเสมอ ห้ามให้ดูเหมือนข้อมูลครบ
    setLoadWarn([ordWarn, defWarn].filter(Boolean).join(' · '));
    setLoading(false);
  }, [from, to]);

  useEffect(() => { if (activeMats.length) loadHistory(activeMats); }, [activeMats, loadHistory]);

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

  /* ผลิตแยกราย MAT — โหมดกลุ่มต้องเห็นว่าเลขไหนผลิตไปเท่าไหร่ (ไลน์เดียวกันแต่คนละปลายทาง) */
  const byMat = useMemo(() => {
    const m = {};
    rows.forEach(r => {
      const k = r.mat_no || '—';
      (m[k] = m[k] || { mat: k, produced: 0, ng: 0, orders: 0 });
      m[k].produced += r.produced || 0; m[k].ng += r.ng || 0; m[k].orders++;
    });
    return Object.values(m).sort((a, b) => b.produced - a.produced);
  }, [rows]);

  const summary = useMemo(() => {
    const produced = rows.reduce((s, r) => s + (r.produced || 0), 0);
    const target = rows.reduce((s, r) => s + (r.target || 0), 0);
    const ng = rows.reduce((s, r) => s + (r.ng || 0), 0);
    const linesUsed = [...new Set(rows.map(r => r.line).filter(Boolean))];
    const byLine = {};
    rows.forEach(r => { const k = r.line || '—'; (byLine[k] = byLine[k] || { line: k, produced: 0, ng: 0, orders: 0 }); byLine[k].produced += r.produced || 0; byLine[k].ng += r.ng || 0; byLine[k].orders++; });
    return { produced, target, ng, orders: rows.length, linesUsed, byLine: Object.values(byLine).sort((a, b) => b.produced - a.produced) };
  }, [rows]);

  // โครง drill-down: วัน → (ไลน์·กะ) → รายใบ — วันล่าสุดขึ้นบน
  const dayGroups = useMemo(() => {
    const m = new Map();
    rows.forEach(r => {
      const d = r.work_date || '—';
      if (!m.has(d)) m.set(d, { date: d, produced: 0, target: 0, ng: 0, orders: 0, shifts: new Map() });
      const g = m.get(d);
      g.produced += r.produced || 0; g.target += r.target || 0; g.ng += r.ng || 0; g.orders++;
      const sk = `${r.line || '—'}|${r.shift || ''}`;
      if (!g.shifts.has(sk)) g.shifts.set(sk, { line: r.line, shift: r.shift, produced: 0, target: 0, ng: 0, items: [] });
      const s = g.shifts.get(sk);
      s.produced += r.produced || 0; s.target += r.target || 0; s.ng += r.ng || 0; s.items.push(r);
    });
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date))
      .map(g => ({ ...g, shifts: [...g.shifts.values()].sort((a, b) => String(a.shift).localeCompare(String(b.shift)) || String(a.line).localeCompare(String(b.line))) }));
  }, [rows]);

  // trend รายวัน — แกนวันต่อเนื่อง ไม่ข้ามวัน (วันไม่ผลิต = ช่องว่างให้เห็น)
  const daily = useMemo(() => {
    const m = {};
    rows.forEach(r => { if (!r.work_date) return; (m[r.work_date] = m[r.work_date] || { d: r.work_date, produced: 0, ng: 0 }); m[r.work_date].produced += r.produced || 0; m[r.work_date].ng += r.ng || 0; });
    const keys = Object.keys(m).sort();
    if (!keys.length) return [];
    // เดินวันแรกที่มีข้อมูล → min(สิ้นช่วงที่เลือก, วันนี้) — เห็นวันหยุด/วันไม่ผลิตคาตา
    const t = todayStr();
    let end = to < t ? to : t;
    if (end < keys[keys.length - 1]) end = keys[keys.length - 1];
    const out = [];
    for (let d = keys[0]; d <= end && out.length < 400; d = addDays(d, 1)) out.push(m[d] || { d, produced: 0, ng: 0, empty: true });
    return out;
  }, [rows, to]);
  const dailyMax = Math.max(1, ...daily.map(d => (d.produced || 0) + (d.ng || 0)));
  /* ผลิตต่อวัน **แยกราย MAT** — ป้อนให้แผงเทียบความต้องการลูกค้า
     ⚠️ ห้ามยุบรวมข้าม mat: product เดียวกันที่แยกเลข SAP ตามปลายทางลูกค้า แลกของกันไม่ได้จริง
        (ยอดใน SAP จะเพี้ยน — คำสั่ง user 2026-08-19) การตัดสินพอ/ขาดต้องคิดทีละเลข */
  const prodByDay = useMemo(() => {
    const m = {};
    rows.forEach(r => {
      if (!r.work_date || !r.mat_no) return;
      (m[r.mat_no] = m[r.mat_no] || {});
      m[r.mat_no][r.work_date] = (m[r.mat_no][r.work_date] || 0) + (r.produced || 0);
    });
    return m;
  }, [rows]);

  // ตัวเลือกสินค้าต้อง scope ด้วย (กฎ dropdown-scope 2026-07-23) — สินค้าไลน์นอก scope ไม่โชว์ให้เลือก
  // สินค้าที่ยังไม่ระบุไลน์คงโชว์ไว้ (fail-open เฉพาะ null — ไม่ใช่ข้ามส่วนงาน)
  const scopedProducts = useMemo(() => {
    if (!scopeLineNames) return products;
    return products.filter(p => !p.line_name || scopeLineNames.has(p.line_name.trim().toLowerCase()));
  }, [products, scopeLineNames]);

  // dropdown ไลน์จัดชั้นตามผัง (กฎ §5.3 — เดิมลิสต์แบนเรียง ก-ฮ แม่ลูกปนกัน user ทัก 2026-08-18):
  // optgroup = กลุ่มบนสุดตาม parent_line_name · แม่ขึ้นก่อนในกลุ่ม ลูกมี ↳ นำหน้า
  // ชื่อที่ไม่อยู่ใน production_lines = optgroup "⚠ นอกผัง" ห้ามซ่อน (กฎ worklist — ซ่อนแล้วหาของผิดไม่เจอ)
  const lineGroups = useMemo(() => {
    const names = [...new Set(scopedProducts.map(p => (p.line_name || '').trim()).filter(Boolean))];
    const byName = {}; lines.forEach(l => { byName[l.name] = l; });
    const topOf = (n) => {
      let cur = byName[n]; if (!cur) return null;
      const seen = new Set();
      while (cur.parent_line_name && byName[cur.parent_line_name] && !seen.has(cur.name)) { seen.add(cur.name); cur = byName[cur.parent_line_name]; }
      return cur.name;
    };
    const sortTh = (a, b) => a.localeCompare(b, 'th');
    const groups = {}; const off = [];
    names.forEach(n => {
      const t = topOf(n);
      if (!t) { off.push(n); return; }
      (groups[t] = groups[t] || []).push(n);
    });
    return {
      groups: Object.keys(groups).sort(sortTh).map(t => ({
        top: t,
        names: groups[t].sort((a, b) => (a === t ? -1 : b === t ? 1 : sortTh(a, b))),
      })),
      off: off.sort(sortTh),
    };
  }, [scopedProducts, lines]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = scopedProducts;
    if (filterLine) list = list.filter(p => (p.line_name || '').trim() === filterLine);
    if (q) list = list.filter(p => (p.mat_no || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q) || (p.p_no || '').toLowerCase().includes(q));
    return list;
  }, [scopedProducts, filterLine, search]);

  // จัดกลุ่มตามไลน์ให้อ่านง่าย (แทน chip กองรวม) — จำกัด 300 แถวกัน DOM บวม
  const productGroups = useMemo(() => {
    const m = new Map();
    for (const p of filteredProducts.slice(0, 300)) {
      const k = (p.line_name || '').trim() || '— ไม่ระบุไลน์';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'th'));
  }, [filteredProducts]);

  const th = { textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, padding: '6px 8px', borderBottom: '1px solid var(--border2)', whiteSpace: 'nowrap' };
  const td = { fontSize: 12, padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };

  return (
    <div style={{ padding: '16px 20px', maxWidth: 1400, margin: '0 auto' }}>
      <PageHeader
        title="ประวัติผลิต (by Product)" icon="📜"
        sub="เลือกสินค้าเพื่อดูว่าเคยผลิตที่ไลน์ไหน/กะไหน เท่าไหร่ เสียเท่าไหร่ + ประวัติการแก้ไขข้อมูลสินค้า (ใครแก้เมื่อไหร่)"
      />

      {/* ⚠️ โหลดไม่ครบ = ทุกตัวเลขในหน้านี้ต่ำกว่าจริง (รวมทั้งแผงเทียบความต้องการลูกค้าที่บอก "ขาด/พอ")
          ห้ามปล่อยให้ดูเหมือนข้อมูลครบ — กฎ "ห้ามล้มเหลวเงียบ" */}
      {loadWarn && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444',
        }}>
          ⚠ {loadWarn} — ตัวเลขในหน้านี้ต่ำกว่าความจริง อย่าเพิ่งใช้ตัดสินใจ (ลองแคบช่วงวันที่ลง แล้วโหลดใหม่)
        </div>
      )}

      {/* ตัวเลือกสินค้า + ช่วงวันที่ */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ค้นหาสินค้า (MAT.NO / ชื่อ / P/N)</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="เช่น 50029377, REINF, B222"
              style={{ marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ไลน์</label>
            <select value={filterLine} onChange={e => setFilterLine(e.target.value)} style={{ marginTop: 4, width: 200 }}>
              <option value="">ทุกไลน์</option>
              {lineGroups.groups.map(g => (
                <optgroup key={g.top} label={g.top}>
                  {g.names.map(n => <option key={n} value={n}>{n === g.top ? n : `↳ ${n}`}</option>)}
                </optgroup>
              ))}
              {lineGroups.off.length > 0 && (
                <optgroup label="⚠ นอกผัง (ชื่อไลน์ไม่ตรงทะเบียนไลน์ผลิต)">
                  {lineGroups.off.map(n => <option key={n} value={n}>{n}</option>)}
                </optgroup>
              )}
            </select>
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
        {/* ผลค้นหา — ลิสต์จัดกลุ่มตามไลน์ (เลื่อนในกรอบ) · เลือกแล้วพับอัตโนมัติ กดหัวเพื่อกางเปลี่ยนสินค้า */}
        <div style={{ marginTop: 10 }}>
          <div onClick={() => setPickerOpen(o => !o)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none', marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              พบ <b>{filteredProducts.length.toLocaleString()}</b> รายการ{filteredProducts.length > 300 ? ' · แสดง 300 แรก — พิมพ์ค้นหา/เลือกไลน์เพื่อกรองเพิ่ม' : ''}
              {pickerOpen ? ' · คลิกสินค้าเพื่อดูประวัติ' : selMat ? ` · เลือกอยู่: ${selMat.mat_no} — กดเพื่อเปลี่ยนสินค้า` : ' · กดเพื่อแสดงรายการ'}
            </div>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{pickerOpen ? '▲' : '▼'}</span>
          </div>
          {pickerOpen && (
          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border2)', borderRadius: 8, background: 'var(--bg2)' }}>
            {productGroups.map(([line, items]) => (
              <div key={line}>
                <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg3)', padding: '5px 12px',
                  fontSize: 11, fontWeight: 800, color: 'var(--accent)', borderBottom: '1px solid var(--border2)' }}>
                  🏭 {line} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>· {items.length} รายการ</span>
                </div>
                {items.map(p => {
                  const sel = selMat?.id === p.id;
                  return (
                    <div key={p.id} onClick={() => { setSelMat(p); setPickerOpen(false); setShowAllDays(false); setOpenDays(new Set()); setOpenShifts(new Set()); }}
                      style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 12px', cursor: 'pointer',
                        borderBottom: '1px solid var(--border)',
                        background: sel ? 'var(--accent)' : 'transparent', color: sel ? '#08131f' : 'var(--text)' }}>
                      <span style={{ fontWeight: 800, fontSize: 12, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', minWidth: 90 }}>{p.mat_no}</span>
                      <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}{!p.is_active && ' ⛔'}</span>
                      {p.p_no && <span style={{ fontSize: 11, color: sel ? '#08131f' : 'var(--muted)', whiteSpace: 'nowrap' }}>P/N {p.p_no}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
            {!filteredProducts.length && <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>ไม่พบสินค้า</div>}
          </div>
          )}
        </div>
      </div>

      {!selMat && <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', padding: 40 }}>เลือกสินค้าด้านบนเพื่อดูประวัติ</div>}

      {selMat && (
        <>
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>
                  {groupMode && canGroup
                    ? <>🔗 {selMat.p_no} · {selMat.name} <span style={{ fontSize: 12, fontWeight: 700, color: '#4d9fff' }}>(รวม {groupMats.length} MAT SAP)</span></>
                    : <>{selMat.mat_no} · {selMat.name}</>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  P/N {selMat.p_no || '—'} · ไลน์ปัจจุบัน <b>{selMat.line_name || '—'}</b> · CT {selMat.cycle_time_sec || '—'}s {!selMat.is_active && '· ⛔ ปิดใช้งาน'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {canGroup && (
                  <button onClick={() => setGroupMode(g => !g)}
                    title={`สินค้าที่ใช้เลขลูกค้า ${selMat.p_no} เหมือนกัน — ต่างกันที่ปลายทางส่งลูกค้า`}
                    style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                      background: groupMode ? '#4d9fff' : 'var(--bg2)', color: groupMode ? '#fff' : 'var(--text)',
                      border: `1px solid ${groupMode ? '#4d9fff' : 'var(--border2)'}` }}>
                    {groupMode ? `🔗 ดูรวมทั้งกลุ่ม (${groupMats.length}) — กดเพื่อดูเฉพาะตัวนี้` : `🔗 ดูรวมทั้งกลุ่ม (${groupMats.length} MAT SAP)`}
                  </button>
                )}
                <button onClick={() => { setSelMat(null); setPickerOpen(true); setGroupMode(false); }}
                  style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                    background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)' }}>
                  ✕ ปิด — เลือกสินค้าอื่น
                </button>
              </div>
            </div>
          </div>

          {/* โหมดกลุ่ม: เห็นว่าแต่ละเลข SAP ผลิตไปเท่าไหร่ (ไลน์เดียวกัน แต่คนละปลายทางลูกค้า) */}
          {groupMode && canGroup && byMat.length > 1 && (
            <CollapseCard id="bymat" title="🔗 ผลิตแยกตาม MAT SAP" count={`${byMat.length} เลข`}>
              <div style={{ display: 'grid', gap: 7 }}>
                {byMat.map(r => {
                  const meta = groupMats.find(g => g.mat_no === r.mat);
                  return (
                    <div key={r.mat} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 190, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={meta?.name || ''}>{r.mat}
                        <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · {meta?.name || '—'}</span>
                      </div>
                      <div style={{ flex: 1, background: 'var(--bg2)', borderRadius: 6, height: 18, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round(r.produced / Math.max(1, summary.produced) * 100)}%`, background: 'var(--accent)', height: '100%' }} />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, width: 150, textAlign: 'right' }}>
                        {r.produced.toLocaleString()} ชิ้น · {r.orders} ใบ{r.ng > 0 && ` · NG ${r.ng}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapseCard>
          )}

          {/* ⚠️ มีพี่น้องในกลุ่มแต่ยังดูตัวเดียว = ตัวเลขอาจไม่ใช่ภาพจริง ต้องบอก ห้ามเงียบ
              (ออเดอร์มักถูกบันทึกใต้ mat ตัวเดียวของกลุ่ม → ดูเดี่ยวเห็น "ขาด/เกิน" ที่ไม่จริง) */}
          {canGroup && !groupMode && (
            <div style={{ ...card, marginBottom: 16, borderColor: '#4d9fff66', background: '#4d9fff14', padding: '10px 14px' }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: '#4d9fff' }}>
                🔗 สินค้านี้มีอีก {groupMats.length - 1} MAT SAP ที่เป็น product เดียวกัน (P/N {selMat.p_no})
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 3, lineHeight: 1.7 }}>
                แยกเลขกันที่ <b>ปลายทางที่ส่งลูกค้า</b> — {groupMats.filter(g => g.mat_no !== selMat.mat_no).map(g => g.mat_no).join(' · ')}
                <br />ออเดอร์ลูกค้ามักถูกบันทึกใต้เลขเดียวของกลุ่ม → <b>ดูทีละตัวจะเห็นยอด "ขาด/เกิน" ที่ไม่ใช่ภาพจริง</b> กดปุ่ม 🔗 ด้านบนเพื่อดูรวม
              </div>
            </div>
          )}

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
            <CollapseCard id="byline" title="🏭 ผลิตแยกตามไลน์" count={summary.byLine.length}>
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
            </CollapseCard>
          )}

          {/* ── ผลิตเทียบกับความต้องการลูกค้า (2026-08-19 · คำสั่ง user) ──
              ตอบ "ผลิตพอกับที่ลูกค้าสั่งไหม · ต้องเร่งหรือชะลอ" ซึ่งเดิมดูไม่ได้เลย
              ⚠️ ไม่ผูกกับ daily.length — ไม่มีการผลิตเลย ยิ่งต้องเห็นว่าลูกค้าสั่งอยู่เท่าไหร่ */}
          <CollapseCard id="demand" title="📦 ผลิตเทียบกับความต้องการลูกค้า" count="ออเดอร์ + forecast">
            <DemandVsProduction products={activeMats} prodByDay={prodByDay} today={todayStr()} />
          </CollapseCard>

          {/* trend รายวัน */}
          {daily.length > 0 && (
            <CollapseCard id="daily" title="📈 ผลิตรายวัน" count={`${daily.length} วัน`}>
              {/* component กลาง — มีแกน Y + เส้น grid + ตัวเลขบนแท่ง (UI-CONVENTIONS §5.2) */}
              <DailyBars height={150} unit=" ชิ้น"
                data={daily.map(d => ({
                  key: d.d, label: fmtDate(d.d), empty: d.empty,
                  segs: [{ v: d.produced, color: 'var(--accent)', name: 'ผลิตดี' },
                    { v: d.ng, color: '#ef4444', name: 'NG' }],
                }))} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>■ ผลิตดี</span> · <span style={{ color: '#ef4444', fontWeight: 700 }}>■ NG</span> · แท่งเตี้ยสีเทา = วันนั้นไม่มีการผลิต (แกนวันต่อเนื่อง ไม่ข้ามวัน) · สูงสุดในช่วง = {dailyMax.toLocaleString()} ชิ้น · ตัวเลขบนแท่ง = ผลิตดี+NG รวม
              </div>
            </CollapseCard>
          )}

          {/* ตารางใบผลิต — drill-down วัน → ไลน์·กะ → รายใบ (รายวันคือระดับหลัก รายใบดูเมื่อต้องเจาะ) */}
          <CollapseCard id="orders" title="📋 รายการใบผลิต" count={`${dayGroups.length} วัน · ${rows.length.toLocaleString()} ใบ`}>
            {loading ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>กำลังโหลด...</div> : rows.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>ไม่มีการผลิตในช่วงนี้</div> : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>คลิกวันเพื่อแตกราย "ไลน์·กะ" · คลิกกะเพื่อแตกรายใบ</div>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
                <thead><tr>
                  <th style={th}>วัน → ไลน์·กะ → ใบ</th>
                  <th style={{ ...th, textAlign: 'right' }}>ใบ</th>
                  <th style={{ ...th, textAlign: 'right' }}>เป้า</th>
                  <th style={{ ...th, textAlign: 'right' }}>ผลิตได้</th>
                  <th style={{ ...th, textAlign: 'right' }}>NG</th>
                  <th style={th}>สถานะ</th><th style={th}>เปิด–ปิด</th>
                </tr></thead>
                <tbody>
                  {(showAllDays ? dayGroups : dayGroups.slice(0, 45)).map(g => {
                    const dOpen = openDays.has(g.date);
                    return (
                      <Fragment key={g.date}>
                        <tr onClick={() => toggleSet(setOpenDays, g.date)} style={{ cursor: 'pointer' }}>
                          <td style={{ ...td, fontWeight: 800 }}>{dOpen ? '▾' : '▸'} {fmtDayFull(g.date)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{g.orders}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{g.target.toLocaleString()}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#22c55e' }}>{g.produced.toLocaleString()}</td>
                          <td style={{ ...td, textAlign: 'right', color: g.ng ? '#ef4444' : 'var(--muted)' }}>{g.ng || '—'}</td>
                          <td style={{ ...td, color: 'var(--muted)' }}>{g.shifts.map(s => s.shift === 'day' ? '☀️' : '🌙').join(' ')}</td>
                          <td style={td}></td>
                        </tr>
                        {dOpen && g.shifts.map(s => {
                          const sk = `${g.date}|${s.line}|${s.shift}`;
                          const sOpen = openShifts.has(sk);
                          return (
                            <Fragment key={sk}>
                              <tr onClick={() => toggleSet(setOpenShifts, sk)} style={{ cursor: 'pointer', background: 'var(--bg2)' }}>
                                <td style={{ ...td, paddingLeft: 28, fontWeight: 700 }}>{sOpen ? '▾' : '▸'} {s.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {s.line || '—'}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{s.items.length}</td>
                                <td style={{ ...td, textAlign: 'right' }}>{s.target.toLocaleString()}</td>
                                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#22c55e' }}>{s.produced.toLocaleString()}</td>
                                <td style={{ ...td, textAlign: 'right', color: s.ng ? '#ef4444' : 'var(--muted)' }}>{s.ng || '—'}</td>
                                <td style={td}></td><td style={td}></td>
                              </tr>
                              {sOpen && s.items.map(r => (
                                <tr key={r.id}>
                                  <td style={{ ...td, paddingLeft: 52, color: 'var(--muted)' }}>└ {r.prod_no || 'ใบผลิต'}{r.machine_no ? ` · ${r.machine_no}` : ''}</td>
                                  <td style={td}></td>
                                  <td style={{ ...td, textAlign: 'right' }}>{(r.target || 0).toLocaleString()}</td>
                                  <td style={{ ...td, textAlign: 'right', color: '#22c55e' }}>{(r.produced || 0).toLocaleString()}</td>
                                  <td style={{ ...td, textAlign: 'right', color: r.ng ? '#ef4444' : 'var(--muted)' }}>{r.ng || '—'}</td>
                                  <td style={td}>{STATUS_TH(r.status)}</td>
                                  <td style={{ ...td, color: 'var(--muted)' }}>{fmtDT(r.opened_at)}{r.confirmed_at ? ` – ${fmtDT(r.confirmed_at)}` : ''}</td>
                                </tr>
                              ))}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {!showAllDays && dayGroups.length > 45 && (
                <button onClick={() => setShowAllDays(true)}
                  style={{ marginTop: 8, fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                    background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)' }}>
                  ▼ แสดงอีก {(dayGroups.length - 45).toLocaleString()} วัน (ทั้งหมด {dayGroups.length.toLocaleString()} วัน)
                </button>
              )}
            </div>
            )}
          </CollapseCard>

          {/* ประวัติการแก้ไขข้อมูลสินค้า (audit) — ว่าง = default พับ */}
          <CollapseCard id="audit" title="🕵️ ประวัติการแก้ไขข้อมูลสินค้า (ใครแก้อะไรเมื่อไหร่)" count={audit.length} defaultOpen={audit.length > 0}>
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
          </CollapseCard>
        </>
      )}
    </div>
  );
}
