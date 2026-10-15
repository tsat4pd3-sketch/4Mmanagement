import { useState, useEffect, useCallback, useMemo, useRef, useContext, lazy, Suspense } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can, canSeeded } from '../utils/permissions';
import useProductionLines from '../utils/useProductionLines';
import { canWriteLine, writableRows, writeBlockText } from '../utils/writeScope';
import { checkWrite } from '../utils/dbWrite';
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';
import { useLiveBoard } from '../utils/useLiveBoard';
import { getWorkDate, addDaysStr } from '../utils/workDate';
import { toast } from '../components/Toast';
import Page, { Hub } from '../components/Page';
import PageHeader from '../components/PageHeader';
import FilterBar from '../components/FilterBar';
import useTabParam from '../utils/useTabParam';
import MonitorBoardGrid from '../components/MonitorBoardGrid';
import { BOARD_TABS, boardPeriods, rowDefs } from '../utils/monitorBoards';
import {
  sumByMatDate, firstByMat, makeSystemLookup, OUT_TXN_TYPES, IN_TXN_TYPES,
  DEMAND_SKIP_STATUS, onHandAtRef, outAtRef, inAtRef, fgAnchorBalance, makeAnchorLookup, rackOrderSyncPlan,
  rebucketToWeeks, lockFromByMat, makeLockLookup,
} from '../utils/monitorSystem';
import { refStockOf, rawSourceLocOf } from '../utils/partRefStock';
import { isTodayPeriod } from '../utils/periodHead';
import { buildPnIndex, pickStockMat } from '../utils/matResolve';
import { openOnly } from '../utils/shipStatus';

/* 🔴 จุดอัพโหลดไฟล์ Monitoring มี **จุดเดียวทั้งระบบ** (08/10 คำสั่ง user) — ตัวเดียวกับที่
   `/planner-sales?tab=monitoring` ใช้ · กดที่ไหนก็ลงครบทุกชั้นในครั้งเดียว ห้ามแยกกลับเป็น 2 ตัว */
const MonitoringUpload = lazy(() => import('../components/MonitoringUpload'));
const MonitorFgSync = lazy(() => import('../components/MonitorFgSync'));
/* 📉 "คาดการณ์ของจะขาด" ของเดิม — embed ทั้งดุ้น ไม่แก้ของเดิม (pattern เดียวกับ /equipment · PmHub)
   เหตุผลที่**ยุบตารางเข้าด้วยกันตรงๆ ไม่ได้** เขียนไว้ที่ docs/modules/monitoring-boards.md §6.6 */
