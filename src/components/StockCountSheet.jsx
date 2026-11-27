import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import useIsMobile from '../utils/useIsMobile';
import { lineNameCompare } from '../utils/lineHierarchy';
import { supabase, supabaseDR } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
import { UserContext } from '../App';
import MatLabel from './MatLabel';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { checkWrite } from '../utils/dbWrite';
import { fetchAllPages } from '../utils/fetchByIds';
import { getWorkDate } from '../utils/workDate';
import { buildPnIndex, pickStockMat, matIssueText } from '../utils/matResolve';
import { countDelta, toAdjustTxns, countSummary, lastCountAt, pendingShipCuts,
  countRoundRows, pendingAdjustMap, splitPendingBlocked, pendingKey } from '../utils/stockCount';
/* 🔐 ชั้นสิทธิ์ที่ ③ — "ไลน์/คลังนี้เป็นของหน่วยงานเราไหม" (ช่องเลือกไลน์เป็นตัวกรองการดู ไม่ใช่ด่าน) */
import { canWriteLine, writeBlockText } from '../utils/writeScope';
import LineSelect, { scopeLines } from './LineSelect';
import NoticeBar from './NoticeBar';
import { useDraftAutosave, loadDraft, clearDraft } from '../utils/formDraft';   // 📝 ร่างในเครื่อง (มือถือ · 22/10)
import DraftRestoreBar from './DraftRestoreBar';

import { tr } from '../utils/i18n';
import { askConfirm } from '../utils/askConfirm';
/* ─── 📋 ตรวจนับ / เฟิร์มยอด — แท็บใน /line-stock (2026-09-23) ─────────────────
   เกิดจาก feedback หน้างาน (แพลนนิ่ง): "Stock บางตัวไม่ตรง" + "ให้ PD คีย์ผลิต
   แล้วเฟิร์มยอดให้เลยได้มั้ย"

   คำตอบของระบบแบ่ง 2 แผง เพราะเป็นคนละสาเหตุ (สูตรอยู่ใน utils/stockCount.js — มีเทส):

   🚚 แผงบน — **ส่งแล้วแต่ยังไม่ถูกหักออกจากคลัง**
      หน้า Delivery หักสต็อกให้อยู่แล้วตอนกด "ส่งแล้ว" และเตือนถูกต้องเมื่อหักไม่ได้
      แต่ toast ดับไปพร้อมจอ ⇒ ยอดค้างสูงกว่าจริงตลอดไปโดยไม่มีที่ไหนตามต่อ
      (วัดจริง 23/09: 155 ใบ / 22,781 ชิ้น ใน 914 ใบที่ส่ง) — แผงนี้ = รายการค้างถาวร

   📋 แผงล่าง — **ตรวจนับ** กรอก "ยอดที่นับได้" (ไม่ใช่ผลต่าง) ทั้งคลังในตารางเดียว
      ระบบคิดผลต่างแล้วบันทึกเป็น adjust ทีเดียว ผ่านคิวอนุมัติเดิม (REVIEW_TYPES)

   🔴 กฎเหล็ก: ห้ามหักใบที่ส่ง **ก่อน** รอบตรวจนับล่าสุดของ mat นั้น — ยอดที่นับได้
      สะท้อนของที่ออกไปแล้ว หักซ้ำ = ยอดหายสองเท่าเงียบๆ (ดู stockCount.js)

   ⚠️ PD คีย์ผลิตแล้วยอดเข้าคลังเอง (trigger fn_post_confirmed_output ฝั่ง DR) — ขาเข้า
      ไม่ต้องทำอะไรเพิ่ม · ที่ไม่ตรงคือขาออกกับการนับ ซึ่งคือ 2 แผงนี้
   ──────────────────────────────────────────────────────────────────────────── */

