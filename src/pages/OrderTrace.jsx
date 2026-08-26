import { useState, useEffect, useMemo, useContext, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { stdGroupOf } from '../utils/stdManpower';
import CollapseCard from '../components/CollapseCard';
import { toast } from '../components/Toast';
import { deptNameOf } from '../utils/mtnTeams';
import { isParallelLine } from '../utils/lineTypes';
import { noteSimilarity, CLUSTER_THRESHOLD } from '../utils/textCluster';
import { PART_WORDS, wordGroups } from '../utils/peLink';
import PageHeader from '../components/PageHeader';
import { inspMeta } from '../utils/inspectionStatus';

/*
  🔎 สอบกลับ Order (Order Traceability) — 2026-07-30
  รู้ prod_no ที่สแกน kanban → เห็นทุกอย่างที่เกิดขึ้นกับใบนั้น + สถานการณ์รอบข้าง ณ เวลานั้น:
  timeline เหตุการณ์ (เปิดใบ/ยอดสะสม/NG/Downtime/ปิดใบ/เข้าคลัง/ตัดส่ง) · คนเข้างานไลน์วันนั้น ·
  4M ที่เปลี่ยน · เครื่องเสีย+ใบซ่อม MO · วัสดุ (ล็อต child → เบิก raw) · การตรวจประจำวัน (LPA/Poka-Yoke/Daily PM)
  ขอบเขตที่สอบได้/gap ดู CLAUDE.md section "Order Traceability"
  deep-link: /order-trace?prod=<PROD_NO>
*/

const todayStr = () => {
  const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
const fmtTime = t => t ? new Date(t).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDT = t => t ? new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDate = s => { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('th-TH', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' }); };
const STATUS_META = {
  open: { label: '● กำลังผลิต', color: '#22c55e' }, confirmed: { label: '✓ ปิดใบแล้ว', color: '#22c55e' },
  carry_over: { label: '➡ ยกยอดข้ามกะ', color: '#f59e0b' }, cancelled: { label: '✕ ยกเลิก', color: '#ef4444' },
  imported: { label: '⏬ ถูกยกไปกะถัดไป', color: 'var(--muted)' },
};
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' };
/* ผลตรวจ PM/AM — นิยาม/กฎ "ห้ามเทียบด้วย regex" อยู่ที่ `src/utils/inspectionStatus.js` ที่เดียว */
const inspVerdict = raw => {
  const m = inspMeta(raw);
  return <span style={{ color: m.color }}>{m.label}</span>;
};
/* เกณฑ์ "สแกนรวบ" = ช่องว่างระหว่างสแกน < BATCH_FRAC × เวลาที่ต้องใช้ผลิตของใบนั้น (qty × CT)
   0.5 = ต้องผลิตเร็วกว่ามาตรฐาน "2 เท่า" ถึงจะทันในช่วงนั้น → เป็นไปไม่ได้ = สแกนรวบแน่นอน
   (ไม่ใช่เวลาตายตัว — สเกลตามชิ้นงาน/จำนวนของแต่ละใบเอง · ตรวจกับข้อมูลจริง Assy LWR 05/08:
    ทยอยสแกนทุก 33 นาที (need 34 นาที) = ไม่ใช่ชุด ✓ · สแกน 6 ใบห่างกัน 1-3 วินาที = ชุด ✓
    ถ้าใช้ 1.0 จะเหมารวมการทยอยสแกนจริงผิด) */
const BATCH_FRAC = 0.5;
// ใช้เฉพาะตอนคำนวณเวลาผลิตจริงไม่ได้เลย (ไม่มีทั้ง CT และข้อมูลกะ)
const FALLBACK_BATCH_SEC = 180;
const chip = (bg, fg) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: bg, color: fg });

/* ── โฟกัสการสอบสวนตาม "อาการที่ลูกค้าแจ้ง" ────────────────────────────────────────────
   กลุ่มคำของชิ้นส่วน/อาการ (ไทย/อังกฤษ) ย้ายไปอยู่ `src/utils/peLink.js` แล้ว (2026-08-17)
   — ตอนนี้มีผู้ใช้ 2 ที่ (หน้านี้ + ลูปปิด 8D→PE) ต้องนิยามที่เดียว เพิ่มคำใหม่แก้ที่ util */

export default function OrderTrace() {
  const { role, lineId, sections } = useContext(UserContext);
  const scopeSecs = sections || [];
  const [searchParams, setSearchParams] = useSearchParams();

  const [lines, setLines] = useState([]);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(() => addDays(todayStr(), -30));
  const [to, setTo] = useState(todayStr);
  const [results, setResults] = useState([]);       // ใบที่ค้นเจอ
  const [includeOpen, setIncludeOpen] = useState(false);   // สอบกลับ = ของที่ออกจากไลน์แล้ว → ตัดใบที่ยังผลิตอยู่ออก
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState(null);              // order ที่เลือก (พร้อม session)
  const [trace, setTrace] = useState(null);          // bundle ข้อมูลสอบกลับ
  const [claimFm, setClaimFm] = useState('');        // failure mode ที่เลือกจาก PFMEA ของพาร์ทนี้
  const [claimNote, setClaimNote] = useState('');    // รายละเอียดที่ลูกค้าแจ้งเพิ่ม
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // flow_mode ตัดสินว่า "ใบหนึ่งใช้เครื่องกี่ตัว" (ไหลทีละชิ้นผ่านทุกเครื่อง vs เครื่องขนานตัวใครตัวมัน)
    // — best-effort: ยังไม่ apply migration ก็ถอยไป select เดิม (flowModeOf() default = one_piece_flow)
    (async () => {
      const base = 'id, name, section, parent_line_name, std_day_shift, std_night_shift';
      let r = await supabase.from('production_lines').select(`${base}, flow_mode, parallel_stations`).order('name');
      if (r.error) r = await supabase.from('production_lines').select(base).order('name');
      setLines(r.data || []);
    })();
  }, []);

  // scope ไลน์ (pattern มาตรฐาน: leader = family ตัวเอง · role อื่น = ตาม sections)
  const scopeLineNames = useMemo(() => {
    if (role === 'leader' && lineId) {
      const me = lines.find(l => String(l.id) === String(lineId));
      return me ? new Set(getLineFamilyNames(lines, me.name).map(n => n.toLowerCase())) : null;
    }
    if (scopeSecs.length) return new Set(lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name.toLowerCase()));
    return null;
  }, [role, lineId, lines, scopeSecs]);
  const inScope = useCallback(ln => !scopeLineNames || scopeLineNames.has((ln || '').toLowerCase()), [scopeLineNames]);

  /* สรุปภาพรวมของ "ใบที่ค้นเจอ" — ให้เห็นข้อมูลก่อนคลิกเลือกใบ
     หมายเหตุ: เป็นผลรวมของรายการที่แสดง (list sum) ไม่ใช่ยอดผลิตภาพใหญ่ของโรงงาน
     จึงบวกตรงๆ ต่อใบ (ไม่ใช้ pairAwareTotal ซึ่งใช้กับจอสรุปยอดรวมภาพใหญ่) */
  const sum = useMemo(() => {
    const s = { count: results.length, target: 0, produced: 0, ng: 0, openCount: 0, lines: [], mats: [], days: [], capped: results.length >= 300 };
    const lineSet = new Set(), matSet = new Set(), daySet = new Set();
    results.forEach(o => {
      s.target += Number(o.qty_target ?? o.qty) || 0;
      s.produced += Number(o.status === 'confirmed' ? (o.qty_ok ?? o.qty) : o.qty_actual) || 0;
      s.ng += (Number(o.qty_ng) || 0) + (Number(o.qty_suspect) || 0);
      if (o.status === 'open') s.openCount++;
      const ss = o.production_sessions || {};
      if (ss.line_name) lineSet.add(ss.line_name);
      if (o.mat_no) matSet.add(o.mat_no);
      if (ss.work_date) daySet.add(ss.work_date);
    });
    s.lines = [...lineSet].sort(); s.mats = [...matSet].sort(); s.days = [...daySet].sort();
    return s;
  }, [results]);

  /* ── ค้นหาใบผลิต (สแกน/พิมพ์ prod_no หรือ MAT/ชื่อชิ้นงาน) ──
     สอบกลับ = ทวนสอบย้อนหลัง "ของที่ออกจากไลน์ไปแล้ว" → default ตัดใบที่ยังผลิตอยู่ (status open) ออก
     (ติ๊ก "รวมใบที่กำลังผลิต" เพื่อดูได้ · สแกน prod_no ตรงเป๊ะแล้วไม่เจอ = fallback หาแบบรวมใบเปิดให้อัตโนมัติ) */
  const ORDER_COLS = 'id, prod_no, mat_no, part_name, customer, qty, qty_target, qty_actual, qty_ok, qty_ng, qty_suspect, qty_repair, status, opened_by, opened_at, confirmed_by, confirmed_at, is_backfill, machine_no, paired_order_id, carry_over_note, carry_over_from_session_id, reopened_by, reopened_at, reopen_count, session_id, production_sessions!inner(id, line_name, work_date, shift, status, oee, oee_a, oee_p, oee_q, opened_by_name, closed_by_name, closed_at, close_approve_note)';
  const doSearch = useCallback(async (term, opts = {}) => {
    const q = (term ?? search).trim();
    const withOpen = opts.includeOpen ?? includeOpen;
    setSearching(true);
    const run = async (allowOpen) => {
      let query = supabaseDR.from('prod_orders').select(ORDER_COLS)
        .gte('production_sessions.work_date', from).lte('production_sessions.work_date', to)
        .order('opened_at', { ascending: false }).limit(300);
      if (!allowOpen) query = query.neq('status', 'open');
      if (q) query = query.or(`prod_no.ilike.%${q}%,mat_no.ilike.%${q}%,part_name.ilike.%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).filter(o => inScope(o.production_sessions?.line_name));
    };
    try {
      let rows = await run(withOpen);
      // สแกนมาแล้วไม่เจอเพราะใบยังผลิตอยู่ → หาให้ใหม่ (ไม่ปล่อยให้สแกนแล้วเงียบ)
      if (!rows.length && q && !withOpen) {
        rows = await run(true);
        if (rows.length) toast.info('ใบนี้ยังผลิตไม่จบ — แสดงให้ (สอบกลับปกติดูเฉพาะใบที่ปิดแล้ว)');
      }
      setResults(rows);
      if (q && rows.length === 1 && rows[0].prod_no === q) setSel(rows[0]);   // สแกนตรงเป๊ะใบเดียว → เปิดเลย
      return rows;
    } catch { setResults([]); return []; }
    finally { setSearching(false); }
  }, [search, from, to, inScope, includeOpen]);

  // deep-link ?prod= — รอ lines โหลด (scope) ก่อน
  useEffect(() => {
    const p = searchParams.get('prod');
    if (!p || !lines.length) return;
    setSearch(p);
    doSearch(p).then(rows => {
      const hit = rows.find(o => o.prod_no === p) || rows[0];
      if (hit) setSel(hit);
    });
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length]);

  /* ── โหลด bundle สอบกลับของใบที่เลือก ── */
  useEffect(() => {
    if (!sel) { setTrace(null); return; }
    setClaimFm(''); setClaimNote('');   // เปลี่ยนใบ = ล้างอาการที่กรอกไว้ กันหลักฐานของใบเก่าค้าง
    let alive = true;
    (async () => {
      setLoading(true);
      const sess = sel.production_sessions;
      const famNames = getLineFamilyNames(lines, sess.line_name);
      const famLower = famNames.map(n => n.toLowerCase());
      const famIds = lines.filter(l => famLower.includes(l.name.toLowerCase())).map(l => l.id);
      const t = { qtyUpdates: [], defects: [], sessionOrders: [], downtimes: [], mos: [], people: [], stations: {}, fourM: [], childLots: [], rawReqs: [], stockIn: [], stockOut: [], lpa: [], poka: [], dailyPm: null,
        reqsByStation: {}, skillsByEmp: {}, homeByEmp: {}, product: null, prevSession: null, machineMos: [], ojtByEmp: {},
        equip: null, amTargetJigs: new Set(), amDoneJigs: new Set(), pe: null };

      // DR — ของใบ/กะ
      const [qu, df, so, dt] = await Promise.all([
        supabaseDR.from('prod_order_qty_updates').select('qty_accum, qty_delta, is_final, logged_at, logged_by').eq('order_id', sel.id).order('logged_at'),
        supabaseDR.from('defect_logs').select('qty_ng, qty_suspect, qty_repair, description, reported_by_name, logged_at, prod_order_id, dr_defect_types(name_th)').eq('session_id', sess.id).order('logged_at'),
        supabaseDR.from('prod_orders').select('id, prod_no, mat_no, part_name, status, qty, qty_target, qty_actual, qty_ok, opened_at, confirmed_at').eq('session_id', sess.id).order('opened_at'),
        supabaseDR.from('downtime_logs').select('id, machine_no, description, duration_min, started_at, ended_at, carry_over, dr_downtime_types(name_th, category)').eq('session_id', sess.id).order('started_at'),
      ]);
      t.qtyUpdates = qu.data || []; t.defects = df.data || []; t.sessionOrders = so.data || []; t.downtimes = dt.data || [];

      // ใบซ่อม MO ที่เปิดจาก downtime ของกะนี้ (best-effort)
      try {
        const dtIds = t.downtimes.map(d => d.id);
        if (dtIds.length) {
          const { data } = await supabaseDR.from('mtn_orders')
            .select('source_downtime_id, mo_no, status, mtn_dept, problem_detail, root_cause, solution, assigned_to')
            .in('source_downtime_id', dtIds);
          t.mos = data || [];
        }
      } catch { /* ตารางไม่พร้อม */ }

      // วัสดุ: ล็อต child ที่ใบนี้ trigger → ใบเบิก raw (เชื่อมเชิงเวลา — ดูหมายเหตุ gap ใน UI)
      try {
        const { data: cl } = await supabaseDR.from('child_lot_requests')
          .select('id, child_mat_no, part_name, source_line, lot_qty, status, work_date, created_at')
          .eq('source_prod_no', sel.prod_no);
        t.childLots = cl || [];
        if (t.childLots.length) {
          const { data: rw } = await supabaseDR.from('raw_withdrawal_requests')
            .select('lot_request_id, raw_mat_no, part_name, qty, status, created_at')
            .in('lot_request_id', t.childLots.map(c => c.id));
          t.rawReqs = rw || [];
        }
      } catch { /* ignore */ }

      // stock: ขาเข้าคลัง (hard link ref_order_id) + ขาตัดส่งของ mat เดียวกันหลังปิดใบ
      // ⚠️ 2 ขาความแน่นอนไม่เท่ากัน — ห้ามแสดงปนกันจนดูเท่ากัน:
      //   ขาเข้า  = ผูกใบผลิตใบนี้ตรงๆ (ref_order_id) → แน่นอน
      //   ขาออก  = ยังผูก "ใบผลิต → รอบส่ง" ไม่ได้ (GAP #1 ที่เหลืออยู่) จึงยังเดาจาก mat + ช่วงเวลา
      //            แต่ตั้งแต่ 2026-08-11 แถวตัดส่งผูก ref_shipment_id แล้ว → บอกได้ว่าเป็น "รอบส่งใบไหน"
      //            (รู้ปลายทางแน่นอน · ส่วนที่ยังเดาคือของจากใบผลิตนี้ไปออกรอบนั้นจริงไหม)
      {
        const { data: si, error: eIn } = await supabaseDR.from('line_stock_transactions')
          .select('line_name, qty, type, note, created_by, created_at').eq('ref_order_id', sel.id).order('created_at');
        if (eIn) console.warn('[OrderTrace] stockIn:', eIn.message);
        t.stockIn = si || [];
        if (sel.confirmed_at) {
          const cols = 'line_name, qty, type, note, created_by, created_at, ref_shipment_id, customer_shipping_orders(order_no, customer, due_date, ship_time, qty, shipped_by)';
          let { data: sc, error: eOut } = await supabaseDR.from('line_stock_transactions')
            .select(cols).eq('mat_no', sel.mat_no).eq('type', 'consume')
            .gte('created_at', sel.confirmed_at).order('created_at').limit(12);
          if (eOut) {
            // ยังไม่ apply migration 20260811 → ถอยไปคอลัมน์เดิม (เห็นการตัดส่งเหมือนก่อน แค่ไม่รู้ว่ารอบไหน)
            ({ data: sc } = await supabaseDR.from('line_stock_transactions')
              .select('line_name, qty, type, note, created_by, created_at')
              .eq('mat_no', sel.mat_no).eq('type', 'consume')
              .gte('created_at', sel.confirmed_at).order('created_at').limit(12));
            t.stockOutNoLink = true;
          }
          // ผูกรอบส่งแล้ว = เอาแน่ · ไม่มี link ค่อยถอยไปดูข้อความ note (แถวเก่าก่อน 2026-08-11)
          // ห้ามกรองด้วย note อย่างเดียว — แก้ข้อความในโค้ดเมื่อไหร่ แถวใหม่จะหายจากสายสอบกลับเงียบๆ
          t.stockOut = (sc || []).filter(x => x.ref_shipment_id || (x.note || '').includes('ส่งลูกค้า'));
        }
      }

      // Main — คน/4M/การตรวจ ของไลน์+วันนั้น (ทุกก้อน best-effort)
      try {
        // คน + สกิลปัจจุบัน (⚠️ ไม่มี history — คะแนน ณ วันนี้ ไม่ใช่ ณ วันผลิต) + จุดงาน + เกณฑ์สกิลต่อจุด
        const [emp, ws] = await Promise.all([
          supabase.from('employees').select('id, name, employee_id_code, team, position, employee_skills(skill_name, score)').in('line_id', famIds).eq('is_active', true),
          supabase.from('workstations').select('id, station_name, station_requirements(skill_name, min_score)').in('line_id', famIds),
        ]);
        const wsAll = ws.data || [];
        t.stations = Object.fromEntries(wsAll.map(w => [String(w.id), w.station_name]));
        t.reqsByStation = Object.fromEntries(wsAll.map(w => [String(w.id), w.station_requirements || []]));
        t.skillsByEmp = Object.fromEntries((emp.data || []).map(e => [e.id, Object.fromEntries((e.employee_skills || []).map(s => [s.skill_name, s.score]))]));
        const empIds = (emp.data || []).map(e => e.id);
        if (empIds.length) {
          const [{ data: logs }, hp] = await Promise.all([
            supabase.from('daily_production_logs')
              .select('employee_id, is_present, has_helmet, has_boots, has_gloves, assigned_line, shift, has_ot, leave_type, remark')
              .eq('work_date', sess.work_date).in('employee_id', empIds),
            supabase.from('employee_home_positions').select('employee_id, station_id').in('employee_id', empIds),
          ]);
          t.homeByEmp = Object.fromEntries((hp.data || []).map(h => [h.employee_id, String(h.station_id)]));
          const empBy = Object.fromEntries((emp.data || []).map(e => [e.id, e]));
          t.people = (logs || []).filter(l => !l.shift || l.shift === sess.shift || sess.shift == null)
            .map(l => ({ ...l, emp: empBy[l.employee_id] })).filter(p => p.emp);
          // จุดงานข้ามไลน์ (assigned ไปจุดนอก family) — โหลดชื่อ+เกณฑ์เพิ่มเฉพาะ id ที่ยังไม่รู้จัก
          const missing = [...new Set(t.people.map(p => p.assigned_line).filter(id => id && !t.stations[String(id)]))];
          if (missing.length) {
            const { data: ws2 } = await supabase.from('workstations').select('id, station_name, line_name, station_requirements(skill_name, min_score)').in('id', missing);
            (ws2 || []).forEach(w => {
              t.stations[String(w.id)] = `${w.station_name}${w.line_name ? ` (${w.line_name})` : ''}`;
              t.reqsByStation[String(w.id)] = w.station_requirements || [];
            });
          }
          // อบรม OJT วันนั้นของคนกลุ่มนี้ (best-effort)
          try {
            const { data: oj } = await supabase.from('ojt_training_attendees')
              .select('employee_id, ojt_trainings!inner(topic, train_date)')
              .in('employee_id', empIds).eq('ojt_trainings.train_date', sess.work_date);
            (oj || []).forEach(r => { t.ojtByEmp[r.employee_id] = r.ojt_trainings?.topic || 'OJT'; });
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      try {
        const { data: fm } = await supabase.from('four_m_logs')
          .select('category, change_subtype, description, status, created_at, work_date')
          .in('line_name', famNames).eq('work_date', sess.work_date).order('created_at');
        t.fourM = fm || [];
      } catch { /* ignore */ }
      try {
        const { data: lp } = await supabase.from('lpa_audits')
          .select('layer, station, auditor_name, shift, created_at')
          .in('line_name', famNames).eq('audit_date', sess.work_date);
        t.lpa = lp || [];
      } catch { /* ignore */ }
      try {
        const { data: dev } = await supabase.from('pokayoke_devices').select('id, name, station').in('line_name', famNames);
        if (dev?.length) {
          const { data: pc } = await supabase.from('pokayoke_checks')
            .select('device_id, result, detected, checker_name, shift')
            .eq('check_date', sess.work_date).in('device_id', dev.map(d => d.id));
          const devBy = Object.fromEntries(dev.map(d => [d.id, d]));
          t.poka = (pc || []).map(c => ({ ...c, dev: devBy[c.device_id] }));
        }
      } catch { /* ignore */ }
      // Daily PM (AM) ของไลน์วันนั้น — นับเช็คเสร็จ/ทั้งหมด
      try {
        const { data: tg } = await supabaseDR.from('pm_daily_line_targets').select('jig_id').in('line_name', famNames).eq('is_active', true);
        const jigIds = [...new Set((tg || []).map(x => x.jig_id))];
        if (jigIds.length) {
          const dayStart = `${sess.work_date}T00:00:00+07:00`;
          const dayEnd = `${addDays(sess.work_date, 1)}T08:00:00+07:00`;
          // ⚠️ "ตรวจ AM แล้ว" = การตรวจของ **ฝ่ายผลิต** เท่านั้น — ถ้าไม่กรอง department
          //    วันที่ช่าง JIG MTN เข้า PM เครื่องนั้น จะถูกนับว่าผลิตตรวจ AM แล้วทั้งที่ยังไม่ได้ตรวจ
          //    (หลักเดียวกับ prodIds ใน src/lib/pmDailyAlarm.js)
          const { data: amCls } = await supabaseDR.from('checklists')
            .select('id, equipment_id').in('equipment_id', jigIds).eq('module', 'mtn').eq('department', 'production');
          const amClIds = new Set((amCls || []).map(c => c.id));
          const { data: inspRaw } = await supabaseDR.from('inspections')
            .select('jig_id, checklist_id, status, inspected_at').in('jig_id', jigIds)
            .gte('inspected_at', dayStart).lt('inspected_at', dayEnd);
          const insp = (inspRaw || []).filter(i => !amClIds.size || amClIds.has(i.checklist_id));
          t.dailyPm = { total: jigIds.length, done: new Set(insp.map(i => i.jig_id)).size, fail: insp.filter(i => i.status === 'fail' || i.status === 'ng').length };
          // เก็บระดับ jig ไว้ให้แผงอุปกรณ์ชี้ได้ว่า "เครื่องตัวนี้" วันนั้นตรวจ AM แล้วหรือยัง
          t.amTargetJigs = new Set(jigIds);
          t.amDoneJigs = new Set(insp.map(i => i.jig_id));
        }
      } catch { /* ignore */ }

      // CT มาตรฐาน — ของชิ้นงานใบนี้ + ทุก MAT ในกะ (กลุ่มใบที่วิ่งพร้อมกันมีหลายชิ้นงานได้
      // → เทียบความเร็วแบบถ่วงน้ำหนัก Σ(qty×CT) ÷ เวลาเดินจริง ตามสูตร P ของ OEE)
      try {
        const mats = [...new Set([sel.mat_no, ...(t.sessionOrders || []).map(o => o.mat_no)].filter(Boolean))];
        const { data: pr } = await supabaseDR.from('dr_products')
          .select('mat_no, cycle_time_sec, process_type, pair_mat_no, line_name').in('mat_no', mats);
        t.product = (pr || []).find(p => p.mat_no === sel.mat_no) || null;
        t.ctByMat = Object.fromEntries((pr || []).filter(p => p.cycle_time_sec > 0).map(p => [p.mat_no, Number(p.cycle_time_sec)]));
      } catch { /* ignore */ }
      // กะก่อนหน้าของไลน์ (บริบท: เข้ากะนี้มาด้วยสภาพยังไง)
      try {
        const { data: ps } = await supabaseDR.from('production_sessions')
          .select('id, work_date, shift, status, oee, oee_a, oee_p, oee_q, closed_by_name')
          .eq('line_name', sess.line_name).lte('work_date', sess.work_date)
          .order('work_date', { ascending: false }).limit(6);
        const rank = s => `${s.work_date}~${s.shift === 'night' ? 1 : 0}`;
        const cur = rank(sess);
        t.prevSession = (ps || []).filter(s => s.id !== sess.id && rank(s) < cur).sort((a, b) => rank(b).localeCompare(rank(a)))[0] || null;
      } catch { /* ignore */ }
      // ประวัติใบซ่อมของเครื่องที่ใบนี้ใช้ — ย้อน 30 วันก่อนเปิดใบ (เครื่องนี้ป่วยเรื้อรังมาก่อนไหม)
      try {
        if (sel.machine_no && sel.opened_at) {
          const d30 = new Date(new Date(sel.opened_at).getTime() - 30 * 86400000).toISOString();
          const { data: mh } = await supabaseDR.from('mtn_orders')
            .select('mo_no, status, problem_detail, solution, created_at')
            .eq('machine_no', sel.machine_no).gte('created_at', d30).lte('created_at', sel.opened_at)
            .order('created_at', { ascending: false }).limit(5);
          t.machineMos = mh || [];
        }
      } catch { /* ignore */ }

      /* ── 🏭 อุปกรณ์ที่ใช้ผลิต + สภาพบำรุงรักษา "ณ เวลาที่ผลิตใบนี้" (2026-08-11) ──────────
         โจทย์คุณภาพ: ของใบนี้เสีย → เครื่อง/แม่พิมพ์ตัวไหนผลิต · ตอนนั้นขาด PM ไหม · ใครแตะอะไรไปล่าสุด
         ⚠️ ความแน่ชัดของ "ใช้เครื่องไหน" มี 2 ระดับ — ห้ามนำเสนอปนกัน:
            🎯 ยืนยัน = prod_orders.machine_no (ไลน์ flow_mode=parallel_machine ที่เลือกเครื่องตอนเปิดใบ)
            ⚙️ สงสัย  = เครื่องที่ลงทะเบียนในครอบครัวไลน์ (ระบบไม่รู้ว่าใบนี้วิ่งตัวไหนจริง)
         ⚠️ ทุกอย่างตัดที่ "เวลาผลิต" ไม่ใช่ "ตอนนี้" — PM ที่เพิ่งทำหลังผลิตไม่ช่วยใบที่เสียไปแล้ว */
      try {
        const prodAt = sel.opened_at || `${sess.work_date}T08:00:00+07:00`;
        const ago = d => new Date(new Date(prodAt).getTime() - d * 86400000).toISOString();

        // เครื่องจักรของครอบครัวไลน์ (เฉพาะเครื่องผลิต — facility/utility ไม่เกี่ยวกับใบนี้)
        /* ⚠️ "ใบหนึ่งใช้เครื่องกี่ตัว" ขึ้นกับ flow_mode ของไลน์ — ห้ามเหมาว่าเป็นผู้ต้องสงสัยเสมอ
           one_piece_flow (ดีฟอลต์ · ไลน์ full automation) = งานไหลผ่าน **ทุกเครื่องตามลำดับ step**
             → ทุกเครื่อง "ถูกใช้ผลิตใบนี้จริง" ไม่ใช่การเดา
           parallel_machine = เครื่อง stand-alone ตัวใครตัวมัน → ใบระบุ machine_no = ยืนยันตัวนั้น
             ไม่ระบุ = ผู้ต้องสงสัย (เฉพาะกรณีนี้เท่านั้นที่ระบบไม่รู้จริง) */
        const lineRow = lines.find(l => l.name === sess.line_name) || null;
        const isParallel = isParallelLine(lineRow?.flow_mode);
        const mcBase = 'id, machine_no, machine_name, line_name, is_active, sort_order';
        let mr = await supabaseDR.from('machines').select(`${mcBase}, equipment_category`).in('line_name', famNames);
        if (mr.error) mr = await supabaseDR.from('machines').select(mcBase).in('line_name', famNames);
        const mcs = (mr.data || []).filter(m => m.is_active !== false && (m.equipment_category ?? 'production') === 'production');
        const mcIds = mcs.map(m => m.id);
        const mcNos = [...new Set(mcs.map(m => m.machine_no).filter(Boolean))];

        // jigs = ทะเบียน "อุปกรณ์ที่มีแผน PM" (ชื่อตารางหลอกตา) → แถวเงาของเครื่อง + จิ๊ก/แม่พิมพ์ตัวจริง
        const jSel = 'id, jig_no, name, machine_id, equipment_type, line_name';
        const [shadowR, realR] = await Promise.all([
          mcIds.length ? supabaseDR.from('jigs').select(jSel).in('machine_id', mcIds) : Promise.resolve({ data: [] }),
          supabaseDR.from('jigs').select(jSel).in('line_name', famNames).is('machine_id', null),
        ]);
        const jigErr = shadowR.error || realR.error;
        if (jigErr) console.warn('[trace] jigs', jigErr);
        const shadowByMc = {}; (shadowR.data || []).forEach(j => { if (j.machine_id) shadowByMc[j.machine_id] = j; });
        const realJigs = (realR.data || []).filter(j => (j.equipment_type || '') !== 'machine');
        const jigIds = [...(shadowR.data || []).map(j => j.id), ...realJigs.map(j => j.id)];

        // แผน PM ต่ออุปกรณ์: jig → checklists (1 เครื่องมีได้หลายทีม) → pm_plans
        // ⚠️ query ชุดนี้ "ไม่พบข้อมูล" กับ "โหลดไม่สำเร็จ" ต้องแยกกันให้ออก — supabase-js คืน { error }
        //    ไม่ throw · ถ้ากลืนทิ้ง แผงจะสรุปว่า "ไม่มีประวัติบำรุงรักษา" ทั้งที่แค่โหลดไม่ติด
        let partial = !!jigErr || !!mr.error;
        const plansByJig = {};
        let clList = [];
        if (jigIds.length) {
          const { data: cls, error: clsErr } = await supabaseDR.from('checklists')
            .select('id, equipment_id, department').in('equipment_id', jigIds).eq('module', 'mtn');
          if (clsErr) { partial = true; console.warn('[trace] checklists', clsErr); }
          clList = cls || [];
          const jigOfCl = Object.fromEntries(clList.map(c => [c.id, c.equipment_id]));
          const deptOfCl = Object.fromEntries(clList.map(c => [c.id, c.department]));
          const clIds = clList.map(c => c.id);
          if (clIds.length) {
            const { data: pls, error: plsErr } = await supabaseDR.from('pm_plans')
              .select('checklist_id, plan_type, interval_days, next_due_date, last_done_at, is_active').in('checklist_id', clIds);
            if (plsErr) { partial = true; console.warn('[trace] pm_plans', plsErr); }
            (pls || []).filter(p => p.is_active !== false).forEach(p => {
              const jid = jigOfCl[p.checklist_id]; if (!jid) return;
              (plansByJig[jid] ||= []).push({ ...p, dept: deptOfCl[p.checklist_id] });
            });
          }
        }

        /* ประวัติ "ตรวจ/PM" ก่อนเวลาผลิต — ดึง **ครั้งล่าสุดต่อ checklist** ทีละใบ
           ⚠️ ห้ามกวาดรวมทุก jig แล้ว `.limit(N)`: AM ตรวจทุกต้นกะ ย้อน 180 วันทะลุพันแถวง่ายๆ
              → ประวัติ PM ช่างรายไตรมาส (ตัวที่เราอยากสอบพอดี) ถูกเบียดตกไปก่อน แล้วแผงจะ
              พูดผิดว่า "ไม่พบประวัติการตรวจ" + กลบ PM ที่ค้างจริงให้กลายเป็น "อยู่ในรอบ"
              ซึ่งขัดกฎเหล็กข้อ 2 ของแผงนี้เอง · จำนวน checklist อยู่ระดับหลักสิบ ยิงขนานได้ */
        const inspByJig = {}, inspByCl = {};
        await Promise.all(clList.map(async c => {
          const { data, error } = await supabaseDR.from('inspections')
            .select('jig_id, checklist_id, inspector_id, inspected_at, status, notes')
            .eq('checklist_id', c.id).lte('inspected_at', prodAt)
            .order('inspected_at', { ascending: false }).limit(1);
          if (error) { partial = true; console.warn('[trace] inspections', error); return; }
          const row = (data || [])[0]; if (!row) return;
          inspByCl[c.id] = row;
          (inspByJig[row.jig_id] ||= []).push(row);
        }));
        Object.values(inspByJig).forEach(a => a.sort((x, y) => String(y.inspected_at).localeCompare(String(x.inspected_at))));

        // ประวัติ "ใบซ่อม MO" ก่อนเวลาผลิต — เพิ่งซ่อมเสร็จก่อนผลิต = ต้องสงสัยลำดับต้นๆ ของปัญหาคุณภาพ
        const moByMc = {};
        const MO_LIMIT = 300;
        if (mcNos.length) {
          const { data: mo, error: moErr } = await supabaseDR.from('mtn_orders')
            .select('mo_no, machine_no, status, mtn_dept, problem_detail, root_cause, solution, assigned_to, reported_by_name, created_at, repair_done_at')
            .in('machine_no', mcNos).gte('created_at', ago(90)).lte('created_at', prodAt)
            .order('created_at', { ascending: false }).limit(MO_LIMIT);
          if (moErr) { partial = true; console.warn('[trace] mtn_orders', moErr); }
          if ((mo || []).length === MO_LIMIT) partial = true;   // ชนเพดาน = เห็นไม่ครบ ต้องบอก
          (mo || []).forEach(m => { (moByMc[m.machine_no] ||= []).push(m); });
        }

        // ใครแก้ "ทะเบียนอุปกรณ์" ก่อนหน้านั้น (audit_log กลาง — best-effort ยังไม่ apply ก็ไม่พัง)
        const auditByRow = {};
        try {
          const AU_LIMIT = 200;
          const { data: au } = await supabaseDR.from('audit_log')
            .select('table_name, row_pk, action, actor, changed_fields, changed_at')
            .in('table_name', ['machines', 'jigs']).in('row_pk', [...mcIds, ...jigIds])
            .gte('changed_at', ago(90)).lte('changed_at', prodAt)
            .order('changed_at', { ascending: false }).limit(AU_LIMIT);
          if ((au || []).length === AU_LIMIT) partial = true;
          (au || []).forEach(a => { (auditByRow[a.row_pk] ||= []).push(a); });
        } catch { /* audit ยังไม่พร้อม */ }

        // ชื่อผู้ตรวจอยู่ profiles ฝั่ง Main (คนละ project — join ตรงไม่ได้ ต้องดึงแยก)
        const inspIds = [...new Set(Object.values(inspByJig).flat().map(i => i.inspector_id).filter(Boolean))];
        let profName = {};
        if (inspIds.length) {
          try {
            const { data: pf } = await supabase.from('profiles').select('id, full_name, email').in('id', inspIds);
            profName = Object.fromEntries((pf || []).map(p => [p.id, p.full_name || p.email]));
          } catch { /* ignore */ }
        }

        const dtByMc = {};
        t.downtimes.forEach(d => { if (d.machine_no) (dtByMc[d.machine_no] ||= []).push(d); });

        const dayDiff = (a, b) => Math.floor((new Date(a) - new Date(b)) / 86400000);
        const build = (kind, id, label, name, machineNo, jig, sortOrder = null) => {
          const plans = jig ? (plansByJig[jig.id] || []) : [];
          const insps = jig ? (inspByJig[jig.id] || []) : [];
          /* ⚠️ `pm_plans.next_due_date` เป็น "สถานะปัจจุบัน" ไม่ใช่ประวัติ — ช่างทำ PM หลังวันผลิต
             ค่านี้ก็ขยับไปข้างหน้าแล้ว ใบเก่าจะดูเหมือน PM ปกติทั้งที่ตอนนั้นค้างจริง
             → "ค้าง ณ วันผลิต" ต้องคำนวณย้อนจากประวัติจริง: ตรวจครั้งล่าสุดก่อนผลิต + interval_days
             (แผนแบบ usage/hybrid ย้อนไม่ได้ — ไม่เดา ปล่อยเป็นไม่ทราบ แล้วโชว์ค่าปัจจุบันโดยติดป้ายกำกับ) */
          let overdue = 0, dueAtProd = null, nextDue = null, planDept = null, usageOnly = false;
          plans.forEach(p => {
            if (!nextDue || (p.next_due_date && p.next_due_date < nextDue)) { nextDue = p.next_due_date || nextDue; planDept = p.dept || planDept; }
            if (p.plan_type && p.plan_type !== 'time') { usageOnly = true; return; }
            if (!p.interval_days) return;
            const prev = inspByCl[p.checklist_id];   // ครั้งล่าสุดของ "แผนนั้น" โดยตรง
            if (!prev) return;  // ไม่มีประวัติ = พิสูจน์ไม่ได้ ห้ามนับว่าค้าง
            const due = new Date(new Date(prev.inspected_at).getTime() + p.interval_days * 86400000);
            // เทียบระดับ "วัน" ตามเวลาไทย — ใช้ ISO ดิบจะคลาด 1 วันเมื่อครบกำหนดช่วงค่ำ (UTC ข้ามวันก่อน)
            const dueDay = due.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
            const late = dayDiff(`${sess.work_date}T00:00:00+07:00`, `${dueDay}T00:00:00+07:00`);
            if (late > overdue) { overdue = late; dueAtProd = dueDay; }
          });
          // มีแผน PM แต่ไม่พบร่องรอยการตรวจก่อนวันผลิตเลย = สัญญาณที่ต้องเห็น ไม่ใช่ช่องว่าง
          const neverInspected = plans.length > 0 && insps.length === 0;
          const lastPlanDone = plans.map(p => p.last_done_at).filter(Boolean).sort().pop() || null;
          const lastInsp = insps[0] || null;
          const mos = machineNo ? (moByMc[machineNo] || []) : [];
          /* ⚠️ ต้องกรอง repair_done_at ด้วย — query กรองแค่ created_at ≤ เวลาผลิต
             ใบที่ "แจ้งก่อนผลิต แต่ช่างซ่อมเสร็จหลังผลิต" (เคสธรรมดามาก) จะได้ค่าติดลบ
             แล้วไปโผล่เป็น "🟠 ซ่อมเสร็จ -5 วันก่อนผลิต" + ดัน risk ขึ้นผิดตัว
             และเรียงด้วย repair_done_at ไม่ใช่ created_at (ใบที่แจ้งทีหลังอาจซ่อมเสร็จก่อน) */
          const lastFixed = mos.filter(m => m.repair_done_at && m.repair_done_at <= prodAt)
            .sort((a, b) => String(b.repair_done_at).localeCompare(String(a.repair_done_at)))[0] || null;
          const daysSinceFix = lastFixed ? dayDiff(prodAt, lastFixed.repair_done_at) : null;
          const dts = machineNo ? (dtByMc[machineNo] || []) : [];
          const audits = [...(auditByRow[id] || []), ...(jig ? (auditByRow[jig.id] || []) : [])]
            .sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)));
          /* usage: ใบนี้ "ใช้" อุปกรณ์ตัวนี้จริงแค่ไหน
             confirmed = ใบระบุเครื่องตัวนี้ตรงๆ · flow = ไลน์ไหลทีละชิ้น ผ่านทุกเครื่องแน่นอน
             suspect   = ไลน์เครื่องขนานแต่ใบไม่ได้ระบุ → ระบบไม่รู้ว่าวิ่งตัวไหน */
          const confirmed = !!(machineNo && sel.machine_no && machineNo === sel.machine_no);
          const usage = confirmed ? 'confirmed'
            : (kind === 'machine' && !isParallel) ? 'flow'
            : (kind === 'machine' && isParallel) ? 'suspect' : 'line';
          // เรียงตาม "ควรสงสัยก่อน": ยืนยันตัวจริง → PM ค้าง → เพิ่งซ่อม ≤7 วัน → มี DT ในกะนี้
          const risk = (confirmed ? 100 : 0) + (overdue > 0 ? 40 : 0)
            + (daysSinceFix != null && daysSinceFix <= 7 ? 30 : 0) + (neverInspected ? 20 : 0) + (dts.length ? 10 : 0)
            + (jig && !plans.length ? 5 : 0);
          return { kind, id, label, name, machineNo, jigId: jig?.id || null, hasPmPlan: plans.length > 0, usage, sortOrder,
            overdue, dueAtProd, neverInspected, usageOnly, nextDue, planDept, lastPlanDone, lastInsp, insps, mos, lastFixed, daysSinceFix, dts, audits, confirmed, risk,
            amTarget: jig ? t.amTargetJigs?.has(jig.id) : false, amDone: jig ? t.amDoneJigs?.has(jig.id) : false,
            inspName: lastInsp ? (profName[lastInsp.inspector_id] || 'ไม่ทราบชื่อ') : null };
        };

        /* ลำดับ step ของไลน์ไหลทีละชิ้น — เรียงตาม sort_order ในทะเบียนเครื่อง
           ⚠️ ถ้า sort_order เท่ากันหมด (ไม่เคยตั้ง) = ไม่รู้ลำดับจริง → ห้ามเดาเลขขั้นให้ */
        const ordered = [...mcs].sort((a, b) =>
          String(a.line_name || '').localeCompare(String(b.line_name || ''))
          || (a.sort_order ?? 0) - (b.sort_order ?? 0)
          || String(a.machine_no || '').localeCompare(String(b.machine_no || '')));
        const hasStepOrder = new Set(mcs.map(m => m.sort_order ?? 0)).size > 1;
        const stepOf = {}; ordered.forEach((m, i) => { stepOf[m.id] = i + 1; });

        const rows = [
          ...mcs.map(m => build('machine', m.id, m.machine_no || '(ไม่มีเลข)', m.machine_name, m.machine_no, shadowByMc[m.id], hasStepOrder ? stepOf[m.id] : null)),
          ...realJigs.map(j => build(j.equipment_type === 'die' ? 'die' : 'jig', j.id, j.jig_no || j.name || '(ไม่มีเลข)', j.name, null, j)),
        ].sort((a, b) => b.risk - a.risk
          || (a.sortOrder ?? 999) - (b.sortOrder ?? 999)
          || String(a.label).localeCompare(String(b.label)));

        t.equip = {
          rows,
          confirmedNo: sel.machine_no || null,
          isParallel, hasStepOrder,
          partial,   // โหลดบางส่วนไม่สำเร็จ/ชนเพดาน → ห้ามให้ "ไม่มีประวัติ" ฟังดูเป็นข้อเท็จจริง
          machineCount: mcs.length,
          dieCount: realJigs.length,
          overdueCount: rows.filter(r => r.overdue > 0).length,
          freshFixCount: rows.filter(r => r.daysSinceFix != null && r.daysSinceFix <= 7).length,
          noPlanCount: rows.filter(r => !r.hasPmPlan).length,
        };
      } catch (e) { console.warn('[trace] โหลดข้อมูลอุปกรณ์ไม่สำเร็จ', e); }

      /* ── เอกสารออกแบบของพาร์ทนี้ (PE Core Tools · Main) ──────────────────────────
         ใช้เป็น "รายการอาการที่เคยคาดไว้" ให้ผู้ใช้เลือก แทนการเดาจากข้อความล้วน
         ⚠️ ต้องผูกกับพาร์ท/ไลน์ของใบนี้ ห้ามดึงรวมทั้งระบบ (จะได้ FMEA ของพาร์ทอื่น)
         จับคู่ mat_no ก่อน แล้ว fallback ชื่อไลน์ — pe_doc_sets.mat_no ยังว่างได้ในข้อมูลจริง */
      try {
        const nz = x => (x || '').trim().toLowerCase();
        const { data: sets } = await supabase.from('pe_doc_sets')
          .select('id, part_no, mat_no, part_name, line_name').limit(500);
        const set = (sets || []).find(s => s.mat_no && nz(s.mat_no) === nz(sel.mat_no))
          || (sets || []).find(s => nz(s.line_name) === nz(sess.line_name)) || null;
        if (set) {
          const { data: procs } = await supabase.from('pe_processes')
            .select('id, op_no, seq, name, kind, machine_no, child_parts, special_class')
            .eq('set_id', set.id).order('seq');
          const pids = (procs || []).map(p => p.id);
          const [fm, cp] = pids.length ? await Promise.all([
            supabase.from('pe_fmea_items')
              .select('id, process_id, seq, failure_mode, effects, severity, occurrence, detection, causes, prevention, detection_ctrl, recommended_action, action_taken')
              .in('process_id', pids),
            supabase.from('pe_cp_items')
              .select('id, process_id, seq, product_char, process_char, special_class, spec, method, sample_size, frequency, control_method, reaction_plan')
              .in('process_id', pids),
          ]) : [{ data: [] }, { data: [] }];
          t.pe = { set, procs: procs || [], fmea: fm?.data || [], cp: cp?.data || [] };
        } else {
          t.pe = { set: null, procs: [], fmea: [], cp: [], totalSets: (sets || []).length };
        }
      } catch (e) { console.warn('[trace] โหลดเอกสาร PE ไม่สำเร็จ', e); }

      if (alive) { setTrace(t); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [sel, lines]);

  /* ── ตรวจ "สแกนเป็นชุด" จากข้อมูลจริง ไม่ใช้เวลาตายตัว (2026-08-05 · คำสั่ง user) ────────
     เกณฑ์เชิงกายภาพ: ใบ 2 ใบที่สแกนห่างกัน **น้อยกว่าเวลาที่ต้องใช้ผลิตของใบนั้น** (qty × CT)
       = ช่วงนั้นผลิตไม่ทัน → ต้องเป็นการสแกนรวบ ไม่ใช่ทยอยสแกนตามจริง
     • ต่อกันเป็นลูกโซ่ → เคส "สแกน 3 ใบ → เข้าห้องน้ำ 5 นาที → สแกนต่อ 2 ใบ" ยังเป็นชุดเดียว
       เพราะ 5 นาที < เวลาผลิตจริงของใบ (35 ชิ้น × 58 วิ ≈ 34 นาที) — เกณฑ์ปรับตามของจริงเอง
     • ไม่ได้ตั้ง CT → ใช้อัตราจริงเฉลี่ยของกะนั้นแทน (ช่วงเวลา ÷ ยอดรวม)
     • ไม่มีทั้ง CT และข้อมูลกะ (เช่นใบเดียวโดดๆ) ค่อยถอยไปค่าคงที่ FALLBACK_BATCH_SEC  */
  const scanBatch = useMemo(() => {
    const empty = { open: { members: [], maxGapSec: null }, close: { members: [], maxGapSec: null }, needSec: null, needFrom: null };
    if (!sel || !trace) return empty;
    const sess = trace.sessionOrders || [];
    const ctMap = trace.ctByMat || {};
    /* จำนวนที่ใช้ประเมิน "งานชิ้นนี้กินเวลาเท่าไหร่"
       • ใบปิดแล้ว → ยอดที่ผลิตได้จริง · ใบที่ยังเปิด → เป้าของใบ (ยอดสะสมยังเป็น 0 ใช้ประเมินไม่ได้)
       ⚠️ ห้ามใช้ `qty_ok ?? qty_actual ?? qty` ตรงๆ — ใบเปิดที่ qty_actual = 0 จะได้ 0
          ทำให้ "เวลาที่ต้องใช้ผลิต" = 0 แล้วตัดกลุ่มผิด (เจอจริงที่ SUB APRON 05/08) */
    const qtyOf = (o) => {
      const v = o.confirmed_at ? (o.qty_ok ?? o.qty_actual ?? o.qty) : (o.qty_target ?? o.qty);
      return Number(v) || 0;
    };

    // อัตราจริงเฉลี่ยของกะ (fallback เมื่อชิ้นงานยังไม่ตั้ง CT)
    let sessSecPerPc = null;
    const done = sess.filter(o => o.opened_at && o.confirmed_at && qtyOf(o) > 0);
    if (done.length) {
      const s = Math.min(...done.map(o => new Date(o.opened_at).getTime()));
      const e = Math.max(...done.map(o => new Date(o.confirmed_at).getTime()));
      const q = done.reduce((a, o) => a + qtyOf(o), 0);
      if (e > s && q > 0) sessSecPerPc = (e - s) / 1000 / q;
    }
    /* เวลาที่ "ต้องใช้ผลิต" ของใบหนึ่ง (วินาที) — แต่ละ product จำนวนกับ CT ไม่เท่ากัน
       จึงคิดรายใบเสมอ ห้ามใช้ค่ากลางของไลน์ */
    const prodInfo = (o) => {
      if (!o) return null;
      const q = qtyOf(o);
      if (q <= 0) return null;                       // ไม่รู้จำนวน = ประเมินเวลาไม่ได้ → ให้ไปใช้ใบข้างเคียงแทน
      const ct = Number(ctMap[o.mat_no]) || 0;
      if (ct > 0) return { sec: q * ct, from: 'ct' };
      if (sessSecPerPc) return { sec: q * sessSecPerPc, from: 'session' };
      return null;
    };
    /* จับกลุ่มลูกโซ่ตามเวลาสแกน
       ⚠️ ต้องเทียบกับ "ใบที่กำลังผลิตอยู่ในช่วงนั้น" ให้ถูกตัว (คนละใบกันระหว่างขาเปิด/ขาปิด):
         • ขาเปิด  — ช่องว่างควรยาว = เวลาผลิตของ "ใบก่อนหน้า" (ใบที่ทำอยู่ กว่าจะเสร็จค่อยเปิดใบใหม่)
         • ขาปิด   — ช่องว่างควรยาว = เวลาผลิตของ "ใบนี้" (ใบที่เพิ่งทำเสร็จ)
       ถ้าเทียบผิดตัวจะพังเมื่อของคนละขนาด เช่น เปิดใบ 35 ชิ้น (34 นาที) แล้ว 10 นาทีต่อมา
       เปิดใบ 8 ชิ้น — เทียบกับใบ 8 ชิ้น (4 นาที) จะหลุดว่า "ไม่ใช่ชุด" ทั้งที่ใบแรกยังทำไม่เสร็จ */
    const clusterOf = (key) => {
      const isOpen = key === 'opened_at';
      const list = sess.filter(o => o[key]).sort((a, b) => new Date(a[key]) - new Date(b[key]));
      if (!list.length) return { members: [], maxGapSec: null, needSec: null, needFrom: null };
      const groups = []; let cur = [list[0]];
      for (let i = 1; i < list.length; i++) {
        const gap = (new Date(list[i][key]).getTime() - new Date(list[i - 1][key]).getTime()) / 1000;
        const ref = prodInfo(isOpen ? list[i - 1] : list[i]) || prodInfo(isOpen ? list[i] : list[i - 1]);
        const sameBatch = ref ? gap < ref.sec * BATCH_FRAC : gap <= FALLBACK_BATCH_SEC;
        if (sameBatch) cur.push(list[i]); else { groups.push(cur); cur = [list[i]]; }
      }
      groups.push(cur);
      const mine = groups.find(g => g.some(o => o.id === sel.id)) || [];
      // หลักฐานที่โชว์บนจอ: ช่องว่างที่กว้างสุดในชุด + เกณฑ์ที่ใช้กับ "คู่นั้น" (ให้ข้อความไม่ขัดกันเอง)
      let maxGapSec = null, needSec = null, needFrom = null;
      for (let i = 1; i < mine.length; i++) {
        const g = (new Date(mine[i][key]).getTime() - new Date(mine[i - 1][key]).getTime()) / 1000;
        if (maxGapSec == null || g > maxGapSec) {
          maxGapSec = g;
          const ref = prodInfo(isOpen ? mine[i - 1] : mine[i]) || prodInfo(isOpen ? mine[i] : mine[i - 1]);
          needSec = ref?.sec ?? null; needFrom = ref?.from ?? null;
        }
      }
      return { members: mine, maxGapSec, needSec, needFrom };
    };
    const open = clusterOf('opened_at'), close = clusterOf('confirmed_at');
    // หลักฐานหลักที่จะโชว์ = ชุดที่มีใบเยอะกว่า (ขาเปิด/ขาปิด)
    const evidence = [open, close].filter(c => c.members.length > 1)
      .sort((a, b) => b.members.length - a.members.length)[0] || null;
    return { open, close, evidence };
  }, [sel, trace]);

  /* ══ โฟกัสตามอาการที่ลูกค้าแจ้ง → จัดหลักฐานเป็น 3 ขาแบบ 8D ═══════════════════════
     ขา 1 Occurrence (D4) · ขา 2 Detection/Escape (D4) · ขา 3 Systemic (D7)
     ⚠️ ระบบ **เสนอจุดที่ต้องสงสัย** ไม่ได้สรุปสาเหตุ — คนเป็นคนตัดสินเสมอ
     ⚠️ ไม่เขียน DB ใดๆ (เฟส 1 อ่านอย่างเดียวเหมือนทั้งหน้า) */
  const claim = useMemo(() => {
    const pe = trace?.pe;
    if (!sel || !trace || !pe?.set) return null;
    const fm = pe.fmea.find(f => f.id === claimFm) || null;
    if (!fm && !claimNote.trim()) return null;

    const procById = Object.fromEntries(pe.procs.map(p => [p.id, p]));
    const srcProc = fm ? procById[fm.process_id] : null;

    /* กลุ่มคำจากอาการ (failure mode ที่เลือก + รายละเอียดที่พิมพ์เพิ่ม) */
    const groups = [...new Set([
      ...wordGroups(fm?.failure_mode || ''),
      ...wordGroups(claimNote),
    ].map(g => g.key))].map(k => PART_WORDS.find(g => g.key === k));

    const hitsGroups = (txt) => {
      const s = (txt || '').toLowerCase();
      return groups.length > 0 && groups.some(g => g.w.some(w => s.includes(w)));
    };

    /* จุดในกระบวนการที่เกี่ยวกับอาการนี้ — ดูจากชิ้นส่วนลูกที่ใส่ + ชื่อขั้นตอน */
    const related = pe.procs.filter(p =>
      (srcProc && p.id === srcProc.id)
      || hitsGroups(`${p.name || ''} ${p.child_parts || ''}`));
    const relIds = new Set(related.map(p => p.id));
    const relMachines = [...new Set(related.map(p => p.machine_no).filter(Boolean))];
    /* ขั้นตอนที่เป็นด่านตรวจ — ต้องเป็นตัวที่ควรจับอาการนี้ได้ */
    const inspProcs = pe.procs.filter(p => p.kind === 'inspection');

    /* FMEA ตัวอื่นที่เป็น "อาการเดียวกัน" จริงๆ (อาการเดียวเกิดได้หลาย OP)
       ⚠️ ห้ามใช้แค่ "มีคำว่านัทเหมือนกัน" — เอกสารนี้มี 45 ข้อที่มีคำว่า nut
       (Nut cold weld / Nut offset / …) ซึ่งเป็นคนละอาการ → ต้องเทียบความคล้ายของข้อความ */
    const sameMode = fm ? pe.fmea.filter(f =>
      f.id !== fm.id && noteSimilarity(f.failure_mode, fm.failure_mode) >= CLUSTER_THRESHOLD) : [];

    /* Control Plan ของจุดที่เกี่ยวข้อง + ด่านตรวจที่พูดถึงชิ้นส่วนนี้
       ⚠️ ไม่เอา CP ของ OP ตรวจทั้งหมด (มี 87 แถว ส่วนใหญ่ไม่เกี่ยวกับอาการนี้) */
    const cpRows = pe.cp.filter(c => relIds.has(c.process_id)
      || (inspProcs.some(p => p.id === c.process_id)
        && hitsGroups(`${c.product_char || ''} ${c.process_char || ''} ${c.spec || ''}`)));

    /* ── ขา 1: Occurrence — downtime ในกะที่ชี้ไปเครื่อง/อาการเดียวกัน ── */
    const dtHits = (trace.downtimes || []).filter(d =>
      (d.machine_no && relMachines.includes(d.machine_no))
      || hitsGroups(`${d.dr_downtime_types?.name_th || ''} ${d.description || ''}`));
    /* สภาพเครื่องที่เกี่ยวข้อง (ดึงจากแผงอุปกรณ์ที่โหลดไว้แล้ว) */
    const equipHits = (trace.equip?.rows || []).filter(r =>
      r.machineNo && relMachines.includes(r.machineNo));

    /* ── ขา 2: Detection — ด่านที่ควรจับได้ มีบันทึกมั้ย ── */
    const rpn = fm && fm.severity && fm.occurrence && fm.detection
      ? fm.severity * fm.occurrence * fm.detection : null;

    return {
      set: pe.set, fm, srcProc, groups, related, relMachines, inspProcs,
      sameMode, cpRows, dtHits, equipHits, rpn,
      /* อาการที่พิมพ์มา แต่ไม่มีใน FMEA เลย = ไม่เคยถูกคาดไว้ → ต้อง revise */
      notInFmea: !fm && claimNote.trim().length > 0
        && !pe.fmea.some(f => hitsGroups(f.failure_mode)),
      ngLogged: (trace.defects || []).length,
      pokaLogged: (trace.poka || []).length,
      lpaLogged: (trace.lpa || []).length,
      lpaOnRelStation: (trace.lpa || []).filter(a =>
        relMachines.some(m => (a.station || '').toUpperCase().includes(m.toUpperCase()))).length,
      noPmMachines: equipHits.filter(r => !r.hasPmPlan).length,
      shipTraceable: (trace.stockOut || []).length > 0,
    };
  }, [sel, trace, claimFm, claimNote]);

  /* ── timeline เหตุการณ์รวม เรียงตามเวลา ── */
  const timeline = useMemo(() => {
    if (!sel || !trace) return [];
    const ev = [];
    const oStart = sel.opened_at ? new Date(sel.opened_at).getTime() : null;
    const oEnd = sel.confirmed_at ? new Date(sel.confirmed_at).getTime() : null;
    const overlapsOrder = (t1, t2) => {
      if (!oStart) return false;
      const a = t1 ? new Date(t1).getTime() : null; const b = t2 ? new Date(t2).getTime() : a;
      if (a == null) return false;
      return a <= (oEnd ?? Infinity) && (b ?? a) >= oStart;
    };
    // ⚠️ เปิด/ปิด = "เวลาสแกน" ไม่ใช่เวลาเริ่ม-จบผลิตจริง (พนักงานสแกนรวบหลายใบ — ดู scanBatch/orderAnalysis)
    const batchNote = (which) => {
      const n = scanBatch[which]?.members?.length || 0;
      return n > 1 ? ` · 🧾 สแกนรวบ ${n} ใบ` : '';
    };
    if (sel.opened_at) ev.push({ t: sel.opened_at, icon: '🟢', text: `สแกนเปิดใบ ${sel.prod_no} เป้า ${sel.qty_target ?? sel.qty} ชิ้น โดย ${sel.opened_by || '—'}${sel.is_backfill ? ' (ยิงย้อนหลัง)' : ''}${sel.machine_no ? ` · เครื่อง ${sel.machine_no}` : ''}${batchNote('open')}` });
    trace.qtyUpdates.forEach(u => { if (!u.is_final) ev.push({ t: u.logged_at, icon: '✍️', text: `อัพเดทยอดสะสม ${u.qty_accum} (+${u.qty_delta}) โดย ${u.logged_by || '—'}` }); });
    trace.defects.filter(d => d.prod_order_id === sel.id).forEach(d => ev.push({ t: d.logged_at, icon: '🚫', warn: true, text: `NG ${d.dr_defect_types?.name_th || ''} ${d.qty_ng || 0} ชิ้น${d.qty_suspect ? ` สงสัย ${d.qty_suspect}` : ''}${d.description ? ` — ${d.description}` : ''} (${d.reported_by_name || '—'})` }));
    trace.downtimes.forEach(d => {
      const inWin = overlapsOrder(d.started_at, d.ended_at);
      const planned = d.dr_downtime_types?.category === 'planned';
      ev.push({ t: d.started_at || sel.opened_at, icon: planned ? '🕐' : '🔴', warn: !planned && inWin, dim: planned,
        text: `${planned ? 'หยุดตามแผน' : 'Downtime'}: ${d.dr_downtime_types?.name_th || ''}${d.machine_no ? ` · ${d.machine_no}` : ''} ${Math.round(d.duration_min || 0)} นาที${d.description ? ` — ${d.description}` : ''}${inWin && !planned ? ' ⟵ ช่วงเดียวกับใบนี้' : ''}${d.carry_over ? ' (ยกข้ามกะ)' : ''}` });
      const mo = trace.mos.find(m => m.source_downtime_id === d.id);
      if (mo) ev.push({ t: d.ended_at || d.started_at || sel.opened_at, icon: '🔧', text: `ใบซ่อม ${mo.mo_no || '(รอเลข MO)'} → ${deptNameOf(mo.mtn_dept) || ''} ${mo.solution ? `— แก้: ${mo.solution}` : `(${mo.status})`}` });
    });
    trace.fourM.forEach(f => ev.push({ t: f.created_at, icon: '📋', text: `4M ${f.category}${f.change_subtype ? `/${f.change_subtype}` : ''}: ${f.description || ''} (${f.status})` }));
    if (sel.reopened_at) ev.push({ t: sel.reopened_at, icon: '↩️', warn: true, text: `ถอยใบ (ครั้งที่ ${sel.reopen_count || 1}) โดย ${sel.reopened_by || '—'}` });
    if (sel.confirmed_at) ev.push({ t: sel.confirmed_at, icon: '✅', text: `สแกนปิดใบ ผลิตจริง ${sel.qty_ok ?? sel.qty} ชิ้น โดย ${sel.confirmed_by || '—'}${batchNote('close')}` });
    trace.stockIn.forEach(x => ev.push({ t: x.created_at, icon: '📦', text: `เข้าคลัง ${x.line_name} +${Number(x.qty).toLocaleString()} (${x.created_by})` }));
    trace.stockOut.forEach(x => {
      const sh = x.customer_shipping_orders;
      ev.push({ t: x.created_at, icon: '🚚', dim: true,
        text: `ตัดส่งลูกค้า −${Number(x.qty).toLocaleString()} · ${sh
          ? `รอบส่ง ${sh.due_date} ${(sh.ship_time || '').slice(0, 5)}${sh.order_no ? ` · PO ${sh.order_no}` : ''} (ผูกรอบส่งแล้ว — แต่ยังบอกไม่ได้ว่าเป็นของจากใบผลิตนี้)`
          : `${x.note || ''} (โดยประมาณ — ตัดจากยอดรวม mat เดียวกัน)`}` });
    });
    return ev.filter(e => e.t).sort((a, b) => new Date(a.t) - new Date(b.t));
  }, [sel, trace]);

  /* ── วิเคราะห์การวิ่งของใบ ─────────────────────────────────────────────────
     ⚠️ ความจริงจากข้อมูล (ตรวจ 2026-08-05): พนักงาน**สแกนเปิด/ปิดใบเป็นชุด** ไม่ใช่ใบต่อใบ
        เช่น Assy LWR 05/08 เปิด 6 ใบภายใน 10 วินาที (10:43:21→10:43:31) · ปิด 3 ใบภายใน 51 วินาที
     → "เปิด→ปิด" ของใบเดียว **ไม่ใช่เวลาผลิตจริงของใบนั้น** เอามาหาร qty ใบเดียว = วิ/ชิ้นเพี้ยน
        (เคสจริง: 153.8 วิ/ชิ้น เทียบ CT 58 วิ = 38% ทั้งที่ไลน์เดินปกติ)
     → ตรวจเจอชุด/ใบวิ่งทับ = คำนวณ**ระดับกลุ่ม** (Σ qty ของใบที่ทับช่วง ÷ ช่วงเวลารวม) แทนรายใบ
        และไม่โชว์ตัวเลขรายใบเป็นคำตอบ (หลอก) — รายใบใช้ได้เฉพาะตอนไม่มีใบอื่นทับเลย  */
  const orderAnalysis = useMemo(() => {
    if (!sel?.opened_at || !sel?.confirmed_at || !trace) return null;
    const start = new Date(sel.opened_at).getTime(), end = new Date(sel.confirmed_at).getTime();
    if (end <= start) return null;

    // DT ที่ทับช่วงเวลาใดๆ (แยกนอกแผน/ตามแผน · ที่ไม่ระบุเวลาแยกไว้บอกเฉยๆ)
    const dtIn = (s, e) => {
      let unpl = 0, plan = 0, untimed = 0;
      trace.downtimes.forEach(d => {
        const planned = d.dr_downtime_types?.category === 'planned';
        if (!d.started_at) { if (!planned) untimed += d.duration_min || 0; return; }
        const a = new Date(d.started_at).getTime();
        const b = d.ended_at ? new Date(d.ended_at).getTime() : a + (d.duration_min || 0) * 60000;
        const ov = Math.max(0, Math.min(b, e) - Math.max(a, s)) / 60000;
        if (planned) plan += ov; else unpl += ov;
      });
      return { unpl, plan, untimed };
    };
    const qtyOf = (o) => Number(o.qty_ok ?? o.qty_actual ?? o.qty) || 0;
    const stdCt = trace.product?.cycle_time_sec || null;

    // รายใบ (ตามเวลาสแกน)
    const durMin = (end - start) / 60000;
    const dt = dtIn(start, end);
    const qty = qtyOf(sel);
    const netMin = Math.max(0, durMin - dt.plan - dt.unpl);
    const netSec = qty > 0 && netMin > 0 ? netMin * 60 / qty : null;

    // ── สแกนเป็นชุด (จาก scanBatch — เกณฑ์คำนวณจากเวลาผลิตจริง ไม่ใช่เลขตายตัว) + ใบที่วิ่งทับช่วงเดียวกัน ──
    const sess = trace.sessionOrders || [];
    const openBatch = scanBatch.open.members;
    const closeBatch = scanBatch.close.members;
    /* กลุ่ม = ใบที่วิ่ง "ต่อเนื่องเชื่อมกัน" (transitive) — ขยายช่วงจนไม่มีใบใหม่เข้ามา
       ⚠️ ห้ามเอาแค่ใบที่ทับกับใบนี้ตรงๆ: ช่วงเวลาจะถูกดึงกว้างตามใบที่ลากเข้ามา
          แต่ qty ไม่ได้รวมใบที่ทับกับ "ใบนั้น" อีกที → ตัวหารโตกว่าตัวตั้ง = อัตราต่ำเกินจริง
          (เทสกับ Assy LWR 05/08: แบบทับตรงๆ ได้ 5 ใบ/ช่วง 09:14→13:38 แต่ช่วงนั้นมีของออกจริงมากกว่านั้น) */
    const closedOrders = sess.filter(o => o.opened_at && o.confirmed_at
      && new Date(o.confirmed_at).getTime() > new Date(o.opened_at).getTime());
    const inGroup = new Map([[sel.id, sel]]);
    let gStart = start, gEnd = end, grew = true;
    while (grew) {
      grew = false;
      closedOrders.forEach(o => {
        if (inGroup.has(o.id)) return;
        const a = new Date(o.opened_at).getTime(), b = new Date(o.confirmed_at).getTime();
        if (a < gEnd && b > gStart) { inGroup.set(o.id, o); gStart = Math.min(gStart, a); gEnd = Math.max(gEnd, b); grew = true; }
      });
    }
    const groupOrders = [...inGroup.values()];
    const hasPeers = groupOrders.length > 1;
    const batchScan = openBatch.length > 1 || closeBatch.length > 1;
    const groupMode = batchScan || hasPeers;

    // ── ระดับกลุ่ม: ช่วงรวม + ยอดรวมของใบในกลุ่ม (สอดคล้องกัน) ──
    let group = null;
    if (groupMode && hasPeers) {
      const gQty = groupOrders.reduce((s, o) => s + qtyOf(o), 0);
      const gDt = dtIn(gStart, gEnd);
      const gNetMin = Math.max(0, (gEnd - gStart) / 60000 - gDt.plan - gDt.unpl);
      const gSec = gQty > 0 && gNetMin > 0 ? gNetMin * 60 / gQty : null;
      const sameMat = groupOrders.every(o => (o.mat_no || '') === (sel.mat_no || ''));
      // เทียบมาตรฐานแบบถ่วงน้ำหนัก (สูตรเดียวกับ P ของ OEE): Σ(qty×CT) ÷ เวลาเดินจริง
      const ctMap = trace.ctByMat || {};
      const missCt = groupOrders.filter(o => !ctMap[o.mat_no]);
      const stdSec = groupOrders.reduce((s, o) => s + qtyOf(o) * (ctMap[o.mat_no] || 0), 0);
      group = {
        gStart, gEnd, orders: groupOrders.length, qty: gQty,
        durMin: (gEnd - gStart) / 60000, netMin: gNetMin, dtUnpl: gDt.unpl, dtPlan: gDt.plan, sec: gSec, sameMat,
        mats: [...new Set(groupOrders.map(o => o.mat_no).filter(Boolean))],
        missCtN: missCt.length,
        ratePerHr: gNetMin > 0 && gQty > 0 ? Math.round(gQty / (gNetMin / 60)) : null,
        speedPct: (!missCt.length && stdSec > 0 && gNetMin > 0) ? Math.round(stdSec / (gNetMin * 60) * 100) : null,
      };
    }

    return { durMin, dtUnpl: dt.unpl, dtPlan: dt.plan, dtUntimed: dt.untimed, qty, netMin, netSec, stdCt,
      speedPct: stdCt && netSec ? Math.round(stdCt / netSec * 100) : null,
      ratePerHr: netMin > 0 && qty > 0 ? Math.round(qty / (netMin / 60)) : null,
      batchScan, openBatchN: openBatch.length, closeBatchN: closeBatch.length, groupMode, group, othersOverlap: hasPeers,
      batchMaxGapSec: scanBatch.evidence?.maxGapSec ?? null,
      batchNeedSec: scanBatch.evidence?.needSec ?? null, batchNeedFrom: scanBatch.evidence?.needFrom ?? null };
  }, [sel, trace, scanBatch]);

  const sess = sel?.production_sessions;
  const stMeta = STATUS_META[sel?.status] || { label: sel?.status, color: 'var(--muted)' };
  const ppeBad = p => !(p.has_helmet && p.has_boots && p.has_gloves);
  // สูตรเดียวกับ Management/Dashboard computeFit: ทักษะที่ผ่าน min_score / ทั้งหมด ×100
  const fitOf = (empId, stationId) => {
    const reqs = trace?.reqsByStation?.[String(stationId)] || [];
    if (!reqs.length) return null;
    const sk = trace?.skillsByEmp?.[empId] || {};
    const passed = reqs.filter(r => (sk[r.skill_name] ?? 0) >= (r.min_score ?? 0)).length;
    return Math.round(passed / reqs.length * 100);
  };
  const fitColor = f => f == null ? 'var(--muted)' : f >= 80 ? '#22c55e' : f >= 60 ? '#f59e0b' : f >= 40 ? '#f97316' : '#ef4444';
  const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)} ชม. ${Math.round(m % 60)} นาที` : `${Math.round(m)} นาที`;
  const fmtDur = s => s == null ? '—' : s < 60 ? `${Math.round(s)} วินาที` : fmtMin(s / 60);   // วินาที → อ่านง่าย

  return (
    <div style={{ maxWidth: 'min(97vw, 1500px)', margin: '0 auto' }}>
      <PageHeader
        title="สอบกลับ Order (Order Traceability)" icon="🔎"
        sub="สแกน/ค้นหาใบผลิต → เห็นทุกเหตุการณ์ + สถานการณ์รอบข้าง ณ เวลาผลิตใบนั้น"
      />

      {/* ── ค้นหา ── */}
      <div style={{ ...card, marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') doSearch(); }}
          placeholder="🔍 สแกน PROD.NO / พิมพ์ MAT.NO / ชื่อชิ้นงาน"
          style={{ width: 320, fontSize: 14 }} autoFocus />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>ช่วงวันงาน</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 140 }} />
        <span style={{ color: 'var(--muted)' }}>—</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 140 }} />
        <button onClick={() => doSearch()} disabled={searching}
          style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
          {searching ? '⏳' : 'ค้นหา'}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}
          title="สอบกลับ = ทวนสอบของที่ออกจากไลน์ไปแล้ว · ใบที่ยังผลิตอยู่จึงไม่แสดงโดยปริยาย">
          <input type="checkbox" checked={includeOpen} style={{ width: 'auto' }}
            onChange={e => { const v = e.target.checked; setIncludeOpen(v); doSearch(undefined, { includeOpen: v }); }} />
          รวมใบที่กำลังผลิต
        </label>
        {sel && <button onClick={() => { setSel(null); }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text2)', cursor: 'pointer', fontWeight: 700 }}>✕ ปิด — ดูใบอื่น</button>}
      </div>

      {/* ── ผลค้นหา: สรุปภาพรวมก่อน แล้วตารางเต็มพื้นที่ (เห็นข้อมูลก่อนคลิกเลือกใบ) ── */}
      {!sel && results.length > 0 && (
        <>
          <div style={{ ...card, marginBottom: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
              {[
                { l: 'ใบที่เจอ', v: sum.count.toLocaleString(), s: sum.openCount > 0 ? `กำลังผลิต ${sum.openCount}` : null },
                { l: 'เป้ารวม', v: sum.target.toLocaleString() },
                { l: 'ผลิตรวม', v: sum.produced.toLocaleString(), c: '#22c55e', s: sum.target > 0 ? `${Math.round(sum.produced / sum.target * 100)}% ของเป้า` : null },
                { l: 'NG รวม', v: sum.ng.toLocaleString(), c: sum.ng > 0 ? '#ef4444' : undefined, s: sum.produced + sum.ng > 0 ? `${(sum.ng / (sum.produced + sum.ng) * 100).toFixed(2)}%` : null },
                { l: 'ไลน์', v: sum.lines.length, s: sum.lines.slice(0, 2).join(', ') + (sum.lines.length > 2 ? ` +${sum.lines.length - 2}` : '') },
                { l: 'ชิ้นงาน', v: sum.mats.length, s: sum.mats.slice(0, 2).join(', ') + (sum.mats.length > 2 ? ` +${sum.mats.length - 2}` : '') },
                { l: 'วันที่ผลิต', v: sum.days.length, s: sum.days.length ? `${fmtDate(sum.days[0])} → ${fmtDate(sum.days[sum.days.length - 1])}` : null },
              ].map(k => (
                <div key={k.l} style={{ minWidth: 88 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>{k.l}</div>
                  <div style={{ fontSize: 19, fontWeight: 900, color: k.c || 'var(--text)', lineHeight: 1.2 }}>{k.v}</div>
                  {k.s && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{k.s}</div>}
                </div>
              ))}
              <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)', textAlign: 'right' }}>
                รวมจาก {sum.count} ใบที่แสดง<br />👆 คลิกแถวเพื่อดูสอบกลับเต็ม
              </div>
            </div>
            {sum.capped && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: '#f59e0b' }}>
                ⚠️ แสดง 300 ใบแรกเท่านั้น (มีมากกว่านี้) — แคบช่วงวันหรือระบุ MAT/PROD.NO ให้เจาะจงขึ้นเพื่อดูครบ
              </div>
            )}
          </div>

          <div style={{ ...card, marginBottom: 16, padding: 0, maxHeight: 'calc(100vh - 330px)', minHeight: 260, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'left', position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1, boxShadow: 'inset 0 -1px 0 var(--border)' }}>
                <th style={{ padding: '8px 6px' }}>PROD.NO</th><th>MAT / ชิ้นงาน</th><th>ไลน์ / เครื่อง</th><th>วัน / กะ</th><th>เปิด → ปิด</th>
                <th style={{ textAlign: 'right' }}>เป้า</th><th style={{ textAlign: 'right' }}>ผลิต</th><th style={{ textAlign: 'right' }}>%</th>
                <th style={{ textAlign: 'right' }}>NG</th><th style={{ textAlign: 'right' }}>OEE กะ</th><th>ผู้เปิด / ปิด</th><th>สถานะ</th>
              </tr></thead>
              <tbody>
                {results.map(o => {
                  const s = o.production_sessions || {};
                  const tgt = Number(o.qty_target ?? o.qty) || 0;
                  const made = Number(o.status === 'confirmed' ? (o.qty_ok ?? o.qty) : o.qty_actual) || 0;
                  const ng = (Number(o.qty_ng) || 0) + (Number(o.qty_suspect) || 0);
                  const pct = tgt > 0 ? Math.round(made / tgt * 100) : null;
                  return (
                    <tr key={o.id} onClick={() => setSel(o)} style={{ cursor: 'pointer', borderTop: '1px solid var(--border2)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <td style={{ padding: '7px 6px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {o.prod_no}
                        <span style={{ fontSize: 10 }}>
                          {o.is_backfill && <span title="ยิงย้อนหลัง"> ⏪</span>}
                          {o.reopen_count > 0 && <span title={`เคยถอยใบ ${o.reopen_count} ครั้ง`}> ↩️</span>}
                          {o.paired_order_id && <span title="งานคู่ RH/LH"> 🔗</span>}
                          {o.carry_over_from_session_id && <span title="ยกยอดมาจากกะก่อน"> ⏬</span>}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{o.mat_no || '—'}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{o.part_name || ''}{o.customer ? ` · ${o.customer}` : ''}</div>
                      </td>
                      <td>
                        <div>{s.line_name || '—'}</div>
                        {o.machine_no && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>⚙️ {o.machine_no}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.work_date)} {s.shift === 'night' ? '🌙' : '☀️'}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 11.5, color: 'var(--text2)' }}>{fmtTime(o.opened_at)} → {o.confirmed_at ? fmtTime(o.confirmed_at) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{tgt.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{made ? made.toLocaleString() : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: pct == null ? 'var(--muted)' : pct >= 100 ? '#22c55e' : pct >= 80 ? '#f59e0b' : '#ef4444' }}>{pct == null ? '—' : `${pct}%`}</td>
                      <td style={{ textAlign: 'right', color: ng > 0 ? '#ef4444' : 'var(--muted)', fontWeight: ng > 0 ? 700 : 400 }}>{ng || '—'}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{s.oee != null ? `${Number(s.oee).toFixed(1)}%` : '—'}</td>
                      <td style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {o.opened_by || '—'}{o.confirmed_by ? ` / ${o.confirmed_by}` : ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}><span style={{ color: (STATUS_META[o.status] || {}).color }}>{(STATUS_META[o.status] || {}).label || o.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!sel && !results.length && !searching && (
        <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>สแกนบาร์โค้ด kanban (PROD.NO) หรือพิมพ์เลข MAT/ชื่อชิ้นงาน แล้วกดค้นหา — เว้นว่างเพื่อดูใบทั้งหมดในช่วงวัน</div>
      )}

      {/* ── รายละเอียดใบ ── */}
      {sel && (
        <>
          <div style={{ ...card, marginBottom: 16, borderColor: stMeta.color }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'baseline' }}>
              <span style={{ fontSize: 19, fontWeight: 900 }}>{sel.prod_no}</span>
              <span style={{ ...chip('var(--bg3)', stMeta.color) }}>{stMeta.label}</span>
              {sel.is_backfill && <span style={chip('rgba(245,158,11,0.15)', '#f59e0b')}>⏪ ยิงย้อนหลัง</span>}
              {(sel.reopen_count || 0) > 0 && <span style={chip('rgba(239,68,68,0.12)', '#ef4444')}>↩️ เคยถอยใบ {sel.reopen_count} ครั้ง</span>}
              {sel.paired_order_id && <span style={chip('var(--bg3)', 'var(--text2)')}>🔗 มีใบคู่ RH/LH</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px 18px', marginTop: 10, fontSize: 13 }}>
              <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>ชิ้นงาน</span><br /><b>{sel.part_name || '—'}</b> <span style={{ color: 'var(--muted)' }}>{sel.mat_no}</span>{sel.customer ? <span style={{ color: 'var(--muted)' }}> · {sel.customer}</span> : ''}</div>
              <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>ไลน์ / วันงาน / กะ</span><br /><b>{sess.line_name}</b> · {fmtDate(sess.work_date)} · {sess.shift === 'night' ? '🌙 กะดึก' : '☀️ กะเช้า'}</div>
              <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>เป้า → ผลิตจริง (OK/NG/สงสัย/ซ่อม)</span><br /><b>{(sel.qty_target ?? sel.qty)?.toLocaleString()}</b> → <b>{(sel.qty_ok ?? sel.qty_actual ?? '—')?.toLocaleString?.() ?? '—'}</b> <span style={{ color: 'var(--muted)', fontSize: 12 }}>({sel.qty_ok ?? '—'}/{sel.qty_ng ?? 0}/{sel.qty_suspect ?? 0}/{sel.qty_repair ?? 0})</span></div>
              <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>เปิดใบ</span><br />{fmtDT(sel.opened_at)} · {sel.opened_by || '—'}</div>
              <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>ปิดใบ</span><br />{fmtDT(sel.confirmed_at)} · {sel.confirmed_by || '—'}</div>
              <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>OEE กะนี้ (A/P/Q)</span><br />{sess.oee != null ? <b>{Number(sess.oee).toFixed(1)}%</b> : '—'} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({sess.oee_a ?? '—'}/{sess.oee_p ?? '—'}/{sess.oee_q ?? '—'})</span></div>
            </div>
            {sel.carry_over_note && <div style={{ marginTop: 8, fontSize: 12, color: '#f59e0b' }}>➡ {sel.carry_over_note}</div>}
            {sess.close_approve_note && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text2)' }}>📝 หมายเหตุผู้อนุมัติปิดกะ: {sess.close_approve_note}</div>}
          </div>

          {loading && <div style={{ ...card, marginBottom: 16, color: 'var(--muted)' }}>⏳ กำลังรวบรวมข้อมูลสอบกลับ…</div>}

          {trace && !loading && (
            <>
              {/* ── Timeline ── */}
              {/* ── 🔍 อาการที่ลูกค้าแจ้ง → โฟกัสหลักฐานเป็น 3 ขาแบบ 8D ── */}
              <CollapseCard id="claim" storePrefix="ot" title="🔍 ลูกค้าแจ้งอาการอะไร — โฟกัสการสอบสวน (8D)"
                count={claim ? claim.related.length : null} defaultOpen={!!trace.pe?.set}>
                {!trace.pe?.set ? (
                  <div style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--muted)' }}>
                    พาร์ทนี้ <b style={{ color: 'var(--text2)' }}>ยังไม่มีเอกสาร PFMEA / Control Plan ในระบบ</b> —
                    จึงยังโฟกัสตามอาการไม่ได้ (ทั้งระบบลงไปแล้ว {trace.pe?.totalSets ?? 0} พาร์ท)
                    <div style={{ marginTop: 5 }}>ลงเอกสารได้ที่หน้า <b>วิศวกรรม (PE) → Flow / PFMEA / Control Plan</b></div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
                      เลือกอาการจาก <b style={{ color: 'var(--text2)' }}>PFMEA ของพาร์ทนี้</b> ({trace.pe.set.part_no}) —
                      ระบบจะกรองเฉพาะจุด/เครื่อง/ด่านตรวจที่เกี่ยวข้อง แล้วจัดเป็น 3 ขาให้พร้อมลอกใส่ 8D
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                      <select value={claimFm} onChange={e => setClaimFm(e.target.value)}
                        style={{ flex: '2 1 320px', minWidth: 0, padding: '7px 10px', fontSize: 13, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)', borderRadius: 6 }}>
                        <option value="">— เลือกอาการที่ลูกค้าแจ้ง (จาก PFMEA {trace.pe.fmea.length} รายการ) —</option>
                        {trace.pe.fmea.slice().sort((a, b) =>
                          ((b.severity || 0) * (b.occurrence || 0) * (b.detection || 0)) - ((a.severity || 0) * (a.occurrence || 0) * (a.detection || 0))
                        ).map(f => {
                          const p = trace.pe.procs.find(x => x.id === f.process_id);
                          const r = (f.severity || 0) * (f.occurrence || 0) * (f.detection || 0);
                          return <option key={f.id} value={f.id}>
                            {`OP${p?.op_no || '?'} · ${(f.failure_mode || '').replace(/^[-\s]+/, '').slice(0, 60)}${r ? ` · RPN ${r}` : ''}`}
                          </option>;
                        })}
                      </select>
                      <input value={claimNote} onChange={e => setClaimNote(e.target.value)}
                        placeholder="รายละเอียดที่ลูกค้าแจ้ง เช่น ตำแหน่ง M8 ด้านซ้าย"
                        style={{ flex: '1 1 220px', minWidth: 0, padding: '7px 10px', fontSize: 13, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)', borderRadius: 6 }} />
                    </div>

                    {!claim ? (
                      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>เลือกอาการ หรือพิมพ์รายละเอียด แล้วระบบจะไล่หลักฐานให้</div>
                    ) : claim.notInFmea ? (
                      <div style={{ ...card, borderLeft: '4px solid #f59e0b', fontSize: 12.5, lineHeight: 1.7 }}>
                        <b style={{ color: '#f59e0b' }}>อาการนี้ไม่มีใน PFMEA ของพาร์ทนี้เลย</b> —
                        แปลว่า<b>ไม่เคยถูกคาดไว้ตอนออกแบบกระบวนการ</b>
                        <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                          นี่คือข้อสรุปที่ต้องเขียนใน 8D ขา Systemic (D7) อยู่แล้ว — และต้อง revise PFMEA เพิ่ม failure mode ใหม่
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gap: 10 }}>
                        {/* ── ขา 1 · Occurrence ── */}
                        <div style={{ ...card, borderLeft: '4px solid #ef4444' }}>
                          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>
                            🔴 ขา 1 · ทำไมถึงเกิด <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(8D · D4 Root Cause)</span>
                          </div>
                          {claim.fm && (
                            <div style={{ fontSize: 12.5, lineHeight: 1.7, marginBottom: 6 }}>
                              PFMEA <b>OP{claim.srcProc?.op_no}</b> — “{(claim.fm.failure_mode || '').replace(/^[-\s]+/, '')}”
                              {claim.rpn && <> · <b style={{ color: claim.rpn >= 100 ? '#ef4444' : 'var(--text)' }}>RPN {claim.rpn}</b>
                                <span style={{ color: 'var(--muted)' }}> (S{claim.fm.severity} × O{claim.fm.occurrence} × D{claim.fm.detection})</span></>}
                              {claim.fm.causes && <div style={{ color: 'var(--text2)', marginTop: 3 }}>สาเหตุที่เคยระบุไว้: {claim.fm.causes.replace(/\n/g, ' · ').slice(0, 220)}</div>}
                            </div>
                          )}
                          <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                            <b>จุดที่ต้องสงสัย {claim.related.length} จุด</b>
                            {claim.relMachines.length > 0 && <> · เครื่อง: <b>{claim.relMachines.join(' · ')}</b></>}
                            <div style={{ color: 'var(--text2)', marginTop: 3 }}>
                              {claim.related.slice(0, 12).map(p => `OP${p.op_no}`).join(' · ')}
                              {claim.related.length > 12 ? ` … +${claim.related.length - 12}` : ''}
                            </div>
                          </div>
                          {claim.dtHits.length > 0 ? (
                            <div style={{ marginTop: 7, fontSize: 12.5, lineHeight: 1.65 }}>
                              <b style={{ color: '#ef4444' }}>⚠ เจอ Downtime ที่เกี่ยวข้องในกะนี้ {claim.dtHits.length} รายการ</b>
                              {claim.dtHits.slice(0, 5).map((d, i) => (
                                <div key={i} style={{ color: 'var(--text2)' }}>
                                  · {d.duration_min ? `${d.duration_min} น.` : '—'} {d.machine_no ? `[${d.machine_no}] ` : ''}
                                  {d.dr_downtime_types?.name_th}{d.description ? ` — “${d.description.trim()}”` : ''}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ marginTop: 7, fontSize: 12.5, color: 'var(--muted)' }}>ไม่พบ Downtime ที่เกี่ยวข้องในกะนี้ — ดูกะข้างเคียงเพิ่มที่ Daily Report</div>
                          )}
                          {claim.noPmMachines > 0 && (
                            <div style={{ marginTop: 6, fontSize: 12.5, color: '#f59e0b' }}>
                              🔧 เครื่องที่เกี่ยวข้อง <b>{claim.noPmMachines} ตัวยังไม่มีแผน PM</b> — ไม่มีการบำรุงรักษาเชิงป้องกันรองรับ
                            </div>
                          )}
                        </div>

                        {/* ── ขา 2 · Detection ── */}
                        <div style={{ ...card, borderLeft: '4px solid #f59e0b' }}>
                          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>
                            🟠 ขา 2 · ทำไมถึงหลุดรอด <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(8D · D4 Escape Point)</span>
                          </div>
                          {claim.fm?.detection_ctrl && (
                            <div style={{ fontSize: 12.5, lineHeight: 1.7, marginBottom: 5 }}>
                              ด่านที่ PFMEA อ้างไว้: <b>{claim.fm.detection_ctrl.replace(/\n/g, ' · ').slice(0, 200)}</b>
                              {claim.fm.detection >= 7 && <span style={{ color: '#ef4444' }}> · D={claim.fm.detection} (ตรวจจับยาก)</span>}
                            </div>
                          )}
                          {claim.cpRows.length > 0 ? (
                            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                              <b>Control Plan ของจุดเหล่านี้ {claim.cpRows.length} รายการ</b>
                              {claim.cpRows.slice(0, 6).map((c, i) => {
                                const p = trace.pe.procs.find(x => x.id === c.process_id);
                                return (
                                  <div key={i} style={{ color: 'var(--text2)', marginTop: 2 }}>
                                    · OP{p?.op_no} {c.product_char || c.process_char || ''} —
                                    <b> {(c.frequency || 'ไม่ระบุความถี่').replace(/\n/g, ' / ')}</b>
                                    {c.sample_size ? ` · ตัวอย่าง ${c.sample_size.replace(/\n/g, '/')}` : ''}
                                    {c.special_class ? <span style={{ color: '#f59e0b' }}> · {c.special_class}</span> : ''}
                                  </div>
                                );
                              })}
                            </div>
                          ) : <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ไม่มีจุดควบคุมใน Control Plan สำหรับจุดเหล่านี้</div>}
                          <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11.5 }}>
                            <span style={chip(claim.ngLogged ? 'rgba(61,214,92,.15)' : 'rgba(239,68,68,.15)', claim.ngLogged ? 'var(--accent)' : '#ef4444')}>
                              {claim.ngLogged ? `✅ บันทึกของเสียในกะ ${claim.ngLogged} รายการ` : '🔴 กะนี้ไม่มีบันทึกของเสียเลย'}
                            </span>
                            <span style={chip(claim.pokaLogged ? 'rgba(61,214,92,.15)' : 'rgba(239,68,68,.15)', claim.pokaLogged ? 'var(--accent)' : '#ef4444')}>
                              {claim.pokaLogged ? `✅ Poka-Yoke ${claim.pokaLogged} ครั้ง` : '🔴 ไม่มีบันทึก Poka-Yoke'}
                            </span>
                          </div>
                        </div>

                        {/* ── ขา 3 · Systemic ── */}
                        <div style={{ ...card, borderLeft: '4px solid #a78bfa' }}>
                          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>
                            🟣 ขา 3 · ทำไมระบบคุมไม่ได้ <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(8D · D7 Prevent Recurrence)</span>
                          </div>
                          <div style={{ display: 'grid', gap: 4, fontSize: 12.5, lineHeight: 1.65 }}>
                            {claim.rpn >= 100 && (
                              <div>⚠ ความเสี่ยงนี้ถูกประเมินไว้สูง (<b>RPN {claim.rpn}</b>) — ตรวจดูว่าความถี่ใน Control Plan แรงพอกับความเสี่ยงมั้ย</div>
                            )}
                            {claim.fm && !claim.fm.action_taken && (
                              <div>⚠ PFMEA ข้อนี้<b>ยังไม่มีการบันทึก action ที่ทำจริง</b>{claim.fm.recommended_action ? ' (มีแต่ข้อเสนอ)' : ''} — ความเสี่ยงถูกยอมรับไว้เฉยๆ</div>
                            )}
                            <div>
                              {claim.lpaOnRelStation > 0
                                ? <>✅ LPA เคยตรวจสถานีที่เกี่ยวข้อง {claim.lpaOnRelStation} ครั้งในวันนั้น</>
                                : <>⚠ LPA วันนั้น <b>ไม่เคยสุ่มโดนสถานีที่เกี่ยวข้อง</b>{claim.lpaLogged ? ` (ตรวจ ${claim.lpaLogged} ครั้ง แต่คนละจุด)` : ''} — การสุ่มไม่ได้ผูกกับความเสี่ยง</>}
                            </div>
                            <div>
                              {claim.shipTraceable
                                ? <>✅ มีข้อมูลรอบส่ง — ย้อนกลับหาลูกค้าได้</>
                                : <>⚠ <b>ไม่มีข้อมูลการตัดส่ง</b> — ย้อนจากกล่องที่ลูกค้าเคลมกลับมาหากะที่ผลิตไม่ได้ ทำให้ขอบเขตการกันของกว้างเกินจำเป็น</>}
                            </div>
                            {claim.sameMode.length > 0 && (
                              <div>🔁 อาการเดียวกันนี้ถูกระบุไว้ที่ <b>OP อื่นอีก {claim.sameMode.length} จุด</b> — ถ้าแก้จุดเดียวอาจไม่ครอบคลุม</div>
                            )}
                          </div>
                        </div>

                        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                          ⚠️ ระบบ<b>เสนอจุดที่ต้องสงสัย</b>จากการจับคู่ชิ้นส่วน/คำในอาการ —
                          <b>ไม่ใช่การยืนยันสาเหตุ</b> คนยังต้องเป็นผู้ตัดสิน · หน้านี้ไม่บันทึกอะไรลงฐานข้อมูล
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CollapseCard>

              <CollapseCard id="timeline" storePrefix="ot" title="🕐 Timeline เหตุการณ์" count={timeline.length}>
                <div style={{ display: 'grid', gap: 0 }}>
                  {timeline.map((e, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '5px 0', borderLeft: `3px solid ${e.warn ? '#ef4444' : 'var(--border2)'}`, paddingLeft: 12, marginLeft: 6, opacity: e.dim ? 0.6 : 1 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--muted)', minWidth: 88, fontVariantNumeric: 'tabular-nums' }}>{fmtDT(e.t)}</span>
                      <span style={{ fontSize: 12.5, color: e.warn ? '#ef4444' : 'var(--text)' }}>{e.icon} {e.text}</span>
                    </div>
                  ))}
                  {!timeline.length && <div style={{ color: 'var(--muted)', fontSize: 12 }}>ไม่มีเหตุการณ์</div>}
                </div>
              </CollapseCard>

              {/* ── กำลังคน & จุดงาน (data mining) ── */}
              <CollapseCard id="people" storePrefix="ot" title={`👷 กำลังคน & จุดงาน — ${sess.line_name} วันนั้น`} count={trace.people.length} defaultOpen={trace.people.length > 0}>
                {(() => {
                  const present = trace.people.filter(p => p.is_present);
                  const absent = trace.people.filter(p => !p.is_present);
                  const enrich = trace.people.map(p => {
                    const aId = p.assigned_line ? String(p.assigned_line) : null;
                    const hId = trace.homeByEmp[p.employee_id] || null;
                    const moved = aId && hId && aId !== hId;
                    const fit = aId ? fitOf(p.employee_id, aId) : (hId ? fitOf(p.employee_id, hId) : null);
                    const man4m = trace.fourM.some(f => f.category === 'Man' && (f.description || '').includes(p.emp.name));
                    return { ...p, aId, hId, moved, fit, man4m };
                  }).sort((a, b) => (b.is_present - a.is_present) || ((a.fit ?? 101) - (b.fit ?? 101)));
                  const movedN = enrich.filter(p => p.is_present && p.moved).length;
                  const lowFitN = enrich.filter(p => p.is_present && p.fit != null && p.fit < 60).length;
                  const ppeN = present.filter(ppeBad).length;
                  // กำลังคนมาตรฐานของไลน์ (std = headcount/กะ) — กฎกลาง: แม่ตั้งไว้ = ยอดกลุ่ม · ไม่ตั้ง = รวมลูก
                  const std = stdGroupOf(lines, sess.line_name, sess.shift === 'night' ? 'night' : 'day');
                  return (
                    <>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                        <span style={chip('var(--bg3)', present.length < std ? '#ef4444' : '#22c55e')}>มาทำงาน {present.length}{std ? `/${std} คน (มาตรฐานกะ)` : ' คน'}</span>
                        {absent.length > 0 && <span style={chip('rgba(239,68,68,0.10)', '#ef4444')}>ขาด/ลา {absent.length}</span>}
                        {movedN > 0 && <span style={chip('rgba(245,158,11,0.12)', '#f59e0b')}>🔀 ย้ายจุด {movedN}</span>}
                        {lowFitN > 0 && <span style={chip('rgba(239,68,68,0.12)', '#ef4444')}>⚠️ ทักษะไม่ถึงจุด {lowFitN}</span>}
                        {ppeN > 0 && <span style={chip('rgba(245,158,11,0.12)', '#f59e0b')}>⚠️ PPE ไม่ครบ {ppeN}</span>}
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                          <thead><tr style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'left' }}>
                            <th style={{ padding: '4px 6px' }}>พนักงาน</th><th>จุดที่เข้าวันนั้น</th><th>จุดประจำ</th><th>Skill fit</th><th>PPE</th><th>หมายเหตุ</th>
                          </tr></thead>
                          <tbody>
                            {enrich.map((p, i) => (
                              <tr key={i} style={{ borderTop: '1px solid var(--border2)', opacity: p.is_present ? 1 : 0.55 }}>
                                <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>
                                  {p.is_present ? '✅' : '🏠'} <b>{p.emp.name}</b>
                                  <span style={{ color: 'var(--muted)', fontSize: 11 }}> {p.emp.employee_id_code || ''}{p.emp.team ? ` · ทีม ${p.emp.team}` : ''}</span>
                                </td>
                                <td style={{ whiteSpace: 'nowrap' }}>
                                  {p.aId && trace.stations[p.aId] ? <b>{trace.stations[p.aId]}</b> : <span style={{ color: 'var(--muted)' }}>—</span>}
                                  {p.moved && <span style={{ marginLeft: 6, ...chip('rgba(245,158,11,0.12)', '#f59e0b') }}>🔀 ย้ายจุด</span>}
                                </td>
                                <td style={{ whiteSpace: 'nowrap', color: 'var(--text2)' }}>{p.hId && trace.stations[p.hId] ? trace.stations[p.hId] : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                                <td>{p.fit != null ? <b style={{ color: fitColor(p.fit) }}>{p.fit}%</b> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                                <td style={{ whiteSpace: 'nowrap' }}>
                                  {!p.is_present ? '—' : ppeBad(p)
                                    ? <span style={{ color: '#f59e0b' }}>⚠️ {[!p.has_helmet && 'หมวก', !p.has_boots && 'รองเท้า', !p.has_gloves && 'ถุงมือ'].filter(Boolean).join('/')}</span>
                                    : <span style={{ color: '#22c55e' }}>ครบ</span>}
                                </td>
                                <td style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                                  {[!p.is_present && (p.leave_type || 'ขาด'), p.has_ot && 'OT', p.man4m && '📋 มี 4M Man', trace.ojtByEmp[p.employee_id] && `🎓 อบรม: ${trace.ojtByEmp[p.employee_id]}`, p.remark].filter(Boolean).join(' · ') || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!trace.people.length && <div style={{ color: 'var(--muted)', fontSize: 12 }}>ไม่พบข้อมูลเช็คชื่อของวันนั้น</div>}
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                        ⚠️ Skill fit คิดจากคะแนนสกิล "ปัจจุบัน" เทียบเกณฑ์จุดงาน (ระบบไม่เก็บ history คะแนน ณ วันผลิต) · จุดที่เข้า = จากเช็คชื่อ/จัดกำลังคนวันนั้น
                      </div>
                    </>
                  );
                })()}
              </CollapseCard>

              {/* ── วิเคราะห์การวิ่งของใบ ── */}
              {orderAnalysis && (
                <CollapseCard id="analysis" storePrefix="ot" title="⏱️ วิเคราะห์การวิ่งของใบ (เวลา · ความเร็ว vs มาตรฐาน)" count={null} defaultOpen>
                  {/* สแกนเป็นชุด → เวลาเปิด-ปิดรายใบไม่ใช่เวลาผลิตจริง ต้องอ่านเป็นระดับกลุ่ม */}
                  {orderAnalysis.batchScan && (
                    <div style={{ marginBottom: 10, padding: '8px 11px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.45)', fontSize: 12, color: '#f59e0b' }}>
                      ⚠️ <b>ใบนี้ถูกสแกนรวบกับใบอื่น</b>
                      {orderAnalysis.openBatchN > 1 && <> — เปิดรวบ {orderAnalysis.openBatchN} ใบ</>}
                      {orderAnalysis.closeBatchN > 1 && <>{orderAnalysis.openBatchN > 1 ? ' · ' : ' — '}ปิดรวบ {orderAnalysis.closeBatchN} ใบ</>}
                      {orderAnalysis.batchNeedSec > 0 && (
                        <> — สแกนห่างกันสูงสุด <b>{fmtDur(orderAnalysis.batchMaxGapSec)}</b> แต่ของที่ทำอยู่ช่วงนั้นต้องใช้เวลาผลิต ~<b>{fmtDur(orderAnalysis.batchNeedSec)}</b>
                          {' '}({orderAnalysis.batchNeedFrom === 'ct' ? 'จาก CT มาตรฐาน' : 'จากอัตราจริงของกะ'}) → <b>ผลิตไม่ทันในช่วงนั้น</b></>
                      )}
                      {!orderAnalysis.batchNeedSec && <> (ยังไม่ตั้ง CT และไม่มีข้อมูลกะพอ — ใช้เกณฑ์สำรอง {FALLBACK_BATCH_SEC / 60} นาที)</>}
                      {' '}→ <b>เวลา "เปิด→ปิด" ของใบนี้ไม่ใช่เวลาผลิตจริงของใบเดียว</b> จึงคิด วิ/ชิ้น รายใบไม่ได้ · ใช้ตัวเลข <b>ระดับกลุ่ม</b> ด้านล่างแทน
                    </div>
                  )}

                  {/* ระดับกลุ่ม = คำตอบหลักเมื่อมีใบวิ่งทับ/สแกนเป็นชุด */}
                  {orderAnalysis.groupMode && orderAnalysis.group && (
                    <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--accent)' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>
                        📦 ภาพรวมกลุ่มใบที่วิ่งต่อเนื่องช่วงเดียวกัน ({orderAnalysis.group.orders} ใบ
                        {orderAnalysis.group.mats.length > 1 ? ` · ${orderAnalysis.group.mats.length} ชิ้นงาน` : ''}) — ตัวเลขที่เชื่อถือได้
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px 18px', fontSize: 13 }}>
                        <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>ช่วงเวลารวมของกลุ่ม</span><br />
                          <b>{fmtTime(orderAnalysis.group.gStart)} → {fmtTime(orderAnalysis.group.gEnd)}</b>
                          <span style={{ color: 'var(--muted)' }}> ({fmtMin(orderAnalysis.group.durMin)})</span>
                        </div>
                        <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>ผลิตรวมทั้งกลุ่ม</span><br /><b>{orderAnalysis.group.qty.toLocaleString()} ชิ้น</b></div>
                        <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>เวลาเดินสุทธิ → อัตราผลิต</span><br />
                          <b>{fmtMin(orderAnalysis.group.netMin)}</b>{orderAnalysis.group.ratePerHr ? <span style={{ color: 'var(--text2)' }}> · {orderAnalysis.group.ratePerHr} ชิ้น/ชม.</span> : ''}
                        </div>
                        <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>วิ/ชิ้นเฉลี่ย (กลุ่ม){orderAnalysis.group.sameMat && orderAnalysis.stdCt ? ' vs CT' : ''}</span><br />
                          {orderAnalysis.group.sec ? <b>{orderAnalysis.group.sec.toFixed(1)} วิ</b> : '—'}
                          {orderAnalysis.group.sameMat && orderAnalysis.stdCt && <span style={{ color: 'var(--muted)' }}> / {orderAnalysis.stdCt} วิ</span>}
                        </div>
                        <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>ความเร็วเทียบมาตรฐาน{orderAnalysis.group.mats.length > 1 ? ' (ถ่วงน้ำหนัก)' : ''}</span><br />
                          {orderAnalysis.group.speedPct != null
                            ? <b style={{ fontSize: 17, color: orderAnalysis.group.speedPct >= 95 ? '#22c55e' : orderAnalysis.group.speedPct >= 80 ? '#f59e0b' : '#ef4444' }}>{orderAnalysis.group.speedPct}%</b>
                            : <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>— ({orderAnalysis.group.missCtN} ชิ้นงานในกลุ่มยังไม่ตั้ง CT)</span>}
                        </div>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--muted)' }}>
                        เทียบมาตรฐาน = Σ(จำนวน × CT ของชิ้นงานนั้น) ÷ เวลาเดินสุทธิ (สูตรเดียวกับ %P ของ OEE) · หัก DT ในช่วง {Math.round(orderAnalysis.group.dtUnpl)} นาทีนอกแผน / {Math.round(orderAnalysis.group.dtPlan)} นาทีตามแผน
                      </div>
                    </div>
                  )}

                  {/* รายใบ — เชื่อถือได้เฉพาะตอนไม่มีใบอื่นทับ/ไม่ได้สแกนเป็นชุด */}
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
                    {orderAnalysis.groupMode ? '📄 ตัวเลขรายใบ (อ้างอิงเวลาสแกน — ใช้ตัดสินความเร็วไม่ได้)' : '📄 ตัวเลขรายใบ'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px 18px', fontSize: 13, opacity: orderAnalysis.groupMode ? 0.62 : 1 }}>
                    <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>เปิด→ปิดใบ (เวลาสแกน)</span><br /><b>{fmtMin(orderAnalysis.durMin)}</b></div>
                    <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>DT ทับช่วงใบ (นอกแผน/ตามแผน)</span><br />
                      <b style={{ color: orderAnalysis.dtUnpl > 0 ? '#ef4444' : 'var(--text)' }}>{Math.round(orderAnalysis.dtUnpl)} นาที</b>
                      <span style={{ color: 'var(--muted)' }}> / {Math.round(orderAnalysis.dtPlan)} นาที</span>
                      {orderAnalysis.dtUntimed > 0 && <span style={{ color: '#f59e0b', fontSize: 11 }}> (+{Math.round(orderAnalysis.dtUntimed)} นาทีไม่ระบุเวลา)</span>}
                    </div>
                    <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>เวลาเดินสุทธิ → อัตราผลิต</span><br /><b>{fmtMin(orderAnalysis.netMin)}</b>{orderAnalysis.ratePerHr ? <span style={{ color: 'var(--text2)' }}> · {orderAnalysis.ratePerHr} ชิ้น/ชม.</span> : ''}</div>
                    <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>วิ/ชิ้นจริง vs CT มาตรฐาน</span><br />
                      {orderAnalysis.groupMode ? <span style={{ color: 'var(--muted)' }}>— ใช้ไม่ได้</span> : (orderAnalysis.netSec ? <b>{orderAnalysis.netSec.toFixed(1)} วิ</b> : '—')}
                      {orderAnalysis.stdCt ? <span style={{ color: 'var(--muted)' }}> / {orderAnalysis.stdCt} วิ</span> : <span style={{ color: 'var(--muted)' }}> / ไม่ตั้ง CT</span>}
                    </div>
                    <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>ความเร็วเทียบมาตรฐาน</span><br />
                      {orderAnalysis.groupMode
                        ? <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>— ดูค่าระดับกลุ่มด้านบน</span>
                        : orderAnalysis.speedPct != null
                          ? <b style={{ fontSize: 16, color: orderAnalysis.speedPct >= 95 ? '#22c55e' : orderAnalysis.speedPct >= 80 ? '#f59e0b' : '#ef4444' }}>{orderAnalysis.speedPct}%</b>
                          : <span style={{ color: 'var(--muted)' }}>— (ตั้ง CT ที่ Product Master ก่อน)</span>}
                    </div>
                  </div>
                  {!orderAnalysis.groupMode && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>✅ ไม่มีใบอื่นวิ่งทับช่วงนี้ และไม่ได้สแกนเป็นชุด — ตัวเลขรายใบใช้ได้</div>}
                </CollapseCard>
              )}

              {/* ── เครื่องจักร/ใบซ่อม ── */}
              {/* 🏭 อุปกรณ์ที่ใช้ผลิต — ตอบโจทย์ "ของเสีย → เครื่อง/แม่พิมพ์ตัวไหน · ขาด PM ไหม · ใครแตะล่าสุด" */}
              {trace.equip && (
                <CollapseCard id="equip" storePrefix="ot" title="🏭 อุปกรณ์ที่ใช้ผลิต — สภาพบำรุงรักษา ณ เวลาผลิต"
                  count={trace.equip.rows.length}
                  defaultOpen={trace.equip.overdueCount > 0 || trace.equip.freshFixCount > 0 || !!trace.equip.confirmedNo}>

                  {/* ระดับความแน่ชัด — ห้ามให้ "ผู้ต้องสงสัย" ดูเหมือนคำตอบ */}
                  {trace.equip.confirmedNo ? (
                    <div style={{ fontSize: 12, marginBottom: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(34,197,94,.10)', border: '1px solid rgba(34,197,94,.35)' }}>
                      🎯 ใบนี้ระบุเครื่องไว้ชัดเจน: <b>{trace.equip.confirmedNo}</b> — สอบกลับได้ถึงตัวเครื่อง
                    </div>
                  ) : !trace.equip.isParallel ? (
                    /* ไลน์ไหลทีละชิ้น = งานผ่านทุกเครื่องตามลำดับ → ทุกตัว "ถูกใช้จริง" ไม่ใช่ผู้ต้องสงสัย */
                    <div style={{ fontSize: 12, marginBottom: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(34,197,94,.10)', border: '1px solid rgba(34,197,94,.35)' }}>
                      ⛓️ ไลน์ <b>{sess.line_name}</b> เป็นแบบ <b>ไหลทีละชิ้น (one-piece flow)</b> — ใบนี้ <b>ผ่านเครื่องทั้ง {trace.equip.machineCount} ตัวตามลำดับ</b> ทุกตัวจึงเกี่ยวข้องกับคุณภาพของงานใบนี้
                      <div style={{ color: 'var(--muted)', marginTop: 3 }}>
                        {trace.equip.hasStepOrder
                          ? 'เลข "ขั้นที่" มาจากลำดับเครื่องในทะเบียน · เรียงรายการตามตัวที่ควรสงสัยก่อน'
                          : '⚠️ ทะเบียนเครื่องยังไม่ได้ตั้งลำดับ (sort_order) — จึงยังไม่ระบุว่าเครื่องไหนเป็นขั้นที่เท่าไหร่ ตั้งได้ที่ฐานข้อมูลเครื่องจักร'}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, marginBottom: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.35)' }}>
                      ⚠️ ไลน์นี้เป็น <b>เครื่องขนาน</b> (แต่ละใบวิ่งเครื่องเดียว) และ <b>ใบนี้ไม่ได้บันทึกว่าใช้เครื่องไหน</b> — รายการล่างจึงเป็น <b>ผู้ต้องสงสัย</b> ไม่ใช่ข้อสรุป
                      <div style={{ color: 'var(--muted)', marginTop: 3 }}>
                        อยากสอบถึงตัวเครื่อง: เลือกเครื่องตอนเปิด Order — ใบที่เปิดหลังจากนั้นจะระบุเครื่องให้เอง
                      </div>
                    </div>
                  )}

                  {/* ชี้เป้าก่อน ไม่ใช่กองข้อมูลให้อ่านเอง */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, fontSize: 11.5 }}>
                    {trace.equip.overdueCount > 0 && <span style={{ padding: '3px 8px', borderRadius: 999, background: 'rgba(239,68,68,.15)', color: '#ef4444', fontWeight: 700 }}>🔴 PM เกินกำหนด ณ วันผลิต {trace.equip.overdueCount} รายการ</span>}
                    {trace.equip.freshFixCount > 0 && <span style={{ padding: '3px 8px', borderRadius: 999, background: 'rgba(245,158,11,.15)', color: '#f59e0b', fontWeight: 700 }}>🟠 เพิ่งซ่อมเสร็จ ≤7 วันก่อนผลิต {trace.equip.freshFixCount} รายการ</span>}
                    <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--bg3)', color: 'var(--text2)' }}>
                      ⚙️ {trace.equip.isParallel ? 'เครื่องในไลน์' : 'ผ่านเครื่อง'} {trace.equip.machineCount}</span>
                    <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--bg3)', color: 'var(--text2)' }}>🧰 จิ๊ก/แม่พิมพ์ลงทะเบียน {trace.equip.dieCount}</span>
                    {trace.equip.noPlanCount > 0 && <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--bg3)', color: 'var(--muted)' }}>ยังไม่มีแผน PM {trace.equip.noPlanCount}</span>}
                  </div>

                  {/* ไม่มีแผน PM สักตัว = ตอบคำถาม "ขาดบำรุงรักษาไหม" ไม่ได้เลย — ต้องบอกตรงๆ ไม่ใช่โชว์ค่าว่าง */}
                  {trace.equip.rows.length > 0 && trace.equip.noPlanCount === trace.equip.rows.length && (
                    <div style={{ fontSize: 12, marginBottom: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)' }}>
                      🔎 <b>ยังตอบไม่ได้ว่าอุปกรณ์ขาดบำรุงรักษาหรือไม่</b> — อุปกรณ์ทั้ง {trace.equip.rows.length} รายการของไลน์นี้ <b>ยังไม่มีแผน PM สักตัว</b> ระบบจึงไม่มีเกณฑ์ให้เทียบ
                      <div style={{ color: 'var(--muted)', marginTop: 3 }}>ตั้งจุดตรวจ + รอบ PM ที่ PM Setup แล้วใบที่ผลิตหลังจากนั้นจะสอบย้อนได้ว่าตอนผลิตค้าง PM ไหม</div>
                    </div>
                  )}

                  {trace.equip.partial && (
                    <div style={{ fontSize: 11.5, marginBottom: 8, padding: '5px 9px', borderRadius: 6, background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.3)', color: '#f59e0b' }}>
                      ⚠️ โหลดประวัติได้ไม่ครบทุกรายการ — ช่องที่ขึ้นว่า "ไม่มีประวัติ" อาจเป็นเพราะดูไม่ครบ ไม่ใช่ว่าไม่มีจริง (ดู console หากต้องตรวจสอบ)
                    </div>
                  )}

                  {trace.equip.dieCount === 0 && (
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
                      💡 ยังไม่มีจิ๊ก/แม่พิมพ์ตัวจริงลงทะเบียนในไลน์นี้ — ลงข้อมูลที่ PM Setup แล้วสอบกลับถึงตัวแม่พิมพ์ได้เหมือนเครื่องจักร
                    </div>
                  )}

                  {trace.equip.rows.length === 0
                    ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่พบเครื่องจักร/อุปกรณ์ที่ลงทะเบียนกับไลน์นี้</div>
                    : (() => {
                      const Row = ({ r }) => (
                        <div style={{ padding: '8px 10px', borderRadius: 8, marginBottom: 6,
                          border: `1px solid ${r.confirmed ? 'rgba(34,197,94,.45)' : r.overdue > 0 ? 'rgba(239,68,68,.35)' : 'var(--border)'}`,
                          background: r.confirmed ? 'rgba(34,197,94,.06)' : 'var(--bg3)' }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            {r.sortOrder != null && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ขั้นที่ {r.sortOrder}</span>}
                            <b style={{ fontSize: 13 }}>{r.kind === 'die' ? '🧱' : r.kind === 'jig' ? '🧰' : '⚙️'} {r.label}</b>
                            {r.name && <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{r.name}</span>}
                            {r.confirmed && <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>🎯 ใบนี้ระบุ</span>}
                            {r.usage === 'suspect' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>ผู้ต้องสงสัย</span>}
                            {r.overdue > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444' }}>🔴 PM เกินกำหนด {r.overdue} วัน ณ วันผลิต</span>}
                            {r.daysSinceFix != null && r.daysSinceFix <= 7 && <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>🟠 ซ่อมเสร็จ {r.daysSinceFix} วันก่อนผลิต</span>}
                            {r.dts.length > 0 && <span style={{ fontSize: 11, color: '#f59e0b' }}>⏱ มี Downtime ในกะนี้ {r.dts.length} รายการ</span>}
                            {r.amTarget && !r.amDone && <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠ วันนั้นยังไม่ได้ตรวจ AM</span>}
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 4, display: 'grid', gap: 2 }}>
                            <div>🛠️ แผน PM: {r.hasPmPlan
                              ? <>{r.overdue > 0
                                  ? <b style={{ color: '#ef4444' }}>ณ วันผลิต เลยกำหนดมาแล้ว {r.overdue} วัน (ควรตรวจ {fmtDate(r.dueAtProd)})</b>
                                  : r.neverInspected ? <b style={{ color: '#f59e0b' }}>มีแผน PM แต่ไม่พบประวัติการตรวจก่อนวันผลิตเลย</b>
                                  : r.usageOnly ? <span>แผนอิงยอดผลิต — ย้อนสถานะ ณ วันผลิตไม่ได้</span>
                                  : <span style={{ color: '#22c55e' }}>ณ วันผลิต ยังอยู่ในรอบ</span>}
                                {r.planDept ? ` · ทีม ${deptNameOf(r.planDept)}` : ''}
                                {r.nextDue ? <span style={{ color: 'var(--muted)' }}> · รอบถัดไป {fmtDate(r.nextDue)} (ค่าปัจจุบัน)</span> : ''}
                                {r.lastPlanDone ? <span style={{ color: 'var(--muted)' }}> · ทำล่าสุด {fmtDT(r.lastPlanDone)}</span> : ''}</>
                              : <span style={{ color: 'var(--muted)' }}>ยังไม่ได้ตั้งแผน PM ให้อุปกรณ์ตัวนี้</span>}</div>
                            {r.lastInsp && (
                              <div>🔍 ตรวจล่าสุดก่อนผลิต: {fmtDT(r.lastInsp.inspected_at)} · <b>{r.inspName}</b>
                                {' · '}{inspVerdict(r.lastInsp.status)}
                                {r.lastInsp.notes ? ` — ${r.lastInsp.notes}` : ''}</div>
                            )}
                            {r.mos.slice(0, 3).map((m, i) => (
                              <div key={i}>🔧 {m.mo_no || '(รอเลข MO)'} {fmtDT(m.repair_done_at || m.created_at)}
                                {m.problem_detail ? ` — อาการ: ${m.problem_detail}` : ''}
                                {m.root_cause ? ` · สาเหตุ: ${m.root_cause}` : ''}
                                {m.solution ? ` · แก้: ${m.solution}` : ` · สถานะ ${m.status}`}
                                {m.assigned_to ? ` · ช่าง ${m.assigned_to}` : ''}
                                {m.reported_by_name ? ` · แจ้งโดย ${m.reported_by_name}` : ''}</div>
                            ))}
                            {r.mos.length > 3 && <div style={{ color: 'var(--muted)' }}>· มีใบซ่อมอีก {r.mos.length - 3} ใบใน 90 วันก่อนผลิต</div>}
                            {r.audits.slice(0, 2).map((a, i) => (
                              <div key={`a${i}`} style={{ color: 'var(--muted)' }}>✏️ แก้ทะเบียน{Array.isArray(a.changed_fields) && a.changed_fields.length ? ` (${a.changed_fields.join(', ')})` : ''} โดย {a.actor || 'ไม่ทราบ'} · {fmtDT(a.changed_at)}</div>
                            ))}
                            {!r.hasPmPlan && !r.lastInsp && !r.mos.length && (
                              <div style={{ color: 'var(--muted)' }}>
                                {trace.equip.partial ? 'ยังไม่พบประวัติ (โหลดข้อมูลได้ไม่ครบ — ดูแถบเตือนด้านบน)' : 'ไม่มีประวัติบำรุงรักษาก่อนวันผลิต'}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                      const head = trace.equip.rows.slice(0, 8), rest = trace.equip.rows.slice(8);
                      return (<>
                        {head.map(r => <Row key={r.id} r={r} />)}
                        {rest.length > 0 && (
                          <details>
                            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text2)', padding: '4px 0' }}>
                              แสดงอุปกรณ์ที่เหลืออีก {rest.length} รายการ (ความเสี่ยงต่ำกว่า)
                            </summary>
                            <div style={{ marginTop: 6 }}>{rest.map(r => <Row key={r.id} r={r} />)}</div>
                          </details>
                        )}
                      </>);
                    })()}
                </CollapseCard>
              )}

              <CollapseCard id="machine" storePrefix="ot" title="🔧 Downtime & ใบซ่อม MO ในกะ" count={trace.downtimes.length} defaultOpen={trace.downtimes.length > 0 || trace.machineMos.length > 0}>
                {sel.machine_no && (
                  <div style={{ marginBottom: 10, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8, fontSize: 12.5 }}>
                    ⚙️ ใบนี้ผลิตที่เครื่อง <b>{sel.machine_no}</b>
                    {trace.machineMos.length
                      ? <span style={{ color: '#f59e0b' }}> · มีใบซ่อม {trace.machineMos.length} ใบใน 30 วันก่อนเปิดใบ</span>
                      : <span style={{ color: '#22c55e' }}> · ไม่มีใบซ่อมใน 30 วันก่อนหน้า</span>}
                    {trace.machineMos.map((m, i) => (
                      <div key={i} style={{ color: 'var(--text2)', paddingLeft: 14, fontSize: 12 }}>
                        ↳ {fmtDate((m.created_at || '').slice(0, 10))} MO {m.mo_no || '(รอเลข)'} — {m.problem_detail || ''}{m.solution ? ` · แก้: ${m.solution}` : ` (${m.status})`}
                      </div>
                    ))}
                  </div>
                )}
                {trace.downtimes.map((d, i) => {
                  const mo = trace.mos.find(m => m.source_downtime_id === d.id);
                  const planned = d.dr_downtime_types?.category === 'planned';
                  return (
                    <div key={i} style={{ padding: '7px 0', borderTop: i ? '1px solid var(--border2)' : 'none', fontSize: 12.5, opacity: planned ? 0.65 : 1 }}>
                      <b style={{ color: planned ? 'var(--muted)' : '#ef4444' }}>{d.dr_downtime_types?.name_th || '—'}</b>
                      {d.machine_no && <span> · เครื่อง <b>{d.machine_no}</b></span>} · {Math.round(d.duration_min || 0)} นาที
                      <span style={{ color: 'var(--muted)' }}> · {fmtTime(d.started_at)}{d.ended_at ? `–${fmtTime(d.ended_at)}` : ' (เปิดค้าง)'}</span>
                      {d.description && <div style={{ color: 'var(--text2)' }}>💬 {d.description}</div>}
                      {mo && <div style={{ color: 'var(--text2)' }}>🔧 MO <b>{mo.mo_no || '(รอเลข)'}</b> → {deptNameOf(mo.mtn_dept)} · {mo.root_cause ? `สาเหตุ: ${mo.root_cause} · ` : ''}{mo.solution ? `แก้: ${mo.solution}` : `สถานะ ${mo.status}`}{mo.assigned_to ? ` · ช่าง ${mo.assigned_to}` : ''}</div>}
                    </div>
                  );
                })}
                {!trace.downtimes.length && <div style={{ color: 'var(--muted)', fontSize: 12 }}>ไม่มี Downtime ในกะนี้</div>}
              </CollapseCard>

              {/* ── 4M ── */}
              <CollapseCard id="fourm" storePrefix="ot" title="📋 การเปลี่ยนแปลง 4M วันนั้น" count={trace.fourM.length} defaultOpen={trace.fourM.length > 0}>
                {trace.fourM.map((f, i) => (
                  <div key={i} style={{ padding: '5px 0', fontSize: 12.5, borderTop: i ? '1px solid var(--border2)' : 'none' }}>
                    <b>{f.category}</b>{f.change_subtype ? ` / ${f.change_subtype}` : ''} · {f.description || '—'}
                    <span style={{ marginLeft: 8, ...chip('var(--bg3)', f.status === 'approved' ? '#22c55e' : f.status === 'rejected' ? '#ef4444' : '#f59e0b') }}>{f.status}</span>
                  </div>
                ))}
                {!trace.fourM.length && <div style={{ color: 'var(--muted)', fontSize: 12 }}>ไม่มีการเปลี่ยนแปลง 4M ของไลน์นี้ในวันนั้น</div>}
              </CollapseCard>

              {/* ── การตรวจประจำวัน ── */}
              <CollapseCard id="checks" storePrefix="ot" title="✅ การตรวจประจำวัน (Daily PM / Poka-Yoke / LPA)"
                count={(trace.dailyPm ? 1 : 0) + trace.poka.length + trace.lpa.length}
                defaultOpen={Boolean(trace.dailyPm || trace.poka.length || trace.lpa.length)}>
                <div style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
                  {trace.dailyPm && (
                    <div>🔧 Daily PM (AM): เช็คแล้ว <b>{trace.dailyPm.done}/{trace.dailyPm.total}</b> เครื่อง{trace.dailyPm.fail ? <span style={{ color: '#ef4444' }}> · พบ NG {trace.dailyPm.fail} รายการ</span> : ''}</div>
                  )}
                  {trace.poka.map((c, i) => (
                    <div key={`p${i}`}>🛡️ Poka-Yoke {c.dev?.name || ''}{c.dev?.station ? ` (${c.dev.station})` : ''} — {c.result === 'pass' ? <span style={{ color: '#22c55e' }}>ผ่าน</span> : <span style={{ color: '#ef4444' }}>ไม่ผ่าน</span>} · {c.checker_name || '—'}</div>
                  ))}
                  {trace.lpa.map((a, i) => (
                    <div key={`l${i}`}>📋 LPA ชั้น <b>{a.layer}</b>{a.station ? ` @${a.station}` : ''} · ผู้ตรวจ {a.auditor_name || '—'}</div>
                  ))}
                  {!trace.dailyPm && !trace.poka.length && !trace.lpa.length && <div style={{ color: 'var(--muted)' }}>ไม่พบบันทึกการตรวจของวันนั้น</div>}
                </div>
              </CollapseCard>

              {/* ── วัสดุ ── */}
              <CollapseCard id="material" storePrefix="ot" title="🧾 วัสดุ / ล็อตพาร์ทย่อย (child → raw)" count={trace.childLots.length} defaultOpen={trace.childLots.length > 0}>
                {trace.childLots.map((c, i) => (
                  <div key={i} style={{ padding: '6px 0', fontSize: 12.5, borderTop: i ? '1px solid var(--border2)' : 'none' }}>
                    <b>{c.child_mat_no}</b> {c.part_name || ''} · ล็อต {Number(c.lot_qty).toLocaleString()} ชิ้น · ผลิตที่ {c.source_line || '(ของซื้อ)'} · {c.status}
                    {trace.rawReqs.filter(r => r.lot_request_id === c.id).map((r, j) => (
                      <div key={j} style={{ color: 'var(--text2)', paddingLeft: 14 }}>↳ เบิกวัตถุดิบ {r.raw_mat_no} × {Number(r.qty).toLocaleString()} ({r.status})</div>
                    ))}
                  </div>
                ))}
                {!trace.childLots.length && <div style={{ color: 'var(--muted)', fontSize: 12 }}>ไม่มีล็อตพาร์ทย่อยที่ trigger จากใบนี้</div>}
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                  ⚠️ ขอบเขต: ล็อต child = ใบที่ "trigger" การผลิตพาร์ทย่อย (เชื่อมเชิงเวลา ไม่ใช่ identity รายชิ้น) · การเบิกวัตถุดิบสุดทางที่เลข MAT — ระบบยังไม่เก็บ lot no. ของ supplier
                </div>
              </CollapseCard>

              {/* ── stock ── */}
              <CollapseCard id="stock" storePrefix="ot" title="📦 เส้นทาง Stock (เข้าคลัง → ส่งลูกค้า)" count={trace.stockIn.length + trace.stockOut.length} defaultOpen={trace.stockIn.length > 0}>
                {trace.stockIn.map((x, i) => (
                  <div key={`i${i}`} style={{ fontSize: 12.5, padding: '4px 0' }}>📥 {fmtDT(x.created_at)} เข้าคลัง <b>{x.line_name}</b> +{Number(x.qty).toLocaleString()} <span style={{ color: 'var(--muted)' }}>(ผูกใบนี้โดยตรง)</span></div>
                ))}
                {trace.stockOut.map((x, i) => {
                  const sh = x.customer_shipping_orders;
                  return (
                    <div key={`o${i}`} style={{ fontSize: 12.5, padding: '4px 0', opacity: 0.75 }}>
                      🚚 {fmtDT(x.created_at)} ตัดส่ง −{Number(x.qty).toLocaleString()} · {sh
                        ? <>รอบส่ง <b>{sh.due_date} {(sh.ship_time || '').slice(0, 5)}</b> · {sh.customer || '—'}{sh.order_no ? ` · PO ${sh.order_no}` : ''}{sh.shipped_by ? ` · ${sh.shipped_by}` : ''} <span style={{ color: '#22c55e' }}>(ผูกรอบส่งแล้ว)</span></>
                        : x.note}
                    </div>
                  );
                })}
                {!trace.stockIn.length && !trace.stockOut.length && <div style={{ color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีการเคลื่อนไหว stock ที่ผูกใบนี้ (ใบยังไม่ปิด / MAT ไม่เข้าคลังอัตโนมัติ)</div>}
                {trace.stockOut.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                    ⚠️ ขาตัดส่งยังจับคู่กับใบผลิตนี้แบบ <b>เชิงเวลา</b> (MAT เดียวกัน + หลังปิดใบ) — บอกได้ว่าของไปออกรอบส่งไหน แต่ยังไม่ยืนยันว่าเป็นชิ้นที่ผลิตจากใบนี้
                    {trace.stockOutNoLink && <> · <span style={{ color: '#f59e0b' }}>ยังไม่ได้ apply migration 20260811_stock_txn_ref_shipment จึงยังไม่รู้ว่ารอบส่งใบไหน</span></>}
                  </div>
                )}
              </CollapseCard>

              {/* ── ใบอื่นในกะ ── */}
              <CollapseCard id="sessorders" storePrefix="ot" title="🧭 บริบทกะ (กะก่อนหน้า + ใบอื่นในกะ)" count={trace.sessionOrders.length - 1} defaultOpen={false}>
                {trace.prevSession && (
                  <div style={{ marginBottom: 8, padding: '7px 10px', background: 'var(--bg3)', borderRadius: 8, fontSize: 12.5 }}>
                    ⏮ กะก่อนหน้าของไลน์: {fmtDate(trace.prevSession.work_date)} {trace.prevSession.shift === 'night' ? '🌙' : '☀️'}
                    {trace.prevSession.oee != null
                      ? <span> · OEE <b style={{ color: trace.prevSession.oee >= 70 ? '#22c55e' : '#f59e0b' }}>{Number(trace.prevSession.oee).toFixed(1)}%</b> <span style={{ color: 'var(--muted)', fontSize: 11 }}>(A {trace.prevSession.oee_a ?? '—'} / P {trace.prevSession.oee_p ?? '—'} / Q {trace.prevSession.oee_q ?? '—'})</span></span>
                      : <span style={{ color: 'var(--muted)' }}> · ยังไม่ stamp OEE</span>}
                  </div>
                )}
                {trace.sessionOrders.filter(o => o.id !== sel.id).map((o, i) => (
                  <div key={i} style={{ fontSize: 12.5, padding: '4px 0', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <b style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => { const hit = results.find(r => r.id === o.id); if (hit) setSel(hit); else { setSearch(o.prod_no); doSearch(o.prod_no).then(rows => { const h = rows.find(r => r.id === o.id); if (h) setSel(h); }); } }}>{o.prod_no}</b>
                    <span>{o.part_name || o.mat_no}</span>
                    <span style={{ color: 'var(--muted)' }}>{fmtTime(o.opened_at)}{o.confirmed_at ? `–${fmtTime(o.confirmed_at)}` : ''} · {(STATUS_META[o.status] || {}).label || o.status}</span>
                  </div>
                ))}
                {trace.sessionOrders.length <= 1 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>กะนี้มีใบเดียว</div>}
              </CollapseCard>
            </>
          )}
        </>
      )}
    </div>
  );
}
