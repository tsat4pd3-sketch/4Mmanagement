/* ══ 📋 กรอบแผน (Layer 1) บนหน้ากะ — ของจริงคือ Layer 2 (2026-10-01 · คำสั่ง user) ═══════════
   *"ระบบนี้จะเป็นเหมือนกรอบ เลเยอร์ 1 · ผลิตเปิดคัมบัง คอนเฟิร์มยอด เป็นเลเยอร์ 2"*

   🔴🔴 แผงนี้ **อ่านอย่างเดียว ไม่สร้างใบผลิต ไม่เขียน DB เลย**
   เดิม (30/09) มีปุ่ม "▶ เริ่มล็อตนี้" ที่สร้างใบ manual 1 ใบตามยอดล็อต — **ถอดออกแล้ว** เพราะ
   วัดจากฐานจริง 25/09: **1 พาร์ท 1 กะ = ใบผลิต 5–40 ใบ** (คัมบัง 1 ใบ = 1 กล่อง 10–300 ชิ้น)
   และ `manual = 0` ทุกแถว **แม้แต่ไลน์ปั๊ม A/B/C** (30 วัน manual แค่ 1.4–3.3%)
   ⇒ ออกใบตามล็อตแล้วหน้างานสแกนคัมบังตามปกติด้วย = **เป้าในกะถูกนับซ้ำ**
     (วางแผน 1,000 + สแกนจริง 7 ใบ × 60 ⇒ เป้ากลายเป็น 1,420)

   ⇒ หน้างานทำงานเหมือนเดิมทุกอย่าง (สแกนคัมบัง / ✍️ เปิดเป้า manual) · ระบบจับคู่ยอดให้เอง
     ผ่าน `matchPlanToActual()` (`utils/planLots.js`) **ห้ามคิดเองในไฟล์นี้**
   🔴 **ไม่ตัดสินแทนคน** — ไม่ปิดล็อตอัตโนมัติ ไม่เตือนว่าทำผิดแผน แค่แสดงว่าเทียบกรอบแล้วเป็นยังไง
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import MatLabel from './MatLabel';
import { qtyText, splitPlanForSession, matchPlanToActual } from '../utils/planLots';
import { fetchAllPages } from '../utils/fetchByIds';

const shiftLabel = (sh) => (sh === 'night' ? 'กะดึก' : 'กะเช้า');
const STATE_COLOR = { done: '#22c55e', partial: '#4d9fff', pending: 'var(--border2)' };

export default function PlannedLotQueue({ session, orders = [] }) {
  const [lots, setLots] = useState([]);
  /* 🔴 ยอดจริงต้องเป็น "ทั้งวันงานของไลน์" ให้ตรงกับแผนที่โหลดทั้งวัน (QC 05/10)
     เดิมรับ `orders` ของ**กะที่เปิดอยู่กะเดียว**จาก DailyReport ⇒ เปิดกะดึกแล้วล็อตที่กะเช้าทำครบ
     ขึ้น "ยังไม่เริ่ม" · ยอดกะเช้าหายจากการปันข้ามกะ (ขัดกติกา matchPlanToActual เอง)
     → โหลดใบของทุกกะในวันงานเอง · `orders` (กะนี้) ใช้เป็นตัวกระตุ้นโหลดใหม่ + ถอยใช้ตอนโหลดไม่ได้ */
  const [dayOrders, setDayOrders] = useState(null);     // null = ยังไม่รู้/โหลดไม่ได้
  const [dayErr, setDayErr] = useState(null);
  /* primitive ล้วน (กฎเขียน DB ข้อ 9) — ใบกะนี้เปลี่ยนเมื่อไหร่ โหลดยอดทั้งวันใหม่ */
  const ordersSig = (orders || []).map(o => `${o.id}:${o.status}:${o.qty_actual ?? ''}:${o.qty_ok ?? ''}`).join('|');

  const load = useCallback(async (alive = () => true) => {
    if (!session?.line_name || !session?.work_date) { setLots([]); setDayOrders(null); return; }
    /* 🔴 โหลดทั้งวันงานของไลน์ ไม่กรองกะ — กรองกะเคยทำให้กะดึกมองไม่เห็นแผนกะเช้าที่ยังไม่ได้เริ่ม
       แล้วจอเงียบสนิท (เคสจริง 30/09 LINE B 6 ล็อต) · แบ่งกองที่ `splitPlanForSession()` */
    const { data, error } = await supabaseDR.from('production_plan_lots')
      .select('id, seq, shift, mat_no, part_name, qty_plan, machine_no, die_no, status, note')
      .eq('work_date', session.work_date).eq('line_name', session.line_name)
      .neq('status', 'cancelled');
    if (!alive()) return;
    if (error) { toast.error(`โหลดแผนสั่งงานไม่สำเร็จ: ${error.message}`); return; }
    setLots(data || []);
    if (!data?.length) { setDayOrders(null); setDayErr(null); return; }   // ไม่มีแผน = ไม่ต้องโหลดยอด
    const r = await fetchAllPages(() => supabaseDR.from('prod_orders')
      .select('id, mat_no, status, qty, qty_ok, qty_actual, production_sessions!inner(line_name, work_date)')
      .eq('production_sessions.line_name', session.line_name)
      .eq('production_sessions.work_date', session.work_date));
    if (!alive()) return;
    if (r.error || r.truncated) { setDayOrders(null); setDayErr(r.error || 'ใบผลิตเยอะเกินเพดาน'); return; }
    setDayOrders(r.rows); setDayErr(null);
  }, [session?.line_name, session?.work_date, ordersSig]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { let on = true; load(() => on); return () => { on = false; }; }, [load]);

  const split = splitPlanForSession(lots, session);
  if (!split.hasAny) return null;                      // ไม่มีแผนจริงๆ = ไม่วาดอะไรเลย

  /* 🔴 ปันยอดต่อ (ไลน์+วันงาน+พาร์ท) **ข้ามกะ** — แยกกะจะทำให้ยอดเดียวถูกนับ 2 รอบ
     เมื่อล็อตกะเช้าถูกทำต่อในกะดึก (ของจริงเกิดแล้ว 30/09) */
  const m = matchPlanToActual([...split.mine, ...split.other], dayOrders ?? orders);
  const rowOf = (lotId) => m.rows.find(r => r.lot.id === lotId);
  /* 🔴 "ค้างจากกะก่อน" ตัดสินจาก**ยอดที่ทำได้จริง** ไม่ใช่คอลัมน์สถานะ (ไม่มีใครเขียนแล้ว)
     ⇒ ล็อตกะอื่นที่ยังไม่ครบ = งานที่กะนี้ทำต่อได้ · ที่ครบแล้ว = แค่บอกให้รู้ */
  const otherRows = split.other.map(l => rowOf(l.id)).filter(Boolean);
  const carriedRows  = otherRows.filter(r => r.state !== 'done');
  const doneElseRows = otherRows.filter(r => r.state === 'done');

  const Row = ({ r, carried }) => {
    const l = r.lot;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', fontSize: 12,
        padding: '4px 8px', background: 'var(--bg2)', borderRadius: 6,
        borderLeft: `3px solid ${carried && r.state === 'pending' ? '#f59e0b' : STATE_COLOR[r.state]}` }}>
        <b style={{ minWidth: 18, textAlign: 'center', color: 'var(--muted)' }}>{l.seq}</b>
        <MatLabel mat={l.mat_no} name={l.part_name} size={12} />
        {l.machine_no && <span style={{ fontSize: 11, color: '#94a3b8' }}>⚙️ {l.machine_no}</span>}
        {l.die_no && <span style={{ fontSize: 11, color: '#94a3b8' }}>🔧 {l.die_no}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12 }}>
          <b style={{ color: STATE_COLOR[r.state] }}>{qtyText(r.donePcs)}</b>
          <span style={{ color: 'var(--muted)' }}> / {qtyText(l.qty_plan)} ชิ้น</span>
          {r.pct != null && <b style={{ color: STATE_COLOR[r.state] }}> · {r.pct}%</b>}
        </span>
        {r.fromOrders > 0 && (
          <span title="ยอดนี้รวมมาจากใบผลิต/บัตรคัมบังที่หน้างานเปิดจริง" style={{ fontSize: 11, color: 'var(--muted)' }}>
            จาก {r.fromOrders} ใบ
          </span>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 10, padding: '10px 14px', background: 'rgba(77,159,255,0.07)', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 9 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: '#4d9fff', marginBottom: 2 }}>
        📋 กรอบแผนจากทีมวางแผน
        {m.planPcs > 0 && (
          <span style={{ color: 'var(--text2)', fontWeight: 700 }}>
            {' '}— ทำได้ {qtyText(m.donePcs)}/{qtyText(m.planPcs)} ชิ้น ({m.pct}%) · เสร็จ {m.doneLots}/{m.rows.length} ล็อต
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
        แผนเป็น<b>กรอบ</b> ไม่ได้สั่งให้เปิดใบ — หน้างานสแกนคัมบัง/เปิดเป้าตามปกติ ระบบรวมยอดทุกกะของวันมาเทียบให้เอง
      </div>
      {dayErr && (
        <div style={{ fontSize: 11.5, color: '#f59e0b', marginBottom: 6 }}>
          ⚠️ โหลดยอดทั้งวันไม่ได้ ({dayErr}) — ตัวเลขด้านล่างนับเฉพาะใบของกะนี้ ล็อตที่กะอื่นทำไปแล้วอาจขึ้นว่ายังไม่เริ่ม
        </div>
      )}

      {split.mine.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {split.mine.map(l => { const r = rowOf(l.id); return r ? <Row key={l.id} r={r} /> : null; })}
        </div>
      )}

      {/* แผนของกะก่อนที่ยังไม่ได้ทำ — กะนี้ทำต่อได้ (ยอดปันข้ามกะให้แล้ว) */}
      {carriedRows.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px dashed var(--border2)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', marginBottom: 5 }}>
            ⤵ ค้างจาก{shiftLabel(carriedRows[0].lot.shift)} {carriedRows.length} ล็อต — ยังไม่ครบกรอบ กะนี้ทำต่อได้
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {carriedRows.map(r => <Row key={r.lot.id} r={r} carried />)}
          </div>
        </div>
      )}

      {/* 🔴 ทำเกินแผน / ทำนอกแผน — ต้องโชว์ ห้ามกลืน (เป็นข้อมูล ไม่ใช่ความผิด) */}
      {(m.over.length > 0 || m.offPlan.length > 0) && (
        <div style={{ marginTop: 7, fontSize: 11.5, color: 'var(--text2)', display: 'grid', gap: 2 }}>
          {m.over.length > 0 && (
            <div>➕ <b>ทำเกินกรอบ</b> {m.over.map(o => `${o.mat_no} +${qtyText(o.pcs)}`).join(' · ')} ชิ้น</div>
          )}
          {m.offPlan.length > 0 && (
            <div>🆕 <b>ทำนอกแผน</b> {m.offPlan.map(o => `${o.mat_no} ${qtyText(o.pcs)}`).join(' · ')} ชิ้น
              <span style={{ color: 'var(--muted)' }}> — ไม่ใช่ความผิด แต่วางแผนต้องรู้</span></div>
          )}
        </div>
      )}

      {doneElseRows.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
          ✓ อีก {doneElseRows.length} ล็อตของกะอื่นในวันนี้ครบกรอบแล้ว
        </div>
      )}
    </div>
  );
}