const RundownStock = lazy(() => import('./RundownStock'));
const StockAdjustRequestModal = lazy(() => import('../components/StockAdjustRequestModal'));

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
  const { role, fullName, section: homeSection, sections: mySections, allUnits } = useContext(UserContext);
  /* 🔐 บอร์ดผูก "ไลน์เจ้าของ" (`monitor_boards.line_name`) ⇒ กรอก/ลบช่องได้เฉพาะบอร์ดของส่วนงานตัวเอง
     (audit 15/10 — เดิมโหลดทุกบอร์ด แล้ว syncRackOrder ยิงต่อเป็นใบส่งของจริง)
     🔴 บอร์ดชนิด `fg` ผูก "ลูกค้า" ไม่ใช่ไลน์ ⇒ ไม่มีไลน์ให้เทียบ = ตัดสินไม่ได้ ⇒ ไม่บล็อก */
  const lineRows = useProductionLines();
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
  const [sysNote, setSysNote] = useState('');                    // สิ่งที่บอร์ดตอบไม่ได้ / ยึดยอดจากคลังไหน — ต้องเขียนบนจอ
  /* 🔗 BALANCE คอลัมน์วันนี้ = ยอดคงเหลือจริงจาก ledger (SSOT ยอดสต็อก · 12/10)
     เดิมบอร์ดคิดยอดเองจาก "ยกมาที่กรอก + ผลิต − ออก" แล้วห่างจาก ledger ถึงหลักหมื่นชิ้นต่อพาร์ท
     ⇒ วันนี้ยึดของจริง · วันถัดไปเดินสูตรต่อจากของจริง · ข้อมูลอยู่ที่ ledger ที่เดียว */
  const [sysAnchor, setSysAnchor] = useState(() => new Map());
  /* 🔒 13/10 — MAT → วันแรกที่ระบบมีตัวเลข (ล็อกช่อง IN) · MAT → คลังอ้างอิง (ปลายทางของ "ขอปรับยอด") */
  const [sysLock, setSysLock] = useState(() => new Map());
  const [sysLoc, setSysLoc] = useState(() => new Map());
  const [adjReq, setAdjReq] = useState(null);            // { mat, part_name, loc, onHand }
  const [sysOut, setSysOut] = useState(() => new Map());
  const [sysMin, setSysMin] = useState(() => new Map());
  const [registry, setRegistry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [warn, setWarn] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showFgSync, setShowFgSync] = useState(false);

  const canEditPerm = canSeeded('monitoring', 'manage', role);
  /* ขอปรับยอดคลัง = สิทธิ์เดียวกับกรอกเคลื่อนไหวที่ /line-stock (ใบเข้าคิวอนุมัติ line_stock:approve) */
  const canRequestAdj = can('line_stock', 'issue', role);
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
  const wctx = useMemo(() => ({ role, section: homeSection, sections: mySections, allUnits }),
    [role, homeSection, mySections, allUnits]);

  useEffect(() => { loadBoards(); }, [loadBoards]);

  const tabBoards = useMemo(() => boards.filter(b => b.kind === tab), [boards, tab]);
  const board = useMemo(
    () => tabBoards.find(b => b.id === boardId) || tabBoards[0] || null,
    [tabBoards, boardId],
  );

  /* บอร์ดที่เปิดอยู่เป็นของส่วนงานเราไหม — ตัดสินตอนจะ "แก้" เท่านั้น **การดูไม่ถูกจำกัด** */
  const boardWrite = useMemo(() => canWriteLine(wctx, board?.line_name, lineRows), [wctx, board, lineRows]);
  const canEdit = canEditPerm && boardWrite.ok;
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
  /* บอร์ด Argen (ชิ้นส่วนส่งเกรท) — ไม่ผูกไลน์/ลูกค้า แต่ของอยู่ในคลังจริง ⇒ ยึดยอดคลังได้ (13/10 · user สั่ง) */
  const isGreat = board?.kind === 'great';
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
    /* 📅 + วันนี้และอีก 6 วันเสมอ — ไม่งั้นบอร์ดที่ยอดล่าสุดเป็นของวันก่อน ไม่มีช่องให้พิมพ์ออเดอร์วันนี้ (12/10) */
    return boardPeriods(board, { dates: ds, horizon: 7 });
  }, [board, cells]);

  const dFrom = periods[0]?.date || '';
  const dTo = periods[periods.length - 1]?.date || '';
  const matsKey = useMemo(() => parts.map(p => p.mat_no).filter(Boolean).sort().join(','), [parts]);
  /* deps ของ loadSystem ห้ามเป็น array (กฎ DB ข้อ 9) ⇒ ส่งคอลัมน์เป็นสตริง แล้วอ่าน `periods` ผ่าน ref */
  const periodsKey = useMemo(() => periods.map(p => p.key).join(','), [periods]);
  const periodsRef = useRef(periods);
  periodsRef.current = periods;

  /* 🔒 ล็อกช่อง IN ของพาร์ทที่ระบบมีตัวเลขแล้ว (`lockFromByMat` · monitorSystem.js)
     🔴 ไม่รู้คลัง/โหลดไม่ครบ = ไม่ล็อก (ล็อกแล้วระบบไม่มีค่า = บังคับ 0 ผิดๆ) · โหลดใบผลิตไม่ครบ = ใช้แค่หลักฐานจากคลัง */
  const applyLock = useCallback(({ refErr, poR, inRows, locOf, mats }) => {
    if (refErr) { setSysLock(new Map()); setSysLoc(new Map()); return; }
    const poOk = !(poR?.error || poR?.truncated);
    setSysLock(lockFromByMat({
      inRows: inRows || [], locOf,
      prodRows: poOk ? (poR.rows || []).map(r => ({ mat_no: r.mat_no, work_date: r.production_sessions?.work_date })) : [],
    }));
    setSysLoc(new Map((mats || []).map(m => [m, locOf(m)]).filter(([, l]) => l)));
  }, []);

  const curSysRef = useRef('');
  const loadSystem = useCallback(async () => {
    const scope = isFg ? bCust : (isGreat ? 'great' : bLine);
    if (!scope || !dFrom || !dTo || !matsKey) {
      setSysIn(new Map()); setSysOut(new Map()); setSysMin(new Map()); setSysOrder(new Map());
      setSysAnchor(new Map()); setSysNote(''); setSysLock(new Map()); setSysLoc(new Map());
      /* 🔴 บอร์ดที่ไม่ผูกไลน์/ลูกค้า (รายแร็ค) ก็ต้องเช็คทะเบียน — เดิมข้ามไป ⇒ ทุกพาร์ทขึ้น
         "ยังไม่อยู่ในทะเบียนสินค้า" ทั้งที่อยู่ (12/10 · 10057225) = ป้ายเตือนปลอม */
      const myKey = `reg|${matsKey}`;
      curSysRef.current = myKey;
      if (!matsKey) { setRegistry(new Set()); return; }
      const r = await fetchAllPages(() => supabaseDR.from('dr_products')
        .select('mat_no').eq('is_active', true).in('mat_no', matsKey.split(',')), { orderBy: ['mat_no'] });
      if (curSysRef.current !== myKey) return;
      setRegistry(r.error || r.truncated ? null : new Set((r.rows || []).map(x => String(x.mat_no || '').trim())));
      return;
    }
    const mats = matsKey.split(',');
    const myKey = `${isFg ? 'fg' : (isGreat ? 'great' : 'line')}|${scope}|${dFrom}|${dTo}|${matsKey}`;
    const mine = () => curSysRef.current === myKey;
    curSysRef.current = myKey;

    /* ── บอร์ด Argen (รายสัปดาห์): IN = คลังกดรับ (ledger) · BALANCE สัปดาห์นี้ = ยอดจริงในคลัง ──────
       13/10 (user สั่ง "ทำ Argen ให้ดึงยอดจากคลังด้วย") · เดิมทุกช่องพิมพ์มือ ยอดเดินจากยกมา 14/12/2025 − ส่ง
       ไม่ผูก ledger เลย ⇒ เลขไม่ตรงคลัง · คลังของพาร์ท = `rawSourceLocOf` (ที่ของอยู่จริง ตัวเดียวกับตัดวัตถุดิบล็อต)
       ส่งลูกค้า (send) ยังเป็นช่องกรอก — ส่งเกรทไม่ผ่าน customer_shipping_orders */
    if (isGreat) {
      const wkEnd = addDaysStr(dTo, 6) || dTo;
      const [rcpR, txnR, prodR, stkR, ruleR, lotR, poR] = await Promise.all([
        fetchAllPages(() => supabaseDR.from('stock_receipts')
          .select('id, mat_no, qty_expected').eq('status', 'pending').in('mat_no', mats), { orderBy: ['id'] }),
        fetchAllPages(() => supabaseDR.from('line_stock_transactions')
          .select('id, line_name, mat_no, qty, type, status, work_date')
          .in('type', IN_TXN_TYPES).eq('status', 'approved').in('mat_no', mats)
          .gte('work_date', dFrom).lte('work_date', wkEnd), { orderBy: ['id'] }),
        fetchAllPages(() => supabaseDR.from('dr_products')
          .select('mat_no, line_name, is_active, is_operation').in('mat_no', mats), { orderBy: ['mat_no'] }),
        fetchAllPages(() => supabaseDR.from('line_stock_summary')
          .select('line_name, mat_no, qty_on_hand').in('mat_no', mats), { orderBy: ['mat_no', 'line_name'] }),
        supabaseDR.from('stock_inflow_rules').select('match_type, match_value, dest_line_name, is_active').eq('is_active', true),
        fetchAllPages(() => supabaseDR.from('child_lot_requests')
          .select('id, child_mat_no').in('child_mat_no', mats).neq('status', 'cancelled'), { orderBy: ['id'] }),
        /* 🔒 Daily Report ลงยอด MAT นี้แล้ว = ระบบเป็นเจ้าของช่อง IN (คำสั่ง user 13/10) */
        fetchAllPages(() => supabaseDR.from('prod_orders')
          .select('id, mat_no, production_sessions!inner(work_date)').eq('status', 'confirmed').in('mat_no', mats)
          .gte('production_sessions.work_date', dFrom).lte('production_sessions.work_date', getWorkDate()), { orderBy: ['id'] }),
      ]);
      if (!mine()) return;
      const loadErr = (r) => r?.error || (r?.errors && r.errors[0]) || (r?.truncated ? 'ดึงข้อมูลได้ไม่ครบ' : null);
      const refErr = loadErr(prodR) || loadErr(stkR) || loadErr(lotR) || loadErr(txnR) || ruleR.error;
      const ctx = {
        products: prodR.rows || [], rules: ruleR.data || [], receiptLine: 'STORE',
        lotMats: new Set((lotR.rows || []).map(r => String(r.child_mat_no || '').trim())),
      };
      const locOf = refErr ? () => null : (mt) => rawSourceLocOf(mt, ctx);
      const onHand = refErr ? new Map() : onHandAtRef(stkR.rows || [], locOf);
      setSysIn(refErr ? new Map() : rebucketToWeeks(inAtRef(txnR.rows || [], locOf), periodsRef.current));
      setSysAnchor(onHand);
      setSysOut(new Map()); setSysMin(new Map()); setSysOrder(new Map()); setSysSeedBal(new Map());
      applyLock({ refErr, poR, inRows: txnR.rows, locOf, mats });
      const rcpQty = (rcpR.rows || []).reduce((a, r) => a + (Number(r.qty_expected) || 0), 0);
      const locs = [...new Set(mats.map(m => locOf(m)).filter(Boolean))].sort();
      const noRow = mats.filter(m => !onHand.has(m)).length;
      setSysNote(refErr
        ? `⚠️ อ่านยอดคลังไม่ครบ (${refErr.message || refErr}) ⇒ BALANCE สัปดาห์นี้ยังเป็นค่าจากสูตร และไม่มี IN จากระบบ`
        : [
          `BALANCE สัปดาห์นี้ = ยอดคงเหลือจริงในคลัง (${locs.join(' · ') || '–'}) · IN = ของที่คลังกดรับแล้ว`,
          rcpQty ? `⏳ รอคลังกดรับ ${(rcpR.rows || []).length} ใบ · ${rcpQty.toLocaleString()} ชิ้น (ยังไม่นับใน IN)` : '',
          noRow ? `⚠️ ${noRow} พาร์ทไม่มีแถวในคลัง ⇒ ยังเช็คยอดจริงไม่ได้ — ตั้งยอดที่ /line-stock?tab=count` : '',
        ].filter(Boolean).join(' · '));
      setRegistry(new Set((prodR.rows || []).filter(r => r.is_active !== false).map(r => String(r.mat_no || '').trim())));
      return;
    }

    /* ── บอร์ด FG: ยอดลูกค้าสั่ง (862/830) + ผลิตเข้า (ทุกไลน์) ───────────────────── */
    if (isFg) {
      const [demR, lateR, prodR2, stkR, ruleR, kbR] = await Promise.all([
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
      const stockMatOf = new Map();   // เลข SAP ในคลัง → เลขบนบอร์ด
      let unresolved = 0;
      for (const mt of mats) {
        const res = pickStockMat(mt, pnIdx, hasStock);
        /* 🔴 resolve ไม่ได้ = **ไม่รู้ว่ามีของเท่าไหร่** ⇒ ไม่ใส่ค่า ปล่อยให้ทั้งแถวขึ้นขีด
           ห้ามใส่ 0 (0 แปลว่า "รู้ว่าไม่มีของ" ซึ่งคนละเรื่องกับ "ยังเช็คไม่ได้") */
        if (!res.mat) { unresolved++; continue; }
        seedBal.set(mt, onHand.get(res.mat) ?? 0);
        stockMatOf.set(res.mat, mt);
      }
      setSysSeedBal(seedBal);
      /* 📥 IN = ของที่คลัง FG กดรับแล้ว (ledger `issue`) — ไม่ใช่ใบผลิตที่คอนเฟิร์ม (user 12/10)
         ดึงหลัง resolve เลข SAP (ใบลูกค้าอ้างเลขลูกค้า) · กรองคลัง FG + เลขที่ resolve ได้ที่ฝั่ง DB (egress)
         ไม่รู้คลัง FG = ไม่มี IN · ไม่เดา */
      let inErr = null;
      if (fgDest && stockMatOf.size) {
        const inR = await fetchAllPages(() => supabaseDR.from('line_stock_transactions')
          .select('id, line_name, mat_no, qty, type, status, work_date')
          .in('type', IN_TXN_TYPES).eq('status', 'approved').eq('line_name', fgDest)
          .in('mat_no', [...stockMatOf.keys()])
          .gte('work_date', dFrom).lte('work_date', dTo), { orderBy: ['id'] });
        if (!mine()) return;
        inErr = inR.error || (inR.errors && inR.errors[0]) || (inR.truncated ? 'ดึงข้อมูลได้ไม่ครบ' : null);
        const inRows = (inR.rows || []).map(r => ({ ...r, mat_no: stockMatOf.get(String(r.mat_no || '').trim()) }));
        setSysIn(inAtRef(inRows, () => fgDest));
      } else {
        setSysIn(new Map());
      }
      /* 🔗 คอลัมน์วันนี้ยึดของจริง: คลัง FG ตอนนี้ − ค้างส่งถึงกำหนด + ส่งล่วงหน้า (กันหักซ้ำ) */
      setSysAnchor(fgAnchorBalance({
        onHand: seedBal, today: getWorkDate(),
        orders: [...(demR.rows || []), ...(lateR.rows || [])],
      }));
      setSysNote([
        fgDest ? `ของพร้อมส่งนับจากคลัง ${fgDest} · IN = ที่คลังกดรับแล้ว · คอลัมน์วันนี้ = ยอดจริงในคลัง − ค้างส่งถึงกำหนด` : '⚠️ ยังไม่ได้ตั้งกฎรับเข้าของ FG ⇒ นับสต๊อกทุกคลังรวมกัน (สูงกว่าจริง) · ไม่มี IN',
        unresolved ? `⚠️ ${unresolved} พาร์ทยังจับคู่เลข MAT SAP ไม่ได้ ⇒ ไม่รู้ยอดยกมา (ขึ้นขีดทั้งแถว)` : '',
        inErr ? `⚠️ อ่านยอดรับเข้าคลัง FG ไม่ครบ (${inErr.message || inErr}) ⇒ แถว IN อาจขาด` : '',
      ].filter(Boolean).join(' · '));

      /* ไม่มีไลน์ ⇒ ไม่รู้ MIN/OUT ของบอร์ดนี้ — ปล่อยว่างให้จอขึ้นขีด ห้ามเดา 0 */
      setSysOut(new Map()); setSysMin(new Map());
      setRegistry(new Set((prodR2.rows || []).map(r => String(r.mat_no || '').trim())));
      return;
    }

    const [rcpR, txnR, lvlR, prodR, stkR, ruleR, lotR, poR] = await Promise.all([
      /* ⏳ ผลิตคอนเฟิร์มแล้วแต่คลังยังไม่กดรับ — ยังไม่นับใน IN แต่ต้องบอกบนจอ (ห้ามหายเงียบ) */
      fetchAllPages(() => supabaseDR.from('stock_receipts')
        .select('id, mat_no, qty_expected').eq('status', 'pending').in('mat_no', mats), { orderBy: ['id'] }),
      /* ของออก: ดึงทุกคลังของ MAT เหล่านี้ แล้วให้ `outAtRef` เลือกเฉพาะคลังอ้างอิงของแต่ละพาร์ท
         (12/10 · เดิมกรอง `line_name = ไลน์ของบอร์ด` + นับ issue ⇒ ของเข้าถูกนับเป็นของออก) */
      fetchAllPages(() => supabaseDR.from('line_stock_transactions')
        .select('id, line_name, mat_no, qty, type, status, work_date')
        .in('type', [...OUT_TXN_TYPES, ...IN_TXN_TYPES]).eq('status', 'approved').in('mat_no', mats)
        .gte('work_date', dFrom).lte('work_date', dTo), { orderBy: ['id'] }),
      fetchAllPages(() => supabaseDR.from('line_part_levels')
        .select('mat_no, min_qty').eq('line_name', bLine).eq('is_active', true).in('mat_no', mats),
        { orderBy: ['mat_no'] }),
      fetchAllPages(() => supabaseDR.from('dr_products')
        .select('mat_no, line_name, is_active, is_operation').in('mat_no', mats), { orderBy: ['mat_no'] }),
      fetchAllPages(() => supabaseDR.from('line_stock_summary')
        .select('line_name, mat_no, qty_on_hand').in('mat_no', mats), { orderBy: ['mat_no', 'line_name'] }),
      supabaseDR.from('stock_inflow_rules').select('match_type, match_value, dest_line_name, is_active').eq('is_active', true),
      fetchAllPages(() => supabaseDR.from('child_lot_requests')
        .select('id, child_mat_no').in('child_mat_no', mats).neq('status', 'cancelled'), { orderBy: ['id'] }),
      /* 🔒 Daily Report ลงยอด MAT นี้แล้ว = ระบบเป็นเจ้าของช่อง IN (คำสั่ง user 13/10) */
      fetchAllPages(() => supabaseDR.from('prod_orders')
        .select('id, mat_no, production_sessions!inner(work_date)').eq('status', 'confirmed').in('mat_no', mats)
        .gte('production_sessions.work_date', dFrom).lte('production_sessions.work_date', getWorkDate()), { orderBy: ['id'] }),
    ]);
    if (!mine()) return;
    /* 🔴 คลังอ้างอิงของพาร์ท = `refStockOf` ตัวเดียวกับจุดเรียกเติม + ตัวนำเข้า Monitoring
       (ผลิตเอง → คลังตามกฎรับเข้า · ล็อตสโตร์ → ที่ไลน์ผลิต · ของที่ไลน์ใช้ → หน้าไลน์)
       อ่านกฎ/ล็อต/ยอดคลังไม่ครบ = ไม่รู้ว่าของอยู่ไหน ⇒ ไม่ยึดยอด (ปล่อยสูตร) แล้วเขียนบนจอ ห้ามเดาคลัง */
    const loadErr = (r) => r?.error || (r?.errors && r.errors[0]) || (r?.truncated ? 'ดึงข้อมูลได้ไม่ครบ' : null);
    const refErr = loadErr(ruleR) || loadErr(lotR) || loadErr(stkR) || loadErr(txnR) || loadErr(prodR);
    const refCtx = {
      lineName: bLine, products: prodR.rows || [], rules: ruleR.data || [],
      lotMats: new Set((lotR.rows || []).map(r => String(r.child_mat_no || '').trim())),
    };
    const locOf = refErr ? () => null : (mt) => refStockOf(mt, refCtx).loc;
    const onHand = refErr ? new Map() : onHandAtRef(stkR.rows || [], locOf);
    setSysOut(refErr ? new Map() : outAtRef(txnR.rows || [], locOf));
    /* 📥 IN = ของที่คลังอ้างอิงกดรับแล้ว (ledger `issue`) — ไม่ใช่ใบผลิตคอนเฟิร์ม (user 12/10) */
    setSysIn(refErr ? new Map() : inAtRef(txnR.rows || [], locOf));
    const rcpRows = rcpR.rows || [];
    const rcpQty = rcpRows.reduce((a, r) => a + (Number(r.qty_expected) || 0), 0);
    setSysMin(firstByMat(lvlR.rows || []));
    setSysOrder(new Map()); setSysSeedBal(new Map());
    setSysAnchor(onHand);
    applyLock({ refErr, poR, inRows: txnR.rows, locOf, mats });
    const locs = [...new Set(mats.map(m => locOf(m)).filter(Boolean))].sort();
    const noRow = mats.filter(m => !onHand.has(m)).length;
    setSysNote(refErr
      ? `⚠️ อ่านกฎรับเข้าคลัง/ยอดคลังไม่ครบ (${refErr.message || refErr}) ⇒ คอลัมน์วันนี้ยังไม่ได้ยึดยอดจริง และไม่มีของออกจากระบบ — BALANCE เป็นค่าจากสูตรล้วน`
      : [
        `คอลัมน์วันนี้ = ยอดคงเหลือจริงในคลัง (${locs.join(' · ') || '–'}) · IN = คลังกดรับแล้ว · ของออก = ใช้/คืนจากคลังนั้น`,
        rcpRows.length ? `⏳ ผลิตคอนเฟิร์มแล้วรอคลังกดรับ ${rcpRows.length} ใบ · ${rcpQty.toLocaleString()} ชิ้น (ยังไม่นับใน IN — รับที่ /line-stock?tab=receipts)` : '',
        loadErr(rcpR) ? '⚠️ อ่านใบรอรับเข้าไม่ได้ — ไม่รู้ว่ามีของค้างรับเท่าไหร่' : '',
        noRow ? `⚠️ ${noRow} พาร์ทไม่มีแถวในคลังอ้างอิง ⇒ ยังเช็คยอดจริงไม่ได้ (เดินสูตรจากยอดยกมา) — ตั้งยอดที่ /line-stock?tab=count` : '',
      ].filter(Boolean).join(' · '));
    setRegistry(new Set((prodR.rows || []).map(r => String(r.mat_no || '').trim())));
  }, [isFg, isGreat, bCust, bLine, dFrom, dTo, matsKey, periodsKey]);

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

  /* คอลัมน์ "วันนี้" (ไม่ใช่ช่องยอดยกมา) — จุดยึดยอดจริงจาก ledger · วันนี้อยู่นอกช่วงบอร์ด = ไม่ยึด */
  const anchorKey = useMemo(() => {
    if (!board || !(isFg || isGreat || bLine)) return null;
    const today = getWorkDate();
    const hit = periods.slice(1).find(p => isTodayPeriod(p.date, today, board.period_kind || 'day'));
    return hit ? hit.key : null;
  }, [board, isFg, isGreat, bLine, periods]);
  const anchorMap = useMemo(
    () => makeAnchorLookup({ partMat, balByMat: sysAnchor, anchorKey }),
    [partMat, sysAnchor, anchorKey],
  );
  const lockMap = useMemo(
    () => makeLockLookup({ partMat, lockFrom: sysLock, periods, kind: board?.period_kind || 'day', today: getWorkDate() }),
    [partMat, sysLock, periods, board?.period_kind],
  );
  const lockNote = sysLock.size
    ? ` · 🔒 IN ล็อก ${sysLock.size} พาร์ท (ระบบมีตัวเลขแล้ว — ตั้งแต่วันแรกที่มีถึงวันนี้ · ยอดไม่ตรงกดช่องเพื่อขอปรับยอดคลัง)`
    : '';
  /* กดช่อง IN ที่ล็อก ⇒ เปิดใบ "ขอปรับยอดคลัง" (ไม่ใช่พิมพ์ทับ) */
  const onLockedCell = useCallback(({ partId }) => {
    const part = parts.find(p => p.id === partId);
    const mat = String(part?.mat_no || '').trim();
    if (!mat) return;
    setAdjReq({ mat, part_name: part?.part_name || '', loc: sysLoc.get(mat) || null, onHand: sysAnchor.has(mat) ? sysAnchor.get(mat) : null });
  }, [parts, sysLoc, sysAnchor]);

  const partsWithFlag = useMemo(
    /* registry = null = เช็คไม่ได้ ⇒ ไม่ขึ้นป้าย (ไม่รู้ ≠ ไม่อยู่ในทะเบียน) */
    () => parts.map(p => ({ ...p, in_registry: !p.mat_no || !registry || registry.has(String(p.mat_no).trim()) })),
    [parts, registry],
  );

  /* 🚚 ORDER บนบอร์ดรายแร็ค → ใบส่งของหน้า Delivery (user 12/10 "ข้อมูลลูกค้าลงแล้วแต่ไม่ขึ้น
     Shipping Time Chart ต้องไป add manual") — กติกา `rackOrderSyncPlan` · แตะเฉพาะใบ source `monitoring`
     ที่ยังไม่ส่ง (ชุดเดียวกับที่ตัวนำเข้าไฟล์ล้าง/ลงใหม่) · ล้มต้องบอก เพราะบอร์ดบันทึกไปแล้ว */
  const syncRackOrder = useCallback(async (partId, periodKey, qty) => {
    const part = parts.find(x => x.id === partId);
    const mat = String(part?.mat_no || '').trim();
    if (!mat) return;
    const cust = board?.customer || '';
    if (!cust) { toast.info(`บอร์ด ${board?.name || ''} ยังไม่ผูกลูกค้า — ยอดนี้ยังไม่ขึ้นหน้า Delivery`); return; }
    const fail = (msg) => toast.error(`บันทึกบนบอร์ดแล้ว แต่ส่งเข้าใบส่งของ (Delivery) ไม่สำเร็จ: ${msg} — แก้ช่องนี้อีกครั้ง`);
    const { data: rows, error } = await supabaseDR.from('customer_shipping_orders')
      .select('id, qty, status, source').eq('customer', cust).eq('mat_no', mat).eq('due_date', periodKey)
      .in('status', ['pending', 'shipped']);
    if (error) { fail(error.message); return; }
    const mine = (rows || []).filter(r => r.status === 'pending' && r.source === 'monitoring');
    const covered = (rows || []).filter(r => !mine.includes(r)).reduce((a, r) => a + (Number(r.qty) || 0), 0);
    const plan = rackOrderSyncPlan({ qty, covered, pending: mine });
    if (plan.update) {
      const r = await supabaseDR.from('customer_shipping_orders').update({ qty: plan.update.qty })
        .eq('id', plan.update.id).eq('status', 'pending').select('id');
      if (r.error || !r.data?.length) { fail(r.error?.message || 'ใบถูกส่ง/แก้ไปก่อนแล้ว'); return; }
    }
    if (plan.insertQty) {
      const r = await supabaseDR.from('customer_shipping_orders').insert({
        mat_no: mat, part_name: part?.part_name || null, customer: cust,
        customer_part_no: part?.part_no || null, due_date: periodKey, qty: plan.insertQty,
        status: 'pending', source: 'monitoring', note: `Monitoring · บอร์ด ${board?.name || ''}`,
        created_by_name: fullName || null,
      }).select('id');
      if (r.error || !r.data?.length) { fail(r.error?.message || 'ไม่มีสิทธิ์เขียน'); return; }
    }
    if (plan.deleteIds.length) {
      const r = await supabaseDR.from('customer_shipping_orders').delete()
        .in('id', plan.deleteIds).eq('status', 'pending').select('id');
      if (r.error) { fail(r.error.message); return; }
    }
  }, [parts, board, fullName]);

  /* ── บันทึกช่อง ───────────────────────────────────────────────────────────────── */
  const onEditCell = useCallback(async ({ partId, rowKey, periodKey, value }) => {
    /* 🔐 ด่านซ้ำตอนเขียนจริง — `editable` ที่ส่งให้ตารางเป็นแค่การซ่อนช่อง */
    if (!canEditPerm) return;
    if (!boardWrite.ok) { toast.info(writeBlockText(boardWrite, { what: 'บอร์ดของไลน์นี้' })); return; }
    const def = rowDefs(board).find(r => r.key === rowKey);
    const isText = def?.kind === 'date';
    const isRackOrder = board?.kind === 'rack' && rowKey === 'order';
    const raw = String(value ?? '').trim();

    /* ลบค่าทิ้ง = ลบแถว ไม่ใช่เขียน 0 — "ว่าง" กับ "ศูนย์" ต้องแยกกันได้ตลอด */
    if (raw === '') {
      const r = await supabaseDR.from('monitor_cells').delete()
        .eq('board_part_id', partId).eq('row_key', rowKey).eq('period_key', periodKey).select('id');
      if (!checkWrite(r, 'ล้างค่าในช่อง')) return;
      setCells(cs => cs.filter(c => !(c.board_part_id === partId && c.row_key === rowKey
        && String(c.period_key).slice(0, 10) === periodKey)));
      if (isRackOrder) await syncRackOrder(partId, periodKey, null);
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
    if (isRackOrder) await syncRackOrder(partId, periodKey, row.qty);
  }, [canEdit, board, fullName, syncRackOrder]);

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
                  ? `ผูกลูกค้า ${bCust} ⇒ ยอดยกมา = ของพร้อมส่งในคลัง FG · ลูกค้าสั่งจาก EDI 862/830 (รวมใบค้างส่งไว้คอลัมน์แรก) · ผลิตเข้านับจากใบผลิตทุกไลน์${sysNote ? ` · ${sysNote}` : ''}`
                  : '⚠️ บอร์ด FG ใบนี้ยังไม่ผูกลูกค้า ⇒ ระบบดึงยอดลูกค้าสั่งให้ไม่ได้ — กด "📦 สร้างบอร์ด FG จากออเดอร์" ใหม่อีกครั้ง')
                : isGreat
                  ? `ส่งเกรท (รายสัปดาห์) ⇒ ระบบเติมของเข้าให้ · ส่งลูกค้ากรอกเอง${sysNote ? ` · ${sysNote}` : ''}${lockNote}`
                : board?.line_name
                  ? `ผูกไลน์ ${board.line_name} ⇒ ระบบเติมของเข้า/ออก/ขั้นต่ำให้${sysNote ? ` · ${sysNote}` : ''}${lockNote}`
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
      ) : (<>
        {/* 🔐 มีสิทธิ์จัดการบอร์ด แต่บอร์ดนี้เป็นของส่วนงานอื่น — เขียนบอก ห้ามให้ช่องเทาเฉยๆ */}
        {canEditPerm && !boardWrite.ok && (
          <div style={{ ...card, padding: '8px 10px', marginBottom: 8, fontSize: FS,
            borderLeft: '4px solid #eab308' }}>
            🔒 {writeBlockText(boardWrite, { what: `บอร์ด "${board?.name || ''}"` })}
          </div>
        )}
        <MonitorBoardGrid
          board={board} parts={partsWithFlag} periods={periods}
          manualMap={manualMap} systemMap={systemMap} anchorMap={anchorMap} lockMap={lockMap}
          onLockedCell={canRequestAdj ? onLockedCell : null}
          onEditCell={onEditCell} editable={canEdit} truncated={truncated}
          windowSize={board?.period_kind === 'week' ? 10 : 14}
        />
      </>)}
      {adjReq ? (
        <Suspense fallback={null}>
          <StockAdjustRequestModal req={adjReq} by={fullName} onClose={() => setAdjReq(null)} />
        </Suspense>
      ) : null}

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
