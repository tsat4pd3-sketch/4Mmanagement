/* ══ 📦 เรียกชิ้นส่วนจากสโตร์ — ฝั่งไลน์ผลิต ═══════════════════════════════════════
   docs/STORE-PULL-LOOP-DESIGN.md · workflow ที่ user เขียนเอง (2026-08-27) ขั้น 3-4 + 8

   ทำไมอยู่ใน Daily Report ไม่ใช่หน้าใหม่:
     หัวหน้ากลุ่มอยู่หน้านี้ทั้งกะ — เดิมการเรียกของเกิดใน LINE chat เพราะระบบไม่มีที่ให้กด
     (เหตุผลเดียวกับ StoreLotQueue ที่เอาคิวสโตร์มาไว้หน้านี้)

   ⚠️⚠️ กฎเหล็กของแผงนี้ (ห้ามแก้ให้ "ง่ายขึ้น"):
   1. **ระบบเสนอ คนกดยืนยัน** — ห้าม auto-สร้างใบเบิก (กฎเดิมทั้งโปรเจค)
   2. **"ไม่เบิก" = hold ไม่ใช่ reject** — ความต้องการยังอยู่ ต้องกลับมาเตือนได้เอง
      **hold ต้องเห็นบนจอเสมอ** พร้อมเหตุผล+เวลา · ของที่ถูกพักแล้วมองไม่เห็น
      คือต้นเหตุ "ลืมเบิกจนไลน์หยุด" ที่ระบบนี้มีไว้กัน
      (precedent: ใบ 4M ที่ถูกตีกลับต้องขึ้นชิป ✏️ ต้องแก้ ไม่ใช่หายเงียบ)
   3. **`requested_at` stamp ตอนคนกดยืนยัน ไม่ใช่ตอนระบบเสนอ** — ไม่งั้น lead time
      รวมเวลาที่หัวหน้ายังไม่ตัดสินใจ = โทษสโตร์ทั้งที่ยังไม่ถึงคิวเขา
   4. **ไม่ตั้ง min = ไม่เสนอ** (ไม่เดาให้) แต่ต้องขึ้น worklist ว่าพาร์ทไหนยังไม่ตั้ง
   5. **โหลดไม่สำเร็จ = ขึ้นแถบเตือน ห้ามแสดงเป็น "ไม่มีอะไรต้องเบิก"**

   ⚠️ "แจ้งเตือนถึง min เข้า Telegram" (ขั้น 3 เต็มรูป) ต้องมี scanner ฝั่ง server ถึงจะยิงได้
      ตอนไม่มีใครเปิดหน้า — ยังไม่ทำ · เฟสนี้สัญญาณอยู่บน "จอที่หัวหน้าเปิดอยู่แล้วทั้งกะ"
      ส่วน `wip_request_placed` (ไลน์กดเบิก → บอกสโตร์) ยิงจริงตั้งแต่เฟสนี้

   ตารางที่แตะ: line_part_levels (DR) · line_stock_summary (DR) · wip_replenish_requests (Main)
   ⚠️ ใบขอเติมอยู่ **Main** ส่วนสต็อกอยู่ **DR** — คนละ client อย่าสลับ
═══════════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { isLeafLine, getChildLineNames, getAncestorNames } from '../utils/lineHierarchy';
import { notifyEvent } from '../utils/notifyEvent';
import { pointsForLine, DELIVER_GATES } from '../utils/replenishGate';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const num = (v) => (v == null || v === '' ? null : Number(v));

/* สถานะที่ "ยังไม่จบ" = ยังนับเป็นความต้องการค้างอยู่ (กันเสนอซ้ำ)
   suggested/hold = รอหัวหน้าตัดสิน (สโตร์มองไม่เห็น) · pending→delivered = สโตร์ถือลูกบอล */
const OPEN_STATUSES = ['suggested', 'hold', 'pending', 'preparing', 'delivered'];
const WAIT_LEADER   = ['suggested', 'hold'];

const ST = {
  hold:      { label: '⏸ พักไว้ก่อน',    color: '#f59e0b' },
  pending:   { label: '⏳ รอสโตร์หยิบ',   color: '#f59e0b' },
  preparing: { label: '📦 สโตร์กำลังจัด', color: '#38bdf8' },
  delivered: { label: '🚚 ส่งถึงไลน์แล้ว', color: '#22c55e' },
};

const fmtQty = (v) => (v == null ? '—' : Number(v).toLocaleString());
const hhmm = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const agoMin = (iso) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : null);

