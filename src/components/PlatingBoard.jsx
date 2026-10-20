import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { canSeeded } from '../utils/permissions';
import { getActor } from '../utils/actorStamp';
import { useLiveBoard } from '../utils/useLiveBoard';
import { fetchAllRows } from '../utils/fetchAllRows';
import { fetchByIds } from '../utils/fetchByIds';
import { storeBtn } from '../utils/storeUi';
import { inflowDestOf } from '../utils/partRefStock';
import { loadProductionLines } from '../utils/useProductionLines';
import { invalidateProducts } from '../utils/useProducts';
import usePartImages from '../utils/usePartImages';
import useSuppliers from '../utils/useSuppliers';
import ProductSelect from './ProductSelect';
import SupplierSelect from './SupplierSelect';
import PartCard, { partCardGrid } from './PartCard';
import StatusZones from './StatusZones';
import {
  platingProducts, platingRoutes, beforeCandidatesOf, autoBeforeOf, outstandingByVendor, toWhTargets,
  sendBlockReason, sendStockWarn, openQtyOf, receiveBlockReason, orderZone, OUTSOURCE_LINE_TYPE,
} from '../utils/plating';

/* ═══ 🧪 งานชุบภายนอก — แท็บในตู้ Kanban รวม (/heijunka) · 2026-10-13 คำสั่ง user

   ลำดับงานจริง (user 13/10 · ตัวอย่าง GOR 297):
     ผลิต (PD4) คอนเฟิร์มใบ → ของเข้าคิวรอรับ → สโตร์กดรับ → ยอด 2xx ก่อนชุบอยู่ใน STORE
     → 📤 สโตร์ "ส่งไปชุบ": เลือกงานหลังชุบ + ร้าน ใส่กี่รายการ/กี่ชิ้นก็ได้ → การ์ดเด้งไปรอรับกลับ
     → ⏳ มอนิเตอร์ยอดที่ร้าน (ส่งไปแล้วยังไม่กลับ)
     → 📥 งานกลับมา สโตร์นับแล้วกดรับต่อใบ — ไม่ครบใส่รายละเอียด (เหมือนคิวรอรับเข้าของผลิต)
       ร้านชุบไม่ยืนยันยอดเอง · ระบบเปลี่ยน 2xx ก่อนชุบ → 2xx หลังชุบให้ตอนรับ
     → 🏬 (ถ้า FG มีลูกตัวเดียว) ส่งเข้า W/H เป็นเบอร์ 1xx ตาม BOM · FG ที่ต้องประกอบ = ไหลตามไลน์
   กฎทั้งหมด = `utils/plating.js` · ทุกปุ่มเขียนผ่าน RPC `plating_*` (DR) ทรานแซกชันเดียว
   คลังต้นทาง/ปลายทาง = กฎรับเข้าคลัง (`inflowDestOf`) — ไม่มีกฎ = บอกบนจอ ไม่เดา */

const fmt = (n) => Number(n || 0).toLocaleString();
const PROD_COLS = 'id, mat_no, name, p_no, customer, line_name, is_active, is_operation, outsource_vendor';
const BOM_COLS = 'id, product_id, mat_no, part_name, qty_per_unit, uom, parent_mat, item_no, is_active';
const ORDER_COLS = 'id, vendor, vendor_loc, before_mat, after_mat, part_name, qty_sent, qty_received, qty_written_off, status, from_loc, doc_no, note, sent_at, sent_by_name, closed_at, closed_reason';

const box = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14 };
const h3 = { fontSize: 15, fontWeight: 800, margin: '0 0 8px', color: 'var(--text)' };
const muted = { fontSize: 12, color: 'var(--muted)' };
const inp = { minHeight: 40, padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13.5, fontFamily: 'var(--font-body)', boxSizing: 'border-box' };
const warnTxt = { fontSize: 12, color: '#f59e0b', fontWeight: 700 };
const errTxt = { fontSize: 12, color: '#ef4444', fontWeight: 700 };
const ZONES = (withDone) => [
  { key: 'late', statuses: ['late'], label: '⏰ เกิน lead time ของร้าน', color: '#ef4444', hint: 'ส่งไปนานเกินกำหนดแล้ว — ตามร้าน' },
  { key: 'vendor', statuses: ['vendor'], label: '🧪 อยู่ที่ร้านชุบ · รอรับกลับ', color: '#06b6d4', hint: 'งานกลับมา → นับของจริงแล้วกดรับ · ทยอยรับได้' },
  ...(withDone ? [{ key: 'closed', statuses: ['closed'], label: '✅ ปิดแล้ว (ล่าสุด)', color: '#22c55e', hint: '' }] : []),
];
const dmy = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short' }) : '—';
};
const daysAgo = (iso, nowMs) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86400000)) : null;
};
const blankLine = () => ({ key: Math.random().toString(36).slice(2), after: '', before: '', qty: '' });

