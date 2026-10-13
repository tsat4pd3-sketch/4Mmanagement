import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { canSeeded } from '../utils/permissions';
import { getActor } from '../utils/actorStamp';
import { useLiveBoard } from '../utils/useLiveBoard';
import { fetchAllRows } from '../utils/fetchAllRows';
import { fetchByIds } from '../utils/fetchByIds';
import { checkWriteRows } from '../utils/dbWrite';
import { storeBtn } from '../utils/storeUi';
import { inflowDestOf } from '../utils/partRefStock';
import { loadProcessTypes } from '../utils/processTypes';
import { invalidateProducts } from '../utils/useProducts';
import usePartImages from '../utils/usePartImages';
import useSuppliers from '../utils/useSuppliers';
import ProductSelect from './ProductSelect';
import SupplierSelect from './SupplierSelect';
import PartThumb from './PartThumb';
import {
  platingRoutes, outstandingByVendor, toWhTargets, afterCandidates, directUsesOfBefore,
  sendBlockReason, sendStockWarn, openQtyOf,
} from '../utils/plating';

/* ═══ 🧪 งานชุบภายนอก — แท็บใน /heijunka (2026-10-13 · คำสั่ง user)

   ใครทำอะไร (ตามที่หน้างานเล่า):
     📤 planner  ส่งงาน "ก่อนชุบ" (2xx) ออกไปร้าน → ของย้ายจากคลังไปค้างที่ร้าน
     📥 สโตร์    รับงาน "หลังชุบ" (2xx เลขใหม่) คืนเข้าคลัง — ทยอยรับได้ ตัดใบเก่าสุดก่อน
     🏬 สโตร์    ส่งงานหลังชุบเข้า W/H → ระบบแปลงเป็นเบอร์ 1xx ตาม BOM (เฉพาะ FG ที่มีลูกตัวเดียว)
                 FG ที่ต้องเอาไปประกอบต่อ = ไหลตามใบผลิตของไลน์ปกติ (จอบอกชื่อไลน์ให้)
     ✂️ ผู้จัดการ ตัดยอดค้างร้านปีละครั้ง (ต้องมีเหตุผล)
     ⚙️ planner  ตั้งเส้นทางเอง: สินค้าหลังชุบ + ร้าน + BOM — **ไม่มีชื่อร้าน/เลข MAT ในโค้ด**

   กฎทั้งหมดอยู่ที่ `utils/plating.js` · ทุกปุ่มเขียนผ่าน RPC `plating_*` (DR) ทรานแซกชันเดียว
   คลังต้นทาง/ปลายทางอ่านจากกฎรับเข้าคลัง (`inflowDestOf`) — ไม่มีกฎ = บอกบนจอ ไม่เดา */

const fmt = (n) => Number(n || 0).toLocaleString();
const PROD_COLS = 'id, mat_no, name, p_no, customer, line_name, is_active, is_operation, outsource_vendor';
const BOM_COLS = 'id, product_id, mat_no, part_name, qty_per_unit, uom, parent_mat, item_no, is_active';
const ORDER_COLS = 'id, vendor, before_mat, after_mat, part_name, qty_sent, qty_received, qty_written_off, status, from_loc, doc_no, sent_at, sent_by_name, closed_at, closed_reason';

const box = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14 };
const h3 = { fontSize: 15, fontWeight: 800, margin: '0 0 8px', color: 'var(--text)' };
const muted = { fontSize: 12, color: 'var(--muted)' };
const inp = { minHeight: 40, padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13.5, fontFamily: 'var(--font-body)' };
const warnTxt = { fontSize: 12, color: '#f59e0b', fontWeight: 700 };
const errTxt = { fontSize: 12, color: '#ef4444', fontWeight: 700 };

