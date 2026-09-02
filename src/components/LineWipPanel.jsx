import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabaseDR } from '../supabaseClient';
import { isLeafLine, getChildLineNames, getAncestorNames } from '../utils/lineHierarchy';
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';
import { buildLineWip, WIP_STATUS } from '../utils/lineWipLedger';

/**
 * 📦 WIP ที่ไลน์ — แผงบนหน้า Daily Report ของไลน์ที่กำลังเปิดกะ
 *
 * ที่มา (user 2026-09-01): "ในส่วนของผลิต เพิ่ม feature WIP monitoring ด้วยได้มั้ย
 * มอนิเตอร์ว่า สโตร์ส่งมาเท่าไหร่ เหลือค้างในพื้นที่เท่าไหร่ ตัดไปเป็น FG เท่าไหร่"
 *
 * ⚠️ สูตรทั้งหมดอยู่ `src/utils/lineWipLedger.js` (pure · เทส 15 เคส) — ห้ามคำนวณเองในแผงนี้
 *
 * ── 3 ตัวเลขมาจากคนละที่ ต้องบอกบนจอว่าตัวไหนคืออะไร ──────────────────────────
 *   📥 สโตร์ส่งมา   `line_stock_transactions` type issue (status approved) = **ข้อเท็จจริง**
 *   🏭 ตัดเป็น FG   คำนวณ ยอดผลิต × BOM                                  = **ค่าที่คำนวณ**
 *   📦 ค้างที่ไลน์   ส่งมา − ตัดเป็น FG                                    = **ค่าที่คำนวณ**
 *
 * ⚠️⚠️ ห้ามเอา `line_stock_summary.qty_on_hand` มาตอบว่า "ค้างที่ไลน์เท่าไหร่"
 * backflush ไม่ทำงาน (issue 5,908 : consume 40) → ยอดในระบบแทบไม่เคยลด สูงกว่าความจริงเสมอ
 * แผงนี้จึงโชว์มันเป็น **ตัวเลขวินิจฉัย** คู่กับส่วนต่าง ไม่ใช่คำตอบหลัก
 *
 * ⚠️ ฐานเวลา = **วันแรกที่สโตร์เริ่มบันทึกการจ่ายเข้าไลน์นี้** ไม่ใช่ตั้งแต่ระบบเกิด
 * ก่อนวันนั้นไม่มีบันทึกรับเข้าเลย เอามาคิด "ค้างเหลือ" ไม่ได้ (จะติดลบทั้งกระดาน)
 * และเป็นตัวจำกัดขนาดคิวรีในตัว · ยังไม่เคยมีบันทึกเลย = บอกตรงๆ ไม่เดา
 */

const fmt  = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
};
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10 };
const chip = (bg, color) => ({ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: bg, color, whiteSpace: 'nowrap' });
const TONE = { ok: 'var(--accent)', warn: '#f59e0b', crit: '#ef4444', muted: 'var(--muted)' };

const RANGES = [
  { key: 'day',  label: 'กะ/วันนี้', days: 0 },
  { key: 'w',    label: '7 วัน',     days: 6 },
  { key: 'm',    label: '30 วัน',    days: 29 },
];
const shiftDate = (ymd, back) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const t = new Date(y, (m || 1) - 1, (d || 1) - back);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

