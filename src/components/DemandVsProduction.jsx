/* ═══ 📦 ผลิตเทียบกับความต้องการลูกค้า ═══
   2026-08-19 · คำสั่ง user — สูตรทั้งหมดอยู่ src/utils/demandSupply.js (pure เทสได้)

   ตอบ 3 คำถาม: (1) ที่ผ่านมาผลิตตรงตามความต้องการมั้ย (2) เพียงพอรึป่าว (3) ต้องเร่งหรือชะลอ

   ⚠️⚠️ กฎเหล็กข้อแรก — **ห้าม net สต็อก/ออเดอร์ข้ามเลข MAT SAP** (2026-08-19 · คำสั่ง user)
   *"เวลาจะเอาไปขายจริง เราจะไม่สลับไปขาย ถ้าไม่ฉุกเฉินจริงๆ เพราะมีการทำลงระบบ SAP ไว้
     เดี๋ยวยอดจะเพี้ยน"*
   → product เดียวกันที่แยกเลข SAP ตามปลายทางลูกค้า **แลกของกันไม่ได้ในทางปฏิบัติ**
     รวมสต็อกทั้งกลุ่มแล้วบอก "พอ" = **คำตอบที่ผิด** ถ้าปลายทางหนึ่งขาดจริง
   → โหมดกลุ่มมีไว้ **ดูภาพรวม/ภาระไลน์** · การตัดสิน "พอ/ขาด" ต้องคิด **ราย MAT เสมอ**
     มีขาด+เกินพร้อมกัน = เสนอว่า "โอนได้ถ้าฉุกเฉิน แต่ต้องปรับ SAP" ไม่ใช่ถือว่าพอ

   ⚠️ "ยังเทียบไม่ได้" ต้องเป็นคำตอบของตัวเอง — พาร์ทที่ยังไม่ได้ตั้ง p_no
      ห้ามแสดงความต้องการ = 0 (จะอ่านเป็น "ลูกค้าไม่สั่ง" แล้วสั่งชะลอผลิตผิด) */

