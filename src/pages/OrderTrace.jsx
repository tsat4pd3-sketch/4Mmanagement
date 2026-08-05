import { useState, useEffect, useMemo, useContext, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { stdGroupOf } from '../utils/stdManpower';
import CollapseCard from '../components/CollapseCard';
import { toast } from '../components/Toast';

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
/* เกณฑ์ "สแกนรวบ" = ช่องว่างระหว่างสแกน < BATCH_FRAC × เวลาที่ต้องใช้ผลิตของใบนั้น (qty × CT)
   0.5 = ต้องผลิตเร็วกว่ามาตรฐาน "2 เท่า" ถึงจะทันในช่วงนั้น → เป็นไปไม่ได้ = สแกนรวบแน่นอน
   (ไม่ใช่เวลาตายตัว — สเกลตามชิ้นงาน/จำนวนของแต่ละใบเอง · ตรวจกับข้อมูลจริง Assy LWR 05/08:
    ทยอยสแกนทุก 33 นาที (need 34 นาที) = ไม่ใช่ชุด ✓ · สแกน 6 ใบห่างกัน 1-3 วินาที = ชุด ✓
    ถ้าใช้ 1.0 จะเหมารวมการทยอยสแกนจริงผิด) */
const BATCH_FRAC = 0.5;
// ใช้เฉพาะตอนคำนวณเวลาผลิตจริงไม่ได้เลย (ไม่มีทั้ง CT และข้อมูลกะ)
const FALLBACK_BATCH_SEC = 180;
const chip = (bg, fg) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: bg, color: fg });

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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name, std_day_shift, std_night_shift').order('name')
      .then(({ data }) => setLines(data || []));
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
    let alive = true;
    (async () => {
      setLoading(true);
      const sess = sel.production_sessions;
      const famNames = getLineFamilyNames(lines, sess.line_name);
      const famLower = famNames.map(n => n.toLowerCase());
      const famIds = lines.filter(l => famLower.includes(l.name.toLowerCase())).map(l => l.id);
      const t = { qtyUpdates: [], defects: [], sessionOrders: [], downtimes: [], mos: [], people: [], stations: {}, fourM: [], childLots: [], rawReqs: [], stockIn: [], stockOut: [], lpa: [], poka: [], dailyPm: null,
        reqsByStation: {}, skillsByEmp: {}, homeByEmp: {}, product: null, prevSession: null, machineMos: [], ojtByEmp: {} };

      // DR — ของใบ/กะ
      const [qu, df, so, dt] = await Promise.all([
        supabaseDR.from('prod_order_qty_updates').select('qty_accum, qty_delta, is_final, logged_at, logged_by').eq('order_id', sel.id).order('logged_at'),
        supabaseDR.from('defect_logs').select('qty_ng, qty_suspect, qty_repair, description, reported_by_name, logged_at, prod_order_id, dr_defect_types(name_th)').eq('session_id', sess.id).order('logged_at'),
        supabaseDR.from('prod_orders').select('id, prod_no, mat_no, part_name, status, qty, qty_ok, opened_at, confirmed_at').eq('session_id', sess.id).order('opened_at'),
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

      // stock: ขาเข้าคลัง (hard link ref_order_id) + ขาตัดส่งของ mat เดียวกันหลังปิดใบ (เชิงเวลา)
      try {
        const { data: si } = await supabaseDR.from('line_stock_transactions')
          .select('line_name, qty, type, note, created_by, created_at').eq('ref_order_id', sel.id).order('created_at');
        t.stockIn = si || [];
        if (sel.confirmed_at) {
          const { data: sc } = await supabaseDR.from('line_stock_transactions')
            .select('line_name, qty, type, note, created_by, created_at')
            .eq('mat_no', sel.mat_no).eq('type', 'consume')
            .gte('created_at', sel.confirmed_at).order('created_at').limit(12);
          t.stockOut = (sc || []).filter(x => (x.note || '').includes('ส่งลูกค้า'));
        }
      } catch { /* ignore */ }

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
          const { data: insp } = await supabaseDR.from('inspections')
            .select('jig_id, status, inspected_at').in('jig_id', jigIds)
            .gte('inspected_at', dayStart).lt('inspected_at', dayEnd);
          t.dailyPm = { total: jigIds.length, done: new Set((insp || []).map(i => i.jig_id)).size, fail: (insp || []).filter(i => i.status === 'fail' || i.status === 'ng').length };
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
    const qtyOf = (o) => Number(o.qty_ok ?? o.qty_actual ?? o.qty) || 0;

    // อัตราจริงเฉลี่ยของกะ (fallback เมื่อชิ้นงานยังไม่ตั้ง CT)
    let sessSecPerPc = null;
    const done = sess.filter(o => o.opened_at && o.confirmed_at && qtyOf(o) > 0);
    if (done.length) {
      const s = Math.min(...done.map(o => new Date(o.opened_at).getTime()));
      const e = Math.max(...done.map(o => new Date(o.confirmed_at).getTime()));
      const q = done.reduce((a, o) => a + qtyOf(o), 0);
      if (e > s && q > 0) sessSecPerPc = (e - s) / 1000 / q;
    }
    // เวลาที่ "ต้องใช้ผลิต" ของใบหนึ่ง (วินาที)
    const prodSec = (o) => {
      const ct = Number(ctMap[o.mat_no]) || 0;
      if (ct > 0) return qtyOf(o) * ct;
      if (sessSecPerPc) return qtyOf(o) * sessSecPerPc;
      return null;
    };
    // จับกลุ่มลูกโซ่ตามเวลาสแกน
    const clusterOf = (key) => {
      const list = sess.filter(o => o[key]).sort((a, b) => new Date(a[key]) - new Date(b[key]));
      if (!list.length) return { members: [], maxGapSec: null };
      const groups = []; let cur = [list[0]];
      for (let i = 1; i < list.length; i++) {
        const gap = (new Date(list[i][key]).getTime() - new Date(list[i - 1][key]).getTime()) / 1000;
        const need = prodSec(list[i]) ?? prodSec(list[i - 1]);
        const sameBatch = need != null ? gap < need * BATCH_FRAC : gap <= FALLBACK_BATCH_SEC;
        if (sameBatch) cur.push(list[i]); else { groups.push(cur); cur = [list[i]]; }
      }
      groups.push(cur);
      const mine = groups.find(g => g.some(o => o.id === sel.id)) || [];
      let maxGapSec = null;
      for (let i = 1; i < mine.length; i++) {
        const g = (new Date(mine[i][key]).getTime() - new Date(mine[i - 1][key]).getTime()) / 1000;
        maxGapSec = Math.max(maxGapSec ?? 0, g);
      }
      return { members: mine, maxGapSec };
    };
    const needSec = prodSec(sel);
    return { open: clusterOf('opened_at'), close: clusterOf('confirmed_at'), needSec,
      needFrom: (Number(ctMap[sel.mat_no]) || 0) > 0 ? 'ct' : (sessSecPerPc ? 'session' : null) };
  }, [sel, trace]);

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
      if (mo) ev.push({ t: d.ended_at || d.started_at || sel.opened_at, icon: '🔧', text: `ใบซ่อม ${mo.mo_no || '(รอเลข MO)'} → ${mo.mtn_dept || ''} ${mo.solution ? `— แก้: ${mo.solution}` : `(${mo.status})`}` });
    });
    trace.fourM.forEach(f => ev.push({ t: f.created_at, icon: '📋', text: `4M ${f.category}${f.change_subtype ? `/${f.change_subtype}` : ''}: ${f.description || ''} (${f.status})` }));
    if (sel.reopened_at) ev.push({ t: sel.reopened_at, icon: '↩️', warn: true, text: `ถอยใบ (ครั้งที่ ${sel.reopen_count || 1}) โดย ${sel.reopened_by || '—'}` });
    if (sel.confirmed_at) ev.push({ t: sel.confirmed_at, icon: '✅', text: `สแกนปิดใบ ผลิตจริง ${sel.qty_ok ?? sel.qty} ชิ้น โดย ${sel.confirmed_by || '—'}${batchNote('close')}` });
    trace.stockIn.forEach(x => ev.push({ t: x.created_at, icon: '📦', text: `เข้าคลัง ${x.line_name} +${Number(x.qty).toLocaleString()} (${x.created_by})` }));
    trace.stockOut.forEach(x => ev.push({ t: x.created_at, icon: '🚚', dim: true, text: `ตัดส่งลูกค้า −${Number(x.qty).toLocaleString()} · ${x.note || ''} (โดยประมาณ — ตัดจากยอดรวม mat เดียวกัน)` }));
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
      batchMaxGapSec: Math.max(scanBatch.open.maxGapSec ?? 0, scanBatch.close.maxGapSec ?? 0) || null,
      batchNeedSec: scanBatch.needSec, batchNeedFrom: scanBatch.needFrom };
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
      <div style={{ paddingRight: 52, marginBottom: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>🔎 สอบกลับ Order (Order Traceability)</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>สแกน/ค้นหาใบผลิต → เห็นทุกเหตุการณ์ + สถานการณ์รอบข้าง ณ เวลาผลิตใบนั้น</div>
      </div>

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
                        <> — สแกนห่างกันสูงสุด <b>{fmtDur(orderAnalysis.batchMaxGapSec)}</b> แต่ของใบนี้ต้องใช้เวลาผลิต ~<b>{fmtDur(orderAnalysis.batchNeedSec)}</b>
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
                      {mo && <div style={{ color: 'var(--text2)' }}>🔧 MO <b>{mo.mo_no || '(รอเลข)'}</b> → {mo.mtn_dept} · {mo.root_cause ? `สาเหตุ: ${mo.root_cause} · ` : ''}{mo.solution ? `แก้: ${mo.solution}` : `สถานะ ${mo.status}`}{mo.assigned_to ? ` · ช่าง ${mo.assigned_to}` : ''}</div>}
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
                {trace.stockOut.map((x, i) => (
                  <div key={`o${i}`} style={{ fontSize: 12.5, padding: '4px 0', opacity: 0.75 }}>🚚 {fmtDT(x.created_at)} ตัดส่ง −{Number(x.qty).toLocaleString()} · {x.note}</div>
                ))}
                {!trace.stockIn.length && !trace.stockOut.length && <div style={{ color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีการเคลื่อนไหว stock ที่ผูกใบนี้ (ใบยังไม่ปิด / MAT ไม่เข้าคลังอัตโนมัติ)</div>}
                {trace.stockOut.length > 0 && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>⚠️ การตัดส่งเป็นยอดรวมของ MAT เดียวกัน (ไม่ผูกรายใบ) — ใช้ช่วงเวลาประกอบการตีความ</div>}
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
