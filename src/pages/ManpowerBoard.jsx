import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import FilterBar from '../components/FilterBar';
import BoardPager from '../components/BoardPager';
import TimeRangeBar from '../components/TimeRangeBar';
import useTimeRange from '../utils/useTimeRange';
import useFitHeight from '../utils/useFitHeight';
import { packPages, clampPage } from '../utils/boardPager';
import useTabParam, { useMergeParams } from '../utils/useTabParam';
import { useSearchParams } from 'react-router-dom';
import useProductionLines from '../utils/useProductionLines';
import { useLiveBoard } from '../utils/useLiveBoard';
import { LIVE } from '../utils/refreshRates';
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';
import { onlyShopfloorStaff } from '../utils/staffKind';
import { inSectionScope } from '../utils/sectionScope';
import { orgNodeCompare, orgKey } from '../utils/listOrder';
import { loadPositions, positionLabel } from '../utils/positions';
import { buildScheduleMaps, shiftFromTeam, scheduleTeamFor } from '../utils/shiftAssign';
import { getWorkDate, addDaysStr } from '../utils/workDate';
import { ALL } from '../utils/filterLabels';
import { markerScale } from '../utils/markerScale';
import useImgBox from '../utils/useImgBox';
import { mergeBorrowedEmployees, loadBorrowedRange } from '../utils/lineHelpers';
import { canSeeded } from '../utils/permissions';
import ManpowerBoardSetup from '../components/ManpowerBoardSetup';
import {
  buildManpowerBoard, fourMStatus, layoutPeople, lineFamilyOf, paginateTv, tvCardCapacity,
  describeSlotChanges, summarizeSlotChanges, SLOT_AUDIT_TABLES, SLOT_KIND_META,
  staffingOfDept, summarizeStaffing, rosterOn,
  ATTEND_META, FOUR_M, shiftMeta, SHIFT_META,
} from '../utils/manpowerBoard';

/* ═══════════════════════════════════════════════════════════════════════════════════════
   🧑‍🤝‍🧑 Manpower Control Board — /manpower-board (2026-10-06 · คำสั่ง user)

   แทนบอร์ดกระดาษหน้าไลน์ 3 แผ่น:
     🧑‍🤝‍🧑 ผังกำลังคน  — ผจก.ส่วน → หัวหน้าแผนก → หัวหน้ากลุ่มรายทีม → การ์ด skill พนักงาน + ช่องว่าง + ช่างประจำไลน์
     🗺️ ผัง LAYOUT   — รูปคนตามจุดงานบนผังไลน์ สีตามกะ (เขียว=กะเช้า · น้ำเงิน=กะดึก)
     🚦 ป้ายสถานะ 4M — MAN/MACHINE/METHOD/MATERIAL ของแต่ละแผนก วันนี้ "ปกติ/ผิดปกติ"

   🔴 อ่านอย่างเดียว — ไม่มีปุ่มเขียน · ย้ายคน/ตั้งจุดประจำ/ตั้ง std ทำที่หน้าเดิม
      (/operator · /line-setup · /management · /shift-organize) — บอร์ดนี้ "ตาม" ทะเบียนเอง
   🔴 กฎจัดผัง/ช่องว่าง/4M อยู่ใน `utils/manpowerBoard.js` ที่เดียว (มีเทส) — ห้ามคิดในหน้า
   ⚠️ ข้อมูลไม่ครบต้องเขียนบนจอ: ตารางกะยังไม่ตั้ง · std ไม่ได้ตั้ง · แผนกเปล่า · ตำแหน่งที่ระบบไม่รู้จัก
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const EMP_COLS = 'id, name, employee_id_code, image_url, position, team, line_id, department, section, org_node_id, staff_kind, start_date';

export default function ManpowerBoard() {
  const { sections: scopeSecs = [], role } = useContext(UserContext);
  const [tab, setTab] = useTabParam(['org', 'layout', 'fourm', 'staffing', 'history'], 'org');
  const [params] = useSearchParams();
  const merge = useMergeParams();
  const lines = useProductionLines();
  const [nodes, setNodes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [skills, setSkills] = useState({ byEmp: {}, defs: {} });
  const [sched, setSched] = useState([]);
  const [attLogs, setAttLogs] = useState([]);
  const [fourM, setFourM] = useState([]);
  const [slotPlans, setSlotPlans] = useState([]);
  const [lineTechs, setLineTechs] = useState([]);
  const [stations, setStations] = useState([]);
  const [stationPlans, setStationPlans] = useState([]);
  const [homeByEmp, setHomeByEmp] = useState({});
  const [helpers, setHelpers] = useState([]);
  const [setupOpen, setSetupOpen] = useState(false);
  const canSetup = canSeeded('manpower_board', 'edit', role);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const workDate = getWorkDate();

  // ── master (ผัง + พนักงาน + skill) — โหลดครั้งเดียว ──
  useEffect(() => {
    let alive = true;
    (async () => {
      // รอทะเบียนตำแหน่งก่อนจัดแถว — ไม่งั้นรอบแรกจัดด้วยค่า default แล้วไม่จัดใหม่ (memo ไม่รู้ว่า cache เปลี่ยน)
      const [nRes, eRes, dRes] = await Promise.all([
        supabase.from('org_nodes').select('id, kind, name, code, parent_id, ref_line_id, sort_order').eq('is_active', true),
        fetchAllPages(() => onlyShopfloorStaff(supabase.from('employees').select(EMP_COLS).eq('is_active', true))),
        supabase.from('skill_definitions').select('name, label, color, sort_order'),
        loadPositions(),
      ]);
      if (!alive) return;
      const errs = [nRes.error?.message, eRes.error, dRes.error?.message].filter(Boolean);
      setNodes(nRes.data || []);
      setEmployees(eRes.rows || []);
      const sk = await fetchByIds((eRes.rows || []).map(e => e.id),
        (ids) => supabase.from('employee_skills').select('id, employee_id, skill_name, score').in('employee_id', ids));
      if (!alive) return;
      if (sk.error) errs.push(sk.error);
      const byEmp = {};
      for (const r of sk.rows || []) (byEmp[r.employee_id] ||= []).push(r);
      for (const k in byEmp) byEmp[k].sort((a, b) => (b.score || 0) - (a.score || 0));
      setSkills({ byEmp, defs: Object.fromEntries((dRes.data || []).map(d => [d.name, d])) });
      if (errs.length) setErr(errs.join(' · '));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  // ── ค่าตั้งบอร์ด (ช่องต่อทีม · ช่างประจำไลน์) — โหลดตอนเปิด + หลังแก้ในหน้าต่างตั้งค่า ──
  //    ตารางยังไม่ apply (42P01) = บอร์ดทำงานแบบเดิม (std) แต่ต้องเขียนบนจอ ห้ามเงียบ
  const loadSetup = useCallback(async () => {
    const [sp, lt, ws, ssp, hp] = await Promise.all([
      supabase.from('manpower_slot_plans').select('id, org_node_id, team, slots'),
      supabase.from('line_technicians').select('id, employee_id, line_id'),
      fetchAllPages(() => supabase.from('workstations').select('id, line_id, line_name, station_name')),
      supabase.from('station_slot_plans').select('station_id, per_shift'),
      fetchAllPages(() => supabase.from('employee_home_positions').select('employee_id, station_id'), { orderBy: 'employee_id' }),
    ]);
    const e = [sp.error?.message, lt.error?.message, ws.error, ssp.error?.message, hp.error].filter(Boolean);
    if (e.length) setErr(`ค่าตั้งบอร์ด: ${e.join(' · ')}`);
    setSlotPlans(sp.data || []);
    setLineTechs(lt.data || []);
    setStations(ws.rows || []);
    setStationPlans(ssp.data || []);
    setHomeByEmp(Object.fromEntries((hp.rows || []).map(h => [h.employee_id, h.station_id])));
  }, []);
  useEffect(() => { loadSetup(); }, [loadSetup]);

  // ── ของวันนี้ (เช็คชื่อ · ตารางกะ · 4M · คนยืมตัว) — สดผ่าน realtime ──
  // ทะเบียนไลน์ผ่าน ref — ห้ามใส่ array ลง deps ของ useCallback ที่ยิง DB (กฎเหล็กข้อ 9)
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const lineCount = lines.length;
  const loadToday = useCallback(async () => {
    // 🤝 คนยืมตัว — ผ่าน mergeBorrowedEmployees() ตัวกลางเท่านั้น (UI §6.13) · ทั้ง 2 กะของวันงาน
    //    ไม่จำกัดขอบเขต (lineIds null + scopeSecs []) แล้วให้ buildManpowerBoard ตัดตามไลน์ของแต่ละแผนกเอง
    //    อ่านไม่ได้ = คืน [] + console.warn (ฟีเจอร์ "เติมคน" พังต้องไม่ทำให้บอร์ดหลักหาย)
    const hp = lineCount ? mergeBorrowedEmployees([], { lines: linesRef.current, columns: EMP_COLS, workDate }) : Promise.resolve([]);
    const [a, s, f, h] = await Promise.all([
      supabase.from('daily_production_logs').select('employee_id, shift, is_present, leave_type, assigned_line').eq('work_date', workDate),
      supabase.from('shift_schedules').select('*').eq('work_date', workDate),
      supabase.from('four_m_logs').select('id, line_name, line_id, category, description, status, created_at').eq('work_date', workDate),
      hp,
    ]);
    const e = [a.error, s.error, f.error].filter(Boolean).map(x => x.message);
    if (e.length) setErr(e.join(' · '));
    setAttLogs(a.data || []);
    setSched(s.data || []);
    setFourM(f.data || []);
    setHelpers(h || []);
  }, [workDate, lineCount]);
  useLiveBoard(loadToday, { tables: ['daily_production_logs', 'four_m_logs', 'line_helpers'], topic: 'manpower-board', client: supabase, tier: LIVE.BOARD });

  // ── ส่วนงานที่เลือกได้ (ตามผัง + scope ของ user) ──
  const sectionNodes = useMemo(() => nodes.filter(n => n.kind === 'section')
    .filter(n => !scopeSecs.length || inSectionScope(scopeSecs, orgKey(n)) || inSectionScope(scopeSecs, n.name))
    .sort(orgNodeCompare), [nodes, scopeSecs]);
  const secParam = params.get('sec') || '';
  const section = sectionNodes.find(n => orgKey(n) === secParam) || sectionNodes[0] || null;
  const deptParam = params.get('dept') || '';
  // 📺 โหมดจอ TV (ไม่เลื่อน · แบ่งหน้า) — `?tv=1|0` ชนะ · ไม่ระบุ = บัญชี display (จอแขวน) เปิดให้เอง
  const tvParam = params.get('tv');
  const tv = tvParam != null ? tvParam === '1' : role === 'display';

  const attendance = useMemo(() => {
    const m = {};
    for (const r of attLogs) { const cur = m[r.employee_id]; if (!cur || (!cur.is_present && r.is_present)) m[r.employee_id] = r; }
    return m;
  }, [attLogs]);
  const maps = useMemo(() => buildScheduleMaps(sched), [sched]);
  const board = useMemo(() => buildManpowerBoard({ section, nodes, employees, lines, maps, attendance, slotPlans, lineTechs, helpers, stations, stationPlans, homeByEmp }),
    [section, nodes, employees, lines, maps, attendance, slotPlans, lineTechs, helpers, stations, stationPlans, homeByEmp]);
  const depts = useMemo(() => (board?.depts || []).filter(d => !deptParam || d.key === deptParam), [board, deptParam]);

  const filters = (
    <>
      <select value={section ? orgKey(section) : ''} onChange={e => merge({ sec: e.target.value, dept: null })} aria-label="ส่วนงาน">
        {!sectionNodes.length && <option value="">— ไม่มีส่วนงานในขอบเขต —</option>}
        {sectionNodes.map(n => <option key={n.id} value={orgKey(n)}>{n.name}</option>)}
      </select>
      <select value={deptParam} onChange={e => merge({ dept: e.target.value || null })} aria-label="แผนก">
        <option value="">{ALL.dept}</option>
        {(board?.depts || []).map(d => <option key={d.key} value={d.key}>{d.name}</option>)}
      </select>
      <span className="spacer" />
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>วันงาน {workDate}</span>
    </>
  );

  return (
    <Page>
      <PageHeader
        title="Manpower Control Board" icon="🧑‍🤝‍🧑"
        sub="ผังกำลังคน · ผังจุดงาน · ป้ายสถานะ 4M ของส่วนงาน — อ่านอย่างเดียว ตามทะเบียนพนักงาน/ตารางกะ/เช็คชื่อวันนี้"
        tabs={[
          { key: 'org', label: '🧑‍🤝‍🧑 ผังกำลังคน' },
          { key: 'layout', label: '🗺️ ผัง LAYOUT' },
          { key: 'fourm', label: '🚦 ป้ายสถานะ 4M' },
          { key: 'staffing', label: '📊 แผน vs มาจริง' },
          { key: 'history', label: '📜 ประวัติการเปลี่ยนช่อง' },
        ]}
        tab={tab} onTab={setTab}
        filters={filters}
        actions={(<>
          {canSetup && section && (
            <button type="button" onClick={() => setSetupOpen(true)}
              style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text2)' }}
              title="ตั้งจำนวนช่องตำแหน่งต่อทีม + ผูกช่างประจำไลน์ (สิทธิ์ manpower_board:edit)">⚙️ ตั้งค่าบอร์ด</button>
          )}
          <button type="button" onClick={() => merge({ tv: tv ? '0' : '1' })} aria-pressed={tv}
            style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
              border: `1px solid ${tv ? 'var(--accent)' : 'var(--border2)'}`, background: tv ? 'var(--accent-dim)' : 'var(--bg2)', color: tv ? 'var(--accent)' : 'var(--text2)' }}
            title="จอ TV ไม่มีเมาส์: ไม่เลื่อน แบ่งเป็นหน้า เปลี่ยนหน้าเองทุก 20 วิ (← → หรือรีโมตก็ได้)">
            📺 {tv ? 'ออกจากโหมดจอ TV' : 'โหมดจอ TV'}
          </button>
        </>)}
      />
      {err && <div className="card" style={{ padding: 10, marginBottom: 12, borderLeft: '4px solid #ef4444', fontSize: 13 }}>⚠️ โหลดข้อมูลไม่ครบ — {err}</div>}
      {loading ? <div style={{ padding: 24, color: 'var(--muted)' }}>กำลังโหลด…</div>
        : !board ? <div className="card" style={{ padding: 24 }}>ยังไม่มีส่วนงานในผังองค์กร (ตั้งที่ /org-setup)</div>
        : tab === 'org' ? (tv ? <OrgTv board={board} depts={depts} skills={skills} /> : <OrgTab board={board} depts={depts} skills={skills} />)
        : tab === 'layout' ? <LayoutTab board={board} depts={depts} lines={lines} attendance={attendance} maps={maps} tv={tv} stationPlans={stationPlans} />
        : tab === 'staffing' ? <StaffingTab section={section} deptParam={deptParam} today={workDate} nodes={nodes} employees={employees} lines={lines}
            slotPlans={slotPlans} lineTechs={lineTechs} stations={stations} stationPlans={stationPlans} homeByEmp={homeByEmp} />
        : tab === 'history' ? <HistoryTab section={section} dept={deptParam ? (board?.depts || []).find(d => d.key === deptParam) || null : null} deptParam={deptParam} nodes={nodes} lines={lines} stations={stations} employees={employees} />
        : <FourMTab depts={depts} logs={fourM} tv={tv} />}
      {setupOpen && section && (
        <ManpowerBoardSetup section={section} nodes={nodes} lines={lines} employees={employees}
          slotPlans={slotPlans} lineTechs={lineTechs} stations={stations} stationPlans={stationPlans}
          onChanged={loadSetup} onClose={() => setSetupOpen(false)} />
      )}
    </Page>
  );
}

/* ═════════════════════════ 🧑‍🤝‍🧑 ผังกำลังคน ═════════════════════════ */
function Counter({ label, value, sub, tone }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 74 }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1, color: tone || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value ?? '–'}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

