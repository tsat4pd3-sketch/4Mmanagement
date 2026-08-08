import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import useIsMobile from '../utils/useIsMobile';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { FRAME_START, frameMin, breaksToFrame } from '../utils/timeFrame';

/* ─── DELIVERY — Shipping Time Chart + Ship-to Config (Logistic) ──────────
   ติดตามรอบส่งงานลูกค้ารายวัน (walkback 4 activity, FG stock, ranking ดิว)
   ส่วน Forecast Planner + อัพโหลดไฟล์ของ Sales อยู่หน้า 📈 Planner & Sales */

const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 16,
};
const btn = (active) => ({
  padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
  background: active ? 'var(--accent)' : 'var(--bg2)', color: active ? '#08130a' : 'var(--text2)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
});
const inputSt = {
  padding: '8px 10px', borderRadius: 8, fontSize: 13, background: 'var(--bg2)',
  border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-body)',
};

const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
const workDateStr = () => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); return dateStr(d); };

/* ─── Shipping Time Chart Tab (Logistic) ──────────────────────────────────── */
const SHIP_STATUS = {
  pending:   { label: '🕐 รอยืนยัน',    color: '#f59e0b', next: 'confirmed', nextLabel: '✔️ ยืนยันออเดอร์แล้ว' },
  confirmed: { label: '✔️ ยืนยันแล้ว',  color: '#38bdf8', next: 'prepared',  nextLabel: '📦 เตรียมของแล้ว' },
  prepared:  { label: '📦 เตรียมแล้ว',  color: '#0ea5e9', next: 'loaded',    nextLabel: '🚛 โหลดขึ้นรถแล้ว' },
  loaded:    { label: '🚛 โหลดแล้ว',    color: '#a855f7', next: 'shipped',   nextLabel: '🚚 ส่งถึงลูกค้าแล้ว' },
  shipped:   { label: '✅ ส่งแล้ว',     color: '#22c55e', next: null,        nextLabel: null },
};
const SHIP_RANK = { pending: 0, confirmed: 1, prepared: 2, loaded: 3, shipped: 4 };
function ShippingTab({ fullName, refreshKey, custLabel, canAdd, shipToCodes }) {
  // มือถือ ≤768px: ชาร์ต 24 ชม.เลื่อนแนวนอนได้ + ป้ายลูกค้า sticky ซ้าย (desktop เต็มจอเดียวเหมือนเดิม)
  const isMobile = useIsMobile();
  const chartLeftW = isMobile ? 96 : 130;
  // กรอบ "วันงาน" 08:00 → 08:00 วันถัดไป (ตามกฎเวลาทำงานของระบบ) — รอบส่งตี 0–7 โมง คือช่วงกะดึกของวันงานนั้น
  const [day, setDay] = useState(workDateStr());
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(null);
  const [fgStock, setFgStock] = useState({});   // mat_no → { total, lines } — stock FG พร้อมส่งใน warehouse
  const [cardFilter, setCardFilter] = useState('todo');   // 'todo' | 'overdue' | 'shipped' | 'all'
  const [sortMode, setSortMode] = useState('urgent');     // 'urgent' = ใกล้ดิว/หลุดเฟสขึ้นก่อน · 'time' = ตามเวลาส่ง
  const [wfSteps, setWfSteps] = useState([]);              // standard workflow (walkback) — deadline ต่อเฟส
  const [popup, setPopup] = useState(null);     // { o, x, y } — popup รายละเอียดเมื่อคลิกบล็อกบนชาร์ต
  const [highlightId, setHighlightId] = useState(null);
  const [collapsedCust, setCollapsedCust] = useState({});  // ย่อแถวลูกค้า (ข้อมูลเยอะ) — ยังเห็นจุดสถานะแบบย่อ
  const [breakPolicies, setBreakPolicies] = useState([]);  // เงาเวลาพักบนชาร์ต (มาตรฐานเดียวกับบอร์ด Heijunka)
  const [pastDue, setPastDue] = useState([]);              // ใบค้างส่งจากวันงานก่อนหน้า (ย้อน 14 วัน)
  // ➕ คีย์ order ด่วนทีละใบ (ลูกค้า add order นอกไฟล์ EDI เช่นโทรสั่ง) — ไม่ต้องรออัพโหลด 862 รอบถัดไป
  const [showAdd, setShowAdd] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const emptyAdd = { customer: '', mat_no: '', part_name: '', qty: '', due_date: workDateStr(), ship_time: '', order_no: '', dock_code: '' };
  const [addForm, setAddForm] = useState(emptyAdd);
  const [prodNames, setProdNames] = useState({});          // mat_no → ชื่อพาร์ท (datalist + เติมชื่ออัตโนมัติ)
  useEffect(() => {
    supabaseDR.from('break_policies').select('*').eq('is_active', true)
      .then(({ data }) => setBreakPolicies(data || []));
    supabaseDR.from('dr_products').select('mat_no, name').eq('is_active', true)
      .then(({ data }) => {
        const m = {};
        (data || []).forEach(p => { if (!m[p.mat_no]) m[p.mat_no] = p.name; });
        setProdNames(m);
      });
  }, []);

  const saveAddOrder = async () => {
    const mat = addForm.mat_no.trim().toUpperCase();
    const qty = parseFloat(addForm.qty);
    if (!mat) { toast.error('กรอก MAT No.'); return; }
    if (!qty || qty <= 0) { toast.error('จำนวนต้องมากกว่า 0'); return; }
    if (!addForm.due_date) { toast.error('เลือกวันที่ส่ง'); return; }
    setAddSaving(true);
    const { error } = await supabaseDR.from('customer_shipping_orders').insert({
      customer: addForm.customer.trim() || null,
      mat_no: mat,
      part_name: addForm.part_name.trim() || prodNames[mat] || null,
      qty,
      due_date: addForm.due_date,
      ship_time: addForm.ship_time || null,
      order_no: addForm.order_no.trim() || null,
      dock_code: addForm.dock_code.trim() || null,
      source: 'manual',
    });
    setAddSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`➕ เพิ่ม order ${mat} × ${fmt(qty)} แล้ว`);
    setShowAdd(false);
    setAddForm(emptyAdd);
    if (addForm.due_date !== day && addForm.due_date >= workDateStr()) setDay(addForm.due_date);
    else load();
  };

  // ลบได้เฉพาะใบที่คีย์มือและยังไม่เริ่ม workflow — ใบจาก EDI ให้จัดการด้วยการอัพโหลดแทนที่ตามปกติ
  const deleteManualOrder = async (o) => {
    if (!window.confirm(`ลบ order ${o.mat_no} × ${fmt(o.qty)} (คีย์มือ)?`)) return;
    const { error } = await supabaseDR.from('customer_shipping_orders')
      .delete().eq('id', o.id).eq('source', 'manual').eq('status', 'pending');
    if (error) { toast.error(error.message); return; }
    toast.success('ลบแล้ว');
    setPopup(null);
    load();
  };

  const nextDayOf = (d) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + 1); return dateStr(x); };

  const load = useCallback(async () => {
    // วันงาน D = (D, เวลา ≥ 08:00 หรือไม่ระบุเวลา) + (D+1, เวลา < 08:00 = กะดึกข้ามคืน)
    const nd = nextDayOf(day);
    const back = new Date(`${day}T12:00:00`);
    back.setDate(back.getDate() - 14);
    const [{ data: d1 }, { data: d2 }, { data: wfs }, { data: past }] = await Promise.all([
      supabaseDR.from('customer_shipping_orders').select('*').eq('due_date', day),
      supabaseDR.from('customer_shipping_orders').select('*').eq('due_date', nd).not('ship_time', 'is', null).lt('ship_time', '08:00'),
      supabaseDR.from('shipping_workflow_steps').select('*').eq('is_active', true).order('step_no'),
      // ใบค้างส่งจากวันงานก่อนหน้า (ย้อน 14 วัน) — เตือนบนหัวหน้า ไม่ให้ของเก่าหายเงียบตอนข้ามวัน
      supabaseDR.from('customer_shipping_orders').select('id, due_date')
        .gte('due_date', dateStr(back)).lt('due_date', day).neq('status', 'shipped'),
    ]);
    setWfSteps(wfs || []);
    setPastDue(past || []);
    const list = [
      ...(d1 || []).filter(o => !o.ship_time || o.ship_time.slice(0, 5) >= '08:00'),
      ...(d2 || []),
    ];
    // เรียงตามเวลาบนกรอบวันงาน — ใช้ frameMin จาก utils/timeFrame (ห้ามเขียน wrap นาทีเองซ้ำ — UI-CONVENTIONS §6) · ไม่ระบุเวลา = ท้ายสุด
    const wrapKey = (o) => frameMin(o.ship_time?.slice(0, 5)) ?? 100000;
    list.sort((a, b) => wrapKey(a) - wrapKey(b));
    setOrders(list);
    setPopup(null);
    const mats = [...new Set(list.map(o => o.mat_no))];
    if (mats.length) {
      const { data: st } = await supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand').in('mat_no', mats);
      const m = {};
      (st || []).forEach(r => {
        const q = parseFloat(r.qty_on_hand) || 0;
        if (q <= 0) return;
        const e = m[r.mat_no] = m[r.mat_no] || { total: 0, lines: [] };
        e.total += q;
        e.lines.push({ line_name: r.line_name, qty: q });
      });
      setFgStock(m);
    } else setFgStock({});
  }, [day]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const shiftDay = (n) => {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + n);
    setDay(dateStr(d));
  };

  /* เวลาบนกรอบวันงาน: ใช้ frameMin จาก utils/timeFrame (ห้ามเขียน wrap นาทีเองซ้ำ — UI-CONVENTIONS §6) */
  const now = new Date();
  const isToday = day === workDateStr();
  const isPastDay = day < workDateStr();   // ดูวันงานที่ผ่านมาแล้ว — deadline ทุกตัวของวันนั้นผ่านไปหมดแล้ว
  const nowW = frameMin(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
  // เลยเวลา = ยังไม่ส่ง และ (วันงานนั้นผ่านไปแล้วทั้งวัน หรือ วันนี้แต่เลยเวลาส่งแล้ว)
  // — เดิมเช็คเฉพาะ isToday ทำให้พอข้ามวัน ใบค้างส่งกลายเป็นเหลือง "รอยืนยัน" เฉยๆ ทั้งที่ตกดิวไปแล้ว
  const isOverdue = (o) => o.status !== 'shipped'
    && (isPastDay || (isToday && frameMin(o.ship_time) != null && frameMin(o.ship_time) < nowW));

  // ── Standard workflow (walkback): deadline ต่อเฟส = เวลาส่ง − offset_min ──
  const stepsForCust = (customer) => {
    const own = wfSteps.filter(st => st.customer === customer);
    return own.length ? own : wfSteps.filter(st => st.customer == null);
  };
  const phaseList = (o) => {
    const tw = frameMin(o.ship_time);
    if (tw == null || !wfSteps.length) return [];
    return stepsForCust(o.customer).map(st => {
      const dl = tw - st.offset_min;
      const m = ((dl % 1440) + 1440) % 1440;
      const done = (SHIP_RANK[o.status] ?? 0) >= (SHIP_RANK[st.requires_status] ?? 9);
      const missed = !done && (isPastDay || (isToday && nowW > dl));
      return { ...st, dlW: dl, deadline: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, done, missed };
    });
  };
  const phaseLate = (o) => o.status !== 'shipped' && !isOverdue(o) && phaseList(o).some(ph => ph.missed);

  const byCustomer = useMemo(() => {
    const m = {};
    orders.forEach(o => {
      const key = custLabel ? custLabel(o.customer) : (o.customer || '— ไม่ระบุลูกค้า —');
      (m[key] = m[key] || []).push(o);
    });
    return m;
  }, [orders, custLabel]);

  // จัดสรร stock พร้อมส่งให้รอบที่ยังไม่ส่ง เรียงตามเวลา (FIFO) — รอบไหนพร้อมส่ง/ขาดเท่าไหร่
  const coverage = useMemo(() => {
    const remain = {};
    Object.entries(fgStock).forEach(([m, v]) => { remain[m] = v.total; });
    const map = {};
    orders.forEach(o => {
      if (o.status === 'shipped') return;
      const avail = remain[o.mat_no] || 0;
      const use = Math.min(avail, Number(o.qty));
      remain[o.mat_no] = avail - use;
      map[o.id] = { covered: use, short: Number(o.qty) - use, tracked: !!fgStock[o.mat_no] };
    });
    return map;
  }, [orders, fgStock]);

  const advance = async (o) => {
    const st = SHIP_STATUS[o.status] || SHIP_STATUS.pending;
    if (!st.next) return;
    setBusy(o.id);
    const payload = { status: st.next };
    if (st.next === 'shipped') { payload.shipped_at = new Date().toISOString(); payload.shipped_by = fullName || 'Logistic'; }
    // guard สถานะปัจจุบันแบบ atomic — กันกดรัว/2 เครื่องเลื่อนสถานะเดียวกันซ้ำ
    // (เครื่องสโตร์ใช้บัญชีร่วม) ถ้าไม่ guard จะหักสต็อก + ยิง Telegram ซ้ำ 2 รอบต่อการส่ง 1 ครั้ง
    const { data: updated, error } = await supabaseDR.from('customer_shipping_orders')
      .update(payload).eq('id', o.id).eq('status', o.status).select('id');
    if (error) { toast.error(error.message); setBusy(null); return; }
    if (!updated || updated.length === 0) { setBusy(null); await load(); return; } // มีคนเลื่อนไปก่อนแล้ว
    // ส่งแล้ว → หักสต็อก FG จากคลังอัตโนมัติเท่าที่มีบันทึกไว้ (ไลน์ที่มีของมากสุดก่อน)
    if (st.next === 'shipped') {
      const entry = fgStock[o.mat_no];
      if (entry?.total > 0) {
        let left = Number(o.qty);
        const txns = [];
        [...entry.lines].sort((a, b) => b.qty - a.qty).forEach(l => {
          if (left <= 0) return;
          const use = Math.min(l.qty, left);
          left -= use;
          txns.push({
            line_name: l.line_name, mat_no: o.mat_no, part_name: o.part_name, qty: use,
            type: 'consume', work_date: workDateStr(),
            note: `ส่งลูกค้า ${o.customer || ''} · ${o.due_date} ${o.ship_time || ''}${o.order_no ? ` · PO ${o.order_no}` : ''}`,
            created_by: fullName || 'Logistic',
          });
        });
        if (txns.length) {
          const { error: e2 } = await supabaseDR.from('line_stock_transactions').insert(txns);
          if (e2) toast.error('ส่งแล้วแต่ตัดสต็อกไม่สำเร็จ: ' + e2.message);
        }
      }
    }
    if (st.next === 'shipped') {
      supabase.functions.invoke('send-notification', {
        body: { event: 'shipping_shipped', ship: {
          ship_time: (o.ship_time || '').slice(0, 5), due_date: o.due_date,
          customer: custLabel ? custLabel(o.customer) : o.customer, dock_code: o.dock_code,
          mat_no: o.mat_no, customer_part_no: o.customer_part_no, part_name: o.part_name,
          qty: o.qty, order_no: o.order_no, shipped_by: fullName || 'Logistic',
        } },
      }).catch(() => {});
    }
    toast.success(st.next === 'shipped' ? `🚚 ส่ง ${o.mat_no} แล้ว` : `📦 เตรียม ${o.mat_no} แล้ว`);
    await load();
    setBusy(null);
  };

  const shippedCount = orders.filter(o => o.status === 'shipped').length;
  const overdueCount = orders.filter(isOverdue).length;
  const shortCount = orders.filter(o => o.status !== 'shipped' && (coverage[o.id]?.short || 0) > 0).length;

  // 🎯 ranking ความเร่งด่วน = deadline ของเฟสที่ยังไม่เสร็จ ที่เก่าสุด/ใกล้สุด
  // (ใบที่หลุดเฟสมานานสุดขึ้นแถวบนสุด → ใบที่ deadline ถัดไปใกล้เข้ามา → ใบที่ยังมีเวลา)
  const urgencyKey = (o) => {
    if (o.status === 'shipped') return Number.MAX_SAFE_INTEGER;
    const unmet = phaseList(o).filter(ph => !ph.done);
    if (unmet.length) return Math.min(...unmet.map(ph => ph.dlW));
    return frameMin(o.ship_time) ?? Number.MAX_SAFE_INTEGER - 1;
  };
  const cardsSorted = sortMode === 'urgent'
    ? [...orders].sort((a, b) => urgencyKey(a) - urgencyKey(b))
    : orders;

  // การเตือน 'เลยเวลา/หลุดเฟส' ย้ายไปอยู่ที่ shipping-phase-scan (pg_cron ทุก 10 นาที) — ทำงานแม้ไม่มีใครเปิดหน้านี้


  // ── ชาร์ตเต็มกรอบ 24 ชม. (08:00 → 08:00) ไม่ต้องเลื่อน — บล็อกเล็ก คลิกดูรายละเอียดใน popup ──
  const tStart = FRAME_START, span = 1440;
  const hourMarks = Array.from({ length: 25 }, (_, i) => FRAME_START + i * 60);
  const breakBands = breaksToFrame(breakPolicies);   // เงาเวลาพัก — แถบลายเฉียงมาตรฐานเดียวกับบอร์ด Heijunka
  const SPAN_MIN = 40;   // ระยะเวลาที่ถือว่า "ชนกัน" → แยกเลน
  const LANE_H = 28;     // ความสูงต่อเลน — กว้างพอให้อ่านเวลาชัดจากระยะไกล
  const lanesByCustomer = (() => {
    const res = {};
    Object.entries(byCustomer).forEach(([cust, list]) => {
      const laneEnd = [];
      const map = {};
      // order ที่ไม่ระบุเวลาไม่เข้าเลน — รวมเป็นชิป ⏳ ใบเดียวท้ายแถวแทน (เคยไปกองตกขอบขวาเป็นสิบเลน)
      list.filter(o => frameMin(o.ship_time) != null).forEach(o => {
        const t = frameMin(o.ship_time);
        let li = laneEnd.findIndex(end => t >= end);
        if (li < 0) { li = laneEnd.length; laneEnd.push(0); }
        laneEnd[li] = t + SPAN_MIN;
        map[o.id] = li;
      });
      res[cust] = { map, count: Math.max(1, laneEnd.length) };
    });
    return res;
  })();

  // คลิกจาก popup → กระโดดไปการ์ดรายการด้านล่าง (สลับ filter ให้ถ้าการ์ดถูกซ่อนอยู่)
  const goToCard = (o) => {
    const visible = cardFilter === 'all'
      || (cardFilter === 'shipped' && o.status === 'shipped')
      || (cardFilter === 'overdue' && isOverdue(o))
      || (cardFilter === 'todo' && o.status !== 'shipped');
    if (!visible) setCardFilter('all');
    setPopup(null);
    setHighlightId(o.id);
    setTimeout(() => document.getElementById(`ship-card-${o.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    setTimeout(() => setHighlightId(null), 3000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* แถวควบคุม — บรรทัดเดียว: เลือกวัน + สรุปยอด */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => shiftDay(-1)} style={{ ...btn(false), width: 'auto', flexShrink: 0 }}>◀</button>
        <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)}
          style={{ ...inputSt, width: 140, flexShrink: 0 }} />
        <button onClick={() => shiftDay(1)} style={{ ...btn(false), width: 'auto', flexShrink: 0 }}>▶</button>
        {!isToday && <button onClick={() => setDay(workDateStr())} style={{ ...btn(true), width: 'auto', flexShrink: 0 }}>วันนี้</button>}
        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--muted)', flexShrink: 0 }}>
          🕗 วันงาน 08:00 → 08:00
        </span>
        <span style={{ width: 1, height: 22, background: 'var(--border)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
          🚚 {orders.length} รอบส่ง · ✅ {shippedCount} ส่งแล้ว
          {overdueCount > 0 && <span style={{ color: '#ef4444' }}> · 🔴 {overdueCount} เลยเวลา</span>}
          {shortCount > 0 && <span style={{ color: '#f59e0b' }}> · 📦 {shortCount} รอบ stock ไม่พอ</span>}
        </span>
        {pastDue.length > 0 && (
          <button onClick={() => setDay(pastDue.reduce((a, p) => (p.due_date > a ? p.due_date : a), pastDue[0].due_date))}
            title="คลิกเพื่อกระโดดไปวันงานล่าสุดที่ยังมีใบค้างส่ง"
            style={{ padding: '4px 12px', borderRadius: 8, border: '1.5px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-body)', flexShrink: 0 }}>
            ⏰ ค้างส่งจากวันก่อน {pastDue.length} ใบ — กดดู
          </button>
        )}
        {canAdd && (
          <button onClick={() => { setAddForm({ ...emptyAdd, due_date: day >= workDateStr() ? day : workDateStr() }); setShowAdd(true); }}
            title="ลูกค้าสั่งเพิ่มนอกไฟล์ EDI (สั่งด่วน/โทรสั่ง) — คีย์เข้าระบบได้ทันที ไม่ต้องรออัพโหลด 862"
            style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#08130a', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-body)', flexShrink: 0, marginLeft: 'auto' }}>
            ➕ เพิ่ม order ด่วน
          </button>
        )}
      </div>

      {/* Modal คีย์ order ด่วน — ปิดได้จากปุ่มเท่านั้น (มีฟอร์ม ห้ามปิดจาก backdrop ตาม UI-CONVENTIONS §5) */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, width: 'min(94vw, 460px)', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>➕ เพิ่ม order ด่วน (คีย์มือ)</span>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
                สำหรับ order ที่ลูกค้าสั่งเพิ่มนอกไฟล์ EDI — ใบนี้จะเข้าชาร์ต/walkback/หัก stock เหมือน order ปกติ
                และ<strong>ไม่ถูกแทนที่</strong>ตอนอัพโหลด 862 รอบถัดไป (แทนที่เฉพาะใบจาก EDI)
              </div>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ลูกค้า (Ship-to)
                  <input list="add-ord-shipto" value={addForm.customer} onChange={e => setAddForm(f => ({ ...f, customer: e.target.value.toUpperCase() }))}
                    placeholder="GRBNA" style={inputSt} />
                  <datalist id="add-ord-shipto">{(shipToCodes || []).map(c => <option key={c} value={c} />)}</datalist>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>MAT No. *
                  <input list="add-ord-mat" value={addForm.mat_no}
                    onChange={e => { const v = e.target.value.toUpperCase(); setAddForm(f => ({ ...f, mat_no: v, part_name: prodNames[v.trim()] || f.part_name })); }}
                    placeholder="1XXXXXXX" style={{ ...inputSt, fontFamily: 'monospace' }} />
                  <datalist id="add-ord-mat">{Object.keys(prodNames).map(m => <option key={m} value={m} />)}</datalist>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>จำนวน (ชิ้น) *
                  <input type="number" min="1" value={addForm.qty} onChange={e => setAddForm(f => ({ ...f, qty: e.target.value }))} style={inputSt} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ชื่อพาร์ท
                  <input value={addForm.part_name} onChange={e => setAddForm(f => ({ ...f, part_name: e.target.value }))} style={inputSt} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>วันที่ส่ง *
                  <input type="date" value={addForm.due_date} onChange={e => setAddForm(f => ({ ...f, due_date: e.target.value }))} style={inputSt} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>รอบเวลาส่ง (เว้นว่าง = ⏳ ไม่ระบุ)
                  <input type="time" value={addForm.ship_time} onChange={e => setAddForm(f => ({ ...f, ship_time: e.target.value }))} style={inputSt} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>เลขที่ PO
                  <input value={addForm.order_no} onChange={e => setAddForm(f => ({ ...f, order_no: e.target.value }))} style={inputSt} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Dock
                  <input value={addForm.dock_code} onChange={e => setAddForm(f => ({ ...f, dock_code: e.target.value }))} style={inputSt} />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={saveAddOrder} disabled={addSaving}
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#08130a', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-body)', opacity: addSaving ? 0.6 : 1 }}>
                  {addSaving ? 'กำลังบันทึก...' : '💾 เพิ่ม order'}
                </button>
                <button onClick={() => setShowAdd(false)} style={btn(false)}>ยกเลิก</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {orders.length === 0 ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          ไม่มีรอบส่งงานในวันงาน {day} (08:00 → 08:00 วันถัดไป) — อัพโหลด Order ที่แท็บ 📤 อัพโหลด
        </div>
      ) : (
        <>
          {/* Shipping time chart — เต็ม 24 ชม.ในจอเดียว · รอบเวลาชนกันแยกชั้นอัตโนมัติ · คลิกบล็อกดูรายละเอียด */}
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>🕐 Shipping Time Chart — วันงาน {day}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>คลิกที่บล็อกเพื่อดูรายละเอียด / ไปที่การ์ดรายการ</span>
            </div>
            <div style={isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : undefined}>
            <div style={isMobile ? { minWidth: 780 } : undefined}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)', position: 'relative' }}>
              <div style={{ width: chartLeftW, flexShrink: 0, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', borderRight: '1px solid var(--border2)', ...(isMobile ? { position: 'sticky', left: 0, zIndex: 6, background: 'var(--bg2)' } : null) }}>ลูกค้า · คลิกชื่อเพื่อย่อ/ขยาย</div>
              <div style={{ flex: 1, position: 'relative', height: 22 }}>
                {hourMarks.map((m, i) => (i % 2 === 0 &&
                  <span key={m} style={{ position: 'absolute', left: `${((m - tStart) / span) * 100}%`, fontSize: 11, color: (m % 1440) === 480 || (m % 1440) === 1200 ? 'var(--text2)' : 'var(--muted)', fontWeight: (m % 1440) === 480 || (m % 1440) === 1200 ? 800 : 500, transform: m === tStart + span ? 'translateX(-100%)' : 'translateX(-50%)', top: 4, whiteSpace: 'nowrap' }}>
                    {String((m / 60) % 24 | 0).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
              {/* ป้ายเวลาปัจจุบัน — มาตรฐานเดียวกับบอร์ด Heijunka */}
              {isToday && nowW >= tStart && nowW <= tStart + span && (
                <div className="now-chip" style={{ left: `calc(${chartLeftW}px + (100% - ${chartLeftW}px) * ${(nowW - tStart) / span})` }}>
                  ⏱ {String(Math.floor(nowW / 60) % 24).padStart(2, '0')}:{String(nowW % 60).padStart(2, '0')}
                </div>
              )}
            </div>
            {Object.entries(byCustomer).map(([cust, list]) => {
              const lanes = lanesByCustomer[cust] || { map: {}, count: 1 };
              const isCol = !!collapsedCust[cust];
              const rowH = isCol ? 26 : 10 + lanes.count * LANE_H;
              const doneN = list.filter(x => x.status === 'shipped').length;
              return (
                <div key={cust} style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
                  <div onClick={() => setCollapsedCust(m => ({ ...m, [cust]: !m[cust] }))}
                    title={isCol ? 'คลิกเพื่อขยาย' : 'คลิกเพื่อย่อ'}
                    style={{ width: chartLeftW, flexShrink: 0, padding: '4px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', borderRight: '1px solid var(--border2)', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer', userSelect: 'none', ...(isMobile ? { position: 'sticky', left: 0, zIndex: 6, background: 'var(--card)' } : null) }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--muted)', marginRight: 4 }}>{isCol ? '▸' : '▾'}</span>{cust}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{list.length} รอบ · ✅ {doneN}</span>
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: rowH }}>
                    {hourMarks.map(m => (
                      <div key={m} style={{ position: 'absolute', top: 0, bottom: 0, left: `${((m - tStart) / span) * 100}%`, width: 1, background: (m % 1440) === 1200 ? 'var(--border2)' : 'var(--border)' }} />
                    ))}
                    {breakBands.map((b, bi) => {
                      const leftPct = Math.max(0, ((b.s - tStart) / span) * 100);
                      const widthPct = Math.min(100 - leftPct, ((b.e - b.s) / span) * 100);
                      if (widthPct <= 0) return null;
                      return (
                        <div key={`brk-${bi}`} title={`${b.label} — เวลาพัก`}
                          style={{
                            position: 'absolute', top: 0, bottom: 0, left: `${leftPct}%`, width: `${widthPct}%`,
                            background: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.18) 0px, rgba(148,163,184,0.18) 4px, transparent 4px, transparent 8px)',
                            borderLeft: '1px dashed rgba(148,163,184,0.6)', borderRight: '1px dashed rgba(148,163,184,0.6)',
                            zIndex: 0, pointerEvents: 'none',
                          }}
                        />
                      );
                    })}
                    {isToday && nowW >= tStart && nowW <= tStart + span && (
                      <div className="now-line" style={{ left: `${((nowW - tStart) / span) * 100}%` }} />
                    )}
                    {list.filter(o => frameMin(o.ship_time) != null).map(o => {
                      const tw = frameMin(o.ship_time);
                      const st = SHIP_STATUS[o.status] || SHIP_STATUS.pending;
                      const od = isOverdue(o);
                      const pl = phaseLate(o);
                      const color = od ? '#ef4444' : pl ? '#f97316' : st.color;
                      const left = ((tw - tStart) / span) * 100;
                      const lane = lanes.map[o.id] || 0;
                      const isSel = popup?.o?.id === o.id;
                      if (isCol) {
                        // โหมดย่อ — จุดสถานะเล็ก ๆ ตามตำแหน่งเวลา ยังคลิกดูรายละเอียดได้
                        return (
                          <div key={o.id} onClick={e => setPopup({ o, x: e.clientX, y: e.clientY })}
                            title={`${(o.ship_time || '—').slice(0, 5)} · ${o.mat_no} × ${fmt(o.qty)}`}
                            style={{ position: 'absolute', top: 8, width: 9, height: 9, borderRadius: '50%', left: `${Math.min(left, 98.5)}%`,
                              background: color, border: '1.5px solid rgba(0,0,0,0.25)', cursor: 'pointer', zIndex: 1 }} />
                        );
                      }
                      return (
                        <div key={o.id}
                          onClick={e => setPopup({ o, x: e.clientX, y: e.clientY })}
                          style={{
                            position: 'absolute', top: 5 + lane * LANE_H, height: LANE_H - 6,
                            left: `${Math.min(left, 97)}%`, width: `${(SPAN_MIN / span) * 100}%`, minWidth: 48,
                            background: `${color}${isSel ? '55' : '22'}`, border: `1.5px solid ${color}${isSel ? '' : 'cc'}`, borderRadius: 5, zIndex: 1,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, overflow: 'hidden', cursor: 'pointer', boxSizing: 'border-box',
                            boxShadow: od ? `0 0 5px ${color}55` : 'none',
                          }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color, whiteSpace: 'nowrap', lineHeight: 1 }}>
                            {(o.ship_time || '—').slice(0, 5)}{o.status === 'shipped' ? ' ✅' : ''}
                          </span>
                        </div>
                      );
                    })}
                    {/* order ที่ลูกค้าไม่ระบุเวลาส่ง — รวมเป็นชิปเดียวท้ายแถว ไม่ตกขอบ/ไม่กองสูง
                        คลิกดูรายละเอียดทีละใบใน popup (ไล่จากการ์ดด้านล่างได้เหมือนเดิม) */}
                    {(() => {
                      const noTime = list.filter(o => frameMin(o.ship_time) == null);
                      if (!noTime.length) return null;
                      const doneAll = noTime.every(o => o.status === 'shipped');
                      return (
                        <div onClick={e => setPopup({ o: noTime[0], x: e.clientX, y: e.clientY })}
                          title={`ไม่ระบุเวลาส่ง ${noTime.length} รายการ: ${noTime.map(o => `${o.mat_no} × ${fmt(o.qty)}`).join(' · ')}`}
                          style={{
                            position: 'absolute', top: isCol ? 2 : 5, right: 4, height: isCol ? 22 : LANE_H - 6,
                            padding: '0 10px', display: 'flex', alignItems: 'center', gap: 4,
                            background: doneAll ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                            border: `1.5px dashed ${doneAll ? '#22c55e' : '#f59e0b'}`, borderRadius: 5,
                            cursor: 'pointer', zIndex: 2, boxSizing: 'border-box',
                          }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color: doneAll ? '#22c55e' : '#f59e0b', whiteSpace: 'nowrap', lineHeight: 1 }}>
                            ⏳ {noTime.length} ไม่ระบุเวลา{doneAll ? ' ✅' : ''}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
            </div>
            </div>
          </div>

          {/* Popup รายละเอียดรอบส่ง — คลิกบล็อกบนชาร์ต */}
          {popup && (() => {
            const o = popup.o;
            const st = SHIP_STATUS[o.status] || SHIP_STATUS.pending;
            const od = isOverdue(o);
            const pl = phaseLate(o);
            const phases = phaseList(o);
            const cov = coverage[o.id];
            const W = 270;
            const left = Math.max(8, Math.min(popup.x - W / 2, window.innerWidth - W - 12));
            const top = Math.min(popup.y + 12, window.innerHeight - 260);
            return (
              <>
                <div onClick={() => setPopup(null)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
                <div style={{ position: 'fixed', left, top, width: W, zIndex: 1300, background: 'var(--bg3)', border: `1px solid ${od ? '#ef4444' : st.color}66`, borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
                  <div style={{ height: 4, background: od ? '#ef4444' : st.color }} />
                  <div style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)' }}>🕐 {(o.ship_time ? o.ship_time.slice(0, 5) : '⏳ ไม่ระบุเวลา')}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.15)', color: od ? '#ef4444' : pl ? '#f97316' : st.color }}>{od ? '🔴 เลยเวลา' : pl ? '🟠 หลุดเฟส' : st.label}</span>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', marginTop: 2 }}>{custLabel ? custLabel(o.customer) : o.customer}{o.due_date !== day ? ` · ส่งเช้า ${o.due_date}` : ''}</div>
                    <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#0ea5e9', fontWeight: 700, marginTop: 6 }}>
                      {o.mat_no}{o.customer_part_no && o.customer_part_no !== o.mat_no ? <span style={{ color: 'var(--muted)', fontWeight: 600 }}> · {o.customer_part_no}</span> : null}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{o.part_name || ''}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{fmt(o.qty)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ชิ้น</span></span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{o.order_no ? `PO ${o.order_no}` : ''}{o.dock_code ? ` · Dock ${o.dock_code}` : ''}</span>
                    </div>
                    {o.status !== 'shipped' && cov && (
                      cov.short <= 0
                        ? <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, marginTop: 4 }}>📦 stock พร้อมส่งครบ</div>
                        : cov.covered > 0
                          ? <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, marginTop: 4 }}>⚠️ stock มี {fmt(cov.covered)} — ขาด {fmt(cov.short)} ชิ้น</div>
                          : <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 800, marginTop: 4 }}>🚨 ไม่มี stock พร้อมส่ง — ขาด {fmt(cov.short)} ชิ้น ต้องผลิต!</div>
                    )}
                    {o.status !== 'shipped' && phases.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                        {phases.map(ph => (
                          <span key={ph.id} title={`${ph.name} — ต้องเสร็จภายใน ${ph.deadline}`} style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                            background: ph.done ? 'rgba(34,197,94,0.12)' : ph.missed ? 'rgba(239,68,68,0.12)' : 'var(--bg2)',
                            color: ph.done ? '#22c55e' : ph.missed ? '#ef4444' : 'var(--muted)',
                            border: `1px solid ${ph.done ? 'rgba(34,197,94,0.3)' : ph.missed ? 'rgba(239,68,68,0.35)' : 'var(--border)'}` }}>
                            {ph.done ? '✓' : ph.missed ? '🔴' : '⏳'} {ph.name} {ph.deadline}
                          </span>
                        ))}
                      </div>
                    )}
                    {o.shipped_by && <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4 }}>✓ {o.shipped_by}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      {st.next && (
                        <button onClick={() => { advance(o); setPopup(null); }} disabled={busy === o.id}
                          style={{ flex: 1, padding: '7px 8px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer', background: `${st.color}22`, color: st.color, border: `1px solid ${st.color}55`, fontFamily: 'var(--font-body)' }}>
                          {busy === o.id ? '...' : st.nextLabel}
                        </button>
                      )}
                      <button onClick={() => goToCard(o)}
                        style={{ flex: 1, padding: '7px 8px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer', background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)', fontFamily: 'var(--font-body)' }}>
                        ⬇ ไปที่การ์ด
                      </button>
                      {canAdd && o.source === 'manual' && o.status === 'pending' && (
                        <button className="tbtn" onClick={() => deleteManualOrder(o)}
                          title="ลบได้เฉพาะใบคีย์มือที่ยังไม่เริ่ม workflow"
                          style={{ padding: '7px 10px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', fontFamily: 'var(--font-body)' }}>
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

          {/* รายการรอบส่ง + ปุ่มอัปเดตสถานะ — กรองให้เห็นเฉพาะที่ต้องทำก่อน */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { id: 'todo',    label: `🕐 ต้องทำ (${orders.filter(o => o.status !== 'shipped').length})` },
              { id: 'overdue', label: `🔴 เลยเวลา (${overdueCount})` },
              { id: 'shipped', label: `✅ ส่งแล้ว (${shippedCount})` },
              { id: 'all',     label: `ทั้งหมด (${orders.length})` },
            ].map(f => <button key={f.id} onClick={() => setCardFilter(f.id)} style={btn(cardFilter === f.id)}>{f.label}</button>)}
            <span style={{ width: 1, height: 20, background: 'var(--border)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>เรียง:</span>
            <button onClick={() => setSortMode('urgent')} style={btn(sortMode === 'urgent')} title="ใบที่หลุดเฟส/deadline ใกล้สุดขึ้นแถวบน">⚡ ใกล้ดิวก่อน</button>
            <button onClick={() => setSortMode('time')} style={btn(sortMode === 'time')}>🕐 ตามเวลาส่ง</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 12 }}>
            {cardsSorted.filter(o =>
              cardFilter === 'all' ? true
              : cardFilter === 'shipped' ? o.status === 'shipped'
              : cardFilter === 'overdue' ? isOverdue(o)
              : o.status !== 'shipped'
            ).map(o => {
              const st = SHIP_STATUS[o.status] || SHIP_STATUS.pending;
              const od = isOverdue(o);
              const pl = phaseLate(o);
              const cardColor = od ? '#ef4444' : pl ? '#f97316' : st.color;
              const phases = phaseList(o);
              const isHl = highlightId === o.id;
              return (
                <div key={o.id} id={`ship-card-${o.id}`} style={{
                  background: `${cardColor}0f`, border: `1px solid ${cardColor}55`, borderRadius: 12, overflow: 'hidden',
                  boxShadow: isHl ? '0 0 0 3px rgba(77,159,255,0.65)' : 'none', transition: 'box-shadow 0.3s',
                }}>
                  <div style={{ height: 4, background: cardColor }} />
                  <div style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)' }}>🕐 {(o.ship_time ? o.ship_time.slice(0, 5) : '⏳ ไม่ระบุเวลา')}{o.due_date !== day ? <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}> (เช้า {o.due_date.slice(5)})</span> : null}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.12)', color: cardColor }}>{od ? '🔴 เลยเวลา' : pl ? '🟠 หลุดเฟส' : st.label}</span>
                    </div>
                    <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#0ea5e9', fontWeight: 700, marginTop: 4 }}>
                      {o.mat_no}{o.customer_part_no && o.customer_part_no !== o.mat_no ? <span style={{ color: 'var(--muted)', fontWeight: 600 }}> · {o.customer_part_no}</span> : null}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{o.part_name || ''}{o.order_no ? ` · PO ${o.order_no}` : ''}{o.dock_code ? ` · Dock ${o.dock_code}` : ''}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{fmt(o.qty)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>ชิ้น</span></span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6' }}>{o.customer ? (custLabel ? custLabel(o.customer) : o.customer) : ''}</span>
                    </div>
                    {o.status !== 'shipped' && phases.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                        {phases.map(ph => (
                          <span key={ph.id} title={`${ph.name} — ต้องเสร็จภายใน ${ph.deadline}`} style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                            background: ph.done ? 'rgba(34,197,94,0.12)' : ph.missed ? 'rgba(239,68,68,0.12)' : 'var(--bg2)',
                            color: ph.done ? '#22c55e' : ph.missed ? '#ef4444' : 'var(--muted)',
                            border: `1px solid ${ph.done ? 'rgba(34,197,94,0.3)' : ph.missed ? 'rgba(239,68,68,0.35)' : 'var(--border)'}` }}>
                            {ph.done ? '✓' : ph.missed ? '🔴' : '⏳'} {ph.name} {ph.deadline}
                          </span>
                        ))}
                      </div>
                    )}
                    {o.status !== 'shipped' && coverage[o.id] && (
                      coverage[o.id].short <= 0
                        ? <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, marginTop: 4 }}>📦 stock พร้อมส่งครบ</div>
                        : coverage[o.id].covered > 0
                          ? <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, marginTop: 4 }}>⚠️ stock มี {fmt(coverage[o.id].covered)} — ขาด {fmt(coverage[o.id].short)} ชิ้น (รอผลิต)</div>
                          : <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 800, marginTop: 4 }}>🚨 ไม่มี stock พร้อมส่ง — ขาด {fmt(coverage[o.id].short)} ชิ้น ต้องผลิต!</div>
                    )}
                    {o.shipped_by && <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4 }}>✓ {o.shipped_by} · {o.shipped_at ? new Date(o.shipped_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : ''}</div>}
                    {st.next && (
                      <button onClick={() => advance(o)} disabled={busy === o.id}
                        style={{ marginTop: 8, width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: 'rgba(0,0,0,0.12)', color: st.color, border: `1px solid ${st.color}55`, fontFamily: 'var(--font-body)' }}>
                        {busy === o.id ? '...' : st.nextLabel}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Standard Workflow การส่งงาน (walkback) ─────────────────────────────────
   จากเวลาส่งถึงลูกค้า ถอยกลับเป็น deadline ต่อเฟส — scanner (ทุก 10 นาที) ใช้ตารางนี้
   ตัดสินว่า "หลุดเฟสไหน" แล้วแจ้ง Smart Logistic ทันที ไม่ต้องรอตก due ─────────── */
const REQ_STATUS_OPTIONS = [
  { value: 'confirmed', label: '✔️ ยืนยันออเดอร์แล้ว' },
  { value: 'prepared',  label: '📦 เตรียมของแล้ว' },
  { value: 'loaded',    label: '🚛 โหลดขึ้นรถแล้ว' },
  { value: 'shipped',   label: '🚚 ส่งถึงลูกค้าแล้ว' },
];
function WorkflowSection({ canEdit }) {
  const [steps, setSteps] = useState([]);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const [scope, setScope] = useState('');       // '' = ค่ามาตรฐานทุกลูกค้า · code = ชุดเฉพาะลูกค้า
  const [codes, setCodes] = useState([]);

  useEffect(() => {
    supabaseDR.from('ship_to_plants').select('code, customer_name').order('code')
      .then(({ data }) => setCodes(data || []));
  }, []);

  const load = useCallback(async () => {
    let q = supabaseDR.from('shipping_workflow_steps').select('*').eq('is_active', true).order('step_no');
    q = scope ? q.eq('customer', scope) : q.is('customer', null);
    const { data } = await q;
    setSteps(data || []);
    setDraft({});
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  // ลูกค้าที่ยังไม่มีชุดของตัวเอง → คัดลอกจากค่ามาตรฐานมาเป็นจุดตั้งต้น
  const copyFromDefault = async () => {
    const { data: defs } = await supabaseDR.from('shipping_workflow_steps').select('*').is('customer', null).eq('is_active', true).order('step_no');
    if (!defs?.length) { toast.error('ยังไม่มีค่ามาตรฐานให้คัดลอก'); return; }
    const { error } = await supabaseDR.from('shipping_workflow_steps')
      .insert(defs.map(d => ({ customer: scope, step_no: d.step_no, name: d.name, offset_min: d.offset_min, requires_status: d.requires_status })));
    if (error) toast.error(error.message);
    else { toast.success(`สร้างชุดเฟสของ ${scope} จากค่ามาตรฐานแล้ว`); await load(); }
  };

  const val = (r, k) => (draft[r.id]?.[k] ?? r[k] ?? '');
  const setVal = (r, k, v) => setDraft(d => ({ ...d, [r.id]: { ...d[r.id], [k]: v } }));

  const save = async (r) => {
    const d = draft[r.id];
    if (!d) return;
    setBusy(r.id);
    const { error } = await supabaseDR.from('shipping_workflow_steps').update({
      name: String(d.name ?? r.name).trim() || r.name,
      offset_min: Math.max(0, parseInt(d.offset_min ?? r.offset_min) || 0),
      requires_status: d.requires_status ?? r.requires_status,
    }).eq('id', r.id);
    if (error) toast.error(error.message);
    else { toast.success('บันทึกเฟสแล้ว'); await load(); }
    setBusy(null);
  };
  const remove = async (r) => {
    if (!window.confirm(`ลบเฟส "${r.name}"? การแจ้งเตือนของเฟสนี้จะหยุดทันที`)) return;
    setBusy(r.id);
    const { error } = await supabaseDR.from('shipping_workflow_steps').update({ is_active: false }).eq('id', r.id);
    if (error) toast.error(error.message);
    else { toast.success('ลบเฟสแล้ว'); await load(); }
    setBusy(null);
  };
  const add = async () => {
    const maxNo = steps.reduce((m, x) => Math.max(m, x.step_no || 0), 0);
    const { error } = await supabaseDR.from('shipping_workflow_steps')
      .insert({ customer: scope || null, step_no: maxNo + 1, name: 'เฟสใหม่', offset_min: 30, requires_status: 'prepared' });
    if (error) toast.error(error.message);
    else await load();
  };

  const cell = { padding: '6px 10px', borderTop: '1px solid var(--border)' };
  const edSt = { ...inputSt, padding: '5px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ ...card, marginTop: 16 }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', marginBottom: 4, fontFamily: 'var(--font-display)' }}>🚛 Standard Workflow การส่งงาน (walkback)</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        นับถอยหลังจาก<strong>เวลาส่งถึงลูกค้า</strong> — แต่ละเฟสต้องถึงสถานะที่กำหนดก่อน deadline (เวลาส่ง − นาที walkback)
        ระบบสแกนทุก 10 นาที เฟสไหนหลุดจะแจ้งเข้า Smart Logistic ทันที ไม่ต้องรอตก due ลูกค้า
        · เพิ่ม/ลดจำนวนเฟสได้ตามความเหมาะสมของแต่ละลูกค้า
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ชุดเฟสของ:</span>
        <select value={scope} onChange={e => setScope(e.target.value)} style={{ ...inputSt, width: 220 }}>
          <option value="">🌐 ค่ามาตรฐาน (ทุกลูกค้า)</option>
          {codes.map(c => (
            <option key={c.code} value={c.code}>
              {c.customer_name && c.customer_name !== c.code ? `${c.customer_name} (${c.code})` : c.code}
            </option>
          ))}
        </select>
        {scope && steps.length === 0 && canEdit && (
          <button onClick={copyFromDefault} style={btn(false)}>📋 คัดลอกจากค่ามาตรฐาน</button>
        )}
        {scope && steps.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>ลูกค้านี้ยังไม่มีชุดเฟสของตัวเอง — ตอนนี้ใช้ค่ามาตรฐานอยู่</span>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead><tr style={{ background: 'var(--bg2)' }}>
            {['ลำดับ', 'ชื่อเฟส', 'ก่อนเวลาส่ง (นาที)', 'ต้องถึงสถานะ', ''].map(h => (
              <th key={h} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {steps.map(r => (
              <tr key={r.id}>
                <td style={{ ...cell, fontWeight: 900, color: '#7c3aed' }}>#{r.step_no}</td>
                <td style={cell}>{canEdit ? <input value={val(r, 'name')} onChange={e => setVal(r, 'name', e.target.value)} style={edSt} /> : <span style={{ fontSize: 13, fontWeight: 700 }}>{r.name}</span>}</td>
                <td style={cell}>{canEdit ? <input type="number" min="0" value={val(r, 'offset_min')} onChange={e => setVal(r, 'offset_min', e.target.value)} style={{ ...edSt, width: 110 }} /> : <span style={{ fontSize: 13 }}>{r.offset_min}</span>}</td>
                <td style={cell}>{canEdit ? (
                  <select value={val(r, 'requires_status')} onChange={e => setVal(r, 'requires_status', e.target.value)} style={{ ...edSt, width: 170 }}>
                    {REQ_STATUS_OPTIONS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                  </select>
                ) : <span style={{ fontSize: 12 }}>{REQ_STATUS_OPTIONS.find(x => x.value === r.requires_status)?.label || r.requires_status}</span>}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  {canEdit && draft[r.id] && (
                    <button className="tbtn" onClick={() => save(r)} disabled={busy === r.id}
                      style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#08130a', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-body)', marginRight: 6 }}>
                      {busy === r.id ? '...' : '💾 บันทึก'}
                    </button>
                  )}
                  {canEdit && (
                    <button className="tbtn" onClick={() => remove(r)} disabled={busy === r.id}
                      style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', fontFamily: 'var(--font-body)' }}>
                      🗑 ลบ
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <button onClick={add} style={{ ...btn(false), marginTop: 12 }}>➕ เพิ่มเฟส</button>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
        ตัวอย่าง: ส่งถึงลูกค้า 13:00 → เตรียมงานเสร็จ (120 นาที) deadline 11:00 · โหลดขึ้นรถ (60 นาที) deadline 12:00 · รถออก/ส่ง (0 นาที) deadline 13:00
      </div>
    </div>
  );
}

/* ─── Ship-to Plant Config Tab ────────────────────────────────────────────── */
function ShipToTab({ canEdit, onChanged }) {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({});     // code → { customer_name, plant_name, note }
  const [newCode, setNewCode] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabaseDR.from('ship_to_plants').select('*').order('code');
    setRows(data || []);
    setDraft({});
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (code) => {
    const d = draft[code];
    if (!d) return;
    setBusy(code);
    const { error } = await supabaseDR.from('ship_to_plants')
      .update({ customer_name: d.customer_name?.trim() || code, plant_name: d.plant_name?.trim() || null, note: d.note?.trim() || null, updated_at: new Date().toISOString() })
      .eq('code', code);
    if (error) toast.error(error.message);
    else { toast.success(`บันทึก ${code} แล้ว`); await load(); onChanged?.(); }
    setBusy(null);
  };
  const addCode = async () => {
    const code = newCode.trim().toUpperCase();
    if (!code) return;
    const { error } = await supabaseDR.from('ship_to_plants').insert({ code, customer_name: code });
    if (error) { toast.error(error.message); return; }
    setNewCode('');
    await load();
  };
  const removeCode = async (r) => {
    if (!window.confirm(`ลบ code "${r.code}"${r.customer_name !== r.code ? ` (${r.customer_name})` : ''}?\n\nข้อมูล order/forecast ที่อ้าง code นี้ยังอยู่ครบ (จะแสดงเป็น code ดิบแทนชื่อ) และถ้า code นี้โผล่ในไฟล์ EDI ครั้งหน้า ระบบจะเพิ่มกลับมาให้อัตโนมัติ`)) return;
    setBusy(r.code);
    const { error } = await supabaseDR.from('ship_to_plants').delete().eq('code', r.code);
    if (error) toast.error(error.message);
    else { toast.success(`ลบ ${r.code} แล้ว`); await load(); onChanged?.(); }
    setBusy(null);
  };

  const cell = { padding: '6px 10px', borderTop: '1px solid var(--border)' };
  const edSt = { ...inputSt, padding: '5px 8px', fontSize: 12, width: '100%', boxSizing: 'border-box' };
  const val = (r, k) => (draft[r.code]?.[k] ?? r[k] ?? '');
  const setVal = (r, k, v) => setDraft(d => ({ ...d, [r.code]: { customer_name: val(r, 'customer_name'), plant_name: val(r, 'plant_name'), note: val(r, 'note'), ...d[r.code], [k]: v } }));

  return (
    <>
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', marginBottom: 4, fontFamily: 'var(--font-display)' }}>⚙️ Ship-to Plant Config</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        ตั้งชื่อลูกค้าให้ code ปลายทางจากไฟล์ EDI (เช่น GRBNA → AAT) — ชื่อนี้จะแสดงแทน code ในทุกหน้าจอ · code ใหม่จากไฟล์ EDI จะถูกเพิ่มเข้าลิสต์นี้อัตโนมัติ
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead><tr style={{ background: 'var(--bg2)' }}>
            {['Code', 'ชื่อลูกค้า *', 'โรงงาน/ท่า', 'หมายเหตุ', ''].map(h => (
              <th key={h} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.code}>
                <td style={{ ...cell, fontFamily: 'monospace', fontWeight: 800, color: '#0ea5e9', fontSize: 13 }}>{r.code}</td>
                <td style={cell}>{canEdit ? <input value={val(r, 'customer_name')} onChange={e => setVal(r, 'customer_name', e.target.value)} style={edSt} placeholder="เช่น AAT / FTM" /> : <span style={{ fontSize: 13, fontWeight: 700 }}>{r.customer_name}</span>}</td>
                <td style={cell}>{canEdit ? <input value={val(r, 'plant_name')} onChange={e => setVal(r, 'plant_name', e.target.value)} style={edSt} /> : <span style={{ fontSize: 12, color: 'var(--text2)' }}>{r.plant_name || '—'}</span>}</td>
                <td style={cell}>{canEdit ? <input value={val(r, 'note')} onChange={e => setVal(r, 'note', e.target.value)} style={edSt} /> : <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.note || ''}</span>}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  {canEdit && draft[r.code] && (
                    <button className="tbtn" onClick={() => save(r.code)} disabled={busy === r.code}
                      style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#08130a', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-body)', marginRight: 6 }}>
                      {busy === r.code ? '...' : '💾 บันทึก'}
                    </button>
                  )}
                  {canEdit && (
                    <button className="tbtn" onClick={() => removeCode(r)} disabled={busy === r.code}
                      style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', fontFamily: 'var(--font-body)' }}>
                      🗑 ลบ
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="เพิ่ม code ใหม่" style={{ ...inputSt, width: 160 }} />
          <button onClick={addCode} style={btn(false)}>➕ เพิ่ม</button>
        </div>
      )}
    </div>
    <WorkflowSection canEdit={canEdit} />
    </>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function CustomerDemand() {
  const { role, fullName } = useContext(UserContext);
  const [tab, setTab] = useState('shipping');
  const [refreshKey, setRefreshKey] = useState(0);
  // Ship-to config — สิทธิ์จากตาราง role_permissions (ปรับได้ที่หน้า จัดการสิทธิ์ → สิทธิ์การทำงาน)
  const canConfig = can('shipping', 'config', role);

  // ship-to code → ชื่อลูกค้า (config ที่แท็บ ⚙️) — ใช้แสดงผลทุกแท็บ
  const [shipToMap, setShipToMap] = useState({});
  const loadShipTo = useCallback(async () => {
    const { data } = await supabaseDR.from('ship_to_plants').select('*');
    const m = {};
    (data || []).forEach(r => { m[r.code] = r; });
    setShipToMap(m);
  }, []);
  useEffect(() => { loadShipTo(); }, [loadShipTo]);
  const custLabel = useCallback((code) => {
    if (!code) return '— ไม่ระบุลูกค้า —';
    const r = shipToMap[code];
    return r && r.customer_name && r.customer_name !== code ? `${r.customer_name} (${code})` : code;
  }, [shipToMap]);

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 'min(96vw, 1600px)', margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          🚚 Delivery — ติดตามการส่งงานลูกค้า
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          Logistic ติดตามรอบส่งงานรายวันตาม standard workflow · Forecast/อัพโหลดไฟล์ของ Sales อยู่หน้า 📈 Planner & Sales
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'shipping', label: '🕐 Shipping Chart' },
          { id: 'shipto',   label: '⚙️ Ship-to Config' },
        ].map(t => <button key={t.id} onClick={() => setTab(t.id)} style={btn(tab === t.id)}>{t.label}</button>)}
      </div>

      {tab === 'shipping' && <ShippingTab fullName={fullName} refreshKey={refreshKey} custLabel={custLabel} canAdd={canConfig} shipToCodes={Object.keys(shipToMap)} />}
      {tab === 'shipto' && <ShipToTab canEdit={canConfig} onChanged={() => { setRefreshKey(k => k + 1); loadShipTo(); }} />}
    </div>
  );
}
