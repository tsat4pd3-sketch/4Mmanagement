/* ══ ♻️ 5S → Dashboard (ยกจาก Core `FiveSDash.tsx` 27/11 · loop smf01) ══════════════════════════════════
   ส่วนย่อย (Detail Bar `?sec=`): กลยุทธ์ · ภาพรวม · อันดับ · ผู้ตรวจ · แผนงาน · ทีม — สูตรทั้งหมดอยู่ `dash.js`
   · โหลดรายปี: ใบตรวจ (act02_audit) + คะแนนราย ส (วิว act02_audit_group ทีละ 120 ใบ) + ทีม + แผนตรวจ + แผนงาน + เกณฑ์ผ่าน
   · ข้อมูลไม่พอ = เขียนบนจอ (ไม่มีใบตรวจ / ไม่มีเอกสาร) · ไม่มีใบในเดือนนั้น = "-" ไม่ใช่ 0 */
import { useEffect, useMemo, useState } from 'react';
import useIsMobile from '../../utils/useIsMobile';
import useFitHeight from '../../utils/useFitHeight';
import { supabase } from '../../supabaseClient';
import { tr } from '../../utils/i18n';
import { monthsShort, yearDisplay, fmtDate } from '../../utils/dateFormat';
import { fetchAllPages, fetchByIds } from '../../utils/fetchByIds';
import { getWorkDate } from '../../utils/workDate';
import StdBarChart from '../../components/StdBarChart';
import { StrategyBook } from '../../components/StrategyBook';
import PlanGantt from '../../components/PlanGantt';
import { ACT_CODE, ROLES, S_GROUPS, S_GROUP_LABEL, labelOf } from './labels.js';
import { auditorState, auditorStats, marksOf, passOf, ranking, summarize, teamBucket } from './dash.js';

const sel = { width: 'auto', maxWidth: 240, padding: '4px 8px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 12 };
const panel = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)', padding: 14 };
const th = { padding: '7px 9px', fontSize: 12, color: 'var(--muted)', fontWeight: 700, borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', background: 'var(--bg3)', position: 'sticky', top: 0 };
const td = { padding: '6px 9px', fontSize: 13, borderTop: '1px solid var(--border)', borderRight: '1px solid var(--border)' };
const f1 = (n) => (n == null ? '-' : Number(n).toFixed(1));
const f2 = (n) => (n == null ? '-' : Number(n).toFixed(2));

/* ── โหลดข้อมูลรายปี (ทุกส่วนใช้ชุดเดียวกัน · กดรีเฟรช = tick เปลี่ยน) ─────────────────────────── */
function useDashData(year, tick) {
  const [got, setGot] = useState({ key: null });
  const key = `${year}|${tick}`;
  useEffect(() => {
    let alive = true;
    (async () => {
      const [aud, team, plans, tasks, settings] = await Promise.all([
        fetchAllPages(() => supabase.from('act02_audit').select('act_audit, audit_no, audit_type, act_area, team, auditors, audited_at, percent_score, result, status').eq('year', year), { orderBy: 'act_audit' }),
        fetchAllPages(() => supabase.from('act02_team').select('act_team, employee_code, employee_name, role, team, act_area, status').eq('year', year), { orderBy: 'act_team' }),
        fetchAllPages(() => supabase.from('act02_audit_plan').select('act_audit_plan, month, round, team').eq('year', year), { orderBy: 'act_audit_plan' }),
        fetchAllPages(() => supabase.from('act02_task').select('act_task, parent_id, sort_no, title, start_date, end_date, progress, owner_code, owner_name, unit, done_on, note').eq('year', year), { orderBy: 'act_task' }),
        supabase.from('act02_setting').select('setting_key, setting_value'),
      ]);
      const ids = aud.rows.filter(a => a.status === 'COMPLETED').map(a => a.act_audit);
      const grp = ids.length
        ? await fetchByIds(ids, (part) => supabase.from('act02_audit_group').select('act_audit, s_group, percent').in('act_audit', part), { orderBy: 'act_audit' })
        : { rows: [], error: null, truncated: false };
      if (!alive) return;
      const err = aud.error || team.error || plans.error || tasks.error || grp.error || settings.error?.message
        || ((aud.truncated || grp.truncated) ? tr('ข้อมูลเยอะเกินเพดาน — โหลดได้ไม่ครบ') : '');
      setGot({ key, audits: aud.rows, groups: grp.rows, team: team.rows, plans: plans.rows, tasks: tasks.rows, settings: settings.data || [], err });
    })();
    return () => { alive = false; };
  }, [year, key]);
  return got.key === key ? got : null;
}

/* ── ส่วนประกอบ ───────────────────────────────────────────────────────────────────────── */
function Donut({ percent }) {
  const turn = Math.max(0, Math.min(100, percent || 0)) * 3.6;
  return (
    <span style={{ width: 52, height: 52, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: `conic-gradient(var(--green-line) ${turn}deg, var(--bg3) 0)` }}>
      <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--card)' }} />
    </span>
  );
}

