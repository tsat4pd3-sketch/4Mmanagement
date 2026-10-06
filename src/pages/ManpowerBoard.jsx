import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import FilterBar from '../components/FilterBar';
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
import { getWorkDate } from '../utils/workDate';
import { ALL } from '../utils/filterLabels';
import { markerScale } from '../utils/markerScale';
import useImgBox from '../utils/useImgBox';
import {
  buildManpowerBoard, fourMStatus, layoutPeople, lineFamilyOf,
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

const EMP_COLS = 'id, name, employee_id_code, image_url, position, team, line_id, department, section, org_node_id, staff_kind';

export default function ManpowerBoard() {
  const { sections: scopeSecs = [] } = useContext(UserContext);
  const [tab, setTab] = useTabParam(['org', 'layout', 'fourm'], 'org');
  const [params] = useSearchParams();
  const merge = useMergeParams();
  const lines = useProductionLines();
  const [nodes, setNodes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [skills, setSkills] = useState({ byEmp: {}, defs: {} });
  const [sched, setSched] = useState([]);
  const [attLogs, setAttLogs] = useState([]);
  const [fourM, setFourM] = useState([]);
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

  // ── ของวันนี้ (เช็คชื่อ · ตารางกะ · 4M) — สดผ่าน realtime ──
  const loadToday = useCallback(async () => {
    const [a, s, f] = await Promise.all([
      supabase.from('daily_production_logs').select('employee_id, shift, is_present, leave_type, assigned_line').eq('work_date', workDate),
      supabase.from('shift_schedules').select('*').eq('work_date', workDate),
      supabase.from('four_m_logs').select('id, line_name, line_id, category, description, status, created_at').eq('work_date', workDate),
    ]);
    const e = [a.error, s.error, f.error].filter(Boolean).map(x => x.message);
    if (e.length) setErr(e.join(' · '));
    setAttLogs(a.data || []);
    setSched(s.data || []);
    setFourM(f.data || []);
  }, [workDate]);
  useLiveBoard(loadToday, { tables: ['daily_production_logs', 'four_m_logs'], topic: 'manpower-board', client: supabase, tier: LIVE.BOARD });

  // ── ส่วนงานที่เลือกได้ (ตามผัง + scope ของ user) ──
  const sectionNodes = useMemo(() => nodes.filter(n => n.kind === 'section')
    .filter(n => !scopeSecs.length || inSectionScope(scopeSecs, orgKey(n)) || inSectionScope(scopeSecs, n.name))
    .sort(orgNodeCompare), [nodes, scopeSecs]);
  const secParam = params.get('sec') || '';
  const section = sectionNodes.find(n => orgKey(n) === secParam) || sectionNodes[0] || null;
  const deptParam = params.get('dept') || '';

  const attendance = useMemo(() => {
    const m = {};
    for (const r of attLogs) { const cur = m[r.employee_id]; if (!cur || (!cur.is_present && r.is_present)) m[r.employee_id] = r; }
    return m;
  }, [attLogs]);
  const maps = useMemo(() => buildScheduleMaps(sched), [sched]);
  const board = useMemo(() => buildManpowerBoard({ section, nodes, employees, lines, maps, attendance }),
    [section, nodes, employees, lines, maps, attendance]);
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
        ]}
        tab={tab} onTab={setTab}
        filters={filters}
      />
      {err && <div className="card" style={{ padding: 10, marginBottom: 12, borderLeft: '4px solid #ef4444', fontSize: 13 }}>⚠️ โหลดข้อมูลไม่ครบ — {err}</div>}
      {loading ? <div style={{ padding: 24, color: 'var(--muted)' }}>กำลังโหลด…</div>
        : !board ? <div className="card" style={{ padding: 24 }}>ยังไม่มีส่วนงานในผังองค์กร (ตั้งที่ /org-setup)</div>
        : tab === 'org' ? <OrgTab board={board} depts={depts} skills={skills} />
        : tab === 'layout' ? <LayoutTab board={board} depts={depts} lines={lines} attendance={attendance} maps={maps} />
        : <FourMTab depts={depts} logs={fourM} />}
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

function RoleTag({ children }) {
  return <span style={{ display: 'inline-block', maxWidth: '100%', overflowWrap: 'anywhere', fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: '#facc15', color: '#1f2937' }}>{children}</span>;
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

/** ชิปคนระดับหัวหน้า — รูป + ชื่อ + ตำแหน่ง */
function PersonChip({ p }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)', minWidth: 0, maxWidth: '100%' }}>
      <Photo p={p} size={34} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{positionLabel(p.position) || 'ไม่ระบุตำแหน่ง'}{p.team ? ` · ทีม ${p.team}` : ''}</div>
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

function EmptySlot() {
  return (
    <div style={{ border: '2px dashed var(--border2)', borderRadius: 8, minHeight: 92, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--muted)', fontSize: 12, fontWeight: 700 }}>ช่องว่าง</div>
  );
}

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
          {c.ops.length} คน{c.slots != null ? ` · ว่าง ${c.slots}` : ''}
        </span>
      </div>
      {c.leaders.length
        ? <div style={{ display: 'grid', gap: 4, marginBottom: 6 }}>{c.leaders.map(p => <PersonChip key={p.id} p={p} />)}</div>
        : <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>ยังไม่มีหัวหน้ากลุ่มในทะเบียน</div>}
      <div style={CARD_GRID}>
        {c.ops.map(p => <SkillCard key={p.id} p={p} skills={skills} />)}
        {Array.from({ length: slots }, (_, i) => <EmptySlot key={`e${i}`} />)}
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
          </div>
          {d.unknownShiftTeams.length > 0 && (
            <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 8 }}>
              ⚠️ ทีม {d.unknownShiftTeams.join(', ')} ยังไม่ได้ตั้งตารางกะวันนี้ — ไม่รู้ว่าเข้ากะไหน จึงยังไม่คำนวณช่องว่าง (ตั้งที่ /shift-organize)
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {d.cols.map(c => <TeamColumn key={c.team || '-'} c={c} skills={skills} />)}
          </div>
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
function LayoutTab({ board, depts, lines, attendance, maps }) {
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

  const layout = layouts.find(l => String(l.id) === pick) || layouts[0] || null;
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
  const placed = useMemo(() => layoutPeople({ stations, homeByEmp: homes, attendance, empById, shiftOfEmp }),
    [stations, homes, attendance, empById, shiftOfEmp]);

  if (!layouts.length) return <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>ไลน์ของแผนกที่เลือกยังไม่มีรูปผัง (อัพโหลดที่ /line-setup){err ? ` · ${err}` : ''}</div>;
  const unplaced = stations.filter(s => s.pos_top == null || s.pos_left == null).length;
  const emptyStations = placed.filter(x => !x.people.length).length;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <FilterBar bare>
        {layouts.length > 1 && (
          <select value={String(layout?.id ?? '')} onChange={e => setPick(e.target.value)} aria-label="ผังไลน์">
            {layouts.map(l => <option key={l.id} value={String(l.id)}>{l.line_name}</option>)}
          </select>
        )}
        <span className="spacer" />
        <span style={{ display: 'flex', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
          {Object.entries(SHIFT_META).map(([k, m]) => <span key={k} style={{ color: m.color, fontWeight: 700 }}>● {m.label}</span>)}
          <span style={{ color: 'var(--muted)' }}>จาง = ลา/ขาด · ✳ = ย้ายมาวันนี้ · ↗ = วันนี้ไปจุดอื่น</span>
        </span>
      </FilterBar>
      {err && <div style={{ fontSize: 12, color: '#ef4444' }}>⚠️ {err}</div>}
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {stations.length} จุดงาน · ยังไม่มีคนประจำ {emptyStations} จุด{unplaced ? ` · ยังไม่วางพิกัด ${unplaced} จุด` : ''} — ตั้งจุดประจำที่ /management
      </div>
      <LayoutMap layout={layout} placed={placed} />
    </div>
  );
}

function LayoutMap({ layout, placed }) {
  const { imgRef, imgBox, recalc } = useImgBox([layout?.image_url]);
  const pts = placed.filter(x => x.station.pos_top != null && x.station.pos_left != null)
    .map(x => ({ x: parseFloat(x.station.pos_left), y: parseFloat(x.station.pos_top) }));
  const ms = imgBox ? markerScale(imgBox.rw, { points: pts, mapHeight: imgBox.rh }) : null;
  const sz = ms ? Math.round(ms.MK * 0.62) : 28;
  return (
    <div className="card" style={{ padding: 8, position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <img ref={imgRef} src={layout.image_url} alt={layout.line_name} onLoad={recalc}
          style={{ width: '100%', maxHeight: '78vh', objectFit: 'contain', display: 'block' }} />
        {imgBox && (
          <div style={{ position: 'absolute', left: imgBox.ox, top: imgBox.oy, width: imgBox.rw, height: imgBox.rh, pointerEvents: 'none' }}>
            {placed.filter(x => x.station.pos_top != null && x.station.pos_left != null).map(({ station, people }) => (
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
                  }) : (
                    <div title={`${station.station_name} · ยังไม่มีคนประจำ`} style={{ width: sz, height: sz, borderRadius: '50%', border: '2px dashed #64748b', background: 'rgba(0,0,0,.35)', color: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>+</div>
                  )}
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
function FourMTab({ depts, logs }) {
  if (!depts.length) return <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>ไม่มีแผนกให้แสดง</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))', gap: 12, alignItems: 'start' }}>
      {depts.map(d => {
        const st = fourMStatus(d.lines, logs);
        return (
          <div key={d.key} className="card" style={{ padding: 12 }}>
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
                      {s.rows.slice(0, 3).map(r => (
                        <div key={r.id} style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>
                          · {r.line_name} — {r.description || '(ไม่มีรายละเอียด)'}
                        </div>
                      ))}
                      {s.rows.length > 3 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>+ อีก {s.rows.length - 3} ใบ</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