const card = { background:'var(--card)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:16 };
const btn = (bg, color='#fff') => ({ padding:'8px 16px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:700, background:bg, color, fontFamily:'var(--font-body)' });
const th = { textAlign:'left', padding:'8px 10px', fontSize:12, color:'var(--muted)', fontWeight:700, borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' };
const td = { padding:'6px 10px', fontSize:13, borderBottom:'1px solid var(--border2)' };
const numIn = { width:110, padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg2)', color:'var(--text)', fontSize:13, textAlign:'right', boxSizing:'border-box', fontFamily:'var(--font-body)' };
const n0 = (v) => (Number(v) || 0).toLocaleString();

export default function StockCountSheet({ role, scope }) {
  const isMobile = useIsMobile();   // 📱 การ์ดต่อพาร์ท + ปุ่มบันทึกเกาะล่าง (15/10)
  const { fullName, section: homeSection, sections: mySections, allUnits, respCostCenters, scopeIdx } = useContext(UserContext);
  /* 🔐 ขอบเขต "ที่แก้ได้" (คนละตัวกับ `scope` ที่เป็นขอบเขต "ที่เห็น") — ชุดเดียวกับ `StockTab` ในหน้าแม่
     QC audit 20/10: แท็บนี้มีด่านแค่ที่ dropdown ⇒ `?` เปิดตรง/สลับไลน์แล้วกดบันทึกได้ข้ามส่วนงาน */
  const wctx = useMemo(() => ({ role, section: homeSection, sections: mySections, allUnits, respCostCenters, scopeIdx }),
    [role, homeSection, mySections, allUnits, respCostCenters, scopeIdx]);
  const canCount   = can('line_stock', 'issue', role);
  const canApprove = can('line_stock', 'approve', role);

  const [loading, setLoading] = useState(true);
  const [stock,   setStock]   = useState([]);   // line_stock_summary
  const [adjusts, setAdjusts] = useState([]);   // adjust ที่อนุมัติแล้ว (หาเส้นรอบนับล่าสุด)
  const [shipped, setShipped] = useState([]);   // customer_shipping_orders status='shipped'
  const [cutIds,  setCutIds]  = useState(() => new Set());
  const [pnIndex, setPnIndex] = useState(() => new Map());
  const [fgDest,  setFgDest]  = useState('');   // คลังปลายทางของ FG จากกฎรับเข้า (ไม่ hardcode ชื่อคลัง)
  const [lines,   setLines]   = useState([]);   // production_lines (Main) — ให้ <LineSelect> กรอง scope ได้
  const [levels,  setLevels]  = useState([]);   // line_part_levels — พาร์ทที่ทะเบียนบอกว่าต้องมีที่ไลน์นั้น
  /* ⏳ ใบปรับยอดที่ยังรออนุมัติ — ไม่อยู่ใน qty_on_hand ⇒ ถ้าไม่กัน คนที่ 2 จะนับซ้ำแล้วหักซ้ำ */
  const [pendAdj, setPendAdj] = useState([]);
  /* 🔴 โหลดไม่สำเร็จ ≠ ไม่มีงานต้องนับ — แผงรอบนับต้องบอกว่าอ่านไม่ได้ ห้ามโชว์ 0 (db-write-rules ข้อ 12) */
  const [loadFail, setLoadFail] = useState('');

  const [lineFilter, setLineFilter] = useState('');
  const [counts,  setCounts]  = useState({});   // mat_no → ยอดที่นับได้ (string)
  const [note,    setNote]    = useState('');
  const [workDate, setWorkDate] = useState(getWorkDate());
  const [hideZero, setHideZero] = useState(false);
  const [approveNow, setApproveNow] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [cutting, setCutting] = useState(false);
  const [showGap,  setShowGap]  = useState(false);   // worklist ยาวได้เป็นร้อยแถว — พับไว้ก่อน
  /* แผงรอบนับ: `null` = ออโต้ — **ยังไม่เลือกไลน์ = กาง** (เป็นทางเข้างาน) · **เลือกแล้ว = พับ**
     (กฎลำดับแผงของหน้านี้: ห้ามดันตารางนับซึ่งเป็นงานหลักตกจอ) · กดทับได้ แล้วออโต้ไม่ทับซ้ำ */
  const [showRound, setShowRound] = useState(null);
  /* 📝 ร่างในเครื่อง + ตัวเลขไม่ข้ามไลน์ (มือถือ · 22/10 · audit handheld ข้อ 4)
     เดิม `counts` ผูกด้วย mat_no อย่างเดียว ⇒ นับไลน์ A แล้วสลับไป B ตัวเลขของ MAT เดียวกันโผล่ในการ์ดไลน์ B
     (มือถือเลื่อนการ์ดยาว มองไม่เห็นว่ามีค่าค้าง) · มือถือ: สลับไลน์ = ล้างช่อง + เก็บร่างของไลน์เดิมไว้ กลับมากู้คืนได้
     จอคอมพฤติกรรมเดิม (เห็นตัวเลขในตารางอยู่แล้ว) */
  const [pendingDraft, setPendingDraft] = useState(null);
  const scKey = (ln) => (ln ? `stock:${ln}:${fullName || ''}` : null);
  const scDraftKey = isMobile ? scKey(lineFilter) : null;
  const scHasInput = (c, n) => Object.values(c || {}).some(v => String(v ?? '').trim() !== '') || !!String(n || '').trim();
  useDraftAutosave(scDraftKey, { counts, note }, !!scDraftKey && !pendingDraft && scHasInput(counts, note));
  const changeLine = (v) => {
    if (isMobile && v !== lineFilter) {
      setCounts({}); setNote('');
      const d = loadDraft(scKey(v));
      setPendingDraft(d && scHasInput(d.data?.counts, d.data?.note) ? d : null);
    }
    setLineFilter(v);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [sum, adj, sh, cut, dp, ks, rules, pl, lv, pa] = await Promise.all([
      fetchAllPages(() => supabaseDR.from('line_stock_summary').select('line_name, mat_no, part_name, qty_on_hand'),
        { orderBy: ['line_name', 'mat_no'] }),
      /* ⚠️ ต้องมี note + qty ด้วย — แผงรอบนับต้องแยก "ตรวจนับของจริง" ออกจาก "ตั้งยอดตามไฟล์"
         (ชื่อคอลัมน์เท่าที่ใช้จริง · egress คิดเป็นไบต์ — db-write-rules ข้อ 11) */
      fetchAllPages(() => supabaseDR.from('line_stock_transactions')
        .select('line_name, mat_no, type, status, created_at, note, qty').eq('type', 'adjust').eq('status', 'approved'),
        { orderBy: 'created_at' }),
      fetchAllPages(() => supabaseDR.from('customer_shipping_orders')
        .select('id, order_no, customer, mat_no, part_name, qty, due_date, ship_time, shipped_at, shipped_by')
        .eq('status', 'shipped'), { orderBy: 'id' }),
      fetchAllPages(() => supabaseDR.from('line_stock_transactions')
        .select('ref_shipment_id').not('ref_shipment_id', 'is', null), { orderBy: 'ref_shipment_id' }),
      supabaseDR.from('dr_products').select('mat_no, p_no').not('p_no', 'is', null).eq('is_active', true),
      supabaseDR.from('kanban_standards').select('mat_no, p_no').not('p_no', 'is', null).eq('is_active', true),
      supabaseDR.from('stock_inflow_rules').select('match_value, dest_line_name, match_type').eq('is_active', true),
      // ⚠️ production_lines อยู่ Main project — ไม่ใช่ DR (ดู CLAUDE.md "Supabase Projects")
      //    ต้องมี section + is_active ไม่งั้น LineSelect กรอง scope ไม่ได้ / ไลน์ปลดระวางโผล่ปน
      loadLinesRes(),
      supabaseDR.from('line_part_levels').select('line_name, mat_no, is_active'),
      supabaseDR.from('line_stock_transactions')
        .select('line_name, mat_no, qty, type, status, created_at, created_by, note')
        .eq('type', 'adjust').eq('status', 'pending'),
    ]);
    setLoading(false);
    // ห้ามกลืน error — คิวรีล้มแล้วจอขึ้นเหมือน "ไม่มีข้อมูล" คือคลาสบั๊กที่โปรเจคเจอซ้ำ
    const firstErr = sum.error || adj.error || sh.error || cut.error || dp.error || ks.error || rules.error || pl.error || lv.error || pa.error;
    if (firstErr) { setLoadFail(String(firstErr)); toast.error((tr('โหลดข้อมูลสต็อกไม่สำเร็จ') + ': ') + firstErr); return; }
    setLoadFail('');
    setStock(sum.rows);
    setLines(pl.data || []);
    setLevels((lv.data || []).filter(l => l.is_active !== false));
    setPendAdj(pa.data || []);
    setAdjusts(adj.rows);
    setShipped(sh.rows);
    setCutIds(new Set(cut.rows.map(r => r.ref_shipment_id)));
    setPnIndex(buildPnIndex([...(dp.data || []), ...(ks.data || [])]));
    // FG = ปลายทางของกฎที่ match เลขขึ้นต้น 1 (นิยามเดียวกับ matPrefix/isFgMat) — data-driven
    const fg = (rules.data || []).find(r => r.match_type === 'prefix' && String(r.match_value) === '1');
    setFgDest(fg?.dest_line_name || '');
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasStockOf = useCallback(
    (m) => stock.some(s => s.mat_no === m && (parseFloat(s.qty_on_hand) || 0) !== 0),
    [stock]);

  /* ── 🚚 ใบที่ส่งแล้วแต่ยังไม่ถูกหัก ─────────────────────────────────────── */
  const shipGap = useMemo(() => {
    if (!fgDest) return { open: [], closedByCount: [], unresolved: [] };
    const counted = lastCountAt(adjusts);
    return pendingShipCuts({
      orders: shipped, cutIds, counted, fgLine: fgDest,
      sapOf: (m) => pickStockMat(m, pnIndex, hasStockOf).mat,
    });
  }, [shipped, cutIds, adjusts, fgDest, pnIndex, hasStockOf]);

  const openQty = useMemo(() => shipGap.open.reduce((s, o) => s + (Number(o.qty) || 0), 0), [shipGap]);

  const postMissingCuts = async () => {
    if (!shipGap.open.length) return;
    /* 🔴 หักสต็อกย้อนหลังที่คลัง FG = เขียนของหน่วยงานนั้น ⇒ เช็คชั้น ③ ในฟังก์ชันที่เขียนจริง */
    const wf = canWriteLine(wctx, fgDest, lines);
    if (!wf.ok) { toast.error(writeBlockText(wf, { what: `${tr("ยอดคลัง")} ${fgDest}` })); return; }
    // แถวที่หักแล้วจะทำให้คงเหลือติดลบ = "ของออกไปแล้วแต่ไม่เคยถูกบันทึกรับเข้า" — ต้องบอกก่อน ห้ามเงียบ
    const onHand = {};
    stock.forEach(s => { if (s.line_name === fgDest) onHand[s.mat_no] = parseFloat(s.qty_on_hand) || 0; });
    const after = { ...onHand };
    shipGap.open.forEach(o => { after[o.sap] = (after[o.sap] ?? 0) - (Number(o.qty) || 0); });
    const neg = Object.entries(after).filter(([, v]) => v < 0);
    const warn = neg.length
      ? `\n\n⚠️ ${tr("หลังหักจะมี")} ${neg.length} ${tr("พาร์ทคงเหลือติดลบ — แปลว่าของออกไปแล้วแต่ \"ขาเข้า\" ไม่เคยถูกบันทึก")}`
        + `\n(${tr("ติดลบคือสัญญาณให้ไปแก้ที่การปิดใบผลิต/กฎรับเข้า แล้วเคลียร์ด้วยการตรวจนับข้างล่าง")})`
      : '';
    if (!await askConfirm(
      `${tr("หักสต็อกย้อนหลัง")} ${shipGap.open.length} ${tr("ใบ รวม")} ${n0(openQty)} ${tr("ชิ้น ออกจาก")} ${fgDest}?`
      + `\n(${tr("ใบที่ส่งก่อนรอบตรวจนับล่าสุดถูกกันออกแล้ว")} ${shipGap.closedByCount.length} ${tr("ใบ — ยอดที่นับสะท้อนไปแล้ว")})`
      + warn)) return;
    setCutting(true);
    const rows = shipGap.open.map(o => ({
      line_name: fgDest, mat_no: o.sap, part_name: o.part_name || null,
      qty: Number(o.qty) || 0, type: 'consume', status: 'approved', work_date: workDate,
      note: `${tr("กระทบยอดย้อนหลัง: ส่งลูกค้า")} ${o.customer || ''} · ${o.due_date || ''} ${o.ship_time || ''}`
            + `${o.order_no ? ` · PO ${o.order_no}` : ''}`,
      created_by: fullName || null,
      ref_shipment_id: o.id,
    }));
    let ok = true;
    for (let i = 0; i < rows.length && ok; i += 300) {
      ok = checkWrite(await supabaseDR.from('line_stock_transactions').insert(rows.slice(i, i + 300)),
        'หักสต็อกย้อนหลัง');
    }
    setCutting(false);
    if (ok) { toast.success(`✅ ${tr("หักแล้ว")} ${rows.length} ${tr("ใบ")} · ${n0(openQty)} ${tr("ชิ้น")}`); load(); }
  };

  /* ── 📋 ตารางตรวจนับ ────────────────────────────────────────────────────── */
  // คลังที่ไม่ใช่ไลน์ผลิต — derive จากของที่มีจริง ไม่ hardcode ชื่อคลัง (pattern เดียวกับแท็บ 📦 Stock)
  const warehouseNames = useMemo(
    /* รวมชื่อจากทะเบียน min/max ด้วย — ไลน์/คลังที่ทะเบียนตั้งไว้แต่ยังไม่มีรายการสต็อกเลย
       ต้องเลือกได้ในช่องนี้ ไม่งั้นแผงรอบนับชี้ไปแล้วใบนับเปิดไม่ได้ */
    () => [...new Set([...stock.map(s => s.line_name), ...levels.map(l => l.line_name)])]
      .filter(n => n && !lines.some(l => l.name === n)).sort(lineNameCompare),
    [stock, levels, lines]);
  const rows = useMemo(() => {
    let r = lineFilter ? stock.filter(s => s.line_name === lineFilter) : [];
    /* 🔴 พาร์ทที่ทะเบียน min/max ตั้งไว้ที่ไลน์นี้ แต่ยังไม่เคยมีรายการ = ของควรอยู่ที่นี่
       แต่ก่อนหน้านี้ไม่มีช่องให้กรอกเลย (ตารางสร้างจากแถวในคลังล้วน) ⇒ ไปยืนนับเจอของ
       แล้วกลับมาบันทึกไม่ได้ **เงียบ** — เติมเข้ามาเป็นยอดระบบ 0 (ยังไม่มี txn = 0 จริง) */
    if (lineFilter) {
      const have = new Set(r.map(x => String(x.mat_no)));
      levels.forEach(l => {
        if (String(l.line_name ?? '').trim() !== lineFilter) return;
        const mat = String(l.mat_no ?? '');
        if (!mat || have.has(mat)) return;
        have.add(mat);
        r = [...r, { line_name: lineFilter, mat_no: mat, part_name: null, qty_on_hand: 0, fromLevels: true }];
      });
    }
    if (hideZero) r = r.filter(s => (parseFloat(s.qty_on_hand) || 0) !== 0);
    return [...r].sort((a, b) => String(a.mat_no).localeCompare(String(b.mat_no)));
  }, [stock, lineFilter, hideZero, levels]);

  /* ── 🧭 ขั้น ② ของแผน min/max — รอบนับตั้งต้น (25/11 · คำสั่ง user "ลุยขั้น ② ต่อ นับที่ไลน์ปลายทาง")
     ตัวเลขทุกตัวออกจาก `countRoundRows()` (utils/stockCount.js) — **ห้ามนับเองในหน้า**
     🔴 แผงนี้ตอบ "ไลน์ไหนยังไม่ได้นับ" ด้วย **การนับของจริงเท่านั้น** ("ตั้งยอดให้ตรงไฟล์" ไม่ใช่การนับ) */
  const roundAll = useMemo(() => countRoundRows({ stock, txns: adjusts, levels }), [stock, adjusts, levels]);
  const roundRows = useMemo(() => {
    if (!roundAll) return null;
    /* ขอบเขต "ที่เห็น" ชุดเดียวกับ <LineSelect> · คลัง (ไม่อยู่ในทะเบียนไลน์) เห็นได้เสมอ */
    const ok = new Set(scopeLines(lines, scope).map(l => l.name));
    const known = new Set(lines.map(l => l.name));
    return roundAll.filter(r => !known.has(r.line_name) || ok.has(r.line_name));
  }, [roundAll, lines, scope]);
  const roundHidden = (roundAll?.length || 0) - (roundRows?.length || 0);
  const roundTotals = useMemo(() => {
    if (!roundRows) return null;
    return roundRows.reduce((a, r) => ({
      lines: a.lines + 1,
      none:  a.none + (r.status === 'none' ? 1 : 0),
      done:  a.done + (r.status === 'done' ? 1 : 0),
      negParts: a.negParts + r.negParts,
      negQty:   a.negQty + r.negQty,
      drift:    a.drift + r.driftAfter,
      noRow:    a.noRow + r.noRowParts,
    }), { lines: 0, none: 0, done: 0, negParts: 0, negQty: 0, drift: 0, noRow: 0 });
  }, [roundRows]);

  /* ⏳ map ใบค้าง — ของกลางคิดให้ (utils/stockCount.js) ห้ามไล่หาเองในหน้า */
  const pendMap = useMemo(() => pendingAdjustMap(pendAdj), [pendAdj]);
  const pendHereCount = useMemo(
    () => (lineFilter ? rows.filter(r => pendMap[pendingKey(lineFilter, r.mat_no)]).length : 0),
    [rows, pendMap, lineFilter]);

  const summary = useMemo(() => countSummary({ rows, counts }), [rows, counts]);

  const save = async () => {
    /* 🔴 ผลตรวจนับเขียน `line_stock_transactions` ของไลน์/คลังที่เลือก (และ `approved` ทันทีถ้ามีสิทธิ์)
       ⇒ ด่านชั้น ③ ต้องอยู่ตรงนี้ ไม่ใช่แค่กรองรายการใน `<LineSelect>` */
    const w = canWriteLine(wctx, lineFilter, lines);
    if (!w.ok) { toast.error(writeBlockText(w, { what: `${tr("ยอดคลังของ")} ${lineFilter || tr('ไลน์นี้')}` })); return; }
    const all = toAdjustTxns({ rows, lineName: lineFilter, workDate, by: fullName, note, counts });
    /* 🔴 กันนับซ้ำ: คู่ที่มีใบปรับยอดค้างอยู่ ยอดในจอยังไม่รวมใบนั้น ⇒ ผลต่างที่คิดได้จะซ้ำกับใบเดิม
       (view line_stock_summary = where status='approved') · ห้ามทิ้งเงียบ ต้องบอกว่ากันไว้กี่พาร์ท */
    const { ok: txns, blocked } = splitPendingBlocked(all, pendMap);
    if (blocked.length) {
      toast.error(`⏳ ${tr('กันไว้')} ${blocked.length} ${tr('พาร์ทที่มีใบปรับยอดค้างรออนุมัติ')} — `
        + `${tr('ยอดในจอยังไม่รวมใบนั้น นับซ้ำจะหักซ้ำ')} · ${tr('ให้อนุมัติ/ตีกลับใบเดิมที่แท็บ')} 📦 Stock ${tr('ก่อน')}`);
    }
    if (!txns.length) { toast.info(blocked.length ? 'ไม่มีแถวที่บันทึกได้ในรอบนี้' : 'ยังไม่มีแถวที่ยอดต่างจากระบบ'); return; }
    const approved = approveNow && canApprove;
    if (!await askConfirm(
      `${tr("บันทึกผลตรวจนับ")} ${txns.length} ${tr("รายการที่")} ${lineFilter}?`
      + `\n📈 ${tr("เพิ่ม")} ${summary.up} ${tr("พาร์ท")} (${n0(summary.upQty)} ${tr("ชิ้น) · ลด")} ${summary.down} ${tr("พาร์ท")} (${n0(summary.downQty)} ${tr("ชิ้น")})`
      + (approved ? '\n\n✅ มีผลกับยอดคงเหลือทันที (คุณมีสิทธิ์อนุมัติ)' : '\n\n⏳ เข้าคิวรออนุมัติจากสโตร์ก่อนมีผล'))) return;
    setSaving(true);
    let ok = true;
    const withStatus = txns.map(t => ({ ...t, status: approved ? 'approved' : 'pending' }));
    for (let i = 0; i < withStatus.length && ok; i += 300) {
      ok = checkWrite(await supabaseDR.from('line_stock_transactions').insert(withStatus.slice(i, i + 300)),
        'บันทึกผลตรวจนับ');
    }
    setSaving(false);
    if (!ok) return;
    toast[approved ? 'success' : 'info'](approved
      ? `✅ ${tr("เฟิร์มยอดแล้ว")} ${txns.length} ${tr("รายการ")}`
      : `⏳ ${tr("ส่งผลตรวจนับ")} ${txns.length} ${tr("รายการ — รอสโตร์อนุมัติที่แท็บ")} 📦 Stock`);
    setCounts({}); setNote('');
    if (scDraftKey) clearDraft(scDraftKey);
    load();
  };

  if (loading) return <div style={{ ...card, textAlign:'center', color:'var(--muted)' }}>{tr('กำลังโหลด…')}</div>;

  const roundOpen = showRound === null ? !lineFilter : showRound;
  const ST = {
    none:    { label: 'ยังไม่เคยนับ', color: 'var(--red)' },
    partial: { label: 'นับบางส่วน',   color: 'var(--amber)' },
    done:    { label: 'นับครบแล้ว',   color: 'var(--green)' },
  };

  return (
    <div style={{ display:'grid', gap:16, alignContent:'start' }}>

      {/* ── 🧭 รอบนับตั้งต้น (ขั้น ② ของแผน min/max) ────────────────────────────
          พับเป็นค่าเริ่มต้น — ห้ามดันตารางนับ (งานหลัก) ตกจอ (กฎลำดับแผงของหน้านี้) */}
      <div style={card}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:15, fontWeight:800 }}>🧭 {tr('รอบนับตั้งต้น — นับที่ไลน์ปลายทาง')}</div>
          {!!roundRows?.length && (
            <button type="button" onClick={() => setShowRound(!roundOpen)} style={btn('var(--bg3)', 'var(--text)')}>
              {roundOpen ? tr('ซ่อนรายไลน์') : `${tr('ดูรายไลน์')} (${roundRows.length})`}
            </button>
          )}
        </div>

        {loadFail ? (
          <NoticeBar tone="bad" style={{ marginTop:10 }}>
            <b>{tr('อ่านข้อมูลสต็อกไม่ได้')}</b> · {tr('ยังบอกไม่ได้ว่าไลน์ไหนนับแล้ว — ลองโหลดหน้าใหม่')}
          </NoticeBar>
        ) : !roundRows ? (
          <NoticeBar tone="warn" style={{ marginTop:10 }}>
            <b>{tr('ยังอ่านประวัติการนับไม่ได้')}</b> · {tr('ตัวเลขรอบนับจึงยังบอกไม่ได้')}
          </NoticeBar>
        ) : !roundRows.length ? (
          <div style={{ fontSize:13, color:'var(--muted)', marginTop:8 }}>{tr('ยังไม่มีไลน์/คลังที่มีรายการสต็อก')}</div>
        ) : (
          <>
            <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.7, marginTop:8 }}>
              {tr('ยังไม่เคยนับ')} <b style={{ color:'var(--red)' }}>{roundTotals.none}</b> {tr('ไลน์')}
              {' · '}{tr('นับครบแล้ว')} <b style={{ color:'var(--green)' }}>{roundTotals.done}</b> {tr('ไลน์')}
              {' · '}{tr('ยอดติดลบ')} <b>{n0(roundTotals.negParts)}</b> {tr('พาร์ท')} ({n0(roundTotals.negQty)} {tr('ชิ้น')})
              <div>
                🔴 {tr('"นับล่าสุด" นับเฉพาะการไปนับของจริง — การตั้งยอดตามไฟล์ Monitoring ไม่ใช่การนับ')}
              </div>
            </div>
            {roundTotals.drift > 0 && (
              <NoticeBar tone="warn" style={{ marginTop:10 }}>
                <b>{tr('หลังนับแล้วยังมีการปรับยอดอีก')} {n0(roundTotals.drift)} {tr('ชิ้น')}</b>
                {' · '}{tr('ถ้าเลขนี้โตเรื่อยๆ ปัญหาอยู่ที่การบันทึกรับ-จ่าย ไม่ใช่ที่การนับ')}
              </NoticeBar>
            )}
            {roundTotals.noRow > 0 && (
              <NoticeBar tone="info" style={{ marginTop:10 }}>
                <b>{n0(roundTotals.noRow)} {tr('พาร์ทที่ทะเบียนตั้งไว้ แต่ยังไม่เคยมีรายการ')}</b>
                {' · '}{tr('เติมเข้าใบนับให้แล้ว (ยอดระบบ = 0)')}
              </NoticeBar>
            )}
            {roundHidden > 0 && (
              <div style={{ fontSize:12, color:'var(--muted)', marginTop:8 }}>
                🔒 {tr('ซ่อน')} {roundHidden} {tr('ไลน์ที่อยู่นอกขอบเขตของคุณ')}
              </div>
            )}

            {roundOpen && (
              <div style={{ overflowX:'auto', maxHeight:'48vh', overflowY:'auto', marginTop:10 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', minWidth:620 }}>
                  <thead><tr>
                    {[tr('ไลน์/คลัง'), tr('ต้องนับ'), tr('ติดลบ'), tr('นับล่าสุด'), tr('ปรับยอดหลังนับ'), tr('สถานะ')].map((h, i) => (
                      <th key={h} style={{ ...th, position:'sticky', top:0, background:'var(--card)', zIndex:1,
                        textAlign: i === 0 ? 'left' : i === 5 ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {roundRows.map(r => {
                      const st = ST[r.status] || ST.none;
                      return (
                        <tr key={r.line_name} onClick={() => changeLine(r.line_name)}
                          title={tr('กดเพื่อเลือกไลน์นี้ในใบนับข้างล่าง')}
                          style={{ cursor:'pointer', background: r.line_name === lineFilter ? 'var(--accent-dim)' : undefined }}>
                          <td style={{ ...td, fontWeight: r.line_name === lineFilter ? 800 : 600 }}>{r.line_name}</td>
                          <td style={{ ...td, textAlign:'right' }}>{n0(r.parts)}</td>
                          <td style={{ ...td, textAlign:'right', color: r.negParts ? 'var(--red)' : 'var(--muted)' }}>
                            {r.negParts ? `${n0(r.negParts)} (${n0(r.negQty)})` : '—'}
                          </td>
                          <td style={{ ...td, textAlign:'right', color:'var(--muted)' }}>
                            {r.lastAt ? String(r.lastAt).slice(0, 10) : '—'}
                          </td>
                          <td style={{ ...td, textAlign:'right', color: r.driftAfter ? 'var(--amber)' : 'var(--muted)' }}>
                            {r.driftAfter ? n0(r.driftAfter) : '—'}
                          </td>
                          <td style={{ ...td }}>
                            <span style={{ fontSize:11, fontWeight:700, color: st.color }}>{tr(st.label)}</span>
                            {r.never > 0 && r.status === 'partial' && (
                              <span style={{ fontSize:11, color:'var(--muted)' }}> · {tr('เหลือ')} {n0(r.never)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 📋 ตรวจนับ / เฟิร์มยอด ─────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize:15, fontWeight:800, marginBottom:6 }}>{tr('ตรวจนับ / เฟิร์มยอด')}</div>
        <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.65, marginBottom:12 }}>
          {tr("กรอก")} <b>{tr('ยอดที่นับได้จริง')}</b> ({tr("ไม่ใช่ผลต่าง) ระบบคิดส่วนต่างให้เอง แล้วบันทึกเป็นรายการ 🔧 ปรับยอดทีเดียวทั้งคลัง · เว้นว่าง = ยังไม่นับ ไม่แตะยอดเดิม · กรอก 0 = นับแล้วไม่มีของ")}
        </div>

        <DraftRestoreBar draft={pendingDraft} what={`${tr("ใบนับ")} ${lineFilter}`}
          onRestore={() => { setCounts(pendingDraft.data?.counts || {}); setNote(pendingDraft.data?.note || ''); setPendingDraft(null); }}
          onDiscard={() => { if (scDraftKey) clearDraft(scDraftKey); setPendingDraft(null); }} />
        <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'center', marginBottom:12 }}>
          <LineSelect
            lines={lines} value={lineFilter} onChange={changeLine} {...scope}
            placeholder={tr('— เลือกไลน์/คลังที่จะนับ —')}
            style={{ width: isMobile ? '100%' : 260, padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background: 'var(--bg2-surf)', color:'var(--text)', fontSize: isMobile ? 16 : 13 }}
            extraGroups={[{ label: tr("คลัง"), options: warehouseNames.map(n => ({ value: n })) }]}
          />
          <label style={{ fontSize:12, color:'var(--muted)' }}>
            {tr('วันที่นับ')}{' '}
            <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)}
              style={{ width:150, padding:'6px 8px', borderRadius: 'var(--ctl-r)', border:'1px solid var(--border)', background: 'var(--bg2-surf)', color:'var(--text)', fontSize:13 }} />
          </label>
          <label style={{ fontSize:12, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
            <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} style={{ width:'auto' }} />
            {tr('ซ่อนพาร์ทที่ยอดเป็น 0')}
          </label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={tr('หมายเหตุรอบนับ (ไม่บังคับ)')}
            style={{ width: isMobile ? '100%' : 220, padding:'6px 8px', borderRadius: 'var(--ctl-r)', border:'1px solid var(--border)', background: 'var(--bg2-surf)', color:'var(--text)', fontSize:13 }} />
        </div>

        {pendHereCount > 0 && (
          <NoticeBar tone="warn" style={{ marginBottom:12 }}>
            <b>{n0(pendHereCount)} {tr('พาร์ทมีใบปรับยอดค้างรออนุมัติ')}</b>
            {' · '}{tr('ยอดในจอยังไม่รวมใบนั้น — กรอกไม่ได้จนกว่าจะอนุมัติ/ตีกลับที่แท็บ')} 📦 Stock
          </NoticeBar>
        )}
        {!lineFilter ? (
          <div style={{ fontSize:13, color:'var(--muted)' }}>{tr('เลือกไลน์/คลังก่อน แล้วรายการพาร์ทจะขึ้นให้กรอก')}</div>
        ) : !rows.length ? (
          <div style={{ fontSize:13, color:'var(--muted)' }}>{tr('ไม่มีพาร์ทในคลังนี้')}{hideZero && ' (ที่ยอดไม่เป็น 0)'}</div>
        ) : (
          <>
            {/* 📱 มือถือ (15/10 · MOBILE-UX-STANDARD §4 ชนิด A): การ์ดต่อพาร์ท — ตารางกว้าง 620px ในกล่องที่ไม่มี minWidth:0
                ดันการ์ดเกินจอแล้วโดนตัด ⇒ **คอลัมน์ "นับได้จริง" มองไม่เห็นเลย** บน 360px (วัดจริง) + กล่องเลื่อน 60vh ซ้อนในหน้า
                ช่องกรอก/ค่าที่คิด = ตัวเดียวกับตาราง (counts · countDelta) ตรรกะไม่แตก 2 ชุด */}
            {isMobile ? (
              <div className="sc-cards">
                {rows.map(r => {
                  const d = countDelta(r.qty_on_hand, counts[r.mat_no]);
                  const typed = counts[r.mat_no] !== undefined && counts[r.mat_no] !== '';
                  const pend = pendMap[pendingKey(lineFilter, r.mat_no)];
                  return (
                    <div key={r.mat_no} className={`sc-card${typed ? ' sc-typed' : ''}`}>
                      <MatLabel mat={r.mat_no} name={r.part_name} />
                      {r.fromLevels && <div style={{ fontSize:11, color:'var(--muted)' }}>🆕 {tr('ทะเบียนตั้งไว้ที่ไลน์นี้ · ยังไม่เคยมีรายการ')}</div>}
                      {pend && <div style={{ fontSize:11, color:'var(--amber)', fontWeight:700 }}>
                        ⏳ {tr('มีใบค้างรออนุมัติ')} {pend.qty > 0 ? '+' : ''}{n0(pend.qty)}{pend.by ? ` · ${pend.by}` : ''}</div>}
                      <div className="sc-row">
                        <div className="sc-sys"><span>{tr('ในระบบ')}</span><b>{n0(r.qty_on_hand)}</b></div>
                        <input type="number" inputMode="numeric" min="0" disabled={!!pend}
                          placeholder={pend ? tr('รออนุมัติ') : tr('นับได้')} aria-label={`${tr("นับได้จริง")} ${r.mat_no}`}
                          value={counts[r.mat_no] ?? ''}
                          onChange={e => setCounts(c => ({ ...c, [r.mat_no]: e.target.value }))} />
                        <div className="sc-diff" style={{ color: !d ? (typed ? 'var(--accent)' : 'var(--muted)') : d.dir === 'up' ? '#22c55e' : '#ef4444' }}>
                          {!d ? (typed ? tr("ตรง") : '—') : `${d.delta > 0 ? '+' : ''}${n0(d.delta)}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
            <div style={{ overflowX:'auto', maxHeight:'60vh', overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth:620 }}>
                <thead><tr>
                  {/* ยุบ "ชื่อชิ้นงาน + MAT" เป็นคอลัมน์เดียว — <MatLabel> ให้ครบ Part No./ชื่อ/MAT ในที่เท่าเดิม (30/09) */}
                  <th style={{ ...th, position:'sticky', top:0, background:'var(--card)', zIndex:1 }}>{tr('ชิ้นงาน')}</th>
                  <th style={{ ...th, position:'sticky', top:0, background:'var(--card)', zIndex:1, textAlign:'right' }}>{tr('ยอดในระบบ')}</th>
                  <th style={{ ...th, position:'sticky', top:0, background:'var(--card)', zIndex:1, textAlign:'right' }}>{tr('นับได้จริง')}</th>
                  <th style={{ ...th, position:'sticky', top:0, background:'var(--card)', zIndex:1, textAlign:'right' }}>{tr('ผลต่าง')}</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => {
                    const d = countDelta(r.qty_on_hand, counts[r.mat_no]);
                    const typed = counts[r.mat_no] !== undefined && counts[r.mat_no] !== '';
                    const pend = pendMap[pendingKey(lineFilter, r.mat_no)];
                    return (
                      <tr key={r.mat_no}>
                        <td style={{ ...td, maxWidth:320 }}>
                          <MatLabel mat={r.mat_no} name={r.part_name} />
                          {r.fromLevels && <div style={{ fontSize:11, color:'var(--muted)' }}>🆕 {tr('ทะเบียนตั้งไว้ที่ไลน์นี้ · ยังไม่เคยมีรายการ')}</div>}
                          {pend && <div style={{ fontSize:11, color:'var(--amber)', fontWeight:700 }}>
                            ⏳ {tr('มีใบค้างรออนุมัติ')} {pend.qty > 0 ? '+' : ''}{n0(pend.qty)}{pend.by ? ` · ${pend.by}` : ''}
                            {' · '}{tr('กรอกไม่ได้จนกว่าจะอนุมัติ/ตีกลับ')}</div>}
                        </td>
                        <td style={{ ...td, textAlign:'right' }}>{n0(r.qty_on_hand)}</td>
                        <td style={{ ...td, textAlign:'right' }}>
                          <input type="number" inputMode="numeric" min="0" style={numIn} disabled={!!pend}
                            title={pend ? tr('มีใบปรับยอดค้างรออนุมัติ — ยอดในจอยังไม่รวมใบนั้น') : undefined}
                            value={counts[r.mat_no] ?? ''}
                            onChange={e => setCounts(c => ({ ...c, [r.mat_no]: e.target.value }))} />
                        </td>
                        <td style={{ ...td, textAlign:'right', fontWeight:800,
                          color: !d ? (typed ? 'var(--accent)' : 'var(--muted)') : d.dir === 'up' ? '#22c55e' : '#ef4444' }}>
                          {!d ? (typed ? tr("ตรง") : '—') : `${d.delta > 0 ? '+' : ''}${n0(d.delta)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}

            {/* 🧹 ตัวช่วยกรอก — ตรวจนับทั้งคลังทีละแถวไม่ไหว (154 แถวตอนตั้งต้นใหม่ 01/10)
                🔴 ปุ่มนี้แค่ "เติมค่าในช่อง" ไม่ได้บันทึกเอง — ยังต้องกดบันทึก + ผ่านคิวอนุมัติเหมือนเดิม
                   (ของที่ล้างยอดได้ในคลิกเดียวโดยไม่มีใครยืนยัน = ยอดหายเงียบ) */}
            {canCount && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center', marginTop:12,
                background: 'var(--bg2-surf)', border:'1px solid var(--border)', borderRadius: 'var(--r-md)', padding:'8px 10px' }}>
                <span style={{ fontSize:12, fontWeight:700, color:'var(--text2)' }}>{tr('ตัวช่วยกรอก')}</span>
                <button style={{ ...btn('var(--bg3)', 'var(--text)'), border:'1px solid var(--border2)', fontSize:12, padding:'6px 12px' }}
                  onClick={() => setCounts(c => {
                    const next = { ...c };
                    /* ข้ามแถวที่มีใบค้าง — ช่องถูกปิดอยู่ เติมไปก็ถูกกันตอนบันทึก (กันนับซ้ำ) */
                    rows.forEach(r => {
                      if (pendMap[pendingKey(lineFilter, r.mat_no)]) return;
                      if (next[r.mat_no] === undefined || next[r.mat_no] === '') next[r.mat_no] = '0';
                    });
                    return next;
                  })}>
                  {tr("เติม 0 ให้แถวที่ยังไม่กรอก")}
                </button>
                <button style={{ ...btn('var(--bg3)', 'var(--text)'), border:'1px solid var(--border2)', fontSize:12, padding:'6px 12px' }}
                  onClick={() => setCounts({})}>
                  {tr('ล้างที่กรอก')}
                </button>
                <span style={{ fontSize:11, color:'var(--muted)' }}>
                  {tr("ตั้งต้นคลังใหม่ = เติม 0 ทั้งหมด แล้วแก้เฉพาะแถวที่นับเจอของ — ยังต้องกดบันทึกเอง")}
                </span>
              </div>
            )}

            {/* 📱 มือถือ: แถวสรุป+ปุ่มบันทึก เกาะล่างจอ (ปุ่ม/handler เดียวกับจอคอม) */}
            <div className={isMobile ? 'm-savebar sc-savebar' : undefined}
              style={isMobile ? undefined : { display:'flex', flexWrap:'wrap', gap:12, alignItems:'center', marginTop:12 }}>
              <div style={{ fontSize:12, color:'var(--muted)' }}>
                {tr("นับแล้ว")} <b style={{ color:'var(--text)' }}>{summary.counted}</b>/{rows.length} {tr("พาร์ท · ตรง")} {summary.same} {tr('· เพิ่ม')} {summary.up} ({n0(summary.upQty)}) · {tr("ลด")} {summary.down} ({n0(summary.downQty)})
              </div>
              {canApprove && (
                <label style={{ fontSize:12, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                  <input type="checkbox" checked={approveNow} onChange={e => setApproveNow(e.target.checked)} style={{ width:'auto' }} />
                  {tr('อนุมัติเลย (มีผลกับยอดทันที)')}
                </label>
              )}
              {canCount ? (
                <button style={{ ...btn('var(--accent)'), opacity: saving || !summary.changed ? 0.5 : 1 }}
                  disabled={saving || !summary.changed} onClick={save}>
                  {saving ? tr("กำลังบันทึก…") : `💾 ${tr("บันทึกผลตรวจนับ")} (${summary.changed})`}
                </button>
              ) : (
                <span style={{ fontSize:12, color:'var(--muted)' }}>{tr('ดูอย่างเดียว — ต้องมีสิทธิ์ line_stock:issue จึงบันทึกได้')}</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── 🚚 ส่งแล้วแต่ยังไม่ถูกหัก (worklist — พับเก็บเป็นค่าเริ่มต้น) ──────
           🔴 รายการนี้ยาวได้เป็นร้อยแถว ถ้ากางทิ้งไว้จะดันงานหลักตกจอจนคนนึกว่า
              "หน้านี้มีแต่ตาราง" (feedback user 24/09) — ต้องพับ + จำกัดความสูงเสมอ */}
      <div style={card}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'center', marginBottom:8 }}>
          <div style={{ fontSize:15, fontWeight:800 }}>{tr('ส่งลูกค้าแล้ว แต่ยังไม่ถูกหักออกจากคลัง')}</div>
          {!!shipGap.open.length && (
            <span style={{ fontSize:12, fontWeight:800, background:'#ef444422', color: 'var(--red)', padding:'3px 10px', borderRadius: 'var(--r-pill)' }}>
              {shipGap.open.length} {tr('ใบ ·')} {n0(openQty)} {tr("ชิ้น")}
            </span>
          )}
          <div style={{ marginLeft:'auto', display:'flex', flexWrap:'wrap', gap:8 }}>
            {canCount && !!shipGap.open.length && (
              <button style={{ ...btn('#ef4444'), opacity: cutting ? 0.6 : 1 }} disabled={cutting} onClick={postMissingCuts}>
                {cutting ? tr("กำลังหัก…") : `🚚 ${tr("หักย้อนหลัง")} ${shipGap.open.length} ${tr("ใบ")} (${n0(openQty)} ${tr("ชิ้น")})`}
              </button>
            )}
            {!!(shipGap.open.length || shipGap.unresolved.length) && (
              <button style={btn('var(--bg3)', 'var(--text)')} onClick={() => setShowGap(v => !v)}>
                {showGap ? tr("▲ ซ่อนรายการ") : `▼ ${tr("ดูรายการ")} (${shipGap.open.length + shipGap.unresolved.length})`}
              </button>
            )}
          </div>
        </div>
        <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.65, marginBottom:10 }}>
          {tr("หน้า 🚚 Delivery หักสต็อกให้อัตโนมัติตอนกด “ส่งแล้ว” — ใบที่หักไม่ได้ (จับคู่เลข SAP ไม่ได้ หรือของไม่เคยถูกบันทึกเข้าคลัง) จะเตือนบนจอครั้งเดียวแล้วหายไป ยอดคงเหลือจึงค้างสูงกว่าจริง")}
          <br />
          🔴 {tr("ใบที่ส่ง")} <b>{tr('ก่อน')}</b> {tr("รอบตรวจนับล่าสุดของพาร์ทนั้นถูกกันออกแล้ว")}
          {shipGap.closedByCount.length > 0 && <> ({shipGap.closedByCount.length} {tr("ใบ")})</>} —
          {tr("ยอดที่นับได้สะท้อนของที่ออกไปแล้ว หักซ้ำจะทำให้ยอดหายสองเท่า")}
        </div>

        {!fgDest ? (
          <div style={{ fontSize:13, color: 'var(--amber)' }}>
            ⚠️ {tr("ยังไม่มีกฎรับเข้าอัตโนมัติของ FG (เลขขึ้นต้น 1) — ตั้งที่แท็บ ⚙️ รับเข้าอัตโนมัติ ก่อน ระบบจึงจะรู้ว่าต้องหักออกจากคลังไหน")}
          </div>
        ) : !shipGap.open.length && !shipGap.unresolved.length ? (
          <div style={{ fontSize:13, color:'var(--accent)' }}>{tr('✅ ไม่มีใบค้าง — ยอดขาออกตรงกับ ledger ทั้งหมด')}</div>
        ) : (
          <>
            {showGap && !!shipGap.open.length && (
              <div style={{ overflowX:'auto', overflowY:'auto', maxHeight:'42vh', marginBottom:10, border:'1px solid var(--border2)', borderRadius: 'var(--r-md)' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', minWidth:640 }}>
                  <thead><tr>
                    {[tr("วันส่ง"), tr("ลูกค้า"), 'MAT', tr("จำนวน"), tr("คงเหลือหลังหัก")].map((h, i) => (
                      <th key={h} style={{ ...th, position:'sticky', top:0, background:'var(--card)', zIndex:1,
                        textAlign: i >= 3 ? 'right' : 'left' }}>{tr(h)}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {shipGap.open.slice(0, 200).map(o => {
                      const cur = stock.find(s => s.line_name === fgDest && s.mat_no === o.sap);
                      const after = (parseFloat(cur?.qty_on_hand) || 0) - (Number(o.qty) || 0);
                      return (
                        <tr key={o.id}>
                          <td style={td}>{o.due_date} {o.ship_time?.slice(0, 5) || ''}</td>
                          <td style={td}>{o.customer || '—'}</td>
                          <td style={{ ...td, fontFamily:'monospace' }}>
                            {o.sap}
                            {o.sap !== o.mat_no && (
                              <span style={{ color:'var(--muted)', fontSize:11 }}> ← {o.mat_no}</span>
                            )}
                          </td>
                          <td style={{ ...td, textAlign:'right', fontWeight:700 }}>{n0(o.qty)}</td>
                          <td style={{ ...td, textAlign:'right', color: after < 0 ? '#ef4444' : 'var(--text2)' }}>{n0(after)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {shipGap.open.length > 200 && (
                  <div style={{ fontSize:12, color:'var(--muted)', padding:'6px 10px' }}>
                    …{tr("แสดง 200 จาก")} {shipGap.open.length} {tr("ใบ (ปุ่มหักทำครบทุกใบ")})
                  </div>
                )}
              </div>
            )}

            {showGap && !!shipGap.unresolved.length && (
              <div style={{ fontSize:12, color: 'var(--amber)', marginBottom:10, lineHeight:1.6 }}>
                ⚠️ {tr("อีก")} {shipGap.unresolved.length} {tr('ใบ (')}{n0(shipGap.unresolved.reduce((s, o) => s + (Number(o.qty) || 0), 0))} {tr("ชิ้น) จับคู่เลข SAP ไม่ได้ — ระบบไม่เดาให้ ต้องแก้ p_no ที่ Product Master ก่อน เช่น")}{' '}
                {shipGap.unresolved.slice(0, 3).map(o => o.mat_no).join(', ')}
                <div style={{ marginTop:2 }}>
                  {matIssueText(shipGap.unresolved[0].mat_no, pickStockMat(shipGap.unresolved[0].mat_no, pnIndex, hasStockOf)) || ''}
                </div>
              </div>
            )}

            {!canCount && !!shipGap.open.length && (
              <div style={{ fontSize:12, color:'var(--muted)' }}>{tr('ดูอย่างเดียว — ต้องมีสิทธิ์ line_stock:issue จึงหักย้อนหลังได้')}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