export default function PlatingBoard({ q = '', showDone = false }) {
  const { role, fullName } = useContext(UserContext);
  const canSend = canSeeded('plating', 'send', role);
  const canReceive = canSeeded('plating', 'receive', role);
  const canToWh = canSeeded('plating', 'to_wh', role);
  const canSetup = canSeeded('plating', 'setup', role);
  const canWriteoff = canSeeded('plating', 'writeoff', role);
  const imgOf = usePartImages();
  const suppliers = useSuppliers();

  // ── ทะเบียน (โหลดตอนเปิด + หลังผูก BOM) ──
  const [masterKey, setMasterKey] = useState(0);
  const [products, setProducts] = useState([]);
  const [bomRows, setBomRows] = useState([]);
  const [rules, setRules] = useState([]);
  const [lines, setLines] = useState([]);
  const [masterErr, setMasterErr] = useState('');
  const [masterReady, setMasterReady] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [p, b, r, l] = await Promise.all([
        fetchAllRows(supabaseDR, 'dr_products', PROD_COLS, x => x.order('mat_no').order('id')),
        fetchAllRows(supabaseDR, 'bom_items', BOM_COLS, x => x.order('id')),
        supabaseDR.from('stock_inflow_rules').select('match_type, match_value, dest_line_name, is_active, mode').eq('is_active', true),
        loadProductionLines().then(d => ({ data: d, error: null }), e => ({ data: [], error: e })),
      ]);
      if (!alive) return;
      const err = p.error || b.error || r.error || l.error;
      setMasterErr(err ? (err.message || String(err)) : '');
      setProducts(p.data || []); setBomRows(b.data || []); setRules(r.data || []); setLines(l.data || []);
      setMasterReady(true);
    })();
    return () => { alive = false; };
  }, [masterKey]);
  const reloadMaster = () => { invalidateProducts(); setMasterKey(k => k + 1); };

  const platList = useMemo(() => platingProducts(products, lines), [products, lines]);
  const platSet = useMemo(() => new Set(platList.map(p => p.mat_no)), [platList]);
  const routes = useMemo(() => platingRoutes(products, bomRows, lines), [products, bomRows, lines]);
  const outLines = useMemo(() => lines.filter(l => l.line_type === OUTSOURCE_LINE_TYPE).map(l => l.name), [lines]);
  const byMat = useMemo(() => new Map(products.map(p => [p.mat_no, p])), [products]);
  const locOf = useCallback((mat) => inflowDestOf(mat, rules), [rules]);
  const leadOf = useMemo(() => {
    const m = new Map((suppliers || []).map(s => [String(s.name || '').trim(), s.lead_time_days]));
    return (v) => { const d = m.get(String(v || '').trim()); return d == null ? null : Number(d); };
  }, [suppliers]);

  // ── ข้อมูลสด: ใบส่งชุบ + ยอดคลังของ MAT ที่เกี่ยว ──
  const matsKey = useMemo(() => [...new Set(routes.flatMap(r => [r.after, ...r.candidates.map(c => c.mat)]))].sort().join(','), [routes]);
  const [orders, setOrders] = useState([]);
  const [closed, setClosed] = useState([]);
  const [stock, setStock] = useState({});          // `${loc}|${mat}` → qty · ไม่มีคีย์ = ไม่มีข้อมูล
  const [liveErr, setLiveErr] = useState('');
  const loadLive = useCallback(async () => {
    const mats = matsKey ? matsKey.split(',') : [];
    const [op, cl, st] = await Promise.all([
      supabaseDR.from('plating_orders').select(ORDER_COLS).eq('status', 'open').order('sent_at').limit(1000),
      supabaseDR.from('plating_orders').select(ORDER_COLS).in('status', ['closed', 'cancelled']).order('closed_at', { ascending: false }).limit(30),
      mats.length
        ? fetchByIds(mats, part => supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand').in('mat_no', part), { orderBy: 'mat_no' })
        : Promise.resolve({ rows: [], error: null }),
    ]);
    const err = op.error?.message || cl.error?.message || st.error;
    setLiveErr(err || (op.data?.length === 1000 ? 'ใบที่อยู่ร้านเกิน 1,000 ใบ — แสดงไม่ครบ' : ''));
    setOrders(op.data || []); setClosed(cl.data || []);
    const s = {};
    (st.rows || []).forEach(x => { s[`${x.line_name}|${x.mat_no}`] = Number(x.qty_on_hand || 0); });
    setStock(s);
  }, [matsKey]);
  useLiveBoard(loadLive, { tables: ['plating_orders'], topic: 'plating-board', enabled: masterReady });

  const now = new Date();
  const groups = useMemo(() => outstandingByVendor(orders, { now: new Date(), leadDaysOf: leadOf }), [orders, leadOf]);
  const haveAt = (loc, mat) => (loc && mat && `${loc}|${mat}` in stock ? stock[`${loc}|${mat}`] : null);
  const by = () => fullName || getActor().name || '';
  const [busy, setBusy] = useState(null);
  const rpc = async (key, fn, args, okMsg) => {
    setBusy(key);
    const { data, error } = await supabaseDR.rpc(fn, args);
    setBusy(null);
    if (error) { toast.error(`ไม่สำเร็จ — ${error.message}`); loadLive(); return null; }
    if (okMsg) toast.success(typeof okMsg === 'function' ? okMsg(data) : okMsg);
    return data ?? true;
  };

  // ── 📤 ส่งไปชุบ (หลายรายการต่อครั้ง) ──
  const [sendOpen, setSendOpen] = useState(false);
  const [vendor, setVendor] = useState('');
  const [docNo, setDocNo] = useState('');
  const [sendLines, setSendLines] = useState([blankLine()]);
  const setLine = (k, patch) => setSendLines(ls => ls.map(l => (l.key === k ? { ...l, ...patch } : l)));
  const lineInfo = (l) => {
    const cands = l.after ? beforeCandidatesOf(l.after, { products, bomRows, platingSet: platSet }) : [];
    const before = l.before || autoBeforeOf(cands)?.mat || '';
    const cand = cands.find(c => c.mat === before) || null;   // เลือกเองนอกลิสต์ = ยังไม่ผูก → ส่งครั้งแรกผูกให้
    const fromLoc = before ? locOf(before) : null;
    const have = haveAt(fromLoc, before);
    const block = !l.after ? 'เลือกงานหลังชุบ' : !before ? 'เลือกเลขก่อนชุบ' : sendBlockReason({ route: { before }, qty: l.qty, fromLoc });
    return { cands, before, cand, fromLoc, have, block, warn: before ? sendStockWarn({ qty: l.qty, have, fromLoc }) : null, linked: !!cand?.linked || false };
  };
  const filled = sendLines.filter(l => l.after || l.qty);
  const infos = filled.map(l => ({ l, i: lineInfo(l) }));
  const sendBlock = !vendor.trim() ? 'เลือกร้านชุบ' : !filled.length ? 'เพิ่มรายการที่จะส่ง' : (infos.find(x => x.i.block)?.i.block || null);
  const doSend = async () => {
    if (sendBlock) { toast.error(sendBlock); return; }
    let ok = 0;
    const failed = [];
    for (const { l, i } of infos) {
      // BOM ยังไม่ผูก "หลังชุบ ← ก่อนชุบ" = ผูกให้ก่อน (ครั้งแรกครั้งเดียว · ไม่แตะร้านของสินค้า)
      if (!i.linked) {
        const linkOk = await rpc(`send|${l.key}`, 'plating_setup_route', {
          p_before: i.before, p_after: l.after, p_after_name: null, p_vendor: null, p_process_type: null, p_by: by(),
        }, null);
        if (!linkOk) { failed.push(l.after); continue; }
      }
      const res = await rpc(`send|${l.key}`, 'plating_send', {
        p_vendor: vendor.trim(), p_before: i.before, p_after: l.after, p_qty: Number(l.qty),
        p_from_loc: i.fromLoc, p_doc_no: docNo, p_note: null, p_by: by(),
      }, null);
      if (res) ok += 1; else failed.push(l.after);
    }
    if (ok) toast.success(`📤 ส่งไป ${vendor.trim()} แล้ว ${ok} รายการ — การ์ดรอรับกลับอยู่ด้านล่าง`);
    if (failed.length) toast.error(`ส่งไม่สำเร็จ: ${failed.join(', ')} — รายการนี้ยังค้างในฟอร์ม`);
    setSendLines(ls => { const keep = ls.filter(l => failed.includes(l.after)); return keep.length ? keep : [blankLine()]; });
    if (!failed.length) { setDocNo(''); setSendOpen(false); }
    if (infos.some(x => !x.i.linked)) reloadMaster();
    loadLive();
  };

  // ── 📥 รับกลับ (ต่อใบ = ต่อการ์ด) ──
  const [diffFor, setDiffFor] = useState(null);
  const [form, setForm] = useState({ qty: '', reason: '', close: false });
  const receive = async (o, qty, reason, close) => {
    const open = openQtyOf(o);
    const toLoc = locOf(o.after_mat);
    if (!toLoc) { toast.error(`ยังไม่มีกฎรับเข้าคลังของ ${o.after_mat} — ตั้งที่ /line-stock?tab=inflow ก่อน`); return false; }
    const why = receiveBlockReason({ open, qty, reason, close });
    if (why) { toast.error(why); return false; }
    const res = await rpc(`recv|${o.id}`, 'plating_receive_order', {
      p_order_id: o.id, p_qty: Number(qty), p_to_loc: toLoc, p_reason: reason || null, p_close: !!close, p_by: by(),
    }, (d) => `📥 รับ ${o.after_mat} ${fmt(d?.received)} ชิ้นเข้า ${toLoc}`
      + (d?.left_open > 0 ? ` · ยังค้างร้าน ${fmt(d.left_open)}` : '') + (d?.written_off > 0 ? ` · ปิดใบ ขาด ${fmt(d.written_off)}` : ''));
    loadLive();
    return !!res;
  };

  // ── ✂️ ตัดยอดสิ้นปี ──
  const [woFor, setWoFor] = useState(null);
  const [woReason, setWoReason] = useState('');
  const doWriteoff = async (g) => {
    if (!woReason.trim()) { toast.error('ต้องใส่เหตุผลการตัดยอด'); return; }
    if (!window.confirm(`ตัดยอดค้างที่ ${g.vendor} ทั้งหมด ${fmt(g.open)} ชิ้น (${g.orders} ใบ)?\nย้อนไม่ได้ — ใบจะถูกปิด`)) return;
    const ok = await rpc(`wo|${g.vendor}`, 'plating_writeoff', { p_vendor: g.vendor, p_order_ids: null, p_reason: woReason.trim(), p_by: by() },
      (d) => `✂️ ตัดยอดค้าง ${g.vendor} ${fmt(d?.qty)} ชิ้น (${d?.orders} ใบ)`);
    if (ok) { setWoFor(null); setWoReason(''); }
    loadLive();
  };

  // ── 🏬 หลังชุบในคลัง → W/H (เฉพาะตัวที่มี FG ลูกเดียว) ──
  const afterStock = useMemo(() => routes.map(r => {
    const loc = locOf(r.after);
    return { ...r, loc, have: loc ? (stock[`${loc}|${r.after}`] ?? null) : null, targets: toWhTargets(r.after, { products, bomRows }) };
  }).filter(a => a.have > 0 || a.targets.some(t => t.direct)), [routes, locOf, stock, products, bomRows]);
  const [whQty, setWhQty] = useState({});
  const [whFg, setWhFg] = useState({});
  const doToWh = async (a) => {
    const direct = a.targets.filter(t => t.direct);
    const fg = whFg[a.after] || (direct.length === 1 ? direct[0].fg : '');
    const t = direct.find(x => x.fg === fg);
    const qv = Number(whQty[a.after]);
    const toLoc = t ? locOf(t.fg) : null;
    if (!t) { toast.error('เลือก FG ที่จะแปลงเข้า'); return; }
    if (!toLoc) { toast.error(`ยังไม่มีกฎรับเข้าคลังของ ${t.fg} — ตั้งที่ /line-stock?tab=inflow ก่อน`); return; }
    if (!(qv > 0)) { toast.error('ใส่จำนวน'); return; }
    const ok = await rpc(`wh|${a.after}`, 'plating_to_wh', {
      p_after: a.after, p_fg: t.fg, p_qty: qv, p_from_loc: a.loc, p_to_loc: toLoc, p_note: null, p_by: by(),
    }, (d) => `🏬 ส่ง ${a.after} ${fmt(qv)} → ${toLoc} เป็น ${t.fg} ${fmt(d?.fg_qty)} ชิ้น`);
    if (ok) setWhQty(m => ({ ...m, [a.after]: '' }));
    loadLive();
  };

  // ── ⚙️ ผูก BOM เอง (สินค้าที่ยังไม่รู้เลขก่อนชุบ) ──
  const [setupOpen, setSetupOpen] = useState(false);
  const [linkPick, setLinkPick] = useState({});      // after → before ที่เลือก
  const doLink = async (r) => {
    const before = linkPick[r.after];
    if (!before) { toast.error('เลือกเลขก่อนชุบก่อน'); return; }
    const ok = await rpc(`link|${r.after}`, 'plating_setup_route', {
      p_before: before, p_after: r.after, p_after_name: null, p_vendor: null, p_process_type: null, p_by: by(),
    }, `🌳 ผูก BOM ${r.after} ← ${before} แล้ว`);
    if (ok) reloadMaster();
  };

  // ── การ์ด (กรองด้วยคำค้นของตู้รวม) ──
  const s = q.trim().toLowerCase();
  const match = (o) => !s || [o.after_mat, o.before_mat, o.part_name, o.vendor, o.doc_no].some(v => String(v ?? '').toLowerCase().includes(s));
  const cards = [...orders, ...(showDone ? closed : [])].filter(match);
  const zoneOf = (o) => orderZone(o, { now, leadDays: leadOf(o.vendor) });
  const totalOpen = groups.reduce((a, g) => a + g.open, 0);
  const unknownBefore = routes.filter(r => !r.before);

  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      {masterErr && <div style={errTxt}>⚠ โหลดทะเบียนสินค้า/BOM/กฎคลัง/ไลน์ไม่ครบ — {masterErr} · รายการงานชุบบนจออาจขาด</div>}
      {liveErr && <div style={errTxt}>⚠ โหลดใบส่งชุบ/ยอดคลังไม่ครบ — {liveErr} · ตัวเลขบนจออาจขาด</div>}
      {masterReady && !platList.length && (
        <div style={warnTxt}>
          ยังไม่มีสินค้าหลังชุบ — ระบบนับสินค้าที่อยู่บน "ไลน์ประเภท 🧪 จ้างนอก" เป็นงานหลังชุบ ·
          ตั้งประเภทไลน์ที่ /line-setup (เช่นไลน์ Coating) แล้วสร้างสินค้าหลังชุบไว้บนไลน์นั้นที่ /products
        </div>
      )}

      {/* ⏳ ยอดที่ร้าน (มอนิเตอร์) + ปุ่มส่ง */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'stretch' }}>
        {groups.map(g => {
          const oldest = g.items.reduce((m, it) => Math.max(m, it.ageDays ?? 0), 0);
          const late = g.items.some(it => it.overdue);
          return (
            <div key={g.vendor} style={{ ...box, flex: '1 1 220px', borderColor: late ? '#ef4444' : 'var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>🧪 {g.vendor}</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{fmt(g.open)} <span style={{ fontSize: 12, color: 'var(--muted)' }}>ชิ้นอยู่ที่ร้าน</span></div>
              <div style={muted}>{g.orders} ใบ · {g.items.length} พาร์ท · เก่าสุด {oldest} วัน
                {g.leadDays == null ? ' · ยังไม่ตั้ง lead time ร้าน (ทะเบียน Supplier)' : ` · lead time ${g.leadDays} วัน`}</div>
              {late && <div style={errTxt}>มีงานเกิน lead time</div>}
            </div>
          );
        })}
        {!groups.length && masterReady && <div style={{ ...box, flex: '1 1 220px', ...muted }}>ไม่มีงานค้างที่ร้านชุบ</div>}
        <button type="button" disabled={!canSend} onClick={() => setSendOpen(v => !v)}
          style={storeBtn(sendOpen ? 'secondary' : 'primary', { alignSelf: 'center', opacity: canSend ? 1 : 0.5 })}
          title={canSend ? '' : 'ไม่มีสิทธิ์ส่งชุบ (plating:send)'}>
          {sendOpen ? '▾ ปิดฟอร์มส่ง' : '📤 ส่งงานไปชุบ'}
        </button>
      </div>

      {sendOpen && (
        <div style={box}>
          <h3 style={h3}>📤 ส่งงานไปชุบ</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <SupplierSelect value={vendor} onChange={({ supplier }) => setVendor(supplier || '')} kinds={['service']} placeholder="ร้านชุบ (ทะเบียน Supplier)…" />
            </div>
            <input placeholder="เลขใบส่งของ (ถ้ามี)" value={docNo} onChange={e => setDocNo(e.target.value)} style={{ ...inp, flex: '1 1 160px' }} aria-label="เลขใบส่งของ" />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {sendLines.map((l, idx) => {
              const i = lineInfo(l);
              return (
                <div key={l.key} style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 'var(--radius)', background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)' }}>#{idx + 1}</span>
                    <div style={{ flex: '2 1 260px', minWidth: 0 }}>
                      <ProductSelect value={l.after} onChange={({ mat_no }) => setLine(l.key, { after: mat_no || '', before: '' })}
                        products={platList} includeInactive disabled={!platList.length} placeholder="งานหลังชุบ — ค้น MAT / ชื่อ / P/N…" />
                    </div>
                    <input type="number" min="0" inputMode="numeric" placeholder="จำนวน" value={l.qty}
                      onChange={e => setLine(l.key, { qty: e.target.value })} style={{ ...inp, width: 110 }} aria-label="จำนวนที่ส่ง" />
                    {sendLines.length > 1 && (
                      <button type="button" onClick={() => setSendLines(ls => ls.filter(x => x.key !== l.key))} style={storeBtn('secondary', { minHeight: 40, padding: '6px 12px' })} aria-label="ลบรายการ">✕</button>
                    )}
                  </div>
                  {l.after && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
                      <span>ส่งเป็นเลขก่อนชุบ:</span>
                      {i.cands.length > 1 || (i.cands.length === 1 && !i.cands[0].linked) ? (
                        <select value={i.before} onChange={e => setLine(l.key, { before: e.target.value })} style={{ ...inp, minHeight: 36 }} aria-label="เลขก่อนชุบ">
                          <option value="">— เลือก —</option>
                          {i.cands.map(c => <option key={c.mat} value={c.mat}>{c.mat} {c.name}{c.linked ? '' : ' (P/N ตรง · ยังไม่ผูก BOM)'}</option>)}
                        </select>
                      ) : i.cands.length === 1 ? <b>{i.cands[0].mat} {i.cands[0].name}</b> : (
                        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                          <ProductSelect value={l.before} onChange={({ mat_no }) => setLine(l.key, { before: mat_no || '' })} products={products} placeholder="ไม่เจอใน BOM — เลือกเลขก่อนชุบเอง…" />
                        </div>
                      )}
                      {i.before && !i.linked && <span style={warnTxt}>ส่งครั้งแรก ระบบจะผูก BOM {l.after} ← {i.before} ให้</span>}
                    </div>
                  )}
                  {i.before && <div style={muted}>ตัดของจาก <b>{i.fromLoc || '—'}</b>{i.fromLoc && <> · ระบบเห็นคงเหลือ {i.have == null ? 'ไม่มีข้อมูลสต็อก' : `${fmt(i.have)} ชิ้น`}</>}</div>}
                  {i.block && l.qty !== '' && l.after && <div style={errTxt}>{i.block}</div>}
                  {i.warn && <div style={warnTxt}>{i.warn}</div>}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            <button type="button" onClick={() => setSendLines(ls => [...ls, blankLine()])} style={storeBtn('secondary')}>+ เพิ่มรายการ</button>
            <button type="button" disabled={!!sendBlock || String(busy || '').startsWith('send|')} onClick={doSend}
              style={storeBtn('primary', { opacity: sendBlock ? 0.5 : 1 })}>
              {String(busy || '').startsWith('send|') ? 'กำลังบันทึก…' : `📤 ส่ง ${filled.length} รายการ · ${fmt(filled.reduce((a, l) => a + Number(l.qty || 0), 0))} ชิ้น`}
            </button>
            {sendBlock && filled.length > 0 && <span style={muted}>{sendBlock}</span>}
          </div>
        </div>
      )}

      {/* 🃏 การ์ดใบส่งชุบ — รอรับกลับ */}
      <div style={muted}>
        🧪 อยู่ที่ร้านรวม <b>{fmt(totalOpen)} ชิ้น · {orders.length} ใบ</b> · งานกลับมา: นับของจริงก่อน ครบกดรับ · ไม่ครบกรอกยอดที่นับได้ + รายละเอียด
        (ส่วนที่เหลือค้างร้านต่อ หรือติ๊กปิดใบถ้าไม่กลับแล้ว) · ร้านชุบไม่ยืนยันยอดเอง สโตร์เป็นคนยืนยัน
        {!canReceive && <span style={warnTxt}> · บัญชีนี้ไม่มีสิทธิ์รับคืน (plating:receive) — ดูได้อย่างเดียว</span>}
      </div>
      {cards.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', ...muted }}>
          {orders.length === 0 && !s ? 'ไม่มีงานรอรับกลับจากร้านชุบ' : `ไม่มีใบที่ตรงคำค้น${s ? ` "${q}"` : ''}`}
        </div>
      ) : (
        <StatusZones rows={cards} zones={ZONES(showDone)} statusOf={zoneOf} renderCard={o => {
          const open = openQtyOf(o);
          const isOpen = o.status === 'open';
          const editing = diffFor === o.id;
          const zone = zoneOf(o);
          const toLoc = locOf(o.after_mat);
          const age = daysAgo(o.sent_at, now.getTime());
          return (
            <PartCard key={o.id} code={o.after_mat} name={o.part_name} img={imgOf(o.after_mat) || imgOf(o.before_mat)} alert={zone === 'late'}
              status={isOpen ? (zone === 'late' ? { label: '⏰ เกินกำหนด', color: '#ef4444' } : { label: '🧪 ที่ร้าน', color: '#06b6d4' }) : { label: '✅ ปิดแล้ว', color: '#22c55e' }}
              metric={{ label: isOpen ? 'ค้างที่ร้าน' : 'รับกลับแล้ว', value: fmt(isOpen ? open : o.qty_received), unit: 'ชิ้น' }}
              aside={{ label: 'ร้าน', value: o.vendor }}
              dim={!isOpen}
              rows={[
                { k: 'ส่งไปเป็น', v: o.before_mat },
                { k: 'ส่ง / รับแล้ว', v: `${fmt(o.qty_sent)} / ${fmt(o.qty_received)}${Number(o.qty_written_off) > 0 ? ` · ตัด ${fmt(o.qty_written_off)}` : ''}` },
                { k: 'ส่งเมื่อ', v: `${dmy(o.sent_at)}${age != null ? ` · ${age} วันที่แล้ว` : ''}${o.sent_by_name ? ` · ${o.sent_by_name}` : ''}` },
                { k: 'ใบส่งของ', v: o.doc_no },
                { k: 'รับเข้า', v: isOpen ? (toLoc || '⚠ ไม่มีกฎรับเข้าคลัง') : null },
                { k: 'ปิดใบ', v: !isOpen ? `${dmy(o.closed_at)} · ${o.closed_reason || o.status}` : null },
              ]}
              footer={isOpen && canReceive ? (editing ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
                    ยอดที่นับได้จริง (ค้างร้าน {fmt(open)})
                    <input type="number" min="0" inputMode="numeric" value={form.qty} autoFocus
                      onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                      style={{ ...inp, display: 'block', width: '100%', marginTop: 4, fontSize: 15, fontWeight: 800 }} />
                  </label>
                  <input placeholder="รายละเอียด (บังคับเมื่อไม่ครบ) เช่น ร้านทยอยส่ง / NG ที่ร้าน 5" value={form.reason}
                    onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} style={inp} aria-label="รายละเอียด" />
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                    <input type="checkbox" checked={form.close} onChange={e => setForm(f => ({ ...f, close: e.target.checked }))} />
                    ปิดใบนี้ — ส่วนที่ขาดไม่กลับแล้ว (ไม่ติ๊ก = ส่วนที่เหลือยังค้างร้าน ทยอยรับได้)
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" disabled={busy === `recv|${o.id}`} style={storeBtn('primary', { flex: 1 })}
                      onClick={async () => { if (await receive(o, form.qty, form.reason.trim(), form.close)) setDiffFor(null); }}>
                      {busy === `recv|${o.id}` ? 'กำลังบันทึก…' : `✅ รับเข้า ${form.qty === '' ? '' : fmt(form.qty)}`}
                    </button>
                    <button type="button" style={storeBtn('secondary')} onClick={() => setDiffFor(null)}>ยกเลิก</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" disabled={busy === `recv|${o.id}` || !toLoc} style={storeBtn('primary', { flex: 1, opacity: toLoc ? 1 : 0.5 })}
                    onClick={() => receive(o, open, '', false)}>
                    {busy === `recv|${o.id}` ? 'กำลังบันทึก…' : `✅ นับแล้วครบ · รับ ${fmt(open)}`}
                  </button>
                  <button type="button" style={storeBtn('secondary')}
                    onClick={() => { setDiffFor(o.id); setForm({ qty: String(open), reason: '', close: false }); }}>✏️ ไม่ครบ</button>
                </div>
              )) : null} />
          );
        }} />
      )}

      {/* 🏬 หลังชุบในคลัง → W/H */}
      {afterStock.length > 0 && (
        <div style={box}>
          <h3 style={h3}>🏬 งานหลังชุบในคลัง → ส่งเข้า W/H</h3>
          {!canToWh && <div style={warnTxt}>บัญชีนี้ไม่มีสิทธิ์ส่งเข้า W/H (plating:to_wh) — ดูได้อย่างเดียว</div>}
          <div style={muted}>ระบบแปลงเป็นเบอร์ 1xx ตาม BOM ให้เอง — เฉพาะ FG ที่มีลูกเป็นงานหลังชุบตัวเดียว · FG ที่ต้องประกอบต่อ ส่งไปไลน์ตามใบผลิตปกติ</div>
          <div style={{ ...partCardGrid(), marginTop: 8 }}>
            {afterStock.map(a => {
              const direct = a.targets.filter(t => t.direct);
              const asm = a.targets.filter(t => !t.direct);
              const fg = whFg[a.after] || (direct.length === 1 ? direct[0].fg : '');
              return (
                <PartCard key={a.after} code={a.after} name={a.afterName} img={imgOf(a.after)}
                  metric={{ label: a.loc ? `ใน ${a.loc}` : 'ไม่มีกฎรับเข้าคลัง', value: a.have == null ? '—' : fmt(a.have), unit: 'ชิ้น' }}
                  rows={[
                    ...direct.map(t => ({ k: 'แปลงเป็น', v: `${t.fg} ${t.name}${t.qpu !== 1 ? ` (ใช้ ${t.qpu} ต่อ 1)` : ''}` })),
                    ...asm.map(t => ({ k: 'ประกอบที่', v: `${t.line || 'ไลน์ (ยังไม่ระบุ)'} → ${t.fg}` })),
                    { k: 'หมายเหตุ', v: a.targets.length ? null : 'ยังไม่มี FG ใช้เลขนี้ใน BOM' },
                  ]}
                  footer={direct.length > 0 && canToWh ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {direct.length > 1 && (
                        <select value={fg} onChange={e => setWhFg(m => ({ ...m, [a.after]: e.target.value }))} style={{ ...inp, flex: '1 1 100%' }} aria-label="FG ปลายทาง">
                          <option value="">— เลือก FG —</option>
                          {direct.map(t => <option key={t.fg} value={t.fg}>{t.fg} {t.name}</option>)}
                        </select>
                      )}
                      <input type="number" min="0" inputMode="numeric" placeholder="จำนวน" value={whQty[a.after] || ''}
                        onChange={e => setWhQty(m => ({ ...m, [a.after]: e.target.value }))} style={{ ...inp, width: 100 }} aria-label="จำนวนส่งเข้า W/H" />
                      <button type="button" disabled={busy === `wh|${a.after}` || !a.loc} onClick={() => doToWh(a)} style={storeBtn('primary', { flex: 1 })}>🏬 ส่งเข้า W/H</button>
                    </div>
                  ) : null} />
              );
            })}
          </div>
        </div>
      )}

      {/* ⚙️ ตั้งค่า / ตัดยอด */}
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ ...h3, margin: 0 }}>⚙️ สินค้าหลังชุบ {platList.length} ตัว</h3>
          {unknownBefore.length > 0 && <span style={warnTxt}>{unknownBefore.length} ตัวยังไม่ผูกเลขก่อนชุบใน BOM</span>}
          <button type="button" onClick={() => setSetupOpen(v => !v)} style={{ ...storeBtn('secondary'), marginLeft: 'auto' }}>{setupOpen ? '▾ ซ่อน' : '▸ ดู/ผูก BOM · ตัดยอด'}</button>
        </div>
        {setupOpen && (
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <div style={muted}>
              สินค้าหลังชุบ = สินค้าบนไลน์ประเภท 🧪 จ้างนอก ({outLines.length ? outLines.join(', ') : 'ยังไม่มี — ตั้งที่ /line-setup'}) หรือที่ตั้งร้านไว้ ·
              เลขก่อนชุบอ่านจาก BOM · ยังไม่ผูก = ระบบเสนอจาก P/N ตรงกัน (ส่งครั้งแรกจะผูกให้เอง หรือผูกล่วงหน้าที่นี่)
            </div>
            {routes.map(r => (
              <div key={r.after} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                <span style={{ minWidth: 220 }}><b>{r.after}</b> {r.afterName}</span>
                {r.before ? <span>← {r.before} {byMat.get(r.before)?.name || ''}</span> : (
                  <>
                    <span style={warnTxt}>{r.problem}</span>
                    {canSetup && (
                      <>
                        <select value={linkPick[r.after] || ''} onChange={e => setLinkPick(m => ({ ...m, [r.after]: e.target.value }))} style={{ ...inp, minHeight: 34 }} aria-label="เลขก่อนชุบ">
                          <option value="">— เลขก่อนชุบ —</option>
                          {r.candidates.map(c => <option key={c.mat} value={c.mat}>{c.mat} {c.name}</option>)}
                        </select>
                        {!r.candidates.length && (
                          <div style={{ minWidth: 220 }}>
                            <ProductSelect value={linkPick[r.after] || ''} onChange={({ mat_no }) => setLinkPick(m => ({ ...m, [r.after]: mat_no || '' }))} products={products} placeholder="ค้นเลขก่อนชุบ…" />
                          </div>
                        )}
                        <button type="button" disabled={!linkPick[r.after] || busy === `link|${r.after}`} onClick={() => doLink(r)}
                          style={storeBtn('secondary', { minHeight: 34, padding: '4px 10px', fontSize: 12 })}>🌳 ผูก BOM</button>
                      </>
                    )}
                  </>
                )}
              </div>
            ))}
            {canWriteoff && groups.length > 0 && (
              <div style={{ display: 'grid', gap: 6, marginTop: 6, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>✂️ ตัดยอดค้างร้าน (ปีละครั้ง · ต้องมีเหตุผล)</div>
                {groups.map(g => (
                  <div key={g.vendor} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, minWidth: 140 }}>{g.vendor} · ค้าง {fmt(g.open)}</span>
                    {woFor === g.vendor ? (
                      <>
                        <input placeholder="เหตุผล เช่น ตัดยอดสิ้นปี 2026 ตามที่ตกลงกับร้าน" value={woReason} onChange={e => setWoReason(e.target.value)} style={{ ...inp, flex: '1 1 260px' }} aria-label="เหตุผลการตัดยอด" />
                        <button type="button" disabled={busy === `wo|${g.vendor}`} onClick={() => doWriteoff(g)} style={storeBtn('primary')}>ยืนยันตัดยอด</button>
                        <button type="button" onClick={() => setWoFor(null)} style={storeBtn('secondary')}>ยกเลิก</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => { setWoFor(g.vendor); setWoReason(''); }} style={storeBtn('secondary')}>✂️ ตัดยอด…</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