export default function PlatingBoard() {
  const { role, fullName } = useContext(UserContext);
  const canSend = canSeeded('plating', 'send', role);
  const canReceive = canSeeded('plating', 'receive', role);
  const canToWh = canSeeded('plating', 'to_wh', role);
  const canSetup = canSeeded('plating', 'setup', role);
  const canWriteoff = canSeeded('plating', 'writeoff', role);
  const imgOf = usePartImages();
  const suppliers = useSuppliers();

  // ── ทะเบียน (โหลดตอนเปิด + หลังตั้งเส้นทาง) ──
  const [masterKey, setMasterKey] = useState(0);
  const [products, setProducts] = useState([]);
  const [bomRows, setBomRows] = useState([]);
  const [rules, setRules] = useState([]);
  const [procTypes, setProcTypes] = useState([]);
  const [masterErr, setMasterErr] = useState('');
  const [masterReady, setMasterReady] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [p, b, r, pt] = await Promise.all([
        fetchAllRows(supabaseDR, 'dr_products', PROD_COLS, q => q.order('mat_no').order('id')),
        fetchAllRows(supabaseDR, 'bom_items', BOM_COLS, q => q.order('id')),
        supabaseDR.from('stock_inflow_rules').select('match_type, match_value, dest_line_name, is_active').eq('is_active', true),
        loadProcessTypes(),
      ]);
      if (!alive) return;
      const err = p.error || b.error || r.error;
      setMasterErr(err ? err.message : '');
      setProducts(p.data || []); setBomRows(b.data || []); setRules(r.data || []);
      setProcTypes((pt || []).filter(x => x.is_active !== false));
      setMasterReady(true);
    })();
    return () => { alive = false; };
  }, [masterKey]);
  const reloadMaster = () => { invalidateProducts(); setMasterKey(k => k + 1); };

  const routes = useMemo(() => platingRoutes(products, bomRows), [products, bomRows]);
  const okRoutes = useMemo(() => routes.filter(r => r.before), [routes]);
  const locOf = useCallback((mat) => inflowDestOf(mat, rules), [rules]);
  const leadOf = useMemo(() => {
    const m = new Map((suppliers || []).map(s => [String(s.name || '').trim(), s.lead_time_days]));
    return (v) => { const d = m.get(String(v || '').trim()); return d == null ? null : Number(d); };
  }, [suppliers]);

  // ── ข้อมูลสด: ใบค้างร้าน + ยอดคลังของ MAT ในเส้นทาง ──
  const matsKey = useMemo(() => [...new Set(okRoutes.flatMap(r => [r.before, r.after]))].sort().join(','), [okRoutes]);
  const [orders, setOrders] = useState([]);
  const [recent, setRecent] = useState([]);
  const [stock, setStock] = useState({});          // `${loc}|${mat}` → qty · ไม่มีคีย์ = ไม่มีข้อมูล
  const [liveErr, setLiveErr] = useState('');
  const loadLive = useCallback(async () => {
    const mats = matsKey ? matsKey.split(',') : [];
    const [op, rc, st] = await Promise.all([
      supabaseDR.from('plating_orders').select(ORDER_COLS).eq('status', 'open').order('sent_at').limit(1000),
      supabaseDR.from('plating_orders').select(ORDER_COLS).in('status', ['closed', 'cancelled']).order('closed_at', { ascending: false }).limit(20),
      mats.length
        ? fetchByIds(mats, part => supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand').in('mat_no', part), { orderBy: 'mat_no' })
        : Promise.resolve({ rows: [], error: null }),
    ]);
    const err = op.error?.message || rc.error?.message || st.error;
    setLiveErr(err || (op.data?.length === 1000 ? 'ใบค้างเกิน 1,000 ใบ — แสดงไม่ครบ' : ''));
    setOrders(op.data || []); setRecent(rc.data || []);
    const s = {};
    (st.rows || []).forEach(x => { s[`${x.line_name}|${x.mat_no}`] = Number(x.qty_on_hand || 0); });
    setStock(s);
  }, [matsKey]);
  useLiveBoard(loadLive, { tables: ['plating_orders'], topic: 'plating-board', enabled: masterReady });

  const groups = useMemo(() => outstandingByVendor(orders, { now: new Date(), leadDaysOf: leadOf }), [orders, leadOf]);
  const haveAt = (loc, mat) => (loc && `${loc}|${mat}` in stock ? stock[`${loc}|${mat}`] : null);
  const by = () => fullName || getActor().name || '';
  const [busy, setBusy] = useState(null);
  const rpc = async (key, fn, args, okMsg) => {
    setBusy(key);
    const { data, error } = await supabaseDR.rpc(fn, args);
    setBusy(null);
    if (error) { toast.error(`ไม่สำเร็จ — ${error.message}`); loadLive(); return null; }
    toast.success(typeof okMsg === 'function' ? okMsg(data) : okMsg);
    loadLive();
    return data ?? true;
  };

  // ── 📤 ส่งออก ──
  const [sendRoute, setSendRoute] = useState('');
  const [sendQty, setSendQty] = useState('');
  const [sendDoc, setSendDoc] = useState('');
  const [sendVendor, setSendVendor] = useState('');
  const route = okRoutes.find(r => `${r.after}|${r.before}` === sendRoute) || null;
  const vendorForSend = sendVendor || route?.vendor || '';
  const fromLoc = route ? locOf(route.before) : null;
  const fromHave = route ? haveAt(fromLoc, route.before) : null;
  const blockSend = route ? sendBlockReason({ route, qty: sendQty, fromLoc }) : 'เลือกพาร์ทที่จะส่งชุบ';
  const warnSend = route ? sendStockWarn({ qty: sendQty, have: fromHave, fromLoc }) : null;
  const doSend = async () => {
    if (blockSend) { toast.error(blockSend); return; }
    const ok = await rpc('send', 'plating_send', {
      p_vendor: vendorForSend, p_before: route.before, p_after: route.after, p_qty: Number(sendQty),
      p_from_loc: fromLoc, p_doc_no: sendDoc, p_note: null, p_by: by(),
    }, `📤 ส่ง ${route.before} ${fmt(sendQty)} ชิ้น ไป ${vendorForSend} แล้ว`);
    if (ok) { setSendQty(''); setSendDoc(''); }
  };

  // ── 📥 รับคืน (ต่อ ร้าน+หลังชุบ) ──
  const [recvFor, setRecvFor] = useState(null);     // `${vendor}|${after}`
  const [recvQty, setRecvQty] = useState('');
  const doReceive = async (vendor, it) => {
    const toLoc = locOf(it.after);
    const q = Number(recvQty);
    if (!toLoc) { toast.error(`ยังไม่มีกฎรับเข้าคลังของ ${it.after} — ตั้งที่ /line-stock?tab=inflow ก่อน`); return; }
    if (!(q > 0)) { toast.error('ใส่จำนวนที่นับได้'); return; }
    if (q > it.open) { toast.error(`รับเกินยอดค้างร้าน (ค้าง ${fmt(it.open)}) — ตรวจนับอีกครั้ง`); return; }
    const ok = await rpc(`recv|${vendor}|${it.after}`, 'plating_receive', {
      p_vendor: vendor, p_after: it.after, p_qty: q, p_to_loc: toLoc, p_note: null, p_by: by(),
    }, `📥 รับ ${it.after} ${fmt(q)} ชิ้น เข้า ${toLoc}`);
    if (ok) { setRecvFor(null); setRecvQty(''); }
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
  };

  // ── 🏬 หลังชุบในคลัง → W/H ──
  const afterStock = useMemo(() => {
    const seen = new Set();
    return okRoutes.filter(r => (seen.has(r.after) ? false : seen.add(r.after))).map(r => {
      const loc = locOf(r.after);
      return { ...r, loc, have: loc ? (stock[`${loc}|${r.after}`] ?? null) : null, targets: toWhTargets(r.after, { products, bomRows }) };
    });
  }, [okRoutes, locOf, stock, products, bomRows]);
  const [whQty, setWhQty] = useState({});            // after → qty
  const [whFg, setWhFg] = useState({});              // after → fg
  const doToWh = async (a) => {
    const direct = a.targets.filter(t => t.direct);
    const fg = whFg[a.after] || (direct.length === 1 ? direct[0].fg : '');
    const t = direct.find(x => x.fg === fg);
    const q = Number(whQty[a.after]);
    const toLoc = t ? locOf(t.fg) : null;
    if (!t) { toast.error('เลือก FG ที่จะแปลงเข้า'); return; }
    if (!toLoc) { toast.error(`ยังไม่มีกฎรับเข้าคลังของ ${t.fg} — ตั้งที่ /line-stock?tab=inflow ก่อน`); return; }
    if (!(q > 0)) { toast.error('ใส่จำนวน'); return; }
    const ok = await rpc(`wh|${a.after}`, 'plating_to_wh', {
      p_after: a.after, p_fg: t.fg, p_qty: q, p_from_loc: a.loc, p_to_loc: toLoc, p_note: null, p_by: by(),
    }, (d) => `🏬 ส่ง ${a.after} ${fmt(q)} → ${toLoc} เป็น ${t.fg} ${fmt(d?.fg_qty)} ชิ้น`);
    if (ok) setWhQty(m => ({ ...m, [a.after]: '' }));
  };

  // ── ⚙️ ตั้งเส้นทาง ──
  const [setupOpen, setSetupOpen] = useState(false);
  const [suBefore, setSuBefore] = useState('');
  const [suAfter, setSuAfter] = useState('');
  const [suName, setSuName] = useState('');
  const [suVendor, setSuVendor] = useState('');
  const [suProc, setSuProc] = useState('');
  const suAfterInMaster = products.some(p => p.mat_no === suAfter.trim());
  const cands = useMemo(() => afterCandidates(suBefore, { products, bomRows }), [suBefore, products, bomRows]);
  const directUses = useMemo(() => directUsesOfBefore(suBefore, suAfter.trim(), { products, bomRows }), [suBefore, suAfter, products, bomRows]);
  const doSetup = async () => {
    const ok = await rpc('setup', 'plating_setup_route', {
      p_before: suBefore, p_after: suAfter.trim(), p_after_name: suName || null, p_vendor: suVendor,
      p_process_type: suProc || null, p_by: by(),
    }, (d) => `⚙️ ตั้งเส้นทาง ${suBefore} → ${suAfter.trim()} (${suVendor}) แล้ว${d?.product_created ? ' · สร้างสินค้าหลังชุบใน Product Master' : ''}${d?.bom_created ? ' · เพิ่มขา BOM' : ''}`);
    if (ok) reloadMaster();
  };
  const doLayer = async (u) => {
    const ok = await rpc(`layer|${u.row.id}`, 'plating_bom_insert_layer', { p_row_id: u.row.id, p_after: suAfter.trim(), p_by: by() },
      `🌳 แทรกชั้น ${suAfter.trim()} ในใบ BOM ของ ${u.parent} แล้ว`);
    if (ok) reloadMaster();
  };
  const dropRoute = async (r) => {
    if (!window.confirm(`เลิกใช้เส้นทางชุบของ ${r.after} (${r.vendor})?\nใบที่ค้างร้านอยู่ยังรับคืนได้ตามปกติ · BOM ไม่ถูกแตะ`)) return;
    setBusy(`drop|${r.after}`);
    const ok = checkWriteRows(await supabaseDR.from('dr_products').update({ outsource_vendor: null }).eq('mat_no', r.after).select('id'), 'เลิกเส้นทางชุบ');
    setBusy(null);
    if (ok) { toast.success(`เลิกเส้นทางชุบ ${r.after} แล้ว`); reloadMaster(); }
  };

  const totalOpen = groups.reduce((a, g) => a + g.open, 0);
  const problems = routes.filter(r => r.problem);
  const vendorsWithOpenNoRoute = groups.filter(g => !routes.some(r => r.vendor === g.vendor));

  return (
    <div style={{ display: 'grid', gap: 12, padding: 12, alignContent: 'start' }}>
      {masterErr && <div style={errTxt}>⚠ โหลดทะเบียนสินค้า/BOM/กฎคลังไม่ครบ — {masterErr} · เส้นทางบนจออาจขาด</div>}
      {liveErr && <div style={errTxt}>⚠ โหลดใบค้างร้าน/ยอดคลังไม่ครบ — {liveErr} · ตัวเลขบนจออาจขาด</div>}

      {/* สรุปต่อร้าน */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {groups.length === 0 && (
          <div style={{ ...box, flex: '1 1 260px', ...muted }}>
            {masterReady ? 'ไม่มีงานค้างที่ร้านชุบ' : 'กำลังโหลด…'}
            {masterReady && okRoutes.length === 0 && ' · ยังไม่มีเส้นทางชุบ — ตั้งที่ ⚙️ ด้านล่าง (เลือกเลขก่อนชุบ + เลขหลังชุบ + ร้าน)'}
          </div>
        )}
        {groups.map(g => {
          const oldest = g.items.reduce((m, it) => Math.max(m, it.ageDays ?? 0), 0);
          const late = g.items.some(it => it.overdue);
          return (
            <div key={g.vendor} style={{ ...box, flex: '1 1 220px', borderColor: late ? '#ef4444' : 'var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>🧪 {g.vendor}</div>
              <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{fmt(g.open)} <span style={{ fontSize: 12, color: 'var(--muted)' }}>ชิ้นค้างร้าน</span></div>
              <div style={muted}>{g.orders} ใบ · {g.items.length} พาร์ท · เก่าสุด {oldest} วัน
                {g.leadDays == null ? ' · ยังไม่ตั้ง lead time ของร้าน (ทะเบียน Supplier)' : ` · lead time ${g.leadDays} วัน`}</div>
              {late && <div style={errTxt}>มีงานเกิน lead time</div>}
            </div>
          );
        })}
      </div>

      {/* 📤 ส่งออก */}
      <div style={box}>
        <h3 style={h3}>📤 ส่งงานก่อนชุบออกไปร้าน</h3>
        {!canSend && <div style={warnTxt}>บัญชีนี้ไม่มีสิทธิ์ส่งชุบ (plating:send) — ดูได้อย่างเดียว</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select value={sendRoute} onChange={e => { setSendRoute(e.target.value); setSendVendor(''); }} style={{ ...inp, minWidth: 260, flex: '2 1 260px' }} aria-label="เส้นทางชุบ">
            <option value="">— เลือกพาร์ทก่อนชุบ —</option>
            {okRoutes.map(r => (
              <option key={`${r.after}|${r.before}`} value={`${r.after}|${r.before}`}>
                {r.before} {r.beforeName} → {r.after} · {r.vendor}
              </option>
            ))}
          </select>
          <input type="number" min="0" inputMode="numeric" placeholder="จำนวน" value={sendQty} onChange={e => setSendQty(e.target.value)} style={{ ...inp, width: 110 }} aria-label="จำนวนที่ส่ง" />
          <input placeholder="เลขใบส่งของ (ถ้ามี)" value={sendDoc} onChange={e => setSendDoc(e.target.value)} style={{ ...inp, flex: '1 1 160px' }} aria-label="เลขใบส่งของ" />
          <button type="button" disabled={!canSend || !!blockSend || busy === 'send'} onClick={doSend} style={storeBtn('primary', { opacity: (!canSend || blockSend) ? 0.5 : 1 })}>
            {busy === 'send' ? 'กำลังบันทึก…' : '📤 ส่งออก'}
          </button>
        </div>
        {route && (
          <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5 }}>ร้าน:</span>
              <div style={{ minWidth: 220 }}>
                <SupplierSelect value={vendorForSend} onChange={({ supplier }) => setSendVendor(supplier || '')} kinds={['service']} />
              </div>
              <span style={muted}>ค่าเริ่มต้นจากเส้นทาง ({route.vendor}) — เปลี่ยนได้รายใบ ถ้าครั้งนี้ส่งร้านอื่น</span>
            </div>
            <div style={muted}>ตัดของจาก <b>{fromLoc || '—'}</b>{fromLoc && <> · ระบบเห็นคงเหลือ {fromHave == null ? 'ไม่มีข้อมูลสต็อก' : `${fmt(fromHave)} ชิ้น`}</>}</div>
            {blockSend && sendQty !== '' && <div style={errTxt}>{blockSend}</div>}
            {warnSend && <div style={warnTxt}>{warnSend}</div>}
          </div>
        )}
      </div>

      {/* ⏳ ค้างร้าน + 📥 รับคืน */}
      <div style={box}>
        <h3 style={h3}>📥 ค้างร้าน / รับงานหลังชุบคืน · รวม {fmt(totalOpen)} ชิ้น</h3>
        {!canReceive && <div style={warnTxt}>บัญชีนี้ไม่มีสิทธิ์รับคืน (plating:receive) — ดูได้อย่างเดียว</div>}
        <div style={muted}>นับของที่ร้านส่งคืนก่อนกดรับ · รับทยอยได้ ระบบตัดใบที่ส่งไปก่อนให้เอง · ของเข้าคลังตามกฎรับเข้าของเลขหลังชุบ</div>
        {vendorsWithOpenNoRoute.length > 0 && <div style={warnTxt}>ร้าน {vendorsWithOpenNoRoute.map(g => g.vendor).join(', ')} มีของค้างแต่ไม่มีเส้นทางที่ใช้งานแล้ว — ยังรับคืนได้ตามปกติ</div>}
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {groups.flatMap(g => g.items.map(it => {
            const k = `${g.vendor}|${it.after}`;
            const toLoc = locOf(it.after);
            return (
              <div key={k} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: 10, borderRadius: 'var(--radius)', background: 'var(--bg2)', border: `1px solid ${it.overdue ? '#ef4444' : 'var(--border)'}` }}>
                <PartThumb url={imgOf(it.after) || imgOf(it.before)} size={44} />
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800 }}>{it.after} <span style={{ fontWeight: 600 }}>{it.partName}</span></div>
                  <div style={muted}>🧪 {g.vendor} · ส่งไปเป็น {it.before} · {it.orders.length} ใบ · เก่าสุด {it.ageDays ?? '—'} วัน
                    {it.overdue && <b style={{ color: '#ef4444' }}> · เกิน lead time</b>}</div>
                  <div style={{ fontSize: 12.5 }}>ส่ง {fmt(it.sent)} · รับแล้ว {fmt(it.received)} · <b>ค้าง {fmt(it.open)}</b> · เข้าคลัง {toLoc || <span style={errTxt}>ไม่มีกฎรับเข้า</span>}</div>
                </div>
                {recvFor === k ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input type="number" min="0" inputMode="numeric" autoFocus placeholder="นับได้" value={recvQty} onChange={e => setRecvQty(e.target.value)} style={{ ...inp, width: 100 }} aria-label="จำนวนที่รับ" />
                    <button type="button" disabled={busy === `recv|${k}`} onClick={() => doReceive(g.vendor, it)} style={storeBtn('primary')}>✅ รับเข้า</button>
                    <button type="button" onClick={() => { setRecvFor(null); setRecvQty(''); }} style={storeBtn('secondary')}>ยกเลิก</button>
                  </div>
                ) : (
                  <button type="button" disabled={!canReceive} onClick={() => { setRecvFor(k); setRecvQty(''); }} style={storeBtn('primary', { opacity: canReceive ? 1 : 0.5 })}>📥 รับคืน</button>
                )}
              </div>
            );
          }))}
        </div>
        {groups.length > 0 && canWriteoff && (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>✂️ ตัดยอดค้างร้าน (ปีละครั้ง)</div>
            {groups.map(g => (
              <div key={g.vendor} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, minWidth: 120 }}>{g.vendor} · ค้าง {fmt(g.open)}</span>
                {woFor === g.vendor ? (
                  <>
                    <input placeholder="เหตุผล (เช่น ตัดยอดสิ้นปี 2026 ตามที่ตกลงกับร้าน)" value={woReason} onChange={e => setWoReason(e.target.value)} style={{ ...inp, flex: '1 1 260px' }} aria-label="เหตุผลการตัดยอด" />
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

      {/* 🏬 หลังชุบในคลัง → W/H */}
      <div style={box}>
        <h3 style={h3}>🏬 งานหลังชุบในคลัง → ส่งเข้า W/H</h3>
        {!canToWh && <div style={warnTxt}>บัญชีนี้ไม่มีสิทธิ์ส่งเข้า W/H (plating:to_wh) — ดูได้อย่างเดียว</div>}
        <div style={muted}>ระบบแปลงเป็นเบอร์ 1xx ตาม BOM ให้เอง — ทำได้เฉพาะ FG ที่มีลูกเป็นงานหลังชุบตัวเดียว · FG ที่ต้องประกอบต่อ ส่งไปไลน์ตามใบผลิตปกติ</div>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {afterStock.length === 0 && <div style={muted}>ยังไม่มีเส้นทางชุบ</div>}
          {afterStock.map(a => {
            const direct = a.targets.filter(t => t.direct);
            const asm = a.targets.filter(t => !t.direct);
            const fg = whFg[a.after] || (direct.length === 1 ? direct[0].fg : '');
            return (
              <div key={a.after} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: 10, borderRadius: 'var(--radius)', background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                <PartThumb url={imgOf(a.after)} size={44} />
                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800 }}>{a.after} <span style={{ fontWeight: 600 }}>{a.afterName}</span></div>
                  <div style={{ fontSize: 12.5 }}>
                    {a.loc ? <>ใน {a.loc}: <b>{a.have == null ? 'ไม่มีข้อมูลสต็อก' : `${fmt(a.have)} ชิ้น`}</b></> : <span style={errTxt}>ไม่มีกฎรับเข้าคลังของเลขนี้</span>}
                  </div>
                  {a.targets.length === 0 && <div style={warnTxt}>ยังไม่มี FG ใช้เลขนี้ใน BOM — แปลงเป็น 1xx ไม่ได้ (ตั้ง BOM ของ FG ก่อน)</div>}
                  {asm.map(t => (
                    <div key={t.fg} style={muted}>🔧 {t.fg} {t.name} — ประกอบที่ {t.line || 'ไลน์ (ยังไม่ระบุใน Product Master)'} ร่วมกับ {t.others.slice(0, 3).join(', ')}{t.others.length > 3 ? ` +${t.others.length - 3}` : ''}</div>
                  ))}
                </div>
                {direct.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {direct.length > 1 ? (
                      <select value={fg} onChange={e => setWhFg(m => ({ ...m, [a.after]: e.target.value }))} style={inp} aria-label="FG ปลายทาง">
                        <option value="">— เลือก FG —</option>
                        {direct.map(t => <option key={t.fg} value={t.fg}>{t.fg} {t.name}</option>)}
                      </select>
                    ) : <span style={{ fontSize: 12.5 }}>→ <b>{direct[0].fg}</b> {direct[0].qpu !== 1 ? `(ใช้ ${direct[0].qpu} ต่อ 1)` : ''}</span>}
                    <input type="number" min="0" inputMode="numeric" placeholder="จำนวน" value={whQty[a.after] || ''} onChange={e => setWhQty(m => ({ ...m, [a.after]: e.target.value }))} style={{ ...inp, width: 100 }} aria-label="จำนวนส่งเข้า W/H" />
                    <button type="button" disabled={!canToWh || busy === `wh|${a.after}` || !a.loc} onClick={() => doToWh(a)} style={storeBtn('primary', { opacity: canToWh && a.loc ? 1 : 0.5 })}>🏬 ส่งเข้า W/H</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ⚙️ ตั้งเส้นทาง */}
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ ...h3, margin: 0 }}>⚙️ เส้นทางชุบ ({okRoutes.length})</h3>
          {problems.length > 0 && <span style={errTxt}>{problems.length} เส้นทางยังไม่ครบ</span>}
          <button type="button" onClick={() => setSetupOpen(v => !v)} style={{ ...storeBtn('secondary'), marginLeft: 'auto' }}>{setupOpen ? '▾ ซ่อน' : '▸ ตั้ง/แก้เส้นทาง'}</button>
        </div>
        <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          {routes.map(r => (
            <div key={`${r.after}|${r.before || '-'}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
              <span>{r.before || <span style={errTxt}>?</span>} → <b>{r.after}</b> {r.afterName} · 🧪 {r.vendor}</span>
              {!r.afterActive && <span style={muted}>(ปิดในจอผลิต)</span>}
              {r.problem && <span style={errTxt}>{r.problem}</span>}
              {canSetup && <button type="button" disabled={busy === `drop|${r.after}`} onClick={() => dropRoute(r)} style={{ ...storeBtn('secondary', { minHeight: 32, padding: '4px 10px', fontSize: 12 }) }}>เลิกใช้</button>}
            </div>
          ))}
        </div>
        {setupOpen && (
          <div style={{ display: 'grid', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            {!canSetup && <div style={warnTxt}>บัญชีนี้ไม่มีสิทธิ์ตั้งเส้นทาง (plating:setup)</div>}
            <label style={{ fontSize: 12.5, fontWeight: 700 }}>1) เลขก่อนชุบ (2xx ที่ planner ส่งออก)</label>
            <ProductSelect value={suBefore} onChange={({ mat_no }) => { setSuBefore(mat_no || ''); setSuAfter(''); }} products={products} includeInactive />
            {suBefore && (
              <>
                <label style={{ fontSize: 12.5, fontWeight: 700 }}>2) เลขหลังชุบ (2xx เลขใหม่ที่สโตร์รับคืน)</label>
                {cands.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={muted}>BOM มีตัวแม่ของ {suBefore} อยู่แล้ว:</span>
                    {cands.map(c => (
                      <button key={c.mat} type="button" onClick={() => setSuAfter(c.mat)} style={storeBtn(suAfter === c.mat ? 'primary' : 'secondary', { minHeight: 34, padding: '4px 10px', fontSize: 12 })}>
                        {c.mat} {c.name}{c.vendor ? ` · 🧪 ${c.vendor}` : ''}{!c.inMaster ? ' · ยังไม่อยู่ใน Product Master' : ''}
                      </button>
                    ))}
                  </div>
                )}
                <ProductSelect value={suAfter} onChange={({ mat_no }) => setSuAfter(mat_no || '')} products={products} includeInactive allowFree
                  freeHint="เลข SAP ใหม่ — ระบบจะสร้างสินค้าหลังชุบใน Product Master ให้" />
                {suAfter && !suAfterInMaster && (
                  <input placeholder="ชื่อสินค้าหลังชุบ (เว้นว่าง = ใช้ชื่อก่อนชุบ)" value={suName} onChange={e => setSuName(e.target.value)} style={inp} aria-label="ชื่อสินค้าหลังชุบ" />
                )}
                <label style={{ fontSize: 12.5, fontWeight: 700 }}>3) ร้านชุบ (จากทะเบียน Supplier — เพิ่มร้านใหม่ได้ที่ /products แท็บ 🏭 Supplier)</label>
                <SupplierSelect value={suVendor} onChange={({ supplier }) => setSuVendor(supplier || '')} kinds={['service']} />
                {suAfter && !suAfterInMaster && (
                  <select value={suProc} onChange={e => setSuProc(e.target.value)} style={inp} aria-label="กระบวนการของสินค้าหลังชุบ">
                    <option value="">— กระบวนการ (ไม่ระบุก็ได้) —</option>
                    {procTypes.map(p => <option key={p.key} value={p.key}>{p.icon} {p.label}</option>)}
                  </select>
                )}
                <div>
                  <button type="button" disabled={!canSetup || !suAfter.trim() || !suVendor.trim() || busy === 'setup'} onClick={doSetup}
                    style={storeBtn('primary', { opacity: canSetup && suAfter.trim() && suVendor.trim() ? 1 : 0.5 })}>💾 บันทึกเส้นทาง</button>
                </div>
                {suAfter.trim() && directUses.length > 0 && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={warnTxt}>BOM {directUses.length} บรรทัดยังใช้ {suBefore} (ก่อนชุบ) ตรงๆ — ถ้าตัวแม่ใช้งานหลังชุบจริง กดแทรกชั้น {suAfter.trim()} ให้ (ลูกหลานเดิมตามมาครบ)</div>
                    {directUses.map(u => (
                      <div key={u.row.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
                        <span>{u.parent} {u.parentName} → {suBefore} × {u.row.qty_per_unit}</span>
                        <button type="button" disabled={!canSetup || !suAfterInMaster || busy === `layer|${u.row.id}`} onClick={() => doLayer(u)}
                          style={storeBtn('secondary', { minHeight: 32, padding: '4px 10px', fontSize: 12, opacity: canSetup && suAfterInMaster ? 1 : 0.5 })}>🌳 แทรกชั้นหลังชุบ</button>
                        {!suAfterInMaster && <span style={muted}>บันทึกเส้นทางก่อน</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ประวัติล่าสุด */}
      {recent.length > 0 && (
        <div style={box}>
          <h3 style={h3}>🧾 ใบที่ปิดล่าสุด</h3>
          <div style={{ display: 'grid', gap: 3 }}>
            {recent.map(o => (
              <div key={o.id} style={{ fontSize: 12, color: 'var(--text2)' }}>
                {String(o.closed_at || o.sent_at || '').slice(0, 10)} · {o.vendor} · {o.before_mat} → {o.after_mat} · ส่ง {fmt(o.qty_sent)} · รับ {fmt(o.qty_received)}
                {Number(o.qty_written_off) > 0 && ` · ตัดยอด ${fmt(o.qty_written_off)}`} · {o.closed_reason || o.status}
                {openQtyOf(o) > 0 && o.status !== 'open' && ' (ยังมีค้าง)'}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
