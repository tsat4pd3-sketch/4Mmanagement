import { useState, useEffect, useCallback, useMemo, useRef, useContext, lazy, Suspense } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { canSeeded } from '../utils/permissions';
import { checkWrite } from '../utils/dbWrite';
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';
import { useLiveBoard } from '../utils/useLiveBoard';
import { getWorkDate } from '../utils/workDate';
import { toast } from '../components/Toast';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import FilterBar from '../components/FilterBar';
import useTabParam from '../utils/useTabParam';
import MonitorBoardGrid from '../components/MonitorBoardGrid';
import { BOARD_TABS, boardPeriods, rowDefs } from '../utils/monitorBoards';
import {
  sumByMatDate, firstByMat, makeSystemLookup, OUT_TXN_TYPES, IN_ORDER_STATUS, orderInQty,
} from '../utils/monitorSystem';

const MonitorImport = lazy(() => import('../components/MonitorImport'));

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

  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState('');
  const [parts, setParts] = useState([]);
  const [cells, setCells] = useState([]);
  const [sysIn, setSysIn] = useState(() => new Map());
  const [sysOut, setSysOut] = useState(() => new Map());
  const [sysMin, setSysMin] = useState(() => new Map());
  const [registry, setRegistry] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [warn, setWarn] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const canEdit = canSeeded('monitoring', 'manage', role);
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
    if (!bLine || !dFrom || !dTo || !matsKey) { setSysIn(new Map()); setSysOut(new Map()); setSysMin(new Map()); return; }
    const mats = matsKey.split(',');
    const myKey = `${bLine}|${dFrom}|${dTo}|${matsKey}`;
    const mine = () => curSysRef.current === myKey;
    curSysRef.current = myKey;
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
    setRegistry(new Set((prodR.rows || []).map(r => String(r.mat_no || '').trim())));
  }, [bLine, dFrom, dTo, matsKey]);

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
    () => makeSystemLookup({ partMat, inIdx: sysIn, outIdx: sysOut, minByMat: sysMin, seedKey: periods[0]?.key }),
    [partMat, sysIn, sysOut, sysMin, periods],
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
          <button type="button" onClick={() => setShowImport(true)}
            style={{ fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
              background: 'var(--accent)', color: '#08120a', border: 'none' }}>
            📗 นำเข้าจากไฟล์ Excel
          </button>
        ) : null}
        filters={tabBoards.length ? (
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
              {board?.line_name
                ? `ผูกไลน์ ${board.line_name} ⇒ ระบบเติมของเข้า/ออก/ขั้นต่ำให้`
                : 'ยังไม่ผูกไลน์ ⇒ ทุกช่องต้องกรอกเอง'}
            </span>
          </FilterBar>
        ) : null}
      />

      {warn ? (
        <div style={{ ...card, borderColor: 'var(--accent2)', fontSize: FS + 1, marginBottom: 10 }}>🔴 {warn}</div>
      ) : null}

      {!tabBoards.length ? (
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

      {showImport ? (
        <Suspense fallback={null}>
          <MonitorImport
            onClose={() => setShowImport(false)} fullName={fullName} today={today}
            onImported={() => { setShowImport(false); loadBoards(); load(); }}
          />
        </Suspense>
      ) : null}
    </Page>
  );
}
