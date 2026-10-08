import { useState, useEffect, useCallback, useMemo, useRef, useContext, lazy, Suspense } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can, canSeeded } from '../utils/permissions';
import { checkWrite } from '../utils/dbWrite';
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';
import { useLiveBoard } from '../utils/useLiveBoard';
import { getWorkDate } from '../utils/workDate';
import { toast } from '../components/Toast';
import Page, { Hub } from '../components/Page';
import PageHeader from '../components/PageHeader';
import FilterBar from '../components/FilterBar';
import useTabParam from '../utils/useTabParam';
import MonitorBoardGrid from '../components/MonitorBoardGrid';
import { BOARD_TABS, boardPeriods, rowDefs } from '../utils/monitorBoards';
import {
  sumByMatDate, firstByMat, makeSystemLookup, OUT_TXN_TYPES, IN_ORDER_STATUS, orderInQty,
  DEMAND_SKIP_STATUS,
} from '../utils/monitorSystem';
import { buildPnIndex, pickStockMat } from '../utils/matResolve';
import { openOnly } from '../utils/shipStatus';

/* 🔴 จุดอัพโหลดไฟล์ Monitoring มี **จุดเดียวทั้งระบบ** (08/10 คำสั่ง user) — ตัวเดียวกับที่
   `/planner-sales?tab=monitoring` ใช้ · กดที่ไหนก็ลงครบทุกชั้นในครั้งเดียว ห้ามแยกกลับเป็น 2 ตัว */
const MonitoringUpload = lazy(() => import('../components/MonitoringUpload'));
const MonitorFgSync = lazy(() => import('../components/MonitorFgSync'));
/* 📉 "คาดการณ์ของจะขาด" ของเดิม — embed ทั้งดุ้น ไม่แก้ของเดิม (pattern เดียวกับ /equipment · PmHub)
   เหตุผลที่**ยุบตารางเข้าด้วยกันตรงๆ ไม่ได้** เขียนไว้ที่ docs/modules/monitoring-boards.md §6.6 */
const RundownStock = lazy(() => import('./RundownStock'));