function RoleTag({ children, nowrap }) {
  return <span style={{ display: 'inline-block', maxWidth: nowrap ? '40%' : '100%', overflowWrap: 'anywhere', flexShrink: 0,
    ...(nowrap ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : null), fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: '#facc15', color: '#1f2937' }}>{children}</span>;
}

function Photo({ p, size = 44 }) {
  const dim = p.attend === 'leave' || p.attend === 'absent';
  return (
    <div style={{ width: size, height: size * 1.2, borderRadius: 6, overflow: 'hidden', background: 'var(--bg3)', flex: '0 0 auto',
      filter: dim ? 'grayscale(1)' : undefined, opacity: dim ? 0.55 : 1 }}>
      {p.image_url
        ? <img src={p.image_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: 'var(--muted)' }}>{(p.name || '?').slice(0, 1)}</div>}
    </div>
  );
}

function AttendDot({ p }) {
  const m = ATTEND_META[p.attend];
  const label = p.attend === 'leave' && p.log?.leave_type ? `ลา (${p.log.leave_type})` : m.label;
  return <span title={label} style={{ fontSize: 11, fontWeight: 700, color: m.color, whiteSpace: 'nowrap' }}>● {label}</span>;
}

/** 🤝 ป้ายคนยืมตัว (UI §6.13 — ฟ้า #0ea5e9 = ข้อมูลบริบท ไม่ใช่ Andon)
 *  ยืมมา = ต้นสังกัดยังเป็นที่เดิม มาช่วยเฉพาะวันนี้ · ไปช่วย = คนในสังกัดที่วันนี้ไปยืนไลน์อื่น */