import { useState, useEffect, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import DailyBars from './DailyBars';
import {
  demandKeysOf, rowMatchesProduct, demandByDay, simulate, prodRate, advise, addDay, demandOf, demandSrcOf,
} from '../utils/demandSupply';

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const dLabel = (s) => { const [, m, d] = s.split('-'); return `${+d}/${+m}`; };
const normK = (v) => String(v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

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
 * @param {Array}  products   สินค้าที่ดูอยู่ (1 ตัว = โหมดเดี่ยว · หลายตัว = โหมดกลุ่ม)
 * @param {Object} prodByDay  { mat_no: { 'YYYY-MM-DD': ผลิตได้ } } แยกราย mat (ต้องแยก — ดูกฎเหล็ก)
 * @param {string} today
 */
export default function DemandVsProduction({ products, prodByDay, today }) {
  const [raw, setRaw] = useState(null);   // { orders, fcs, stock } · null = ยังไม่โหลด
  const [err, setErr] = useState('');
  const [horizon, setHorizon] = useState(30);

  const mats = useMemo(() => (products || []).filter(Boolean), [products]);
  const matKey = mats.map((p) => p.mat_no).join('|');

  useEffect(() => {
    let alive = true;
    (async () => {
      setErr('');
      const from = addDay(today, -60);
      const to = addDay(today, 180);
      /* ⚠️ ดึงทั้งช่วงแล้วกรองฝั่ง client — ออเดอร์อ้าง "เลขลูกค้า" ที่เว้นวรรค/ขีดไม่ตรงกับ p_no
         ใน master (RB3B 16E060 BA vs RB3B-16E060-BA) → เทียบใน SQL ตรงๆ ไม่เจอ */
      const [o, f, s] = await Promise.all([
        supabaseDR.from('customer_shipping_orders')
          .select('mat_no, customer_part_no, qty, due_date, status').gte('due_date', from).lte('due_date', to).limit(5000),
        supabaseDR.from('customer_forecasts')
          .select('mat_no, customer_part_no, qty, period_month').gte('period_month', from).lte('period_month', to).limit(5000),
        supabaseDR.from('line_stock_summary').select('mat_no, qty_on_hand'),
      ]);
      if (!alive) return;
      const e = o.error || f.error || s.error;
      if (e) { setErr(e.message || String(e)); setRaw({ orders: [], fcs: [], stock: [] }); return; }
      setRaw({ orders: o.data || [], fcs: f.data || [], stock: s.data || [] });
    })();
    return () => { alive = false; };
  }, [today]);

  /* ── คิดแยกราย MAT เสมอ (กฎเหล็ก: ห้าม net ข้ามเลข) ── */
  const perMat = useMemo(() => {
    if (!raw) return [];
    return mats.map((p) => {
      const keys = demandKeysOf(p);
      /* ⚠️ ออเดอร์ที่อ้าง "เลขลูกค้า" เป็นของ product ร่วมกันทั้งกลุ่ม จับให้ mat ตัวไหนก็ไม่ถูก
         → นับเข้า mat ที่ระบบบันทึกไว้จริงเท่านั้น (mat_no ตรง) ส่วนที่อ้างเลขลูกค้าล้วน
            ยกไปเป็น "ของกลุ่ม" แล้วรายงานแยก ไม่เดาว่าเป็นของใคร */
      const mine = (rows, f) => rows.filter((r) => normK(r.mat_no) === normK(p.mat_no) && (!f || f(r)));
      const D = demandByDay(mine(raw.orders), mine(raw.fcs));
      const stRows = raw.stock.filter((r) => normK(r.mat_no) === normK(p.mat_no));
      const stock = stRows.length ? stRows.reduce((a, r) => a + (Number(r.qty_on_hand) || 0), 0) : null;
      const pbd = prodByDay?.[p.mat_no] || {};
      const dDays = Object.keys(D.byDay).sort();
      let sim = null;
      if (dDays.length) {
        const start = dDays[0] < addDay(today, -30) ? addDay(today, -30) : dDays[0];
        let opening = stock ?? 0;
        for (let d = start; d <= today; d = addDay(d, 1)) {
          opening -= (Number(pbd[d]) || 0) - demandOf(D.byDay[d]);
        }
        sim = simulate({ from: start, to: addDay(today, horizon), prodByDay: pbd, demByDay: D.byDay, openingStock: opening, today });
      }
      const rate = prodRate(pbd);
      return { p, D, stock, pbd, sim, rate, adv: advise(sim, rate), keys };
    });
  }, [raw, mats, prodByDay, today, horizon]);

  /* ออเดอร์ที่อ้างเลขลูกค้าอย่างเดียว (ยังไม่ถูกจับเข้า mat ไหน) — ต้องรายงาน ห้ามกลืน */
  const unassigned = useMemo(() => {
    if (!raw || !mats.length) return { qty: 0, n: 0, keys: [] };
    const matSet = new Set(mats.map((p) => normK(p.mat_no)));
    const anyKeys = new Set();
    mats.forEach((p) => demandKeysOf(p).forEach((k) => anyKeys.add(k)));
    const hit = raw.orders.filter((r) => !matSet.has(normK(r.mat_no)) && rowMatchesProduct(r, anyKeys));
    return { qty: hit.reduce((a, r) => a + (Number(r.qty) || 0), 0), n: hit.length, keys: [...new Set(hit.map((r) => r.mat_no))] };
  }, [raw, mats]);

  if (raw === null) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลดความต้องการลูกค้า…</div>;

  const withDemand = perMat.filter((x) => x.sim);
  const shortList = withDemand.filter((x) => x.adv.key === 'short');
  const excessList = withDemand.filter((x) => x.adv.key === 'excess');
  const group = mats.length > 1;

  /* ── ไม่มีความต้องการเลยทั้งกลุ่ม = บอกตรงๆ + ชี้ทางไปแก้ ห้ามโชว์ 0 ── */
  if (!withDemand.length) {
    const pn = mats[0]?.p_no;
    return (
      <div style={{ padding: '10px 13px', borderRadius: 8, border: '1px solid #f59e0b55', background: '#f59e0b14', fontSize: 12, color: '#f59e0b', lineHeight: 1.7 }}>
        ⚠️ <b>ยังเทียบกับความต้องการลูกค้าไม่ได้</b> — ไม่พบออเดอร์/forecast ที่ผูกกับ{group ? 'สินค้าในกลุ่มนี้' : 'สินค้านี้'}
        <div style={{ color: 'var(--muted)', marginTop: 4 }}>
          ออเดอร์จากลูกค้าอ้าง <b>เลขพาร์ทลูกค้า</b> แต่ยอดผลิตอ้าง <b>เลข SAP</b> — ต้องมี <code>P/N</code> ตรงกับที่ลูกค้าใช้ ระบบถึงจับคู่ได้
          {pn ? <> · ตอนนี้ตั้งไว้เป็น <b>{pn}</b></> : <> · <b>ตอนนี้ยังไม่ได้ตั้ง P/N เลย</b></>}
          <br />แก้ที่ <b>Product Master → ช่อง P/N</b> หรือปุ่ม 🔗 จับคู่เลข SAP ในหน้า Planner &amp; Sales
        </div>
      </div>
    );
  }

  /* กราฟใช้ตัวที่มีความต้องการมากสุดเป็นตัวแสดง (โหมดเดี่ยว = ตัวเดียวอยู่แล้ว) */
  const focus = withDemand.reduce((a, b) => ((b.sim?.cumDem || 0) > (a.sim?.cumDem || 0) ? b : a), withDemand[0]);
  const rows = (focus.sim?.days || []).map((x) => ({
    key: x.d, label: dLabel(x.d), empty: !x.produced && !x.demand,
    segs: [{ v: x.produced, color: x.future ? 'var(--border2)' : 'var(--accent)', name: x.future ? 'ยังไม่ผลิต' : 'ผลิตได้' }],
    marker: x.demand > 0 ? { v: x.demand, color: x.src === 'order' ? '#f59e0b' : '#a78bfa', name: x.src === 'order' ? 'ต้องส่ง (ออเดอร์)' : 'คาดการณ์ (forecast)' } : null,
  }));
  const stockRows = (focus.sim?.days || []).map((x) => ({
    key: x.d, label: dLabel(x.d),
    segs: [{ v: Math.max(0, x.stock), color: x.stock < 0 ? '#ef4444' : x.future ? '#4d9fff' : 'var(--accent)', name: 'สต็อกคงเหลือ' }],
  }));

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err && <div style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid #ef444466', background: '#ef444414', fontSize: 11.5, color: '#ef4444' }}>🔴 โหลดข้อมูลไม่ครบ — ตัวเลขอาจไม่ตรง<br />{err}</div>}

      {/* ── โหมดกลุ่ม: ตัดสินราย MAT ห้ามรวมยอด ── */}
      {group ? (
        <>
          <div style={{ padding: '11px 13px', borderRadius: 9, border: `1px solid ${shortList.length ? '#ef4444' : '#22c55e'}66`, background: `${shortList.length ? '#ef4444' : '#22c55e'}14` }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, color: shortList.length ? '#ef4444' : '#22c55e' }}>
              {shortList.length ? `🔴 มี ${shortList.length} เลข SAP ที่ของจะขาด` : '🟢 ทุกเลข SAP ในกลุ่มมีของพอ'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, lineHeight: 1.7 }}>
              {shortList.length
                ? <>ต้องเร่ง: <b>{shortList.map((x) => x.p.mat_no).join(' · ')}</b></>
                : 'ไม่มีเลขไหนที่สต็อกจะติดลบในช่วงที่ดู'}
              {/* ⚠️ ห้ามบอกว่า "รวมกลุ่มแล้วพอ" — สลับขายข้ามเลข SAP ไม่ได้ในทางปฏิบัติ */}
              {shortList.length > 0 && excessList.length > 0 && (
                <div style={{ marginTop: 5, padding: '6px 9px', borderRadius: 7, background: 'var(--bg2)', border: '1px dashed var(--border2)', color: 'var(--muted)' }}>
                  ℹ️ ในกลุ่มมีเลขที่ของเหลืออยู่ ({excessList.map((x) => x.p.mat_no).join(' · ')}) —
                  <b> โอนมาใช้แทนกันได้เฉพาะกรณีฉุกเฉิน และต้องปรับยอดใน SAP ด้วย</b> ระบบจึงไม่นับรวมให้
                </div>
              )}
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620, fontSize: 12 }}>
              <thead><tr style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'right' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>MAT SAP</th>
                <th style={{ padding: '6px 8px' }}>สต็อก</th><th style={{ padding: '6px 8px' }}>ต้องส่ง</th>
                <th style={{ padding: '6px 8px' }}>ผลิตได้</th><th style={{ padding: '6px 8px' }}>ปลายช่วง</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>สถานะ</th>
              </tr></thead>
              <tbody>
                {perMat.map((x) => (
                  <tr key={x.p.mat_no} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 8px', fontWeight: 700 }}>
                      {x.p.mat_no}
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.p.name}</div>
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }}>{x.stock == null ? <span style={{ color: 'var(--muted)' }}>—</span> : fmt(x.stock)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: '#f59e0b', fontWeight: 700 }}>{x.sim ? fmt(x.sim.cumDem) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--accent)' }}>{x.sim ? fmt(x.sim.cumProd) : fmt(Object.values(x.pbd).reduce((a, b) => a + b, 0))}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, color: x.sim ? (x.sim.endStock < 0 ? '#ef4444' : 'var(--accent)') : 'var(--muted)' }}>{x.sim ? fmt(x.sim.endStock) : '—'}</td>
                    <td style={{ padding: '7px 8px', color: x.adv.color, fontWeight: 700 }}>
                      {x.sim ? <>{x.adv.icon} {x.adv.label}</> : <span style={{ color: 'var(--muted)' }}>❔ ไม่มีออเดอร์ผูกกับเลขนี้</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
            ⚠️ <b>ตัดสินพอ/ขาดแยกทีละเลข SAP ไม่รวมยอดกัน</b> — product เดียวกันแต่คนละปลายทางลูกค้า
            แลกของกันไม่ได้ (ยอดใน SAP จะเพี้ยน) · เลขที่ไม่มีออเดอร์ผูก = ออเดอร์ถูกบันทึกใต้เลขอื่นของกลุ่ม ไม่ใช่ลูกค้าไม่สั่ง
          </div>
          {/* ⚠️ เคสจริง 2026-08-24: ออเดอร์ของ "ทุกลูกค้า" ไปกองที่เลขเดียว เพราะตอนนำเข้า EDI
              เลขพาร์ทลูกค้าตัวเดียวชี้ได้หลายเลข SAP แล้วระบบเลือกตัวแรกให้ (ยังไม่ได้ตั้งชื่อลูกค้าให้ ship-to)
              → เลขที่เหลือดูเหมือนไม่มีใครสั่ง (ไม่ผลิต) · เลขที่รับไปหมดดูเหมือนของจะขาด — ผิดทั้งคู่
              ห้ามซ่อน: ถ้ามีเลขเดียวในกลุ่มที่มีออเดอร์ ต้องเตือนให้ไปตรวจก่อนเร่งผลิต */}
          {withDemand.length === 1 && perMat.length > 1 && (
            <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.7, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '7px 10px' }}>
              🔎 <b>ทั้งกลุ่มมีออเดอร์อยู่เลขเดียว</b> — ถ้าจริงๆ มีลูกค้าเจ้าอื่นสั่งพาร์ทนี้ด้วย แปลว่าตอนนำเข้า EDI
              ระบบยัง<b>แยกปลายทางลูกค้าไม่ออก</b> แล้วยกออเดอร์มากองที่เลขเดียว
              <div style={{ marginTop: 2, opacity: 0.9 }}>แก้: 🚚 Delivery → ⚙️ Ship-to Plant Config ตั้งชื่อลูกค้าให้ code ปลายทาง (เช่น GRBNA → AAT) แล้วอัพไฟล์ EDI ใหม่</div>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: '11px 13px', borderRadius: 9, border: `1px solid ${focus.adv.color}66`, background: `${focus.adv.color}14` }}>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: focus.adv.color }}>{focus.adv.icon} {focus.adv.label}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, lineHeight: 1.6 }}>{focus.adv.text}</div>
        </div>
      )}

      {/* ออเดอร์ที่อ้างเลขลูกค้าล้วน — ไม่เดาว่าเป็นของ mat ไหน แต่ต้องบอก */}
      {unassigned.qty > 0 && (
        <div style={{ padding: '8px 11px', borderRadius: 8, border: '1px dashed #f59e0b66', fontSize: 11.5, color: '#f59e0b', lineHeight: 1.7 }}>
          ℹ️ มีออเดอร์อีก {unassigned.n} รอบ ({fmt(unassigned.qty)} ชิ้น) ที่บันทึกด้วยเลข <b>{unassigned.keys.join(', ')}</b> ซึ่งยังไม่ผูกกับเลข SAP ตัวไหน —
          <b> ระบบไม่เดาให้ว่าเป็นของเลขไหน</b> ตั้ง P/N ให้ตรงที่ Product Master แล้วจะถูกนับเข้าเอง
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Stat label={group ? `สต็อก ${focus.p.mat_no}` : 'สต็อกตอนนี้'} value={focus.stock == null ? '—' : fmt(focus.stock)} unit="ชิ้น"
          sub={focus.stock == null ? 'ไม่มีข้อมูลสต็อกของเลขนี้' : 'จากคลัง FG'} color={focus.stock == null ? 'var(--muted)' : undefined} />
        <Stat label="ต้องส่ง (ในช่วงที่ดู)" value={fmt(focus.sim?.cumDem)} unit="ชิ้น"
          sub={focus.D.hasOrder ? `ออเดอร์จริง${focus.D.hasForecast ? ' + forecast' : ''}` : 'forecast เท่านั้น (ยังไม่มีออเดอร์)'} color="#f59e0b" />
        <Stat label="ผลิตได้ (ในช่วงที่ดู)" value={fmt(focus.sim?.cumProd)} unit="ชิ้น" color="var(--accent)"
          sub={focus.rate ? `เฉลี่ย ${fmt(focus.rate)} ชิ้น/วันผลิต` : 'ยังไม่มีการผลิตในช่วงนี้'} />
        <Stat label="ปลายช่วงเหลือ" value={fmt(focus.sim?.endStock)} unit="ชิ้น"
          color={focus.sim?.endStock < 0 ? '#ef4444' : focus.sim?.endStock > 0 ? 'var(--accent)' : undefined}
          sub={(focus.sim?.days || []).some((x) => x.stock < 0) ? '⚠️ มีวันที่ของไม่พอ' : 'ไม่มีวันที่ของขาด'} />
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>มองไปข้างหน้า</div>
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}
            style={{ width: 110, padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12 }}>
            {[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} วัน</option>)}
          </select>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
          ผลิตรายวัน เทียบ ความต้องการ{group && <span style={{ color: 'var(--muted)', fontWeight: 600 }}> — {focus.p.mat_no} (เลขที่มีออเดอร์มากสุดในกลุ่ม)</span>}
        </div>
        <DailyBars data={rows} height={140} unit=" ชิ้น" />
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.7 }}>
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>■ ผลิตได้</span> ·
          <span style={{ color: '#f59e0b', fontWeight: 700 }}> ▬ ต้องส่ง (ออเดอร์จริง)</span> ·
          <span style={{ color: '#a78bfa', fontWeight: 700 }}> ▬ คาดการณ์ (forecast)</span> ·
          แท่งเทา = วันข้างหน้า (ยังไม่ผลิต — ระบบไม่เดาว่าจะผลิตได้เท่าไหร่)
          <br />วันที่มีออเดอร์จริงแล้ว จะ<b>ไม่</b>เอา forecast มาบวกทับ (นับซ้ำ)
        </div>
      </div>

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
