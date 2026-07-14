import { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import useIsMobile from '../utils/useIsMobile';
import { fmtDate } from '../utils/dateFormat';

/* ═══ ประชุมแถวเช้า (Morning Meeting) ══════════════════════════════════════
   วาระเดียวจบ: เมื่อวานได้ตามเป้ามั้ย → งานหลุดแผนเพราะอะไร → Top Downtime/NG
   → 4M → เช้านี้พร้อมมั้ย → Action items (ติดตามข้ามวันจนปิด)
   ข้อมูลดึงอัตโนมัติจากตารางที่มีอยู่แล้วทั้งหมด — ไม่ต้องมีใครทำสไลด์
   ตารางใหม่ตารางเดียว: meeting_action_items (Main) — migration 20260713_morning_meeting.sql
   ══════════════════════════════════════════════════════════════════════════ */

// work date เดียวกับกฎทั้งระบบ: ก่อน 08:00 นับเป็นวันก่อนหน้า (กะดึกข้ามวัน)
const getWorkDate = () => {
  const now = new Date();
  if (now.getHours() < 8) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const dayAdd = (str, n) => {
  const d = new Date(`${str}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// วันที่ประชุมทบทวน = วันงานล่าสุดที่จบไปแล้ว: ช่วงประชุม 07:30-08:00 getWorkDate() ยังเป็นเมื่อวานอยู่แล้ว
// เปิดหลัง 08:00 (work date ขยับเป็นวันนี้แล้ว) ค่อยถอยหนึ่งวัน
const defaultMeetingDate = () => (new Date().getHours() < 8 ? getWorkDate() : dayAdd(getWorkDate(), -1));

const SHIFT_LABEL = { day: '☀️ กะเช้า', night: '🌙 กะดึก' };
const ACT_STATUS = {
  open:      { label: 'รอดำเนินการ', color: '#f59e0b' },
  doing:     { label: 'กำลังทำ',     color: '#4d9fff' },
  done:      { label: 'เสร็จแล้ว',   color: '#22c55e' },
  cancelled: { label: 'ยกเลิก',      color: '#94a3b8' },
};
const FOURM_STATUS = {
  pending:    { label: 'รอ SV',  color: '#f59e0b' },
  pending_qa: { label: 'รอ QA',  color: '#f59e0b' },
  approved:   { label: 'อนุมัติ', color: '#22c55e' },
  rejected:   { label: 'Reject', color: '#ef4444' },
};
const achieveColor = (pct) => (pct >= 100 ? '#22c55e' : pct >= 85 ? '#f59e0b' : '#ef4444');
const pctStr = (num, den) => (den > 0 ? Math.round((num / den) * 100) : 0);

export default function MorningMeeting() {
  const { role, lineId: userLineId, sections: scopeSecs = [], fullName } = useContext(UserContext);
  const isMobile = useIsMobile();
  const canRecord = can('morning_meeting', 'record', role);

  const [meetingDate, setMeetingDate] = useState(defaultMeetingDate);
  const [allLines, setAllLines]       = useState([]);
  const [secFilter, setSecFilter]     = useState('');
  const [loading, setLoading]         = useState(true);
  const [sessions, setSessions]       = useState([]);
  const [downtimes, setDowntimes]     = useState([]);
  const [defects, setDefects]         = useState([]);
  const [orders, setOrders]           = useState([]);
  const [fourM, setFourM]             = useState([]);
  const [attendance, setAttendance]   = useState([]);
  const [openDts, setOpenDts]         = useState([]); // เครื่องที่ยังซ่อมค้าง "ตอนนี้" (readiness)
  const [machineCountByLine, setMachineCountByLine] = useState({}); // จำนวนเครื่องต่อไลน์ — ฐานคิด % Downtime
  const [actions, setActions]         = useState([]);
  const [tvMode, setTvMode]           = useState(false);
  const [slide, setSlide]             = useState(0);
  const [actModal, setActModal]       = useState(null); // { problem, root_cause, line_name, assignee, due_date, ref_kind, ref_id }
  const [savingAct, setSavingAct]     = useState(false);
  const [sendingTg, setSendingTg]     = useState(false);

  /* ── ไลน์ใน scope — branch ของ leader มาก่อน section scope เสมอ (กฎ D2) ── */
  const scopedLines = useMemo(() => {
    if (role === 'leader' && userLineId) {
      const fam = new Set(getLineFamilyNames(allLines, userLineId));
      return allLines.filter(l => fam.has(l.name));
    }
    if (scopeSecs.length) return allLines.filter(l => inSectionScope(scopeSecs, l.section));
    return allLines;
  }, [allLines, role, userLineId, scopeSecs]);

  const sectionOpts = useMemo(
    () => [...new Set(scopedLines.map(l => l.section).filter(Boolean))].sort(),
    [scopedLines]
  );
  const viewLines = useMemo(
    () => (secFilter ? scopedLines.filter(l => l.section === secFilter) : scopedLines),
    [scopedLines, secFilter]
  );
  // ไลน์ระดับใบ (leaf) — parent ที่มีลูกไม่ต้องแสดงการ์ดซ้ำ (ยอดไปรวมอยู่ที่ลูกแล้ว)
  const leafLines = useMemo(
    () => viewLines.filter(l => !viewLines.some(o => o.parent_line_name === l.name)),
    [viewLines]
  );
  const lineNames = useMemo(() => viewLines.map(l => l.name), [viewLines]);
  const secByLine = useMemo(() => {
    const m = {};
    allLines.forEach(l => { m[l.name] = l.section; });
    return m;
  }, [allLines]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('production_lines')
        .select('id, name, section, parent_line_name, std_day_shift, std_night_shift')
        .order('name');
      setAllLines(data || []);
    })();
  }, []);

  /* ── โหลดข้อมูลของวันประชุม ── */
  const load = useCallback(async () => {
    if (!allLines.length) return;
    if (!lineNames.length) {
      setSessions([]); setDowntimes([]); setDefects([]); setOrders([]);
      setFourM([]); setAttendance([]); setOpenDts([]); setActions([]); setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const D = meetingDate;
      const [{ data: sess }, { data: fm }, { data: att }, { data: actToday }, { data: actCarry }, { data: mcs }] = await Promise.all([
        supabaseDR.from('production_sessions')
          .select('*, dr_products(name, mat_no)')
          .eq('work_date', D).in('line_name', lineNames).limit(500),
        supabase.from('four_m_logs')
          .select('id, line_name, category, change_subtype, description, status, created_at')
          .eq('work_date', D).in('line_name', lineNames).order('created_at'),
        // assigned_line เก็บ "id จุดงาน" ไม่ใช่ชื่อไลน์ — หาไลน์ของคนผ่าน employees.line_id แทน
        supabase.from('daily_production_logs')
          .select('employee_id, is_present, leave_type, shift, employees(line_id)')
          .eq('work_date', D).limit(3000),
        supabase.from('meeting_action_items')
          .select('*').eq('meeting_date', D).order('created_at'),
        supabase.from('meeting_action_items')
          .select('*').in('status', ['open', 'doing']).lt('meeting_date', D)
          .order('meeting_date').limit(200),
        // ทะเบียนเครื่องต่อไลน์ — ใช้เป็นฐานเวลาเครื่องรวม (เครื่อง × นาทีกะที่เปิด) เทียบ % Downtime
        supabaseDR.from('machines').select('machine_no, line_name').in('line_name', lineNames).limit(1000),
      ]);
      setSessions(sess || []);
      const mCnt = {};
      (mcs || []).forEach(m => { mCnt[m.line_name] = (mCnt[m.line_name] || 0) + 1; });
      setMachineCountByLine(mCnt);
      setFourM(fm || []);
      // ผูกแถวเช็คชื่อเข้ากับ "ชื่อไลน์" ผ่าน employees.line_id แล้วกรองเฉพาะไลน์ใน scope
      const nameByLineId = {};
      allLines.forEach(l => { nameByLineId[l.id] = l.name; });
      const lineNameSet = new Set(lineNames);
      setAttendance((att || [])
        .map(a => ({ ...a, _line: nameByLineId[a.employees?.line_id] || null }))
        .filter(a => a._line && lineNameSet.has(a._line)));
      // action วันนี้ + ค้างจากวันก่อน — กรอง scope ที่ client (section/line เก็บ denormalized)
      const inScope = (a) =>
        (!a.line_name && !a.section) ||
        (a.line_name && lineNames.includes(a.line_name)) ||
        (a.section && viewLines.some(l => l.section === a.section));
      const carry = (actCarry || []).map(a => ({ ...a, _carry: true }));
      setActions([...carry, ...(actToday || [])].filter(inScope));

      const ids = (sess || []).map(s => s.id);
      if (ids.length) {
        const [{ data: dt }, { data: def }, { data: po }] = await Promise.all([
          supabaseDR.from('downtime_logs')
            .select('*, dr_downtime_types(name_th, color, category)').in('session_id', ids),
          supabaseDR.from('defect_logs')
            .select('*, dr_defect_types(name_th, color), prod_orders(prod_no, part_name, mat_no)').in('session_id', ids),
          supabaseDR.from('prod_orders').select('*').in('session_id', ids).order('opened_at'),
        ]);
        setDowntimes(dt || []); setDefects(def || []); setOrders(po || []);
      } else {
        setDowntimes([]); setDefects([]); setOrders([]);
      }

      // readiness: เครื่องที่ยังซ่อมค้าง "ตอนนี้" — มองจากกะ 3 วันล่าสุด (รวม carry-over ข้ามกะ)
      const { data: recentSess } = await supabaseDR.from('production_sessions')
        .select('id, line_name, shift')
        .gte('work_date', dayAdd(getWorkDate(), -2)).in('line_name', lineNames).limit(300);
      const rIds = (recentSess || []).map(s => s.id);
      if (rIds.length) {
        const { data: odt } = await supabaseDR.from('downtime_logs')
          .select('*, dr_downtime_types(name_th, color)')
          .in('session_id', rIds).is('ended_at', null).is('duration_min', null).limit(100);
        const lineBySess = {};
        (recentSess || []).forEach(s => { lineBySess[s.id] = s.line_name; });
        setOpenDts((odt || []).map(d => ({ ...d, _line: lineBySess[d.session_id] })));
      } else setOpenDts([]);
    } finally {
      setLoading(false);
    }
  }, [allLines.length, lineNames, viewLines, meetingDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  /* ── สรุปตัวเลข ── */
  const ordersBySession = useMemo(() => {
    const m = {};
    orders.forEach(o => { (m[o.session_id] = m[o.session_id] || []).push(o); });
    return m;
  }, [orders]);
  // เป้าของกะ: target_qty ของกะ → รวมเป้าใบงานจริง (qty_target ?? qty) → std ของไลน์
  // (กะที่ไม่ตั้ง target และ std = 0 เคยโชว์ "เป้า 0 / 0%" ทั้งที่มีใบงาน — ให้ยึดใบงานจริงก่อน)
  const sessTarget = (s) => {
    if (s.target_qty) return s.target_qty;
    const os = (ordersBySession[s.id] || []).filter(o => !['cancelled', 'imported', 'carry_over'].includes(o.status));
    const fromOrders = os.reduce((a, o) => a + (o.qty_target ?? o.qty ?? 0), 0);
    if (fromOrders) return fromOrders;
    const l = viewLines.find(x => x.name === s.line_name);
    return (s.shift === 'night' ? l?.std_night_shift : l?.std_day_shift) || 0;
  };
  // ยอดจริงของกะ: qty_ok (ปิดกะแล้ว) → actual_qty → รวมยอดจริงจากใบงาน (qty_ok ?? qty_actual)
  const sessActual = (s) => {
    if (s.qty_ok != null) return s.qty_ok;
    if (s.actual_qty) return s.actual_qty;
    return (ordersBySession[s.id] || []).reduce((a, o) => a + (o.qty_ok ?? o.qty_actual ?? 0), 0);
  };
  const sum = useMemo(() => {
    let actual = 0, target = 0;
    sessions.forEach(s => {
      actual += sessActual(s);
      target += sessTarget(s);
    });
    const closed = sessions.filter(s => s.status === 'closed' && s.oee != null);
    const oeeAvg = closed.length ? Math.round(closed.reduce((a, s) => a + Number(s.oee), 0) / closed.length) : null;
    // แยก นอกแผน/ในแผน — ตัวชี้วัดหลักนับเฉพาะ "นอกแผน" (ในแผน เช่น นับสต็อก/ไม่มีแผนผลิต
    // เป็นเรื่องปกติ ไม่ใช่ความเสียหาย ถ้ารวมจะกลบตัวเลขจริงจนดูวิกฤตเกินเหตุ)
    const isPlanned = (d) => d.dr_downtime_types?.category === 'planned';
    const dtMin = Math.round(downtimes.filter(d => !isPlanned(d)).reduce((a, d) => a + (Number(d.duration_min) || 0), 0));
    const dtPlannedMin = Math.round(downtimes.filter(isPlanned).reduce((a, d) => a + (Number(d.duration_min) || 0), 0));
    const dtCount = downtimes.filter(d => !isPlanned(d)).length;
    // ฐานเวลาเครื่องรวม = Σ ต่อกะที่เปิด (นาทีกะ × จำนวนเครื่องของไลน์นั้น) — ให้ % Downtime
    // เทียบได้ว่าเยอะ/น้อยแค่ไหน (ไลน์ไม่มีทะเบียนเครื่องนับเป็น 1 เครื่อง · กะเปิดค้างไม่มี shift_min ใช้ 570 = 9.5 ชม.)
    let dtBaseMin = 0, dtMachines = 0;
    const seenLines = new Set();
    sessions.forEach(s => {
      const mc = machineCountByLine[s.line_name] || 1;
      dtBaseMin += (s.shift_min || 570) * mc;
      if (!seenLines.has(s.line_name)) { seenLines.add(s.line_name); dtMachines += mc; }
    });
    const dtPct = dtBaseMin > 0 ? Math.round((dtMin / dtBaseMin) * 1000) / 10 : null;
    const ng = sessions.reduce((a, s) => a + (s.qty_ng ?? 0), 0);
    const present = attendance.filter(a => a.is_present).length;
    return {
      actual, target, achieve: pctStr(actual, target), oeeAvg,
      dtMin, dtCount, dtPlannedMin, dtBaseMin, dtPct, dtMachines, ng,
      present, attTotal: attendance.length,
    };
  }, [sessions, downtimes, attendance, viewLines, orders, machineCountByLine]); // eslint-disable-line react-hooks/exhaustive-deps

  // ผลต่อไลน์ (การ์ด) — เฉพาะ leaf lines, ไลน์ไม่เปิดกะ = เทา
  const lineResults = useMemo(() => leafLines.map(l => {
    const ss = sessions.filter(s => s.line_name === l.name);
    const shifts = ['day', 'night'].map(sh => {
      const s = ss.find(x => x.shift === sh);
      if (!s) return null;
      const actual = sessActual(s);
      const target = sessTarget(s);
      return {
        shift: sh, actual, target, pct: target > 0 ? pctStr(actual, target) : null,
        oee: s.status === 'closed' ? s.oee : null, status: s.status,
        ng: s.qty_ng ?? 0,
        dtMin: Math.round(downtimes.filter(d => d.session_id === s.id).reduce((a, d) => a + (Number(d.duration_min) || 0), 0)),
      };
    }).filter(Boolean);
    return { line: l, shifts };
  }), [leafLines, sessions, downtimes, orders]); // eslint-disable-line react-hooks/exhaustive-deps

  // งานหลุดแผน — order ที่ยอดจริงไม่ถึงเป้า หรือยังค้าง (open/carry_over)
  const missedOrders = useMemo(() => {
    const sessById = {};
    sessions.forEach(s => { sessById[s.id] = s; });
    return orders.filter(o => !['imported', 'cancelled'].includes(o.status)).map(o => {
      const target = o.qty_target ?? o.qty ?? 0;
      const actual = o.qty_ok ?? o.qty_actual ?? 0;
      const unfinished = ['open', 'carry_over'].includes(o.status);
      if (!(actual < target || unfinished)) return null;
      const sess = sessById[o.session_id];
      const line = sess?.line_name || '-';
      // เดาสาเหตุอัตโนมัติจากข้อมูลที่บันทึกไว้แล้วของกะเดียวกัน
      const dts = downtimes.filter(d => d.session_id === o.session_id);
      const dtMin = Math.round(dts.reduce((a, d) => a + (Number(d.duration_min) || 0), 0));
      const topDt = (() => {
        // สาเหตุจาก downtime: เน้นนอกแผนก่อน (planned เช่น นับสต็อกไม่ใช่สาเหตุงานหลุด) — ไม่มีนอกแผนค่อย fallback
        const pool = dts.filter(d => d.dr_downtime_types?.category !== 'planned');
        const g = {};
        (pool.length ? pool : dts).forEach(d => {
          const k = d.dr_downtime_types?.name_th || 'Downtime';
          g[k] = (g[k] || 0) + (Number(d.duration_min) || 0);
        });
        const top = Object.entries(g).sort((a, b) => b[1] - a[1])[0];
        return top ? `${top[0]} ${Math.round(top[1])} นาที` : null;
      })();
      const absent = attendance.filter(a => a._line === line && !a.is_present && !a.leave_type).length;
      const fmPending = fourM.filter(m => m.line_name === line && ['pending', 'pending_qa'].includes(m.status)).length;
      const causes = [];
      if (topDt) causes.push({ icon: '🛠️', text: topDt, color: '#ef4444' });
      if ((o.qty_ng ?? 0) > 0) causes.push({ icon: '❌', text: `NG ${o.qty_ng}`, color: '#ef4444' });
      if (absent > 0) causes.push({ icon: '👤', text: `ขาด ${absent} คน`, color: '#f59e0b' });
      if (fmPending > 0) causes.push({ icon: '🔄', text: `4M ค้าง ${fmPending}`, color: '#f59e0b' });
      if (unfinished) causes.push({ icon: '⏳', text: o.status === 'carry_over' ? 'ยกยอดข้ามกะ' : 'ใบยังไม่ปิด', color: '#94a3b8' });
      return { o, line, shift: sess?.shift, target, actual, gap: Math.max(0, target - actual), unfinished, dtMin, causes };
    }).filter(Boolean).sort((a, b) => b.gap - a.gap);
  }, [orders, sessions, downtimes, attendance, fourM]);

  // แยก นอกแผน (ตัวจริงที่ต้องคุยในประชุม — มีแถบ+note) / ในแผน (planned: นับสต็อก ฯลฯ — โชว์จางๆ ท้ายแผง)
  const topDowntime = useMemo(() => {
    const g = {};
    downtimes.forEach(d => {
      const k = d.dr_downtime_types?.name_th || 'ไม่ระบุ';
      g[k] = g[k] || { name: k, color: d.dr_downtime_types?.color, planned: d.dr_downtime_types?.category === 'planned', min: 0, count: 0, machines: new Set(), carry: false, descs: {} };
      const min = Number(d.duration_min) || 0;
      g[k].min += min;
      g[k].count += 1;
      if (d.machine_no) g[k].machines.add(d.machine_no);
      if (d.carry_over) g[k].carry = true;
      // เก็บ note ที่พนักงานพิมพ์ — สำคัญมากกับประเภทกว้างๆ อย่าง "อื่นๆ" ที่ชื่อประเภทบอกอะไรไม่ได้
      const desc = (d.description || '').trim() || '(ไม่ระบุรายละเอียด)';
      g[k].descs[desc] = (g[k].descs[desc] || 0) + min;
    });
    const all = Object.values(g).map(x => ({ ...x, topDescs: Object.entries(x.descs).sort((a, b) => b[1] - a[1]).slice(0, 3) }));
    return {
      unplanned: all.filter(x => !x.planned).sort((a, b) => b.min - a.min).slice(0, 6),
      planned: all.filter(x => x.planned).sort((a, b) => b.min - a.min).slice(0, 4),
    };
  }, [downtimes]);

  const topDefects = useMemo(() => {
    const g = {};
    defects.forEach(d => {
      const k = `${d.dr_defect_types?.name_th || 'ไม่ระบุ'}|${d.prod_orders?.part_name || d.prod_orders?.mat_no || ''}`;
      g[k] = g[k] || { type: d.dr_defect_types?.name_th || 'ไม่ระบุ', part: d.prod_orders?.part_name || d.prod_orders?.mat_no || '-', qty: 0, descs: {} };
      const q = (d.qty_ng ?? 0) + (d.qty_suspect ?? 0);
      g[k].qty += q;
      const desc = (d.description || '').trim();
      if (desc) g[k].descs[desc] = (g[k].descs[desc] || 0) + q;
    });
    return Object.values(g).filter(x => x.qty > 0)
      .map(x => ({ ...x, topDescs: Object.entries(x.descs).sort((a, b) => b[1] - a[1]).slice(0, 2) }))
      .sort((a, b) => b.qty - a.qty).slice(0, 6);
  }, [defects]);

  const openActions = actions.filter(a => ['open', 'doing'].includes(a.status));

  /* ── Action items ── */
  const openActModal = (prefill = {}) => setActModal({
    problem: '', root_cause: '', line_name: '', assignee: '', due_date: dayAdd(getWorkDate(), 3),
    ref_kind: null, ref_id: null, ...prefill,
  });
  const saveAction = async () => {
    if (!actModal.problem.trim()) return toast.error('กรุณาระบุปัญหา/สิ่งที่ต้องทำ');
    setSavingAct(true);
    try {
      const { data: { user } = {} } = await supabase.auth.getUser();
      const { error } = await supabase.from('meeting_action_items').insert({
        meeting_date: meetingDate,
        section: actModal.line_name ? (secByLine[actModal.line_name] || secFilter || null) : (secFilter || null),
        line_name: actModal.line_name || null,
        problem: actModal.problem.trim(),
        root_cause: actModal.root_cause?.trim() || null,
        ref_kind: actModal.ref_kind, ref_id: actModal.ref_id,
        assignee: actModal.assignee?.trim() || null,
        due_date: actModal.due_date || null,
        created_by: user?.id || null, created_by_name: fullName || null,
      });
      if (error) throw error;
      toast.success('บันทึก Action Item แล้ว');
      setActModal(null);
      load();
    } catch (e) {
      toast.error(`บันทึกไม่สำเร็จ: ${e.message}`);
    } finally {
      setSavingAct(false);
    }
  };
  const setActStatus = async (a, status) => {
    const patch = { status, updated_at: new Date().toISOString() };
    if (status === 'done') patch.done_at = new Date().toISOString();
    const { error } = await supabase.from('meeting_action_items').update(patch).eq('id', a.id);
    if (error) return toast.error(error.message);
    setActions(prev => prev.map(x => (x.id === a.id ? { ...x, ...patch } : x)));
  };

  /* ── ส่งสรุปเข้า Telegram ── */
  const scopeLabel = secFilter || (sectionOpts.length ? sectionOpts.join('+') : 'ทุกส่วนงาน');
  const sendTelegram = async () => {
    setSendingTg(true);
    try {
      const missedList = missedOrders.slice(0, 5)
        .map(m => `• ${m.line} · ${m.o.part_name || m.o.mat_no || m.o.prod_no}: ${m.actual}/${m.target} (ขาด ${m.gap})`)
        .join('\n');
      const dtTop = topDowntime.unplanned.slice(0, 3).map(t => `${t.name} ${Math.round(t.min)}น.`).join(' · ');
      const { error } = await supabase.functions.invoke('send-notification', {
        body: {
          event: 'morning_meeting',
          summary: {
            work_date: meetingDate, scope_label: scopeLabel,
            total_actual: sum.actual, total_target: sum.target, achieve_pct: sum.achieve,
            oee_avg: sum.oeeAvg ?? '-', dt_total_min: sum.dtMin, dt_count: sum.dtCount,
            ng_total: sum.ng, dt_top: dtTop,
            missed_count: missedOrders.length, missed_list: missedList,
            action_open: openActions.length, actor: fullName || '-',
          },
        },
      });
      if (error) throw error;
      toast.success('ส่งสรุปเข้า Telegram แล้ว');
    } catch (e) {
      toast.error(`ส่งไม่สำเร็จ: ${e.message}`);
    } finally {
      setSendingTg(false);
    }
  };

  /* ── พิมพ์สรุป (แบบเดียวกับ Report: เปิดหน้าต่างใหม่ + window.print) ── */
  const handlePrint = () => {
    const td = 'border:1px solid #ccc;padding:3px 6px';
    const missedRows = missedOrders.map(m =>
      `<tr><td style="${td}">${m.line}</td><td style="${td}">${m.o.part_name || m.o.mat_no || m.o.prod_no}</td>
       <td style="${td};text-align:right">${m.target}</td><td style="${td};text-align:right">${m.actual}</td>
       <td style="${td};text-align:right;color:#c00">${m.gap}</td>
       <td style="${td}">${m.causes.map(c => c.text).join(', ') || '-'}</td></tr>`).join('');
    const dtRows = topDowntime.unplanned.map(t =>
      `<tr><td style="${td}">${t.name}</td><td style="${td};text-align:right">${Math.round(t.min)}</td>
       <td style="${td};text-align:right">${t.count}</td><td style="${td}">${[...t.machines].join(', ')}</td></tr>`).join('');
    const actRows = actions.map(a =>
      `<tr><td style="${td}">${a._carry ? `⏮ ${fmtDate(a.meeting_date)}` : 'วันนี้'}</td><td style="${td}">${a.line_name || '-'}</td>
       <td style="${td}">${a.problem}${a.root_cause ? ` (สาเหตุ: ${a.root_cause})` : ''}</td>
       <td style="${td}">${a.assignee || '-'}</td><td style="${td}">${a.due_date ? fmtDate(a.due_date) : '-'}</td>
       <td style="${td}">${ACT_STATUS[a.status]?.label || a.status}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><title>สรุปประชุมแถวเช้า ${fmtDate(meetingDate)}</title>
<style>body{font-family:'Sarabun',sans-serif;font-size:13px;margin:24px}h1{font-size:18px}h2{font-size:14px;margin:16px 0 6px}table{border-collapse:collapse;width:100%}</style></head><body>
<h1>🌅 สรุปประชุมแถวเช้า — ${fmtDate(meetingDate)} · ${scopeLabel}</h1>
<p>📦 ผลิตรวม <b>${sum.actual}${sum.target > 0 ? `/${sum.target} (${sum.achieve}%)` : ' (ไม่มีเป้าให้เทียบ)'}</b> · 📊 OEE เฉลี่ย ${sum.oeeAvg ?? '-'}% ·
⏱️ Downtime ${sum.dtMin} นาที (${sum.dtCount} ครั้ง${sum.dtPct != null ? ` = ${sum.dtPct}% ของเวลาเครื่องรวม ≈${Math.round(sum.dtBaseMin / 60)} ชม. · ${sum.dtMachines} เครื่อง` : ''} — รวมทุกไลน์/เครื่อง เวลาซ้อนกันได้) · ❌ NG ${sum.ng} · 👥 เข้างาน ${sum.present}/${sum.attTotal}</p>
<h2>📉 งานหลุดแผน (${missedOrders.length})</h2>
<table><tr><th style="${td}">ไลน์</th><th style="${td}">พาร์ท</th><th style="${td}">เป้า</th><th style="${td}">ได้จริง</th><th style="${td}">ขาด</th><th style="${td}">สาเหตุ</th></tr>${missedRows || `<tr><td colspan="6" style="${td}">— ไม่มี —</td></tr>`}</table>
<h2>🛠️ Top Downtime นอกแผน</h2>
<table><tr><th style="${td}">สาเหตุ</th><th style="${td}">นาที</th><th style="${td}">ครั้ง</th><th style="${td}">เครื่อง</th></tr>${dtRows || `<tr><td colspan="4" style="${td}">— ไม่มี —</td></tr>`}</table>
<h2>📌 Action Items</h2>
<table><tr><th style="${td}">จากวัน</th><th style="${td}">ไลน์</th><th style="${td}">เรื่อง</th><th style="${td}">ผู้รับผิดชอบ</th><th style="${td}">กำหนด</th><th style="${td}">สถานะ</th></tr>${actRows || `<tr><td colspan="6" style="${td}">— ไม่มี —</td></tr>`}</table>
<p style="margin-top:18px;color:#888">พิมพ์จาก ESM Morning Meeting · ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</p>
<script>window.onload = () => window.print();</script></body></html>`;
    const w = window.open('', '_blank'); w.document.write(html); w.document.close();
  };

  /* ═══ ส่วนแสดงผลแต่ละวาระ — ใช้ร่วมกันทั้งโหมดปกติและโหมด TV ═══ */

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
  const h2St = { margin: '0 0 10px', fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: 8 };
  const chip = (color, bg) => ({ fontSize: 11, fontWeight: 700, color, background: bg || `${color}22`, border: `1px solid ${color}55`, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' });

  const KpiStrip = () => (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 10 }}>
      {[
        // เป้า 0 = ยังไม่มีเป้าให้เทียบ (ไม่ตั้ง target/std และไม่มีใบงาน) — โชว์ "—" ไม่ใช่ 0% แดง
        sum.target > 0
          ? { label: 'ผลิตรวม (ชิ้น)', value: `${sum.actual.toLocaleString()}/${sum.target.toLocaleString()}`, sub: `${sum.achieve}% ของเป้า`, color: achieveColor(sum.achieve) }
          : { label: 'ผลิตรวม (ชิ้น)', value: sum.actual.toLocaleString(), sub: 'ไม่มีเป้าให้เทียบ (ยังไม่ตั้ง target/std)', color: 'var(--text)' },
        { label: 'OEE เฉลี่ย', value: sum.oeeAvg != null ? `${sum.oeeAvg}%` : '—', sub: 'เฉพาะกะที่ปิดแล้ว', color: sum.oeeAvg == null ? 'var(--muted)' : sum.oeeAvg >= 85 ? '#22c55e' : sum.oeeAvg >= 65 ? '#f59e0b' : '#ef4444' },
        // ผลรวมนาทีของ "ทุกรายการทุกเครื่องทุกไลน์" (เวลาซ้อนกันได้) เทียบกับฐานเวลาเครื่องรวม
        // ที่มีจริงของวันนั้น → % ทำให้เห็นทันทีว่าเยอะหรือน้อย (เกณฑ์สี: <3% เขียว · 3-8% เหลือง · >8% แดง)
        sum.dtPct != null
          ? {
              label: 'Downtime นอกแผน', value: `${sum.dtPct}%`,
              // sub ต้องสั้นพอไม่ล้นการ์ด — รายละเอียดเต็ม (สูตรฐาน) อยู่ใน tooltip
              sub: `${sum.dtMin.toLocaleString()} นาที · ${sum.dtCount} ครั้ง / ฐาน ≈${Math.round(sum.dtBaseMin / 60).toLocaleString()} ชม.${sum.dtPlannedMin ? ` · ในแผนอีก ${sum.dtPlannedMin.toLocaleString()} น.` : ''}`,
              title: `Downtime นอกแผน ${sum.dtMin.toLocaleString()} นาที (≈${(sum.dtMin / 60).toFixed(1)} ชม.) จาก ${sum.dtCount} รายการ\nฐานเวลาเครื่องรวม ≈${Math.round(sum.dtBaseMin / 60).toLocaleString()} ชม. = นาทีกะที่เปิด × จำนวนเครื่องของไลน์ (${sum.dtMachines} เครื่อง)\nในแผน (planned เช่น นับสต็อก/ไม่มีแผนผลิต) ${sum.dtPlannedMin.toLocaleString()} นาที — แสดงแยก ไม่นับใน %\nเวลารายการซ้อนกันได้ (หลายเครื่องเสียพร้อมกัน) จึงเกิน 24 ชม./วันได้`,
              color: sum.dtMin === 0 ? '#22c55e' : sum.dtPct > 8 ? '#ef4444' : sum.dtPct >= 3 ? '#f59e0b' : '#22c55e',
            }
          : { label: 'Downtime นอกแผน', value: `${sum.dtMin.toLocaleString()} นาที`, sub: `${sum.dtCount} ครั้ง — รวมทุกไลน์/เครื่อง เวลาซ้อนกันได้`, color: sum.dtMin > 0 ? '#ef4444' : '#22c55e' },
        { label: 'ของเสีย (NG)', value: sum.ng.toLocaleString(), sub: 'จากทุกกะ', color: sum.ng > 0 ? '#ef4444' : '#22c55e' },
        { label: 'เข้างาน', value: `${sum.present}/${sum.attTotal}`, sub: sum.attTotal ? `${pctStr(sum.present, sum.attTotal)}%` : 'ไม่มีข้อมูลเช็คชื่อวันนั้น', color: '#4d9fff' },
      ].map(k => (
        <div key={k.label} title={k.title || undefined} style={{ ...card, height: '100%', minHeight: 92, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 4, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>{k.label}</div>
          <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'var(--font-display)', color: k.color, lineHeight: 1.1 }}>{k.value}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', overflowWrap: 'break-word' }}>{k.sub}</div>
        </div>
      ))}
    </div>
  );

  // หัวคั่นโซน — กันหน้า "ติดกันเป็นพรืด": ชื่อโซน + เส้นแบ่งยาวเต็มแถว (+ตัวเลขสรุปท้ายเส้น)
  const SectionHead = ({ icon, title, extra }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap' }}>{icon} {title}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      {extra && <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{extra}</span>}
    </div>
  );

  const LineCards = () => (
    // min 290px ≈ 5 ใบ/แถวบนจอ desktop — กว้างพอให้ชิปยอด/%/OEE/DT จบบรรทัดเดียวเกือบทุกเคส
    // (เดิม 240px ได้ 6 ใบ/แถว การ์ดแคบจนชิปตกบรรทัดบ่อย ดูรก)
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 }}>
      {lineResults.map(({ line, shifts }) => (
        <div key={line.id} style={{ ...card, height: '100%', minHeight: 126, display: 'flex', flexDirection: 'column', gap: 8, opacity: shifts.length ? 1 : 0.55 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.name}</div>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{line.section}</span>
          </div>
          {/* โครงตายตัวทุกใบ: ☀️ กะเช้า คอลัมน์ซ้าย / 🌙 กะดึก คอลัมน์ขวา (เส้นคั่นกลาง)
              รายละเอียดไล่ลงแนวตั้งเป็นชั้น: ยอด+% → OEE·DT → สถานะ — ไม่มีการ wrap พาดแถว */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', flex: 1 }}>
            {['day', 'night'].map(sh => {
              const s = shifts.find(x => x.shift === sh);
              return (
                <div key={sh} style={{
                  display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
                  ...(sh === 'night' ? { borderLeft: '1px solid var(--border)', paddingLeft: 10 } : { paddingRight: 10 }),
                }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{SHIFT_LABEL[sh]}</span>
                  {!s ? (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>— ไม่เปิดกะ —</span>
                  ) : (
                    <>
                      {/* ชั้น 1: ยอด/เป้า ตัวใหญ่ + % */}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                        {s.pct != null ? (
                          <>
                            <span style={{ fontSize: 15, fontWeight: 900, color: achieveColor(s.pct), whiteSpace: 'nowrap' }}>{s.actual}/{s.target}</span>
                            <span style={chip(achieveColor(s.pct))}>{s.pct}%</span>
                          </>
                        ) : (
                          <>
                            <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)' }}>{s.actual}</span>
                            <span style={chip('#94a3b8')} title="ยังไม่ตั้งเป้ากะ/std และไม่มีเป้าใบงานให้เทียบ">ไม่มีเป้า</span>
                          </>
                        )}
                      </div>
                      {/* ชั้น 2: OEE + DT (มีอันเดียวก็อยู่ชั้นนี้) */}
                      {(s.oee != null || s.dtMin > 0) && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {s.oee != null && <span style={chip('#4d9fff')}>OEE {Math.round(s.oee)}%</span>}
                          {s.dtMin > 0 && <span style={chip('#ef4444')}>DT {s.dtMin}น.</span>}
                        </div>
                      )}
                      {/* ชั้น 3: สถานะกะ */}
                      {s.status !== 'closed' && <div><span style={chip('#f59e0b')}>ยังไม่ปิดกะ</span></div>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {lineResults.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13, padding: 12 }}>ไม่มีไลน์ใน scope</div>}
    </div>
  );

  const MissedPanel = () => (
    <div style={card}>
      <h2 style={h2St}>📉 งานหลุดแผน <span style={chip(missedOrders.length ? '#ef4444' : '#22c55e')}>{missedOrders.length} รายการ</span></h2>
      {missedOrders.length === 0 ? (
        <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>✅ ทุกใบงานได้ตามเป้า</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                {['ไลน์', 'พาร์ท / ใบงาน', 'เป้า', 'ได้จริง', 'ขาด', 'สาเหตุ (อัตโนมัติจากข้อมูลที่บันทึก)', canRecord ? '' : null].filter(v => v !== null).map(h => (
                  <th key={h} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {missedOrders.map(m => (
                <tr key={m.o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{m.line} <span style={{ color: 'var(--muted)', fontSize: 11 }}>{m.shift ? SHIFT_LABEL[m.shift] : ''}</span></td>
                  <td style={{ padding: '6px 8px' }}>{m.o.part_name || m.o.mat_no || '-'} <span style={{ color: 'var(--muted)', fontSize: 11 }}>({m.o.prod_no})</span></td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{m.target.toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{m.actual.toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: '#ef4444' }}>{m.gap.toLocaleString()}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {m.causes.length ? m.causes.map((c, i) => (
                        <span key={i} style={chip(c.color)}>{c.icon} {c.text}</span>
                      )) : <span style={{ color: 'var(--muted)', fontSize: 11 }}>ไม่พบสาเหตุที่บันทึกไว้ — ระบุในที่ประชุม</span>}
                    </div>
                  </td>
                  {canRecord && (
                    <td style={{ padding: '6px 4px' }}>
                      <button className="tbtn" onClick={() => openActModal({
                        problem: `${m.o.part_name || m.o.mat_no || m.o.prod_no} หลุดแผน ${m.gap} ชิ้น (${m.actual}/${m.target})`,
                        line_name: m.line, ref_kind: 'order_miss', ref_id: String(m.o.id),
                      })}
                        title="ตั้งเป็น Action Item"
                        style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--accent)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        ➕ Action
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const DtDefectPanel = () => (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
      <div style={{ ...card, height: '100%' }}>
        <h2 style={h2St}>🛠️ Top Downtime นอกแผน <span style={chip(sum.dtMin ? '#ef4444' : '#22c55e')}>{sum.dtMin} นาที</span></h2>
        {topDowntime.unplanned.length === 0 ? <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>✅ ไม่มี Downtime นอกแผน</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {topDowntime.unplanned.map(t => (
              <div key={t.name} style={{ fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name} {t.carry && <span style={chip('#f59e0b')}>ข้ามกะ</span>}
                    </div>
                    <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, marginTop: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, (t.min / (topDowntime.unplanned[0].min || 1)) * 100)}%`, height: '100%', background: t.color || '#ef4444', borderRadius: 3 }} />
                    </div>
                  </div>
                  <span style={{ fontWeight: 800, color: '#ef4444', whiteSpace: 'nowrap' }}>{Math.round(t.min)} น.</span>
                  <span style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{t.count} ครั้ง</span>
                </div>
                {/* note ที่พนักงานพิมพ์ — ทำให้ประเภทกว้างๆ เช่น "อื่นๆ" อ่านรู้เรื่องว่าเกิดอะไรจริง */}
                {t.topDescs.length > 0 && (
                  <div style={{ marginTop: 2, paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {t.topDescs.map(([desc, min]) => (
                      <div key={desc} style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ↳ {desc} <span style={{ color: '#fca5a5' }}>— {Math.round(min)} น.</span>
                      </div>
                    ))}
                    {Object.keys(t.descs).length > 3 && (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>↳ …และอีก {Object.keys(t.descs).length - 3} รายการ</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {/* ในแผน (planned): เรื่องปกติ ไม่ต้องคุยในประชุม — โชว์จางๆ ท้ายแผงพอให้รู้ว่ามี ไม่มีแถบ/ไม่มี note */}
        {topDowntime.planned.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--border)', opacity: 0.65 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>
              🗓 ในแผน (planned) — รวม {sum.dtPlannedMin.toLocaleString()} นาที (ไม่นับใน %)
            </div>
            {topDowntime.planned.map(t => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}
                title={t.topDescs.map(([desc, min]) => `${desc} — ${Math.round(min)} น.`).join('\n')}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <span style={{ whiteSpace: 'nowrap' }}>{Math.round(t.min)} น. · {t.count} ครั้ง</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ ...card, height: '100%' }}>
        <h2 style={h2St}>🔍 Top ของเสีย (NG/Suspect)</h2>
        {topDefects.length === 0 ? <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>✅ ไม่มีของเสียที่บันทึก</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {topDefects.map((t, i) => (
              <div key={i} style={{ fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b>{t.type}</b> <span style={{ color: 'var(--muted)' }}>· {t.part}</span>
                  </span>
                  <span style={{ fontWeight: 800, color: '#ef4444' }}>{t.qty} ชิ้น</span>
                </div>
                {t.topDescs.length > 0 && (
                  <div style={{ paddingLeft: 10 }}>
                    {t.topDescs.map(([desc, q]) => (
                      <div key={desc} style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ↳ {desc} <span style={{ color: '#fca5a5' }}>— {q} ชิ้น</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const FourMPanel = () => (
    <div style={card}>
      <h2 style={h2St}>🔄 4M Change เมื่อวาน <span style={chip('#4d9fff')}>{fourM.length} รายการ</span></h2>
      {fourM.length === 0 ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>— ไม่มีบันทึก 4M —</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {fourM.map(m => {
            const st = FOURM_STATUS[m.status] || { label: m.status, color: '#94a3b8' };
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '5px 8px', borderRadius: 8, background: 'var(--bg2)', borderLeft: `3px solid ${st.color}` }}>
                <span style={chip(st.color)}>{st.label}</span>
                <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{m.line_name}</span>
                <span style={chip('#94a3b8')}>{m.category}{m.change_subtype ? ` · ${m.change_subtype}` : ''}</span>
                <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.description}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const ReadinessPanel = () => (
    <div style={card}>
      <h2 style={h2St}>☀️ ความพร้อมเช้านี้</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* เครื่องยังซ่อมค้าง — Andon แดง (กระพริบเฉพาะที่ยังค้างจริง ตามกฎ) */}
        {openDts.length > 0 ? openDts.map(d => (
          <div key={d.id} className="dt-alarm-blink" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.5)' }}>
            <span style={{ fontSize: 14 }}>🚨</span>
            <b>{d._line}</b>
            <span>{d.machine_no || ''}</span>
            <span style={{ color: '#fca5a5' }}>{d.dr_downtime_types?.name_th || 'Downtime'}{d.description ? ` — ${d.description}` : ''}</span>
            <span style={chip('#ef4444')}>ยังซ่อมไม่เสร็จ</span>
            {canRecord && (
              <button className="tbtn" onClick={() => openActModal({
                problem: `เครื่อง ${d.machine_no || ''} ${d._line}: ${d.dr_downtime_types?.name_th || 'Downtime'} ยังซ่อมไม่เสร็จ`,
                line_name: d._line, ref_kind: 'downtime', ref_id: String(d.id),
              })} style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--accent)', cursor: 'pointer', whiteSpace: 'nowrap' }}>➕ Action</button>
            )}
          </div>
        )) : (
          <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>✅ ไม่มีเครื่องซ่อมค้าง</div>
        )}
        {/* 4M ที่ยังรออนุมัติ (ทุกวัน ไม่เฉพาะเมื่อวาน = ของที่ควรตามในที่ประชุม) — เหลืองนิ่งตาม Andon */}
        {fourM.filter(m => ['pending', 'pending_qa'].includes(m.status)).map(m => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.45)' }}>
            <span>🟡</span><b>{m.line_name}</b>
            <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>4M {m.category}: {m.description}</span>
            <span style={chip('#f59e0b')}>{FOURM_STATUS[m.status].label}</span>
          </div>
        ))}
        {openActions.filter(a => a._carry).length > 0 && (
          <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700 }}>
            ⏮ Action ค้างจากวันก่อน {openActions.filter(a => a._carry).length} รายการ — ดูวาระถัดไป
          </div>
        )}
      </div>
    </div>
  );

  const ActionsPanel = () => (
    <div style={card}>
      <h2 style={h2St}>
        📌 Action Items <span style={chip(openActions.length ? '#f59e0b' : '#22c55e')}>{openActions.length} ค้าง</span>
        {canRecord && (
          <button onClick={() => openActModal()} style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer' }}>
            ➕ เพิ่ม Action
          </button>
        )}
      </h2>
      {actions.length === 0 ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>— ยังไม่มี action item —</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {actions.map(a => {
            const st = ACT_STATUS[a.status] || ACT_STATUS.open;
            const overdue = ['open', 'doing'].includes(a.status) && a.due_date && a.due_date < getWorkDate();
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: 8, fontSize: 12, padding: '7px 10px', borderRadius: 8, background: 'var(--bg2)', borderLeft: `3px solid ${overdue ? '#ef4444' : st.color}`, flexDirection: isMobile ? 'column' : 'row' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  {a._carry && <span style={chip('#f59e0b')} title={`จากประชุมวันที่ ${fmtDate(a.meeting_date)}`}>⏮ {fmtDate(a.meeting_date)}</span>}
                  {a.line_name && <b style={{ whiteSpace: 'nowrap' }}>{a.line_name}</b>}
                  <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.problem}</span>
                  {a.root_cause && <span style={{ color: 'var(--muted)', fontSize: 11 }}>สาเหตุ: {a.root_cause}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {a.assignee && <span style={chip('#4d9fff')}>👤 {a.assignee}</span>}
                  {a.due_date && <span style={chip(overdue ? '#ef4444' : '#94a3b8')}>{overdue ? '⚠ เลยกำหนด ' : '📅 '}{fmtDate(a.due_date)}</span>}
                  <span style={chip(st.color)}>{st.label}</span>
                  {canRecord && ['open', 'doing'].includes(a.status) && (
                    <>
                      {a.status === 'open' && <button className="tbtn" onClick={() => setActStatus(a, 'doing')} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: '#4d9fff', cursor: 'pointer' }}>▶ เริ่มทำ</button>}
                      <button className="tbtn" onClick={() => setActStatus(a, 'done')} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: '#22c55e', cursor: 'pointer' }}>✓ เสร็จ</button>
                      <button className="tbtn" onClick={() => setActStatus(a, 'cancelled')} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  /* ── วาระสำหรับโหมด TV (ไล่ทีละสไลด์) ── */
  const slides = [
    { title: '🎯 ภาพรวมเมื่อวาน — ได้ตามเป้ามั้ย', render: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <KpiStrip />
        <SectionHead icon="🏭" title="ผลรายไลน์" extra={`เปิดกะ ${lineResults.filter(r => r.shifts.length).length}/${lineResults.length} ไลน์`} />
        <LineCards />
      </div>
    ) },
    { title: '📉 งานหลุดแผน — เกิดเพราะอะไร', render: () => <MissedPanel /> },
    { title: '🛠️ Downtime & ของเสีย', render: () => <DtDefectPanel /> },
    { title: '🔄 4M Change', render: () => <FourMPanel /> },
    { title: '☀️ ความพร้อมเช้านี้', render: () => <ReadinessPanel /> },
    { title: '📌 Action Items', render: () => <ActionsPanel /> },
  ];

  // คีย์บอร์ดในโหมด TV: ◀ ▶ เปลี่ยนวาระ · Esc ออก
  useEffect(() => {
    if (!tvMode) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setTvMode(false);
      if (e.key === 'ArrowRight') setSlide(s => Math.min(slides.length - 1, s + 1));
      if (e.key === 'ArrowLeft') setSlide(s => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tvMode, slides.length]);

  const btnSt = (active) => ({
    padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
    background: active ? 'var(--accent-dim)' : 'var(--bg2)',
    color: active ? 'var(--accent)' : 'var(--text2)',
  });

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingRight: 52 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(17px, 2.2vw, 22px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          🌅 ประชุมแถวเช้า
        </h1>
        <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
          style={{ width: 140, padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
        {sectionOpts.length > 1 && (
          <select value={secFilter} onChange={e => setSecFilter(e.target.value)} style={{ width: 'auto', minWidth: 110, padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
            <option value="">ทุกส่วนงาน</option>
            {sectionOpts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>สรุปวันงาน {fmtDate(meetingDate)}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => { setSlide(0); setTvMode(true); }} style={btnSt(false)} title="โหมดจอ TV — ไล่วาระทีละหน้า (◀ ▶ เปลี่ยน, Esc ออก)">📺 โหมดประชุม</button>
          <button onClick={handlePrint} style={btnSt(false)} title="พิมพ์สรุปเป็นเอกสาร">🖨️ พิมพ์</button>
          {canRecord && (
            <button onClick={sendTelegram} disabled={sendingTg} style={{ ...btnSt(true), opacity: sendingTg ? 0.6 : 1 }} title="ส่งสรุปประชุมเข้า Telegram">
              {sendingTg ? '⏳ กำลังส่ง…' : '📤 ส่งสรุป Telegram'}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลดข้อมูล…</div>
      ) : (
        <>
          <KpiStrip />
          <SectionHead icon="🏭" title="ผลรายไลน์"
            extra={`เปิดกะ ${lineResults.filter(r => r.shifts.length).length}/${lineResults.length} ไลน์`} />
          <LineCards />
          <SectionHead icon="🔎" title="เจาะปัญหาเมื่อวาน" />
          <MissedPanel />
          <DtDefectPanel />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
            <FourMPanel />
            <ReadinessPanel />
          </div>
          <ActionsPanel />
        </>
      )}

      {/* ── โหมด TV: full-screen ไล่วาระ ── */}
      {tvMode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
              {slides[slide].title}
            </div>
            <span style={{ fontSize: 14, color: 'var(--muted)' }}>🌅 ประชุมแถวเช้า · {fmtDate(meetingDate)} · {scopeLabel}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setSlide(s => Math.max(0, s - 1))} disabled={slide === 0} style={{ ...btnSt(false), fontSize: 16, opacity: slide === 0 ? 0.4 : 1 }}>◀</button>
              <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 700 }}>{slide + 1}/{slides.length}</span>
              <button onClick={() => setSlide(s => Math.min(slides.length - 1, s + 1))} disabled={slide === slides.length - 1} style={{ ...btnSt(false), fontSize: 16, opacity: slide === slides.length - 1 ? 0.4 : 1 }}>▶</button>
              <button onClick={() => setTvMode(false)} style={{ ...btnSt(false), fontSize: 14 }} title="ออกจากโหมดประชุม (Esc)">✕</button>
            </div>
          </div>
          {/* zoom ขยายทั้งวาระให้อ่านจากระยะไกล (จอ TV) — เนื้อหา component เดียวกับโหมดปกติเป๊ะ */}
          <div style={{ flex: 1, overflow: 'auto', padding: 22, zoom: 1.3 }}>
            {slides[slide].render()}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '10px 0 16px' }}>
            {slides.map((s, i) => (
              <button key={i} onClick={() => setSlide(i)} title={s.title}
                style={{ width: 10, height: 10, borderRadius: '50%', border: 'none', cursor: 'pointer', background: i === slide ? 'var(--accent)' : 'var(--border2)', padding: 0 }} />
            ))}
          </div>
        </div>
      )}

      {/* ── Modal เพิ่ม Action Item (ฟอร์ม — ห้ามปิดจาก backdrop ตามกติกา §5) ── */}
      {actModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 460, borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border2)', boxShadow: 'var(--shadow-lg)', padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>➕ Action Item — ประชุม {fmtDate(meetingDate)}</h3>
              <button onClick={() => setActModal(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div className="mgrid" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>ปัญหา / สิ่งที่ต้องทำ *
                <textarea rows={2} value={actModal.problem} onChange={e => setActModal(v => ({ ...v, problem: e.target.value }))}
                  style={{ marginTop: 4, fontSize: 13, resize: 'vertical' }} />
              </label>
              <label style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>สาเหตุ (สรุปในที่ประชุม)
                <input value={actModal.root_cause} onChange={e => setActModal(v => ({ ...v, root_cause: e.target.value }))}
                  style={{ marginTop: 4, fontSize: 13 }} placeholder="เช่น น็อตจับจิ๊กสึก / วัตถุดิบมาช้า" />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>ไลน์
                  <select value={actModal.line_name} onChange={e => setActModal(v => ({ ...v, line_name: e.target.value }))}
                    style={{ marginTop: 4, fontSize: 13 }}>
                    <option value="">— เรื่องรวม —</option>
                    {viewLines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>กำหนดเสร็จ
                  <input type="date" value={actModal.due_date || ''} onChange={e => setActModal(v => ({ ...v, due_date: e.target.value }))}
                    style={{ marginTop: 4, fontSize: 13 }} />
                </label>
              </div>
              <label style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>ผู้รับผิดชอบ
                <input value={actModal.assignee} onChange={e => setActModal(v => ({ ...v, assignee: e.target.value }))}
                  style={{ marginTop: 4, fontSize: 13 }} placeholder="ชื่อผู้รับผิดชอบ" />
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button onClick={() => setActModal(null)} style={btnSt(false)}>ยกเลิก</button>
                <button onClick={saveAction} disabled={savingAct} style={{ ...btnSt(true), opacity: savingAct ? 0.6 : 1 }}>
                  {savingAct ? '⏳ กำลังบันทึก…' : '💾 บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