export default function LineWipPanel({ lineName, workDate, lines = [] }) {
  const [txns, setTxns]       = useState([]);
  const [upRows, setUpRows]   = useState([]);   // ของที่ค้างอยู่ที่ไลน์แม่ (ไม่นับรวม)
  const [orders, setOrders]   = useState([]);
  const [bomByMat, setBom]    = useState({});
  const [err, setErr]         = useState(null);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]       = useState(false);
  const [range, setRange]     = useState('day');
  const [showAll, setShowAll] = useState(false);

  /* ⚠️⚠️ กฎ "หน่วยย่อยที่สุด" (user เคาะ 2026-08-31) — ของอยู่ที่ leaf เสมอ
     **ห้ามใช้ `getLineFamilyNames` กับสต็อก** — family คือ "ใครเห็นอะไร" (scope ของ leader)
     ไม่ใช่ "ของอยู่ที่ไหน" · เอามานับสต็อก = ไลน์ลูกทุกตัวนับของก้อนเดียวกันของแม่ซ้ำกันหมด
     → จอบอก "ค้างเยอะ" ทั้งที่หน้าไลน์ไม่มีของ (ทิศที่อันตรายที่สุด)
     (แผง 📦 เรียกชิ้นส่วนจากสโตร์ บนหน้าเดียวกันใช้กติกานี้อยู่แล้ว — 2 แผงต้องตอบตรงกัน) */
  const isLeaf   = useMemo(() => isLeafLine(lines, lineName), [lines, lineName]);
  const kidNames = useMemo(() => getChildLineNames(lines, lineName), [lines, lineName]);
  /* สายบน — ไว้ตรวจว่ามีของค้างที่ไลน์แม่ไหม (ไม่นับรวม แต่ต้องบอกให้เห็น ห้ามเงียบ) */
  const upNames  = useMemo(() => getAncestorNames(lines, lineName), [lines, lineName]);

  const load = useCallback(async () => {
    if (!lineName || !workDate) return;
    setLoading(true); setErr(null); setPartial(false);
    try {
      /* 1) ledger — ดึงของ "ไลน์นี้ + สายบน" แล้วค่อยแยกกันตอนคำนวณ
            ⚠️ ของไลน์แม่ **ไม่นับเป็นของไลน์นี้** (ยังไม่ถูกจ่ายลงมาจริง) แต่ต้องเห็น ห้ามเงียบ
            ⚠️ `status='approved'` เท่านั้น (pending/rejected มีจริง · นับด้วยจะได้ยอดเกิน view) */
      const tRes = await fetchAllPages(
        () => supabaseDR.from('line_stock_transactions')
          .select('line_name, mat_no, part_name, type, qty, work_date')
          .in('line_name', [lineName, ...upNames]).eq('status', 'approved'),
        { orderBy: ['work_date', 'mat_no'] },
      );
      if (tRes.error) throw new Error(tRes.error);
      const all = tRes.rows;
      const tx = all.filter(r => r.line_name === lineName);
      setUpRows(all.filter(r => r.line_name !== lineName));

      // 2) ฐานเวลา = วันแรกที่มีบันทึก "จ่ายเข้าไลน์นี้" — ไม่มีเลย = ตอบเรื่องยอดค้างไม่ได้
      const firstIssue = tx.filter(t => t.type === 'issue' && t.work_date)
        .reduce((m, t) => (m == null || t.work_date < m ? t.work_date : m), null);

      /* 3) ใบผลิตตั้งแต่ฐานเวลา — ⚠️ `prod_orders` ไม่มี line_name/work_date
            ต้อง embed `production_sessions!inner` (select ตรงจะได้ 42703 แล้วเงียบ) */
      let ordRows = [];
      if (firstIssue) {
        const oRes = await fetchAllPages(
          () => supabaseDR.from('prod_orders')
            .select('mat_no, status, qty, qty_ok, qty_actual, production_sessions!inner(line_name, work_date)')
            .eq('production_sessions.line_name', lineName)
            .gte('production_sessions.work_date', firstIssue),
          { orderBy: 'id' },
        );
        if (oRes.error) throw new Error(oRes.error);
        if (oRes.truncated) setPartial(true);
        ordRows = oRes.rows.map(o => ({
          matNo: o.mat_no,
          qty: o.qty, qtyOk: o.qty_ok, qtyActual: o.qty_actual,
          confirmed: o.status === 'confirmed',
          workDate: o.production_sessions?.work_date,
        }));
      }

      /* 4) BOM — ดึงของทั้ง FG ที่ผลิต และของ "ลูก" ด้วย เพื่อให้ตรวจ BOM ซ้อนชั้นได้
            (ลูกที่เป็น product เองจะมี BOM ของตัวเอง = จุดที่ทำให้นับซ้ำ) */
      const fgMats = [...new Set(ordRows.map(o => o.matNo).filter(Boolean))];
      const bm = {};
      if (fgMats.length) {
        const p1 = await fetchByIds(fgMats, (part) =>
          supabaseDR.from('dr_products').select('id, mat_no').in('mat_no', part));
        const idOf = {}; (p1.rows || []).forEach(p => { idOf[p.id] = p.mat_no; });
        const b1 = await fetchByIds(Object.keys(idOf), (part) =>
          supabaseDR.from('bom_items').select('product_id, mat_no, qty_per_unit')
            .in('product_id', part).eq('is_active', true));
        if (p1.error || b1.error) setPartial(true);
        (b1.rows || []).forEach(b => {
          const fg = idOf[b.product_id];
          if (fg) (bm[fg] = bm[fg] || []).push(b);
        });
        // รอบสอง: BOM ของลูก (ถ้าลูกเป็น product) — ใช้ตรวจซ้อนชั้นอย่างเดียว
        const kids = [...new Set(Object.values(bm).flat().map(b => b.mat_no).filter(m => m && !(m in bm)))];
        if (kids.length) {
          const p2 = await fetchByIds(kids, (part) =>
            supabaseDR.from('dr_products').select('id, mat_no').in('mat_no', part));
          const idOf2 = {}; (p2.rows || []).forEach(p => { idOf2[p.id] = p.mat_no; });
          if (Object.keys(idOf2).length) {
            const b2 = await fetchByIds(Object.keys(idOf2), (part) =>
              supabaseDR.from('bom_items').select('product_id, mat_no, qty_per_unit')
                .in('product_id', part).eq('is_active', true));
            (b2.rows || []).forEach(b => {
              const k = idOf2[b.product_id];
              if (k) (bm[k] = bm[k] || []).push(b);
            });
          }
        }
      }

      setTxns(tx); setOrders(ordRows); setBom(bm);
    } catch (e) {
      setErr(e.message || String(e));
    } finally { setLoading(false); }
  }, [lineName, workDate, upNames]);

  useEffect(() => { load(); }, [load]);

  const from = useMemo(() => {
    const r = RANGES.find(x => x.key === range) || RANGES[0];
    return shiftDate(workDate, r.days);
  }, [range, workDate]);

  const wip = useMemo(() => buildLineWip({
    txns, orders, bomOf: (m) => bomByMat[m] || [], from, to: workDate,
  }), [txns, orders, bomByMat, from, workDate]);

  const firstIssueDate = useMemo(() =>
    txns.filter(t => t.type === 'issue' && t.work_date)
      .reduce((m, t) => (m == null || t.work_date < m ? t.work_date : m), null), [txns]);

  /* ของที่ยังค้างอยู่ที่ไลน์แม่ — **ไม่ใช่ของไลน์นี้ แต่ต้องเห็น** ห้ามเงียบ
     (นี่คือสาเหตุที่ยอดค้างของไลน์ดูน้อยทั้งที่สโตร์จ่ายมาแล้ว — ต้องไปย้ายที่ /line-stock) */
  const stuckUp = useMemo(() => {
    const m = new Map();
    for (const r of upRows) {
      const sign = { issue: 1, adjust: 1, consume: -1, return: -1 }[r.type];
      if (!sign || !r.mat_no) continue;
      m.set(r.mat_no, (m.get(r.mat_no) || 0) + sign * (Number(r.qty) || 0));
    }
    return [...m.entries()].filter(([, q]) => q > 0)
      .map(([mat_no, qty]) => ({ mat_no, qty })).sort((a, b) => b.qty - a.qty);
  }, [upRows]);

  if (loading) return null;

  /* ⚠️ ไลน์แม่ที่มีลูก = แผนก ไม่ใช่จุดวางของ (กฎหน่วยย่อยที่สุด)
     ตัวเลข WIP ระดับนี้ไม่มีความหมาย — บอกให้ไปเปิดที่ไลน์ลูก **ห้ามโชว์ตัวเลขให้เข้าใจผิด** */
  if (!isLeaf) return (
    <div style={{ ...card, borderColor: 'rgba(59,130,246,0.3)', marginBottom: 16, padding: '12px 14px' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#60a5fa', marginBottom: 4 }}>📦 WIP ที่ไลน์</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7 }}>
        <b>{lineName}</b> เป็นไลน์แม่ (มีไลน์ย่อย {kidNames.length}) — ของและยอดค้างอยู่ที่ <b>ไลน์ย่อย</b>
        <br />เปิดกะที่ไลน์ย่อยเพื่อดู: {kidNames.map(n => (
          <span key={n} style={{ display: 'inline-block', margin: '3px 4px 0 0', padding: '2px 8px', borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 11 }}>{n}</span>
        ))}
      </div>
    </div>
  );

  /* ไม่มีทั้ง ledger และการใช้ของ = ไลน์นี้ยังไม่เข้าระบบ WIP → ไม่ต้องรกจอ
     ⚠️ แต่ถ้ามีของค้างอยู่ที่ไลน์แม่ ต้องโชว์ — นั่นคือคำอธิบายว่าทำไมไลน์นี้ถึงว่าง */
  if (!err && !wip.parts.length && !stuckUp.length) return null;

  const t = wip.totals;
  const rows = showAll ? wip.parts : wip.parts.slice(0, 8);

  return (
    <div style={{ ...card, borderColor: 'rgba(59,130,246,0.3)', marginBottom: 16 }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#60a5fa' }}>
          📦 WIP ที่ไลน์ ({wip.parts.length} พาร์ท)
        </span>
        {/* ตัวเลขหลักต้องเห็นแม้พับ — ไม่งั้นต้องกดทุกครั้งถึงจะรู้ว่ามีอะไร */}
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          📥 รับ {fmt(t.received)} · 🏭 ใช้ {fmt(t.usedCalc)} · 📦 ค้าง <b style={{ color: t.shouldRemain < 0 ? TONE.crit : 'var(--accent)' }}>{fmt(t.shouldRemain)}</b>
        </span>
        {t.negative > 0     && <span style={chip('rgba(239,68,68,0.14)', TONE.crit)}>🔴 ใช้เกินที่รับ {t.negative}</span>}
        {t.neverIssued > 0  && <span style={chip('rgba(245,158,11,0.14)', TONE.warn)}>📭 ไม่มีบันทึกรับเข้า {t.neverIssued}</span>}
        {stuckUp.length > 0 && <span style={chip('rgba(245,158,11,0.14)', TONE.warn)}>🔀 ค้างที่ไลน์แม่ {stuckUp.length} พาร์ท</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div style={{ padding: '0 14px 12px' }}>
          {err && (
            <div style={{ ...card, borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.07)', padding: '8px 11px', marginBottom: 10, fontSize: 11.5, color: TONE.crit }}>
              ⚠️ โหลดข้อมูล WIP ไม่สำเร็จ — ตัวเลขด้านล่างอาจไม่ครบ · {err}
            </div>
          )}
          {partial && !err && (
            <div style={{ fontSize: 11, color: TONE.warn, marginBottom: 8 }}>
              ⚠️ โหลดได้ไม่ครบทุกแถว — ตัวเลขอาจต่ำกว่าความจริง ลองรีเฟรช
            </div>
          )}

          {!firstIssueDate ? (
            <div style={{ ...card, background: 'var(--bg2)', padding: '10px 12px', fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
              📭 <b>ไลน์นี้ยังไม่เคยมีบันทึก "จ่ายพาร์ทเข้าไลน์" ในระบบเลย</b> — ตอบไม่ได้ว่าค้างอยู่เท่าไหร่
              <div style={{ marginTop: 2 }}>
                ตัวเลข "ตัดเป็น FG" ด้านล่างคำนวณจากใบผลิตได้ตามปกติ · ให้สโตร์บันทึกที่{' '}
                <Link to="/line-stock" style={{ color: 'var(--accent)', fontWeight: 700 }}>📦 Line Stock → + จ่ายพาร์ทเข้าไลน์</Link>{' '}
                แล้วยอดค้างจะคำนวณได้เอง
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
              ยอดสะสมนับตั้งแต่ <b>{firstIssueDate}</b> (วันแรกที่สโตร์เริ่มบันทึกการจ่ายเข้าไลน์นี้)
            </div>
          )}

          {/* ⚠️ ของที่จ่ายไว้ที่ไลน์แม่ — ไม่นับเป็นของไลน์นี้ แต่ต้องเห็น (ห้ามเงียบ)
              นี่คือคำอธิบายว่าทำไมยอดค้างของไลน์ถึงน้อย/ติดลบ ทั้งที่สโตร์จ่ายมาแล้ว */}
          {stuckUp.length > 0 && (
            <div style={{ ...card, borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.07)', padding: '9px 12px', marginBottom: 10, fontSize: 11.5, color: 'var(--text2)' }}>
              🔀 <b style={{ color: TONE.warn }}>มีของค้างอยู่ที่ไลน์แม่ {stuckUp.length} พาร์ท</b> — ยังไม่ถูกย้ายลงมาที่ไลน์นี้ จึงไม่นับรวมด้านล่าง
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {stuckUp.slice(0, 8).map(s => (
                  <span key={s.mat_no} style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 11 }}>
                    {s.mat_no} · {fmt(s.qty)}
                  </span>
                ))}
                {stuckUp.length > 8 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>+ อีก {stuckUp.length - 8}</span>}
              </div>
              <div style={{ marginTop: 4 }}>
                ย้ายที่{' '}
                <Link to="/line-stock" style={{ color: 'var(--accent)', fontWeight: 700 }}>📦 Line Stock → 🔀 ย้ายเข้าไลน์ลูก</Link>
              </div>
            </div>
          )}

          {/* ── 3 ตัวเลขที่ถาม ── */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>ช่วง:</span>
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)}
                style={{ ...chip(range === r.key ? 'rgba(96,165,250,0.18)' : 'var(--bg3)', range === r.key ? '#60a5fa' : 'var(--muted)'),
                  border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                {r.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 8, marginBottom: 10 }}>
            {[
              { icon: '📥', label: 'สโตร์ส่งเข้าไลน์', now: t.inPeriod,   all: t.received,     tone: 'var(--accent)', note: 'จากบันทึกจริง' },
              { icon: '🏭', label: 'ตัดไปเป็น FG',     now: t.usedPeriod, all: t.usedCalc,     tone: '#60a5fa',       note: 'คำนวณจากใบผลิต × BOM' },
              { icon: '📦', label: 'ค้างที่ไลน์',       now: null,         all: t.shouldRemain, tone: t.shouldRemain < 0 ? TONE.crit : 'var(--accent)', note: 'ส่งเข้า − ตัดเป็น FG' },
            ].map(k => (
              <div key={k.label} style={{ ...card, background: 'var(--bg2)', padding: '8px 11px' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{k.icon} {k.label}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: k.tone, fontFamily: 'var(--font-display)', lineHeight: 1.25 }}>
                  {fmt(k.now ?? k.all)}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                  {k.now != null ? <>สะสม {fmt(k.all)} · {k.note}</> : k.note}
                </div>
              </div>
            ))}
          </div>

          {/* ⚠️ ตัวเลขวินิจฉัย — ทำให้ปัญหา backflush มีตัวเลขบนจอ ห้ามซ่อน */}
          {Math.abs(t.gap) > 0.5 && (
            <div style={{ ...card, borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.06)', padding: '8px 11px', marginBottom: 10, fontSize: 11.5 }}>
              <b style={{ color: TONE.warn }}>⚠️ ยอดในระบบยังไม่ถูกหัก {fmt(t.gap)} ชิ้น</b>
              <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                ยอดที่ระบบบันทึกไว้ <b>{fmt(t.onHandLedger)}</b> แต่ที่ควรเหลือจริง <b>{fmt(t.shouldRemain)}</b> —
                เพราะการหักอัตโนมัติตอนปิดใบ (backflush) ยังหาไลน์ปลายทางไม่เจอ
                ⇒ <b>ยอดคงเหลือในหน้า Store สูงกว่าความจริง</b> ให้ยึดตัวเลข “ค้างที่ไลน์” ด้านบนแทน
              </div>
            </div>
          )}
          {t.chainWarn > 0 && (
            <div style={{ fontSize: 11, color: TONE.warn, marginBottom: 8 }}>
              ⚠️ {t.chainWarn} พาร์ทมี BOM ซ้อนชั้น (ถูกนับทั้งทางตรงและผ่านขั้นกลาง) — ยอด “ตัดเป็น FG” ของพาร์ทนั้นสูงเกินจริง
              รอ PE/Planning เคาะว่าจะต่อโซ่หรือทำ BOM แบน
            </div>
          )}

          {/* ── รายพาร์ท ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', gap: 8, fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, padding: '2px 0', borderBottom: '1px solid var(--border2)' }}>
              <span style={{ width: 18 }} />
              <span style={{ flex: 1 }}>พาร์ท</span>
              <span style={{ width: 74, textAlign: 'right' }}>📥 รับเข้า</span>
              <span style={{ width: 74, textAlign: 'right' }}>🏭 ตัดเป็น FG</span>
              <span style={{ width: 74, textAlign: 'right' }}>📦 ค้าง</span>
            </div>
            {rows.map(p => {
              const meta = WIP_STATUS[p.status] || WIP_STATUS.ok;
              const tone = TONE[meta.tone] || 'var(--muted)';
              return (
                <div key={p.mat_no} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, padding: '1px 0' }}>
                  <span style={{ width: 18 }} title={meta.label}>{meta.icon}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b style={{ fontFamily: 'var(--font-display)', color: 'var(--text2)' }}>{p.mat_no}</b>
                    {p.part_name ? <span style={{ color: 'var(--muted)' }}> · {p.part_name}</span> : null}
                    {p.chainWarn && <span style={{ color: TONE.warn }} title="BOM ซ้อนชั้น — ยอดตัดเป็น FG สูงเกินจริง"> ⚠BOM</span>}
                  </span>
                  <span style={{ width: 74, textAlign: 'right', color: 'var(--muted)' }}>{fmt(p.received)}</span>
                  <span style={{ width: 74, textAlign: 'right', color: 'var(--muted)' }}
                    title={Object.entries(p.fgSources).map(([fg, q]) => `${fg}: ${fmt(q)}`).join(' · ') || 'ยังไม่ถูกใช้'}>
                    {fmt(p.usedCalc)}
                  </span>
                  <span style={{ width: 74, textAlign: 'right', fontWeight: 800, color: tone }}>{fmt(p.shouldRemain)}</span>
                </div>
              );
            })}
          </div>
          {wip.parts.length > rows.length && (
            <button onClick={() => setShowAll(true)}
              style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--muted)', fontFamily: 'var(--font-body)' }}>
              ▸ ดูอีก {wip.parts.length - rows.length} พาร์ท
            </button>
          )}

          <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5 }}>
            📥 <b>รับเข้า</b> = บันทึกจริงจากสโตร์ (issue + ปรับยอด − คืน) ·
            🏭 <b>ตัดเป็น FG</b> = <b>คำนวณ</b> จากยอดผลิต × BOM (ไม่ได้อ่านยอดตัดสต็อก เพราะ backflush ยังไม่ทำงาน) ·
            📦 <b>ค้าง</b> = รับเข้า − ตัดเป็น FG ·
            📭 = ไลน์ใช้ของแล้วแต่ไม่มีบันทึกรับเข้า (สโตร์ยังไม่ได้ลงระบบ ไม่ใช่ของหมด)
          </div>
        </div>
      )}
    </div>
  );
}
