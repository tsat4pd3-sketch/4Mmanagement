import { useState, useEffect, useContext, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import { lineNameCompare } from '../utils/lineHierarchy';
import ReadOnlyNote from '../components/ReadOnlyNote';
import { supabase, supabaseDR } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
import { scopedLineNames, filterRowsByLineScope } from '../utils/sectionScope';
import { canWriteLine, writableRows, writeBlockText } from '../utils/writeScope';
import { checkWriteRows } from '../utils/dbWrite';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { isFgMat } from '../utils/matPrefix';
import { splitBySide, sideMatches } from '../utils/logisticSide';
import SideFilterChips from '../components/SideFilterChips';
import ToggleDot from '../components/ToggleDot';
import { can } from '../utils/permissions';
import InternalTimeBoard from '../components/InternalTimeBoard';
import { frameMin, breaksToFrame } from '../utils/timeFrame';
import { getRoundStatus } from '../utils/deliveryRounds';
import PageHeader from '../components/PageHeader';
import Page, { Hub } from '../components/Page';
import { OPS_STORES_OUT, OPS_STORES_IN } from '../utils/storeOps';
import SapPendingReport from '../components/SapPendingReport';
import StockDiscrepancyReport from '../components/StockDiscrepancyReport';
import TimeRangeBar from '../components/TimeRangeBar';
import useTimeRange from '../utils/useTimeRange';
import SearchInput from '../components/SearchInput';
import { fetchAllRows } from '../utils/fetchAllRows';
import { downloadCsvDoc, csvCell } from '../utils/csvDoc';
import { rangeDays } from '../utils/timeRange';
import FilterBar from '../components/FilterBar';
import { ALL, allOf } from '../utils/filterLabels';
import useTabParam from '../utils/useTabParam';
import WipBetweenSteps from '../components/WipBetweenSteps';
import StockCountSheet from '../components/StockCountSheet';
import StorageZonePanel from '../components/StorageZonePanel';
import StorageLocPanel from '../components/StorageLocPanel';
import LineSelect from '../components/LineSelect';
import MatLabel from '../components/MatLabel';
import ProductSelect from '../components/ProductSelect';
import useProducts from '../utils/useProducts';
import useColumnHistory from '../utils/useColumnHistory'; // 📜 MAT ที่เคยบันทึกไว้ — ทะเบียนไม่มีก็ยังเลือกซ้ำได้ (2026-09-07)
import { WAREHOUSE_LOCATIONS } from '../utils/storageZones';
import StockMoveToChild from '../components/StockMoveToChild';
import { checkStockPlacement } from '../utils/moveTargets';
import { visibleInterval } from '../utils/usePolling';
import { fetchAllPages } from '../utils/fetchByIds';
import { RATE } from '../utils/refreshRates';
import { useLiveBoard } from '../utils/useLiveBoard';
import SearchSelect from '../components/SearchSelect';
import PartLevelCoveragePanel from '../components/PartLevelCoveragePanel';
import Segmented from '../components/Segmented';
import PartThumb from '../components/PartThumb';
import usePartImages from '../utils/usePartImages';
import { useStorageLocationsState } from '../utils/useStorageLocations';
import { groupStockBySloc, slocGroupTitle } from '../utils/slocStockView';
import { loadHomeSlocs } from '../utils/homeSloc';   // 🏠 ที่จัดเก็บหลักของพาร์ท (05/11)
import { sapEquivalent } from '../utils/sapView';   // 🔩 มุม SAP (09/11)
import { loadProductsMaster } from '../utils/useProducts';
import { INFLOW_MODES, inflowModeOf, inflowPatchFor, inflowModesFor } from '../utils/stockReceipts';
import { IconButton, DeleteButton } from '../components/IconButton';
import { tr } from '../utils/i18n';
import { tint } from '../utils/statusTone';   // สี token ต่อ alpha-hex ไม่ได้ ⇒ ย่อยเป็น -dim/-line (UI §6.17)
import InfoMore from '../components/InfoMore';   // ⓘ คำอธิบายพับ (UI §6.10)

/* ─── LINE STOCK — Stock พาร์ทย่อยคงเหลือในแต่ละไลน์ผลิต ─────────────────
   Store จ่ายพาร์ทเข้าไลน์ → บันทึก transaction type='issue'
   ระบบหักอัตโนมัติตอน close กะ   → type='consume'
   ไลน์คืนพาร์ท                  → type='return'
   ปรับยอด stocktake              → type='adjust'

   Stock คงเหลือ = SUM(issue+adjust) - SUM(consume+return)
   ─────────────────────────────────────────────────────────────────────────── */

function getToday() {
  // วันงาน (work date) ตัด 08:00 — ก่อน 8 โมงเช้านับเป็นวันก่อนหน้า (กะดึกข้ามวัน)
  // ไม่งั้นรายการสต็อกช่วง 00:00–07:59 ของกะดึกจะไปตกวันปฏิทินถัดไป ผิดวันงาน
  const now = new Date();
  if (now.getHours() < 8) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

const card = { background:'var(--card)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:16 };
const inputSt = { width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg2)', color:'var(--text)', fontSize:13, boxSizing:'border-box', fontFamily:'var(--font-body)' };
const btn = (bg, color='#fff') => ({ padding:'8px 16px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:700, background:bg, color, fontFamily:'var(--font-body)' });

const TXN_COLS = 'id, work_date, created_at, line_name, mat_no, part_name, type, qty, status, reject_reason, note, created_by';
const TXN_PAGE = 300;        // แถวที่วาดต่อครั้ง (กด "แสดงเพิ่ม") — ข้อมูลโหลดครบช่วงแล้ว
const TXN_MAX_DAYS = 93;     // เพดานช่วงประวัติต่อครั้ง (~3 เดือน)
const TYPE_LABEL = { issue:'📦 จ่ายเข้าไลน์', consume:'⚙️ ใช้ผลิต (Auto)', return:'↩️ คืน Store', adjust:'🔧 ปรับยอด' };

/* รหัส MAT SAP (ดู CLAUDE.md "รหัส MAT SAP"): ขึ้นต้น 1 = FG งานสำเร็จพร้อมขาย —
   อยู่ FG WAREHOUSE รอส่งลูกค้า หักออกทางเดียวคือกด "ส่งแล้ว" หน้า Delivery
   จึงไม่มีเหตุให้ "จ่ายเข้าไลน์" (ปรับยอด/คืนยังทำได้ ผ่านคิวอนุมัติตามปกติ) */
// FG = ขึ้นต้นด้วย 1 — นิยามกลางที่ src/utils/matPrefix.js (ห้ามนิยามซ้ำในหน้า)
const TYPE_COLOR = { issue:'#22c55e', consume:'#94a3b8', return:'#f59e0b', adjust:'#a855f7' };

/* ประเภท manual movement ที่ต้องผ่านการอนุมัติ (store review) ก่อนมีผลต่อ on-hand
   — เพิ่ม/ลดได้ที่นี่จุดเดียว. auto movement (consume/issue จาก Heijunka/close กะ/trigger)
   ไม่เข้าคิว review เพราะ insert โดยไม่ระบุ status → ได้ 'approved' อัตโนมัติ */
const REVIEW_TYPES = ['adjust'];
const STATUS_LABEL = { pending:'⏳ รออนุมัติ', approved:'อนุมัติแล้ว', rejected:'❌ ปฏิเสธ' };
const STATUS_COLOR = { pending:'#f59e0b', approved:'#22c55e', rejected:'#ef4444' };

const EMPTY_FORM = { line_name:'', mat_no:'', part_name:'', qty:'', type:'issue', dir:'up', note:'', work_date: getToday() };

/* ─────────────────────────────────────────────────────────────────────────────
   TAB: STOCK (existing content)
   ───────────────────────────────────────────────────────────────────────────── */
function StockTab({ role, scope }) {
  const { fullName, section: homeSection, sections: mySections, allUnits, respCostCenters, scopeIdx } = useContext(UserContext);
  /* 🔐 ขอบเขต "ที่แก้ได้" — คนละตัวกับ scopeNames ที่เป็นขอบเขต "ที่เห็น" (ดู utils/writeScope.js)
     คิวอนุมัติเดิมดึง pending ทั้งระบบ ⇒ แอดมินหน่วยงานอนุมัติยอดสต็อกของส่วนงานอื่นได้ (audit 15/10) */
  const wctx = useMemo(() => ({ role, section: homeSection, sections: mySections, allUnits, respCostCenters, scopeIdx }),
    [role, homeSection, mySections, allUnits, respCostCenters, scopeIdx]);
  const canIssue = can('line_stock', 'issue', role);
  const canApprove = can('line_stock', 'approve', role);

  const [lines,   setLines]   = useState([]);
  const [stock,   setStock]   = useState([]);
  const [txns,    setTxns]    = useState([]);
  // ฝั่งงาน: '' ทั้งหมด · inbound (Store 2xx/3xx/5xx) · outbound (Warehouse FG 1xx) · unknown
  const [sideFilter, setSideFilter] = useState('');
  const [bomMap,  setBomMap]  = useState({});
  const [ksMap,   setKsMap]   = useState({});       // mat_no → { min, max, std } จาก kanban_standards (std = จำนวนต่อกล่อง/คัมบัง)
  /* 🏬 โหมดจัดกลุ่ม — "ไลน์" (ของเดิม) หรือ "พื้นที่ SAP" (คำขอทีมวางแผน 13/10 · ดู utils/slocStockView.js)
     ทะเบียนโหลดไม่ได้/ยังไม่มีรหัสเลย = ถอยไปโหมดไลน์ **แล้วเขียนบนจอ** ห้ามโชว์กลุ่ม "ไม่ผูก" ก้อนเดียวเฉยๆ */
  const [groupBy, setGroupBy] = useState(() => {
    try { return localStorage.getItem('ls_group_by') === 'line' ? 'line' : 'sloc'; } catch { return 'sloc'; }
  });
  const pickGroupBy = (v) => {
    try { localStorage.setItem('ls_group_by', v); } catch { /* ignore */ }
    setGroupBy(v);
  };
  const imgOf = usePartImages();                    // 🖼️ รูปชิ้นงาน — ของกลางเดียวกับบอร์ดสโตร์ (UI §6.23)
  const slocReg = useStorageLocationsState();       // ทะเบียนรหัสคลัง — ว่างเพราะไม่มี vs โหลดไม่ได้ ต้องแยกให้ออก
  /* 🏠 05/11 — ยอดในกองคลัง (STORE/FG WAREHOUSE) จัดกลุ่มพื้นที่ตาม "ที่จัดเก็บหลัก" ของพาร์ท (parts_master.home_sloc) */
  const [homeSloc, setHomeSloc] = useState({ map: new Map(), error: null });
  useEffect(() => { let alive = true; loadHomeSlocs().then(r => { if (alive) setHomeSloc(r); }); return () => { alive = false; }; }, []);
  const [knownMats, setKnownMats] = useState(() => new Set()); // mat ที่มีในฐาน (parts_master/BOM) — กันสร้างของผี
  const [products, setProducts] = useState([]);     // [{id, name, mat_no, line_name}]
  // 📜 MAT ที่เคยบันทึกใน line_stock_transactions (DR) — เคยรับ/จ่ายไปแล้วแต่ยังไม่อยู่ในทะเบียนใด ยังเลือกซ้ำได้ (save ยังถามยืนยันเหมือนพิมพ์เอง) · 2026-09-07
  const txnMatHist = useColumnHistory(supabaseDR, 'line_stock_transactions', 'mat_no', { upper: true });
  const [productBom, setProductBom] = useState({}); // product_id → [{mat_no, part_name}]
  const [bomProduct, setBomProduct] = useState(''); // product_id ที่เลือกในฟอร์ม (เพื่อดึง MAT จาก BOM)

  const [lineFilter, setLineFilter] = useState('');
  /* 🔎 09/11 (คำสั่ง user "แยกพื้นที่แบบกางทุกกลุ่มมันรก — ควรมี dropdown เลือกพื้นที่ + ค้นหา MAT / Part No / ชื่อ")
     areaFilter = key ของกลุ่มพื้นที่ SAP ('' = ทุกพื้นที่) · stockQ = คำค้น */
  const [areaFilter, setAreaFilter] = useState('');
  const [stockQ, setStockQ] = useState('');
  const [partNoMap, setPartNoMap] = useState({});
  // คลังปลายทางที่ไม่ใช่ไลน์ผลิต — derive จากของที่มีจริง + กฎรับเข้าอัตโนมัติ ไม่ hardcode ชื่อคลัง
  const warehouseNames = useMemo(
    () => [...new Set(stock.map(s => s.line_name))].filter(n => n && !lines.some(l => l.name === n)).sort(lineNameCompare),
    [stock, lines],
  );
  // ไลน์แม่ (มีไลน์ลูก) = ระดับแผนก — ใช้เตือนตอนจ่ายพาร์ท และตรวจสต๊อกที่ค้างผิดชั้น
  const childLinesOf = useMemo(() => {
    const m = {};
    lines.forEach(l => { if (l.parent_line_name) (m[l.parent_line_name] ||= []).push(l.name); });
    return m;
  }, [lines]);
  const [showTxn,    setShowTxn]    = useState(false);
  // ย่อ/ขยายกลุ่มไลน์-คลัง — จำ override ของ user (default = กาง) · ดู docs/UI-CONVENTIONS.md §6.8
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('ls_group_collapse') || '[]')); } catch { return new Set(); }
  });
  const persistCollapsed = (next) => {
    try { localStorage.setItem('ls_group_collapse', JSON.stringify([...next])); } catch { /* ignore */ }
    setCollapsedGroups(next);
  };
  const toggleGroup = (name) => {
    const next = new Set(collapsedGroups);
    next.has(name) ? next.delete(name) : next.add(name);
    persistCollapsed(next);
  };
  const [showForm,   setShowForm]   = useState(false);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  /* วัตถุดิบ/งาน blank ที่ถูกจ่ายเข้าไลน์ขั้นถัดไป = ต้นเหตุที่ของไปกองผิดแผนก
     ⚠️ ต้อง select `line_type` มาด้วย ไม่งั้นเงียบตลอด (บั๊กเดิม: ตัวเตือน flow ไม่เคยทำงานเลย) */
  const placementWarn = useMemo(() => {
    const lt = lines.find(l => l.name === form.line_name)?.line_type;
    return checkStockPlacement(form.mat_no, form.part_name || bomMap[(form.mat_no || '').trim().toUpperCase()], lt);
  }, [form.mat_no, form.part_name, form.line_name, lines, bomMap]);

  // ── store review queue ──
  const [pending,     setPending]     = useState([]);   // manual movements รออนุมัติ
  const [showPending, setShowPending] = useState(false);
  const [reviewing,   setReviewing]   = useState(null);  // txn id ที่กำลังอนุมัติ/ปฏิเสธ
  const [rejectTx,    setRejectTx]    = useState(null);  // txn ที่กำลังกรอกเหตุผลปฏิเสธ
  const [rejectReason,setRejectReason]= useState('');

  const load = useCallback(async () => {
    // ⚠️ ทุกตารางในนี้โตเกิน 1000 แถวได้ → ต้อง paginate ทั้งหมด (กฎ CLAUDE.md)
    //    เดิม paginate แค่ line_stock_summary ตัวเดียว · ตัวที่เจ็บที่สุดคือ `bom_items`
    //    เพราะมันเป็นที่มาของ "ไลน์ลูกปลายทาง" ใน StockMoveToChild — ตกหล่นเมื่อไหร่
    //    พาร์ทนั้นจะกลายเป็น "ใช้หลายไลน์ ต้องเลือกเอง" ทั้งที่จริงชี้ไลน์เดียวชัดเจน
    //    (เสนอผิดแบบเงียบ = คนเลือกปลายทางผิด แล้วหักสต็อกผิดตัว ย้อนยาก)
    const [{ data: ln, error: lnErr }, stkRes, bomRes, prodRes, ksRes, pmRes] = await Promise.all([
      // ⚠️ ต้อง select ให้ครบ — ขาด parent_line_name = dropdown ไม่มีลำดับชั้น
      //    ขาด section = กรอง scope ไม่ได้ · ขาด is_active = ไลน์ปลดระวางโผล่ปน (ดู LineSelect.jsx)
      loadLinesRes(),
      // ⚠️ view นี้โตเกิน 1000 แถวได้ — select เฉยๆ โดนตัดเงียบแล้วยอดสต็อกหายจากจอเขียนหลักของ store (QC flow-audit #30)
      fetchAllPages(() => supabaseDR.from('line_stock_summary').select('*'),
        { orderBy: ['line_name', 'mat_no'] }),
      fetchAllPages(() => supabaseDR.from('bom_items').select('product_id, mat_no, part_name').eq('is_active', true),
        { orderBy: 'id' }),
      fetchAllPages(() => supabaseDR.from('dr_products').select('id, name, mat_no, line_name, p_no').eq('is_active', true),
        { orderBy: ['line_name', 'name', 'id'] }),
      fetchAllPages(() => supabaseDR.from('kanban_standards').select('mat_no, min_qty, max_qty, qty_per_kanban').eq('is_active', true),
        { orderBy: 'id' }),
      fetchAllPages(() => supabaseDR.from('parts_master').select('mat_no, part_no').eq('is_active', true),
        { orderBy: 'id' }),
    ]);
    const boms = bomRes.rows, prods = prodRes.rows, ks = ksRes.rows, pm = pmRes.rows;
    // ⚠️ โหลดไม่ครบ = ต้องบอก ห้ามเงียบ — จอจะดูปกติทุกอย่าง แต่ข้อเสนอปลายทาง/ชื่อพาร์ท/min-max หายไปเฉยๆ
    /* ⚠️ เดิมเช็ค 4 ตารางรอง แต่ **ลืมตัวสต็อกเอง** (audit 2026-09-02)
     ⇒ ยอด on-hand หายไปเงียบๆ แล้ว min/max คำนวณจากยอดที่ไม่ครบ
        → แถวที่จริงต่ำกว่า Min กลับไม่ขึ้นเตือน ซึ่งเป็นงานหลักของหน้านี้ */
  const bad = [['ยอดสต็อกในไลน์', stkRes], ['ทะเบียนไลน์', { error: lnErr }],
    ['สูตร BOM', bomRes], ['สินค้า', prodRes], ['ค่ามาตรฐานคัมบัง', ksRes], ['ทะเบียนพาร์ท', pmRes]]
      .filter(([, r]) => r.error || r.truncated).map(([n]) => n);
    if (bad.length) toast.error(`⚠ โหลดไม่ครบ: ${bad.join(' · ')} — ตัวเลข/ข้อเสนอบางส่วนอาจขาด ลองรีเฟรช`);
    setLines(ln || []);
    setStock(stkRes.rows || []);
    setProducts(prods || []);
    const bm = {};
    const pb = {};
    (boms || []).forEach(b => {
      if (!bm[b.mat_no]) bm[b.mat_no] = b.part_name;
      (pb[b.product_id] = pb[b.product_id] || []).push({ mat_no: b.mat_no, part_name: b.part_name });
    });
    setBomMap(bm);
    setProductBom(pb);
    const km = {};
    /* std = `qty_per_kanban` (จำนวนต่อกล่อง/คัมบัง = คอลัมน์ STD/PCS ในใบของทีมวางแผน)
       🔴 คนละตัวกับ `lot_size` (ขนาดล็อตผลิต) — ห้ามสลับ (ดู kanban-auto-calc.md) */
    (ks || []).forEach(s => { km[s.mat_no] = { min: s.min_qty, max: s.max_qty, std: s.qty_per_kanban }; });
    setKsMap(km);
    const known = new Set();
    (pm || []).forEach(p => known.add(p.mat_no));
    (boms || []).forEach(b => known.add(b.mat_no));
    setKnownMats(known);
    // 🔎 Part No. สำหรับช่องค้นหาในแท็บ Stock — parts_master.part_no ก่อน · ถอยไป dr_products.p_no (09/11)
    const pn = {};
    (prods || []).forEach(p => { if (p.mat_no && p.p_no) pn[p.mat_no] = String(p.p_no); });
    (pm || []).forEach(p => { if (p.mat_no && p.part_no) pn[p.mat_no] = String(p.part_no); });
    setPartNoMap(pn);
  }, []);

  // สถานะ stock ตาม min/max จริง (kanban_standards) — ถ้าไม่มี min ตั้งไว้ fallback < 10
  const stockStatus = useCallback((qty, mat_no) => {
    const min = ksMap[mat_no]?.min;
    if (qty <= 0) return { label: 'หมด/ติดลบ', color:'var(--red)', bg:'var(--red-dim)', low:true };
    if (min != null && qty <= min) return { label:`🟡 ต่ำกว่า min (${min})`, color:'var(--amber)', bg:'var(--amber-dim)', low:true };
    if (min == null && qty < 10)   return { label: 'เหลือน้อย', color:'var(--amber)', bg:'var(--amber-dim)', low:true };
    return { label: 'ปกติ', color:'var(--green)', bg:'var(--green-dim)', low:false };
  }, [ksMap]);

  // on-hand ปัจจุบันของ line+mat (จาก stock ที่โหลดมา) — ใช้โชว์ในฟอร์ม + กันติดลบ
  const onHandOf = useCallback((line_name, mat_no) => {
    const row = stock.find(s => s.line_name === line_name && s.mat_no === (mat_no || '').trim().toUpperCase());
    return row ? (parseFloat(row.qty_on_hand) || 0) : 0;
  }, [stock]);

  /* 📋 04/11 (user: "อยากดูเยอะกว่า 100 ทำยังไง มันควรมีระบบ time base filter / search engine และ export data")
     เดิม = 100 แถวล่าสุดตายตัว · ตอนนี้ = ช่วงวันทำงาน (`<TimeRangeBar>` · ?from=&to=) ดึงครบทุกหน้า (fetchAllRows)
     · เพดาน TXN_MAX_DAYS กัน egress (ตารางนี้โตวันละหลายร้อยแถว) — เกินเพดาน = บอกบนจอ ไม่ดึง (ห้ามตัดเงียบ)
     · เลือกเฉพาะคอลัมน์ที่จอ/CSV ใช้ (กฎเหล็ก DB ข้อ 11) · ค้นหา = กรองในเครื่อง · export = ทุกแถวที่ผ่านตัวกรอง */
  const txnTr = useTimeRange({ defaultDays: 7, finest: 'day' });
  const txnDays = rangeDays(txnTr.from, txnTr.to);
  const [txnQ, setTxnQ] = useState('');
  const [txnShow, setTxnShow] = useState(TXN_PAGE);
  const [txnErr, setTxnErr] = useState('');
  const [txnLoading, setTxnLoading] = useState(false);
  const txnReq = useRef(0);
  const loadTxns = useCallback(async () => {
    const my = ++txnReq.current;   // กันผลรอบเก่าทับรอบใหม่ (กฎเหล็ก DB ข้อ 4)
    if (txnDays > TXN_MAX_DAYS) { setTxns([]); setTxnErr(`ช่วงที่เลือก ${txnDays} วัน เกินเพดาน ${TXN_MAX_DAYS} วัน — เลือกช่วงให้สั้นลง (หรือกรองไลน์) แล้วค่อย export ทีละช่วง`); return; }
    setTxnLoading(true);
    const { data, error } = await fetchAllRows(supabaseDR, 'line_stock_transactions', TXN_COLS, q => {
      let x = q.gte('work_date', txnTr.from).lte('work_date', txnTr.to).order('created_at', { ascending: false }).order('id');
      if (lineFilter) x = x.eq('line_name', lineFilter);
      return x;
    });
    if (my !== txnReq.current) return;
    setTxnLoading(false);
    if (error) { setTxnErr(`โหลดประวัติไม่ครบ: ${error.message}`); setTxns(data || []); return; }
    setTxnErr(''); setTxns(data || []); setTxnShow(TXN_PAGE);
  }, [lineFilter, txnTr.from, txnTr.to, txnDays]);

  const loadPending = useCallback(async () => {
    const { data } = await supabaseDR.from('line_stock_transactions')
      .select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(200);
    setPending(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadPending(); }, [loadPending]);
  useEffect(() => { if (showTxn) loadTxns(); }, [showTxn, loadTxns, lineFilter]);

  // อนุมัติ/ปฏิเสธ movement ที่ pending — .eq('status','pending') กันเขียนซ้ำ แต่ update ที่ match 0 แถว
  // "คืนสำเร็จไม่มี error" → ต้องนับแถวจริงเสมอ ไม่งั้นคนที่สองได้ toast อนุมัติทั้งที่อีกคนปฏิเสธไปแล้ว
  const reviewTxn = async (txn, decision, reason) => {
    /* 🔐 ด่านซ้ำตอนกดจริง — ลิสต์กรองแล้วยังไม่พอ (แถวเก่าค้างในหน่วยความจำ/กดจาก 2 แท็บ) */
    const w = canWriteLine(wctx, txn.line_name, lines);
    if (!w.ok) { toast.info(writeBlockText(w, { what: 'ใบขอปรับยอดของไลน์นี้' })); return; }
    setReviewing(txn.id);
    const patch = decision === 'approved'
      ? { status:'approved', reviewed_by: fullName, reviewed_at: new Date().toISOString(), reject_reason: null }
      : { status:'rejected', reviewed_by: fullName, reviewed_at: new Date().toISOString(), reject_reason: (reason || '').trim() || 'ไม่ระบุเหตุผล' };
    const { data: updated, error } = await supabaseDR.from('line_stock_transactions')
      .update(patch).eq('id', txn.id).eq('status', 'pending').select('id');
    setReviewing(null);
    if (error) { toast.error(error.message); return; }
    if (!updated || updated.length === 0) {
      toast.error('รายการนี้ถูกอนุมัติ/ปฏิเสธโดยคนอื่นไปแล้ว — รีเฟรชคิวให้ใหม่');
      loadPending(); load(); if (showTxn) loadTxns();
      return;
    }
    toast.success(decision === 'approved' ? '✅ อนุมัติแล้ว — เข้า stock' : '❌ ปฏิเสธแล้ว');
    setRejectTx(null); setRejectReason('');
    loadPending(); load(); if (showTxn) loadTxns();
  };

  const handleSave = async () => {
    /* 🔐 ลงรายการเข้า/ออกของไลน์อื่นไม่ได้ (ชั้นที่ 3 · 15/10) */
    const wr = canWriteLine(wctx, form.line_name, lines);
    if (!wr.ok) { toast.info(writeBlockText(wr, { what: 'สต็อกของไลน์นี้' })); return; }
    if (!form.line_name) { toast.error('เลือกไลน์ก่อน'); return; }
    if (!form.mat_no.trim()) { toast.error('กรอก Mat No.'); return; }
    const qty = parseFloat(form.qty);
    if (!qty || qty <= 0) { toast.error('จำนวนต้องมากกว่า 0'); return; }
    const matUpper = form.mat_no.trim().toUpperCase();
    if (form.type === 'issue' && isFgMat(matUpper)) {
      toast.error(`MAT ${matUpper} ขึ้นต้นด้วย 1 = FG งานสำเร็จ — ไม่ต้องจ่ายเข้าไลน์ ระบบหักให้อัตโนมัติเมื่อกด "ส่งแล้ว" ที่หน้า 🚚 Delivery (แก้ยอดใช้ 🔧 ปรับยอด)`);
      return;
    }
    const isAdjustDown = form.type === 'adjust' && form.dir === 'down';
    // กันสร้างของผี: MAT ที่ไม่มีในฐาน (Product Master / parts master / BOM) = ค่าที่พิมพ์เองใน picker ต้องยืนยันก่อน
    // (2026-09-07: MAT ที่เลือกจาก Product Master ไม่ต้องยืนยันซ้ำ — picker ยืนยันทะเบียนให้แล้ว)
    if (!knownMats.has(matUpper) && !bomMap[matUpper] && !drMats.has(matUpper)) {
      if (!window.confirm(`MAT ${matUpper} ไม่มีในฐานข้อมูล (Parts Master / BOM)\nยืนยันสร้างรายการ stock ใหม่?`)) return;
    }
    // กัน stock ติดลบเงียบๆ สำหรับรายการที่หักออก (คืน Store / ปรับลด)
    if (form.type === 'return' || isAdjustDown) {
      const cur = onHandOf(form.line_name, matUpper);
      const after = cur - qty;
      if (after < 0 && !window.confirm(`คงเหลือปัจจุบัน ${cur.toLocaleString()} ชิ้น — ทำรายการนี้แล้วจะติดลบ (${after.toLocaleString()})\nยืนยันดำเนินการ?`)) return;
    }
    // ประเภทที่ต้อง review → บันทึกเป็น pending (ยังไม่มีผลต่อ on-hand จนกว่าจะอนุมัติ)
    const needsReview = REVIEW_TYPES.includes(form.type);
    setSaving(true);
    const { error } = await supabaseDR.from('line_stock_transactions').insert({
      line_name:  form.line_name,
      mat_no:     matUpper,
      part_name:  form.part_name.trim() || bomMap[matUpper] || null,
      qty:        isAdjustDown ? -qty : qty,   // adjust ลด = เก็บ qty ติดลบ (view: adjust = +qty → ลบออกจริง)
      type:       form.type,
      status:     needsReview ? 'pending' : 'approved',
      work_date:  form.work_date,
      note:       form.note.trim() || null,
      created_by: fullName,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast[needsReview ? 'info' : 'success'](
      needsReview ? `${TYPE_LABEL[form.type]} — ส่งคำขอแล้ว รออนุมัติ` : `${TYPE_LABEL[form.type]} — บันทึกแล้ว`);
    setShowForm(false);
    setForm(EMPTY_FORM);
    setBomProduct('');
    load();
    loadPending();
    if (showTxn) loadTxns();
  };

  // MAT ของ Product Master ที่ active (จอนี้โหลดไว้แล้ว) — ใช้ตัดสินว่า MAT ที่กรอกเป็น "ของพิมพ์เอง" หรือไม่
  const drMats = useMemo(() => new Set(products.map(p => String(p.mat_no || '').toUpperCase()).filter(Boolean)), [products]);
  // พาร์ทลูกที่ไม่อยู่ใน dr_products (BOM / parts_master) → กลุ่มแยกใน <ProductSelect> (2026-09-07 แทน dropdown ทำเอง 8 แถว)
  const matExtraOptions = useMemo(() => {
    const out = Object.entries(bomMap).map(([m, name]) => ({ mat_no: m, name, group: tr('🧩 พาร์ทลูก (BOM)') }));
    knownMats.forEach(m => { if (m && !bomMap[m]) out.push({ mat_no: m, name: '', group: tr('🧰 ทะเบียนพาร์ท (parts_master)') }); });
    return out;
  }, [bomMap, knownMats]);

  /* 🔭 ชั้น 0 — ขอบเขตของผู้ดู (QC audit รอบ 4 · 2026-10-09)
     เดิมกรองแค่ `<LineSelect {...scope}>` (dropdown) แต่ชิป/ตาราง/ประวัติโชว์ทุกไลน์
     ทั้งที่ป้ายเขียนว่า "ในสิทธิ์ที่เห็น" ⇒ **จอโกหก** และ supervisor กรองไลน์ที่ตัวเองเห็นในตารางไม่ได้
     · กฎขอบเขตอยู่ที่ `sectionScope.js` จุดเดียว — `null` = ทั้งโรงงาน (admin/ช่าง/QA/สโตร์)
     · 🔴 คลัง (`STORE` / `FG WAREHOUSE`) **ไม่มีในทะเบียนไลน์ ⇒ ตัดสินไม่ได้ ⇒ ไม่ซ่อน**
       แต่ต้องเขียนบนจอ (ดู `scopeNote` ใต้ชิป) — วัดจริง 09/10 = 44% ของแถวทั้งจอ */
  const scopeNames = useMemo(
    () => scopedLineNames({ role: scope.role, lineId: scope.lineId, sections: scope.sections, lines }),
    [scope.role, scope.lineId, scope.sections, lines]);
  const lineNameList = useMemo(() => lines.map(l => l.name), [lines]);
  const stockScoped = useMemo(
    () => filterRowsByLineScope(stock, { scopedNames: scopeNames, lineNames: lineNameList }),
    [stock, scopeNames, lineNameList]);
  const txnScoped = useMemo(
    () => filterRowsByLineScope(txns, { scopedNames: scopeNames, lineNames: lineNameList }),
    [txns, scopeNames, lineNameList]);
  const txnRows = useMemo(() => {
    const n = txnQ.trim().toLowerCase();
    if (!n) return txnScoped.rows;
    return txnScoped.rows.filter(t => [t.mat_no, t.part_name, t.line_name, t.note, t.created_by, TYPE_LABEL[t.type]]
      .some(v => String(v || '').toLowerCase().includes(n)));
  }, [txnScoped.rows, txnQ]);
  const signedQty = (t) => { const q = parseFloat(t.qty) || 0; return (t.type === 'consume' || t.type === 'return') ? -Math.abs(q) : q; };
  const exportTxns = () => {
    if (!txnRows.length) { toast.info('ไม่มีรายการให้ export'); return; }
    const head = ['วันที่งาน', 'เวลาบันทึก', 'ไลน์/คลัง', 'Part Name', 'MAT', 'ประเภท', 'จำนวน', 'สถานะ', 'หมายเหตุ', 'โดย'];
    const body = txnRows.map(t => [t.work_date, t.created_at ? new Date(t.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '',
      t.line_name, t.part_name || '', t.mat_no, TYPE_LABEL[t.type] || t.type, signedQty(t), STATUS_LABEL[t.status] || t.status || '', t.note || '', t.created_by || '']
      .map(csvCell).join(','));
    // CSV = เอกสาร ⇒ ชื่อไฟล์ผ่านทะเบียน /doc-forms (csv_line_stock_txn)
    downloadCsvDoc('csv_line_stock_txn', `line_stock_txn_${txnTr.from}_${txnTr.to}${lineFilter ? '_' + lineFilter : ''}`,
      [head.map(csvCell).join(','), ...body].join('\n'));
  };

  /* 🔐 คิวอนุมัติ = เรื่อง "แก้" ไม่ใช่ "ดู" ⇒ กรองด้วยขอบเขตที่แก้ได้ (ไม่ใช่ scopeNames)
     🔴 ไลน์ที่ไม่อยู่ในทะเบียน (คลัง STORE/FG WAREHOUSE) = ตัดสินไม่ได้ ⇒ **ไม่ซ่อน** (กติกาเดิมของจอนี้)
     🔴 ซ่อนแล้วต้องบอกว่าซ่อนกี่ใบ — "คิวว่าง" กับ "ไม่ใช่ของเรา" คนละเรื่อง (กฎความซื่อสัตย์ของจอ) */
  const pendingMine = useMemo(
    () => writableRows(wctx, pending, (t) => lines.find(l => l.name === t.line_name)?.section),
    [wctx, pending, lines]);
  const pendingHidden = pending.length - pendingMine.length;

  /* กรอง 2 ชั้น: ไลน์/คลัง → ฝั่งงาน (ขาเข้า Store 2xx/3xx/5xx · ขาออก Warehouse FG 1xx)
     ตัวนับบนชิปต้องนับ "หลังกรองไลน์แล้ว" เพื่อให้เลขตรงกับที่ตาข้างล่างเห็นจริง */
  const lineStock = useMemo(() => (
    lineFilter ? stockScoped.rows.filter(s => s.line_name === lineFilter) : stockScoped.rows
  ), [stockScoped, lineFilter]);

  const sideCounts = useMemo(() => {
    const g = splitBySide(lineStock);
    return { inbound: g.inbound.length, outbound: g.outbound.length, unknown: g.unknown.length };
  }, [lineStock]);

  const filteredStock = useMemo(() => (
    sideFilter ? lineStock.filter(s => sideMatches(s.mat_no, sideFilter)) : lineStock
  ), [lineStock, sideFilter]);

  const stockByLine = useMemo(() => {
    const map = {};
    filteredStock.forEach(s => {
      (map[s.line_name] = map[s.line_name] || []).push(s);
    });
    // คลัง (FG WAREHOUSE/STORE — ไม่ใช่ไลน์ผลิต) ขึ้นก่อนเสมอ หาเจอง่าย
    const isWh = (n) => !lines.some(l => l.name === n);
    return Object.fromEntries(Object.entries(map).sort(([a], [b]) => (isWh(b) - isWh(a)) || a.localeCompare(b)));
  }, [filteredStock, lines]);

  const totalLow = filteredStock.filter(s => (s.qty_on_hand || 0) <= 0).length;

  /* 🏬 ทะเบียนรหัสคลังใช้ได้ไหม — โหลดไม่สำเร็จ หรือยังไม่มีรหัสที่ผูกไลน์เลย = ไม่มีอะไรให้จัดกลุ่ม
     ⇒ บังคับโหมดไลน์ + เขียนเหตุผลบนจอ (ห้ามโชว์กลุ่ม "ยังไม่ผูก" ก้อนเดียวแล้วให้เดาเอง) */
  const slocUsable = !slocReg.failed && ((slocReg.rows || []).some(s => s?.is_active !== false && (s?.line_names || []).length) || homeSloc.map.size > 0);
  const groupMode = slocUsable ? groupBy : 'line';

  /* กลุ่มที่เอาไปวาด — 2 โหมดคืนรูปร่างเดียวกัน (key · title · parts[{mat_no, part_name, qty, lineQtys}])
     เพื่อให้ตารางมีตัววาดชุดเดียว (เดิมโหมดไลน์วาดจาก row ดิบ — ก๊อป 2 ชุด = ดริฟต์แน่นอน) */
  const groups = useMemo(() => {
    if (groupMode === 'sloc') {
      return groupStockBySloc(filteredStock, { slocs: slocReg.rows || [], lines, homeOf: homeSloc.map })
        .map(g => ({ ...g, title: slocGroupTitle(g) }));
    }
    return Object.entries(stockByLine).map(([lineName, rows]) => ({
      key: lineName, code: null, lineNames: [lineName],
      title: `${lines.some(l => l.name === lineName) ? '📍' : '🏬'} ${lineName}`,
      parts: rows.map(r => ({
        mat_no: r.mat_no, part_name: r.part_name,
        qty: parseFloat(r.qty_on_hand) || 0,
        lineQtys: [{ line_name: lineName, qty: parseFloat(r.qty_on_hand) || 0 }],
      })),
    }));
  }, [groupMode, filteredStock, slocReg.rows, lines, stockByLine, homeSloc.map]);

  /* กลุ่มที่โชว์จริง = เลือกพื้นที่ (โหมดพื้นที่เท่านั้น) → ค้นหา MAT / Part No / ชื่อพาร์ท
     ⚠️ ตัวเลือกพื้นที่ทำจาก `groups` (ก่อนค้นหา) — ค้นหาแล้วพื้นที่ใน dropdown ต้องไม่หาย */
  const areaActive = groupMode === 'sloc' && areaFilter && groups.some(g => g.key === areaFilter) ? areaFilter : '';
  const stockNeedle = stockQ.trim().toLowerCase();
  const shownGroups = useMemo(() => {
    let gs = areaActive ? groups.filter(g => g.key === areaActive) : groups;
    if (stockNeedle) {
      gs = gs.map(g => ({ ...g, parts: g.parts.filter(p => [p.mat_no, partNoMap[p.mat_no], p.part_name, bomMap[p.mat_no]]
        .some(v => String(v || '').toLowerCase().includes(stockNeedle))) }))
        .filter(g => g.parts.length > 0);
    }
    return gs;
  }, [groups, areaActive, stockNeedle, partNoMap, bomMap]);
  const shownPartCount = shownGroups.reduce((n, g) => n + g.parts.length, 0);
  const allPartCount = groups.reduce((n, g) => n + g.parts.length, 0);
  // เลือกพื้นที่/ค้นหาอยู่ = ต้องเห็นผลทันที ⇒ กางกลุ่มเสมอ (ไม่งั้นค้นเจอแต่ถูกพับไว้)
  const forceOpen = !!(areaActive || stockNeedle);

  /* 🔩 มุม SAP (09/11 · คำสั่ง user) — ชิ้นผ่านขั้น OP ในพื้นที่ แปลงกลับเป็นของที่ขั้นกินด้วยสูตรฝั่ง DR (`fn_op_inputs`
     ชุดเดียวกับตัวตัดสต็อก) แล้วบวกกับของดิบ = ยอดที่ SAP เห็น · กฎคำนวณ `utils/sapView.js`
     โหลดเฉพาะเมื่อมีชิ้นผ่านขั้นอยู่ในจอ · อ่านไม่ได้ = เขียนบนจอ (ห้ามโชว์เหมือนไม่มี) */
  const [opMats, setOpMats] = useState(null);   // Set ของ mat ที่เป็นขั้น OP · null = ยังไม่รู้
  useEffect(() => {
    let alive = true;
    loadProductsMaster().then(ps => { if (alive) setOpMats(new Set((ps || []).filter(p => p.is_operation).map(p => String(p.mat_no || '').trim()))); })
      .catch(() => { if (alive) setOpMats(new Set()); });
    return () => { alive = false; };
  }, []);
  const opInStockKey = useMemo(() => (opMats ? [...new Set(filteredStock.map(r => String(r.mat_no || '').trim()).filter(m => opMats.has(m)))].sort().join('|') : ''),
    [filteredStock, opMats]);
  const [opInputs, setOpInputs] = useState({ map: new Map(), error: null });
  useEffect(() => {
    if (!opInStockKey) { setOpInputs({ map: new Map(), error: null }); return undefined; }
    let alive = true;
    (async () => {
      const map = new Map(); let queue = opInStockKey.split('|'); let err = null;
      for (let depth = 0; depth < 5 && queue.length; depth++) {
        const res = await Promise.all(queue.map(op => supabaseDR.rpc('fn_op_inputs', { p_op: op })));
        const next = [];
        res.forEach((r, i) => {
          if (r.error) { err = r.error.message; return; }
          map.set(queue[i], r.data || []);
          (r.data || []).forEach(x => { if (x.is_op_output && !map.has(x.mat_no)) next.push(x.mat_no); });
        });
        queue = [...new Set(next)];
      }
      if (alive) setOpInputs({ map, error: err });
    })();
    return () => { alive = false; };
  }, [opInStockKey]);

  return (
    <>
      <ReadOnlyNote show={!canIssue} role={role} what="จ่าย/รับของเข้าสโตร์"
        permKey="line_stock:issue" hint={tr('ยังดูยอดคงเหลือ/ประวัติได้ตามปกติ')} />
      {/* UI-STANDARD 2026-09-24 — แถบกรองเดียว ใต้แท็บทันที: ไลน์/คลัง (ขอบเขต) → ฝั่งงาน → ปุ่มคำสั่งชิดขวา (UI-STANDARD §2.1) */}
      <FilterBar>
        {/* คลังปลายทางที่ไม่ใช่ไลน์ผลิต (FG WAREHOUSE / STORE) แยก optgroup ให้ชัด
            ไม่กองปนกับไลน์ผลิต — ของ 2 ชนิดนี้คนละความหมายกันคนละเรื่อง */}
        <LineSelect
          lines={lines} value={lineFilter} onChange={setLineFilter} {...scope}
          placeholder={allOf('ไลน์/คลัง')}
          extraGroups={[{ label: 'คลัง', options: warehouseNames.map(n => ({ value: n })) }]}
        />
        <SideFilterChips value={sideFilter} onChange={setSideFilter} counts={sideCounts} unit="รายการ" />
        {!showTxn && groupMode === 'sloc' && (
          <select value={areaActive} onChange={e => setAreaFilter(e.target.value)} aria-label={tr('เลือกพื้นที่ SAP')}>
            <option value="">{allOf('พื้นที่ SAP')}</option>
            {groups.map(g => <option key={g.key} value={g.key}>{g.title} ({g.parts.length})</option>)}
          </select>
        )}
        {!showTxn && (
          <SearchInput value={stockQ} onChange={setStockQ} fields="MAT / Part No. / ชื่อพาร์ท" ariaLabel="ค้นหาพาร์ทในสต็อก" grow={false} />
        )}
        <span className="spacer" />
        {(pendingMine.length > 0 || canApprove) && (
          <button onClick={() => setShowPending(v => !v)}
            style={{ ...btn(showPending ? 'var(--amber)' : 'var(--bg2)', showPending ? '#1a1206' : 'var(--text)'),
              position: 'relative',
              border: pendingMine.length > 0 ? '1px solid var(--amber)' : '1px solid var(--border)' }}>
            {tr('รออนุมัติ')}{pendingMine.length > 0 ? ` (${pendingMine.length})` : ''}
            <ToggleDot on={showPending} />
          </button>
        )}
        <button onClick={() => setShowTxn(v => !v)} style={btn(showTxn ? 'var(--accent)' : 'var(--bg2)', showTxn ? 'var(--accent-ink)' : 'var(--text)')}>
          {showTxn ? tr('ดู Stock') : tr('ประวัติ Transaction')}
        </button>
        {canIssue && (
          <button onClick={() => { setForm({ ...EMPTY_FORM, type:'issue', work_date:getToday() }); setShowForm(true); }} style={btn('var(--accent)')}>
            + จ่ายพาร์ทเข้าไลน์
          </button>
        )}
        <InfoMore label={tr('สโตร์ กับ จัดส่ง ต่างกันยังไง')} size={11.5} style={{ flexBasis: '100%' }}>
          🏬 สโตร์ = Store ป้อนของเข้าไลน์ (3xx ซื้อนอก · 5xx raw · 2xx ผลิตเอง) · จัดส่ง = Warehouse + Delivery ส่งลูกค้า (FG 1xx)
        </InfoMore>
      </FilterBar>
      <p style={{ margin:'0 0 12px', fontSize:13, color:'var(--muted)' }}>
        <b style={{ color:'var(--text2)' }}>{tr('พาร์ทย่อยคงเหลือในไลน์')}</b> — Store จ่ายพาร์ทเข้าไลน์ · ระบบหักอัตโนมัติตอน close กะ (BOM × qty_ok)
      </p>
      {/* ── คิวอนุมัติ (store review) ── */}
      {showPending && (
        <div style={{ ...card, padding:0, overflow:'hidden', marginBottom:16, borderColor:'var(--amber-line)' }}>
          <div style={{ padding:'12px 16px', background:'var(--amber-dim)', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
            <div style={{ fontWeight:800, fontSize:14, color:'var(--amber)' }}>{tr('⏳ รายการรออนุมัติ (')}{pendingMine.length})
              {pendingHidden > 0 && <span style={{ fontWeight:600, fontSize:12, color:'var(--muted)' }}>
                {' '}{tr('· ซ่อน')} {pendingHidden} {tr('ใบของส่วนงานอื่น (ดูได้ที่ประวัติ แต่อนุมัติไม่ได้)')}</span>}
            </div>
            <div style={{ fontSize:11, color:'var(--muted)' }}>
              {canApprove ? 'อนุมัติแล้วจึงมีผลต่อ stock คงเหลือ' : 'เฉพาะผู้มีสิทธิ์ (admin/manager) อนุมัติได้'}
            </div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'var(--bg2)' }}>
                  {['วันที่','ไลน์','ชิ้นงาน','ประเภท','จำนวน','หมายเหตุ','โดย', canApprove ? 'จัดการ' : 'สถานะ'].map(h => (
                    <th key={h} style={{ padding:'8px 12px', fontSize:11, fontWeight:800, color:'var(--muted)', textAlign:'left', whiteSpace:'nowrap', textTransform:'uppercase' }}>{tr(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingMine.length === 0 && (
                  <tr><td colSpan={8} style={{ padding:30, textAlign:'center', color:'var(--muted)', fontSize:13 }}>{tr('ไม่มีรายการรออนุมัติ')}</td></tr>
                )}
                {pendingMine.map(t => (
                  <tr key={t.id}>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)', whiteSpace:'nowrap' }}>{t.work_date}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:13, fontWeight:600 }}>{t.line_name}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', maxWidth:320 }}>
                      <MatLabel mat={t.mat_no} name={t.part_name} />
                    </td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)' }}>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius: 'var(--r-md)', fontWeight:700, background:`${tint(TYPE_COLOR[t.type], 'dim')}`, color:TYPE_COLOR[t.type] }}>{TYPE_LABEL[t.type]}</span>
                    </td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontWeight:800, fontSize:14, textAlign:'right' }}>{parseFloat(t.qty).toLocaleString()}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)' }}>{t.note || '—'}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)' }}>{t.created_by || '—'}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', whiteSpace:'nowrap' }}>
                      {canApprove ? (
                        <div style={{ display:'flex', gap:6 }}>
                          <button onClick={() => reviewTxn(t, 'approved')} disabled={reviewing === t.id}
                            style={{ ...btn('var(--accent)'), padding:'4px 10px', fontSize:11, opacity: reviewing === t.id ? 0.6 : 1 }}>{tr('อนุมัติ')}</button>
                          <button onClick={() => { setRejectTx(t); setRejectReason(''); }} disabled={reviewing === t.id}
                            style={{ ...btn('var(--bg)', 'var(--red)'), border:'1px solid var(--red)40', padding:'4px 10px', fontSize:11 }}>{tr('ปฏิเสธ')}</button>
                        </div>
                      ) : (
                        <span style={{ fontSize:11, padding:'2px 8px', borderRadius: 'var(--r-md)', fontWeight:700, background:`${tint(STATUS_COLOR.pending, 'dim')}`, color:STATUS_COLOR.pending }}>{STATUS_LABEL.pending}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 🔀 สต๊อกค้างที่ "ไลน์แม่" — ระบบหักตอนผลิตไม่ได้ (ดู StockMoveToChild.jsx) */}
      <StockMoveToChild
        lines={lines} stock={stock} products={products} productBom={productBom}
        canIssue={canIssue} fullName={fullName} workDate={getToday()} onDone={load}
        slocs={slocReg.failed ? null : (slocReg.rows || null)}
      />

      {/* ฝั่งงาน — จอนี้เคยลิสต์ทุกเลข MAT ปนกันทั้งที่คนละแผนกดูแล (feedback หน้างาน 2026-09-03)
          ตัวนับนับหลังกรองไลน์แล้ว → เลขบนชิปตรงกับที่เห็นในตารางเสมอ */}

      {/* Summary chips */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:10, marginBottom:16 }}>
        {/* 📏 ตัวเลขต้องมีหน่วย + ฐานเทียบ (UI §6.18 ข้อ 4) — "1" เฉยๆ ตอบไม่ได้ว่ามากหรือน้อย
            "Stock หมด" เป็นส่วนหนึ่งของ "รายการพาร์ท" จึงบอกสัดส่วนของยอดรวมกำกับ */}
        {[
          { label:'ไลน์ที่มี stock', value: Object.keys(stockByLine).length, unit:'ไลน์', icon:'🏭' },
          { label:'รายการพาร์ท', value: filteredStock.length, unit:'รายการ', icon:'🔩',
            sub: lineFilter ? `เฉพาะ ${lineFilter}`
                 : scopeNames ? `${scopeNames.length} ไลน์ในขอบเขตของคุณ + คลัง` : 'ทุกไลน์/คลัง' },
          { label:'Stock หมด / ติดลบ', value: totalLow, unit:'รายการ', icon:'⚠️', warn: totalLow > 0,
            sub: filteredStock.length > 0 ? `${Math.round(totalLow / filteredStock.length * 100)}% ของ ${filteredStock.length} รายการ` : 'ยังไม่มีรายการ' },
        ].map(c => (
          <div key={c.label} style={{ ...card, padding:'12px 16px', borderColor: c.warn ? 'var(--red-line)' : 'var(--border)' }}>
            <div style={{ fontSize:11, color:'var(--muted)', fontWeight:700 }}>{c.icon} {tr(c.label)}</div>
            <div style={{ fontSize:26, fontWeight:900, fontFamily:'var(--font-display)', color: c.warn ? 'var(--red)' : 'var(--text)', marginTop:2 }}>
              {c.value}<span style={{ fontSize:12, fontWeight:600, color:'var(--text2)', marginLeft:3 }}>{c.unit}</span>
            </div>
            {c.sub && <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* 🔭 ซ่อนอะไรไปต้องเขียนบนจอ — "เคลียร์หมด" ≠ "ถูกกรองออก" (กฎความซื่อสัตย์ของจอ)
          · ตัวที่ตัดสินไม่ได้ (คลังที่ไม่มีในทะเบียนไลน์) โชว์ต่อ แต่ต้องบอกว่าไม่ได้ตรวจขอบเขต */}
      {scopeNames && (stockScoped.hidden > 0 || stockScoped.offRegistry.length > 0) && (
        <div style={{ ...card, padding:'8px 12px', marginBottom:12, fontSize:11.5, color:'var(--text2)',
                      borderColor:'var(--border)', display:'flex', flexWrap:'wrap', gap:'4px 10px' }}>
          <span>🔭 <b>{tr('ขอบเขตของคุณ:')}</b> {scopeNames.join(' · ')}</span>
          {stockScoped.hidden > 0 && (
            <span>{tr('· ซ่อนไลน์นอกขอบเขต')} <b>{stockScoped.hidden.toLocaleString()}</b> {tr('รายการ')}</span>
          )}
          {stockScoped.offRegistry.length > 0 && (
            <span>· <b>{stockScoped.offRegistry.join(' / ')}</b> ไม่ใช่ไลน์ในทะเบียน
              (ตรวจขอบเขตไม่ได้ จึงยังโชว์อยู่)</span>
          )}
        </div>
      )}

      {/* 🏬 สลับมุมมอง + แถบย่อ/กางทุกกลุ่ม — กลุ่มเยอะ+พาร์ทเยอะ ต้องพับเก็บได้
          มุมมอง "พื้นที่ SAP" = คำขอทีมวางแผน 13/10 (ใบ Monitor Stock แบ่งตาม Store Location) */}
      {!showTxn && (() => {
        const keys = shownGroups.map(g => g.key);
        const allFolded = keys.length > 0 && keys.every(k => collapsedGroups.has(k));
        return (
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
            <Segmented value={groupMode} onChange={pickGroupBy}
              options={[{ value:'sloc', label: 'ตามพื้นที่ SAP' }, { value:'line', label: 'ตามไลน์' }]} />
            {keys.length > 1 && !forceOpen && (
              <button type="button" onClick={() => persistCollapsed(allFolded ? new Set() : new Set(keys))}
                style={{ ...inputSt, width:'auto', cursor:'pointer', fontSize:12, padding:'6px 12px' }}>
                {allFolded ? tr('กางทั้งหมด') : tr('ย่อทั้งหมด')}
              </button>
            )}
            <span style={{ fontSize:11, color:'var(--muted)' }}>
              {keys.length} {groupMode === 'sloc' ? 'พื้นที่' : 'ไลน์/คลัง'}
              {forceOpen ? ` · แสดง ${shownPartCount.toLocaleString()} จาก ${allPartCount.toLocaleString()} รายการ` : ' · แตะหัวกลุ่มเพื่อย่อ-กาง'}
              {groupMode === 'sloc' && ' · ยอดในพื้นที่เดียวกันรวมข้ามไลน์แล้ว (MIN/MAX เป็นค่าต่อ MAT ระดับพื้นที่)'}
            </span>
            {groupMode === 'sloc' && homeSloc.error && (
              <span style={{ fontSize:11, color:'var(--red)', fontWeight:700 }}>
                {homeSloc.error === 'not_ready' ? 'ยังไม่มีช่องที่จัดเก็บหลักในฐานข้อมูล' : `โหลดที่จัดเก็บหลักไม่สำเร็จ (${homeSloc.error})`} — ยอดในสโตร์/คลังจะอยู่กลุ่ม "ยังไม่ตั้ง"
              </span>
            )}
            {/* ทะเบียนใช้ไม่ได้ = ต้องบอกว่าทำไมปุ่มพื้นที่ไม่ทำงาน ห้ามเงียบ */}
            {!slocUsable && (
              <span style={{ fontSize:11, color:'var(--amber)', fontWeight:700 }}>
                {slocReg.failed ? 'โหลดทะเบียนรหัสคลังไม่สำเร็จ' : 'ยังไม่มีรหัสคลังที่ผูกไลน์ไว้'} — แสดงตามไลน์ไปก่อน
                (ตั้งที่แท็บ 🏬 โซนคลัง)
              </span>
            )}
          </div>
        );
      })()}

      {/* ── Stock view ──
          ⚠️ ห้ามครอบลิสต์นี้ด้วยกล่อง scroll ซ้อน (`maxHeight: calc(100vh - Npx)` + overflowY)
          เคยทำแล้วพัง: หัวหน้าเพจจริง (แท็บ + ชื่อ + การ์ด KPI 4 ใบ + ตัวกรอง) สูงเกินค่า N ที่เดาไว้มาก
          → กล่องยื่นพ้นขอบจอ สกรอลบาร์ของตัวเองอยู่นอกจอ เลื่อนหน้าเพจก็ไม่ช่วย
          → การ์ดกลุ่มท้ายๆ ถูกตัดครึ่งจนเข้าไม่ถึง (สโตร์/แพลนนิ่งแจ้งว่าใช้งานไม่ได้ 2026-08-19)
          ให้ทั้งหน้า scroll ตามปกติ + ย่อ/กางกลุ่มแทน — ดู docs/UI-CONVENTIONS.md §6.8 */}
      {!showTxn && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {shownGroups.length === 0 && groups.length > 0 ? (
            <div style={{ ...card, padding:'40px 20px', textAlign:'center', color:'var(--muted)', fontSize:14 }}>
              ไม่พบพาร์ทที่ตรงกับ “{stockQ.trim()}”{areaActive ? ' ในพื้นที่ที่เลือก' : ''} {tr('— มีทั้งหมด')} {allPartCount.toLocaleString()} รายการที่ถูกกรองออก
            </div>
          ) : groups.length === 0 ? (
            <div style={{ ...card, padding:'40px 20px', textAlign:'center', color:'var(--muted)', fontSize:14 }}>
              ยังไม่มีข้อมูล Stock{lineFilter ? ` ในไลน์ ${lineFilter}` : ''} — กด "+ จ่ายพาร์ทเข้าไลน์" เพื่อเริ่ม
            </div>
          ) : (
            shownGroups.map(g => {
              const lowParts = g.parts.filter(p => p.qty <= 0);
              /* 🧾 ใบ Monitor Stock ของทีมวางแผนตัดสินด้วย MIN/MAX — พาร์ทที่ยังไม่ตั้งจะขึ้น "—" ทั้งแถว
                 แล้วสถานะถอยไปใช้เกณฑ์สำรอง (< 10 ชิ้น) ⇒ ต้องเขียนบนจอว่ามีกี่รายการที่ยังตัดสินไม่ได้จริง
                 (กฎความซื่อสัตย์ของจอ: ข้อมูลไม่พอ ต้องบอก ห้ามปล่อยให้ดูเหมือนตั้งครบ) */
              const noLvParts = g.parts.filter(p => ksMap[p.mat_no]?.min == null || ksMap[p.mat_no]?.max == null);
              const folded  = !forceOpen && collapsedGroups.has(g.key);
              return (
                <div key={g.key} style={{ ...card, padding:0, overflow:'hidden' }}>
                  <div onClick={() => toggleGroup(g.key)}
                       style={{ padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap', background:'var(--bg2)', borderBottom: folded ? 'none' : '1px solid var(--border)', cursor:'pointer', userSelect:'none' }}>
                    <div style={{ fontWeight:800, fontSize:15, fontFamily:'var(--font-display)', color:'var(--text)', display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:11, color:'var(--muted)', width:10 }}>{folded ? '▶' : '▼'}</span>
                      {g.title}
                    </div>
                    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                      {/* โหมดพื้นที่ต้องบอกว่าก้อนนี้มาจากไลน์ไหนบ้าง — ไม่งั้นตัวเลขรวมไม่มีที่มา */}
                      {groupMode === 'sloc' && g.lineNames.length > 0 && (
                        <span style={{ fontSize:11, color:'var(--muted)' }}>{g.lineNames.join(' · ')}</span>
                      )}
                      {lowParts.length > 0 && <span style={{ fontSize:11, padding:'2px 9px', borderRadius: 'var(--r-md)', background:'var(--red-dim)', color:'var(--red)', fontWeight:700 }}>⚠️ {lowParts.length} {tr('รายการหมด')}</span>}
                      {noLvParts.length > 0 && (
                        <span title={`ยังไม่ได้ตั้ง MIN/MAX ${noLvParts.length} พาร์ท — แถวนั้นขึ้น "—" และสถานะใช้เกณฑ์สำรอง (เหลือน้อยเมื่อต่ำกว่า 10 ชิ้น) · ตั้งค่าจริงที่ /products → แท็บ 🎴 Kanban Std`}
                          style={{ fontSize:11, padding:'2px 9px', borderRadius: 'var(--r-md)', background:'var(--amber-dim)', color:'var(--amber)', fontWeight:700 }}>
                          {noLvParts.length} พาร์ทยังไม่ตั้ง MIN/MAX
                        </span>
                      )}
                      <span style={{ fontSize:11, color:'var(--muted)' }}>{g.parts.length} {tr('พาร์ท')}</span>
                    </div>
                  </div>
                  {/* 🧾 คอลัมน์ตามใบ Monitor Stock ของทีมวางแผน (13/10): ลำดับ · รูป · ชิ้นงาน · STD/กล่อง · MAX · MIN · คงเหลือ
                      ชื่อชิ้นงานต้องผ่าน <MatLabel> (Part No. → ชื่อ → MAT SAP) — ห้ามเรียงเอง (ด่าน matOrderSweep) */}
                  <div style={{ overflowX:'auto', display: folded ? 'none' : undefined }}>
                    <table style={{ width:'100%', borderCollapse:'collapse' }}>
                      <thead>
                        <tr style={{ background:'var(--bg2)' }}>
                          {[['#','left'],['รูป','left'],['ชิ้นงาน','left'],['STD/กล่อง','right'],['MAX','right'],['MIN','right'],['คงเหลือ (ชิ้น)','right'],['สถานะ','left']].map(([h, al]) => (
                            <th key={h} style={{ padding:'8px 14px', fontSize:11, fontWeight:800, color:'var(--muted)', textAlign: al, whiteSpace:'nowrap', textTransform:'uppercase' }}>{tr(h)}</th>
                          ))}
                          {canIssue && <th style={{ padding:'8px 14px', width:90 }}></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {g.parts.map((p, i) => {
                          const qty = p.qty;
                          const st = stockStatus(qty, p.mat_no);
                          const ks = ksMap[p.mat_no];
                          const name = p.part_name || bomMap[p.mat_no];
                          // ปุ่มจ่ายต้องรู้ไลน์ — แถวที่รวมมาจากหลายไลน์ ให้ไปเลือกในฟอร์ม (ห้ามเดาไลน์แทนคน)
                          const oneLine = p.lineQtys.length === 1 ? p.lineQtys[0].line_name : '';
                          return (
                            <tr key={p.mat_no} style={{ opacity: qty <= 0 ? 0.7 : 1 }}>
                              <td style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', fontSize:11.5, color:'var(--muted)' }}>{i + 1}</td>
                              <td style={{ padding:'6px 14px', borderTop:'1px solid var(--border)' }}>
                                <PartThumb url={imgOf(p.mat_no)} alt={[p.mat_no, name].filter(Boolean).join(' · ')} size={40} />
                              </td>
                              <td style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', maxWidth:340 }}>
                                <MatLabel mat={p.mat_no} name={name} size={13} />
                                {/* รวมข้ามไลน์แล้วต้องกางให้เห็นว่าไลน์ไหนถืออยู่เท่าไหร่ (ยอดรวมที่ไม่มีที่มา = คนไม่เชื่อ) */}
                                {groupMode === 'sloc' && p.lineQtys.length > 1 && (
                                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
                                    {p.lineQtys.map(b => `${b.line_name} ${b.qty.toLocaleString()}`).join(' · ')}
                                  </div>
                                )}
                              </td>
                              <td title={tr('จำนวนต่อกล่อง/คัมบัง (ค่ามาตรฐานคัมบัง) — คนละตัวกับขนาดล็อตผลิต')}
                                  style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', textAlign:'right', fontSize:12, color:'var(--muted)', whiteSpace:'nowrap' }}>
                                {ks?.std != null ? Number(ks.std).toLocaleString() : '—'}
                              </td>
                              <td style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', textAlign:'right', fontSize:12, color:'var(--muted)', whiteSpace:'nowrap' }}>
                                {ks?.max != null ? Number(ks.max).toLocaleString() : '—'}
                              </td>
                              <td style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', textAlign:'right', fontSize:12, color:'var(--muted)', whiteSpace:'nowrap' }}>
                                {ks?.min != null ? Number(ks.min).toLocaleString() : '—'}
                              </td>
                              <td style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', textAlign:'right', fontSize:16, fontWeight:900, color: st.color }}>{qty.toLocaleString()}</td>
                              <td style={{ padding:'10px 14px', borderTop:'1px solid var(--border)' }}>
                                <span style={{ fontSize:11, padding:'2px 8px', borderRadius: 'var(--r-md)', fontWeight:700, background: st.bg, color: st.color }}>{tr(st.label)}</span>
                              </td>
                              {canIssue && (
                                <td style={{ padding:'8px 14px', borderTop:'1px solid var(--border)' }}>
                                  {isFgMat(p.mat_no) ? (
                                    <span title='FG งานสำเร็จ — หักอัตโนมัติเมื่อกด "ส่งแล้ว" ที่หน้า Delivery ไม่ต้องจ่ายเข้าไลน์'
                                      style={{ fontSize:11, fontWeight:700, color:'var(--muted)', whiteSpace:'nowrap' }}>
                                      หักผ่าน Delivery
                                    </span>
                                  ) : (
                                    <button title={oneLine ? `จ่ายเข้า ${oneLine}` : 'พาร์ทนี้อยู่หลายไลน์ในพื้นที่เดียวกัน — เลือกไลน์ปลายทางในฟอร์ม'}
                                      onClick={() => { setForm({ ...EMPTY_FORM, line_name: oneLine, mat_no: p.mat_no, part_name: name || '', type:'issue', work_date:getToday() }); setShowForm(true); }}
                                      style={{ ...btn('var(--green-dim)', 'var(--green)'), padding:'4px 10px', fontSize:11, border:'1px solid var(--green-line)' }}>
                                      + จ่าย
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* 🔩 มุม SAP — โชว์เฉพาะพื้นที่ที่มีชิ้นผ่านขั้น OP */}
                  {!folded && groupMode === 'sloc' && (() => {
                    const sv = sapEquivalent(g.parts.map(p => ({ mat_no: p.mat_no, qty: p.qty })), opInputs.map);
                    if (!sv.ops.length) return null;
                    return (
                      <div style={{ padding:'10px 16px', borderTop:'1px solid var(--border)', background:'var(--blue-dim)' }}>
                        <div style={{ fontSize:12.5, fontWeight:800, color:'var(--text)' }}>🔩 มุม SAP
                          <span style={{ fontWeight:400, fontSize:11.5, color:'var(--muted)' }}> {tr('· ชิ้นผ่านขั้น OP ยังไม่ถูกแม่ใช้ ⇒ ใน SAP ยังเป็นของที่ขั้นกิน (SAP ตัดตอนคอนเฟิร์มแม่)')}</span>
                        </div>
                        {opInputs.error && <div style={{ fontSize:11.5, color:'var(--red)', marginTop:4 }}>{tr('⚠ อ่านสูตรขั้น OP ไม่ได้ (')}{opInputs.error}) — ตัวเลขมุม SAP ด้านล่างอาจไม่ครบ</div>}
                        <div style={{ fontSize:11.5, color:'var(--text2)', marginTop:4 }}>
                          ชิ้นผ่านขั้นในพื้นที่: {sv.ops.map(o => `${o.mat_no} ${Number(o.qty).toLocaleString()}${o.unmapped ? ' (ขั้นยังไม่ผูกว่ากินอะไร — แปลงไม่ได้)' : ''}`).join(' · ')}
                        </div>
                        {sv.rows.length > 0 && (
                          <table style={{ marginTop:6, borderCollapse:'collapse', fontSize:12 }}>
                            <thead><tr>{['ของที่ขั้นกิน','ในระบบ (ของดิบ)','+ ชิ้นผ่านขั้น','= SAP เห็น'].map(h => (
                              <th key={h} style={{ padding:'4px 12px', textAlign: h === 'ของที่ขั้นกิน' ? 'left' : 'right', fontSize:11, color:'var(--muted)', fontWeight:800 }}>{tr(h)}</th>))}</tr></thead>
                            <tbody>{sv.rows.map(r => (
                              <tr key={r.mat_no}>
                                <td style={{ padding:'4px 12px' }}><MatLabel mat={r.mat_no} name={bomMap[r.mat_no]} size={12} /></td>
                                <td style={{ padding:'4px 12px', textAlign:'right' }}>{r.own.toLocaleString()}</td>
                                <td style={{ padding:'4px 12px', textAlign:'right', color:'var(--blue)' }}>+{r.fromOps.toLocaleString()}</td>
                                <td style={{ padding:'4px 12px', textAlign:'right', fontWeight:900 }}>{r.sap.toLocaleString()}</td>
                              </tr>))}</tbody>
                          </table>
                        )}
                      </div>
                    );
                  })()}
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
            <div style={{ fontWeight:700, fontSize:14 }}>
              ประวัติ Transaction {txnTr.from} – {txnTr.to} · {txnLoading ? 'กำลังโหลด…' : `${txnRows.length.toLocaleString()} รายการ`}
              {txnQ.trim() && !txnLoading ? <span style={{ fontWeight:400, fontSize:12, color:'var(--muted)' }}> {tr('(ซ่อน')} {(txnScoped.rows.length - txnRows.length).toLocaleString()} ที่ไม่ตรงคำค้น)</span> : null}
            </div>
            {canIssue && (
              <div style={{ display:'flex', gap:6 }}>
                {['issue','return','adjust'].map(t => (
                  <button key={t} onClick={() => { setForm({ ...EMPTY_FORM, type:t, work_date:getToday() }); setShowForm(true); }}
                    style={{ ...btn('var(--bg)', TYPE_COLOR[t]), border:`1px solid ${tint(TYPE_COLOR[t], 'line')}`, fontSize:11, padding:'4px 10px' }}>
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)' }}>
            <TimeRangeBar scale={txnTr.scale} from={txnTr.from} to={txnTr.to} today={txnTr.today} scales={null}
              onFrom={txnTr.setFrom} onTo={txnTr.setTo} onPreset={txnTr.setPreset} onReload={loadTxns} loading={txnLoading}>
              <SearchInput value={txnQ} onChange={setTxnQ} fields="MAT / ชื่อพาร์ท / ไลน์ / หมายเหตุ / ผู้บันทึก" ariaLabel="ค้นหาประวัติ transaction" />
              <button onClick={exportTxns} disabled={!txnRows.length} style={{ ...btn('var(--bg)', 'var(--text)'), border:'1px solid var(--border2)', fontSize:12 }}>Export CSV</button>
            </TimeRangeBar>
            {txnErr && <div style={{ marginTop:8, fontSize:12.5, color:'var(--red)', fontWeight:700 }}>{txnErr}</div>}
          </div>
          <div className="table-sticky" style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'var(--bg2)' }}>
                  {['วันที่','ไลน์','ชิ้นงาน','ประเภท','จำนวน','หมายเหตุ','โดย'].map(h => (
                    <th key={h} style={{ padding:'8px 12px', fontSize:11, fontWeight:800, color:'var(--muted)', textAlign:'left', whiteSpace:'nowrap', textTransform:'uppercase' }}>{tr(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!txnLoading && txnRows.length === 0 && (
                  <tr><td colSpan={7} style={{ padding:30, textAlign:'center', color:'var(--muted)', fontSize:13 }}>{txnErr ? tr('โหลดไม่สำเร็จ — ดูข้อความด้านบน') : tr('ไม่มีรายการในช่วง/คำค้นนี้')}</td></tr>
                )}
                {txnRows.slice(0, txnShow).map(t => (
                  <tr key={t.id}>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)', whiteSpace:'nowrap' }}>{t.work_date}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:13, fontWeight:600 }}>{t.line_name}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', maxWidth:320 }}>
                      <MatLabel mat={t.mat_no} name={t.part_name} />
                    </td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)' }}>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius: 'var(--r-md)', fontWeight:700, background:`${tint(TYPE_COLOR[t.type], 'dim')}`, color:TYPE_COLOR[t.type] }}>{TYPE_LABEL[t.type]}</span>
                      {t.status && t.status !== 'approved' && (
                        <span title={t.reject_reason || ''} style={{ marginLeft:6, fontSize:11, padding:'2px 6px', borderRadius: 'var(--r-md)', fontWeight:700, background:`${tint(STATUS_COLOR[t.status], 'dim')}`, color:STATUS_COLOR[t.status] }}>{STATUS_LABEL[t.status]}</span>
                      )}
                    </td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontWeight:800, fontSize:14, color: t.status !== 'approved' ? 'var(--muted)' : t.type === 'consume' ? '#94a3b8' : t.type === 'return' ? '#f59e0b' : '#22c55e', textAlign:'right', opacity: t.status !== 'approved' ? 0.55 : 1 }}>
                      {(() => { const s = signedQty(t); return (s >= 0 ? '+' : '') + s.toLocaleString(); })()}
                    </td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)' }}>{t.note || '—'}</td>
                    <td style={{ padding:'8px 12px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)' }}>{t.created_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {txnRows.length > txnShow && (
            <div style={{ padding:'10px 16px', borderTop:'1px solid var(--border)', display:'flex', gap:10, alignItems:'center', fontSize:12.5, color:'var(--muted)' }}>
              แสดง {txnShow.toLocaleString()} {tr('จาก')} {txnRows.length.toLocaleString()} รายการ
              <button onClick={() => setTxnShow(n => n + TXN_PAGE)} style={{ ...btn('var(--bg)', 'var(--text)'), border:'1px solid var(--border2)', fontSize:12 }}>{tr('แสดงเพิ่ม')} {Math.min(TXN_PAGE, txnRows.length - txnShow).toLocaleString()}</button>
              <span>{tr('· Export CSV ได้ครบทุกแถว')}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Issue / Adjust modal ── */}
      {showForm && (
        <div style={{ position:'fixed', inset:0, background:'var(--scrim)', WebkitBackdropFilter:'var(--scrim-blur)', backdropFilter:'var(--scrim-blur)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius: 'var(--r-lg)', padding:24, width:'min(900px,96vw)', maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:800, color:'var(--text)', marginBottom:16, fontFamily:'var(--font-display)' }}>
              {TYPE_LABEL[form.type]}
            </div>
            {/* จอกว้างเรียง 2 คอลัมน์ ลด scroll (UI-CONVENTIONS §5) — mgrid ยุบคอลัมน์เดียวบนมือถือ */}
            <div className="mgrid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, alignItems:'start' }}>
              {/* Type selector */}
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:6 }}>{tr('ประเภท')}</label>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {['issue','return','adjust'].map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, type:t }))}
                      style={{ padding:'6px 14px', borderRadius: 'var(--r-md)', border:`1px solid ${form.type===t ? TYPE_COLOR[t] : 'var(--border)'}`, cursor:'pointer', fontSize:12, fontWeight:700,
                        background: form.type===t ? `${tint(TYPE_COLOR[t], 'dim')}` : 'var(--bg2)',
                        color: form.type===t ? TYPE_COLOR[t] : 'var(--muted)',
                        fontFamily:'var(--font-body)' }}>
                      {TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mgrid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('ไลน์การผลิต *')}</label>
                  <LineSelect
                    lines={lines} value={form.line_name} {...scope} style={inputSt} placeholder={tr('เลือกไลน์...')}
                    onChange={v => setForm(f => ({ ...f, line_name: v }))}
                    extraGroups={[{ label: 'คลัง', options: warehouseNames.map(n => ({ value: n })) }]}
                  />
                  {/* ⚠️ ไลน์แม่ = ระดับแผนก งานผลิตเปิดกะที่ไลน์ลูก — ของที่ฝากไว้ที่ไลน์แม่
                      จะถูกหักตอนปิดใบผลิตไม่ได้เลย (backflush หาด้วยชื่อไลน์ที่เปิดกะ)
                      เตือนอย่างเดียว ไม่บล็อก — บางกรณีอาจตั้งใจฝากไว้ที่แผนกจริง */}
                  {childLinesOf[form.line_name]?.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--amber)', lineHeight: 1.6 }}>
                      ⚠️ <b>{form.line_name}</b> {tr('เป็นไลน์ระดับแผนก (มีไลน์ลูก')} {childLinesOf[form.line_name].join(' · ')})
                      — ของที่จ่ายเข้าที่นี่ <b>{tr('ระบบจะหักตอนปิดใบผลิตไม่ได้')}</b> เพราะงานเปิดกะที่ไลน์ลูก
                      <br />{tr('แนะนำให้เลือก')}<b>{tr('ไลน์ลูก')}</b>ที่ใช้พาร์ทนี้จริงแทน
                    </div>
                  )}
                  {/* 🔴 ปิดที่ต้นเหตุ — วัตถุดิบ/งาน blank ถูกจ่ายเข้าไลน์ขั้นถัดไป คือที่มาของ
                      "coil ไปกองอยู่แผนกประกอบ" ที่ต้องมาตามย้ายทีหลัง (feedback 2026-09-03)
                      ⚠️ เตือนอย่างเดียว ไม่บล็อก (บางไลน์ปั๊ม+ประกอบรวมกันจริง) */}
                  {placementWarn && (
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--red)', fontWeight: 700, lineHeight: 1.6 }}>
                      🔴 {placementWarn.text}
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('วันที่')}</label>
                  <input type="date" style={inputSt} value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date:e.target.value }))} />
                </div>
              </div>

              {/* เลือก MAT จาก BOM ของ product */}
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--blue)', display:'block', marginBottom:4 }}>{tr('ดึง MAT จาก BOM ของ Product (ไม่บังคับ)')}</label>
                <SearchSelect value={String(bomProduct || '')} placeholder={tr('— ค้นหา Product (MAT/ชื่อ) เพื่อดูพาร์ทย่อยใน BOM —')} inputStyle={inputSt}
                  /* 🔴 เลข MAT ต้องอยู่ช่อง `code` (nowrap ห้ามตัด) ไม่ใช่ต่อท้าย `label`
                     — label ถูก ellipsis ตัดท้าย ⇒ MAT ที่อยู่ท้ายสุดหายทุกแถว (QC 06/10)
                     รหัสที่ถูกตัดครึ่งไม่ได้แค่อ่านไม่ครบ แต่ **อ่านผิดตัวได้** */
                  options={products.map(p => ({
                    id: String(p.id),
                    label: p.name || `MAT ${p.mat_no}`,           // ชื่อที่ช่องโชว์เมื่อเลือกแล้ว (ไม่มีชื่อ = ยก MAT ขึ้น ห้ามได้ช่องว่าง)
                    title: p.name || `MAT ${p.mat_no}`,
                    code: p.name && p.mat_no ? `MAT ${p.mat_no}` : null,
                    sub: p.line_name || '',
                    keywords: p.mat_no || '',
                  }))}
                  onChange={({ id }) => setBomProduct(id)} />
                {bomProduct && (productBom[bomProduct] || []).length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
                    {(productBom[bomProduct] || []).map(c => {
                      const sel = form.mat_no === c.mat_no;
                      return (
                        <button key={c.mat_no} type="button"
                          onClick={() => setForm(f => ({ ...f, mat_no: c.mat_no, part_name: c.part_name || f.part_name }))}
                          title={c.part_name || ''}
                          style={{ padding:'5px 10px', borderRadius: 'var(--r-md)', cursor:'pointer', fontSize:12, fontFamily:'monospace', fontWeight:700,
                            background: sel ? 'var(--blue-dim)' : 'var(--bg2)',
                            color: sel ? 'var(--blue)' : 'var(--text2)',
                            border:`1px solid ${sel ? 'var(--blue)' : 'var(--border)'}` }}>
                          {c.mat_no}
                        </button>
                      );
                    })}
                  </div>
                )}
                {bomProduct && (productBom[bomProduct] || []).length === 0 && (
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>{tr('product นี้ยังไม่มี BOM')}</div>
                )}
              </div>

              {/* MAT SAP — picker กลาง Product Master ∪ BOM ∪ parts_master (2026-09-07 แทน input+dropdown ทำเอง)
                  พิมพ์เองได้ (พาร์ทลูกที่ยังไม่เข้าทะเบียนมีจริง — "กันสร้างของผี") แต่ค่าพิมพ์เองติดป้าย + ต้องยืนยันตอนบันทึก */}
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>MAT SAP *</label>
                <ProductSelect value={form.mat_no} allowFree extraOptions={matExtraOptions} history={txnMatHist}
                  lines={form.line_name ? [form.line_name] : undefined}
                  placeholder={tr('ค้น MAT / ชื่อพาร์ท…')} freeHint="MAT นอกทะเบียนต้องยืนยันอีกครั้งตอนบันทึก"
                  inputStyle={{ fontWeight:700 }}
                  onChange={({ mat_no, name }) => setForm(f => ({ ...f, mat_no, part_name: name || bomMap[mat_no] || f.part_name }))} />
              </div>

              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>Part Name</label>
                <input style={inputSt} value={form.part_name} onChange={e => setForm(f => ({ ...f, part_name:e.target.value }))} placeholder={tr('กรอกหรือเลือกจาก Mat SAP')} />
              </div>

              {/* ปรับยอด: เลือกทิศทาง เพิ่ม/ลด (stocktake ที่นับได้น้อยกว่าระบบก็ลดได้) */}
              {form.type === 'adjust' && (
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:6 }}>{tr('ทิศทางปรับ')}</label>
                  <div style={{ display:'flex', gap:6 }}>
                    {[{ k:'up', l:'➕ เพิ่มยอด', c:'var(--green)' }, { k:'down', l:'➖ ลดยอด', c:'var(--red)' }].map(d => (
                      <button key={d.k} type="button" onClick={() => setForm(f => ({ ...f, dir:d.k }))}
                        style={{ flex:1, padding:'7px 10px', borderRadius: 'var(--r-md)', cursor:'pointer', fontSize:12, fontWeight:800, fontFamily:'var(--font-body)',
                          background: form.dir===d.k ? `${tint(d.c, 'dim')}` : 'var(--bg2)', color: form.dir===d.k ? d.c : 'var(--muted)',
                          border:`1px solid ${form.dir===d.k ? d.c : 'var(--border)'}` }}>{d.l}</button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:4 }}>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)' }}>{tr('จำนวน (ชิ้น) *')}</label>
                  {form.line_name && form.mat_no.trim() && (
                    <span style={{ fontSize:11, color:'var(--muted)' }}>{tr('คงเหลือปัจจุบัน:')} <b style={{ color: onHandOf(form.line_name, form.mat_no) <= 0 ? 'var(--red)' : 'var(--text)' }}>{onHandOf(form.line_name, form.mat_no).toLocaleString()}</b></span>
                  )}
                </div>
                <input type="number" min="0.001" step="any" style={{ ...inputSt, fontSize:20, fontWeight:900, textAlign:'center' }}
                  value={form.qty} onChange={e => setForm(f => ({ ...f, qty:e.target.value }))} placeholder="0" />
              </div>

              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('หมายเหตุ')}</label>
                <input style={inputSt} value={form.note} onChange={e => setForm(f => ({ ...f, note:e.target.value }))} placeholder={tr('เช่น Kanban ใบที่ 3, Lot A001...')} />
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:20 }}>
              <button onClick={() => setShowForm(false)} style={{ ...btn('var(--bg2)', 'var(--text)'), border:'1px solid var(--border)' }}>{tr('ยกเลิก')}</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btn(TYPE_COLOR[form.type]), opacity:saving ? 0.6 : 1 }}>
                {saving ? '...' : tr('บันทึก')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject reason modal ── (ฟอร์มมี input → ไม่ปิดจาก backdrop click ตาม UI-CONVENTIONS §5) */}
      {rejectTx && (
        <div className="modal-scroll" style={{ position:'fixed', inset:0, background:'var(--scrim)', WebkitBackdropFilter:'var(--scrim-blur)', backdropFilter:'var(--scrim-blur)', zIndex:1001, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius: 'var(--r-lg)', padding:24, width:'min(420px,100%)' }}>
            <div style={{ fontSize:15, fontWeight:800, color:'var(--text)', marginBottom:6, fontFamily:'var(--font-display)' }}>{tr('❌ ปฏิเสธคำขอ')}</div>
            <div style={{ fontSize:12, color:'var(--muted)', marginBottom:14 }}>
              {TYPE_LABEL[rejectTx.type]} · <span style={{ fontFamily:'monospace', color:'var(--blue)' }}>{rejectTx.mat_no}</span> · {rejectTx.line_name} · {parseFloat(rejectTx.qty).toLocaleString()}
            </div>
            <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('เหตุผลที่ปฏิเสธ')}</label>
            <input style={inputSt} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder={tr('เช่น ยอดไม่ตรงกับการนับจริง')} autoFocus />
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:20 }}>
              <button onClick={() => setRejectTx(null)} style={{ ...btn('var(--bg2)', 'var(--text)'), border:'1px solid var(--border)' }}>{tr('ยกเลิก')}</button>
              <button onClick={() => reviewTxn(rejectTx, 'rejected', rejectReason)} disabled={reviewing === rejectTx.id}
                style={{ ...btn('var(--red)'), opacity: reviewing === rejectTx.id ? 0.6 : 1 }}>{tr('ยืนยันปฏิเสธ')}</button>
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

function DeliveryRoundsTab({ canEdit, fullName, scope }) {
  /* 🔐 รอบจัดส่งผูกไลน์ ⇒ แก้/ลบได้เฉพาะไลน์ส่วนงานตัวเอง (audit 15/10 — เดิม load ดึงทุกไลน์
     แล้ว lineFilter เป็นแค่ตัวกรองมุมมองที่ default ว่าง) · สโตร์ถือ scope:all_units จึงไม่กระทบ */
  const { section: homeSection, allUnits, respCostCenters, scopeIdx } = useContext(UserContext);
  const rndCtx = useMemo(() => ({ role: scope?.role, section: homeSection, sections: scope?.sections, allUnits, respCostCenters, scopeIdx }),
    [scope?.role, homeSection, scope?.sections, allUnits, respCostCenters, scopeIdx]);
  const [rounds,     setRounds]     = useState([]);
  const [lines,      setLines]      = useState([]);
  const [lineFilter, setLineFilter] = useState('');
  const [showModal,  setShowModal]  = useState(false);
  const [form,       setForm]       = useState(EMPTY_RND);
  const [editId,     setEditId]     = useState(null);
  const [saving,     setSaving]     = useState(false);

  const load = useCallback(async () => {
    const [{ data: rnd }, lnRes] = await Promise.all([
      supabaseDR.from('kanban_delivery_rounds').select('*').eq('is_active', true).order('line_name').order('shift').order('round_no'),
      // ⚠️ ต้อง select ให้ครบ — ขาด parent_line_name = dropdown ไม่มีลำดับชั้น
      //    ขาด section = กรอง scope ไม่ได้ · ขาด is_active = ไลน์ปลดระวางโผล่ปน (ดู LineSelect.jsx)
      loadLinesRes(),
    ]);
  /* 🔴 30/10 — เดิมแกะแค่ `{ data }` ⇒ ทะเบียนไลน์โหลดไม่สำเร็จแล้วได้ลิสต์ว่าง **เงียบ**
     (หน้างาน PD1 แจ้ง "MO ไม่มีให้เลือกไลน์" ทั้งที่ฐานข้อมูลมีครบ) · เก็บผลทั้งก้อนไว้อ่าน error ได้ */
  const ln = lnRes?.error ? null : lnRes.data;
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

  // เลขรอบที่ "ว่าง" ตัวแรก โดยดูจากรอบที่ยัง active เท่านั้น — ถ้าตรงกับรอบที่ถูกลบ (is_active=false)
  // handleSave จะ reactivate ให้เอง ทำให้รีไซเคิลเลขรอบเดิมได้ ไม่ไต่ขึ้นเรื่อย ๆ
  const nextRoundNo = useCallback((line_name, shift) => {
    const used = new Set(rounds.filter(r => r.line_name === line_name && r.shift === shift)
      .map(r => r.round_no));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }, [rounds]);

  const openNew = () => {
    setEditId(null);
    const ln = lineFilter || '';
    setForm({ ...EMPTY_RND, line_name: ln, round_no: ln ? String(nextRoundNo(ln, 'day')) : '' });
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
    /* ด่านซ้ำตอนเขียนจริง — ไลน์ปลายทางมาจากฟอร์ม */
    const wr = canWriteLine(rndCtx, form.line_name, lines);
    if (!wr.ok) { toast.info(writeBlockText(wr, { what: 'รอบจัดส่งของไลน์นี้' })); return; }
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
      // กันชนกับรอบเดิม (รวมที่ถูกปิด is_active=false) — ถ้า round_no นี้มีอยู่แล้ว ให้รีไซเคิลแถวเดิม / เลื่อนเป็นเลขถัดไป
      const { data: dup } = await supabaseDR.from('kanban_delivery_rounds')
        .select('id, is_active')
        .eq('line_name', payload.line_name).eq('shift', payload.shift).eq('round_no', payload.round_no)
        .maybeSingle();
      if (dup) {
        if (!dup.is_active) {
          // เคยมีรอบนี้แต่ถูกลบไป → เปิดใช้ใหม่พร้อมค่าที่กรอก
          ({ error } = await supabaseDR.from('kanban_delivery_rounds').update(payload).eq('id', dup.id));
        } else {
          // รอบนี้มีอยู่จริง → ขยับเป็นเลขถัดไปที่ว่าง
          const { data: all } = await supabaseDR.from('kanban_delivery_rounds')
            .select('round_no').eq('line_name', payload.line_name).eq('shift', payload.shift);
          payload.round_no = (all || []).reduce((m, r) => Math.max(m, r.round_no || 0), 0) + 1;
          ({ error } = await supabaseDR.from('kanban_delivery_rounds').insert(payload));
        }
      } else {
        ({ error } = await supabaseDR.from('kanban_delivery_rounds').insert(payload));
      }
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editId ? 'แก้ไขรอบจัดส่งแล้ว' : 'เพิ่มรอบจัดส่งแล้ว');
    setShowModal(false);
    load();
  };

  const handleDelete = async (id) => {
    const row = rounds.find(r => r.id === id);
    const wd = canWriteLine(rndCtx, row?.line_name, lines);
    if (!wd.ok) { toast.info(writeBlockText(wd, { what: 'รอบจัดส่งของไลน์นี้' })); return; }
    if (!window.confirm('ยืนยันลบรอบจัดส่งนี้?')) return;
    const { error } = await supabaseDR.from('kanban_delivery_rounds').update({ is_active: false }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบรอบจัดส่งแล้ว');
    load();
  };

  const suggestRound = useCallback(() => {
    setForm(f => ({ ...f, round_no: String(nextRoundNo(form.line_name, form.shift)) }));
  }, [nextRoundNo, form.line_name, form.shift]);

  return (
    <>
      {/* UI-STANDARD §2.1: แถบกรองใต้แท็บทันที (ชื่อแท็บบอกหัวเรื่องแล้ว ไม่วาด h3 ซ้ำ) → คำอธิบาย → เนื้อหา */}
      <FilterBar>
        <LineSelect lines={lines} value={lineFilter} onChange={setLineFilter} {...scope}
          placeholder={ALL.line} />
        <span className="spacer" />
        {canEdit && (
          <button onClick={openNew} style={btn('#0284c7')}>{tr('+ เพิ่มรอบจัดส่ง')}</button>
        )}
      </FilterBar>
      <p style={{ margin:'0 0 12px', fontSize:13, color:'var(--muted)' }}>{tr('⏰ ตั้งค่าเวลาเตรียมและเวลาจัดส่งพาร์ทแต่ละรอบตามไลน์และกะ')}</p>

      {Object.keys(grouped).length === 0 ? (
        <div style={{ ...card, padding:'40px 20px', textAlign:'center', color:'var(--muted)', fontSize:14 }}>
          ยังไม่มีรอบจัดส่ง{lineFilter ? ` สำหรับไลน์ ${lineFilter}` : ''} — กด "+ เพิ่มรอบจัดส่ง" เพื่อเริ่ม
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {Object.entries(grouped).map(([lineName, rndList]) => (
            <div key={lineName} style={{ ...card, padding:0, overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', background:'var(--bg2)', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontWeight:800, fontSize:15, fontFamily:'var(--font-display)', color:'var(--text)' }}>{lineName}</div>
                <span style={{ fontSize:11, color:'var(--muted)' }}>{rndList.length} {tr('รอบ')}</span>
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ background:'var(--bg2)' }}>
                      {['กะ','รอบที่','ตัดยอด','เตรียม','ส่ง','จุด','เสร็จ~','หมายเหตุ'].map(h => (
                        <th key={h} style={{ padding:'8px 14px', fontSize:11, fontWeight:800, color:'var(--muted)', textAlign:'left', whiteSpace:'nowrap', textTransform:'uppercase' }}>{tr(h)}</th>
                      ))}
                      {canEdit && <th style={{ padding:'8px 14px', width:100 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rndList.map(r => (
                      <tr key={r.id}>
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)' }}>
                          <span style={{ fontSize:11, padding:'2px 9px', borderRadius: 'var(--r-md)', fontWeight:700,
                            background: r.shift==='day' ? 'var(--amber-dim)' : r.shift==='night' ? 'rgba(99,102,241,0.12)' : 'var(--green-dim)',
                            color: r.shift==='day' ? '#ca8a04' : r.shift==='night' ? '#818cf8' : '#22c55e' }}>
                            {SHIFT_LABELS[r.shift] || r.shift}
                          </span>
                        </td>
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontWeight:900, fontSize:16, color:'var(--blue)' }}>
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
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontFamily:'monospace', fontSize:13, color:'var(--amber)', fontWeight:700 }}>
                          {addMins(r.delivery_time?.slice(0,5), (r.points_count||1)*(r.time_per_point_min||10))}
                        </td>
                        <td style={{ padding:'9px 14px', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--muted)' }}>
                          {r.note || '—'}
                        </td>
                        {canEdit && (
                          <td style={{ padding:'8px 14px', borderTop:'1px solid var(--border)' }}>
                            <div style={{ display:'flex', gap:6 }}>
                              <IconButton onClick={() => openEdit(r)} title={tr('แก้ไข')}>✏️</IconButton>
                              <DeleteButton onClick={() => handleDelete(r.id)} title={tr('ลบรายการนี้')} />
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
        <div style={{ position:'fixed', inset:0, background:'var(--scrim)', WebkitBackdropFilter:'var(--scrim-blur)', backdropFilter:'var(--scrim-blur)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius: 'var(--r-lg)', padding:24, width:'min(760px,96vw)', maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:800, color:'var(--text)', marginBottom:16, fontFamily:'var(--font-display)' }}>
              ⏰ {editId ? 'แก้ไขรอบจัดส่ง' : 'เพิ่มรอบจัดส่งใหม่'}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('ไลน์การผลิต *')}</label>
                {/* เดิมเป็น input+datalist (พิมพ์เองได้) → รอบจัดส่งที่ชื่อไลน์พิมพ์ผิดจะกำพร้าเงียบ
                    ไม่มีวันแสดงคู่กับไลน์ไหนเลย · เปลี่ยนเป็น LineSelect ให้เลือกจากทะเบียนอย่างเดียว */}
                <LineSelect
                  lines={lines} value={form.line_name} {...scope} style={inputSt} placeholder={tr('เลือกไลน์...')}
                  onChange={v => setForm(f => ({ ...f, line_name: v, round_no: editId ? f.round_no : String(nextRoundNo(v, f.shift)) }))}
                />
              </div>

              <div className="mgrid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('กะ *')}</label>
                  {/* ⚠️ ถอด "🔄 ทุกกะ (all)" ออกแล้ว (2026-08-26) — เป็นตัวเลือกที่ล้มเหลวเงียบ:
                      ตัวจัดสรร demand ใน HeijunkaKanban จับคู่รอบกับกะด้วยคีย์ `${กลุ่มไลน์}|${shift}`
                      แล้วเทียบกับ `production_sessions.shift` ซึ่งมีแค่ 'day'/'night'
                      ⇒ รอบที่ตั้ง 'all' ไม่มีวัน match → ขึ้นบนบอร์ดแต่ได้ 0 พาร์ทตลอดกาล
                      (ตรวจแล้วไม่มีแถวไหนใช้ 'all' เลย — ถอดได้ไม่กระทบใคร)
                      จะรองรับจริงต้องแก้ `roundWindows`/`roundAlloc` ให้แยกคีย์ตามกะด้วย ไม่ใช่แค่ปล่อยตัวเลือกไว้ */}
                  <select value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value, round_no: editId ? f.round_no : String(nextRoundNo(f.line_name, e.target.value)) }))} style={inputSt}>
                    <option value="day">{tr('กะเช้า (day)')}</option>
                    <option value="night">{tr('กะดึก (night)')}</option>
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
                    กะดึกต้องตั้งรอบของตัวเองแยก — รอบกะเช้าไม่ครอบกะดึกให้
                  </div>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('รอบที่ *')}</label>
                  <div style={{ display:'flex', gap:6 }}>
                    <input type="number" min="1" step="1"
                      style={{ ...inputSt, textAlign:'center', fontWeight:900 }}
                      value={form.round_no}
                      onChange={e => setForm(f => ({ ...f, round_no: e.target.value }))}
                      placeholder="1"
                    />
                    {form.line_name && (
                      <button onClick={suggestRound} title={tr('แนะนำรอบถัดไป')}
                        style={{ ...btn('var(--bg2)', 'var(--text)'), border:'1px solid var(--border)', padding:'6px 10px', fontSize:12, flexShrink:0 }}>
                        +1
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Shipping time chart */}
              <div style={{ background:'var(--bg2)', borderRadius: 'var(--r-md)', padding:12, border:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>⏰ Shipping Time Chart</div>
                <div className="mgrid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('ตัดยอดรับออเดอร์')}</label>
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
                    <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('เวลาเตรียมของ (นาที)')}</label>
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
                <div className="mgrid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:'var(--accent)', display:'block', marginBottom:4 }}>{tr('เวลาเริ่มส่ง *')}</label>
                    <input type="time" style={{ ...inputSt, fontFamily:'monospace', fontWeight:800, color:'var(--accent)' }}
                      value={form.delivery_time}
                      onChange={e => setForm(f => ({ ...f, delivery_time: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('จำนวนจุดส่ง')}</label>
                    <input type="number" min="1" style={{ ...inputSt, textAlign:'center' }}
                      value={form.points_count}
                      onChange={e => setForm(f => ({ ...f, points_count: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('นาที/จุด')}</label>
                    <input type="number" min="1" style={{ ...inputSt, textAlign:'center' }}
                      value={form.time_per_point_min}
                      onChange={e => setForm(f => ({ ...f, time_per_point_min: e.target.value }))}
                    />
                  </div>
                </div>
                {form.delivery_time && (
                  <div style={{ fontSize:12, color:'var(--amber)', fontWeight:700 }}>
                    เสร็จประมาณ {addMins(form.delivery_time, (parseInt(form.points_count)||1)*(parseInt(form.time_per_point_min)||10))}
                    {' '}({form.points_count||1} {tr('จุด ×')} {form.time_per_point_min||10} น.)
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'var(--muted)', display:'block', marginBottom:4 }}>{tr('หมายเหตุ')}</label>
                <input style={inputSt}
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder={tr('เช่น รอบก่อนปิดกะ, เร่งด่วน...')}
                />
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:20 }}>
              <button onClick={() => setShowModal(false)} style={{ ...btn('var(--bg2)', 'var(--text)'), border:'1px solid var(--border)' }}>{tr('ยกเลิก')}</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btn('#0284c7'), opacity:saving ? 0.6 : 1 }}>
                {saving ? '...' : tr('บันทึก')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── 🕐 บอร์ดเวลารอบส่งภายใน — สไตล์ Shipping Chart ปลายทางเป็นไลน์ผลิต ──────
   รอบจาก ⏰ รอบจัดส่ง (kanban_delivery_rounds) + สถานะจริงจาก kanban_deliveries
   การกดยืนยันส่ง/รับ อยู่ที่หน้า 🎴 Kanban Board — บอร์ดนี้ไว้มอนิเตอร์ภาพรวมเวลา */
function DeliveryTimeBoardTab() {
  const [rounds, setRounds] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [popup, setPopup] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [breakPolicies, setBreakPolicies] = useState([]);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    supabaseDR.from('break_policies').select('*').eq('is_active', true)
      .then(({ data }) => setBreakPolicies(data || []));
  }, []);

  const workDateNow = () => {
    const d = new Date(nowMs);
    if (d.getHours() < 8) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const load = useCallback(async () => {
    const wd = workDateNow();
    const [{ data: rds }, { data: dlvs }] = await Promise.all([
      supabaseDR.from('kanban_delivery_rounds').select('*').eq('is_active', true).order('line_name').order('round_no'),
      supabaseDR.from('kanban_deliveries').select('*').eq('work_date', wd),
    ]);
    setRounds(rds || []);
    setDeliveries(dlvs || []);
  }, []);
  /* 🔴 2026-09-15 — เดิม **poll ล้วน ไม่มี realtime เลย** (ยิงเต็มทุก 20 นาที 24 ชม.
     ไม่ว่ามีอะไรเปลี่ยนหรือไม่) · ตารางเพิ่งถูกใส่ publication ในรอบนี้ realtime จึงเพิ่งใช้ได้จริง
     useLiveBoard = realtime หลัก + เพดาน coalesce + poll ข้ามรอบเมื่อไม่มี event
     ดู src/utils/useLiveBoard.js · docs/POLLING-AUDIT-2026-09-15.md */
  useLiveBoard(load, {
    // `line_stock_summary` เป็น view → publish ไม่ได้ · ใช้ ledger ที่ป้อน view นั้นเป็นตัวปลุกแทน
    tables: ['line_stock_transactions', 'child_lot_requests'],
    topic: 'line-stock', rate: RATE.ANALYTIC,
  });

  const dlvMap = useMemo(() => {
    const m = {};
    deliveries.forEach(d => { m[`${d.line_name}|${d.shift}|${d.round_no}`] = d; });
    return m;
  }, [deliveries]);

  const nowD = new Date(nowMs);
  const nm = frameMin(`${String(nowD.getHours()).padStart(2, '0')}:${String(nowD.getMinutes()).padStart(2, '0')}`);
  const wd = workDateNow();
  // สถานะรอบส่ง — ใช้ util กลาง (deliveryRounds.js) จุดเดียวกับ Kanban Board · frame-aware ไม่เพี้ยนขอบวันงาน
  const confirmedSet = useMemo(() => new Set(Object.keys(dlvMap)), [dlvMap]);
  const statusOf = (r) => getRoundStatus(r, confirmedSet, dlvMap, wd, nowMs);

  const groups = useMemo(() => {
    const byLine = {};
    rounds.forEach(r => { (byLine[r.line_name] = byLine[r.line_name] || []).push(r); });
    return Object.keys(byLine).sort(lineNameCompare).map(lnName => ({
      key: lnName, label: lnName,
      sub: `${byLine[lnName].length} รอบ · ✔️ ${byLine[lnName].filter(r => dlvMap[`${r.line_name}|${r.shift}|${r.round_no}`]).length} ยืนยันแล้ว`,
      items: byLine[lnName]
        .filter(r => frameMin((r.delivery_time || '').slice(0, 5)) != null)
        .map(r => {
          const st = statusOf(r);
          return {
            id: r.id, timeMin: frameMin(r.delivery_time.slice(0, 5)), color: st.color,
            text: `${r.shift === 'night' ? '🌙' : '☀️'}${r.round_no}·${r.delivery_time.slice(0, 5)}`,
            title: `${lnName} รอบ ${r.round_no} (${r.shift === 'night' ? 'กะดึก' : 'กะเช้า'}) · ตัดยอด ${(r.cutoff_time || '').slice(0, 5) || '—'} · ส่ง ${r.delivery_time.slice(0, 5)} · ${st.label}`,
            data: r,
          };
        }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds, dlvMap, nm, nowMs, confirmedSet]);

  return (
    <>
      <InternalTimeBoard
        title={`บอร์ดรอบส่งภายในวันนี้ — Store → ไลน์ผลิต`}
        hint={tr('ตั้งค่ารอบที่แท็บ ⏰ รอบจัดส่ง · กดยืนยันส่ง/รับที่หน้า 🎴 บอร์ดคัมบัง')}
        groups={groups} nowMin={nm} breaks={breaksToFrame(breakPolicies)}
        onItemClick={(r, x, y) => setPopup({ r, x, y })}
      />
      {popup && (() => {
        const r = popup.r;
        const st = statusOf(r);
        const W = 250;
        const left = Math.max(8, Math.min(popup.x - W / 2, window.innerWidth - W - 12));
        const top = Math.min(popup.y + 12, window.innerHeight - 200);
        return (
          <>
            <div onClick={() => setPopup(null)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
            <div style={{ position: 'fixed', left, top, width: W, zIndex: 1300, background: 'var(--bg3)', border: `1px solid ${tint(st.color, 'line')}`, borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-float)', overflow: 'hidden' }}>
              <div style={{ height: 4, background: st.color }} />
              <div style={{ padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 900, color: 'var(--text)' }}>{r.shift === 'night' ? '🌙' : '☀️'} {tr('รอบ')} {r.round_no}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 'var(--r-md)', background: 'rgba(0,0,0,0.15)', color: st.color }}>{tr(st.label)}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginTop: 2 }}>{r.line_name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.8 }}>
                  ตัดยอด {(r.cutoff_time || '').slice(0, 5) || '—'} {tr('→ ส่ง')} {(r.delivery_time || '').slice(0, 5)}<br />
                  {r.points_count || 1} {tr('จุด ×')} {r.time_per_point_min || 10} {tr('นาที · เตรียม')} {r.prep_minutes || 60} นาที
                </div>
                {st.d?.confirmed_by && <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>{tr('✓ ส่งโดย')} {st.d.confirmed_by}</div>}
                {st.d?.received_by && <div style={{ fontSize: 11, color: st.d.received_status === 'full' ? 'var(--green)' : 'var(--amber)' }}>{st.d.received_status === 'full' ? '✔️' : '⚠️'} {tr('รับโดย')} {st.d.received_by}</div>}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{tr('กดยืนยันส่ง/รับของที่หน้า 🎴 Kanban Board')}</div>
              </div>
            </div>
          </>
        );
      })()}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   TAB: รับเข้าอัตโนมัติ — ปลายทาง stock เมื่อปิดออเดอร์ (stock_inflow_rules)
   ทำงานคู่กับ DB trigger fn_post_confirmed_output บน prod_orders:
   สแกนปิดออเดอร์ปุ๊บ ผลผลิตถูก post เข้า stock ปลายทางทันที ไม่ต้องรอปิดกะ
   ───────────────────────────────────────────────────────────────────────────── */
function InflowRulesTab({ canEdit }) {
  const { role, lineId, sections } = useContext(UserContext);
  const scope = useMemo(() => ({ role, lineId, sections }), [role, lineId, sections]);
  // Product Master สำหรับกฎแบบ "MAT ตรงตัว" — match_value ถูกเทียบตรงกับ line_stock_transactions.mat_no โดย trigger (2026-09-07)
  const { products } = useProducts();
  // 📜 MAT ที่เคยตั้งกฎไว้ (stock_inflow_rules.match_value — รวมค่า prefix ด้วย แต่ picker ใช้เฉพาะโหมด mat) · 2026-09-07
  const ruleMatHist = useColumnHistory(supabaseDR, 'stock_inflow_rules', 'match_value', { upper: true });
  const [rules, setRules] = useState([]);
  const [lines, setLines] = useState([]);
  // ปลายทางที่มีอยู่จริง — derive จากคลังที่มีของ ไม่ hardcode 'FG WAREHOUSE'/'STORE'
  // (ตั้งคลังใหม่แล้วต้องโผล่เองโดยไม่ต้องแก้โค้ด)
  const [dests, setDests] = useState([]);
  const [form, setForm] = useState({ match_type: 'prefix', match_value: '', dest_line_name: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: r }, lnRes, { rows: st }] = await Promise.all([
      supabaseDR.from('stock_inflow_rules').select('*').order('match_type').order('match_value'),
      // ⚠️ ต้อง select ให้ครบ — ขาด parent_line_name = dropdown ไม่มีลำดับชั้น
      //    ขาด section = กรอง scope ไม่ได้ · ขาด is_active = ไลน์ปลดระวางโผล่ปน (ดู LineSelect.jsx)
      loadLinesRes(),
      // แบ่งหน้า — view โตเกิน 1000 แถวเมื่อไหร่ ชื่อคลังท้ายลำดับหายจาก dropdown เงียบ (QC flow-audit #30)
      fetchAllPages(() => supabaseDR.from('line_stock_summary').select('line_name'),
        { orderBy: ['line_name', 'mat_no'] }),
    ]);
  /* 🔴 30/10 — เดิมแกะแค่ `{ data }` ⇒ ทะเบียนไลน์โหลดไม่สำเร็จแล้วได้ลิสต์ว่าง **เงียบ**
     (หน้างาน PD1 แจ้ง "MO ไม่มีให้เลือกไลน์" ทั้งที่ฐานข้อมูลมีครบ) · เก็บผลทั้งก้อนไว้อ่าน error ได้ */
  const ln = lnRes?.error ? null : lnRes.data;
    setRules(r || []);
    setLines(ln || []);
    setDests([...new Set((st || []).map(s => s.line_name).filter(Boolean))].sort(lineNameCompare));
  }, []);
  useEffect(() => { load(); }, [load]);

  /* ด่านชั้น 2 ของทั้งแท็บ — กฎพวกนี้ตัดสินว่า "ของเข้าคลังไหม" ทั้งโรงงาน (ปิดผิด = ของหายเงียบทั้งกะ)
     ⇒ ซ่อนปุ่มไม่พอ ต้องเช็คคีย์เดียวกับปุ่มในทุกฟังก์ชันที่เขียน (สิทธิ์เปลี่ยนระหว่างเปิดจอ / ยิงตรง) */
  const noPerm = () => { if (!canEdit) { toast.error('แก้กฎรับงานเข้าคลังต้องมีสิทธิ์ line_stock:manage_rounds'); return true; } return false; };

  const addRule = async () => {
    if (noPerm()) return;
    const mv = form.match_value.trim().toUpperCase();
    const dest = form.dest_line_name.trim();
    if (!mv) { toast.error(form.match_type === 'prefix' ? 'กรอกเลขขึ้นต้น MAT เช่น 1 หรือ 2' : 'กรอก MAT No.'); return; }
    // MAT ตรงตัวนอก Product Master → ถามยืนยัน (2026-09-07 เดิมบล็อกแข็ง) — trigger เทียบตรงตัว พิมพ์ผิดตัวเดียวของไปกองผิดคลังเงียบๆ จึงเตือนชัด
    if (form.match_type === 'mat' && !products.some(p => String(p.mat_no || '').toUpperCase() === mv)
      && !window.confirm(`MAT ${mv} ไม่มีใน Product Master — กฎจะ match เฉพาะเลขนี้ตรงตัว · ใช้ค่านี้ต่อหรือไม่?`)) return;
    if (!dest) { toast.error('เลือกปลายทาง เช่น FG WAREHOUSE / STORE'); return; }
    setSaving(true);
    const ok = checkWriteRows(await supabaseDR.from('stock_inflow_rules').upsert({ match_type: form.match_type, match_value: mv, dest_line_name: dest, is_active: true, updated_at: new Date().toISOString() }, { onConflict: 'match_type,match_value' }).select('id'), 'บันทึกกฎ');
    setSaving(false);
    if (!ok) return;
    toast.success(`✓ ${form.match_type === 'prefix' ? `MAT ขึ้นต้น ${mv}` : mv} → ${dest}`);
    setForm(f => ({ ...f, match_value: '', dest_line_name: '' }));
    load();
  };

  /* 🔴 3 ทาง ไม่ใช่เปิด/ปิด (2026-10-02) — เดิม "ปิด" ถูกเข้าใจว่า "ให้คนยืนยันรับ" แต่จริงๆ คือ
     **ของไม่เข้าคลังเลย** (เกิดจริง ~120 ใบหายเงียบทั้งกะ) · ปิดต้องถามยืนยันพร้อมบอกผลตรงๆ */
  const setRuleMode = async (r, modeKey) => {
    if (noPerm()) return;
    if (modeKey === inflowModeOf(r)) return;
    if (modeKey === 'off' && !window.confirm(
      `ปิดกฎ "${r.match_type === 'prefix' ? `MAT ขึ้นต้น ${r.match_value}` : r.match_value} → ${r.dest_line_name}"?\n\n`
      + '⚠️ ปิดแล้ว ใบผลิตที่ปิดต่อจากนี้จะ "ไม่เข้าคลังนี้เลย" และไม่มีคิวให้ใครกดรับ\n'
      + 'ถ้าต้องการให้คนนับของก่อนรับ ให้เลือก 🟡 ต้องยืนยันรับ แทน')) return;
    /* 🔴🔴 27/10 — ออกจากโหมด 🔧 ตอนยังมีใบล็อตค้างที่ไลน์ = **ของหายจากบัญชี**
       โหมด 🔧 ทำให้ trigger `fn_post_confirmed_output` ข้าม ⇒ ใบผลิตที่ปิดไปแล้วช่วงนั้นไม่มี
       `stock_receipts` รองรับเลย · ทางเข้าคลังทางเดียวคือปุ่มปิดล็อตบนบอร์ดสโตร์ ซึ่งพอสลับโหมด
       จะเลิกลงสต็อก (ด่าน A2) ⇒ ปิดใบแล้วของหายเงียบ · วัด 27/10: 7 ใบค้าง · บนใบ 13,200 ชิ้น
       🔴 นับไม่ได้ = **บล็อก** (fail-closed) — อ่านไม่ได้แล้วจะเขียนทับของจริง ห้ามเดา
       📄 docs/modules/store-board-workflow.md §ขั้นถัดไป (ลำดับบังคับ 3 ขั้น) */
    if (inflowModeOf(r) === 'lot' && modeKey !== 'lot' && r.match_type === 'mat') {
      const { count, error: eLot } = await supabaseDR.from('child_lot_requests')
        .select('id', { count: 'exact', head: true })
        .eq('child_mat_no', String(r.match_value ?? '').trim()).eq('status', 'producing');
      if (eLot) { toast.error(`เช็คใบล็อตค้างไม่ได้ (${eLot.message}) — ยังไม่สลับโหมด`); return; }
      if (count && !window.confirm(
        `${r.match_value} ยังมีใบล็อตค้างที่ไลน์ผลิต ${count} ใบ\n\n`
        + '⚠️ สลับโหมดตอนนี้ = ของบนใบพวกนั้น "ไม่เข้าคลังเลย"\n'
        + '(ปุ่มปิดล็อตจะเลิกลงสต็อก และใบผลิตเก่าก็ไม่มีใบ "รอรับเข้า" รองรับ)\n\n'
        + 'ให้สโตร์ปิดใบล็อตที่ค้างให้หมดก่อน แล้วค่อยสลับ — กด OK ถ้ารู้อยู่แล้วและจะไปลงยอดมือเอง')) return;
    }
    const { data, error } = await supabaseDR.from('stock_inflow_rules')
      .update({ ...inflowPatchFor(modeKey, r), updated_at: new Date().toISOString() }).eq('id', r.id).select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('บันทึกไม่สำเร็จ (0 แถว) — สิทธิ์ไม่พอหรือกฎถูกลบไปแล้ว'); load(); return; }
    toast.success(`${INFLOW_MODES[modeKey].label} · ${r.dest_line_name}`);
    load();
  };

  const deleteRule = async (r) => {
    if (noPerm()) return;
    if (!window.confirm(`ลบกฎ "${r.match_type === 'prefix' ? `MAT ขึ้นต้น ${r.match_value}` : r.match_value} → ${r.dest_line_name}"?`)) return;
    if (!checkWriteRows(await supabaseDR.from('stock_inflow_rules').delete().eq('id', r.id).select('id'), 'ลบกฎ')) return;
    toast.success('ลบกฎแล้ว');
    load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{tr('รับงานเข้า stock เมื่อปิดออเดอร์')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.7 }}>
          สแกนปิดออเดอร์ (confirm) แล้วของไปเข้าคลังปลายทางตามกฎ — FG (เบอร์ 1xxx) เข้า warehouse · พาร์ทลูก (เบอร์ 2xxx) เข้าสโตร์
          <br />{tr('แต่ละกฎเลือกได้:')} <b>{tr(INFLOW_MODES.auto.label)}</b> = {tr(INFLOW_MODES.auto.hint)} ·
          {' '}<b>{tr(INFLOW_MODES.confirm.label)}</b> = {tr(INFLOW_MODES.confirm.hint)} (แท็บ 📥 รอรับเข้า) ·
          {' '}<b style={{ color: 'var(--red)' }}>{tr(INFLOW_MODES.off.label)}</b> = {tr(INFLOW_MODES.off.hint)}
          <br /><b style={{ color: INFLOW_MODES.lot.color }}>{tr(INFLOW_MODES.lot.label)}</b> (เฉพาะกฎ MAT ตรงตัว) = {tr(INFLOW_MODES.lot.hint)}
          · ระบบตั้งให้เองเมื่อสโตร์เปิดล็อตพาร์ทใหม่ — พาร์ทที่เลิกใช้ล็อตแล้ว เปลี่ยนเป็น 🟡/🟢 ที่นี่
          <br />{tr('กฎแบบ')} <strong>{tr('MAT ตรงตัว')}</strong> {tr('ชนะแบบ')} <strong>{tr('ขึ้นต้นด้วย')}</strong> · รายการที่เข้าแล้วดูได้ที่แท็บ 📦 Stock (ผู้บันทึก = auto)
        </div>
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
       <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: 'var(--bg2)' }}>
            {['เงื่อนไข MAT No.', 'ปลายทาง (line_name)', 'วิธีรับเข้า', ''].map(h => (
              <th key={h} style={{ padding: '9px 14px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}>{tr(h)}</th>
            ))}
          </tr></thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{tr('ยังไม่มีกฎ — งานที่ปิดออเดอร์จะไม่ถูก post เข้า stock อัตโนมัติ')}</td></tr>
            )}
            {rules.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  {r.match_type === 'prefix'
                    ? <>{tr('ขึ้นต้นด้วย')} <span style={{ fontFamily: 'monospace', color: 'var(--blue)', fontSize: 14 }}>{r.match_value}</span></>
                    : <span style={{ fontFamily: 'monospace', color: 'var(--blue)', fontSize: 14 }}>{r.match_value}</span>}
                </td>
                <td style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, color: 'var(--amber)' }}>
                  {/* 🔧 โหมดปิดล็อต: ยอดลงที่ไลน์ผลิตของล็อต — คลังในแถวไม่ถูกใช้ ห้ามโชว์เหมือนเป็นปลายทางจริง */}
                  {inflowModeOf(r) === 'lot'
                    ? <span style={{ color: INFLOW_MODES.lot.color, fontSize: 12 }}>{tr('ไลน์ผลิตของล็อต (ตอนปิดล็อต)')}</span>
                    : <>📍 {r.dest_line_name}</>}
                </td>
                <td style={{ padding: '8px 14px' }}>
                  {canEdit
                    ? <Segmented value={inflowModeOf(r)} onChange={v => setRuleMode(r, v)} label={tr('วิธีรับเข้า')}
                        options={inflowModesFor(r).map(m => ({ value: m.key, label: m.label }))} />
                    : <span style={{ fontSize: 12, fontWeight: 800, color: INFLOW_MODES[inflowModeOf(r)].color }}>{tr(INFLOW_MODES[inflowModeOf(r)].label)}</span>}
                </td>
                <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                  {canEdit && (
                    <button onClick={() => deleteRule(r)}
                      style={{ padding: '4px 10px', borderRadius: 'var(--r-md)', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid var(--red-line)', fontFamily: 'var(--font-body)' }}>
                      {tr('ลบ')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
       </div>
      </div>

      {canEdit && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>{tr('➕ เพิ่ม/แก้กฎ')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{tr('ชนิดเงื่อนไข')}</span>
              <select value={form.match_type} onChange={e => setForm(f => ({ ...f, match_type: e.target.value }))} style={{ ...inputSt, width: 150 }}>
                <option value="prefix">{tr('MAT ขึ้นต้นด้วย…')}</option>
                <option value="mat">{tr('MAT ตรงตัว')}</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{form.match_type === 'prefix' ? tr('เลขขึ้นต้น (เช่น 1, 2)') : 'MAT No.'}</span>
              {/* prefix = ข้อความอิสระโดยชอบ · MAT ตรงตัว = เลือกจาก Product Master (2026-09-07) */}
              {form.match_type === 'prefix'
                ? <input value={form.match_value} onChange={e => setForm(f => ({ ...f, match_value: e.target.value }))}
                    placeholder="1" style={{ ...inputSt, width: 130, fontFamily: 'monospace' }} />
                : <ProductSelect products={products} value={form.match_value} style={{ width: 260 }} history={ruleMatHist}
                    onChange={({ mat_no }) => setForm(f => ({ ...f, match_value: mat_no }))} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{tr('ปลายทาง (ไลน์ / คลัง)')}</span>
              {/* dest_line_name ถูก copy เป็น line_stock_transactions.line_name โดย trigger = join key ของ line_stock_summary
                  พิมพ์ผิด = "ไลน์ผี" ที่มีของแต่ไม่มีใครเห็น → เลือกจากทะเบียนไลน์ + คลังกลางเท่านั้น (2026-09-07 · บั๊กคลาสเดียวกับรอบจัดส่ง) */}
              <LineSelect lines={lines} value={form.dest_line_name} onChange={v => setForm(f => ({ ...f, dest_line_name: v }))} {...scope}
                placeholder={tr('— เลือกปลายทาง —')} style={{ ...inputSt, width: 240 }}
                extraGroups={[{ label: 'คลัง', options: [...new Set([...WAREHOUSE_LOCATIONS, ...dests.filter(d => !lines.some(l => l.name === d))])].sort().map(n => ({ value: n })) }]} />
            </div>
            <button onClick={addRule} disabled={saving} style={{ ...btn('var(--accent)', 'var(--accent-ink)'), opacity: saving ? 0.6 : 1 }}>
              {saving ? '...' : tr('บันทึก')}
            </button>
          </div>
        </div>
      )}
      {!canEdit && (
        <div style={{ ...card, borderColor: 'var(--amber-line)', fontSize: 12, color: 'var(--amber)' }}>
          โหมดดูอย่างเดียว — แก้กฎได้เฉพาะผู้มีสิทธิ์จัดการรอบจัดส่ง (ตั้งได้ที่หน้า จัดการสิทธิ์)
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN EXPORT
   ───────────────────────────────────────────────────────────────────────────── */
/* 🏬🛒 04/11 (คำสั่ง user) — งานที่ขยับยอดของสโตร์ย้ายมาที่นี่ · /heijunka เหลือดูสัญญาณ Kanban อย่างเดียว
   ฝังหน้าเดิมทั้งดุ้นแบบ /equipment (โหมด ops) — กฎ/ปุ่ม/ด่านเดิมทุกตัว ไม่เขียนใหม่ · `?view=`/`?store=` ไม่ชน `?tab=` */
const HeijunkaKanban = lazy(() => import('./HeijunkaKanban'));
const LEGACY_TABS = { store: 'out', purchase: 'in', receipts: 'in' };
const TABS = [
  /* 05/11 (คำสั่ง user) — แยกตามทิศของ: ขาออก = สโตร์ → พื้นที่ผลิต · ขาเข้า = supplier/พื้นที่ผลิต → สโตร์ */
  { key:'out',       label: 'ขาออก (สโตร์ → ผลิต)' },
  { key:'in',        label: 'ขาเข้า (→ สโตร์)' },
  { key:'sap',       label: 'ค้างตัด SAP' },    // ใบที่ส่งถึงไลน์แล้วแต่ตัดจ่ายใน SAP ไม่ได้ (04/11)
  { key:'diff',      label: 'คลังพัก/ผลต่าง' },  // รับไม่ครบ = ส่วนที่ขาดพักไว้ รอผลิต+สโตร์ยืนยันคู่ (05/11)
  { key:'stock',     label: 'Stock' },
  { key:'count',     label: 'ตรวจนับ/เฟิร์มยอด' },   // กระทบยอดขาออกที่หลุด + ตรวจนับทั้งคลัง (2026-09-23)
  { key:'wip',       label: 'WIP ค้างระหว่างขั้น' },   // ยอดค้าง — คนละเรื่องกับ 'คิวเติม WIP' ในบอร์ดคัมบัง
  /* 📍 20/10 — ลูป "ผลิตเรียก → สโตร์เห็น" ตายที่ขั้น "ถึง min แล้วเสนอให้เบิก" เพราะไม่มีใครตั้งจุดเรียกเติม
     เดิมเห็นทีละไลน์ (แผงใน /layout-setup) ⇒ ไม่มีจอไหนตอบว่าทั้งโรงงานขาดกี่จุด */
  { key:'levels',    label: 'จุดเรียกเติม (ทั้งโรงงาน)' },
  /* 🔴 13/10 feedback: ชื่อแท็บเดิมเขียนแต่ "โซนคลัง (ผัง)" = ชื่อของแผงล่าง
     แต่คนมาหา "พื้นที่ SAP / รหัสคลัง" ซึ่งเป็นแผงบนของแท็บนี้ แล้วหาไม่เจอ (user: "ยังหาไม่เจอ")
     ⇒ ชื่อแท็บต้องบอกของที่อยู่ข้างในทั้ง 2 ชั้น */
  { key:'zones',     label: 'พื้นที่ SAP / โซนคลัง' },
  { key:'delivery',  label: 'รอบจัดส่ง' },
  { key:'timeboard', label: 'บอร์ดเวลา (ดูอย่างเดียว)' },   // กดยืนยันส่ง/รับที่บอร์ดคัมบัง
  { key:'inflow',    label: 'กฎรับเข้า' },
];
/* 🗂 13/11: 12 แท็บ → 6 ช่องบน (กฎ ≤7 · UI §6.8 ข้อ 6) — คีย์ลูก = ?tab= เดิม (TABS/LEGACY_TABS ไม่เปลี่ยน)
   ขาออก/ขาเข้า/Stock = งานรายวัน อยู่หน้าสุด · ติดตาม/กระทบยอด = ของที่ค้างหลังส่ง · ตั้งค่าคลัง = ทะเบียน/กฎ */
const lsTab = (k) => TABS.find(t => t.key === k);
const LS_TAB_GROUPS = [
  lsTab('out'), lsTab('in'), lsTab('stock'),
  { key: 'recon', label: '📋 ติดตาม / กระทบยอด', children: ['sap', 'diff', 'count', 'wip'].map(lsTab) },
  { key: 'setup', label: '⚙️ ตั้งค่าคลัง',        children: ['levels', 'zones', 'delivery', 'inflow'].map(lsTab) },
  lsTab('timeboard'),
];

export default function LineStock() {
  const { role, fullName, lineId, sections } = useContext(UserContext);
  const canEdit = can('line_stock', 'manage_rounds', role);
  const [activeTab, setActiveTab] = useTabParam(TABS.map(t => t.key), 'stock');
  /* ลิงก์เก่าก่อน 05/11 (`?tab=store|purchase|receipts`) → แท็บใหม่ · ใช้ได้เพราะ useTabParam ตกกลับ default ก่อน */
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (LEGACY_TABS[t]) setActiveTab(LEGACY_TABS[t]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ทำครั้งเดียวตอนเปิดหน้า
  }, []);
  // scope มาตรฐานส่งต่อให้ทุกแท็บ — dropdown ไลน์ต้องกรองด้วย ไม่ใช่แค่ query (CLAUDE.md)
  const scope = useMemo(() => ({ role, lineId, sections }), [role, lineId, sections]);

  return (
    <Page>
      <PageHeader
        title={tr('Stock Management')} icon="📦"
        sub={tr('ยอดคงเหลือ mini-store ของไลน์ · รอบจัดส่งภายใน · กฎรับเข้าอัตโนมัติเมื่อปิดใบผลิต')}
        tabs={LS_TAB_GROUPS} tab={activeTab} onTab={setActiveTab}
      />

      {(activeTab === 'out' || activeTab === 'in') && (
        <Hub>
          <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{tr('กำลังโหลด…')}</div>}>
            {/* key แยก = state ตู้ของ 2 แท็บไม่ปนกัน */}
            <HeijunkaKanban key={activeTab} mode="ops" direction={activeTab}
              opsStores={activeTab === 'out' ? OPS_STORES_OUT : OPS_STORES_IN} />
          </Suspense>
        </Hub>
      )}
      {activeTab === 'sap'       && <SapPendingReport />}
      {activeTab === 'diff'      && <StockDiscrepancyReport />}
      {activeTab === 'stock'     && <StockTab role={role} scope={scope} />}
      {activeTab === 'count'     && <StockCountSheet role={role} scope={scope} />}
      {activeTab === 'wip'       && <WipBetweenSteps />}
      {activeTab === 'levels'    && <PartLevelCoveragePanel />}
      {/* 🏬 2 ทะเบียนคนละชั้น: รหัสคลัง (SAP SLoc — อ้างใน BOM) เหนือ โซนกองของบนผัง · ห้ามยุบรวม */}
      {activeTab === 'zones'     && <><StorageLocPanel /><StorageZonePanel /></>}
      {activeTab === 'delivery'  && <DeliveryRoundsTab canEdit={canEdit} fullName={fullName} scope={scope} />}
      {activeTab === 'timeboard' && <DeliveryTimeBoardTab />}
      {activeTab === 'inflow'    && <InflowRulesTab canEdit={canEdit} />}
    </Page>
  );
}