/* ══ 📉 /monitoring — บอร์ดติดตามแผน-สต๊อก (ยกไฟล์ Excel ของทีมวางแผนเข้าระบบ) ═══════════
   user 01/10: *"ตอนนี้ทีมวางแผนจะต้องทำข้อมูลนี้ใน excel เค้าอยากทำในระบบเรา ทำได้มั้ย"*
              → *"เอาทุกชีททุกหน้าเลย ให้โปรแกรมทำได้แบบนั้น"*

   13 ชีทในไฟล์ `1.Monitoring-<เดือน>.xlsx` = **11 บอร์ด + 2 ชีทที่ตั้งใจไม่ยก**
   (Vlookup Argen = ตารางค้นหาที่ป้อนบอร์ด Argen · Sheet1 (2) = กระดาษทด)
   ⇒ หน้านี้ไม่มีโค้ดเฉพาะชีท — ชุดแถว/หน่วยคอลัมน์มาจาก `monitor_boards` ใน DB ทั้งหมด

   🔴 สิ่งที่หน้านี้ทำให้ต่างจาก Excel (เหตุผลที่ย้ายมาคุ้ม):
     4 ใน 6 แถวที่เคยพิมพ์มือ ระบบเติมให้เอง — IN จากใบผลิตที่คอนเฟิร์ม · OUT จากการจ่ายของ
     ออกจากไลน์ · MIN จากทะเบียน min/max ต่อไลน์ · BALANCE คำนวณ ⇒ เหลือพิมพ์จริงแค่ PLAN

   ⚠️ แต่ **ค่าที่คนกรอกชนะค่าที่ระบบดึงเสมอ** (buildGrid) — หน้างานเห็นของที่ระบบยังไม่รู้
   ⚠️ **ไม่ใช่ทุกพาร์ทที่ระบบรู้** — วัดจริง 01/10: 106 พาร์ทในไฟล์ มีประวัติผลิตแค่ 26 ตัว
      ⇒ ช่องที่ระบบไม่รู้ต้องขึ้นขีด "–" ให้คนกรอกเอง **ห้ามโชว์ 0** (จะดูเหมือนไลน์ไม่เดิน)

   📄 docs/modules/monitoring-boards.md
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14 };
const FS = 12;

export default function Monitoring() {
  const { role, fullName } = useContext(UserContext);
  const [tab, setTab] = useTabParam(BOARD_TABS.map(t => t.key), BOARD_TABS[0].key);
  /* แท็บซ้อนแท็บต้องคนละ query param (UI §6.8 ข้อ 2.4) — หน้าลูกของแท็บ FG ใช้ `?fgv=` */
  const [fgView, setFgView] = useTabParam(['rundown', 'board'], 'rundown', 'fgv');

  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState('');
  const [parts, setParts] = useState([]);
  const [cells, setCells] = useState([]);
  const [sysIn, setSysIn] = useState(() => new Map());
  const [sysOrder, setSysOrder] = useState(() => new Map());   // บอร์ด FG: ยอดลูกค้าสั่งจาก EDI 862/830
  const [sysSeedBal, setSysSeedBal] = useState(() => new Map()); // บอร์ด FG: ของพร้อมส่งในคลัง FG (ยอดยกมา)
  const [fgNote, setFgNote] = useState('');                      // สิ่งที่บอร์ด FG ตอบไม่ได้ — ต้องเขียนบนจอ
  const [sysOut, setSysOut] = useState(() => new Map());
  const [sysMin, setSysMin] = useState(() => new Map());
  const [registry, setRegistry] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [warn, setWarn] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showFgSync, setShowFgSync] = useState(false);

  const canEdit = canSeeded('monitoring', 'manage', role);
  /* ชั้น FC/ออเดอร์/สต็อก ของไฟล์เดียวกันใช้สิทธิ์เดิมของจออัพโหลด (demand:upload) —
     ไม่มีสิทธิ์ = จอบอกว่าข้ามส่วนนั้น ไม่ใช่เขียนเงียบ */
  const canUpload = can('demand', 'upload', role);
  const today = getWorkDate();

  /* ── ทะเบียนบอร์ด ─────────────────────────────────────────────────────────────── */
  const loadBoards = useCallback(async () => {
    const { data, error } = await supabaseDR
      .from('monitor_boards')
      .select('id, board_key, name, kind, line_name, customer, period_kind, period_count, start_date, rows, sl_row, sl_includes_seed, sort_order, note')
      .eq('is_active', true)
      .order('kind').order('sort_order', { nullsFirst: false }).order('name');
    if (error) { setWarn(`โหลดทะเบียนบอร์ดไม่สำเร็จ: ${error.message}`); return; }
    setBoards(data || []);
  }, []);

  useEffect(() => { loadBoards(); }, [loadBoards]);

  const tabBoards = useMemo(() => boards.filter(b => b.kind === tab), [boards, tab]);
  const board = useMemo(
    () => tabBoards.find(b => b.id === boardId) || tabBoards[0] || null,
    [tabBoards, boardId],
  );
  /* สลับแท็บแล้วบอร์ดที่เลือกไว้ไม่ได้อยู่ในแท็บนี้ → ตกกลับตัวแรก (ห้ามจอว่าง) */
  useEffect(() => { if (board && board.id !== boardId) setBoardId(board.id); }, [board, boardId]);

  /* ── เนื้อบอร์ด ───────────────────────────────────────────────────────────────── */
  const bId = board?.id || '';
  const bKind = board?.kind || '';
  const bLine = board?.line_name || '';
  /* 📦 บอร์ด FG ผูก "ลูกค้า" ไม่ใช่ "ไลน์" — ยอดลูกค้าสั่งมาจาก EDI 862/830 ที่นำเข้าทุกวัน
     🔴 IN ของบอร์ด FG **ห้ามกรองไลน์** (FG ตัวเดียวผลิตได้หลายไลน์ กรองไลน์ = ยอดหายเงียบ) */
  const bCust = board?.customer || '';
  const isFg = board?.kind === 'fg';
  /* 🔴 deps เป็น primitive ล้วน — ส่ง object/array เข้า deps = พ่อ setState ใบใหม่เนื้อเดิม
     แล้วลูกยิงคิวรีซ้ำฟรีๆ (กฎเหล็กการเขียน DB ข้อ 9) */
  /* 🔴 guard กัน stale-response (กฎเหล็กการเขียน DB ข้อ 4) — สลับบอร์ดเร็วๆ แล้วคำตอบของ
     บอร์ดเก่ากลับมาทีหลัง ห้ามทับจอที่กำลังดูอยู่ (เคยเกิดจริงที่ Daily Report = ลงข้อมูลผิดกะ)
     ⚠️ ใช้ ref ไม่ใช่ `let alive` ในตัว callback — useLiveBoard เรียก load() เฉยๆ ไม่ได้เก็บ
        ค่าที่ return ไปทำ cleanup ⇒ ธงที่ประกาศในตัวฟังก์ชันจะไม่มีวันถูกปิด */
  const curBoardRef = useRef('');
  useEffect(() => { curBoardRef.current = bId; }, [bId]);

  const load = useCallback(async () => {
    if (!bId) { setParts([]); setCells([]); setLoading(false); return; }
    setLoading(true);
    const myId = bId;
    const mine = () => curBoardRef.current === myId;

    const pr = await fetchAllPages(
      () => supabaseDR.from('monitor_board_parts')
        .select('id, mat_no, part_no, part_name, model, raw_mat, process, rack, lot_qty, packing, cost, ct_sec, fc, pieces_per_shot, kg_per_piece, spec, semi_part, sort_order, note')
        .eq('board_id', myId).eq('is_active', true),
      { orderBy: ['sort_order', 'id'] },
    );
    if (!mine()) return;
    if (pr.error) { setWarn(`โหลดพาร์ทไม่สำเร็จ: ${pr.error}`); setLoading(false); return; }
    const partRows = pr.rows || [];

    /* 🔴 `.in(ids)` ยาวเกินเพดาน proxy = คืนค่าว่าง**เงียบ** (ข้อ 5) ⇒ ต้องผ่าน fetchByIds ที่แบ่งก้อนให้
       บอร์ดจริงมีได้ถึง 31 พาร์ท × 7 แถว × 34 วัน — ช่องที่กรอกจริงหลักพัน ต้องแบ่งหน้าด้วย */
    const cr = partRows.length
      ? await fetchByIds(
        partRows.map(p => p.id),
        (ids) => supabaseDR.from('monitor_cells')
          .select('board_part_id, row_key, period_key, qty, txt').in('board_part_id', ids),
        { orderBy: 'board_part_id' },
      )
      : { rows: [], errors: [], truncated: false };
    if (!mine()) return;

    setTruncated(!!cr.truncated || !!pr.truncated);
    setParts(partRows);
    setCells(cr.rows || []);
    setWarn(
      pr.truncated ? 'พาร์ทบนบอร์ดนี้มีมากกว่าที่ดึงมาได้ — รายการด้านล่างไม่ครบ'
        : (cr.errors && cr.errors.length) ? `โหลดช่องที่กรอกไว้ไม่ครบ: ${cr.errors[0]}` : '',
    );
    setLoading(false);
  }, [bId]);

  useLiveBoard(load, { tables: ['monitor_cells', 'monitor_board_parts'], topic: `monitor-${bId || 'none'}` });

  /* ── ข้อมูลที่ระบบรู้เอง (IN / OUT / MIN) — เฉพาะบอร์ดที่ผูกไลน์ไว้ ─────────────── */
  const periods = useMemo(() => {
    if (!board) return [];
    if (board.period_kind !== 'date') return boardPeriods(board);
    /* บอร์ดรายวันส่ง: คอลัมน์มาจากวันที่ที่มีออเดอร์จริงในช่องที่กรอกไว้ */
    const ds = cells.filter(c => c.row_key === 'order').map(c => String(c.period_key).slice(0, 10));
    return boardPeriods(board, { dates: ds });
  }, [board, cells]);

  const dFrom = periods[0]?.date || '';
  const dTo = periods[periods.length - 1]?.date || '';
  const matsKey = useMemo(() => parts.map(p => p.mat_no).filter(Boolean).sort().join(','), [parts]);

  const curSysRef = useRef('');
  const loadSystem = useCallback(async () => {
    const scope = isFg ? bCust : bLine;
    if (!scope || !dFrom || !dTo || !matsKey) {
      setSysIn(new Map()); setSysOut(new Map()); setSysMin(new Map()); setSysOrder(new Map()); return;
    }
    const mats = matsKey.split(',');
    const myKey = `${isFg ? 'fg' : 'line'}|${scope}|${dFrom}|${dTo}|${matsKey}`;
    const mine = () => curSysRef.current === myKey;
    curSysRef.current = myKey;

    /* ── บอร์ด FG: ยอดลูกค้าสั่ง (862/830) + ผลิตเข้า (ทุกไลน์) ───────────────────── */
    if (isFg) {
      const [demR, lateR, inR, prodR2, stkR, ruleR, kbR] = await Promise.all([
        fetchAllPages(() => supabaseDR.from('customer_shipping_orders')
          .select('mat_no, qty, due_date, status')
          .eq('customer', bCust).in('mat_no', mats)
          .gte('due_date', dFrom).lte('due_date', dTo), { orderBy: ['mat_no'] }),
        /* 🔴 ใบที่เลยวันส่งแล้วยังไม่ปิด = หนี้ที่ยังค้างจริง ต้องรวมเข้าคอลัมน์แรก
           ไม่รวม = Balance สูงกว่าจริง แล้วจอบอกว่า "ของพอ" ทั้งที่ค้างส่งอยู่
           (กฎเดียวกับ /rundown-stock — ที่นั่นเรียกว่า `overdue`) */
        fetchAllPages(() => openOnly(supabaseDR.from('customer_shipping_orders')
          .select('mat_no, qty, due_date, status')
          .eq('customer', bCust).in('mat_no', mats)
          .lt('due_date', dFrom)), { orderBy: ['mat_no'] }),
        fetchAllPages(() => supabaseDR.from('prod_orders')
          .select('mat_no, qty_ok, qty_actual, production_sessions!inner(work_date)')
          .in('status', IN_ORDER_STATUS).in('mat_no', mats)
          .gte('production_sessions.work_date', dFrom)
          .lte('production_sessions.work_date', dTo), { orderBy: ['mat_no'] }),
        fetchAllPages(() => supabaseDR.from('dr_products')
          .select('mat_no, p_no, is_operation').eq('is_active', true), { orderBy: ['mat_no'] }),
        /* ของพร้อมส่ง = **คลัง FG เท่านั้น** — รวมทุกคลัง = นับของที่ยังส่งลูกค้าไม่ได้ */
        fetchAllPages(() => supabaseDR.from('line_stock_summary')
          .select('line_name, mat_no, qty_on_hand'), { orderBy: ['mat_no', 'line_name'] }),
        supabaseDR.from('stock_inflow_rules')
          .select('match_type, match_value, dest_line_name').eq('is_active', true),
        fetchAllPages(() => supabaseDR.from('kanban_standards')
          .select('mat_no, p_no').eq('is_active', true), { orderBy: ['mat_no'] }),
      ]);
      if (!mine()) return;

      /* ยอดลูกค้าสั่งตามวันส่ง + หนี้ค้างส่งยัดเข้าคอลัมน์แรก */
      const dem = sumByMatDate(demR.rows || [], {
        date: 'due_date',
        keep: (r) => !DEMAND_SKIP_STATUS.includes(String(r?.status || '')),
      });
      for (const r of lateR.rows || []) {
        const mt = String(r?.mat_no ?? '').trim();
        const q = Number(r?.qty);
        if (!mt || !Number.isFinite(q)) continue;
        const k = `${mt}|${dFrom}`;
        dem.set(k, (dem.get(k) || 0) + q);
      }
      setSysOrder(dem);

      setSysIn(sumByMatDate(
        (inR.rows || []).map(x => ({ mat_no: x.mat_no, work_date: x.production_sessions?.work_date, qty: orderInQty(x) })),
      ));

      /* ── ยอดยกมา = ของพร้อมส่งในคลัง FG ───────────────────────────────────────
         🔴 ออเดอร์อ้าง "เลขลูกค้า" แต่คลังเก็บ "เลข SAP" ⇒ ต้อง resolve ก่อน
            เทียบตรงๆ = ได้ "ไม่มีของ" ทั้งที่ของเต็มคลังอยู่ใต้เลข SAP */
      const fgDest = (ruleR.data || []).find(r => r.match_type === 'prefix' && r.match_value === '1')?.dest_line_name || null;
      const onHand = new Map();
      for (const r of stkR.rows || []) {
        if (fgDest && r.line_name !== fgDest) continue;
        const mt = String(r.mat_no || '').trim();
        if (!mt) continue;
        onHand.set(mt, (onHand.get(mt) || 0) + (parseFloat(r.qty_on_hand) || 0));
      }
      const pnIdx = buildPnIndex([...(prodR2.rows || []), ...(kbR.rows || [])]);
      const hasStock = (m) => onHand.has(m);
      const seedBal = new Map();
      let unresolved = 0;
      for (const mt of mats) {
        const res = pickStockMat(mt, pnIdx, hasStock);
        /* 🔴 resolve ไม่ได้ = **ไม่รู้ว่ามีของเท่าไหร่** ⇒ ไม่ใส่ค่า ปล่อยให้ทั้งแถวขึ้นขีด
           ห้ามใส่ 0 (0 แปลว่า "รู้ว่าไม่มีของ" ซึ่งคนละเรื่องกับ "ยังเช็คไม่ได้") */
        if (!res.mat) { unresolved++; continue; }
        seedBal.set(mt, onHand.get(res.mat) ?? 0);
      }
      setSysSeedBal(seedBal);
      setFgNote([
        fgDest ? `ของพร้อมส่งนับจากคลัง ${fgDest}` : '⚠️ ยังไม่ได้ตั้งกฎรับเข้าของ FG ⇒ นับสต๊อกทุกคลังรวมกัน (สูงกว่าจริง)',
        unresolved ? `⚠️ ${unresolved} พาร์ทยังจับคู่เลข MAT SAP ไม่ได้ ⇒ ไม่รู้ยอดยกมา (ขึ้นขีดทั้งแถว)` : '',
      ].filter(Boolean).join(' · '));

      /* ไม่มีไลน์ ⇒ ไม่รู้ MIN/OUT ของบอร์ดนี้ — ปล่อยว่างให้จอขึ้นขีด ห้ามเดา 0 */
      setSysOut(new Map()); setSysMin(new Map());
      setRegistry(new Set((prodR2.rows || []).map(r => String(r.mat_no || '').trim())));
      return;
    }

    const [ordR, txnR, lvlR, prodR] = await Promise.all([
      fetchAllPages(() => supabaseDR.from('prod_orders')
        .select('mat_no, qty_ok, qty_actual, production_sessions!inner(work_date, line_name)')
        .in('status', IN_ORDER_STATUS)
        .in('mat_no', mats)
        .gte('production_sessions.work_date', dFrom)
        .lte('production_sessions.work_date', dTo)
        .eq('production_sessions.line_name', bLine), { orderBy: ['mat_no'] }),
      fetchAllPages(() => supabaseDR.from('line_stock_transactions')
        .select('mat_no, qty, type, work_date')
        .eq('line_name', bLine).in('type', OUT_TXN_TYPES).in('mat_no', mats)
        .gte('work_date', dFrom).lte('work_date', dTo), { orderBy: ['mat_no'] }),
      fetchAllPages(() => supabaseDR.from('line_part_levels')
        .select('mat_no, min_qty').eq('line_name', bLine).eq('is_active', true).in('mat_no', mats),
        { orderBy: ['mat_no'] }),
      fetchAllPages(() => supabaseDR.from('dr_products').select('mat_no').in('mat_no', mats), { orderBy: ['mat_no'] }),
    ]);
    if (!mine()) return;
    setSysIn(sumByMatDate(
      (ordR.rows || []).map(o => ({ mat_no: o.mat_no, work_date: o.production_sessions?.work_date, qty: orderInQty(o) })),
    ));
    setSysOut(sumByMatDate(txnR.rows || []));
    setSysMin(firstByMat(lvlR.rows || []));
    setSysOrder(new Map()); setSysSeedBal(new Map()); setFgNote('');
    setRegistry(new Set((prodR.rows || []).map(r => String(r.mat_no || '').trim())));
  }, [isFg, bCust, bLine, dFrom, dTo, matsKey]);

  useEffect(() => { loadSystem(); }, [loadSystem]);

  /* ── ตัวอ่านค่าให้กริด ────────────────────────────────────────────────────────── */
  const manualMap = useMemo(() => {
    const m = new Map();
    for (const c of cells) {
      const v = c.txt !== null && c.txt !== undefined && c.txt !== '' ? c.txt : c.qty;
      m.set(`${c.board_part_id}|${c.row_key}|${String(c.period_key).slice(0, 10)}`, v);
    }
    return (pid, rk, pk) => m.get(`${pid}|${rk}|${pk}`);
  }, [cells]);

  const partMat = useMemo(() => new Map(parts.map(p => [p.id, String(p.mat_no || '').trim()])), [parts]);
  const systemMap = useMemo(
    () => makeSystemLookup({
      partMat, inIdx: sysIn, outIdx: sysOut, orderIdx: sysOrder, minByMat: sysMin,
      seedBalance: sysSeedBal, seedKey: periods[0]?.key,
    }),
    [partMat, sysIn, sysOut, sysOrder, sysMin, sysSeedBal, periods],
  );

  const partsWithFlag = useMemo(
    () => parts.map(p => ({ ...p, in_registry: !p.mat_no || registry.has(String(p.mat_no).trim()) })),
    [parts, registry],
  );

  /* ── บันทึกช่อง ───────────────────────────────────────────────────────────────── */
  const onEditCell = useCallback(async ({ partId, rowKey, periodKey, value }) => {
    if (!canEdit) return;
    const def = rowDefs(board).find(r => r.key === rowKey);
    const isText = def?.kind === 'date';
    const raw = String(value ?? '').trim();

    /* ลบค่าทิ้ง = ลบแถว ไม่ใช่เขียน 0 — "ว่าง" กับ "ศูนย์" ต้องแยกกันได้ตลอด */
    if (raw === '') {
      const r = await supabaseDR.from('monitor_cells').delete()
        .eq('board_part_id', partId).eq('row_key', rowKey).eq('period_key', periodKey).select('id');
      if (!checkWrite(r, 'ล้างค่าในช่อง')) return;
      setCells(cs => cs.filter(c => !(c.board_part_id === partId && c.row_key === rowKey
        && String(c.period_key).slice(0, 10) === periodKey)));
      return;
    }
    let qty = null;
    if (!isText) {
      const n = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(n)) { toast.error(`"${raw}" ไม่ใช่ตัวเลข`); return; }
      qty = n;
    }
    const row = {
      board_part_id: partId, row_key: rowKey, period_key: periodKey,
      qty: isText ? null : qty, txt: isText ? raw : null, updated_by_name: fullName || null,
    };
    const r = await supabaseDR.from('monitor_cells')
      .upsert(row, { onConflict: 'board_part_id,row_key,period_key' }).select('id');
    if (!checkWrite(r, 'บันทึกช่อง')) return;
    /* 🔴 RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" ⇒ ต้องนับแถวที่เขียนได้จริง (กฎข้อ 2) */
    if (!r.data || r.data.length === 0) { toast.error('บันทึกไม่ได้ — ไม่มีสิทธิ์เขียนบอร์ดนี้'); return; }
    setCells(cs => {
      const k = (c) => `${c.board_part_id}|${c.row_key}|${String(c.period_key).slice(0, 10)}`;
      const nk = `${partId}|${rowKey}|${periodKey}`;
      const next = cs.filter(c => k(c) !== nk);
      next.push({ board_part_id: partId, row_key: rowKey, period_key: periodKey, qty: row.qty, txt: row.txt });
      return next;
    });
  }, [canEdit, board, fullName]);

  const tabs = BOARD_TABS.map(t => ({
    key: t.key,
    label: `${t.label}${boards.filter(b => b.kind === t.key).length ? ` (${boards.filter(b => b.kind === t.key).length})` : ''}`,
  }));

  return (
    <Page>
      <PageHeader
        title="Monitoring ติดตามแผน-สต๊อก" icon="📉"
        sub="บอร์ดแทนไฟล์ Excel ของทีมวางแผน — PLAN กรอกเอง · ของเข้า/ออก/ขั้นต่ำ ระบบเติมให้"
        tabs={tabs} tab={tab} onTab={setTab}
        actions={canEdit ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* 📦 บอร์ด FG ไม่ได้มาจากไฟล์ Excel — ปุ่มจึงแยกจาก "นำเข้าจากไฟล์" ตั้งแต่หัวเพจ
                (ปุ่มเดียวกันแล้วเดาจากแท็บ = คนกดผิดแล้วงงว่าทำไมไม่ขอไฟล์) */}
            <button type="button" onClick={() => setShowFgSync(true)}
              title="สร้าง/อัพเดทบอร์ด FG ต่อลูกค้า จากออเดอร์ EDI 862/830 ที่นำเข้าไว้แล้ว"
              style={{ fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' }}>
              📦 สร้างบอร์ด FG จากออเดอร์
            </button>
            <button type="button" onClick={() => setShowImport(true)}
              style={{ fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' }}>
              📗 นำเข้าจากไฟล์ Excel
            </button>
          </div>
        ) : null}
        filters={(tab !== 'fg' || fgView === 'board') && tabBoards.length ? (
          <FilterBar>
            {/* 🔴 ชื่อไลน์จริงยาวมาก ("LINE APRON ASSY (HYDROFORM) ชุดที่ 1") ⇒ บนมือถือ 390px
                <select> ที่ไม่มี minWidth:0 จะดันกล่องจนล้นออกนอกจอแล้วปัดไม่ได้
                (mobilesweep จับได้ 02/10) · label ต้อง minWidth:0 และ select ต้อง maxWidth:100% */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: FS + 1, minWidth: 0, flex: '0 1 380px', maxWidth: 380 }}>
              <span style={{ flexShrink: 0 }}>บอร์ด</span>
              <select value={board?.id || ''} onChange={e => setBoardId(e.target.value)}
                style={{ minWidth: 0, maxWidth: '100%', flex: 1 }}>
                {tabBoards.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.line_name ? ` — ${b.line_name}` : ''}{b.customer ? ` — ${b.customer}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <span style={{ fontSize: FS, color: 'var(--muted)', flex: '1 1 100%', minWidth: 0 }}>
              {/* 🔴 บอร์ด FG ไม่ผูกไลน์ แต่**ไม่ใช่** "ต้องกรอกเองทุกช่อง" — ยอดลูกค้าสั่งมาจาก
                  EDI 862/830 · ผลิตเข้าจากใบผลิตทุกไลน์ ⇒ ต้องแยกข้อความ ไม่งั้นจอโกหก (06/10) */}
              {isFg
                ? (bCust
                  ? `ผูกลูกค้า ${bCust} ⇒ ยอดยกมา = ของพร้อมส่งในคลัง FG · ลูกค้าสั่งจาก EDI 862/830 (รวมใบค้างส่งไว้คอลัมน์แรก) · ผลิตเข้านับจากใบผลิตทุกไลน์${fgNote ? ` · ${fgNote}` : ''}`
                  : '⚠️ บอร์ด FG ใบนี้ยังไม่ผูกลูกค้า ⇒ ระบบดึงยอดลูกค้าสั่งให้ไม่ได้ — กด "📦 สร้างบอร์ด FG จากออเดอร์" ใหม่อีกครั้ง')
                : board?.line_name
                  ? `ผูกไลน์ ${board.line_name} ⇒ ระบบเติมของเข้า/ออก/ขั้นต่ำให้`
                  : 'ยังไม่ผูกไลน์ ⇒ ทุกช่องต้องกรอกเอง'}
            </span>
          </FilterBar>
        ) : null}
      />

      {warn ? (
        <div style={{ ...card, borderColor: 'var(--accent2)', fontSize: FS + 1, marginBottom: 10 }}>🔴 {warn}</div>
      ) : null}

      {/* ── แท็บ FG มี 2 มุมมองที่ตอบคนละคำถาม — เขียนไว้บนปุ่มเลยว่าใครตอบอะไร ──────────
          🔴 **ห้ามยุบ 2 มุมนี้เป็นตารางเดียว** — มุมซ้ายรายการมาจาก "ออเดอร์" แล้วยุบเลขที่ชี้
             สต๊อกก้อนเดียวกันเข้าแถวเดียว (ต้องรู้สต๊อกก่อนถึงยุบได้) · มุมขวารายการเป็น
             "แถวที่เก็บไว้" เพื่อให้พิมพ์ทับได้ · ยุบ = เสียอย่างใดอย่างหนึ่ง
             (เหตุผลเต็ม + ทางที่ลองแล้วไม่ได้ → docs/modules/monitoring-boards.md §6.6) */}
      {tab === 'fg' ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {[
            { k: 'rundown', t: '📉 ของจะขาดวันไหน', s: 'อัตโนมัติล้วน · เรียงตัวที่จะขาดก่อน · ครอบ FG ทุกตัวที่มีออเดอร์' },
            { k: 'board', t: '✏️ บอร์ดแก้มือ (ต่อลูกค้า)', s: 'พิมพ์ทับยอดได้ · เห็นผลิตเข้า/ขั้นต่ำในตารางเดียว' },
          ].map(v => (
            <button key={v.k} type="button" onClick={() => setFgView(v.k)}
              aria-current={fgView === v.k ? 'true' : undefined}
              style={{
                textAlign: 'left', padding: '7px 13px', borderRadius: 9, cursor: 'pointer',
                border: `1px solid ${fgView === v.k ? 'var(--accent)' : 'var(--border2)'}`,
                background: fgView === v.k ? 'var(--accent-dim)' : 'var(--bg2)',
                color: fgView === v.k ? 'var(--accent)' : 'var(--text2)',
              }}>
              <div style={{ fontSize: FS + 1, fontWeight: 800 }}>{v.t}</div>
              <div style={{ fontSize: FS - 1, color: 'var(--muted)', fontWeight: 400 }}>{v.s}</div>
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'fg' && fgView === 'rundown' ? (
        <Suspense fallback={<div style={{ ...card, fontSize: FS + 1, color: 'var(--muted)' }}>กำลังโหลด…</div>}>
          {/* embed ทั้งดุ้น — ต้องครอบ <Hub> เสมอ ไม่งั้นหัวเรื่องซ้อน 2 ชั้น (มีด่าน · UI-STANDARD §2) */}
          <Hub><RundownStock /></Hub>
        </Suspense>
      ) : !tabBoards.length ? (
        <div style={{ ...card, fontSize: FS + 1, lineHeight: 1.9 }}>
          ยังไม่มีบอร์ดในหมวดนี้ ({BOARD_TABS.find(t => t.key === tab)?.sheets})
          {canEdit
            ? <> — กด <b>📗 นำเข้าจากไฟล์ Excel</b> แล้วเลือกไฟล์ <code>1.Monitoring-&lt;เดือน&gt;.xlsx</code> ระบบจะสร้างบอร์ดให้ตามชีทในไฟล์</>
            : ' — ต้องมีสิทธิ์จัดการบอร์ดจึงจะนำเข้าได้'}
        </div>
      ) : loading && !parts.length ? (
        <div style={{ ...card, fontSize: FS + 1, color: 'var(--muted)' }}>กำลังโหลด…</div>
      ) : (
        <MonitorBoardGrid
          board={board} parts={partsWithFlag} periods={periods}
          manualMap={manualMap} systemMap={systemMap}
          onEditCell={onEditCell} editable={canEdit} truncated={truncated}
          windowSize={board?.period_kind === 'week' ? 10 : 14}
        />
      )}

      {showFgSync ? (
        <Suspense fallback={null}>
          <MonitorFgSync
            onClose={() => setShowFgSync(false)} fullName={fullName}
            onSynced={() => { setTab('fg'); loadBoards(); }}
          />
        </Suspense>
      ) : null}

      {showImport ? (
        <Suspense fallback={null}>
          <MonitoringUpload
            asModal onClose={() => setShowImport(false)}
            canUpload={canUpload} canBoard={canEdit} fullName={fullName}
            onImported={() => { setShowImport(false); loadBoards(); load(); }}
          />
        </Suspense>
      ) : null}
    </Page>
  );
}