function Tile({ label, value, unit, mark }) {
  return (
    <div style={{ ...panel, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>{value}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginLeft: 4 }}>{unit}</span></div>
      </div>
      {mark}
    </div>
  );
}

const tiles = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 10, alignContent: 'start' };

function ScoreChart({ title, kind, months, marks, color }) {
  const names = monthsShort();
  const placeName = (p) => (p === 'factory' ? tr('โรงงาน') : tr('สำนักงาน'));
  const data = months.map(m => ({ name: names[m.month - 1], value: m.percent, inner: m.audits ? `${m.audits} ${tr('ใบ')}` : '' }));
  return (
    <StdBarChart title={title} data={data} color={color} unit="%" digits={2} yMax={100} yTicks={[0, 25, 50, 75, 100]}
      yTitle={tr('คะแนน (%)')} seriesLabel={`${kind} ${tr('% เฉลี่ยของเดือน')}`}
      targets={marks.map(m => ({
        value: m.value,
        label: `Target${m.place ? ` ${placeName(m.place)}` : ''} ${Number(m.value).toFixed(2)}%`,
        legend: `${tr('เกณฑ์ผ่าน')} ${kind}${m.place ? ` ${placeName(m.place)}` : ''} ${Number(m.value).toFixed(2)}%`,
      }))} />
  );
}