export default function LinePartCallPanel({ lineName, lines = [], role, fullName }) {
  const [levels, setLevels] = useState([]);
  const [stock, setStock]   = useState([]);
  const [reqs, setReqs]     = useState([]);
  const [dpoints, setDpoints] = useState([]);   // 🎯 จุดส่งงานของไลน์นี้ (เฟส 4) — ไม่มี = สโตร์ตรวจจุดไม่ได้ → worklist
  const [err, setErr]       = useState(null);
  const [busy, setBusy]     = useState(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showNoLevel, setShowNoLevel] = useState(false);

  const canDecide  = can('wip_request', 'decide', role);
  const canReceive = can('wip_request', 'receive', role);
  const canSetLv   = can('line_levels', 'manage', role);

  /* ⚠️⚠️ กฎ "หน่วยย่อยที่สุด" (user เคาะ 2026-08-31) — ของอยู่ที่ leaf เสมอ
     ไลน์แม่ที่มีลูก = แผนก ไม่ใช่จุดวางของ ⇒ **ห้ามใช้ getLineFamilyNames กับสต็อก/min-max/ใบขอ**
     เดิมใช้ family แล้วไลน์ลูก 3 ตัวนับของก้อนเดียวกันของแม่ครบทุกตัว → จอบอก "ของพอ"
     ทั้งที่หน้าไลน์ไม่มีของ = ซ่อนการขาด · family ใช้เฉพาะ "ใครเห็นอะไร" ซึ่งคนละแกน */
  const isLeaf   = useMemo(() => isLeafLine(lines, lineName), [lines, lineName]);
  const kidNames = useMemo(() => getChildLineNames(lines, lineName), [lines, lineName]);
  /* สายบน — ไว้ตรวจว่ามีของค้างที่ไลน์แม่ไหม (ไม่เอามานับรวม แต่ต้องบอกให้เห็น ห้ามเงียบ) */
  const upNames  = useMemo(() => getAncestorNames(lines, lineName), [lines, lineName]);

  const load = useCallback(async () => {
    if (!lineName) return;
    setErr(null);
    const stockLines = [lineName, ...upNames];   // ของตัวเอง + ที่อาจค้างข้างบน (แยกกันตอนคำนวณ)
    const [lv, st, rq, dp] = await Promise.all([
      supabaseDR.from('line_part_levels').select('*').eq('line_name', lineName).eq('is_active', true),
      supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand').in('line_name', stockLines),
      supabase.from('wip_replenish_requests').select('*')
        .eq('line_name', lineName).is('wip_point_id', null).in('status', OPEN_STATUSES)
        .order('requested_at', { ascending: true, nullsFirst: false }),
      // จุดส่งเป็นของเสริม (เฟส 4) — ตารางยังไม่ apply/โหลดไม่ได้ ห้ามลากทั้งแผงล้ม แค่ถือว่ายังไม่มีจุด
      supabaseDR.from('line_delivery_points').select('id, code, name, line_names, is_active').contains('line_names', [lineName]),
    ]);
    setDpoints(dp.error ? [] : (dp.data || []));
    /* ⚠️ ตารางยังไม่ apply migration (42P01) = ฟีเจอร์ยังไม่เปิด ไม่ใช่ error ของผู้ใช้
       แยกให้ขาดจาก error จริง ไม่งั้นขึ้นแถบแดงให้ทุกคนดูทุกวันโดยไม่มีอะไรให้ทำ */
    const notReady = [lv, st, rq].some(r => r.error?.code === '42P01' || r.error?.code === '42703');
    if (notReady) { setErr({ notReady: true }); setLevels([]); setStock([]); setReqs([]); return; }
    const bad = [lv, st, rq].find(r => r.error);
    if (bad) { setErr({ msg: bad.error.message }); return; }
    setLevels(lv.data || []);
    setStock(st.data || []);
    setReqs(rq.data || []);
  }, [lineName, upNames]);

  useEffect(() => { load(); }, [load]);

  /* ── ยอดคงเหลือ "ของไลน์นี้เท่านั้น" ────────────────────────────────────────
     ⚠️ ห้ามบวกของไลน์แม่เข้ามา — ของที่แม่ยังไม่ได้ถูกจ่ายลงมาที่ไลน์นี้จริง
        และไลน์พี่น้องก็จะนับก้อนเดียวกันซ้ำอีก */
  const onHand = useMemo(() => {
    const m = new Map();
    for (const s of stock) {
      if (!s.mat_no || s.line_name !== lineName) continue;
      m.set(s.mat_no, (m.get(s.mat_no) || 0) + (Number(s.qty_on_hand) || 0));
    }
    return m;
  }, [stock, lineName]);

  /* ของที่ยังค้างอยู่ที่ไลน์แม่ — **ไม่นับเป็นของไลน์นี้ แต่ต้องเห็น** ห้ามเงียบ
     (นี่คือสาเหตุที่ระบบไม่เสนอเติมทั้งที่ยอดในระบบดูเหมือนมี — ต้องไปย้ายที่ /line-stock) */
  const stuckUp = useMemo(() => {
    if (!upNames.length) return [];
    const out = [];
    for (const s of stock) {
      if (!s.mat_no || s.line_name === lineName) continue;
      const q = Number(s.qty_on_hand) || 0;
      if (q > 0) out.push({ mat_no: s.mat_no, line_name: s.line_name, qty: q });
    }
    return out.sort((a, b) => b.qty - a.qty);
  }, [stock, lineName, upNames]);

  // 1 พาร์ท = 1 ใบเปิดได้ใบเดียว (unique index กันระดับ DB อีกชั้น)
  const reqByMat = useMemo(() => {
    const m = new Map();
    for (const r of reqs) if (r.mat_no) m.set(norm(r.mat_no), r);
    return m;
  }, [reqs]);

  /* พาร์ทที่ถึงจุดเรียกเติมแล้ว และ **ยังไม่มีใบค้าง** = สิ่งที่เสนอให้หัวหน้าตัดสิน
     ⚠️ ไม่ persist เป็นแถว `suggested` — คำนวณสดจากยอดจริง
        (แถว suggested ต้องมี scanner คอยสร้าง/ล้าง ซึ่งเฟสนี้ยังไม่มี · สถานะเปิดไว้ใน DB รอเฟสหน้า) */
  const suggest = useMemo(() => {
    const out = [];
    for (const lv of levels) {
      const min = num(lv.min_qty);
      if (min == null) continue;                       // ไม่ตั้ง min = ไม่เฝ้า (ไม่เดาให้)
      if (reqByMat.has(norm(lv.mat_no))) continue;     // มีใบค้างอยู่แล้ว
      const have = onHand.get(lv.mat_no) ?? null;
      if (have == null) continue;                      // ไม่มีแถวสต็อก = "ยังเช็คไม่ได้" ไม่ใช่ "ของหมด"
      if (have > min) continue;
      const max = num(lv.max_qty);
      const reorder = num(lv.reorder_qty);
      // จำนวนที่เสนอ: เติมให้ถึง max → ไม่ตั้ง max ใช้ reorder_qty → ไม่มีทั้งคู่ = ให้คนกรอกเอง
      const qty = max != null ? Math.max(0, max - have) : (reorder ?? null);
      out.push({ ...lv, have, min, suggestQty: qty ? Math.round(qty) : null });
    }
    return out.sort((a, b) => (a.have / (a.min || 1)) - (b.have / (b.min || 1)));
  }, [levels, onHand, reqByMat]);

  const holds   = reqs.filter(r => r.status === 'hold');
  const inFlight = reqs.filter(r => ['pending', 'preparing', 'delivered'].includes(r.status));
  const hasDeliveryPoint = pointsForLine(dpoints, lineName).length > 0;

  /* พาร์ทที่มีของอยู่ในไลน์ แต่ยังไม่ได้ตั้งจุดเรียกเติม — ต้องเห็น ห้ามซ่อน
     (ไม่ตั้ง = ระบบจะไม่มีวันเตือนพาร์ทนั้น ซึ่งเงียบกว่าตั้งผิด) */
  const noLevel = useMemo(() => {
    const has = new Set(levels.map(l => l.mat_no));
    return [...onHand.entries()].filter(([mat]) => !has.has(mat)).sort((a, b) => b[1] - a[1]);
  }, [onHand, levels]);

  /* ── actions ──────────────────────────────────────────────────────────────── */
  const place = async (s, qtyInput) => {
    const qty = Number(qtyInput);
    if (!(qty > 0)) { toast.error('ระบุจำนวนที่ต้องการเบิกก่อน'); return; }
    setBusy(s.mat_no);
    const now = new Date().toISOString();
    const { error } = await supabase.from('wip_replenish_requests').insert({
      line_name: lineName, mat_no: s.mat_no, part_name: s.note || null,
      request_qty: qty, status: 'pending',
      requested_at: now, decided_by_name: fullName || null,
      on_hand_at_req: s.have, min_at_req: s.min,
    });
    setBusy(null);
    if (error) {
      // 23505 = มีใบค้างของพาร์ทนี้อยู่แล้ว (unique index) — อีกเครื่องกดไปก่อน
      toast.error(error.code === '23505'
        ? 'พาร์ทนี้มีใบขอเบิกค้างอยู่แล้ว (อาจมีคนกดไปก่อน) — กด ↻ ดูรายการ'
        : `เบิกไม่สำเร็จ: ${error.message}`);
      load(); return;
    }
    notifyEvent({
      event: 'wip_request_placed', type: 'info', ref_table: 'wip_replenish_requests',
      line_name: lineName, actor: fullName,
      lines: [
        `🏭 ไลน์: ${lineName}`,
        `🔩 ${s.mat_no} · ขอเบิก ${qty.toLocaleString()} ชิ้น`,
        `📊 ในไลน์เหลือ ${fmtQty(s.have)} / จุดเรียกเติม ${fmtQty(s.min)}`,
      ],
    });
    toast.success(`📦 แจ้งสโตร์แล้ว — ${s.mat_no} ${qty.toLocaleString()} ชิ้น`);
    load();
  };

  const hold = async (s) => {
    const reason = window.prompt(
      `พักการเบิก "${s.mat_no}" ไว้ก่อน\n\nเหตุผล (เช่น เดี๋ยวเปลี่ยนรุ่น / ของยังพอถึงสิ้นกะ):`, '');
    if (reason === null) return;   // กดยกเลิก
    setBusy(s.mat_no);
    const { error } = await supabase.from('wip_replenish_requests').insert({
      line_name: lineName, mat_no: s.mat_no, request_qty: s.suggestQty || 1,
      status: 'hold', requested_at: null,          // ⚠️ ยังไม่เริ่มนับเวลา — ยังไม่ได้สั่งเบิก
      hold_at: new Date().toISOString(), hold_by_name: fullName || null,
      hold_reason: reason.trim() || null,
      on_hand_at_req: s.have, min_at_req: s.min,
    });
    setBusy(null);
    if (error) { toast.error(error.code === '23505' ? 'พาร์ทนี้มีใบค้างอยู่แล้ว' : error.message); load(); return; }
    toast.info(`⏸ พัก "${s.mat_no}" ไว้ก่อน — ยังอยู่ในรายการ ไม่หายไปไหน`);
    load();
  };

  // ปลด hold → กลายเป็นใบเบิกจริง (เริ่มนับเวลาตรงนี้ ไม่ใช่ตอน hold)
  const unhold = async (r) => {
    setBusy(r.id);
    const { data, error } = await supabase.from('wip_replenish_requests')
      .update({ status: 'pending', requested_at: new Date().toISOString(),
                decided_by_name: fullName || null, hold_reason: r.hold_reason })
      .eq('id', r.id).eq('status', 'hold').select('id');
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('รายการนี้ถูกเปลี่ยนสถานะไปแล้ว — กด ↻'); load(); return; }
    notifyEvent({
      event: 'wip_request_placed', type: 'info', ref_table: 'wip_replenish_requests',
      line_name: lineName, actor: fullName,
      lines: [`🏭 ไลน์: ${lineName}`, `🔩 ${r.mat_no} · ขอเบิก ${fmtQty(r.request_qty)} ชิ้น`, '↩ ปลดจากที่พักไว้'],
    });
    toast.success('📦 แจ้งสโตร์แล้ว');
    load();
  };

  const cancel = async (r) => {
    if (!window.confirm(`ยกเลิก "${r.mat_no}" จริงๆ?\n\n(ใช้เมื่อ "ไม่ใช้พาร์ทนี้แล้ว" เท่านั้น\nถ้าแค่ยังไม่เบิกตอนนี้ ให้ใช้ ⏸ พักไว้ก่อน)`)) return;
    setBusy(r.id);
    const { error } = await supabase.from('wip_replenish_requests')
      .update({ status: 'cancelled' }).eq('id', r.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    load();
  };

  // ขั้น 8 — ปิดลูป · ได้ไม่ครบต้องบันทึกจำนวนจริง ไม่ใช่กด "รับแล้ว" เฉยๆ
  const receive = async (r, full) => {
    let qty = Number(r.request_qty) || 0;
    let note = null;
    if (!full) {
      const a = window.prompt(`ได้รับจริงกี่ชิ้น? (ขอไป ${fmtQty(r.request_qty)})`, '');
      if (a === null) return;
      qty = Number(a);
      if (!(qty >= 0)) { toast.error('จำนวนไม่ถูกต้อง'); return; }
      note = window.prompt('หมายเหตุ / ปัญหาที่เจอ (เว้นว่างได้):', '') || null;
    }
    setBusy(r.id);
    const { data, error } = await supabase.from('wip_replenish_requests')
      .update({ status: 'received', received_at: new Date().toISOString(),
                received_by_name: fullName || null, received_qty: qty, received_note: note })
      .eq('id', r.id).neq('status', 'received').select('id');
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('รายการนี้ถูกยืนยันรับไปแล้ว'); load(); return; }
    const lead = agoMin(r.requested_at);
    toast.success(`✅ ปิดงาน ${r.mat_no}${lead != null ? ` · ใช้เวลา ${lead} นาที` : ''}`);
    load();
  };

  /* ── render ───────────────────────────────────────────────────────────────── */
  if (err?.notReady) return null;   // ยังไม่ apply migration = ฟีเจอร์ยังไม่เปิด (ไม่รบกวนหน้าจอ)

  /* ⚠️ ไลน์แม่ที่มีลูก = แผนก ไม่ใช่จุดวางของ (กฎหน่วยย่อยที่สุด)
     ตัวเลขระดับนี้ไม่มีความหมาย — บอกให้ไปเปิดที่ไลน์ลูกแทน **ห้ามโชว์ตัวเลขให้เข้าใจผิด** */
  if (!isLeaf) return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>📦 เรียกชิ้นส่วนจากสโตร์</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7 }}>
        <b>{lineName}</b> เป็นไลน์แม่ (มีไลน์ย่อย {kidNames.length}) — ของและจุดเรียกเติมอยู่ที่ <b>ไลน์ย่อย</b>
        <br />เปิดกะที่ไลน์ย่อยเพื่อดู/เบิก: {kidNames.map(n => (
          <span key={n} style={{ display: 'inline-block', margin: '3px 4px 0 0', padding: '2px 8px', borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 11 }}>{n}</span>
        ))}
      </div>
    </div>
  );

  const nothing = !err && !suggest.length && !holds.length && !inFlight.length && !noLevel.length && !stuckUp.length;
  if (nothing) return null;         // ไลน์ที่ยังไม่ตั้งอะไรเลย + ไม่มีของ = ไม่ต้องรก

  const card = { background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 };
  const btn = (bg, fg, bd) => ({ fontSize: 11.5, fontWeight: 800, padding: '5px 11px', borderRadius: 7,
    cursor: 'pointer', background: bg, color: fg, border: `1px solid ${bd || bg}`, whiteSpace: 'nowrap' });

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>📦 เรียกชิ้นส่วนจากสโตร์</div>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{lineName}</span>
        <button onClick={load} title="รีเฟรช"
          style={{ marginLeft: 'auto', ...btn('var(--bg3)', 'var(--text2)', 'var(--border2)') }}>↻</button>
        {canSetLv && (
          <button onClick={() => setShowSetup(true)} style={btn('var(--bg3)', 'var(--text2)', 'var(--border2)')}>
            ⚙️ ตั้งจุดเรียกเติม
          </button>
        )}
      </div>

      {/* โหลดไม่สำเร็จ = ต้องบอก ห้ามแสดงเป็น "ไม่มีอะไรต้องเบิก" */}
      {err?.msg && (
        <div style={{ fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '8px 11px', marginBottom: 10 }}>
          ⚠ โหลดข้อมูลไม่สำเร็จ — {err.msg} · ตัวเลขด้านล่างอาจไม่ครบ
        </div>
      )}

      {/* ⬆ ของยังกองที่ไลน์แม่ — ไม่นับเป็นของไลน์นี้ แต่ห้ามเงียบ
          นี่คือเหตุผลที่ระบบไม่เสนอเติมทั้งที่ยอดรวมในระบบดูเหมือนมี */}
      {stuckUp.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text2)', background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8, padding: '8px 11px', marginBottom: 10, lineHeight: 1.7 }}>
          <b style={{ color: '#f59e0b' }}>⬆ ของ {stuckUp.length} พาร์ทยังอยู่ที่ไลน์แม่ ไม่ได้อยู่หน้าไลน์นี้</b>
          <br />ระบบนับเฉพาะของที่อยู่ที่ <b>{lineName}</b> จริง (หน่วยย่อยที่สุด) — ของที่ไลน์แม่จึงไม่ถูกนับให้
          <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {stuckUp.slice(0, 8).map(s => (
              <span key={`${s.line_name}|${s.mat_no}`} style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 11 }}>
                {s.mat_no} · {fmtQty(s.qty)} <span style={{ color: 'var(--muted)' }}>@ {s.line_name}</span>
              </span>
            ))}
            {stuckUp.length > 8 && <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>+ อีก {stuckUp.length - 8}</span>}
          </div>
          <div style={{ marginTop: 5, color: 'var(--muted)' }}>ย้ายลงไลน์ย่อยที่ <b>Line Stock → แท็บ Stock → 🔀 ย้ายเข้าไลน์ลูก</b></div>
        </div>
      )}

      {/* ── ถึงจุดเรียกเติม → ระบบเสนอ คนตัดสิน ── */}
      {suggest.length > 0 && (
        <div style={{ marginBottom: holds.length || inFlight.length ? 12 : 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#f59e0b', marginBottom: 6 }}>
            ⚠️ ถึงจุดเรียกเติม {suggest.length} พาร์ท — จะเบิกหรือพักไว้ก่อน?
          </div>
          {suggest.map(s => (
            <SuggestRow key={s.mat_no} s={s} canDecide={canDecide} busy={busy === s.mat_no}
              onPlace={place} onHold={hold} btn={btn} />
          ))}
          {!canDecide && (
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>
              👁 ดูอย่างเดียว — คนตัดสินใจเบิกคือหัวหน้ากลุ่มของไลน์ (สิทธิ์ <code>wip_request:decide</code>)
            </div>
          )}
        </div>
      )}

      {/* ── พักไว้ก่อน — ต้องเห็นเสมอ ห้ามซ่อน (ต้นเหตุ "ลืมเบิกจนไลน์หยุด") ── */}
      {holds.length > 0 && (
        <div style={{ marginBottom: inFlight.length ? 12 : 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#f59e0b', marginBottom: 6 }}>
            ⏸ พักไว้ก่อน {holds.length} พาร์ท — ยังไม่ได้เบิก (ความต้องการยังอยู่)
          </div>
          {holds.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', padding: '7px 10px', marginBottom: 4,
              background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8 }}>
              <b style={{ fontSize: 12.5, color: 'var(--text)' }}>{r.mat_no}</b>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                ขอ {fmtQty(r.request_qty)} ชิ้น · พักเมื่อ {hhmm(r.hold_at)}{r.hold_by_name ? ` โดย ${r.hold_by_name}` : ''}
              </span>
              {r.hold_reason && <span style={{ fontSize: 11.5, color: 'var(--text2)', fontStyle: 'italic' }}>“{r.hold_reason}”</span>}
              {canDecide && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button disabled={busy === r.id} onClick={() => unhold(r)} style={btn('#f59e0b', '#1a1205')}>↩ เบิกเลย</button>
                  <button disabled={busy === r.id} onClick={() => cancel(r)} style={btn('transparent', 'var(--muted)', 'var(--border2)')}>✕ ไม่ใช้แล้ว</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── กำลังมาจากสโตร์ + ปุ่มรับของ (ขั้น 8 ปิดลูป) ── */}
      {inFlight.length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text2)', marginBottom: 6 }}>
            🚚 แจ้งสโตร์แล้ว {inFlight.length} รายการ
          </div>
          {inFlight.map(r => {
            const meta = ST[r.status] || { label: r.status, color: 'var(--muted)' };
            const wait = agoMin(r.requested_at);
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', padding: '7px 10px', marginBottom: 4,
                background: 'var(--bg3)', border: '1px solid var(--border2)', borderLeft: `3px solid ${meta.color}`, borderRadius: 8 }}>
                <b style={{ fontSize: 12.5, color: 'var(--text)' }}>{r.mat_no}</b>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ขอ {fmtQty(r.request_qty)} ชิ้น · แจ้ง {hhmm(r.requested_at)}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: meta.color }}>{meta.label}</span>
                {wait != null && (
                  <span style={{ fontSize: 11, color: wait > 60 ? '#ef4444' : 'var(--muted)', fontWeight: wait > 60 ? 800 : 400 }}>
                    · รอมาแล้ว {wait} นาที
                  </span>
                )}
                {/* เฟส 4 — ของถูกวางที่ไหน/ผ่านด่านทางไหน: สแกนจุด · ไลน์ยังไม่ตั้งจุด · หัวหน้าปลดบล็อก (override ต้องเห็น ห้ามซ่อน) */}
                {r.status === 'delivered' && r.delivered_gate && DELIVER_GATES[r.delivered_gate] && (
                  <span title={r.delivered_override_reason || ''} style={{ fontSize: 11, fontWeight: 700, color: DELIVER_GATES[r.delivered_gate].color }}>
                    {DELIVER_GATES[r.delivered_gate].icon} {r.delivered_gate === 'scanned' ? (r.delivered_point_name || DELIVER_GATES.scanned.label) : DELIVER_GATES[r.delivered_gate].label}
                  </span>
                )}
                {r.status === 'delivered' && canReceive && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button disabled={busy === r.id} onClick={() => receive(r, true)} style={btn('#22c55e', '#04140a')}>✔ รับครบ</button>
                    <button disabled={busy === r.id} onClick={() => receive(r, false)} style={btn('transparent', '#f59e0b', 'rgba(245,158,11,0.5)')}>⚠ ได้ไม่ครบ</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── worklist: ไลน์ยังไม่ตั้ง "จุดส่งงาน" — สโตร์ส่งได้ แต่ระบบตรวจไม่ได้ว่าวางถูกจุดไหม (เฟส 4 · ไม่รู้ = ห้ามบล็อก แต่ห้ามเงียบ) ── */}
      {!hasDeliveryPoint && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#f59e0b' }}>
          🎯 ไลน์นี้ยังไม่ตั้งจุดส่งงาน — สโตร์ยิง QR ยืนยันจุดวางของไม่ได้ · ตั้งที่ <b>⚙️ ตั้งค่าผังไลน์ → 🎯 จุดส่งงาน</b> แล้วพิมพ์ป้ายที่ 🏷️ พิมพ์ป้าย QR
        </div>
      )}

      {/* ── worklist: พาร์ทที่ยังไม่ตั้งจุดเรียกเติม — ไม่ตั้ง = ระบบไม่มีวันเตือน ── */}
      {noLevel.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
          <button onClick={() => setShowNoLevel(v => !v)}
            style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: 0 }}>
            {showNoLevel ? '▾' : '▸'} ⚠️ ยังไม่ได้ตั้งจุดเรียกเติม {noLevel.length} พาร์ท — ระบบจะไม่เตือนพาร์ทพวกนี้
          </button>
          {showNoLevel && (
            <div style={{ marginTop: 5, lineHeight: 1.7 }}>
              {noLevel.slice(0, 20).map(([mat, q]) => `${mat} (${fmtQty(q)})`).join(' · ')}
              {noLevel.length > 20 ? ` … และอีก ${noLevel.length - 20}` : ''}
              {canSetLv && <> · <button onClick={() => setShowSetup(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: 0 }}>ตั้งเลย →</button></>}
            </div>
          )}
        </div>
      )}

      {showSetup && (
        <LevelSetupModal lineName={lineName} upMats={[...new Set(stuckUp.map(s => s.mat_no))]} levels={levels} onHand={onHand}
          fullName={fullName} onClose={() => { setShowSetup(false); load(); }} />
      )}
    </div>
  );
}