const SHIFT_TH = { day: 'กะเช้า', night: 'กะดึก' };
function HelperTag({ p }) {
  const b = p.borrowed, l = p.lentTo;
  if (!b && !l) return null;
  const sh = (x) => (x?.shift ? ` · ${SHIFT_TH[x.shift] || x.shift}` : '');
  const text = b ? `🤝 ยืมจาก ${b.from || 'ไลน์อื่น'}` : `↗ ไปช่วย ${l.to || 'ไลน์อื่น'}`;
  const title = b ? `มาช่วย ${b.to}${sh(b)} เฉพาะวันนี้ — ต้นสังกัดยังเป็น ${b.from || 'ที่เดิม'}`
    : `วันนี้ไปช่วย ${l.to}${sh(l)} — ยังสังกัดแผนกนี้`;
  return <span title={title} style={{ fontSize: 11, fontWeight: 700, color: '#0ea5e9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>;
}

/** ชิปคนระดับหัวหน้า — รูป + ชื่อ + ตำแหน่ง */
function PersonChip({ p }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)', minWidth: 0, maxWidth: '100%' }}>
      <Photo p={p} size={34} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{positionLabel(p.position) || 'ไม่ระบุตำแหน่ง'}{p.team ? ` · ทีม ${p.team}` : ''}{p.external && p.department ? ` · สังกัด ${p.department}` : ''}</div>
        {p.linkedLines?.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`ช่างประจำไลน์: ${p.linkedLines.join(', ')}`}>🔧 {p.linkedLines.join(', ')}</div>
        )}
        <AttendDot p={p} />
      </div>
    </div>
  );
}

