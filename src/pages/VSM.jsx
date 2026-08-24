/**
 * VSM — แผนผังสายธารคุณค่า (Value Stream Mapping) · เฟส 1 = Current state + พิมพ์ A3
 * ออกแบบ: docs/VSM-DESIGN.md
 *
 * flow: เลือก FG (เลขขึ้นต้น 1) + เดือน → สร้างร่างจากข้อมูลจริง → แก้ค่าที่ระบบไม่รู้ → บันทึก → พิมพ์
 *
 * ⚠️ สูตรทั้งหมดอยู่ `src/lib/vsmModel.js` (ซึ่ง reuse utils/oee, stdManpower, companyCalendar)
 *    หน้านี้ทำหน้าที่ "โหลดข้อมูล + แสดงผล" เท่านั้น ห้ามคำนวณ OEE/CT/AT เองที่นี่
 */
import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import ReadOnlyNote from '../components/ReadOnlyNote';
import { Link } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { isFgMat } from '../utils/matPrefix';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { loadCompanyCalendar, countWorkingDaysInMonth } from '../utils/companyCalendar';
import { groupRoutings } from '../utils/routing';
import { buildCtMap } from '../utils/oee';
import { fetchByIds } from '../utils/fetchByIds';
import { buildVsmModel, fmtMct, fmtMinSec } from '../lib/vsmModel';
import { buildVsmGaps } from '../lib/vsmGaps';
import { matchDocSet } from '../utils/peLink';
import { buildVsmLive, LIVE_STATUS } from '../lib/vsmLive';
import { printVsm } from '../lib/vsmPrint';
import { printVsmA3 } from '../lib/vsmA3Print';
import VsmCanvas, { VsmLegend, PALETTE_DARK, PALETTE_LIGHT } from '../components/VsmCanvas';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';

const monthKeyNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
// วันงานตามกฎระบบ: ก่อน 08:00 = วันก่อนหน้า (กะดึกข้ามวัน) — ห้าม toISOString (UTC เพี้ยน)
const getWorkDate = () => {
  const now = new Date();
  if (now.getHours() < 8) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
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
const TABS = [
  { key: 'doc', label: '📋 เอกสาร VSM (snapshot)' },
  { key: 'live', label: '⚡ สายธารสด (Realtime)' },
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
  const [tab, setTab] = useTabParam(TABS.map(t => t.key), 'doc');

  const [lines, setLines] = useState([]);
  const [products, setProducts] = useState([]);
  const [savedMaps, setSavedMaps] = useState([]);
  const [peSets, setPeSets] = useState([]);           // ชุด PFC/FMEA/CP (Main) — worklist ใช้ชี้ "เสนอ routing จาก PFC"

  const [matNo, setMatNo] = useState('');
  const [monthKey, setMonthKey] = useState(monthKeyNow());
  const [state, setState] = useState('current');
  const [search, setSearch] = useState('');

  const [model, setModel] = useState(null);
  const [mapMeta, setMapMeta] = useState(null);       // แถว vsm_maps ที่กำลังแก้ (null = ยังไม่บันทึก)
  const [overrides, setOverrides] = useState({});
  const [busy, setBusy] = useState(false);
  const [rawRef, setRawRef] = useState(null);         // ข้อมูลดิบที่ใช้ generate (คำนวณซ้ำตอนแก้ override)
  // คิวรีดิบโหลดไม่ครบ (เกินเพดานแถว/URL ยาว) — ต้องเตือนค้างบนจอ ไม่ใช่ toast ที่หายไป
  // เพราะใบ VSM ถูก "บันทึกเป็น snapshot ถาวร" ตัวเลขที่ขาดจะค้างอยู่ในเอกสารที่พิมพ์ออกไปแล้ว
  const [loadWarn, setLoadWarn] = useState(null);
  const [showLoad, setShowLoad] = useState(false);
  const [a3, setA3] = useState({});                    // เนื้อหา A3 Report (เก็บใน vsm_maps.data.a3)
  const [showA3, setShowA3] = useState(false);

  /* ── ⚡ สายธารสด (Realtime) — คนละก้อนกับเอกสาร snapshot ห้ามปนกัน ──
     liveRaw = โครงสร้าง "เดือนปัจจุบัน" (CT/C-O/AT/%OEE เฉลี่ย + BOM/routing) โหลดครั้งเดียวต่อ FG
     liveData = สถานะสดจาก buildVsmLive (refresh ผ่าน realtime + usePolling) — ไม่มีการบันทึกลง DB */
  const [liveRaw, setLiveRaw] = useState(null);
  const [liveModel, setLiveModel] = useState(null);
  const [liveData, setLiveData] = useState(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveErr, setLiveErr] = useState(null);    // โหลดโครงพลาด (เช่นเน็ตสะดุด) — ต้องมีปุ่มลองใหม่ ห้ามจอว่างตัน
  const [liveTick, setLiveTick] = useState(0);     // bump เพื่อสั่ง initLive ลองใหม่

  const printRef = useRef(null);
  const isLight = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light';
  const palette = isLight ? PALETTE_LIGHT : PALETTE_DARK;

  /* ── master ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    // flow_mode/parallel_stations ใช้ในแท็บสด (computeLiveOee หัก DT 1/N + parallelCap)
    supabase.from('production_lines').select('id, name, section, parent_line_name, std_day_shift, std_night_shift, flow_mode, parallel_stations')
      .order('name').then(({ data }) => setLines(data || []));
    supabaseDR.from('dr_products')
      .select('id, mat_no, name, p_no, customer, line_name, cycle_time_sec, process_type, is_active')
      .not('mat_no', 'is', null).order('name').then(({ data }) => setProducts(data || []));
    supabase.from('pe_doc_sets').select('id, part_no, mat_no, line_name, status')
      .then(({ data }) => setPeSets((data || []).filter(s => s.status !== 'obsolete')));
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
      if (!isFgMat(p.mat_no)) return false;
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

  // ชุด PFC (/pe-docs) ที่ตรงกับ FG นี้ — worklist ใช้ชี้ปุ่ม "เสนอ routing จาก PFC" ให้ตรงชุด
  const peSetForFg = useMemo(() => {
    const fg = products.find(p => p.mat_no === matNo);
    if (!fg || !peSets.length) return null;
    return peSets.find(s => s.mat_no === fg.mat_no) || matchDocSet(peSets, fg.p_no, fg.line_name).set;
  }, [matNo, products, peSets]);

  const loadSaved = useCallback(async () => {
    const { data } = await supabaseDR.from('vsm_maps')
      .select('id, mat_no, title, state, period_from, period_to, status, updated_at, updated_by_name')
      .order('updated_at', { ascending: false }).limit(100);
    setSavedMaps(data || []);
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  /* ── โหลดข้อมูลดิบทั้งชุดของ (FG, เดือน) — ใช้ร่วมทั้งแท็บเอกสาร (generate)
        และแท็บสด (โครงสร้างค่ามาตรฐานเดือนปัจจุบัน) ห้าม duplicate query ── */
  const fetchRaw = useCallback(async (fg, mk) => {
    {
      setLoadWarn(null);           // เริ่มรอบใหม่ = ล้างคำเตือนรอบก่อน (ห้ามค้างจนคนเข้าใจผิด)
      const { from, to } = monthBounds(mk);
      const famNames = fg.line_name ? getLineFamilyNames(lines, fg.line_name) : [];

      // BOM ของ FG → รู้ว่าต้องดึง routing/สต๊อกของพาร์ทลูกตัวไหนบ้าง
      // ⚠ error ของ supabase คืน data:null (ไม่ใช่ undefined) — default `= []` ไม่ทำงาน ต้อง throw ให้ toast บอกจริง
      const { data: bomRaw, error: bomErr } = await supabaseDR.from('bom_items')
        .select('mat_no, part_no, part_name, qty_per_unit, supplier, source_line')
        .eq('product_id', fg.id).eq('is_active', true);
      if (bomErr) throw new Error(`โหลด BOM ไม่สำเร็จ: ${bomErr.message}`);
      const bomItems = bomRaw || [];

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
        // source ต้องมาด้วย — ผังใช้บอกว่า order มาจาก EDI 862 หรือคีย์มือ (ห้าม canvas เดา)
        supabaseDR.from('customer_shipping_orders').select('mat_no, qty, due_date, source').eq('mat_no', fg.mat_no)
          .gte('due_date', from).lte('due_date', to),
        supabaseDR.from('break_policies').select('*').eq('is_active', true),
        supabaseDR.from('kanban_delivery_rounds').select('id, line_name').eq('is_active', true).limit(200),
      ]);

      const sessions = sess.data || [];
      const sessionIds = sessions.map(s => s.id);
      // downtime — join ประเภทเพื่อเอา category (planned → เวลารับภาระ) + six_big_loss (setup → C/O)
      // ⚠️ ต้องผ่าน fetchByIds เสมอ (กฎ CLAUDE.md) — เดิมแบ่งก้อนเอง 900 id
      //    = URL ~35,000 ตัวอักษร (มากกว่าเคส 813 กะ ที่เคยทำให้คิวรีล้มเหลวเงียบ) + ไม่แบ่งหน้า
      //    + `const { data }` กลืน error ⇒ C/O (setup) กับเวลาหยุดตามแผน ต่ำกว่าจริง/เป็น 0
      //    แล้ว **ค้างอยู่ใน snapshot ที่พิมพ์ออกไปแล้ว** (VSM เก็บถาวร แก้ย้อนหลังไม่ได้)
      const dtRes = await fetchByIds(sessionIds, (c) => supabaseDR.from('downtime_logs')
        .select('session_id, duration_min, dr_downtime_types(category, six_big_loss)')
        .in('session_id', c));
      const dtRaw = dtRes.rows;
      if (dtRes.error || dtRes.truncated) setLoadWarn('โหลด downtime ไม่ครบ — ค่า C/O และเวลาหยุดตามแผนอาจต่ำกว่าจริง (อย่าเพิ่งบันทึกเป็นเอกสาร)');
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

      return {
        fg, bomItems, products, partsMaster: pm.data || [], routings: groupRoutings(rt.data || []),
        kanbanStds: ks.data || [], lines, sessions, downtimes,
        breakPolicies: bp.data || [], stockByMat,
        forecasts: fc.data || [], shippingOrders: so.data || [],
        monthKey: mk, workingDays: countWorkingDaysInMonth(mk, 0),
        deliveryRounds: (dr.data || []).filter(r => famNames.includes(r.line_name)),
      };
    }
  }, [products, lines]);

  /* ── สร้างร่างจากข้อมูลจริง (แท็บเอกสาร) ────────────────────────────────── */
  const generate = useCallback(async (keepOverrides = false) => {
    const fg = products.find(p => p.mat_no === matNo);
    if (!fg) { toast.error('เลือกสินค้า (FG) ก่อน'); return; }
    setBusy(true);
    try {
      const raw = await fetchRaw(fg, monthKey);
      const ov = keepOverrides ? overrides : {};
      setRawRef(raw);
      setOverrides(ov);
      setModel(buildVsmModel({ ...raw, overrides: ov }));
      if (!keepOverrides) setMapMeta(null);
      toast.success('สร้างร่างจากข้อมูลจริงแล้ว');
    } catch (e) {
      toast.error(e.message || 'สร้างร่างไม่สำเร็จ');
    } finally { setBusy(false); }
  }, [matNo, monthKey, products, fetchRaw, overrides]);

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

  /* ── ⚡ สายธารสด — โหลดโครงสร้าง (ครั้งเดียวต่อ FG) แล้ว refresh เฉพาะข้อมูลสด ──
     กติกา egress (CLAUDE.md): realtime เป็นช่องทางหลัก · usePolling เป็นตัวกันเหนียว
     · master/โครงเดือนนี้ไม่โหลดซ้ำทุกรอบ · แท็บถูกซ่อน = หยุดยิง DB (usePolling จัดการ) */
  useEffect(() => {
    if (tab !== 'live' || !matNo) return;
    if (liveRaw?.fgMat === matNo) return;                    // โครงของ FG นี้มีแล้ว
    const fg = products.find(p => p.mat_no === matNo);
    if (!fg) return;                                         // master ยังไม่มา — effect วิ่งซ้ำเอง
    // ⚠️ ต้องรอ production_lines ก่อน (กฎ CLAUDE.md) — ไม่งั้น family ว่าง = โหลดโครงโดยไม่มีกะ/OEE
    //    แล้ว guard fgMat ด้านบนจะกันไม่ให้โหลดซ้ำตลอดไป (fetchRaw ผูก lines ใน deps → effect วิ่งซ้ำเองเมื่อมา)
    if (!lines.length) return;
    let dead = false;
    (async () => {
      setLiveBusy(true);
      setLiveErr(null);
      setLiveModel(null);                                    // กันผังของ FG เก่าค้างระหว่างโหลดตัวใหม่
      setLiveData(null);
      try {
        const raw = await fetchRaw(fg, monthKeyNow());       // แท็บสดยึด "เดือนปัจจุบัน" เสมอ
        if (dead) return;
        const model = buildVsmModel({ ...raw, overrides: {} });
        const boxes = [...model.chain, ...model.feeders.flatMap(f => f.boxes)];
        setLiveModel(model);
        setLiveData(null);
        setLiveRaw({
          fgMat: matNo, raw,
          ctMap: buildCtMap({ kanbanStds: raw.kanbanStds, products }),
          chainLines: [...new Set(boxes.map(b => b.line).filter(Boolean))],
          allMats: [fg.mat_no, ...raw.bomItems.map(b => b.mat_no)].filter(Boolean),
        });
      } catch (e) {
        // "Failed to fetch" = เน็ตฝั่งเครื่องผู้ใช้สะดุด (ตรวจ log ฝั่ง Supabase แล้ว server ปกติ)
        // ต้องเหลือทางลองใหม่บนจอเสมอ — toast อย่างเดียวหายไปแล้วกลายเป็นจอว่างตัน (เคสจริง 2026-08-20)
        if (!dead) {
          setLiveErr(e.message || 'โหลดโครงสายธารไม่สำเร็จ');
          toast.error(e.message || 'โหลดโครงสายธารไม่สำเร็จ');
        }
      } finally { if (!dead) setLiveBusy(false); }
    })();
    return () => { dead = true; };
  }, [tab, matNo, liveRaw, products, lines, fetchRaw, liveTick]);

  // รอบ refresh สด: กะวันนี้ของไลน์ในสาย + ใบงาน/DT/ของเสีย + คงคลังปัจจุบัน (payload เล็ก)
  const loadLive = useCallback(async () => {
    if (!liveRaw) return;
    // จอที่เปิดค้างข้ามเดือน: โครงค่ามาตรฐาน "เดือนนี้" ต้องไม่ค้างเป็นเดือนเก่า → ล้างให้ init ใหม่
    if (liveRaw.raw.monthKey !== monthKeyNow()) { setLiveRaw(null); return; }
    const wd = getWorkDate();
    let partial = false;                                     // query ไหนพลาด = บอกบนจอ ห้ามเงียบ
    const { data: sess, error: se } = await supabaseDR.from('production_sessions')
      .select('id, line_name, work_date, shift, shift_min, start_time, status, oee')
      .eq('work_date', wd).in('line_name', liveRaw.chainLines);
    if (se) { setLiveData(d => ({ ...(d || { byKey: {}, summary: null }), at: Date.now(), workDate: wd, partial: true })); return; }
    const ids = (sess || []).map(s => s.id);
    let orders = [], dts = [], dfs = [];
    if (ids.length) {
      const [o, d, f] = await Promise.all([
        // opened_at/confirmed_at ให้ busyMinutes (P ไลน์เครื่องขนาน) — กฎ computeLiveOee
        supabaseDR.from('prod_orders')
          .select('session_id, mat_no, status, qty, qty_ok, qty_actual, qty_target, machine_no, opened_at, confirmed_at')
          .in('session_id', ids),
        supabaseDR.from('downtime_logs')
          .select('session_id, machine_no, description, started_at, ended_at, duration_min, created_at, dr_downtime_types(name_th, category)')
          .in('session_id', ids),
        // excl_from_q ต้อง join มาด้วย ไม่งั้นงานทดลองตกหล่นเงียบ (กฎ %Q)
        supabaseDR.from('defect_logs')
          .select('session_id, qty_ng, qty_suspect, is_trial, dr_defect_types(excl_from_q)')
          .in('session_id', ids),
      ]);
      if (o.error || d.error || f.error) partial = true;
      orders = o.data || []; dts = d.data || []; dfs = f.data || [];
    }
    const { data: stock, error: ste } = await supabaseDR.from('line_stock_summary')
      .select('mat_no, qty_on_hand').in('mat_no', liveRaw.allMats);
    if (ste) partial = true;
    const stockByMat = {};
    (stock || []).forEach(r => { stockByMat[r.mat_no] = (stockByMat[r.mat_no] || 0) + (Number(r.qty_on_hand) || 0); });

    // คงคลังสด → PLT/%VA ขยับตามจริง (โหลดสต๊อกพลาด = ใช้ค่าตอนโหลดโครง ไม่ใช่ 0)
    const model = buildVsmModel({ ...liveRaw.raw, stockByMat: ste ? liveRaw.raw.stockByMat : stockByMat, overrides: {} });
    const boxes = [...model.chain, ...model.feeders.flatMap(fd => fd.boxes)];
    const lv = buildVsmLive({
      boxes, sessions: sess || [], orders, downtimes: dts, defects: dfs,
      ctMap: liveRaw.ctMap, lines, nowMs: Date.now(),
    });
    setLiveModel(model);
    setLiveData({ ...lv, at: Date.now(), workDate: wd, partial });
  }, [liveRaw, lines]);

  usePolling(loadLive, RATE.BOARD, { enabled: tab === 'live' && !!liveRaw });

  // realtime = ช่องทางหลัก (pattern เดียวกับ FactoryMap) · debounce 1.5 วิ กัน event รัวตอนสแกนรวบ
  // loadLive อยู่ใน deps ตรงๆ (identity เปลี่ยนเมื่อ liveRaw/lines เปลี่ยน = resubscribe นานๆ ครั้ง)
  useEffect(() => {
    if (tab !== 'live' || !liveRaw) return;
    let timer = null;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => loadLive(), 1500); };
    const ch = supabaseDR.channel('vsm-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_logs' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prod_orders' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'defect_logs' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_sessions' }, bump)
      .subscribe();
    return () => { clearTimeout(timer); supabaseDR.removeChannel(ch); };
  }, [tab, liveRaw, loadLive]);

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

  // FG picker ใช้ร่วม 2 แท็บ (state `matNo` ตัวเดียวกัน — สลับแท็บแล้วยังโฟกัสสินค้าเดิม)
  const fgPicker = (
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
  );

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 'min(98vw, 2200px)', margin: '0 auto' }}>
      <PageHeader title="แผนผังสายธารคุณค่า (Value Stream Map)" icon="🗺️"
        sub={tab === 'live'
          ? 'มุมมองสด: สถานะไลน์ · OEE กะปัจจุบัน · คงคลัง ▲ ปัจจุบัน — ไม่ใช่เอกสารทางการ'
          : 'เลือกสินค้าสำเร็จรูป → ระบบดึง CT · %OEE · C/O · LOT · คงคลัง · TT จากข้อมูลจริงมาสร้างผังให้'}
        tabs={TABS} tab={tab} onTab={setTab} />

      <ReadOnlyNote show={!canManage} role={role} what="สร้าง/แก้ใบ VSM"
        permKey="vsm:manage" hint="ยังเปิดดูใบเดิมและพิมพ์ได้ตามปกติ" />

      {tab === 'doc' && <>
      {/* ── แถบควบคุม ── */}
      <div style={{ ...S.card, marginBottom: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {fgPicker}
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
        {/* ⚠️ ข้อมูลดิบโหลดไม่ครบ — ต่างจาก worklist ข้างล่าง (นั่นคือ "ยังไม่มีใครลงข้อมูล")
            อันนี้คือ "มีข้อมูลแต่ดึงมาไม่หมด" ⇒ ตัวเลขต่ำกว่าจริง ห้ามบันทึกเป็นเอกสาร */}
        {loadWarn && (
          <div style={{ ...S.card, marginBottom: 12, padding: '10px 14px', border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.10)' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>⚠️ {loadWarn}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>ลองกด "↻ ดึงข้อมูลใหม่" อีกครั้ง — ถ้ายังขึ้นซ้ำให้แจ้งผู้ดูแลระบบ</div>
          </div>
        )}
        {/* ── 📋 worklist "ข้อมูลที่ VSM ยังขาด" (คำขอ user 2026-08-20 หลัง audit) ──
            แทนที่บล็อก warning เดิม: ข้อความชุดเดียวกัน (จาก model.warnings — single source)
            + ปุ่มลิงก์ "ไปลงข้อมูลที่ไหน" จาก lib/vsmGaps.js · ครบแล้วก็ต้องบอก ห้ามซ่อนแผง */}
        {(() => {
          const gaps = buildVsmGaps(model, { peSet: peSetForFg });
          return (
            <div style={{ ...S.card, marginBottom: 12, padding: '10px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: gaps.length ? 8 : 0 }}>
                📋 ข้อมูลที่ VSM ยังขาด{gaps.length ? ` · ${gaps.length} รายการ` : ''}
                {gaps.length > 0 && <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--muted)' }}> — กดปุ่มท้ายรายการเพื่อไปลงข้อมูลที่ต้นทาง</span>}
              </div>
              {!gaps.length && <div style={{ fontSize: 12.5, color: 'var(--accent)', marginTop: 6 }}>✅ ข้อมูลครบทุกช่องของใบนี้แล้ว</div>}
              <div style={{ display: 'grid', gap: 6 }}>
                {gaps.map((g, i) => {
                  const st = WARN_STYLE[g.level] || WARN_STYLE.info;
                  return (
                    <div key={i} style={{ background: st.bg, borderLeft: `3px solid ${st.bd}`, borderRadius: 6, padding: '7px 12px', fontSize: 12.5, color: 'var(--text)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ flex: '1 1 340px' }}>{st.icon} {g.text}</span>
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {g.actions.map((a, j) => a.to ? (
                          <Link key={j} to={a.to}
                            style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                            {a.label} →
                          </Link>
                        ) : (
                          <span key={j} style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{a.label}</span>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

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
              ['PT (Processing Time)', fmtMinSec(model.totals.ptSec) || '—'],
              // MCT = headline ของใบจริง TSAT (skill: vsm-tsat-reference)
              ['MCT (PLT + PT)', fmtMct(model.totals.pltDays, model.totals.ptSec) || '—'],
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
      </>}

      {tab === 'live' && (() => {
        const chips = [
          ['down', liveData?.summary?.down || 0],
          ['run', liveData?.summary?.run || 0],
          ['closed', liveData?.summary?.closed || 0],
          ['idle', liveData?.summary?.idle || 0],
        ];
        // แปลผล OEE สดต่อกล่อง — "ประเมินไม่ได้" ต้องบอกเหตุผล ห้ามโชว์ 0 (กฎ null + เหตุผล)
        const liveOeeOf = lv => {
          if (!lv || lv.status === 'unknown') return { v: null, note: lv?.reason || '—' };
          if (lv.status === 'idle') return { v: null, note: 'ยังไม่เปิดกะวันนี้' };
          if (lv.status === 'closed') return { v: lv.closedOee, note: 'กะปิดแล้ว · ค่าที่ stamp' };
          if (!lv.live) return { v: null, note: 'ยังประเมินไม่ได้ — กะต้องเปิดเกิน 10 นาที (และกะต้องมีเวลาเริ่ม)' };
          if (lv.live.noOutput) return { v: null, note: `ยังไม่ผลิตชิ้นแรก · A ${lv.live.A}%` };
          if (lv.live.noCt) return { v: null, note: `ชิ้นงานยังไม่ตั้ง CT — ประเมิน P ไม่ได้ · A ${lv.live.A}%` };
          return {
            v: lv.live.oee,
            note: `A ${lv.live.A} · P ${lv.live.P} · Q ${lv.live.Q}`
              + (lv.live.qtyNoCt ? ' · ⚠CT ไม่ครบ' : '') + (lv.live.pOver ? ' · ⚠%P ตัน' : ''),
          };
        };
        return <>
          <div style={{ ...S.card, marginBottom: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {fgPicker}
            <div style={{ flex: '2 1 280px', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
              ค่ามาตรฐานในกล่อง (C/T · C/O · %OEE · A/T) = ค่าเฉลี่ย<b style={{ color: 'var(--text)' }}>เดือนนี้</b> ·
              สถานะไลน์ / ยอดวันนี้ / คงคลัง ▲ = <b style={{ color: 'var(--accent)' }}>สด</b><br />
              มุมมองนี้<b>ไม่บันทึก/ไม่พิมพ์</b> — เอกสาร VSM ทางการ (snapshot) อยู่แท็บ 📋
            </div>
            {liveRaw && <button onClick={loadLive} style={btn('var(--bg3)', { color: 'var(--text)' })}>↻ รีเฟรชตอนนี้</button>}
          </div>

          {!matNo && (
            <div style={{ ...S.card, textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 14 }}>
              เลือกสินค้าสำเร็จรูปก่อน — ระบบจะกางสายธารแล้วตามสถานะสดให้เอง
            </div>
          )}
          {matNo && liveBusy && !liveModel && (
            <div style={{ ...S.card, textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>⏳ กำลังโหลดโครงสายธาร…</div>
          )}
          {/* โหลดโครงพลาด (เน็ตสะดุด ฯลฯ) — ห้ามจอว่างตัน ต้องมีปุ่มลองใหม่ */}
          {matNo && !liveBusy && !liveModel && liveErr && (
            <div style={{ ...S.card, textAlign: 'center', padding: 30 }}>
              <div style={{ fontSize: 13.5, color: '#ef4444', fontWeight: 700, marginBottom: 6 }}>
                ⛔ โหลดโครงสายธารไม่สำเร็จ
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                {liveErr} — มักเป็นสัญญาณเน็ตสะดุดชั่วคราว ลองใหม่ได้เลย
              </div>
              <button onClick={() => setLiveTick(t => t + 1)} style={btn('var(--accent)')}>🔄 ลองใหม่</button>
            </div>
          )}

          {matNo && liveModel && <>
            {/* ── แถบสถานะรวม ── */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
                padding: '5px 12px', borderRadius: 999, background: 'var(--bg3)', color: 'var(--text)',
              }}>
                {/* จุดสถานะ live = นิ่ง+เรืองแสง ห้ามกระพริบ (Andon สงวนกระพริบให้แดง) */}
                <span style={{ width: 8, height: 8, borderRadius: 99, background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
                REALTIME · อัปเดต {liveData?.at ? new Date(liveData.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· วันงาน {liveData?.workDate || getWorkDate()}</span>
              </span>
              {liveData?.partial && (
                <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid #f59e0b' }}>
                  ⚠ โหลดข้อมูลสดไม่ครบ — ตัวเลขบางส่วนอาจขาด (จะลองใหม่รอบถัดไป)
                </span>
              )}
              {chips.map(([k, nn]) => (
                <span key={k} className={k === 'down' && nn > 0 ? 'dt-alarm-blink' : undefined}
                  style={{
                    fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999,
                    background: 'var(--bg3)', border: '1px solid var(--border)',
                    // dt-alarm-blink ทาพื้นแดง — ตัวอักษรต้องขาว ไม่งั้นแดงบนแดงอ่านไม่ออก
                    color: k === 'down' && nn > 0 ? '#fff' : nn > 0 ? LIVE_STATUS[k].color : 'var(--muted)',
                  }}>
                  {LIVE_STATUS[k].label} · {nn} ไลน์
                </span>
              ))}
              {(liveData?.summary?.plannedOpen || 0) > 0 && (
                <span style={{ fontSize: 12, padding: '5px 12px', borderRadius: 999, background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  🗓️ หยุดตามแผนค้าง {liveData.summary.plannedOpen} รายการ (ไม่นับเป็น Andon)
                </span>
              )}
            </div>

            {/* ── Downtime ค้าง (Andon) — ต้องเห็นก่อนอย่างอื่น ห้ามซ่อน ── */}
            {(liveData?.summary?.alarms || []).length > 0 && (
              <div style={{ background: 'rgba(239,68,68,0.10)', borderLeft: '3px solid #ef4444', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#ef4444', marginBottom: 4 }}>🚨 Downtime ค้างในสายธารนี้</div>
                {liveData.summary.alarms.map((a, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: 'var(--text)', padding: '2px 0' }}>
                    <b>{a.line}</b>{a.machineNo ? ` · ${a.machineNo}` : ''} — {a.typeName || 'ไม่ระบุประเภท'}
                    {a.description ? ` · 💬 ${a.description}` : ''}
                    {a.openMin != null && <span style={{ color: '#ef4444', fontWeight: 700 }}> · ค้าง {a.openMin} นาที</span>}
                  </div>
                ))}
              </div>
            )}

            {/* ── ช่องที่ระบบไม่มีข้อมูล (จากโมเดล — กฎห้ามเงียบ) ── */}
            {!!liveModel.warnings.length && (
              <div style={{ marginBottom: 12, display: 'grid', gap: 6 }}>
                {liveModel.warnings.map((w, i) => {
                  const st = WARN_STYLE[w.level] || WARN_STYLE.info;
                  return <div key={i} style={{ background: st.bg, borderLeft: `3px solid ${st.bd}`, borderRadius: 6, padding: '7px 12px', fontSize: 12.5, color: 'var(--text)' }}>
                    {st.icon} {w.text}
                  </div>;
                })}
              </div>
            )}

            {/* ── ผังสด ── */}
            <div style={{ ...S.card, padding: 8, marginBottom: 6, overflowX: 'auto' }}>
              <VsmCanvas model={liveModel} palette={palette} live={liveData} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 14 }}>
              ขอบกล่องกระบวนการ: <b style={{ color: '#ef4444' }}>แดงกระพริบ = Downtime ค้าง</b> ·
              <b style={{ color: '#22c55e' }}> เขียว = กำลังผลิต</b> · เส้นประจาง = ยังไม่เปิดกะวันนี้ —
              วางเมาส์บนกล่องเพื่อดูสถานะ · ▲ คงคลัง/PLT/%VA คำนวณจากยอดคงเหลือปัจจุบัน
            </div>

            {/* ── การ์ดสถานะรายขั้น (ค่าสดเต็มรูป) ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 10, alignContent: 'start', marginBottom: 14 }}>
              {liveModel.chain.map((b, i) => {
                const lv = liveData?.byKey?.[b.key];
                const meta = LIVE_STATUS[lv?.status || 'unknown'];
                const oee = liveOeeOf(lv);
                return (
                  <div key={b.key} style={{ ...S.card, padding: 12, borderLeft: `3px solid ${meta.color}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
                        {i + 1}. {b.name}
                        <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {b.line || '—'}</span>
                      </div>
                      <span className={lv?.status === 'down' ? 'dt-alarm-blink' : undefined}
                        style={{ fontSize: 11.5, fontWeight: 700, color: lv?.status === 'down' ? '#fff' : meta.color, whiteSpace: 'nowrap', padding: '2px 8px', borderRadius: 999, background: 'var(--bg2)' }}>
                        {meta.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text)' }}>
                      <span>OEE {lv?.status === 'closed' ? 'วันนี้' : 'กะนี้ (สด)'}:{' '}
                        <b>{oee.v == null ? '—' : `${oee.v}%`}</b></span>
                      <span>วันนี้: <b>{lv?.produced ?? '—'}</b>{lv?.target ? ` / ${lv.target}` : ''} ชิ้น</span>
                      <span style={{ color: 'var(--muted)' }}>OEE เฉลี่ยเดือนนี้: {b.oeePct == null ? '—' : `${b.oeePct}%`}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{oee.note}</div>
                    {(lv?.alarms || []).map((a, j) => (
                      <div key={j} style={{ fontSize: 11.5, color: '#ef4444' }}>
                        🚨 {a.machineNo || 'ไม่ระบุเครื่อง'} · {a.typeName || '—'}{a.openMin != null ? ` · ค้าง ${a.openMin} นาที` : ''}
                      </div>
                    ))}
                    {(lv?.plannedOpen || []).length > 0 && (
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                        🗓️ หยุดตามแผนค้าง {lv.plannedOpen.length} รายการ
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── สรุปสายธารสด ── */}
            <div style={{ ...S.card, maxWidth: 460, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>สรุปสายธาร (จากคงคลังปัจจุบัน)</div>
              {[
                ['PLT (Production Lead Time)', liveModel.totals.pltDays == null ? '—' : `${liveModel.totals.pltDays} วัน`],
                ['PT (Processing Time)', fmtMinSec(liveModel.totals.ptSec) || '—'],
                ['MCT (PLT + PT)', fmtMct(liveModel.totals.pltDays, liveModel.totals.ptSec) || '—'],
                ['%VA (Value Added)', liveModel.totals.vaPct == null ? '—' : `${liveModel.totals.vaPct}%`],
                ['Takt Time', liveModel.info.ttSec == null ? '—' : `${liveModel.info.ttSec} sec`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--muted)' }}>{k}</span>
                  <span style={{ color: 'var(--text)', fontWeight: 700 }}>{v}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
                คงคลัง WIP กลางทางระบบยังไม่เก็บ (กรอกได้ในแท็บ 📋) — PLT สดจึงอาจต่ำกว่าความจริง
              </div>
            </div>
          </>}
        </>;
      })()}

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
