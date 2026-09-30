/* ══ 📋 แผนสั่งงานรายล็อต — ทีมวางแผนจัดคิวให้ฝ่ายผลิต (2026-09-30 · คำสั่ง user) ═══════════
   *"เราต้องการหน้าที่เอาไว้ให้หน่วยงานวางแผน จัดแผนการผลิตให้กับฝ่ายผลิต สำหรับพวกงาน lot size
     ที่ไม่ได้ผลิตตาม KANBAN แบบ first come first serve ต้องมีการวิเคราะห์และจัดการโดยทีมวางแผน"*

   ต่างจาก 3 แท็บเดิมของหน้านี้ตรงที่ **แท็บนี้เขียน DB** — อีก 3 แท็บวิเคราะห์อย่างเดียว
     📅 รายวัน   ตอบ "ต้องเปิดกี่กะ"        ← ยังไม่บอกว่า *ทำอะไรก่อนหลัง*
     📋 แท็บนี้  ตอบ "ทำอะไร เท่าไหร่ ลำดับไหน เครื่องไหน แม่พิมพ์ตัวไหน"  ⇒ หน้างานกด "เริ่ม" แล้วจบ

   🔴 กติกาที่ห้ามละเมิด (ตัวเลขทุกตัวมาจาก `utils/planLots.js` **ห้ามคิดเองในไฟล์นี้**):
     · **เกินกำลัง = เตือน ห้ามบล็อก** — วางแผนอาจตั้งใจอัดแล้วไปแก้ด้วย OT/คนเพิ่ม
     · **ประเมินไม่ได้ต้องเขียนว่าไม่รู้ ห้ามโชว์ 0** (ไม่มี CT · ไม่รู้ความสูงแม่พิมพ์)
     · **ใบที่หน้างานเปิดเองนอกแผน ต้องโผล่ให้เห็น** — ไม่ใช่ความผิด แต่วางแผนต้องรู้ว่าแผนถูกข้าม
     · **ยกเลิกล็อต = `cancelled` + เหตุผล ห้าม delete แถว** (สอบกลับไม่ได้)
     · สิทธิ์ผ่าน `can('production_plan','write')` **ห้าม hardcode role array**
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { canSeeded } from '../utils/permissions';
import { checkWrite } from '../utils/dbWrite';
import { toast } from '../components/Toast';
import { snapMachineNo } from '../utils/machineNo';
import { resolveSetupRule } from '../utils/pressSetup';
import {
  planSummary, reconcilePlan, sortBySeq, resequence, moveLot, suggestSequence, lotRunMin, qtyText,
} from '../utils/planLots';
import { breakIntervalsIn } from '../utils/oee';
import PlanTimeline from './PlanTimeline';
import FilterBar from './FilterBar';
import Segmented from './Segmented';
import MatLabel from './MatLabel';
import MachineSelect from './MachineSelect';

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, boxShadow: 'var(--shadow-sm)' };
const th = { padding: '5px 8px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: 12, whiteSpace: 'nowrap' };
const fmtMin = (m) => m == null ? '—' : m < 60 ? `${Math.round(m)} น.` : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')} ชม.`;
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function ProdLotPlanner({
  lines = [], demandByDate = {}, carry = {}, ctOf = () => 0, pairOf = () => null,
  lineOfMat = () => null, nameOfMat = () => '', customerOf = () => null, netMin = null,
}) {
  const { role, fullName } = useContext(UserContext);
  /* ยังไม่ seed สิทธิ์ = โหมดอ่านอย่างเดียว (deploy-safe — จอไม่พัง คนแค่แก้ไม่ได้) */
  const mayWrite = canSeeded('production_plan', 'write', role);

  const [lineName, setLineName] = useState('');
  const [date, setDate]   = useState(todayStr);
  const [shift, setShift] = useState('day');
  const [lots, setLots]   = useState([]);
  const [orders, setOrders] = useState([]);
  const [dies, setDies]   = useState([]);          // die_sets + ความสูงจาก equipment_die
  const [rules, setRules] = useState([]);
  const [breakPolicies, setBreakPolicies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);

  useEffect(() => { if (!lineName && lines.length) setLineName(lines[0].name); }, [lines, lineName]);

  /* ── โหลดข้อมูลของไลน์/วัน/กะที่เลือก ────────────────────────────────────────────
     🔴 guard `alive` — จอนี้ยิงคิวรีตาม state (ไลน์/วัน/กะ) ⇒ สลับเร็วกว่าคำตอบเก่ากลับ
        = คำตอบเก่าเขียนทับจอใหม่ (กฎเหล็ก db-write-rules ข้อ 4 · เคยเกิดจริงที่ Daily Report) */
  const load = useCallback(async (alive = () => true) => {
    if (!lineName || !date) return;
    setLoading(true);
    const [lotRes, dieRes, ruleRes, sessRes, brkRes] = await Promise.all([
      supabaseDR.from('production_plan_lots')
        .select('id, work_date, shift, line_name, seq, mat_no, part_name, qty_plan, machine_no, die_no, status, prod_order_id, due_date, source, setup_min_est, note, cancel_reason, planned_by')
        .eq('work_date', date).eq('line_name', lineName).eq('shift', shift),
      supabaseDR.from('die_sets').select('id, set_code, mat_no, part_name, line_name, equipment_die(die_height_mm)').eq('is_active', true),
      supabaseDR.from('press_setup_rules').select('*').eq('is_active', true),
      supabaseDR.from('production_sessions').select('id').eq('work_date', date).eq('line_name', lineName).eq('shift', shift),
      supabaseDR.from('break_policies').select('*').eq('is_active', true),
    ]);
    if (!alive()) return;                       // สลับไลน์/วันก่อนคำตอบกลับ = ทิ้งคำตอบเก่า
    if (lotRes.error) toast.error(`โหลดแผนไม่สำเร็จ: ${lotRes.error.message}`);
    setLots(resequence(lotRes.data || []));
    setDies(dieRes.data || []);                 // กรองตามพาร์ทตอนเลือกใน dieOptsForMat (ไลน์เดียวกันอาจใช้แม่พิมพ์ข้ามไลน์)
    setRules(ruleRes.data || []);
    setBreakPolicies(brkRes.data || []);
    const sids = (sessRes.data || []).map(s => s.id);
    if (sids.length) {
      const { data: ord } = await supabaseDR.from('prod_orders')
        .select('id, mat_no, prod_no, qty, qty_ok, qty_actual, status, is_manual, opened_at')
        .in('session_id', sids);
      if (alive()) setOrders(ord || []);
    } else if (alive()) setOrders([]);
    if (alive()) { setLoading(false); setDirty(false); }
  }, [lineName, date, shift]);

  /* 🔴 guard stale-response (กฎเหล็ก db-write-rules ข้อ 4) — จอนี้ยิงคิวรีตาม state
     ถ้า user สลับไลน์/วัน/กะ เร็วกว่าคำตอบเก่ากลับ คำตอบเก่าจะเขียนทับจอใหม่ */
  useEffect(() => { let on = true; load(() => on); return () => { on = false; }; }, [load]);

  /* ── แม่พิมพ์: รหัส → { id, die_height_mm } (ป้อน pressSetup) ──────────────────── */
  const dieByCode = useMemo(() => {
    const m = {};
    dies.forEach(d => {
      if (!d.set_code) return;
      const h = (d.equipment_die || []).map(e => e?.die_height_mm).find(v => v != null);
      m[d.set_code] = { id: d.set_code, die_height_mm: h ?? null, mat_no: d.mat_no, part_name: d.part_name };
    });
    return m;
  }, [dies]);
  const dieOf = useCallback((lot) => (lot?.die_no ? dieByCode[lot.die_no] || null : null), [dieByCode]);
  const dieOptsForMat = useCallback((mat) => dies.filter(d => !mat || d.mat_no === mat), [dies]);
  /* กฎเวลาเปลี่ยนรุ่น — เครื่อง ชนะ ไลน์ ชนะ global (ตัวเลือกกฎอยู่ที่ pressSetup ที่เดียว) */
  const rule = useMemo(() => resolveSetupRule(rules, { lineName }), [rules, lineName]);

  /* ── กรอบเวลาของกะ + ช่วงพัก ─────────────────────────────────────────────────────
     🔴 ช่วงพักต้องมาจาก `breakIntervalsIn()` (`utils/oee.js`) ที่เดียว **ห้ามสร้างช่วงพักเอง**
        (กติกาพักทั้งหมด — กรองกะ/กระบวนการ/ot_scope/กะดึกข้ามวัน — อยู่ที่นั่น) */
  const frame = useMemo(() => {
    if (!date) return { startMs: null, endMs: null };
    const h = shift === 'night' ? 20 : 8;
    const startMs = new Date(`${date}T${String(h).padStart(2, '0')}:00:00`).getTime();
    return { startMs, endMs: startMs + 12 * 3600000 };
  }, [date, shift]);
  const breaks = useMemo(() => breakIntervalsIn({
    policies: breakPolicies, startMs: frame.startMs, endMs: frame.endMs, workDate: date, shift,
  }), [breakPolicies, frame.startMs, frame.endMs, date, shift]);

  const summary = useMemo(() => planSummary({
    lots, orders, ctOf, pairOf, dieOf, rule, netShiftMin: netMin,
  }), [lots, orders, ctOf, pairOf, dieOf, rule, netMin]);
  const rec = useMemo(() => reconcilePlan(lots, orders), [lots, orders]);

  /* ── ความต้องการของไลน์นี้ที่ยังไม่ได้วางแผน (ของค้างส่งมาก่อนเสมอ) ───────────── */
  const unplanned = useMemo(() => {
    const planned = new Set(lots.filter(l => l.status !== 'cancelled').map(l => l.mat_no));
    const want = {};
    Object.entries(carry || {}).forEach(([mat, q]) => { if (q > 0) want[mat] = (want[mat] || 0) + q; });
    Object.entries(demandByDate || {}).forEach(([d, byMat]) => {
      if (d > date) return;                      // เอาเฉพาะที่ถึงกำหนดภายในวันที่วางแผน
      Object.entries(byMat || {}).forEach(([mat, q]) => { if (q > 0) want[mat] = (want[mat] || 0) + q; });
    });
    return Object.entries(want)
      .filter(([mat]) => lineOfMat(mat) === lineName && !planned.has(mat))
      .map(([mat, qty]) => ({ mat, qty: Math.round(qty) }))
      .sort((a, b) => b.qty - a.qty);
  }, [carry, demandByDate, date, lots, lineOfMat, lineName]);

  /* ── แก้แผนในหน่วยความจำก่อน แล้วค่อยกดบันทึกทีเดียว ────────────────────────── */
  const patch = (id, upd) => { setLots(ls => ls.map(l => (l.id === id ? { ...l, ...upd } : l))); setDirty(true); };
  const addLot = (mat, qty) => {
    const die = dies.find(d => d.mat_no === mat);
    setLots(ls => resequence([...ls, {
      id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, _new: true,
      work_date: date, shift, line_name: lineName, seq: ls.length + 1,
      mat_no: mat, part_name: nameOfMat(mat) || null, qty_plan: qty || 1,
      machine_no: null, die_no: die?.set_code || null, status: 'planned', source: 'manual',
    }]));
    setDirty(true);
  };
  const cancelLot = (l) => {
    const why = window.prompt(`ยกเลิกล็อต ${l.mat_no} (${l.qty_plan} ชิ้น) เพราะอะไร?\n(เก็บไว้เป็นประวัติ ไม่ได้ลบทิ้ง)`);
    if (!why) return;
    patch(l.id, { status: 'cancelled', cancel_reason: why });
  };

  const save = async () => {
    if (!mayWrite) return;
    setSaving(true);
    const seqd = resequence(lots);
    /* เวลาเปลี่ยนรุ่น ณ ตอนวางแผน — เก็บไว้ดูย้อนหลังว่าตอนนั้นระบบประเมินได้เท่าไหร่
       🔴 ประเมินไม่ได้ = null (ห้าม 0) · กฎเดียวกับ pressSetup */
    const rows = seqd.map((l, i) => {
      const prev = i > 0 ? dieOf(seqd[i - 1]) : null;
      const cur = dieOf(l);
      let est = null;
      if (prev && cur && rule) {
        const s = planSummary({ lots: [seqd[i - 1], l], orders: [], ctOf, pairOf, dieOf, rule, netShiftMin: netMin });
        est = s.setupMin;
      }
      const { id, _new, ...rest } = l;
      return { ...(_new ? {} : { id }), ...rest, seq: i + 1, setup_min_est: est, planned_by: fullName || null };
    });
    const news = rows.filter(r => !r.id);
    const olds = rows.filter(r => r.id);
    let ok = true;
    if (news.length) ok = await checkWrite(await supabaseDR.from('production_plan_lots').insert(news).select('id'), 'บันทึกล็อตใหม่') && ok;
    for (const r of olds) {
      const { id, ...upd } = r;
      ok = await checkWrite(await supabaseDR.from('production_plan_lots').update(upd).eq('id', id).select('id'), 'อัพเดทล็อต') && ok;
    }
    setSaving(false);
    if (ok) { toast.success(`บันทึกแผน ${rows.length} ล็อต ✓`); await load(); }
  };

  const fitColor = { ok: 'var(--accent)', tight: '#f59e0b', over: '#ef4444', unknown: 'var(--muted)' }[summary.fit.state];
  const fitText = { ok: 'ทำไหว', tight: 'ตึง', over: '🚨 เกินเวลากะ', unknown: 'ประเมินไม่ได้' }[summary.fit.state];
  const noHeight = Object.values(dieByCode).filter(d => d.die_height_mm == null).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <FilterBar style={{ marginBottom: 0 }}>
        <select value={lineName} onChange={e => setLineName(e.target.value)}>
          {lines.map(l => <option key={l.id || l.name} value={l.name}>{l.name}</option>)}
        </select>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        <Segmented value={shift} onChange={setShift} label="กะ" options={[
          { value: 'day', label: '☀️ กะเช้า' }, { value: 'night', label: '🌙 กะดึก' },
        ]} />
        <span className="spacer" />
        {mayWrite && (
          <>
            <button onClick={() => { setLots(suggestSequence(lots, dieOf)); setDirty(true); }}
              title="เรียงตามความสูงแม่พิมพ์ให้เสียเวลาเปลี่ยนรุ่นน้อยสุด — เป็นข้อเสนอ แก้ทับได้">
              💡 เสนอลำดับ
            </button>
            <button onClick={save} disabled={saving || !dirty}
              style={{ background: dirty ? 'var(--accent)' : undefined, color: dirty ? '#04210f' : undefined, fontWeight: 800 }}>
              {saving ? 'กำลังบันทึก…' : dirty ? '💾 บันทึกแผน' : 'บันทึกแล้ว'}
            </button>
          </>
        )}
      </FilterBar>

      {!mayWrite && (
        <div style={{ ...card, borderColor: '#f59e0b66', fontSize: 12.5, color: 'var(--text2)' }}>
          👁️ <b>โหมดดูอย่างเดียว</b> — role ของคุณยังไม่มีสิทธิ์ <code>production_plan:write</code> (ปรับได้ที่หน้า /permissions)
        </div>
      )}

      {/* ── สรุปหัวแผง: ตอบ "กะนี้รับไหวไหม" บรรทัดเดียว ── */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{summary.lotCount} ล็อต · {qtyText(summary.qtyPlan)} ชิ้น</span>
        <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>⏱️ เวลาผลิต <b>{fmtMin(summary.runMin)}</b></span>
        <span style={{ fontSize: 12.5, color: 'var(--text2)' }}
          title={summary.setupNoDie ? 'ยังไม่ได้ระบุแม่พิมพ์ในล็อตไหนเลย — ประเมินเวลาเปลี่ยนรุ่นไม่ได้ (ไม่ใช่ "ไม่ต้องเปลี่ยน")' : ''}>
          🔧 เปลี่ยนรุ่น <b>{summary.setupMin == null ? '—' : fmtMin(summary.setupMin)}</b>
          <span style={{ color: 'var(--muted)' }}> ({summary.setupNoDie ? 'ยังไม่ระบุแม่พิมพ์' : `${summary.changeCount} ครั้ง`})</span>
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, color: fitColor }}>
          {fitText}{summary.fit.pct != null && ` · ใช้ ${Math.round(summary.fit.pct)}% ของกะ`}
        </span>
        {netMin && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>เวลาทำงานสุทธิ {netMin} นาที/กะ</span>}
        {summary.started > 0 && <span style={{ fontSize: 12, color: 'var(--accent)' }}>▶ เริ่มแล้ว {summary.started} · ปิดแล้ว {summary.closed}</span>}
      </div>

      {/* 🔴 ความซื่อสัตย์: อะไรที่ประเมินไม่ได้ ต้องเขียนบนจอ ห้ามปล่อยให้ตัวเลขดูสวย */}
      {(summary.noCtMats.length > 0 || summary.setupUnknown || noHeight > 0) && (
        <div style={{ ...card, borderColor: '#f59e0b66', fontSize: 12, color: 'var(--text2)', display: 'grid', gap: 3 }}>
          {summary.noCtMats.length > 0 && (
            <div>⚠️ <b>{summary.noCtMats.length} พาร์ทยังไม่มี cycle time</b> ({summary.noCtMats.slice(0, 4).join(' · ')}{summary.noCtMats.length > 4 ? ' …' : ''})
              — เวลาผลิตข้างบน<b>ต่ำกว่าจริง</b> · ไปกรอกที่ Product Master</div>
          )}
          {summary.setupUnknown && (
            <div>⚠️ <b>ยังตอบเวลาเปลี่ยนรุ่นรวมไม่ได้</b> — {
              summary.setupNoDie ? 'ยังไม่ได้ระบุแม่พิมพ์ในล็อตไหนเลย (ช่อง "แม่พิมพ์" ในตารางด้านล่าง)'
                : rule ? 'ยังไม่ได้กรอกเวลาฐานยก-ลงแม่พิมพ์' : 'ยังไม่มีกฎเวลาเปลี่ยนรุ่นของไลน์นี้'}
              {' '}(ตั้งที่ <code>/equipment?tab=die</code>) · <b>"—" แปลว่าไม่รู้ ไม่ใช่ 0</b></div>
          )}
          {noHeight > 0 && (
            <div>📏 <b>แม่พิมพ์ {noHeight} ตัวยังไม่ได้กรอกความสูง</b> — ระบบจึงเรียงลำดับให้ประหยัดเวลาเปลี่ยนรุ่นไม่ได้
              (ตัวที่ไม่รู้ความสูงถูกต่อท้ายลำดับ <b>ไม่ได้ตัดทิ้ง</b>)</div>
          )}
        </div>
      )}

      {/* ── 🧲 ไทม์ไลน์จัดแผน (ลากสลับก่อนหลัง) ── */}
      {rec.rows.length > 0 && frame.startMs && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
            🧲 ไทม์ไลน์ของกะนี้ <span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 11.5 }}>
              (ความยาวกล่อง = เวลาที่ต้องใช้จริง · ลากเพื่อสลับลำดับ)</span>
          </div>
          <PlanTimeline
            lots={lots} ctOf={ctOf} pairOf={pairOf} dieOf={dieOf} rule={rule}
            startMs={frame.startMs} endMs={frame.endMs} breaks={breaks}
            editable={mayWrite} nameOfMat={nameOfMat}
            onReorder={(next) => { setLots(next); setDirty(true); }}
          />
        </div>
      )}

      {/* ── ตารางแผน ── */}
      <div style={{ ...card, overflowX: 'auto' }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>📋 คิวงานของกะนี้</div>
        {loading ? <div style={{ color: 'var(--muted)', fontSize: 12.5, padding: 12 }}>กำลังโหลด…</div>
          : rec.rows.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 12.5, padding: 12 }}>ยังไม่มีแผนของกะนี้ — เพิ่มจากรายการความต้องการด้านล่าง</div>
          : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'center' }}>ลำดับ</th>
              <th style={{ ...th, textAlign: 'left' }}>พาร์ท</th>
              <th style={{ ...th, textAlign: 'right' }}>จำนวน</th>
              <th style={{ ...th, textAlign: 'right' }}>เวลาผลิต</th>
              <th style={{ ...th, textAlign: 'left' }}>เครื่อง</th>
              <th style={{ ...th, textAlign: 'left' }}>แม่พิมพ์</th>
              <th style={{ ...th, textAlign: 'left' }}>สถานะ</th>
              {mayWrite && <th style={{ ...th, textAlign: 'center' }}>จัดการ</th>}
            </tr></thead>
            <tbody>
              {rec.rows.map((r, i) => {
                const l = r.lot;
                const die = dieOf(l);
                return (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--border)', opacity: l.status === 'cancelled' ? 0.45 : 1 }}>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 800 }}>{l.seq}</td>
                    <td style={td}>
                      <MatLabel mat={l.mat_no} size={12} />
                      {customerOf(l.mat_no) && <span style={{ color: 'var(--muted)', fontSize: 11 }}> · {customerOf(l.mat_no)}</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {mayWrite && l.status === 'planned' ? (
                        <input type="number" min="1" value={l.qty_plan}
                          onChange={e => patch(l.id, { qty_plan: Math.max(1, Number(e.target.value) || 1) })}
                          style={{ width: 84, textAlign: 'right' }} />
                      ) : <b>{qtyText(l.qty_plan)}</b>}
                      {r.donePcs != null && (
                        <div style={{ fontSize: 11, color: r.shortPcs > 0 ? '#f59e0b' : 'var(--accent)' }}>
                          ทำได้ {r.donePcs.toLocaleString()}{r.shortPcs > 0 ? ` · ขาด ${r.shortPcs.toLocaleString()}` : ' ✓'}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--text2)' }}>{fmtMin(lotRunMin(l, ctOf))}</td>
                    <td style={td}>
                      {mayWrite && l.status === 'planned' ? (
                        <MachineSelect value={l.machine_no || ''} lines={[lineName]}
                          onChange={(v) => patch(l.id, { machine_no: v ? snapMachineNo(v) : null })}
                          inputStyle={{ width: 150, fontSize: 12 }} />
                      ) : (l.machine_no || <span style={{ color: 'var(--muted)' }}>—</span>)}
                    </td>
                    <td style={td}>
                      {mayWrite && l.status === 'planned' ? (
                        <select value={l.die_no || ''} onChange={e => patch(l.id, { die_no: e.target.value || null })} style={{ fontSize: 12, maxWidth: 170 }}>
                          <option value="">— ไม่ระบุ —</option>
                          {dieOptsForMat(l.mat_no).map(d => <option key={d.id} value={d.set_code}>{d.set_code}</option>)}
                        </select>
                      ) : (l.die_no || <span style={{ color: 'var(--muted)' }}>—</span>)}
                      {die && <div style={{ fontSize: 10.5, color: die.die_height_mm == null ? '#f59e0b' : 'var(--muted)' }}>
                        {die.die_height_mm == null ? '⚠ ไม่รู้ความสูง' : `สูง ${die.die_height_mm} มม.`}</div>}
                    </td>
                    <td style={td}>
                      {l.status === 'cancelled' ? <span style={{ color: '#ef4444' }}>✕ ยกเลิก</span>
                        : r.closed ? <span style={{ color: 'var(--accent)' }}>✓ ปิดแล้ว</span>
                        : r.started ? <span style={{ color: '#4d9fff' }}>▶ กำลังทำ</span>
                        : <span style={{ color: 'var(--muted)' }}>รอคิว</span>}
                      {l.cancel_reason && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{l.cancel_reason}</div>}
                    </td>
                    {mayWrite && (
                      <td style={{ ...td, textAlign: 'center' }}>
                        {l.status === 'planned' && (
                          <>
                            <button onClick={() => { setLots(moveLot(lots, l.id, -1)); setDirty(true); }} disabled={i === 0} title="เลื่อนขึ้น">↑</button>
                            <button onClick={() => { setLots(moveLot(lots, l.id, 1)); setDirty(true); }} disabled={i === rec.rows.length - 1} title="เลื่อนลง">↓</button>
                            <button onClick={() => cancelLot(l)} title="ยกเลิกล็อตนี้ (เก็บเป็นประวัติ)">✕</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── ใบที่หน้างานเปิดเองนอกแผน — ต้องเห็น ห้ามซ่อน ── */}
      {rec.startedNotPlanned.length > 0 && (
        <div style={{ ...card, borderColor: '#f59e0b66' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', marginBottom: 5 }}>
            ⚠️ {rec.startedNotPlanned.length} ใบที่หน้างานเปิดเอง — ไม่ได้อยู่ในแผนของกะนี้
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12 }}>
            {rec.startedNotPlanned.slice(0, 15).map(o => (
              <span key={o.id} style={{ color: 'var(--text2)' }}>
                <MatLabel mat={o.mat_no} size={11.5} /> <span style={{ color: 'var(--muted)' }}>{o.qty} ชิ้น{o.is_manual ? ' · manual' : ''}</span>
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>ไม่ใช่ความผิดของหน้างาน — แต่วางแผนต้องรู้ว่าแผนถูกข้ามด้วยเหตุอะไร</div>
        </div>
      )}

      {/* ── ความต้องการที่ยังไม่ได้วางแผน ── */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
          📥 ความต้องการของไลน์นี้ที่ยังไม่ได้วางแผน <span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 11.5 }}>(ค้างส่ง + ถึงกำหนดภายใน {date})</span>
        </div>
        {unplanned.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>— วางแผนครบทุกพาร์ทที่มีความต้องการแล้ว —</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {unplanned.slice(0, 24).map(u => (
              <div key={u.mat} style={{ border: '1px solid var(--border2)', borderRadius: 6, padding: '5px 9px', display: 'flex', alignItems: 'baseline', gap: 7 }}>
                <MatLabel mat={u.mat} size={12} />
                <b style={{ fontSize: 12 }}>{u.qty.toLocaleString()}</b>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>ชิ้น</span>
                {mayWrite && <button onClick={() => addLot(u.mat, u.qty)} style={{ fontSize: 11 }}>+ เข้าแผน</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
