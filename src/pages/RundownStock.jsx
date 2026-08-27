import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { visibleInterval } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { buildPnIndex, pickStockMat, matIssueText } from '../utils/matResolve';

/* ─── RUNDOWN STOCK — Balance FG รายวัน (แบบไฟล์ rundown stock ของหน้างาน) ────
   หน้าคู่กับ 📈 Planner & Sales: sale อัพโหลด order (EDI 862) → หน้านี้จำลองว่า
   stock พร้อมส่งจะพอถึงวันไหน — Balance วันนั้น = stock ตอนนี้ − ยอดต้องส่งสะสม
   stock เดินอัตโนมัติ realtime: สแกนปิดออเดอร์ → รับเข้า / กดส่งแล้ว → หักออก
   ติดลบ = ถ้าไม่ผลิตเพิ่มของจะขาดวันนั้น → ใช้ตัดสินใจเปิด OT/เพิ่มแผนผลิต */

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 };
const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
const workDateStr = () => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); return dateStr(d); };

const HORIZON = 14;

export default function RundownStock() {
  const [stockRows, setStockRows] = useState([]);
  const [orders, setOrders] = useState([]);
  const [shipToMap, setShipToMap] = useState({});
  const [pnIdx, setPnIdx] = useState(() => new Map());
  const [fgDest, setFgDest] = useState(null);   // คลังที่ FG เข้าไปรอส่ง (จาก stock_inflow_rules)

  const load = useCallback(async () => {
    const from = workDateStr();
    const toD = new Date(`${from}T12:00:00`);
    toD.setDate(toD.getDate() + HORIZON);
    const [{ data: stk }, { data: ods }, { data: st }, { data: rules }, { data: dp }, { data: ks }] = await Promise.all([
      supabaseDR.from('line_stock_summary').select('line_name, mat_no, part_name, qty_on_hand'),
      supabaseDR.from('customer_shipping_orders').select('*')
        .lt('due_date', dateStr(toD)).neq('status', 'shipped'),
      supabaseDR.from('ship_to_plants').select('*'),
      // คลังปลายทางของ FG มาจากกฎรับเข้าอัตโนมัติ — ไม่ hardcode 'FG WAREHOUSE'
      supabaseDR.from('stock_inflow_rules').select('match_type, match_value, dest_line_name').eq('is_active', true),
      // ⚠️ order อ้าง "เลขลูกค้า" แต่คลังเก็บ "เลข SAP" — ต้อง resolve ผ่าน matResolve
      //    เทียบตรงๆ จะได้ "ไม่มีของ" ทั้งที่ของเต็มคลังอยู่ใต้เลข SAP (กฎเหล็ก CLAUDE.md)
      supabaseDR.from('dr_products').select('mat_no, p_no').eq('is_active', true),
      supabaseDR.from('kanban_standards').select('mat_no, p_no').eq('is_active', true),
    ]);
    setStockRows(stk || []);
    setOrders(ods || []);
    setPnIdx(buildPnIndex([...(dp || []), ...(ks || [])]));
    setFgDest((rules || []).find(r => r.match_type === 'prefix' && r.match_value === '1')?.dest_line_name || null);
    const m = {};
    (st || []).forEach(r => { m[r.code] = r; });
    setShipToMap(m);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const stopPoll = visibleInterval(load, RATE.ANALYTIC);
    return () => stopPoll();
  }, [load]);

  const custLabel = useCallback((code) => {
    if (!code) return '— ไม่ระบุลูกค้า —';
    const r = shipToMap[code];
    return r && r.customer_name && r.customer_name !== code ? `${r.customer_name} (${code})` : code;
  }, [shipToMap]);

  const today = workDateStr();
  const days = useMemo(() => Array.from({ length: HORIZON }, (_, i) => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + i);
    return dateStr(d);
  }), [today]);

  const view = useMemo(() => {
    // ⚠️ "stock พร้อมส่ง" = คลัง FG เท่านั้น — เดิมบวกทุกคลัง (mini-store ของไลน์ + STORE ก่อนแพ็ค)
    //    ทำให้ balance สูงเกินจริง แล้วบอกว่า "พอ" ทั้งที่ของยังส่งลูกค้าไม่ได้
    //    (เคสจริง 20059949: FG WAREHOUSE 1,000 + STORE 9,381 → เคยรวมเป็น 10,381)
    const onHand = {};
    stockRows.filter(s => !fgDest || s.line_name === fgDest)
      .forEach(s => { onHand[s.mat_no] = (onHand[s.mat_no] || 0) + (parseFloat(s.qty_on_hand) || 0); });
    const hasStock = (m) => Object.prototype.hasOwnProperty.call(onHand, m);

    const byMat = {};
    orders.forEach(o => {
      const m = byMat[o.mat_no] = byMat[o.mat_no] || { mat_no: o.mat_no, part_name: o.part_name, customers: new Set(), overdue: 0, demand: {} };
      if (o.customer) m.customers.add(o.customer);
      if (!m.part_name && o.part_name) m.part_name = o.part_name;
      if (o.due_date < today) m.overdue += Number(o.qty);            // ค้างส่งก่อนวันนี้ → รวมเข้าคอลัมน์วันแรก
      else m.demand[o.due_date] = (m.demand[o.due_date] || 0) + Number(o.qty);
    });
    const rows = Object.values(byMat).map(m => {
      const res = pickStockMat(m.mat_no, pnIdx, hasStock);
      // ⚠️ "ยังจับคู่เลขไม่ได้" ≠ "ไม่มีของ" — ห้ามเอาไปคิด balance แล้วขึ้นแดงว่าจะขาด
      //    (ของอาจเต็มคลังอยู่ใต้เลข SAP → สั่งผลิตซ้ำโดยไม่จำเป็น · กฎเหล็ก CLAUDE.md)
      const unknown = !['direct', 'mapped'].includes(res.status);
      const stockMat = unknown ? null : res.mat;
      const start = stockMat != null ? (onHand[stockMat] ?? 0) : null;
      let bal = start ?? 0;
      let firstShort = null;
      const cells = days.map((d, i) => {
        const dq = (m.demand[d] || 0) + (i === 0 ? m.overdue : 0);
        bal -= dq;
        if (!unknown && firstShort == null && bal < 0) firstShort = i;
        return { d, dq, bal };
      });
      return { ...m, start, cells, firstShort, tracked: !unknown, stockMat,
        issue: unknown ? matIssueText(m.mat_no, res) : null };
    });
    // จัดอันดับความเร่งด่วน: ขาดเร็วสุดขึ้นบน → ตามด้วยพาร์ทที่ยังพอ → ตัวที่ยังเช็คไม่ได้ท้ายสุด
    rows.sort((a, b) => (a.firstShort ?? 99) - (b.firstShort ?? 99) || (b.cells[0]?.dq || 0) - (a.cells[0]?.dq || 0));
    return rows;
  }, [stockRows, orders, days, today, pnIdx, fgDest]);

  const shortCount = view.filter(r => r.firstShort != null).length;
  const untracked = view.filter(r => !r.tracked).length;
  const dayLabel = (d, i) => {
    const dt = new Date(`${d}T12:00:00`);
    return `${i === 0 ? 'วันนี้ ' : ''}${dt.getDate()}/${dt.getMonth() + 1}`;
  };

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 'min(96vw, 1600px)', margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          📉 คาดการณ์ของจะขาด — Balance FG รายวัน
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          stock พร้อมส่ง{fgDest ? ` (คลัง ${fgDest})` : ''} − order ค้างส่งสะสม {HORIZON} วันข้างหน้า · เดินอัตโนมัติจากการปิดออเดอร์/การส่งจริง
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { icon: '🔩', label: 'พาร์ทที่มี order ค้างส่ง', value: view.length },
            { icon: '🔴', label: `จะติดลบใน ${HORIZON} วัน`, value: shortCount, warn: shortCount > 0 },
            { icon: '✅', label: 'stock พอตลอดช่วง', value: view.filter(r => r.tracked && r.firstShort == null).length },
            ...(untracked ? [{ icon: '❔', label: 'ยังเช็ค stock ไม่ได้ (เลขยังไม่จับคู่ MAT SAP)', value: untracked, warn: true }] : []),
          ].map(c => (
            <div key={c.label} style={{ flex: '1 1 160px', background: 'var(--bg2)', border: `1px solid ${c.warn ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`, borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{c.icon} {c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: c.warn && c.value > 0 ? '#ef4444' : 'var(--text)', fontFamily: 'var(--font-display)' }}>{c.value}</div>
            </div>
          ))}
        </div>

        {view.length === 0 ? (
          <div style={{ ...card, padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            ไม่มี order ค้างส่งใน {HORIZON} วันข้างหน้า — อัพโหลด Order (EDI 862) ที่หน้า 📈 Planner & Sales
          </div>
        ) : (
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>📉 Balance FG รายวัน (เรียงพาร์ทที่จะขาดเร็วสุดขึ้นก่อน)</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>ตัวบน = ยอดต้องส่งวันนั้น · ตัวล่าง = Balance สะสม (แดง = จะขาด ต้องผลิตเพิ่ม/เปิด OT)</span>
            </div>
            <div className="table-sticky" style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
                <thead>
                  <tr style={{ background: 'var(--bg2)' }}>
                    <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1, minWidth: 170 }}>พาร์ท</th>
                    <th style={{ padding: '8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'right' }}>Stock ตอนนี้</th>
                    {days.map((d, i) => (
                      <th key={d} style={{ padding: '8px 6px', fontSize: 11, fontWeight: i === 0 ? 800 : 700, color: i === 0 ? 'var(--text2)' : 'var(--muted)', textAlign: 'center', minWidth: 52, background: i === 0 ? 'rgba(77,159,255,0.08)' : undefined }}>
                        {dayLabel(d, i)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.map(r => (
                    <tr key={r.mat_no} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 12px', position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#0ea5e9' }}>{r.mat_no}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.part_name || ''}{r.customers.size ? ` · ${[...r.customers].map(custLabel).join(', ')}` : ''}
                        </div>
                        {r.overdue > 0 && <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>⏰ ค้างส่ง {fmt(r.overdue)} ชิ้น (รวมในวันนี้แล้ว)</div>}
                      </td>
                      <td title={r.issue || ''} style={{ padding: '7px 10px', textAlign: 'right', fontSize: 13, fontWeight: 900, color: r.tracked ? 'var(--text)' : '#f59e0b' }}>
                        {r.tracked ? fmt(r.start) : '❔'}
                      </td>
                      {r.cells.map((c, i) => (
                        <td key={c.d} style={{ padding: '5px 6px', textAlign: 'center', background: (r.tracked && c.bal < 0) ? 'rgba(239,68,68,0.10)' : i === 0 ? 'rgba(77,159,255,0.05)' : undefined }}>
                          <div style={{ fontSize: 11, color: c.dq > 0 ? 'var(--text2)' : 'var(--border2)', fontWeight: 600 }}>{c.dq > 0 ? `−${fmt(c.dq)}` : '·'}</div>
                          {/* แถวที่ยังจับคู่เลขไม่ได้ = ไม่รู้ยอดตั้งต้น → ห้ามโชว์ balance (จะอ่านเป็น "จะขาด" ทั้งที่ยังไม่รู้) */}
                          <div style={{ fontSize: 12, fontWeight: 800, color: !r.tracked ? 'var(--border2)' : c.bal < 0 ? '#ef4444' : c.bal === 0 ? '#f59e0b' : '#22c55e' }}>
                            {r.tracked ? fmt(c.bal) : '·'}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border2)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
              Balance = stock พร้อมส่งตอนนี้ − ยอด order ที่ยังไม่ส่งสะสมรายวัน · stock เดินเองอัตโนมัติ
              (สแกนปิดออเดอร์ = รับเข้า · กด "ส่งแล้ว" = หักออก) จึงเป็นภาพ ณ ปัจจุบันเสมอ ไม่ต้องรอปิดกะ ·
              นับเฉพาะของใน<b>คลัง FG</b>{fgDest ? ` (${fgDest})` : ''} — ของที่ยังอยู่ mini-store ของไลน์ / STORE ก่อนแพ็ค ยังส่งลูกค้าไม่ได้ จึงไม่นับ ·
              แถวที่ขึ้น ❔ คือ<b>เลขบน order ยังจับคู่ MAT SAP ไม่ได้</b> (ไม่ได้แปลว่าไม่มีของ) — ตั้ง p_no ที่ Product Master
              หรือกดปุ่ม 🔗 จับคู่เลข SAP ในหน้า 📈 Planner &amp; Sales แล้วจะคำนวณให้ทันที
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
