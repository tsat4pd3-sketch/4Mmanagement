/* ══ 🏭 Smart Factory → Dashboard (ยกจากเว็บ TSAT4 Activity "SMF" 28/11 · loop smf01) ══════════════════════════════
   ส่วนย่อย: กลยุทธ์ (PDF e-book ของกลาง) · ภาพรวม (การ์ดต่อโครงการ) · แผนงาน · ทีม — สูตร `dash.js`
   · ข้อมูลไม่พอ = เขียนบนจอ (ยังไม่มีแผนงาน / ยังไม่มีทีม) ห้ามโชว์ 0 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { tr } from '../../utils/i18n';
import { fetchAllPages } from '../../utils/fetchByIds';
import { getWorkDate } from '../../utils/workDate';
import { StrategyBook } from '../../components/StrategyBook';
import PlanGantt from '../../components/PlanGantt';
import { ACT_CODE, TARGET_TYPES, TEAM_TYPES, labelOf, roleLabel } from './labels.js';
import { progressTone, projectSummary } from './dash.js';

const panel = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)', padding: 16 };
const Note = ({ children }) => <div style={{ ...panel, color: 'var(--muted)', fontSize: 13 }}>{children}</div>;
const Chip = ({ tone, children }) => (
  <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-sm, 6px)', background: `var(--${tone}-dim)`, color: `var(--${tone})`, whiteSpace: 'nowrap' }}>{children}</span>
);

function useSmfData(year, tick) {
  const [got, setGot] = useState({ key: null });
  const key = `${year}|${tick}`;
  useEffect(() => {
    let alive = true;
    (async () => {
      const [proj, team, tasks] = await Promise.all([
        supabase.from('act03_project').select('*').eq('year', year).order('sort_no'),
        fetchAllPages(() => supabase.from('act03_team').select('act_team, employee_code, employee_name, role, unit, department, status').eq('year', year), { orderBy: 'act_team' }),
        fetchAllPages(() => supabase.from('act03_task').select('act_task, parent_id, sort_no, title, start_date, end_date, progress, owner_code, owner_name, unit, done_on').eq('year', year), { orderBy: 'act_task' }),
      ]);
      if (!alive) return;
      setGot({ key, projects: proj.data || [], team: team.rows, tasks: tasks.rows, err: proj.error?.message || team.error || tasks.error || '' });
    })();
    return () => { alive = false; };
  }, [year, key]);
  return got.key === key ? got : null;
}

function Bar({ value }) {
  const tone = progressTone(value);
  return (
    <div style={{ height: 10, borderRadius: 999, background: 'var(--bg3)', overflow: 'hidden', border: '1px solid var(--border)' }}>
      {value != null && <div style={{ width: `${Math.max(2, value)}%`, height: '100%', background: `var(--${tone === 'muted' ? 'border2' : tone})` }} />}
    </div>
  );
}

export default function DashboardSmf({ sec, year, yearPick, tick, q, onLoaded }) {
  const data = useSmfData(year, tick);
  useEffect(() => { if (data) onLoaded?.(data.err || ''); }, [data, onLoaded]);
  const today = getWorkDate();
  const sum = useMemo(() => (data ? projectSummary({ projects: data.projects, tasks: data.tasks, team: data.team, today }) : []), [data, today]);
  const needle = q.trim().toLowerCase();

  if (sec === 'strategy') return <StrategyBook key={tick} code={ACT_CODE} title="Smart Factory" />;
  const head = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {yearPick}
      {!data && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('กำลังโหลด…')}</span>}
      {data?.err && <span style={{ fontSize: 13, color: 'var(--red)' }}>{data.err}</span>}
    </div>
  );
  if (!data) return head;

  if (sec === 'summary') {
    const totalHeads = sum.reduce((s, p) => s + p.heads, 0);
    return (
      <>
        {head}
        {!sum.length ? <Note>{tr('ยังไม่มีโครงการของปีนี้ — เพิ่มที่ Setting → โครงการ')}</Note> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 12, alignContent: 'start' }}>
            {sum.map(p => (
              <div key={p.code} style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{p.name}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Chip tone="blue">{tr(labelOf(TEAM_TYPES, p.teamType))}</Chip>
                    <Chip tone="green">{tr(labelOf(TARGET_TYPES, p.targetType))}</Chip>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)' }}>{p.progress == null ? '-' : `${p.progress}%`}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {p.targetType === 'count'
                      ? `${tr('สำเร็จ')} ${p.done} / ${p.targetCount ?? '-'} ${tr('โครงการ')}`
                      : p.heads ? `${tr('ตามแผน')} · ${tr('สำเร็จ')} ${p.done} / ${p.heads} ${tr('หัวข้อหลัก')}` : tr('ยังไม่มีแผนงาน')}
                  </span>
                </div>
                <Bar value={p.progress} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                  {[['หัวข้อหลัก', p.heads], ['สำเร็จ', p.done], ['เลยกำหนด', p.overdue], ['ทีมงาน', p.members]].map(([l, v]) => (
                    <div key={l} style={{ background: 'var(--bg3)', borderRadius: 'var(--r-md)', padding: '8px 10px' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{tr(l)}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: l === 'เลยกำหนด' && v ? 'var(--red)' : 'var(--text)' }}>{v}</div>
                    </div>
                  ))}
                </div>
                {p.targetName && <div style={{ fontSize: 12, color: 'var(--muted)' }}>KPI: {p.targetName}{p.unit ? ` (${p.unit})` : ''} · {tr('ผลงานรายเดือนบันทึกที่ Edit Data (รอบถัดไป)')}</div>}
              </div>
            ))}
          </div>
        )}
        {sum.length > 0 && !totalHeads && <Note>{tr('ยังไม่มีแผนงานของปีนี้ — เพิ่มที่ Setting → แผนงาน')}</Note>}
      </>
    );
  }

  if (sec === 'plan') {
    /* แผนงานแบบ Gantt (ของกลาง · 28/11) — แก้ที่ Setting → แผนงาน */
    return (
      <>
        {head}
        <PlanGantt rows={data.tasks} year={year} today={today} query={q} empty={tr('ยังไม่มีแผนงานของปีนี้ — เพิ่มที่ Setting → แผนงาน')} />
      </>
    );
  }

  /* ทีม: คณะกรรมการ + ทีมย่อยของแต่ละโครงการ */
  const active = data.team.filter(m => m.status === 'Active' && (!needle || `${m.employee_code} ${m.employee_name || ''}`.toLowerCase().includes(needle)));
  const groups = [{ key: '', label: 'คณะกรรมการ' }, ...data.projects.filter(p => p.status === 'Active').map(p => ({ key: p.code, label: p.name }))];
  const order = { chairman: 0, vice: 1, advisor: 2, admin: 3, member: 4 };
  return (
    <>
      {head}
      {!data.team.length ? <Note>{tr('ยังไม่มีทีมของปีนี้ — เพิ่มที่ Setting → ทีม')}</Note> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 12, alignContent: 'start' }}>
          {groups.map(g => {
            const list = active.filter(m => (m.unit || '') === g.key).sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
            return (
              <div key={g.key || '__committee'} style={panel}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{tr(g.label)} · {list.length} {tr('คน')}</div>
                {list.length ? list.map(m => (
                  <div key={m.act_team} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '3px 0' }}>
                    <span><span style={{ fontFamily: 'monospace' }}>{m.employee_code}</span> {m.employee_name || ''}</span>
                    <span style={{ color: 'var(--muted)', textAlign: 'right' }}>{tr(roleLabel(m.role, m.unit))}{m.department ? ` · ${m.department}` : ''}</span>
                  </div>
                )) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('ยังไม่มีสมาชิก')}</div>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
