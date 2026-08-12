import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { can, canDelete } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyIds } from '../utils/lineHierarchy';
import { toast } from '../components/Toast';

function getWeekDates(refDate) {
  const d = new Date(refDate);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(mon);
    dt.setDate(mon.getDate() + i);
    return dt;
  });
}

function toDateStr(d) {
  // ห้าม toISOString() — UTC ทำให้วันที่ถอยหลัง 1 วันช่วง 00:00-06:59 เวลาไทย
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ShiftOrganize() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const canEdit = can('shift_schedule', 'edit', role);
  const canDel  = canDelete('shift_schedule', 'edit', role);  // สิทธิ์ลบ/ยุบกะ แยกจากแก้ไข

  const [weekRef,   setWeekRef]   = useState(new Date());
  const [lines,     setLines]     = useState([]);
  const [orgSections, setOrgSections] = useState([]);
  const [weekTeams, setWeekTeams] = useState({}); // line_id → 'A' | 'B' | null
  const [weekManual, setWeekManual] = useState({}); // line_id → is_manual (ไลน์ลูกตั้งกะเอง ไม่ตามไลน์แม่)
  const [pending,   setPending]   = useState({}); // line_id → 'A' | 'B'
  const [isSaving,  setIsSaving]  = useState(false);

  const [overrides,    setOverrides]    = useState([]);
  const [employees,    setEmployees]    = useState([]);
  const [showOvrModal, setShowOvrModal] = useState(false);
  const [ovrDate,      setOvrDate]      = useState(toDateStr(new Date()));
  const [ovrEmpId,     setOvrEmpId]     = useState('');
  const [ovrShift,     setOvrShift]     = useState('day');
  const [ovrReason,    setOvrReason]    = useState('');

  // Shift merge events
  const [mergeEvents,    setMergeEvents]    = useState([]);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mrgScope,       setMrgScope]       = useState('section'); // 'section' | 'line'
  const [mrgSection,     setMrgSection]     = useState('');
  const [mrgLineId,      setMrgLineId]      = useState('');
  const [mrgStart,       setMrgStart]       = useState(toDateStr(new Date()));
  const [mrgEnd,         setMrgEnd]         = useState(toDateStr(new Date()));
  const [mrgShift,       setMrgShift]       = useState('day');
  const [mrgReason,      setMrgReason]      = useState('');

  const weekDates = getWeekDates(weekRef);
  const weekStart = toDateStr(weekDates[0]); // Monday
  const weekEnd   = toDateStr(weekDates[6]); // Sunday

  useEffect(() => {
    fetchLines();
    fetchEmployees();
    fetchMergeEvents();
  }, []);

  useEffect(() => {
    if (lines.length > 0) {
      fetchSchedules();
      fetchOverrides();
    }
  }, [weekRef, lines.length]);

  const fetchLines = async () => {
    const [{ data: lineData }, { data: orgData }] = await Promise.all([
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('id'),
      supabase.from('org_nodes').select('code, name').eq('kind', 'section').eq('is_active', true).order('name'),
    ]);
    setLines(lineData || []);
    setOrgSections((orgData || []).map(n => n.code || n.name).sort());
  };

  const fetchEmployees = async () => {
    let q = supabase.from('employees').select('id, name, employee_id_code, line_id, production_lines(section)').eq('is_active', true);
    // mandatory scope: leader → ทั้งครอบครัวไลน์ตัวเอง (ตัวเอง + แม่ + ลูก — ห้ามกรอง line_id ตรงตัว
    // ไม่งั้นพนักงานที่ผูกกับไลน์ลูกจะหายจากสายตาหัวหน้าที่ผูกกับไลน์แม่) ·
    // role ที่ถูกจำกัด sections → กรองหลัง join ด้วย inSectionScope
    if (role === 'leader' && userLineId) {
      const { data: ls } = await supabase.from('production_lines').select('id, name, parent_line_name');
      const fam = getLineFamilyIds(ls || [], Number(userLineId));
      q = fam.size ? q.in('line_id', [...fam]) : q.eq('line_id', userLineId);
    }
    const { data } = await q.order('name');
    let scoped = data || [];
    if (!(role === 'leader' && userLineId) && scopeSecs.length) {
      scoped = scoped.filter(e => inSectionScope(scopeSecs, e.production_lines?.section));
    }
    setEmployees(scoped);
  };

  const fetchSchedules = async () => {
    // Use Monday's record as the canonical setting for the week
    const { data } = await supabase
      .from('shift_schedules')
      .select('line_id, day_team, is_manual')
      .eq('work_date', weekStart);
    const map = {}, mmap = {};
    (data || []).forEach(r => { map[r.line_id] = r.day_team; mmap[r.line_id] = !!r.is_manual; });
    setWeekTeams(map);
    setWeekManual(mmap);
    setPending({});
  };

  const fetchOverrides = async () => {
    const { data } = await supabase
      .from('shift_overrides')
      .select('id, work_date, employee_id, shift, reason, employees(name, employee_id_code, line_id, production_lines(section))')
      .gte('work_date', weekStart)
      .lte('work_date', weekEnd)
      .order('work_date');
    // mandatory scope: leader → override ของพนักงานไลน์ตัวเอง, role ที่ถูกจำกัด sections → เฉพาะส่วนงานใน scope
    const scoped = (data || []).filter(o => {
      if (role === 'leader' && userLineId) return String(o.employees?.line_id) === String(userLineId);
      if (scopeSecs.length) return inSectionScope(scopeSecs, o.employees?.production_lines?.section);
      return true;
    });
    setOverrides(scoped);
  };

  // ── ลำดับชั้นไลน์: ไลน์ลูก (parent_line_name) inherit กะจากไลน์แม่ เว้นแต่ตั้งเอง (manual) ──
  const lineById = {}, lineByName = {};
  lines.forEach(l => { lineById[l.id] = l; lineByName[l.name] = l; });
  const parentIdOf = (id) => { const pn = lineById[id]?.parent_line_name; const p = pn ? lineByName[pn] : null; return p ? p.id : null; };
  const ownTeamOf = (id) => (pending[id] !== undefined ? pending[id].team : (weekTeams[id] ?? null));
  const manualOf  = (id) => (pending[id] !== undefined ? pending[id].manual : (weekManual[id] ?? false));
  // กะที่แสดงจริง: ไลน์ลูกที่ไม่ manual → ตามไลน์แม่ (recurse) · ไลน์แม่/ลูกที่ manual → ค่าของตัวเอง
  const effTeam = (id, depth = 0) => {
    if (depth > 6) return ownTeamOf(id);
    const pid = parentIdOf(id);
    if (pid != null && !manualOf(id)) return effTeam(pid, depth + 1);
    return ownTeamOf(id);
  };
  const getTeam = effTeam; // backward alias
  const isFollowing = (id) => parentIdOf(id) != null && !manualOf(id); // ตามไลน์แม่อยู่

  const toggleTeam = (lineId) => {
    if (!canEdit) return;
    const cur = effTeam(lineId);
    const next = cur === 'A' ? 'B' : 'A';
    // สลับที่ไลน์ลูก = ตั้งเอง (manual) ไม่ตามไลน์แม่แล้ว · ไลน์แม่ = master (manual=false)
    setPending(p => ({ ...p, [lineId]: { team: next, manual: parentIdOf(lineId) != null } }));
  };
  const resetToParent = (lineId) => {
    if (!canEdit) return;
    setPending(p => ({ ...p, [lineId]: { team: null, manual: false } })); // กลับไปตามไลน์แม่
  };

  const pendingCount = Object.keys(pending).length;

  const handleSave = async () => {
    if (!pendingCount) return;
    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    // ไลน์ที่ต้องเขียน = ที่แก้ (pending) + ไลน์ลูกที่ "ตามไลน์แม่" ซึ่งแม่อยู่ใน pending (cascade)
    const affected = new Set(Object.keys(pending).map(k => Number(k)));
    scopedLines.forEach(l => {
      const pid = parentIdOf(l.id);
      if (pid != null && !manualOf(l.id) && pending[pid] !== undefined) affected.add(l.id);
    });
    // Apply the same team to every day of the selected week
    const rows = [];
    affected.forEach(id => {
      const team = effTeam(id);               // ไลน์ลูกที่ตามแม่ → ได้กะของแม่ · manual → ของตัวเอง
      if (!team) return;
      const manual = parentIdOf(id) != null && manualOf(id);
      for (const d of weekDates) {
        rows.push({ work_date: toDateStr(d), line_id: id, day_team: team, is_manual: manual, created_by: userId });
      }
    });
    if (!rows.length) { setIsSaving(false); return; }

    const { error } = await supabase
      .from('shift_schedules')
      .upsert(rows, { onConflict: 'work_date,line_id' });

    if (error) toast.error('เกิดข้อผิดพลาด: ' + error.message);
    else fetchSchedules();
    setIsSaving(false);
  };

  const handleAddOverride = async () => {
    if (!ovrEmpId) return;
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from('shift_overrides').upsert([{
      work_date:   ovrDate,
      employee_id: ovrEmpId,
      shift:       ovrShift,
      reason:      ovrReason || null,
      created_by:  userData?.user?.id,
    }], { onConflict: 'work_date,employee_id' });
    if (error) toast.error('เกิดข้อผิดพลาด: ' + error.message);
    else { setShowOvrModal(false); setOvrEmpId(''); setOvrReason(''); fetchOverrides(); }
  };

  const handleDeleteOverride = async (id) => {
    if (!confirm('ยืนยันลบรายการเปลี่ยนกะรายบุคคลนี้?')) return;
    await supabase.from('shift_overrides').delete().eq('id', id);
    fetchOverrides();
  };

  const fetchMergeEvents = async () => {
    const today = toDateStr(new Date());
    const { data } = await supabase
      .from('shift_merge_events')
      .select('*')
      .gte('end_date', today)
      .order('start_date');
    setMergeEvents(data || []);
  };

  const handleAddMergeEvent = async () => {
    if (mrgScope === 'section' && !mrgSection) return;
    if (mrgScope === 'line' && !mrgLineId) return;
    if (!mrgStart || !mrgEnd || mrgEnd < mrgStart) return;
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      section:      mrgScope === 'section' ? mrgSection : null,
      line_id:      mrgScope === 'line' ? parseInt(mrgLineId) : null,
      start_date:   mrgStart,
      end_date:     mrgEnd,
      target_shift: mrgShift,
      reason:       mrgReason || null,
      created_by:   userData?.user?.id,
    };
    const { error } = await supabase.from('shift_merge_events').insert([payload]);
    if (error) toast.error('เกิดข้อผิดพลาด: ' + error.message);
    else {
      setShowMergeModal(false);
      setMrgSection(''); setMrgLineId(''); setMrgReason('');
      fetchMergeEvents();
    }
  };

  const handleDeleteMergeEvent = async (id) => {
    if (!confirm('ยืนยันลบเหตุการณ์ยุบกะนี้?')) return;
    await supabase.from('shift_merge_events').delete().eq('id', id);
    fetchMergeEvents();
  };

  // Helper: count employees affected by a merge event
  const affectedCount = (evt) => {
    if (evt.line_id) return employees.filter(e => e.line_id === evt.line_id).length;
    // section — need line ids in that section (not available here without lineData join, show '—')
    return null;
  };

  // ── mandatory scope (CLAUDE.md "Section/Line/Team Scoping") — leader → ไลน์ตัวเอง, role ที่ถูกจำกัด
  // sections → เฉพาะส่วนงานใน scope · scope ว่าง ([]) = ไม่จำกัด เห็นหมดเหมือนเดิม ──
  const scopedLines = (role === 'leader' && userLineId)
    ? lines.filter(l => String(l.id) === String(userLineId))
    : scopeSecs.length ? lines.filter(l => inSectionScope(scopeSecs, l.section)) : lines;

  const allSections = orgSections.length ? orgSections : [...new Set(lines.map(l => l.section).filter(Boolean))].sort();
  const scopedSections = (role === 'leader' && userLineId)
    ? [...new Set(scopedLines.map(l => l.section).filter(Boolean))].sort()
    : scopeSecs.length ? allSections.filter(s => inSectionScope(scopeSecs, s)) : allSections;

  // merge event อยู่ใน scope เมื่อ: ระบุไลน์ → ไลน์นั้นอยู่ใน scope / ระบุ section → section นั้นอยู่ใน scope
  // (leader เห็น merge ระดับ section ของ section ตัวเองด้วย เพราะกระทบไลน์ตัวเอง)
  const mergeEventInScope = (evt) => {
    if (role === 'leader' && userLineId) {
      if (evt.line_id) return String(evt.line_id) === String(userLineId);
      const myLine = lines.find(l => String(l.id) === String(userLineId));
      return !!myLine?.section && inSectionScope([myLine.section], evt.section);
    }
    if (scopeSecs.length) {
      if (evt.line_id) return inSectionScope(scopeSecs, lines.find(l => l.id === evt.line_id)?.section);
      return inSectionScope(scopeSecs, evt.section);
    }
    return true;
  };
  const visibleMergeEvents = mergeEvents.filter(mergeEventInScope);

  const prevWeek = () => { const d = new Date(weekRef); d.setDate(d.getDate() - 7); setWeekRef(d); };
  const nextWeek = () => { const d = new Date(weekRef); d.setDate(d.getDate() + 7); setWeekRef(d); };
  const goToday  = () => setWeekRef(new Date());

  const fmtDate = (d) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });

  return (
    <div className="page-content">
      {/* Header — paddingRight: 52 = เว้นที่ให้ 🔔 (fixed top-right) ไม่ทับปุ่ม 💾 บันทึก */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10, paddingRight: 52 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>
          🗓 ตารางกะการทำงาน
        </h2>
        {canEdit && pendingCount > 0 && (
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{ padding: '10px 22px', background: isSaving ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}
          >
            {isSaving ? '⏳ กำลังบันทึก...' : `💾 บันทึก (${pendingCount} ไลน์)`}
          </button>
        )}
      </div>

      {/* Week Navigator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={prevWeek} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}>‹</button>
        <button onClick={goToday}  style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 12 }}>วันนี้</button>
        <button onClick={nextWeek} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}>›</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--border2)' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>สัปดาห์</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
            จ. {fmtDate(weekDates[0])} — อา. {fmtDate(weekDates[6])}
          </span>
        </div>
      </div>

      {/* Weekly Shift Table — overflowX: ตารางกว้าง ~610px ให้เลื่อนแนวนอนบนมือถือ (desktop ไม่มี scrollbar เพราะพื้นที่พอ) */}
      <div className="card table-sticky" style={{ marginBottom: 8, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 180 }}>ไลน์ผลิต</th>
              <th style={{ minWidth: 80 }}>Section</th>
              <th style={{ textAlign: 'center', minWidth: 130 }}>☀️ กะเช้า</th>
              <th style={{ textAlign: 'center', minWidth: 130 }}>🌙 กะดึก</th>
              {canEdit && <th style={{ textAlign: 'center', minWidth: 90 }}>จัดการ</th>}
            </tr>
          </thead>
          <tbody>
            {scopedLines.map(line => {
              const team  = effTeam(line.id);
              const night = team === 'A' ? 'B' : team === 'B' ? 'A' : null;
              const isPending = pending[line.id] !== undefined;
              const following = isFollowing(line.id);           // ไลน์ลูกที่ตามไลน์แม่
              const isChild = parentIdOf(line.id) != null;
              const parentName = isChild ? lineById[line.id]?.parent_line_name : null;
              return (
                <tr key={line.id}>
                  <td style={{ fontWeight: 600, fontSize: 14 }}>
                    {line.name}
                    {following && team && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--muted)' }} title={`ตามไลน์แม่ (${parentName})`}>↳ ตามไลน์แม่</span>}
                    {isChild && !following && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#f59e0b' }} title="ตั้งกะเอง ไม่ตามไลน์แม่">✎ แก้เอง</span>}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{line.section || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    {team ? (
                      <span style={{
                        display: 'inline-block', padding: '5px 20px', borderRadius: 7,
                        fontSize: 14, fontWeight: 800,
                        background: team === 'A' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                        color:      team === 'A' ? '#22c55e'              : '#f59e0b',
                        border: isPending
                          ? `2px solid ${team === 'A' ? '#22c55e' : '#f59e0b'}`
                          : '1px solid transparent',
                      }}>
                        Team {team}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่กำหนด</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {night ? (
                      <span style={{
                        display: 'inline-block', padding: '5px 20px', borderRadius: 7,
                        fontSize: 14, fontWeight: 800,
                        background: night === 'A' ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
                        color:      night === 'A' ? 'rgba(34,197,94,0.6)'  : 'rgba(245,158,11,0.6)',
                        border: '1px solid transparent',
                      }}>
                        Team {night}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
                    )}
                  </td>
                  {canEdit && (
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => toggleTeam(line.id)}
                        style={{
                          padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                          border: '1px solid var(--border2)',
                          background: isPending ? 'rgba(245,158,11,0.12)' : 'var(--bg3)',
                          color: isPending ? 'var(--amber)' : 'var(--text2)',
                          cursor: 'pointer',
                        }}
                      >
                        {team ? '⇄ สลับ' : '+ กำหนด'}
                      </button>
                      {isChild && !following && (
                        <button onClick={() => resetToParent(line.id)} title="กลับไปใช้กะตามไลน์แม่"
                          style={{ marginLeft: 6, padding: '6px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--muted)', cursor: 'pointer' }}>
                          ↳ ตามแม่
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 24, padding: '0 4px' }}>
          การตั้งค่าจะมีผลกับทุกวันในสัปดาห์ (จันทร์–อาทิตย์) กด ⇄ สลับ แล้วกด 💾 บันทึก · <b>ตั้งกะที่ไลน์แม่แล้วไลน์ลูกวิ่งตามอัตโนมัติ</b> (↳ ตามไลน์แม่) · สลับกะที่ไลน์ลูกเอง = ✎ แก้เอง (ไม่ตามแม่แล้ว) กด "↳ ตามแม่" เพื่อกลับไปตามไลน์แม่
        </div>
      )}

      {/* Individual Overrides */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--text2)' }}>
          🔀 รายการพิเศษรายบุคคล (สัปดาห์นี้)
        </h3>
        {canEdit && (
          <button
            onClick={() => { setOvrDate(weekStart); setShowOvrModal(true); }}
            style={{ padding: '7px 16px', background: 'rgba(77,159,255,0.15)', color: 'var(--blue)', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 8, fontSize: 13, fontWeight: 600 }}
          >
            ➕ เพิ่มรายการ
          </button>
        )}
      </div>

      <div className="card table-sticky" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 500 }}>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>รหัส</th>
              <th>พนักงาน</th>
              <th style={{ textAlign: 'center' }}>กะ</th>
              <th>เหตุผล</th>
              {canEdit && <th style={{ textAlign: 'center' }}>ลบ</th>}
            </tr>
          </thead>
          <tbody>
            {overrides.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13 }}>
                  ไม่มีรายการพิเศษในสัปดาห์นี้
                </td>
              </tr>
            )}
            {overrides.map(o => (
              <tr key={o.id}>
                <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{o.work_date}</td>
                <td style={{ fontSize: 12, color: 'var(--blue)', fontFamily: 'var(--font-display)' }}>{o.employees?.employee_id_code}</td>
                <td style={{ fontSize: 13 }}>{o.employees?.name}</td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{
                    padding: '3px 10px', borderRadius: 5, fontSize: 12, fontWeight: 700,
                    background: o.shift === 'day' ? 'rgba(245,158,11,0.15)' : 'rgba(77,159,255,0.15)',
                    color: o.shift === 'day' ? '#f59e0b' : '#4d9fff',
                  }}>
                    {o.shift === 'day' ? '☀️ เช้า' : '🌙 ดึก'}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--muted)' }}>{o.reason || '—'}</td>
                {canEdit && (
                  <td style={{ textAlign: 'center' }}>
                    {canDel && <button className="tbtn" onClick={() => handleDeleteOverride(o.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 15, padding: '2px 6px' }}>🗑️</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Shift Merge Events */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 28 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--text2)' }}>
          ⚡ เหตุการณ์ยุบกะ (Shift Merge)
        </h3>
        {canEdit && (
          <button
            onClick={() => { setMrgStart(weekStart); setMrgEnd(toDateStr(weekDates[6])); setShowMergeModal(true); }}
            style={{ padding: '7px 16px', background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 13, fontWeight: 600 }}
          >
            ➕ สร้างเหตุการณ์ยุบกะ
          </button>
        )}
      </div>
      <div className="card table-sticky" style={{ overflowX: 'auto', marginBottom: 8 }}>
        <table style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>ขอบเขต</th>
              <th style={{ textAlign: 'center' }}>วันที่เริ่ม</th>
              <th style={{ textAlign: 'center' }}>วันที่สิ้นสุด</th>
              <th style={{ textAlign: 'center' }}>เปลี่ยนเป็น</th>
              <th>สาเหตุ</th>
              {canEdit && <th style={{ textAlign: 'center' }}>ลบ</th>}
            </tr>
          </thead>
          <tbody>
            {visibleMergeEvents.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13 }}>
                  ไม่มีเหตุการณ์ยุบกะที่ใช้งานอยู่
                </td>
              </tr>
            )}
            {visibleMergeEvents.map(evt => {
              const cnt = affectedCount(evt);
              const scopeLabel = evt.line_id
                ? `ไลน์ ${lines.find(l => l.id === evt.line_id)?.name || evt.line_id}`
                : `Section ${evt.section}`;
              const isActive = evt.start_date <= toDateStr(new Date()) && evt.end_date >= toDateStr(new Date());
              return (
                <tr key={evt.id}>
                  <td>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{scopeLabel}</span>
                    {cnt !== null && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>({cnt} คน)</span>}
                    {isActive && <span style={{ marginLeft: 6, fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontWeight: 700 }}>กำลังใช้งาน</span>}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 13, whiteSpace: 'nowrap' }}>{evt.start_date}</td>
                  <td style={{ textAlign: 'center', fontSize: 13, whiteSpace: 'nowrap' }}>{evt.end_date}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 5, fontSize: 12, fontWeight: 700,
                      background: evt.target_shift === 'day' ? 'rgba(245,158,11,0.15)' : 'rgba(77,159,255,0.15)',
                      color: evt.target_shift === 'day' ? '#f59e0b' : '#4d9fff',
                    }}>
                      {evt.target_shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{evt.reason || '—'}</td>
                  {canEdit && (
                    <td style={{ textAlign: 'center' }}>
                      {canDel && <button className="tbtn" onClick={() => handleDeleteMergeEvent(evt.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 15, padding: '2px 6px' }}>🗑️</button>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 24, padding: '0 4px' }}>
        เหตุการณ์ยุบกะจะ override ตาราง A/B ปกติ แต่ shift override รายบุคคลจะยังมีสิทธิ์สูงสุด
      </div>

      {/* Merge Event Modal */}
      {showMergeModal && (
        <div className="overlay">
          <div className="modal">
            <h3 style={{ marginTop: 0, marginBottom: 18, fontFamily: 'var(--font-display)', color: 'var(--text)', fontSize: 16 }}>
              ⚡ สร้างเหตุการณ์ยุบกะ
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelSt}>ขอบเขต</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['section', 'line'].map(s => (
                    <button key={s} onClick={() => setMrgScope(s)}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        border: mrgScope === s ? '2px solid var(--accent)' : '1px solid var(--border2)',
                        background: mrgScope === s ? 'var(--accent-dim)' : 'var(--bg3)',
                        color: mrgScope === s ? 'var(--accent)' : 'var(--text2)',
                      }}>
                      {s === 'section' ? '🏭 Section' : '📋 ไลน์เดียว'}
                    </button>
                  ))}
                </div>
              </div>
              {mrgScope === 'section' ? (
                <div>
                  <label style={labelSt}>Section</label>
                  <select value={mrgSection} onChange={e => setMrgSection(e.target.value)}>
                    <option value="">— เลือก Section —</option>
                    {scopedSections.map(sec => (
                      <option key={sec} value={sec}>{sec}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label style={labelSt}>ไลน์ผลิต</label>
                  <select value={mrgLineId} onChange={e => setMrgLineId(e.target.value)}>
                    <option value="">— เลือกไลน์ —</option>
                    {scopedLines.map(l => (
                      <option key={l.id} value={l.id}>{l.name} {l.section ? `(${l.section})` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelSt}>วันที่เริ่ม</label>
                  <input type="date" value={mrgStart} onChange={e => setMrgStart(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelSt}>วันที่สิ้นสุด</label>
                  <input type="date" value={mrgEnd} min={mrgStart} onChange={e => setMrgEnd(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={labelSt}>เปลี่ยนทุกคนใน scope นี้เป็น</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[['day', '☀️ กะเช้า'], ['night', '🌙 กะดึก']].map(([val, label]) => (
                    <button key={val} onClick={() => setMrgShift(val)}
                      style={{
                        flex: 1, padding: '10px 0', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        border: mrgShift === val ? '2px solid var(--accent)' : '1px solid var(--border2)',
                        background: mrgShift === val ? 'var(--accent-dim)' : 'var(--bg3)',
                        color: mrgShift === val ? 'var(--accent)' : 'var(--text2)',
                      }}>{label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={labelSt}>สาเหตุ / หมายเหตุ</label>
                <input type="text" placeholder="เช่น ลดแผนผลิต Q2, ลูกค้าลด order" value={mrgReason} onChange={e => setMrgReason(e.target.value)} />
              </div>

              {/* Preview */}
              {(mrgScope === 'section' ? mrgSection : mrgLineId) && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 12 }}>
                  <strong>ผลกระทบ:</strong>{' '}
                  {mrgScope === 'section'
                    ? `พนักงานทุกคนใน ${mrgSection} (${employees.filter(e => e.production_lines?.section === mrgSection).length} คน)`
                    : `พนักงานใน ${lines.find(l => String(l.id) === String(mrgLineId))?.name} (${employees.filter(e => String(e.line_id) === String(mrgLineId)).length} คน)`
                  }{' '}
                  จะถูกย้ายเป็น{mrgShift === 'day' ? 'กะเช้า' : 'กะดึก'} ตั้งแต่ {mrgStart} ถึง {mrgEnd}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={handleAddMergeEvent}
                  disabled={!(mrgScope === 'section' ? mrgSection : mrgLineId) || !mrgStart || !mrgEnd}
                  style={{ flex: 2, padding: 11, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontFamily: 'var(--font-display)', opacity: !(mrgScope === 'section' ? mrgSection : mrgLineId) ? 0.5 : 1 }}>
                  ✅ ยืนยันยุบกะ
                </button>
                <button onClick={() => setShowMergeModal(false)}
                  style={{ flex: 1, padding: 11, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8 }}>
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Override Modal */}
      {showOvrModal && (
        <div className="overlay">
          <div className="modal">
            <h3 style={{ marginTop: 0, marginBottom: 18, fontFamily: 'var(--font-display)', color: 'var(--text)', fontSize: 16 }}>
              🔀 เพิ่มรายการพิเศษรายบุคคล
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelSt}>วันที่</label>
                <input type="date" value={ovrDate} onChange={e => setOvrDate(e.target.value)} />
              </div>
              <div>
                <label style={labelSt}>พนักงาน</label>
                <select value={ovrEmpId} onChange={e => setOvrEmpId(e.target.value)}>
                  <option value="">— เลือกพนักงาน —</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.employee_id_code} — {emp.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelSt}>กะ</label>
                <select value={ovrShift} onChange={e => setOvrShift(e.target.value)}>
                  <option value="day">☀️ กะเช้า (08:00–19:59)</option>
                  <option value="night">🌙 กะดึก (20:00–07:59)</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>เหตุผล (ถ้ามี)</label>
                <input type="text" placeholder="เช่น ขอเปลี่ยนกะ" value={ovrReason} onChange={e => setOvrReason(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={handleAddOverride} disabled={!ovrEmpId}
                  style={{ flex: 2, padding: 11, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                  บันทึก
                </button>
                <button onClick={() => setShowOvrModal(false)}
                  style={{ flex: 1, padding: 11, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8 }}>
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 6,
  letterSpacing: '0.05em', textTransform: 'uppercase',
};