/* ── แถวเสนอ: จำนวนแก้ได้ก่อนกดเบิก (ระบบเสนอ คนตัดสิน) ─────────────────────── */
function SuggestRow({ s, canDecide, busy, onPlace, onHold, btn }) {
  const [qty, setQty] = useState(s.suggestQty ?? '');
  const short = s.have <= 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', padding: '7px 10px', marginBottom: 4,
      background: short ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.07)',
      border: `1px solid ${short ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.3)'}`, borderRadius: 8 }}>
      <b style={{ fontSize: 12.5, color: 'var(--text)' }}>{s.mat_no}</b>
      <span style={{ fontSize: 11.5, color: short ? '#ef4444' : 'var(--muted)', fontWeight: short ? 800 : 400 }}>
        เหลือ {fmtQty(s.have)} / จุดเรียกเติม {fmtQty(s.min)}{short ? ' · หมดแล้ว' : ''}
      </span>
      {canDecide && (
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="จำนวน"
            title={s.suggestQty ? `ระบบเสนอ ${s.suggestQty} (เติมให้ถึง max)` : 'ยังไม่ได้ตั้ง max/จำนวนเบิก — กรอกเอง'}
            style={{ width: 84, padding: '4px 8px', borderRadius: 6, fontSize: 12 }} />
          <button disabled={busy} onClick={() => onPlace(s, qty)} style={btn('#22c55e', '#04140a')}>📦 เบิก</button>
          <button disabled={busy} onClick={() => onHold(s)} style={btn('transparent', '#f59e0b', 'rgba(245,158,11,0.5)')}>⏸ พักไว้</button>
        </span>
      )}
    </div>
  );
}

