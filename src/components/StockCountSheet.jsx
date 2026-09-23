import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { checkWrite } from '../utils/dbWrite';
import { fetchAllPages } from '../utils/fetchByIds';
import { getWorkDate } from '../utils/workDate';
import { buildPnIndex, pickStockMat, matIssueText } from '../utils/matResolve';
import { countDelta, toAdjustTxns, countSummary, lastCountAt, pendingShipCuts } from '../utils/stockCount';
import LineSelect from './LineSelect';

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
  const { fullName } = useContext(UserContext);
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

  const [lineFilter, setLineFilter] = useState('');
  const [counts,  setCounts]  = useState({});   // mat_no → ยอดที่นับได้ (string)
  const [note,    setNote]    = useState('');
  const [workDate, setWorkDate] = useState(getWorkDate());
  const [hideZero, setHideZero] = useState(false);
  const [approveNow, setApproveNow] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [cutting, setCutting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [sum, adj, sh, cut, dp, ks, rules, pl] = await Promise.all([
      fetchAllPages(() => supabaseDR.from('line_stock_summary').select('line_name, mat_no, part_name, qty_on_hand'),
        { orderBy: ['line_name', 'mat_no'] }),
      fetchAllPages(() => supabaseDR.from('line_stock_transactions')
        .select('line_name, mat_no, type, status, created_at').eq('type', 'adjust').eq('status', 'approved'),
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
      supabase.from('production_lines').select('id, name, parent_line_name, section, is_active, line_type').order('name'),
    ]);
    setLoading(false);
    // ห้ามกลืน error — คิวรีล้มแล้วจอขึ้นเหมือน "ไม่มีข้อมูล" คือคลาสบั๊กที่โปรเจคเจอซ้ำ
    const firstErr = sum.error || adj.error || sh.error || cut.error || dp.error || ks.error || rules.error || pl.error;
    if (firstErr) { toast.error('โหลดข้อมูลสต็อกไม่สำเร็จ: ' + firstErr); return; }
    setStock(sum.rows);
    setLines(pl.data || []);
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
    // แถวที่หักแล้วจะทำให้คงเหลือติดลบ = "ของออกไปแล้วแต่ไม่เคยถูกบันทึกรับเข้า" — ต้องบอกก่อน ห้ามเงียบ
    const onHand = {};
    stock.forEach(s => { if (s.line_name === fgDest) onHand[s.mat_no] = parseFloat(s.qty_on_hand) || 0; });
    const after = { ...onHand };
    shipGap.open.forEach(o => { after[o.sap] = (after[o.sap] ?? 0) - (Number(o.qty) || 0); });
    const neg = Object.entries(after).filter(([, v]) => v < 0);
    const warn = neg.length
      ? `\n\n⚠️ หลังหักจะมี ${neg.length} พาร์ทคงเหลือติดลบ — แปลว่าของออกไปแล้วแต่ "ขาเข้า" ไม่เคยถูกบันทึก`
        + `\n(ติดลบคือสัญญาณให้ไปแก้ที่การปิดใบผลิต/กฎรับเข้า แล้วเคลียร์ด้วยการตรวจนับข้างล่าง)`
      : '';
    if (!window.confirm(
      `หักสต็อกย้อนหลัง ${shipGap.open.length} ใบ รวม ${n0(openQty)} ชิ้น ออกจาก ${fgDest}?`
      + `\n(ใบที่ส่งก่อนรอบตรวจนับล่าสุดถูกกันออกแล้ว ${shipGap.closedByCount.length} ใบ — ยอดที่นับสะท้อนไปแล้ว)`
      + warn)) return;
    setCutting(true);
    const rows = shipGap.open.map(o => ({
      line_name: fgDest, mat_no: o.sap, part_name: o.part_name || null,
      qty: Number(o.qty) || 0, type: 'consume', status: 'approved', work_date: workDate,
      note: `กระทบยอดย้อนหลัง: ส่งลูกค้า ${o.customer || ''} · ${o.due_date || ''} ${o.ship_time || ''}`
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
    if (ok) { toast.success(`✅ หักแล้ว ${rows.length} ใบ · ${n0(openQty)} ชิ้น`); load(); }
  };

  /* ── 📋 ตารางตรวจนับ ────────────────────────────────────────────────────── */
  // คลังที่ไม่ใช่ไลน์ผลิต — derive จากของที่มีจริง ไม่ hardcode ชื่อคลัง (pattern เดียวกับแท็บ 📦 Stock)
  const warehouseNames = useMemo(
    () => [...new Set(stock.map(s => s.line_name))].filter(n => n && !lines.some(l => l.name === n)).sort(),
    [stock, lines]);
  const rows = useMemo(() => {
    let r = lineFilter ? stock.filter(s => s.line_name === lineFilter) : [];
    if (hideZero) r = r.filter(s => (parseFloat(s.qty_on_hand) || 0) !== 0);
    return [...r].sort((a, b) => String(a.mat_no).localeCompare(String(b.mat_no)));
  }, [stock, lineFilter, hideZero]);

  const summary = useMemo(() => countSummary({ rows, counts }), [rows, counts]);

  const save = async () => {
    const txns = toAdjustTxns({ rows, lineName: lineFilter, workDate, by: fullName, note, counts });
    if (!txns.length) { toast.info('ยังไม่มีแถวที่ยอดต่างจากระบบ'); return; }
    const approved = approveNow && canApprove;
    if (!window.confirm(
      `บันทึกผลตรวจนับ ${txns.length} รายการที่ ${lineFilter}?`
      + `\n📈 เพิ่ม ${summary.up} พาร์ท (${n0(summary.upQty)} ชิ้น) · 📉 ลด ${summary.down} พาร์ท (${n0(summary.downQty)} ชิ้น)`
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
      ? `✅ เฟิร์มยอดแล้ว ${txns.length} รายการ`
      : `⏳ ส่งผลตรวจนับ ${txns.length} รายการ — รอสโตร์อนุมัติที่แท็บ 📦 Stock`);
    setCounts({}); setNote('');
    load();
  };

  if (loading) return <div style={{ ...card, textAlign:'center', color:'var(--muted)' }}>กำลังโหลด…</div>;

  return (
    <div style={{ display:'grid', gap:16, alignContent:'start' }}>

      {/* ── 🚚 ส่งแล้วแต่ยังไม่ถูกหัก ─────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'center', marginBottom:8 }}>
          <div style={{ fontSize:15, fontWeight:800 }}>🚚 ส่งลูกค้าแล้ว แต่ยังไม่ถูกหักออกจากคลัง</div>
          {!!shipGap.open.length && (
            <span style={{ fontSize:12, fontWeight:800, background:'#ef444422', color:'#ef4444', padding:'3px 10px', borderRadius:999 }}>
              {shipGap.open.length} ใบ · {n0(openQty)} ชิ้น
            </span>
          )}
        </div>
        <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.65, marginBottom:10 }}>
          หน้า 🚚 Delivery หักสต็อกให้อัตโนมัติตอนกด “ส่งแล้ว” — ใบที่หักไม่ได้ (จับคู่เลข SAP ไม่ได้
          หรือของไม่เคยถูกบันทึกเข้าคลัง) จะเตือนบนจอครั้งเดียวแล้วหายไป ยอดคงเหลือจึงค้างสูงกว่าจริง
          <br />
          🔴 ใบที่ส่ง <b>ก่อน</b> รอบตรวจนับล่าสุดของพาร์ทนั้นถูกกันออกแล้ว
          {shipGap.closedByCount.length > 0 && <> ({shipGap.closedByCount.length} ใบ)</>} —
          ยอดที่นับได้สะท้อนของที่ออกไปแล้ว หักซ้ำจะทำให้ยอดหายสองเท่า
        </div>

        {!fgDest ? (
          <div style={{ fontSize:13, color:'#f59e0b' }}>
            ⚠️ ยังไม่มีกฎรับเข้าอัตโนมัติของ FG (เลขขึ้นต้น 1) — ตั้งที่แท็บ ⚙️ รับเข้าอัตโนมัติ ก่อน
            ระบบจึงจะรู้ว่าต้องหักออกจากคลังไหน
          </div>
        ) : !shipGap.open.length && !shipGap.unresolved.length ? (
          <div style={{ fontSize:13, color:'var(--accent)' }}>✅ ไม่มีใบค้าง — ยอดขาออกตรงกับ ledger ทั้งหมด</div>
        ) : (
          <>
            {!!shipGap.open.length && (
              <div style={{ overflowX:'auto', marginBottom:10 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', minWidth:640 }}>
                  <thead><tr>
                    <th style={th}>วันส่ง</th><th style={th}>ลูกค้า</th><th style={th}>เลขบนใบ</th>
                    <th style={th}>→ MAT SAP</th><th style={{ ...th, textAlign:'right' }}>จำนวน</th>
                    <th style={{ ...th, textAlign:'right' }}>คงเหลือหลังหัก</th>
                  </tr></thead>
                  <tbody>
                    {shipGap.open.slice(0, 200).map(o => {
                      const cur = stock.find(s => s.line_name === fgDest && s.mat_no === o.sap);
                      const after = (parseFloat(cur?.qty_on_hand) || 0) - (Number(o.qty) || 0);
                      return (
                        <tr key={o.id}>
                          <td style={td}>{o.due_date} {o.ship_time?.slice(0, 5) || ''}</td>
                          <td style={td}>{o.customer || '—'}</td>
                          <td style={{ ...td, fontFamily:'monospace' }}>{o.mat_no}</td>
                          <td style={{ ...td, fontFamily:'monospace' }}>{o.sap}</td>
                          <td style={{ ...td, textAlign:'right', fontWeight:700 }}>{n0(o.qty)}</td>
                          <td style={{ ...td, textAlign:'right', color: after < 0 ? '#ef4444' : 'var(--text2)' }}>{n0(after)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {shipGap.open.length > 200 && (
                  <div style={{ fontSize:12, color:'var(--muted)', padding:'6px 2px' }}>
                    …แสดง 200 จาก {shipGap.open.length} ใบ (ปุ่มหักทำครบทุกใบ)
                  </div>
                )}
              </div>
            )}

            {!!shipGap.unresolved.length && (
              <div style={{ fontSize:12, color:'#f59e0b', marginBottom:10, lineHeight:1.6 }}>
                ⚠️ อีก {shipGap.unresolved.length} ใบ ({n0(shipGap.unresolved.reduce((s, o) => s + (Number(o.qty) || 0), 0))} ชิ้น)
                จับคู่เลข SAP ไม่ได้ — ระบบไม่เดาให้ ต้องแก้ p_no ที่ Product Master ก่อน เช่น{' '}
                {shipGap.unresolved.slice(0, 3).map(o => o.mat_no).join(', ')}
                <div style={{ marginTop:2 }}>
                  {matIssueText(shipGap.unresolved[0].mat_no, pickStockMat(shipGap.unresolved[0].mat_no, pnIndex, hasStockOf)) || ''}
                </div>
              </div>
            )}

            {canCount && !!shipGap.open.length && (
              <button style={{ ...btn('#ef4444'), opacity: cutting ? 0.6 : 1 }} disabled={cutting} onClick={postMissingCuts}>
                {cutting ? 'กำลังหัก…' : `🚚 หักย้อนหลัง ${shipGap.open.length} ใบ (${n0(openQty)} ชิ้น)`}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── 📋 ตรวจนับ / เฟิร์มยอด ─────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize:15, fontWeight:800, marginBottom:6 }}>📋 ตรวจนับ / เฟิร์มยอด</div>
        <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.65, marginBottom:12 }}>
          กรอก <b>ยอดที่นับได้จริง</b> (ไม่ใช่ผลต่าง) ระบบคิดส่วนต่างให้เอง แล้วบันทึกเป็นรายการ 🔧 ปรับยอดทีเดียวทั้งคลัง
          · เว้นว่าง = ยังไม่นับ ไม่แตะยอดเดิม · กรอก 0 = นับแล้วไม่มีของ
        </div>

        <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'center', marginBottom:12 }}>
          <LineSelect
            lines={lines} value={lineFilter} onChange={setLineFilter} {...scope}
            placeholder="— เลือกไลน์/คลังที่จะนับ —"
            style={{ width:260, padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg2)', color:'var(--text)', fontSize:13 }}
            extraGroups={[{ label: '🏬 คลัง', options: warehouseNames.map(n => ({ value: n })) }]}
          />
          <label style={{ fontSize:12, color:'var(--muted)' }}>
            วันที่นับ{' '}
            <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)}
              style={{ width:150, padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg2)', color:'var(--text)', fontSize:13 }} />
          </label>
          <label style={{ fontSize:12, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
            <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} style={{ width:'auto' }} />
            ซ่อนพาร์ทที่ยอดเป็น 0
          </label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="หมายเหตุรอบนับ (ไม่บังคับ)"
            style={{ width:220, padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg2)', color:'var(--text)', fontSize:13 }} />
        </div>

        {!lineFilter ? (
          <div style={{ fontSize:13, color:'var(--muted)' }}>เลือกไลน์/คลังก่อน แล้วรายการพาร์ทจะขึ้นให้กรอก</div>
        ) : !rows.length ? (
          <div style={{ fontSize:13, color:'var(--muted)' }}>ไม่มีพาร์ทในคลังนี้{hideZero && ' (ที่ยอดไม่เป็น 0)'}</div>
        ) : (
          <>
            <div style={{ overflowX:'auto', maxHeight:'60vh', overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth:620 }}>
                <thead><tr>
                  <th style={{ ...th, position:'sticky', top:0, background:'var(--card)', zIndex:1 }}>MAT</th>
                  <th style={{ ...th, position:'sticky', top:0, background:'var(--card)', zIndex:1 }}>ชื่อชิ้นงาน</th>
                  <th style={{ ...th, position:'sticky', top:0, background:'var(--card)', zIndex:1, textAlign:'right' }}>ยอดในระบบ</th>
                  <th style={{ ...th, position:'sticky', top:0, background:'var(--card)', zIndex:1, textAlign:'right' }}>นับได้จริง</th>
                  <th style={{ ...th, position:'sticky', top:0, background:'var(--card)', zIndex:1, textAlign:'right' }}>ผลต่าง</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => {
                    const d = countDelta(r.qty_on_hand, counts[r.mat_no]);
                    const typed = counts[r.mat_no] !== undefined && counts[r.mat_no] !== '';
                    return (
                      <tr key={r.mat_no}>
                        <td style={{ ...td, fontFamily:'monospace', fontWeight:700 }}>{r.mat_no}</td>
                        <td style={{ ...td, color:'var(--text2)' }}>{r.part_name || '—'}</td>
                        <td style={{ ...td, textAlign:'right' }}>{n0(r.qty_on_hand)}</td>
                        <td style={{ ...td, textAlign:'right' }}>
                          <input type="number" inputMode="numeric" min="0" style={numIn}
                            value={counts[r.mat_no] ?? ''}
                            onChange={e => setCounts(c => ({ ...c, [r.mat_no]: e.target.value }))} />
                        </td>
                        <td style={{ ...td, textAlign:'right', fontWeight:800,
                          color: !d ? (typed ? 'var(--accent)' : 'var(--muted)') : d.dir === 'up' ? '#22c55e' : '#ef4444' }}>
                          {!d ? (typed ? 'ตรง' : '—') : `${d.delta > 0 ? '+' : ''}${n0(d.delta)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display:'flex', flexWrap:'wrap', gap:12, alignItems:'center', marginTop:12 }}>
              <div style={{ fontSize:12, color:'var(--muted)' }}>
                นับแล้ว <b style={{ color:'var(--text)' }}>{summary.counted}</b>/{rows.length} พาร์ท ·
                ตรง {summary.same} · 📈 เพิ่ม {summary.up} ({n0(summary.upQty)}) · 📉 ลด {summary.down} ({n0(summary.downQty)})
              </div>
              {canApprove && (
                <label style={{ fontSize:12, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                  <input type="checkbox" checked={approveNow} onChange={e => setApproveNow(e.target.checked)} style={{ width:'auto' }} />
                  อนุมัติเลย (มีผลกับยอดทันที)
                </label>
              )}
              {canCount ? (
                <button style={{ ...btn('var(--accent)'), opacity: saving || !summary.changed ? 0.5 : 1 }}
                  disabled={saving || !summary.changed} onClick={save}>
                  {saving ? 'กำลังบันทึก…' : `💾 บันทึกผลตรวจนับ (${summary.changed})`}
                </button>
              ) : (
                <span style={{ fontSize:12, color:'var(--muted)' }}>ดูอย่างเดียว — ต้องมีสิทธิ์ line_stock:issue จึงบันทึกได้</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