/** การ์ด skill พนักงาน (แทนการ์ด SKILL EVALUATION CARD บนบอร์ดกระดาษ) */
function SkillCard({ p, skills }) {
  const top = (skills.byEmp[p.id] || []).slice(0, 3);
  return (
    <div title={`${p.name}${p.employee_id_code ? ` (${p.employee_id_code})` : ''}`} style={{
      border: '1px solid var(--border)', borderRadius: 8, padding: 6, background: 'var(--card)',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
        <Photo p={p} size={36} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.employee_id_code || ''}</div>
        </div>
      </div>
      <AttendDot p={p} />
      <HelperTag p={p} />
      {p.unknownPos && <span style={{ fontSize: 11, color: '#f59e0b' }} title="ตำแหน่งนี้ไม่อยู่ในทะเบียนตำแหน่ง — แก้ที่ /operator">⚠️ {p.position}</span>}
      {top.length ? top.map(s => {
        const d = skills.defs[s.skill_name];
        return (
          <div key={s.skill_name} title={`${d?.label || s.skill_name}: ${s.score}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, gap: 4 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d?.label || s.skill_name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{s.score}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--bg3)' }}>
              <div style={{ width: `${Math.min(100, s.score || 0)}%`, height: '100%', borderRadius: 2, background: d?.color || 'var(--accent)' }} />
            </div>
          </div>
        );
      }) : <span style={{ fontSize: 11, color: 'var(--muted)' }}>ยังไม่มีคะแนน skill</span>}
    </div>
  );
}

/** ช่องว่าง — รู้จุดงาน (ช่องระดับจุดงาน) = เขียนชื่อจุดด้วย หัวหน้าจะได้รู้ว่าต้องหาคนลงตรงไหน */
function EmptySlot({ station, h }) {
  return (
    <div title={station ? `จุด ${station} ยังขาดคนประจำ` : 'ช่องว่าง'} style={{ border: '2px dashed var(--border2)', borderRadius: 8, minHeight: h || 92, height: h,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 4, overflow: 'hidden',
      color: 'var(--muted)', fontSize: 12, fontWeight: 700, textAlign: 'center' }}>
      ช่องว่าง
      {station && <span style={{ fontSize: 11.5, color: 'var(--text2)', overflowWrap: 'anywhere' }}>📍 {station}</span>}
    </div>
  );
}

/** ป้ายช่องว่างของคอลัมน์ — บอกที่มาเสมอ (ตั้งเอง vs std ของไลน์) ไม่งั้นคนเถียงกันว่าเลขมาจากไหน */
const slotText = (c) => (c.slots == null ? ''
  : c.slotSource === 'plan' ? ` · ว่าง ${c.slots} (ตั้งไว้ ${c.slotPlan} ช่อง)`
  : c.slotSource === 'station' ? ` · ว่าง ${c.slots} (ตามจุดงาน)` : ` · ว่าง ${c.slots} (ตาม std)`);

const CARD_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 6, alignItems: 'start' };
// แถวชิปหัวหน้า — min(100%, …) กันล้นจอมือถือ (ชิปกว้าง 200 บนจอ 390 − padding = ล้น)
const CHIP_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))', gap: 6, alignItems: 'start' };

function TeamColumn({ c, skills }) {
  const sm = shiftMeta(c.shift);
  const slots = c.slots || 0;
  return (
    <div style={{ flex: '1 1 260px', minWidth: 0, maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: 8, background: 'var(--bg2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <RoleTag>หัวหน้ากลุ่ม</RoleTag>
        <strong style={{ fontSize: 14 }}>{c.team ? `ทีม ${c.team}` : 'ไม่ระบุทีม'}</strong>
        <span style={{ fontSize: 12, fontWeight: 700, color: sm.color }}>● {c.shift ? `${sm.label}วันนี้` : sm.label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
          {c.ops.length} คน{slotText(c)}
        </span>
      </div>
      {c.leaders.length
        ? <div style={{ display: 'grid', gap: 4, marginBottom: 6 }}>{c.leaders.map(p => <PersonChip key={p.id} p={p} />)}</div>
        : <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>ยังไม่มีหัวหน้ากลุ่มในทะเบียน</div>}
      <div style={CARD_GRID}>
        {c.ops.map(p => <SkillCard key={p.id} p={p} skills={skills} />)}
        {Array.from({ length: slots }, (_, i) => <EmptySlot key={`e${i}`} station={c.slotStations?.[i]} />)}
      </div>
    </div>
  );
}

function OrgTab({ board, depts, skills }) {
  const t = board.totals;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* หัวผัง: ผจก./หัวหน้าส่วน + ทีมสนับสนุน + ตัวนับ */}
      <div className="card" style={{ padding: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <RoleTag>ผู้จัดการ / หัวหน้าส่วน · {board.section.name}</RoleTag>
          <div style={{ ...CHIP_GRID, marginTop: 6 }}>
            {board.top.length ? board.top.map(p => <PersonChip key={p.id} p={p} />)
              : <span style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีผู้จัดการ/หัวหน้าส่วนในทะเบียนส่วนงานนี้</span>}
          </div>
        </div>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <RoleTag>วิศวกร · เจ้าหน้าที่</RoleTag>
          <div style={{ ...CHIP_GRID, marginTop: 6 }}>
            {board.support.length ? board.support.map(p => <PersonChip key={p.id} p={p} />)
              : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Counter label="แผน (std 2 กะ)" value={t.plan} sub={t.plan == null ? 'ยังไม่ตั้ง std' : null} />
          <Counter label="ในทะเบียน" value={t.ops} />
          <Counter label="มาวันนี้" value={t.present} tone="#22c55e" />
          {t.borrowed > 0 && <Counter label="ยืมมาช่วย" value={t.borrowed} tone="#0ea5e9" />}
        </div>
      </div>

      {board.emptyDepts.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่แสดง {board.emptyDepts.length} แผนกที่ยังไม่มีพนักงานในทะเบียน: {board.emptyDepts.join(' · ')}</div>
      )}
      {!depts.length && <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>ส่วนงานนี้ยังไม่มีพนักงานหน้างานในทะเบียน</div>}

      {depts.map(d => (
        <div key={d.key} className="card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <RoleTag>หัวหน้าแผนก {d.name}</RoleTag>
            <div style={{ ...CHIP_GRID, flex: '1 1 240px', minWidth: 0 }}>
              {d.heads.length ? d.heads.map(p => <PersonChip key={p.id} p={p} />)
                : <span style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีหัวหน้าแผนกในทะเบียน</span>}
            </div>
            <Counter label="แผน เช้า/ดึก" value={d.planTotal == null ? null : `${d.plan.day ?? '–'}/${d.plan.night ?? '–'}`} sub={d.planTotal == null ? 'ยังไม่ตั้ง std ที่ไลน์' : null} />
            <Counter label="ในทะเบียน" value={d.opsTotal} />
            <Counter label="มาวันนี้" value={d.present} tone="#22c55e" />
            {d.borrowed.length > 0 && <Counter label="ยืมมาช่วย" value={d.borrowed.length} tone="#0ea5e9" />}
          </div>
          {d.stationInfo && (
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
              📍 ช่องว่างคิดจากจุดงาน {d.stationInfo.planned}/{d.stationInfo.total} จุดที่ตั้งจำนวนคนไว้ (ต้องการ เช้า {d.stationInfo.need.day} · ดึก {d.stationInfo.need.night} คน)
              {d.stationInfo.noHome > 0 && <span style={{ color: '#f59e0b' }}> · ⚠️ {d.stationInfo.noHome} คนยังไม่มีจุดประจำในไลน์ของแผนก — ไม่ถูกนับลงจุดไหน ช่องว่างอาจมากกว่าจริง (ตั้งจุดประจำที่ /management)</span>}
            </div>
          )}
          {d.unknownShiftTeams.length > 0 && (
            <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 8 }}>
              ⚠️ ทีม {d.unknownShiftTeams.join(', ')} ยังไม่ได้ตั้งตารางกะวันนี้ — ไม่รู้ว่าเข้ากะไหน จึงยังไม่คำนวณช่องว่าง (ตั้งที่ /shift-organize)
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {d.cols.map(c => <TeamColumn key={c.team || '-'} c={c} skills={skills} />)}
          </div>
          {d.borrowed.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {/* 🤝 ไม่นับรวมในทะเบียน/ช่องว่างของแผนก — มาช่วยเฉพาะวันนี้ ต้นสังกัดยังเป็นที่เดิม (UI §6.13) */}
              <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: '#0ea5e9', color: '#fff' }}>
                🤝 ยืมมาช่วยวันนี้ {d.borrowed.length} คน</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>ไม่นับรวมในทะเบียนของแผนก</span>
              <div style={{ ...CARD_GRID, marginTop: 6 }}>
                {d.borrowed.map(p => <SkillCard key={p.id} p={p} skills={skills} />)}
              </div>
            </div>
          )}
          {d.techs.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <RoleTag>ช่างเทคนิคประจำไลน์</RoleTag>
              <div style={{ ...CHIP_GRID, marginTop: 6 }}>
                {d.techs.map(p => <PersonChip key={p.id} p={p} />)}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ═════════════════════════ 🗺️ ผัง LAYOUT ═════════════════════════ */
function LayoutTab({ board, depts, lines, attendance, maps, tv, stationPlans }) {
  const [layouts, setLayouts] = useState([]);
  const [stations, setStations] = useState([]);
  const [homes, setHomes] = useState({});
  const [pick, setPick] = useState('');
  const [err, setErr] = useState('');

  const family = useMemo(() => lineFamilyOf(lines, depts.flatMap(d => d.lines.map(l => l.id))), [lines, depts]);
  const famKey = family.map(l => l.id).sort().join(',');

  useEffect(() => {
    let alive = true;
    const names = family.map(l => l.name), ids = family.map(l => l.id);
    if (!names.length) { setLayouts([]); return undefined; }
    (async () => {
      const [lay, hp] = await Promise.all([
        supabase.from('line_layouts').select('id, line_name, line_id, image_url'),
        fetchAllPages(() => supabase.from('employee_home_positions').select('employee_id, station_id'), { orderBy: 'employee_id' }),
      ]);
      if (!alive) return;
      const low = new Set(names.map(n => n.trim().toLowerCase()));
      setLayouts((lay.data || []).filter(l => (l.line_id != null && ids.includes(l.line_id)) || low.has(String(l.line_name || '').trim().toLowerCase())));
      setHomes(Object.fromEntries((hp.rows || []).map(h => [h.employee_id, h.station_id])));
      const e = [lay.error?.message, hp.error].filter(Boolean);
      setErr(e.join(' · '));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [famKey]);

  // 📺 จอ TV: หลายผัง = วนทีละผังเอง (ไม่มีเมาส์ไปเลือก dropdown) · โหมดปกติ = เลือกเอง
  const [tvIdx, setTvIdx] = useAutoPage(tv ? layouts.length : 0);
  const layout = tv ? layouts[clampPage(tvIdx, layouts.length)] || null
    : layouts.find(l => String(l.id) === pick) || layouts[0] || null;
  useEffect(() => {
    let alive = true;
    if (!layout) { setStations([]); return undefined; }
    const q = supabase.from('workstations').select('id, line_name, line_id, station_name, pos_top, pos_left');
    (layout.line_id != null ? q.or(`line_id.eq.${layout.line_id},line_name.eq."${layout.line_name}"`) : q.eq('line_name', layout.line_name))
      .then(({ data, error }) => { if (alive) { setStations(data || []); if (error) setErr(error.message); } });
    return () => { alive = false; };
  }, [layout?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const empById = useMemo(() => {
    const m = {};
    for (const d of board.depts) for (const c of d.cols) for (const p of [...c.leaders, ...c.ops]) m[p.id] = p;
    for (const d of board.depts) for (const p of [...d.heads, ...d.techs]) m[p.id] = p;
    return m;
  }, [board]);
  const shiftOfEmp = useCallback((e) => (e?.team ? shiftFromTeam(scheduleTeamFor(e, maps), e.team) : null), [maps]);
  const placed = useMemo(() => layoutPeople({ stations, homeByEmp: homes, attendance, empById, shiftOfEmp, stationPlans }),
    [stations, homes, attendance, empById, shiftOfEmp, stationPlans]);

  if (!layouts.length) return <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>ไลน์ของแผนกที่เลือกยังไม่มีรูปผัง (อัพโหลดที่ /line-setup){err ? ` · ${err}` : ''}</div>;
  const unplaced = stations.filter(s => s.pos_top == null || s.pos_left == null).length;
  const emptyStations = placed.filter(x => !x.people.length).length;
  const shortage = placed.reduce((acc, x) => (x.missing ? { day: acc.day + x.missing.day, night: acc.night + x.missing.night, unknown: acc.unknown + x.missing.unknown,
    n: acc.n + x.missing.day + x.missing.night + x.missing.unknown } : acc), { day: 0, night: 0, unknown: 0, n: 0 });
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <FilterBar bare>
        {!tv && layouts.length > 1 && (
          <select value={String(layout?.id ?? '')} onChange={e => setPick(e.target.value)} aria-label="ผังไลน์">
            {layouts.map(l => <option key={l.id} value={String(l.id)}>{l.line_name}</option>)}
          </select>
        )}
        <span className="spacer" />
        <span style={{ display: 'flex', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
          {Object.entries(SHIFT_META).map(([k, m]) => <span key={k} style={{ color: m.color, fontWeight: 700 }}>● {m.label}</span>)}
          <span style={{ color: 'var(--muted)' }}>จาง = ลา/ขาด · ✳ = ย้ายมาวันนี้ · ↗ = วันนี้ไปจุดอื่น · วงประ + สีกะ = ขาดคนประจำกะนั้น</span>
        </span>
      </FilterBar>
      {err && <div style={{ fontSize: 12, color: '#ef4444' }}>⚠️ {err}</div>}
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {stations.length} จุดงาน · ยังไม่มีคนประจำ {emptyStations} จุด{unplaced ? ` · ยังไม่วางพิกัด ${unplaced} จุด` : ''}
        {shortage.n > 0 && <span style={{ color: '#f59e0b' }}> · 📍 ขาดคนประจำ เช้า {shortage.day} · ดึก {shortage.night} ช่อง{shortage.unknown ? ` · ยังไม่รู้กะ ${shortage.unknown} ช่อง (ตั้งตารางกะที่ /shift-organize)` : ''}</span>} — ตั้งจุดประจำที่ /management
      </div>
      <LayoutMap layout={layout} placed={placed} reserve={tv ? 48 : 12} />
      {tv && <BoardPager page={clampPage(tvIdx, layouts.length)} count={layouts.length} onPage={setTvIdx} labels={layouts.map(l => l.line_name)} />}
    </div>
  );
}

function LayoutMap({ layout, placed, reserve = 12 }) {
  const { imgRef, imgBox, recalc } = useImgBox([layout?.image_url]);
  // ผังต้องจบในจอเดียว (จอ TV ไม่มีเมาส์) — วัดที่เหลือจริง ห้ามเดา vh (UI §6.23 ข้อ 1) · วัดไม่ได้ = สูงตามรูป
  const [fitRef, fitH] = useFitHeight(reserve, 240);
  const pts = placed.filter(x => x.station.pos_top != null && x.station.pos_left != null)
    .map(x => ({ x: parseFloat(x.station.pos_left), y: parseFloat(x.station.pos_top) }));
  const ms = imgBox ? markerScale(imgBox.rw, { points: pts, mapHeight: imgBox.rh }) : null;
  const sz = ms ? Math.round(ms.MK * 0.62) : 28;
  return (
    <div ref={fitRef} className="card" style={{ padding: 8, position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <img ref={imgRef} src={layout.image_url} alt={layout.line_name} onLoad={recalc}
          style={{ width: '100%', maxHeight: fitH ? fitH - 16 : undefined, objectFit: 'contain', display: 'block' }} />
        {imgBox && (
          <div style={{ position: 'absolute', left: imgBox.ox, top: imgBox.oy, width: imgBox.rw, height: imgBox.rh, pointerEvents: 'none' }}>
            {placed.filter(x => x.station.pos_top != null && x.station.pos_left != null).map(({ station, people, missing }) => (
              <div key={station.id} style={{ position: 'absolute', top: `${station.pos_top}%`, left: `${station.pos_left}%`, transform: 'translate(-50%, -50%)', pointerEvents: 'auto' }}>
                <div style={{ position: 'relative', display: 'flex', gap: 2 }}>
                  {people.length ? people.map(({ emp, shift, attend, temp, away }) => {
                    const c = shiftMeta(shift).color;
                    const dim = away || attend === 'leave' || attend === 'absent';
                    return (
                      <div key={emp.id} title={`${emp.name} · ${shiftMeta(shift).label} · ${ATTEND_META[attend].label}${temp ? ' · ย้ายมาวันนี้' : ''}${away ? ' · วันนี้ไปยืนจุดอื่น' : ''}`}
                        style={{ position: 'relative', width: sz, height: sz, borderRadius: '50%', overflow: 'hidden', background: '#1a1a1a',
                          border: `${ms?.ring || 2}px ${temp ? 'dashed' : 'solid'} ${c}`, opacity: dim ? 0.4 : 1, filter: dim ? 'grayscale(1)' : undefined }}>
                        {emp.image_url ? <img src={emp.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: c }}>{(emp.name || '?').slice(0, 1)}</div>}
                        {(temp || away) && <span style={{ position: 'absolute', top: 0, right: 0, fontSize: 11, lineHeight: 1, background: 'rgba(0,0,0,.75)', color: '#fff', borderRadius: 6, padding: '0 2px' }}>{temp ? '✳' : '↗'}</span>}
                      </div>
                    );
                  }) : !missing ? (
                    <div title={`${station.station_name} · ยังไม่มีคนประจำ`} style={{ width: sz, height: sz, borderRadius: '50%', border: '2px dashed #64748b', background: 'rgba(0,0,0,.35)', color: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>+</div>
                  ) : null}
                  {/* 📍 ช่องที่ขาดต่อกะ (station_slot_plans) — วงประสีของกะ ⇒ เห็นเลยว่าจุดไหนขาดคนกะไหน */}
                  {missing && ['day', 'night', 'unknown'].flatMap(sh => Array.from({ length: missing[sh] || 0 }, (_, i) => (
                    <div key={`${sh}${i}`} title={sh === 'unknown' ? `${station.station_name} · ขาดคนประจำ (ยังไม่รู้กะ — ตารางกะยังไม่ตั้ง)` : `${station.station_name} · ขาดคนประจำ${shiftMeta(sh).label}`}
                      style={{ width: sz, height: sz, borderRadius: '50%', border: `2px dashed ${shiftMeta(sh === 'unknown' ? null : sh).color}`, background: 'rgba(0,0,0,.35)',
                        color: shiftMeta(sh === 'unknown' ? null : sh).color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{sh === 'unknown' ? '?' : '+'}</div>
                  )))}
                  <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 2, background: 'rgba(0,0,0,0.78)', color: '#fff', borderRadius: 4,
                    padding: '0 5px', fontSize: ms?.pillFont || 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: ms?.pillMaxW || 96 }}>
                    {station.station_name}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════ 🚦 ป้ายสถานะ 4M ═════════════════════════ */
/* โหมด TV: การ์ดสูงคงที่ (แถวละ 1 บรรทัดรายละเอียด + "+N") ⇒ นับได้ว่าหน้าหนึ่งลงกี่ใบ */
const FOURM_CARD_W = 420, FOURM_CARD_H = 330, FOURM_GAP = 12;

function FourMCard({ d, logs, tv }) {
  const st = fourMStatus(d.lines, logs);
  const descMax = tv ? 1 : 3;
  return (
    <div className="card" style={{ padding: 12, ...(tv ? { height: FOURM_CARD_H, overflow: 'hidden' } : null) }}>
      <div style={{ marginBottom: 8 }}><RoleTag>ป้ายแจ้งสถานะ {d.name}</RoleTag>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>สถานะการเปลี่ยนแปลงวันนี้ · {d.lines.length} ไลน์</span>
      </div>
      {!d.lines.length && <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 6 }}>⚠️ แผนกนี้ยังไม่ผูกไลน์ผลิต — ตัดสิน 4M ไม่ได้</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {FOUR_M.map(m => {
          const s = st[m.key];
          const bad = s.abnormal;
          const tone = !d.lines.length ? '#64748b' : bad ? '#ef4444' : '#22c55e';
          return (
            <div key={m.key} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'stretch' }}>
              <div style={{ background: m.color, color: m.key === 'machine' ? '#1f2937' : '#fff', fontWeight: 800, fontSize: 14, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 4px' }}>{m.label}</div>
              <div style={{ border: `2px solid ${tone}`, borderRadius: 6, padding: '6px 10px', minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: tone }}>
                  {!d.lines.length ? 'ไม่รู้' : bad ? `ผิดปกติ · ${s.rows.length} ใบ` : 'ปกติ'}
                  {bad && s.pending > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginLeft: 6 }}>(รออนุมัติ {s.pending})</span>}
                </div>
                {s.rows.slice(0, descMax).map(r => (
                  <div key={r.id} style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>
                    · {r.line_name} — {r.description || '(ไม่มีรายละเอียด)'}
                  </div>
                ))}
                {s.rows.length > descMax && <div style={{ fontSize: 12, color: 'var(--muted)' }}>+ อีก {s.rows.length - descMax} ใบ</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FourMTab({ depts, logs, tv }) {
  if (!depts.length) return <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>ไม่มีแผนกให้แสดง</div>;
  if (tv) return <FourMTv depts={depts} logs={logs} />;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))', gap: 12, alignItems: 'start' }}>
      {depts.map(d => <FourMCard key={d.key} d={d} logs={logs} />)}
    </div>
  );
}

function FourMTv({ depts, logs }) {
  const [ref, fitH] = useFitHeight(48, 320);
  const w = useWidth(ref);
  const cols = Math.max(1, Math.floor((w + FOURM_GAP) / (FOURM_CARD_W + FOURM_GAP)));
  const rows = fitH ? Math.max(1, Math.floor((fitH + FOURM_GAP) / (FOURM_CARD_H + FOURM_GAP))) : 1;
  const pages = useMemo(() => packPages(depts, cols * rows), [depts, cols, rows]);
  const [page, setPage] = useAutoPage(pages.length);
  const cur = pages[clampPage(page, pages.length)] || [];
  return (
    <>
      <div ref={ref} style={{ height: fitH || undefined, overflow: 'clip', display: 'grid', alignContent: 'start',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: FOURM_GAP }}>
        {cur.map(d => <FourMCard key={d.key} d={d} logs={logs} tv />)}
      </div>
      <BoardPager page={clampPage(page, pages.length)} count={pages.length} onPage={setPage} labels={pages.map(pg => pg.map(d => d.name).join(' · '))} />
    </>
  );
}

/* ═════════════════════════ 📺 ผังกำลังคน — โหมดจอ TV ═════════════════════════ */
/* กติกา (UI §6.23): ไม่เลื่อน · ที่ไม่พอ = แบ่งหน้า (ห้ามบีบการ์ด) · BoardPager ของกลาง · เปลี่ยนหน้าเองทุก 20 วิ
   การ์ด/แถบหัวขนาดคงที่ ⇒ นับความจุได้แน่นอน (`tvCardCapacity`) แล้วให้ `paginateTv` ตัดหน้า (pure + เทส) */
const TV_CARD = { w: 136, h: 128 };
const TV_TOP_H = 64, TV_DEPT_H = 56, TV_COLHEAD_H = 50, TV_GAP = 8;
const TV_AUTO_MS = 20_000;   // จอแขวน: วนหน้าเองให้คนเดินผ่านเห็นครบ · กดเอง/ลูกศร = นับใหม่

/** กว้างจริงของกล่อง (ResizeObserver) — 0 จนกว่าจะวัดได้ */
function useWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => setW(cur => (Math.abs(cur - el.clientWidth) < 4 ? cur : el.clientWidth));   // โซนหน่วง กันวงจรป้อนกลับ
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [ref]);
  return w;
}

/** หน้าปัจจุบัน + วนเองทุก TV_AUTO_MS (เปลี่ยนหน้าเอง = ตั้งนาฬิกาใหม่ เพราะ effect ผูกกับ page) */
function useAutoPage(count) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!(count > 1)) return undefined;
    const t = setTimeout(() => setPage(p => (clampPage(p, count) + 1) % count), TV_AUTO_MS);
    return () => clearTimeout(t);
  }, [page, count]);
  return [page, setPage];
}

/** ชิปคนแบบบรรทัดเดียว (แถบหัวจอ TV) */
function MiniPerson({ p }) {
  return (
    <div title={`${p.name} · ${positionLabel(p.position) || ''}`} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 auto', minWidth: 0, maxWidth: 220 }}>
      <Photo p={p} size={26} />
      <div style={{ minWidth: 0, lineHeight: 1.2 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{positionLabel(p.position)}</div>
      </div>
    </div>
  );
}

function TvCard({ p, skills }) {
  const top = (skills.byEmp[p.id] || []).slice(0, 2);
  return (
    <div style={{ width: TV_CARD.w, height: TV_CARD.h, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 8, padding: 6,
      background: 'var(--card)', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
        <Photo p={p} size={34} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.employee_id_code || ''}</div>
        </div>
      </div>
      <AttendDot p={p} />
      <HelperTag p={p} />
      {top.length ? top.map(s => {
        const d = skills.defs[s.skill_name];
        return (
          <div key={s.skill_name} title={`${d?.label || s.skill_name}: ${s.score}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, gap: 4 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d?.label || s.skill_name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{s.score}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--bg3)' }}>
              <div style={{ width: `${Math.min(100, s.score || 0)}%`, height: '100%', borderRadius: 2, background: d?.color || 'var(--accent)' }} />
            </div>
          </div>
        );
      }) : <span style={{ fontSize: 11, color: 'var(--muted)' }}>ยังไม่มีคะแนน skill</span>}
    </div>
  );
}

function OrgTv({ board, depts, skills }) {
  const [ref, fitH] = useFitHeight(48, 360);
  const w = useWidth(ref);
  const areaH = (fitH || 0) - TV_TOP_H - TV_DEPT_H - TV_COLHEAD_H - TV_GAP * 3 - 16;
  const pages = useMemo(() => paginateTv(depts, (nCols) => tvCardCapacity({
    areaW: w, areaH, nCols, cardW: TV_CARD.w, cardH: TV_CARD.h, colPad: 16, colGap: TV_GAP,
  })), [depts, w, areaH]);
  const [page, setPage] = useAutoPage(pages.length);
  const pi = clampPage(page, pages.length);
  const pg = pages[pi];

  // ที่ไม่พอจริงๆ (มือถือ/จอเตี้ย) = ถอยไปโหมดเลื่อน — ซื่อสัตย์กว่าบีบจนอ่านไม่ออก (UI §6.23 ข้อ 7)
  // ⚠️ กล่องที่ผูก ref ต้องเป็น element เดิมทั้ง 2 โหมด — สลับ element = ตัววัดเฝ้าตัวที่หลุดจากจอแล้ว
  // จอแคบกว่าแท็บเล็ต (มือถือ) ไม่ใช่จอ TV — คอลัมน์ทีมเหลือการ์ดเดียว แถบหัวอ่านไม่ออก ⇒ โหมดเลื่อน
  const fallback = w > 0 && (fitH == null || w < 768);
  const t = board.totals;
  const d = pg?.dept;
  return (
    <>
      <div ref={ref} style={fallback ? undefined : { height: fitH || undefined, overflow: 'clip', display: 'flex', flexDirection: 'column', gap: TV_GAP }}>
        {fallback ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>📺 จอนี้เล็กเกินกว่าจะแบ่งหน้าแบบจอ TV ได้ — แสดงแบบเลื่อนแทน</div>
            <OrgTab board={board} depts={depts} skills={skills} />
          </>
        ) : (<>
        {/* แถบหัวผังส่วนงาน — สูงคงที่ คนเยอะเกินถูกตัด (ดูครบได้ที่โหมดปกติ) */}
        <div className="card" style={{ height: TV_TOP_H, flexShrink: 0, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 14, overflow: 'hidden' }}>
          <RoleTag nowrap>{board.section.name}</RoleTag>
          <div style={{ display: 'flex', gap: 14, flex: 1, minWidth: 0, overflow: 'hidden' }}>
            {[...board.top, ...board.support].map(p => <MiniPerson key={p.id} p={p} />)}
          </div>
          <Counter label="แผน" value={t.plan} />
          <Counter label="ในทะเบียน" value={t.ops} />
          <Counter label="มาวันนี้" value={t.present} tone="#22c55e" />
        </div>
        {!d ? <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>ส่วนงานนี้ยังไม่มีพนักงานหน้างานในทะเบียน</div> : (
          <>
            <div style={{ height: TV_DEPT_H, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, overflow: 'hidden' }}>
              <RoleTag nowrap>หัวหน้าแผนก {d.name}{pg.parts > 1 ? ` · ส่วนที่ ${pg.part + 1}/${pg.parts}` : ''}</RoleTag>
              <div style={{ display: 'flex', gap: 14, flex: 1, minWidth: 0, overflow: 'hidden' }}>
                {d.heads.map(p => <MiniPerson key={p.id} p={p} />)}
                {d.techs.length > 0 && <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', alignSelf: 'center' }}>🔧 ช่างประจำไลน์ {d.techs.length}:</span>}
                {d.techs.map(p => <MiniPerson key={p.id} p={p} />)}
                {d.borrowed.length > 0 && <span style={{ fontSize: 12, color: '#0ea5e9', fontWeight: 700, whiteSpace: 'nowrap', alignSelf: 'center' }}>🤝 ยืมมาช่วย {d.borrowed.length}:</span>}
                {d.borrowed.map(p => <MiniPerson key={p.id} p={p} />)}
              </div>
              <Counter label="แผน เช้า/ดึก" value={d.planTotal == null ? null : `${d.plan.day ?? '–'}/${d.plan.night ?? '–'}`} />
              <Counter label="ในทะเบียน" value={d.opsTotal} />
              <Counter label="มาวันนี้" value={d.present} tone="#22c55e" />
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: TV_GAP }}>
              {pg.cols.map(({ col: c, items, more }) => {
                const sm = shiftMeta(c.shift);
                return (
                  <div key={c.team || '-'} style={{ flex: '1 1 0', minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, padding: 8, background: 'var(--bg2)', overflow: 'hidden' }}>
                    <div style={{ height: TV_COLHEAD_H, display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
                        <strong style={{ fontSize: 15 }}>{c.team ? `ทีม ${c.team}` : 'ไม่ระบุทีม'}</strong>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: sm.color }}>● {c.shift ? `${sm.label}วันนี้` : sm.label}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{c.ops.length} คน{slotText(c)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        หัวหน้ากลุ่ม: {c.leaders.length ? c.leaders.map(p => p.name).join(', ') : '— ยังไม่มีในทะเบียน'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start' }}>
                      {items.map((it, i) => it.kind === 'op'
                        ? <TvCard key={it.p.id} p={it.p} skills={skills} />
                        : <div key={`s${i}`} style={{ width: TV_CARD.w }}><EmptySlot station={it.station} h={TV_CARD.h} /></div>)}
                      {!items.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>— ไม่มีการ์ดในส่วนนี้ —</span>}
                    </div>
                    {more > 0 && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>ต่อหน้าถัดไปอีก {more} ใบ ▶</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}
        </>)}
      </div>
      {!fallback && <BoardPager page={pi} count={pages.length} onPage={setPage}
        labels={pages.map(x => `${x.dept.name}${x.parts > 1 ? ` (${x.part + 1}/${x.parts})` : ''}`)} />}
    </>
  );
}

/* ═════════════════════════ 📊 แผน vs มาจริงรายวัน (2026-10-08) ═════════════════════════
   ย้อนหลังรายวัน × กะ ว่าแต่ละแผนกขาดคนกี่คน และขาดเพราะอะไร — สูตรทั้งหมดอยู่ที่ staffingOfDept/summarizeStaffing
   🔴 ที่นั่งคิดจาก "ค่าตั้งบอร์ด + ทะเบียนพนักงานปัจจุบัน" (ยังไม่ย้อนค่าตามประวัติ) ⇒ ต้องเขียนข้อจำกัดนี้บนจอเสมอ
   เพดาน 62 วัน (~7,500 แถวเช็คชื่อ) — เลือกยาวกว่านั้น = ตัดให้เหลือ 62 วันล่าสุดแล้วเขียนบอก ไม่บล็อก */
const STAFFING_MAX_DAYS = 62;

function StaffingTab({ section, deptParam, today, nodes, employees, lines, slotPlans, lineTechs, stations, stationPlans, homeByEmp }) {
  const tr = useTimeRange({ defaultDays: 30 });
  const to = tr.to > today ? today : tr.to;
  const capFrom = addDaysStr(to, -(STAFFING_MAX_DAYS - 1));
  const from = tr.from < capFrom ? capFrom : tr.from;
  const clipped = from !== tr.from;
  const [raw, setRaw] = useState({ logs: [], sched: [], borrowed: { byDate: {}, missing: 0 } });
  const [state, setState] = useState({ loading: true, errors: [], truncated: false });
  const linesRef = useRef(lines); linesRef.current = lines;
  const empRef = useRef(employees); empRef.current = employees;
  const lineCount = lines.length, empCount = employees.length;

  useEffect(() => {
    let alive = true;
    setState(s0 => ({ ...s0, loading: true }));
    Promise.all([
      fetchAllPages(() => supabase.from('daily_production_logs').select('id, employee_id, work_date, shift, is_present, leave_type')
        .gte('work_date', from).lte('work_date', to), { orderBy: 'id', maxPages: 10 }),
      fetchAllPages(() => supabase.from('shift_schedules').select('id, work_date, line_id, dept_name, day_team')
        .gte('work_date', from).lte('work_date', to), { orderBy: 'id', maxPages: 10 }),
      loadBorrowedRange({ from, to, employees: empRef.current, lines: linesRef.current }),
    ]).then(([a, s, b]) => {
      if (!alive) return;
      setRaw({ logs: a.rows || [], sched: s.rows || [], borrowed: b });
      setState({ loading: false, errors: [a.error && `เช็คชื่อ: ${a.error}`, s.error && `ตารางกะ: ${s.error}`, b.error && `คนยืมตัว: ${b.error}`].filter(Boolean),
        truncated: a.truncated || s.truncated || b.truncated });
    });
    return () => { alive = false; };
  }, [from, to, lineCount, empCount]);

  const days = useMemo(() => {
    if (!section) return [];
    const att = {}, sch = {};
    for (const r of raw.logs) {
      const m = (att[r.work_date] ||= {}); const cur = m[r.employee_id];
      if (!cur || (!cur.is_present && r.is_present)) m[r.employee_id] = r;
    }
    for (const r of raw.sched) (sch[r.work_date] ||= []).push(r);
    const out = [];
    for (let d = from; d && d <= to; d = addDaysStr(d, 1)) {
      const board = buildManpowerBoard({ section, nodes, employees: rosterOn(employees, d), lines, maps: buildScheduleMaps(sch[d] || []),
        attendance: att[d] || {}, slotPlans, lineTechs, helpers: raw.borrowed.byDate?.[d] || [], stations, stationPlans, homeByEmp });
      out.push({ date: d, depts: (board?.depts || []).filter(x => !deptParam || x.key === deptParam)
        .map(x => ({ key: x.key, name: x.name, shifts: staffingOfDept(x) })) });
    }
    return out;
  }, [raw, from, to, section, deptParam, nodes, employees, lines, slotPlans, lineTechs, stations, stationPlans, homeByEmp]);
  const summary = useMemo(() => summarizeStaffing(days), [days]);
  const rowsOf = useMemo(() => summary.flatMap(sm => ['day', 'night'].map(sh => ({ key: sm.key, name: sm.name, sh }))), [summary]);

  const th = { textAlign: 'left', fontSize: 12, padding: '8px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', fontSize: 13, borderTop: '1px solid var(--border)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const num = { ...td, textAlign: 'right' };
  const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const dShort = (d) => { const [, m, dd] = d.split('-'); return `${Number(dd)}/${Number(m)}`; };
  const cellOf = (key, date, sh) => days.find(x => x.date === date)?.depts.find(x => x.key === key)?.shifts[sh] || null;
  const tip = (s) => `ที่นั่ง ${s.seats} · ยืนจริง ${s.onFloor}\nช่องว่าง ${s.empty} · ลา ${s.leave} · ขาดงาน ${s.absent} · ยังไม่เช็ค ${s.unchecked} · ถูกยืมออก ${s.lentOut} · ยืมเข้า ${s.borrowedIn}${s.noPlan ? '\n⚠️ บางทีมไม่มีแผนช่อง — ใช้จำนวนคนในทะเบียนเป็นที่นั่ง' : ''}`;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <TimeRangeBar scale={tr.scale} from={tr.from} to={tr.to} today={tr.today} scales={null}
        onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset}
        note={`ส่วนงาน ${section?.name || '–'}${deptParam ? ` · แผนก ${summary[0]?.name || '(ไม่มีข้อมูลในช่วงนี้)'}` : ''} · แท่งละ 1 วัน × กะ · ดูได้ครั้งละไม่เกิน ${STAFFING_MAX_DAYS} วัน`} />
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        ℹ️ <b>ที่นั่ง</b> = การ์ดคนในทะเบียน + ช่องว่าง ของกะนั้น (กฎเดียวกับบอร์ด) · <b>ขาด</b> = ที่นั่ง − คนยืนจริง (มา + ยืมเข้า − ถูกยืมออก) ·
        คิดจาก<b>ค่าตั้งบอร์ด/std และทะเบียนพนักงานปัจจุบัน</b> (ตัดคนที่เริ่มงานหลังวันนั้น — คนที่ลาออกไปแล้วไม่อยู่ในตัวเลขย้อนหลัง) ·
        กะที่ไม่มีใครในแผนกถูกเช็คชื่อเลย = <b>ไม่ได้เช็คชื่อ</b> ไม่นับเป็นขาด
      </div>
      {clipped && <div style={{ fontSize: 12, color: '#f59e0b' }}>⚠️ ช่วงที่เลือกยาวเกิน {STAFFING_MAX_DAYS} วัน — แสดงเฉพาะ {from} ถึง {to}</div>}
      {state.errors.length > 0 && <div className="card" style={{ padding: 10, borderLeft: '4px solid #ef4444', fontSize: 13 }}>⚠️ โหลดไม่ครบ — {state.errors.join(' · ')} (ตัวเลขที่เห็นอาจขาดส่วนนี้)</div>}
      {state.truncated && <div style={{ fontSize: 12, color: '#f59e0b' }}>⚠️ ข้อมูลช่วงนี้เกินเพดานที่โหลดได้ — ย่อช่วงวันที่ ตัวเลขยังไม่ครบ</div>}
      {raw.borrowed.missing > 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ℹ️ คนยืมตัว {raw.borrowed.missing} รายการไม่อยู่ในทะเบียนพนักงานปัจจุบัน (ลาออก/ไม่ใช่พนักงานหน้างาน) — ไม่ได้นับเป็นยืมเข้า</div>}
      {state.loading ? <div style={{ padding: 24, color: 'var(--muted)' }}>กำลังโหลด…</div> : !summary.length ? (
        <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>ไม่มีแผนกที่มีคน/ช่องในช่วงที่เลือก</div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <div style={{ padding: '10px 12px', fontWeight: 800 }}>สรุปต่อแผนก</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>แผนก</th><th style={{ ...th, textAlign: 'right' }}>กะที่เช็คแล้ว</th><th style={{ ...th, textAlign: 'right' }}>กะที่ขาดคน</th>
                <th style={{ ...th, textAlign: 'right' }}>ยืนจริง / ที่นั่ง</th><th style={{ ...th, textAlign: 'right' }}>ขาดรวม (คน-กะ)</th>
                <th style={{ ...th, textAlign: 'right' }}>ช่องว่าง</th><th style={{ ...th, textAlign: 'right' }}>ลา</th><th style={{ ...th, textAlign: 'right' }}>ขาดงาน</th>
                <th style={{ ...th, textAlign: 'right' }}>ยังไม่เช็ค</th><th style={{ ...th, textAlign: 'right' }}>ถูกยืมออก</th><th style={{ ...th, textAlign: 'right' }}>ยืมเข้า</th>
                <th style={th}>ขาดหนักสุด</th><th style={{ ...th, textAlign: 'right' }}>กะไม่ได้เช็คชื่อ</th>
              </tr></thead>
              <tbody>
                {summary.map(sm => (
                  <tr key={sm.key}>
                    <td style={{ ...td, fontWeight: 700, whiteSpace: 'normal', minWidth: 140 }}>{sm.name}{sm.noPlanShifts > 0 && <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 400 }}>⚠️ {sm.noPlanShifts} กะมีทีมที่ไม่มีแผนช่อง</div>}</td>
                    <td style={num}>{sm.shifts}</td>
                    <td style={num}>{sm.shifts ? `${sm.shortShifts} (${pct(sm.shortShifts / sm.shifts)})` : '–'}</td>
                    <td style={num}>{sm.shifts ? `${sm.onFloor} / ${sm.seats} (${pct(sm.fill)})` : '–'}</td>
                    <td style={{ ...num, fontWeight: 800 }}>{sm.shifts ? sm.short : '–'}</td>
                    <td style={num}>{sm.empty}</td><td style={num}>{sm.leave}</td><td style={num}>{sm.absent}</td>
                    <td style={num}>{sm.unchecked}</td><td style={num}>{sm.lentOut}</td><td style={num}>{sm.borrowedIn}</td>
                    <td style={td}>{sm.worst ? `${dShort(sm.worst.date)} ${SHIFT_TH[sm.worst.shift]} ขาด ${sm.worst.gap}` : '–'}</td>
                    <td style={num}>{sm.notChecked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)' }}>
              ช่องว่าง + ลา + ขาดงาน + ยังไม่เช็ค + ถูกยืมออก − ยืมเข้า = ขาด (นับทุกกะ ทั้งกะที่ขาดและกะที่เกิน) · "ขาดรวม" นับเฉพาะกะที่ขาด
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <div style={{ padding: '10px 12px', fontWeight: 800 }}>รายวัน — ขาดกี่คน <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>(ตัวเลข = ขาด · +n = เกิน · ✓ = ครบ · · = ไม่ได้เช็คชื่อ · ชี้ที่ช่องเพื่อดูสาเหตุ)</span></div>
            <table style={{ borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...th, position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>แผนก · กะ</th>
                {days.map(d => <th key={d.date} style={{ ...th, textAlign: 'center', padding: '8px 4px' }}>{dShort(d.date)}</th>)}
              </tr></thead>
              <tbody>
                {rowsOf.map(r => (
                  <tr key={`${r.key}-${r.sh}`}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.name}>
                      <b style={{ color: shiftMeta(r.sh).color }}>{SHIFT_TH[r.sh]}</b> · {r.name}
                    </td>
                    {days.map(d => {
                      const s = cellOf(r.key, d.date, r.sh);
                      const base = { ...td, textAlign: 'center', padding: '6px 4px', minWidth: 34, fontSize: 12 };
                      if (!s || (!s.seats && !s.evaluated)) return <td key={d.date} style={{ ...base, color: 'var(--muted)' }} />;
                      if (!s.evaluated) return <td key={d.date} style={{ ...base, color: 'var(--muted)' }} title="ไม่มีใครในแผนกถูกเช็คชื่อกะนี้ — ไม่รู้ว่ามาครบไหม">·</td>;
                      if (s.gap > 0) return <td key={d.date} title={tip(s)} style={{ ...base, fontWeight: 800, color: 'var(--text)', background: `rgba(239,68,68,${Math.min(0.15 + s.gap * 0.08, 0.6).toFixed(2)})` }}>{s.gap}</td>;
                      if (s.gap < 0) return <td key={d.date} title={tip(s)} style={{ ...base, color: '#0ea5e9' }}>+{-s.gap}</td>;
                      return <td key={d.date} title={tip(s)} style={{ ...base, color: 'var(--muted)' }}>✓</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ═════════════════════════ 📜 ประวัติการเปลี่ยนช่อง ═════════════════════════
   อ่าน audit_log ของ 3 ตารางค่าตั้งบอร์ด (ไม่มีตารางประวัติแยก) · ตัดตามส่วนงานที่เลือก ·
   แปลเป็นภาษาคน + สรุปรายเดือนผ่าน describeSlotChanges/summarizeSlotChanges (manpowerBoard.js · มีเทส)
   รายงานย้อนหลัง ⇒ โหลดเมื่อเปลี่ยนช่วง/ส่วนงานเท่านั้น ไม่ poll ไม่ realtime */
const HISTORY_CAP = 3000;
function HistoryTab({ section, dept, deptParam, nodes, lines, stations, employees }) {
  const tr = useTimeRange({ defaultDays: 120 });
  const [rows, setRows] = useState([]);
  const [state, setState] = useState({ loading: true, error: '', truncated: false });
  const from = tr.from, to = tr.to;

  useEffect(() => {
    let alive = true;
    setState(s0 => ({ ...s0, loading: true }));
    // ขอบช่วงเป็นวันไทย — แปลงเป็นเวลา +07:00 เอง (ห้าม toISOString ของวันที่ท้องถิ่น)
    fetchAllPages(() => supabase.from('audit_log')
      .select('id, table_name, action, actor, old_data, new_data, changed_at')
      .in('table_name', SLOT_AUDIT_TABLES)
      .gte('changed_at', `${from}T00:00:00+07:00`).lte('changed_at', `${to}T23:59:59+07:00`),
    { orderBy: 'id', maxPages: Math.ceil(HISTORY_CAP / 1000) })
      .then(({ rows: r, error, truncated }) => {
        if (!alive) return;
        setRows(r || []);
        setState({ loading: false, error: error || '', truncated });
      });
    return () => { alive = false; };
  }, [from, to]);

  const scoped = useMemo(() => {
    if (!section) return { items: [], unattributed: 0 };
    const kids = new Map();
    for (const n of nodes) if (n.parent_id) (kids.get(n.parent_id) || kids.set(n.parent_id, []).get(n.parent_id)).push(n);
    const subOf = (rootId) => {
      const set = new Set([rootId]);
      for (const stack = [rootId]; stack.length;) for (const c of kids.get(stack.pop()) || []) { set.add(c.id); stack.push(c.id); }
      return set;
    };
    const sub = subOf(section.id);
    const refs = nodes.filter(n => sub.has(n.id) && n.kind === 'line' && n.ref_line_id != null).map(n => n.ref_line_id);
    const famIds = new Set(lineFamilyOf(lines, refs).map(l => String(l.id)));
    // 🏷️ กรองแผนก (?dept=) — ทีม = ใต้ต้นไม้แผนกนั้น · จุดงาน/ช่าง = ไลน์ในกลุ่มไลน์ของแผนก (ชุดเดียวกับที่บอร์ดใช้ `dept.lines`)
    //   แผนกที่เลือกไม่อยู่ในส่วนงานนี้แล้ว (dept=null) = ไม่มีอะไรตรง ห้ามถอยไปโชว์ทั้งส่วนงานเงียบๆ
    const deptSub = deptParam && dept?.node ? subOf(dept.node.id) : new Set();
    const deptLineIds = new Set((dept?.lines || []).map(l => String(l.id)));
    let unattributed = 0;
    const inSection = ({ kind, nodeId, lineId }) => (kind === 'team' ? sub.has(nodeId) : lineId == null || famIds.has(String(lineId)));
    const out = describeSlotChanges(rows, {
      nodeById: new Map(nodes.map(n => [n.id, n])),
      stationById: new Map(stations.map(st => [String(st.id), st])),
      lineById: new Map(lines.map(l => [String(l.id), l])),
      empById: new Map(employees.map(e => [e.id, e])),
      // จุดงานที่ถูกลบไปแล้ว (lineId ไม่รู้) = โชว์ไว้ก่อน — ประวัติห้ามหาย ดีกว่าตัดทิ้งเพราะสืบส่วนงานไม่ได้
      inScope: (c) => {
        if (!inSection(c)) return false;
        if (!deptParam) return true;
        if (c.kind === 'team') return deptSub.has(c.nodeId);
        // จุดงานที่ถูกลบไปแล้ว สืบแผนกไม่ได้ — ไม่ใส่ในแผนกไหน แต่นับไว้บอกบนจอ (ห้ามหายเงียบ)
        if (c.lineId == null) { unattributed += 1; return false; }
        return deptLineIds.has(String(c.lineId));
      },
    });
    return { items: out, unattributed };
  }, [rows, section, dept, deptParam, nodes, lines, stations, employees]);
  const list = scoped.items;
  const months = useMemo(() => summarizeSlotChanges(list), [list]);

  const th = { textAlign: 'left', fontSize: 12, padding: '8px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', fontSize: 13, borderTop: '1px solid var(--border)', verticalAlign: 'top' };
  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  const fmtAt = (t) => new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });
  const monthTh = (ym) => { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: 'numeric' }); };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <TimeRangeBar scale={tr.scale} from={from} to={to} today={tr.today} scales={null}
        onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset}
        note={`ส่วนงาน ${section?.name || '–'}${deptParam ? ` · แผนก ${dept?.name || '(ไม่อยู่ในส่วนงานนี้)'}` : ''} · ช่องต่อทีม · คนต่อกะของจุดงาน · ช่างประจำไลน์ (จากบันทึกการแก้ไขของระบบ)`} />
      {state.error && <div className="card" style={{ padding: 10, borderLeft: '4px solid #ef4444', fontSize: 13 }}>⚠️ โหลดประวัติไม่สำเร็จ — {state.error}</div>}
      {state.truncated && <div style={{ fontSize: 12, color: '#f59e0b' }}>⚠️ แสดงได้ไม่เกิน {HISTORY_CAP.toLocaleString()} รายการ — ช่วงนี้มีมากกว่านั้น ให้ย่อช่วงวันที่</div>}
      {!state.loading && scoped.unattributed > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>ℹ️ อีก {scoped.unattributed} รายการเป็นจุดงานที่ถูกลบไปแล้ว สืบไม่ได้ว่าเป็นของแผนกไหน — ไม่ได้แสดงในตัวกรองแผนก (เลือก "{ALL.dept}" เพื่อดู)</div>
      )}
      {state.loading ? <div style={{ padding: 24, color: 'var(--muted)' }}>กำลังโหลด…</div> : !list.length ? (
        <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>ไม่มีการเปลี่ยนช่อง/คนต่อกะ/ช่างประจำไลน์ของ{deptParam ? 'แผนก' : 'ส่วนงาน'}นี้ในช่วงที่เลือก</div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <div style={{ padding: '10px 12px', fontWeight: 800 }}>สรุปรายเดือน</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>เดือน</th><th style={{ ...th, textAlign: 'right' }}>แก้ (ครั้ง)</th>
                <th style={{ ...th, textAlign: 'right' }}>🧑‍🤝‍🧑 ช่องต่อทีม สุทธิ</th><th style={{ ...th, textAlign: 'right' }}>📍 คน/กะของจุด สุทธิ</th>
                <th style={{ ...th, textAlign: 'right' }}>🔧 ช่าง เข้า / ออก</th><th style={th}>คนแก้</th>
              </tr></thead>
              <tbody>
                {months.map(m => (
                  <tr key={m.month}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{monthTh(m.month)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{m.count}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{signed(m.teamDelta)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{signed(m.stationDelta)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>+{m.techIn} / −{m.techOut}</td>
                    <td style={{ ...td, color: 'var(--text2)' }}>{m.actors.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: '6px 12px 10px', fontSize: 12, color: 'var(--muted)' }}>
              สุทธิ = ผลรวมของ (ค่าใหม่ − ค่าเดิม) · ล้างค่า = ลดเท่าค่าเดิม (บอร์ดกลับไปใช้ค่าถัดไปในลำดับ: ช่องต่อทีม → จุดงาน → std)
            </div>
          </div>
          <div className="card table-sticky" style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>เวลา</th><th style={th}>คนแก้</th><th style={th}>เรื่อง</th><th style={th}>ที่ไหน</th>
                <th style={th}>ทีม</th><th style={th}>เปลี่ยนเป็น</th>
              </tr></thead>
              <tbody>
                {list.map(c => (
                  <tr key={c.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtAt(c.at)}</td>
                    <td style={td}>{c.actor}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{SLOT_KIND_META[c.kind].icon} {SLOT_KIND_META[c.kind].label}</td>
                    <td style={td}>{c.where}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.kind === 'team' ? (c.team ? `ทีม ${c.team}` : 'ไม่ระบุทีม') : '–'}</td>
                    {/* ไม่ใส่สีเขียว/แดง — ช่องเพิ่มไม่ได้แปลว่า "ดี" (UI §6.17 สี = ความหมาย) */}
                    <td style={{ ...td, fontWeight: 700 }}>{c.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