/* ── ตั้ง min/max ต่อไลน์ (หัวหน้าไลน์ + หัวหน้าแผนกผลิต — ไม่ใช่ Planning) ──── */
function LevelSetupModal({ lineName, upMats = [], levels, onHand, fullName, onClose }) {
  /* ⚠️ ต้องรวม "พาร์ทที่ยังค้างอยู่ที่ไลน์แม่" (upMats) เข้ามาด้วย
     ไลน์ลูกที่ยังไม่เคยมีแถวสต็อกจะได้ไม่เปิดมาเจอลิสต์ว่างแล้วตั้งอะไรไม่ได้เลย
     — ซึ่งเป็นสภาพจริงของทุกไลน์ตอนนี้ (ของยังกองที่ไลน์แม่) */
  const [rows, setRows] = useState(() => {
    const byMat = new Map(levels.map(l => [l.mat_no, l]));
    const mats = [...new Set([...byMat.keys(), ...onHand.keys(), ...upMats])].sort();
    return mats.map(m => {
      const l = byMat.get(m);
      return { mat_no: m, id: l?.id || null, min_qty: l?.min_qty ?? '', max_qty: l?.max_qty ?? '',
               reorder_qty: l?.reorder_qty ?? '', have: onHand.get(m) ?? null,
               atParent: !onHand.has(m) && upMats.includes(m) };
    });
  });
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [newMat, setNewMat] = useState('');
  const set = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));

  // พาร์ทใหม่ที่ยังไม่โผล่ที่ไหนเลย — พิมพ์เพิ่มเองได้ ไม่งั้นตั้งจุดเรียกเติมล่วงหน้าไม่ได้
  const addMat = () => {
    const m = newMat.trim();
    if (!m) return;
    if (rows.some(r => r.mat_no.toLowerCase() === m.toLowerCase())) { toast.info('มีพาร์ทนี้ในรายการแล้ว'); setNewMat(''); return; }
    setRows(rs => [{ mat_no: m, id: null, min_qty: '', max_qty: '', reorder_qty: '', have: null, atParent: false }, ...rs]);
    setNewMat('');
  };

  const save = async () => {
    setSaving(true);
    /* เขียนเฉพาะแถวที่กรอก min มา — ไม่กรอก = ไม่เฝ้าพาร์ทนั้น (ไม่สร้างแถวเปล่าให้รก)
       ⚠️ line_name = ไลน์ที่กำลังเปิดอยู่เสมอ ไม่ใช่ไลน์แม่ — min เป็นค่าของ "จุดใช้งาน" */
    const up = rows.filter(r => r.min_qty !== '' && r.min_qty != null).map(r => ({
      line_name: lineName, mat_no: r.mat_no,
      min_qty: num(r.min_qty), max_qty: num(r.max_qty), reorder_qty: num(r.reorder_qty),
      is_active: true, updated_by_name: fullName || null,
    }));
    if (!up.length) { setSaving(false); onClose(); return; }
    const { error } = await supabaseDR.from('line_part_levels')
      .upsert(up, { onConflict: 'line_name,mat_no' });
    setSaving(false);
    if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    toast.success(`บันทึกจุดเรียกเติม ${up.length} พาร์ท`);
    onClose();
  };

  const shown = rows.filter(r => !q.trim() || r.mat_no.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {/* ⚠️ ไม่ปิดจากการคลิกพื้นหลัง — กรอกตัวเลขหลายสิบช่องแล้วเผลอแตะ = หายทั้งหมด (UI-CONVENTIONS §5) */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, width: 'min(820px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border2)' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>⚙️ ตั้งจุดเรียกเติม — {lineName}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>
            เหลือถึง <b>min</b> เมื่อไหร่ ระบบจะเสนอให้เบิก · <b>max</b> ใช้คำนวณว่าเบิกเท่าไหร่ (เติมให้เต็ม)
            <br />ไม่กรอก min = <b>ไม่เฝ้าพาร์ทนั้น</b> ระบบจะไม่เตือนเลย — คนที่ยืนหน้าไลน์เป็นคนรู้ว่าควรตั้งเท่าไหร่
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* ⚠️ input ใน flex row ต้องกำหนด width เอง — index.css ตั้ง input{width:100%} จะดันปุ่มแตกแถว */}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหารหัสพาร์ท"
              style={{ width: 200, padding: '5px 10px', borderRadius: 7, fontSize: 12 }} />
            <span style={{ color: 'var(--border2)' }}>|</span>
            <input value={newMat} onChange={e => setNewMat(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMat(); } }}
              placeholder="เพิ่มพาร์ทเอง (รหัส)"
              style={{ width: 180, padding: '5px 10px', borderRadius: 7, fontSize: 12 }} />
            <button onClick={addMat} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)' }}>+ เพิ่ม</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'left' }}>
              <th style={{ padding: '4px 0' }}>รหัสพาร์ท</th>
              <th style={{ textAlign: 'right' }}>ในไลน์ตอนนี้</th>
              <th style={{ width: 90 }}>min</th><th style={{ width: 90 }}>max</th><th style={{ width: 110 }}>เบิกครั้งละ</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => {
                const i = rows.indexOf(r);
                return (
                  <tr key={r.mat_no} style={{ borderTop: '1px solid var(--border2)' }}>
                    <td style={{ padding: '5px 0', fontWeight: 700, color: 'var(--text)' }}>
                      {r.mat_no}
                      {/* ของยังอยู่ที่ไลน์แม่ — ตั้ง min ไว้ล่วงหน้าได้ แต่ต้องรู้ว่ายังไม่ใช่ของไลน์นี้ */}
                      {r.atParent && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent2)', fontWeight: 700 }}>⬆ ยังอยู่ไลน์แม่</span>}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--muted)', paddingRight: 10 }}>
                      {r.have == null ? <span title="ไม่มีแถวสต็อกของไลน์นี้ — ยังเช็คไม่ได้ ไม่ใช่ของหมด">—</span> : fmtQty(r.have)}
                    </td>
                    {['min_qty', 'max_qty', 'reorder_qty'].map(k => (
                      <td key={k} style={{ padding: '3px 4px 3px 0' }}>
                        <input type="number" value={r[k]} onChange={e => set(i, k, e.target.value)}
                          style={{ width: '100%', padding: '3px 7px', borderRadius: 6, fontSize: 12 }} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>ไม่มีพาร์ทที่ตรงกับคำค้น</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border2)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ fontSize: 12.5, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)' }}>ยกเลิก</button>
          <button onClick={save} disabled={saving} style={{ fontSize: 12.5, fontWeight: 800, padding: '7px 18px', borderRadius: 8, cursor: 'pointer', background: 'var(--accent)', border: 'none', color: '#08130a' }}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