function MonthTable({ self, committee }) {
  const names = monthsShort();
  return (
    <div style={{ ...panel, padding: 0, overflow: 'auto', flex: 1, minWidth: 0 }}>
      <table style={{ width: '100%', height: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup><col style={{ width: '24%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /></colgroup>
        <thead>
          <tr>
            <th style={th} rowSpan={2}>{tr('เดือน')}</th>
            <th style={{ ...th, textAlign: 'center' }} colSpan={2}>Self Audit</th>
            <th style={{ ...th, textAlign: 'center', borderRight: 'none' }} colSpan={2}>Committee Audit</th>
          </tr>
          <tr>
            {['%', tr('ครั้ง'), '%', tr('ครั้ง')].map((h, i) => <th key={i} style={{ ...th, textAlign: 'right', top: 31, borderRight: i === 3 ? 'none' : th.borderRight }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {self.map((m, i) => (
            <tr key={m.month}>
              <td style={td}>{names[m.month - 1]}</td>
              <td style={{ ...td, textAlign: 'right' }}>{f2(m.percent)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{m.audits}</td>
              <td style={{ ...td, textAlign: 'right' }}>{f2(committee[i].percent)}</td>
              <td style={{ ...td, textAlign: 'right', borderRight: 'none' }}>{committee[i].audits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* `fill` = ตารางหลักของส่วนนั้น ยืดถึงก้นจอ (28/11 คำสั่ง user "กรอบล่างว่าง ปรับให้เต็ม · ทุกขนาดจอ")
   ความสูงวัดจริงด้วย `useFitHeight` (ห้ามเดา vh) · แถวน้อย = แถวเติมท้ายให้เส้นคอลัมน์ลากถึงขอบล่าง · แถวเยอะ = เลื่อนในกรอบ หัวค้าง */
function SimpleTable({ cols, rows, rowKey, empty, onRow, fill = false }) {
  const [ref, fitH] = useFitHeight(0, 240);
  const fit = fill && fitH != null;
  const lastBorder = (i) => (i === cols.length - 1 ? 'none' : td.borderRight);
  return (
    <div ref={fill ? ref : undefined} style={{ ...panel, padding: 0, overflow: 'auto', ...(fit ? { height: fitH } : { maxHeight: fill ? '62vh' : '50vh' }) }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', ...(fit ? { height: '100%' } : null) }}>
        <thead><tr>{cols.map((c, i) => <th key={c.key} style={{ ...th, textAlign: c.align || 'left', width: c.width, borderRight: i === cols.length - 1 ? 'none' : th.borderRight }}>{tr(c.label)}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} style={{ cursor: onRow ? 'pointer' : undefined, height: 1 }}>
              {cols.map((c, i) => <td key={c.key} style={{ ...td, textAlign: c.align || 'left', borderRight: lastBorder(i) }}>{c.render ? c.render(r, ri) : r[c.key]}</td>)}
            </tr>
          ))}
          {!rows.length && <tr style={{ height: 1 }}><td colSpan={cols.length} style={{ ...td, color: 'var(--muted)', padding: 16, verticalAlign: 'top' }}>{empty}</td></tr>}
          {fit && rows.length > 0 && (
            <tr aria-hidden="true">{cols.map((c, i) => <td key={c.key} style={{ ...td, padding: 0, borderRight: lastBorder(i) }} />)}</tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const Chip = ({ tone, children }) => (
  <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-sm, 6px)', background: `var(--${tone}-dim)`, color: `var(--${tone})`, whiteSpace: 'nowrap' }}>{children}</span>
);
const Note = ({ children }) => <div style={{ ...panel, color: 'var(--muted)', fontSize: 13 }}>{children}</div>;

/* ป้ายคอลัมน์เป็นไทยล้วน — SimpleTable แปลตอนวาด (กฎ i18n-map-label-at-declaration) */
/* ── หน้าหลักของ Dashboard ───────────────────────────────────────────────────────────── */
export default function Dashboard5s({ sec, year, yearPick, areas, tick, q, onLoaded }) {
  const data = useDashData(year, tick);
  useEffect(() => { if (data) onLoaded?.(data.err || ''); }, [data, onLoaded]);   // บอกหน้าแม่ว่าโหลดรอบนี้เสร็จ (toast รีเฟรช)
  const wide = !useIsMobile(1100);   // จอกว้างพอ = กริด 5 คอลัมน์ (ขอบตารางตรงไทล์)
  const grid5 = wide ? 'repeat(5, minmax(0, 1fr))' : 'minmax(0, 1fr)';
  const [type, setType] = useState('');
  const [areaType, setAreaType] = useState('');
  const [area, setArea] = useState('');
  const [upTo, setUpTo] = useState(12);
  const [audTeam, setAudTeam] = useState('');
  const [audStatus, setAudStatus] = useState('');
  const [picked, setPicked] = useState(null);

  const pass = useMemo(() => passOf(data?.settings, year), [data, year]);
  const sum = useMemo(() => (data ? summarize({ areas, audits: data.audits, groups: data.groups, areaType, areaId: area, type }) : null), [data, areas, areaType, area, type]);
  const rank = useMemo(() => (data ? ranking({ areas, audits: data.audits, groups: data.groups, upTo }) : null), [data, areas, upTo]);
  const aud = useMemo(() => (data ? auditorStats({ team: data.team, plans: data.plans, audits: data.audits, passTarget: pass.committee }) : null), [data, pass]);
  const areaName = useMemo(() => new Map(areas.map(a => [a.act_area, `${a.area_code} ${a.act_area_name}`])), [areas]);
  const names = monthsShort();
  const needle = q.trim().toLowerCase();

  const filters = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {yearPick}
      {sec === 'summary' && (
        <>
          <select style={sel} value={type} onChange={e => setType(e.target.value)} aria-label={tr('ประเภทการตรวจ')}>
            <option value="">{tr('ทุกประเภทการตรวจ')}</option><option value="SELF">Self Audit</option><option value="COMMITTEE">Committee</option>
          </select>
          <select style={sel} value={areaType} onChange={e => { setAreaType(e.target.value); setArea(''); }} aria-label={tr('ประเภทพื้นที่')}>
            <option value="">{tr('ทุกประเภทพื้นที่')}</option><option value="factory">{tr('โรงงาน')}</option><option value="office">{tr('สำนักงาน')}</option>
          </select>
          <select style={sel} value={area} onChange={e => setArea(e.target.value)} aria-label={tr('พื้นที่')}>
            <option value="">{tr('ทุกพื้นที่')}</option>
            {areas.filter(a => !areaType || a.area_type === areaType).map(a => <option key={a.act_area} value={a.act_area}>{a.area_code} {a.act_area_name}</option>)}
          </select>
        </>
      )}
      {sec === 'ranking' && (
        <select style={sel} value={upTo} onChange={e => setUpTo(Number(e.target.value))} aria-label={tr('เดือน')}>
          {names.map((m, i) => <option key={m} value={i + 1}>{i === 0 ? m : `${tr('สะสม')} ${names[0]}–${m}`}</option>)}
        </select>
      )}
      {sec === 'auditor' && (
        <>
          <select style={sel} value={audTeam} onChange={e => setAudTeam(e.target.value)} aria-label={tr('ทีม')}>
            <option value="">{tr('ทุกทีม')}</option>{(aud?.teams || []).map(t => <option key={t} value={t}>{tr('ทีม')} {t}</option>)}
          </select>
          <select style={sel} value={audStatus} onChange={e => setAudStatus(e.target.value)} aria-label={tr('สถานะ')}>
            <option value="">{tr('ทุกสถานะ')}</option>
            <option value="complete">{tr('ครบตามแผน')}</option><option value="pass">{tr('ผ่านเกณฑ์')}</option>
            <option value="below">{tr('ต่ำกว่าเกณฑ์')}</option><option value="none">{tr('ยังไม่เข้าตรวจ')}</option>
          </select>
        </>
      )}
      {!data && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('กำลังโหลด…')}</span>}
    </div>
  );

  const noAudit = data && !data.audits.length && (
    <Note>{tr('ยังไม่มีใบตรวจ 5S ของปี')} {yearDisplay(year)} {tr('ในระบบ — ตัวเลขบนจอนี้จะขึ้นเมื่อมีใบตรวจ (นำเข้าประวัติจากระบบเดิม หรือบันทึกใบตรวจที่ Edit Data)')}</Note>
  );

  let body = null;
  if (sec === 'strategy') body = <StrategyBook key={tick} code={ACT_CODE} title="5S" />;   // ของกลาง (PDF e-book) · ไม่ต้องรอข้อมูลใบตรวจ

  if (data && sec === 'summary') {
    body = (
      <>
        {noAudit}
        {/* กริด 5 คอลัมน์ชุดเดียวกัน (28/11 คำสั่ง user "ขอบตารางให้ตรงรอบข้าง"): ไทล์ 5 ใบ · กราฟกว้าง 3 · ตารางกว้าง 2
            ⇒ ขอบซ้าย/ขวาของตารางตรงกับไทล์ใบที่ 4/5 · ตารางสูงเท่ากราฟ 2 อัน (stretch) · จอแคบ = เรียงลงคอลัมน์เดียว */}
        <div style={{ display: 'grid', gridTemplateColumns: wide ? grid5 : 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12, alignContent: 'start' }}>
          {sum.groups.map((g, i) => (
            <Tile key={g.group} label={`ส${i + 1} ${tr(S_GROUP_LABEL[g.group])} · ${tr('เฉลี่ยทั้งปี')}`} value={f1(g.percent)} unit="%" mark={<Donut percent={g.percent} />} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: grid5, gap: 12, alignItems: 'stretch' }}>
          <div style={{ gridColumn: wide ? 'span 3' : undefined, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ScoreChart title="Self Audit Score" kind="Self Audit" months={sum.self} marks={marksOf(pass, 'self', areaType)} color="var(--green)" />
            <ScoreChart title="Committee Audit Score" kind="Committee Audit" months={sum.committee} marks={marksOf(pass, 'committee', areaType)} color="var(--blue)" />
          </div>
          <div style={{ gridColumn: wide ? 'span 2' : undefined, minWidth: 0, display: 'flex' }}>
            <MonthTable self={sum.self} committee={sum.committee} />
          </div>
        </div>
      </>
    );
  }

  if (data && sec === 'ranking') {
    body = (
      <>
        {noAudit}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {['factory', 'office'].map(kind => (
            <div key={kind} style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{kind === 'factory' ? tr('โรงงาน') : tr('สำนักงาน')}</div>
              <SimpleTable fill rows={rank[kind]} rowKey={r => r.id} empty={tr('ยังไม่มีผลตรวจ')}
                cols={[
                  { key: 'no', label: 'ลำดับ', width: 56, align: 'right', render: (_r, i) => i + 1 },
                  { key: 'name', label: 'พื้นที่', render: r => `${r.code} ${r.name}` },
                  ...S_GROUPS.map((g, i) => ({ key: g, label: `ส${i + 1}`, align: 'right', render: r => f1(r.groups[i]) })),
                  { key: 'avg', label: 'เฉลี่ย', align: 'right', render: r => <b>{f1(r.average)}</b> },
                ]} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (data && sec === 'auditor') {
    const stateLabel = { complete: 'ครบตามแผน', pass: 'ผ่านเกณฑ์', below: 'ต่ำกว่าเกณฑ์', none: 'ยังไม่เข้าตรวจ' };
    const stateTone = { complete: 'green', pass: 'green', below: 'red', none: 'amber' };
    const rows = aud.rows.filter(r => (!audTeam || r.team === audTeam) && (!audStatus || auditorState(r, pass.committee) === audStatus)
      && (!needle || `${r.code} ${r.name} ${r.team}`.toLowerCase().includes(needle)));
    body = (
      <>
        <div style={tiles}>
          <Tile label={tr('ผู้ตรวจประเมินทั้งหมด')} value={aud.total} unit={tr('คน')} />
          <Tile label={tr('แผนการเข้าตรวจรวม')} value={aud.planned} unit={tr('ครั้ง')} />
          <Tile label={tr('เข้าตรวจจริงรวม')} value={aud.actual} unit={tr('ครั้ง')} />
          <Tile label={tr('% การมีส่วนร่วมเฉลี่ย')} value={aud.avgParticipation ?? '-'} unit="%" />
          <Tile label={`${tr('ผ่านเกณฑ์')} (≥ ${pass.committee}%)`} value={`${aud.passed} / ${aud.total}`} unit={tr('คน')} />
        </div>
        <SimpleTable fill rows={rows} rowKey={r => r.code} empty={aud.total ? tr('ไม่พบผู้ตรวจตามตัวกรอง') : tr('ยังไม่มีผู้ตรวจของปีนี้ (ตั้งที่ Setting → ทีม บทบาท "ทีมตรวจ")')} onRow={setPicked}
          cols={[
            { key: 'code', label: 'รหัส', render: r => <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.code}</span> },
            { key: 'name', label: 'ชื่อ - นามสกุล', render: r => r.name || '-' },
            { key: 'team', label: 'ทีม', render: r => `${tr('ทีม')} ${r.team}` },
            { key: 'planned', label: 'แผนรวม', align: 'right' },
            { key: 'actual', label: 'ตรวจจริง', align: 'right' },
            { key: 'percent', label: '% การมีส่วนร่วม', align: 'right', render: r => `${r.percent}%` },
            { key: 'avg', label: 'คะแนนเฉลี่ย', align: 'right', render: r => f2(r.avgScore) },
            { key: 'st', label: 'สถานะ', render: r => { const s = auditorState(r, pass.committee); return <Chip tone={stateTone[s]}>{tr(stateLabel[s])}</Chip>; } },
          ]} />
      </>
    );
  }

  if (data && sec === 'schedule') {
    /* แผนงานแบบ Gantt (ของกลาง · 28/11 แบบเว็บเดิม) — แก้ที่ Setting → แผนงาน */
    body = <PlanGantt rows={data.tasks} year={year} today={getWorkDate()} query={q} empty={tr('ยังไม่มีแผนงาน 5S ของปีนี้ — เพิ่มที่ Setting → แผนงาน')} />;
  }

  if (data && sec === 'team') {
    const members = data.team.filter(m => m.status === 'Active');
    const groups = [['board', 'คณะกรรมการ'], ['standard', 'ทีมมาตรฐาน'], ['academic', 'ทีมวิชาการ'], ['pr', 'ประชาสัมพันธ์'], ['audit', 'ทีมตรวจประเมิน']];
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 12, alignContent: 'start' }}>
        {groups.map(([k, label]) => {
          const list = members.filter(m => teamBucket(m.role) === k && (!needle || `${m.employee_code} ${m.employee_name || ''}`.toLowerCase().includes(needle)));
          return (
            <div key={k} style={panel}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{tr(label)} · {list.length} {tr('คน')}</div>
              {list.length ? list.map(m => (
                <div key={m.act_team} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '3px 0' }}>
                  <span><span style={{ fontFamily: 'monospace' }}>{m.employee_code}</span> {m.employee_name || ''}</span>
                  <span style={{ color: 'var(--muted)', textAlign: 'right' }}>
                    {m.role === 'owner' ? (areaName.get(m.act_area) || tr('พื้นที่')) : m.team ? `${tr('ทีม')} ${m.team}` : tr(labelOf(ROLES, m.role))}
                  </span>
                </div>
              )) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('ยังไม่มีสมาชิก')}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      {filters}
      {data?.err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{data.err}</div>}
      {body}
      {picked && (
        <div className="overlay">
          <div className="modal" style={{ width: 'min(96vw, 620px)', maxWidth: 620, maxHeight: '94vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0, fontSize: 17, color: 'var(--text)' }}>{picked.code} {picked.name}</h3>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
              {tr('ทีม')} {picked.team} · {tr('แผน')} {picked.planned} · {tr('ตรวจจริง')} {picked.actual} · {picked.percent}%
            </div>
            <SimpleTable rows={picked.audits} rowKey={r => r.act_audit} empty={tr('ยังไม่มีประวัติการเข้าตรวจ')}
              cols={[
                { key: 'd', label: 'วันที่', render: r => fmtDate(r.audited_at) },
                { key: 'no', label: 'ใบตรวจ', render: r => r.audit_no },
                { key: 'area', label: 'พื้นที่', render: r => areaName.get(r.act_area) || '-' },
                { key: 'p', label: '%', align: 'right', render: r => f2(r.percent_score) },
                { key: 'r', label: 'ผล', render: r => (r.result ? <Chip tone={r.result === 'PASS' ? 'green' : 'red'}>{r.result}</Chip> : '-') },
              ]} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="pg-btn" onClick={() => setPicked(null)}>{tr('ปิด')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
