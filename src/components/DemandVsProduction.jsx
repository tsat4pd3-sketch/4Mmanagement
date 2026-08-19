/* ═══ 📦 ผลิตเทียบกับความต้องการลูกค้า ═══
   2026-08-19 · คำสั่ง user — สูตรทั้งหมดอยู่ src/utils/demandSupply.js (pure เทสได้)

   ตอบ 3 คำถามที่ user ถาม:
     1. ที่ผ่านมาผลิตตรงตามความต้องการมั้ย → แท่งผลิต + เส้นความต้องการรายวัน
     2. เพียงพอรึป่าว                      → เส้นสต็อกจำลอง (ติดลบวันไหน)
     3. ต้องชะลอหรือเร่ง                    → แถบสรุป advise()

   ⚠️ "ยังเทียบไม่ได้" ต้องเป็นคำตอบของตัวเอง — พาร์ทที่ยังไม่ได้ตั้ง p_no
      ห้ามแสดงความต้องการ = 0 (จะอ่านเป็น "ลูกค้าไม่สั่ง" แล้วสั่งชะลอผลิตผิด) */

import { useState, useEffect, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import DailyBars from './DailyBars';
import {
  demandKeysOf, rowMatchesProduct, demandByDay, simulate, prodRate, advise, addDay,
} from '../utils/demandSupply';

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const dLabel = (s) => { const [, m, d] = s.split('-'); return `${+d}/${+m}`; };

function Stat({ label, value, unit, color, sub }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 130 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 900, color: color || 'var(--text)', lineHeight: 1.3 }}>
        {value}{unit && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginLeft: 3 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

/**
 * @param {object} product   { mat_no, p_no, name }
 * @param {Object} prodByDay { 'YYYY-MM-DD': ผลิตได้ } จากประวัติผลิตของหน้าแม่
 * @param {string} today     วันงานปัจจุบัน
 */
export default function DemandVsProduction({ product, prodByDay, today }) {
  const [orders, setOrders] = useState(null);     // null = ยังไม่โหลด
  const [fcs, setFcs] = useState([]);
  const [stock, setStock] = useState(null);
  const [err, setErr] = useState('');
  const [horizon, setHorizon] = useState(30);

  const keys = useMemo(() => demandKeysOf(product), [product]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setErr('');
      const from = addDay(today, -60);
      const to = addDay(today, 180);
      /* ⚠️ ดึงทั้งช่วงแล้วกรองฝั่ง client — ออเดอร์อ้าง "เลขลูกค้า" ที่เว้นวรรค/ขีดไม่ตรงกับ p_no
         ใน master (RB3B 16E060 BA vs RB3B-16E060-BA) → เทียบใน SQL ตรงๆ ไม่เจอ
         (ข้อมูลจริงมีหลักร้อยแถว ดึงมาทั้งช่วงถูกกว่าเขียน RPC) */
      const [o, f, s] = await Promise.all([
        supabaseDR.from('customer_shipping_orders')
          .select('mat_no, customer_part_no, qty, due_date, status').gte('due_date', from).lte('due_date', to).limit(5000),
        supabaseDR.from('customer_forecasts')
          .select('mat_no, customer_part_no, qty, period_month').gte('period_month', from).lte('period_month', to).limit(5000),
        supabaseDR.from('line_stock_summary').select('mat_no, qty_on_hand'),
      ]);
      if (!alive) return;
      const e = o.error || f.error || s.error;
      if (e) { setErr(e.message || String(e)); setOrders([]); return; }
      setOrders((o.data || []).filter((r) => rowMatchesProduct(r, keys)));
      setFcs((f.data || []).filter((r) => rowMatchesProduct(r, keys)));
      const st = (s.data || []).filter((r) => keys.has(String(r.mat_no ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()));
      setStock(st.length ? st.reduce((a, r) => a + (Number(r.qty_on_hand) || 0), 0) : null);
    })();
    return () => { alive = false; };
  }, [keys, today]);

  const D = useMemo(() => demandByDay(orders || [], fcs), [orders, fcs]);
  const sim = useMemo(() => {
    const dDays = Object.keys(D.byDay).sort();
    if (!dDays.length) return null;
    /* เริ่มเดินจากวันแรกที่มีความต้องการ (ไม่เกิน 30 วันก่อนวันนี้ — ไกลกว่านั้นไม่ช่วยตัดสินใจ)
       ⚠️ สต็อกที่อ่านได้เป็นค่า "ตอนนี้" ไม่ใช่ค่า ณ วันเริ่ม → ถ้าเริ่มก่อนวันนี้ต้องถอยกลับ
          ด้วยผลิต/ส่งที่เกิดไปแล้ว ไม่งั้นกราฟช่วงอดีตจะสูงเกินจริง */
    const start = dDays[0] < addDay(today, -30) ? addDay(today, -30) : dDays[0];
    const to = addDay(today, horizon);
    let opening = stock ?? 0;
    for (let d = start; d <= today; d = addDay(d, 1)) {
      const dv = D.byDay[d];
      opening -= (Number(prodByDay?.[d]) || 0) - (dv ? (dv.order > 0 ? dv.order : dv.forecast) : 0);
    }
    return simulate({ from: start, to, prodByDay, demByDay: D.byDay, openingStock: opening, today });
  }, [D, prodByDay, stock, today, horizon]);

  const rate = useMemo(() => prodRate(prodByDay), [prodByDay]);
  const adv = useMemo(() => advise(sim, rate), [sim, rate]);

  if (orders === null) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลดความต้องการลูกค้า…</div>;

  /* ── ยังจับคู่เลขไม่ได้ = บอกตรงๆ + ชี้ทางไปแก้ ห้ามโชว์ 0 ── */
  if (!D.hasOrder && !D.hasForecast) {
    return (
      <div style={{ padding: '10px 13px', borderRadius: 8, border: '1px solid #f59e0b55', background: '#f59e0b14', fontSize: 12, color: '#f59e0b', lineHeight: 1.7 }}>
        ⚠️ <b>ยังเทียบกับความต้องการลูกค้าไม่ได้</b> — ไม่พบออเดอร์/forecast ที่ผูกกับสินค้านี้
        <div style={{ color: 'var(--muted)', marginTop: 4 }}>
          ออเดอร์จากลูกค้าอ้าง <b>เลขพาร์ทลูกค้า</b> แต่ยอดผลิตอ้าง <b>เลข SAP</b> — ต้องมี <code>P/N</code> ของสินค้านี้
          ตรงกับที่ลูกค้าใช้ ระบบถึงจับคู่ได้{product?.p_no ? <> · ตอนนี้ตั้งไว้เป็น <b>{product.p_no}</b></> : <> · <b>ตอนนี้ยังไม่ได้ตั้ง P/N เลย</b></>}
          <br />แก้ที่ <b>Product Master → ช่อง P/N</b> หรือปุ่ม 🔗 จับคู่เลข SAP ในหน้า Planner &amp; Sales
        </div>
      </div>
    );
  }

  const rows = (sim?.days || []).map((x) => ({
    key: x.d, label: dLabel(x.d),
    empty: !x.produced && !x.demand,
    segs: [{ v: x.produced, color: x.future ? 'var(--border2)' : 'var(--accent)', name: x.future ? 'ยังไม่ผลิต' : 'ผลิตได้' }],
    marker: x.demand > 0 ? { v: x.demand, color: x.src === 'order' ? '#f59e0b' : '#a78bfa', name: x.src === 'order' ? 'ต้องส่ง (ออเดอร์)' : 'คาดการณ์ (forecast)' } : null,
  }));
  const stockRows = (sim?.days || []).map((x) => ({
    key: x.d, label: dLabel(x.d),
    segs: [{ v: Math.max(0, x.stock), color: x.stock < 0 ? '#ef4444' : x.future ? '#4d9fff' : 'var(--accent)', name: 'สต็อกคงเหลือ' }],
  }));
  const shortDays = (sim?.days || []).filter((x) => x.stock < 0).length;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err && <div style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid #ef444466', background: '#ef444414', fontSize: 11.5, color: '#ef4444' }}>🔴 โหลดข้อมูลไม่ครบ — ตัวเลขอาจไม่ตรง<br />{err}</div>}

      {/* ── สรุป + คำแนะนำ ── */}
      <div style={{ padding: '11px 13px', borderRadius: 9, border: `1px solid ${adv.color}66`, background: `${adv.color}14` }}>
        <div style={{ fontSize: 13.5, fontWeight: 900, color: adv.color }}>{adv.icon} {adv.label}</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, lineHeight: 1.6 }}>{adv.text}</div>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Stat label="สต็อกตอนนี้" value={stock == null ? '—' : fmt(stock)} unit="ชิ้น"
          sub={stock == null ? 'ไม่มีข้อมูลสต็อกของเลขนี้' : 'จากคลัง FG'} color={stock == null ? 'var(--muted)' : undefined} />
        <Stat label="ต้องส่ง (ในช่วงที่ดู)" value={fmt(sim?.cumDem)} unit="ชิ้น"
          sub={D.hasOrder ? `ออเดอร์จริง${D.hasForecast ? ' + forecast' : ''}` : 'forecast เท่านั้น (ยังไม่มีออเดอร์)'} color="#f59e0b" />
        <Stat label="ผลิตได้ (ในช่วงที่ดู)" value={fmt(sim?.cumProd)} unit="ชิ้น" color="var(--accent)"
          sub={rate ? `เฉลี่ย ${fmt(rate)} ชิ้น/วันผลิต` : 'ยังไม่มีการผลิตในช่วงนี้'} />
        <Stat label="ปลายช่วงเหลือ" value={fmt(sim?.endStock)} unit="ชิ้น"
          color={sim?.endStock < 0 ? '#ef4444' : sim?.endStock > 0 ? 'var(--accent)' : undefined}
          sub={shortDays ? `⚠️ มี ${shortDays} วันที่ของไม่พอ` : 'ไม่มีวันที่ของขาด'} />
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>มองไปข้างหน้า</div>
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}
            style={{ width: 110, padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12 }}>
            {[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} วัน</option>)}
          </select>
        </div>
      </div>

      {/* ── กราฟ 1: ผลิตรายวัน + เส้นความต้องการ ── */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>ผลิตรายวัน เทียบ ความต้องการ</div>
        <DailyBars data={rows} height={140} unit=" ชิ้น" />
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.7 }}>
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>■ ผลิตได้</span> ·
          <span style={{ color: '#f59e0b', fontWeight: 700 }}> ▬ ต้องส่ง (ออเดอร์จริง)</span> ·
          <span style={{ color: '#a78bfa', fontWeight: 700 }}> ▬ คาดการณ์ (forecast)</span> ·
          แท่งเทา = วันข้างหน้า (ยังไม่ผลิต — ระบบไม่เดาว่าจะผลิตได้เท่าไหร่)
          <br />วันที่มีออเดอร์จริงแล้ว จะ<b>ไม่</b>เอา forecast มาบวกทับ (นับซ้ำ)
        </div>
      </div>

      {/* ── กราฟ 2: สต็อกจำลอง — ตัวชี้ขาดว่าพอไหม ── */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>สต็อกคงเหลือจำลอง (ถ้าไม่ผลิตเพิ่มจากนี้)</div>
        <DailyBars data={stockRows} height={120} unit=" ชิ้น" />
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.7 }}>
          สต็อกตอนนี้ + ที่ผลิตแล้ว − ที่ต้องส่ง · <b>วันที่แท่งหายไป = ของขาด (ติดลบ)</b> ·
          ช่วงข้างหน้าคิดจาก <b>ยังไม่ผลิตเพิ่มเลย</b> — เป็นเส้นที่แย่ที่สุด ไว้ดูว่าเหลือเวลาอีกกี่วันก่อนต้องเร่ง
        </div>
      </div>
    </div>
  );
}
