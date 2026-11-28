/* ══ 🏭 กิจกรรม Smart Factory (/activity-smart) — ยกจากเว็บ TSAT4 Activity "SMF" (2026-11-28 · คำสั่ง user · loop smf01) ══
   โครงเดียวกับ 5S (`pages/activity5s`): Dashboard / Edit Data / Setting สลับที่ Sub Bar (`?tab=`) · Detail Bar = `?sec=`
   · รอบ 1: Setting = กลยุทธ์ · โครงการ · ทีม · แผนงาน · Dashboard = กลยุทธ์ · ภาพรวม · แผนงาน · ทีม
   · รอบถัดไป: Edit Data = ผลงานรายเดือน (act03_project_month) + Work Flow Automation (act03_idea …) · ย้ายข้อมูลจริงจาก activity01
   · ข้อมูล: ตาราง act03_* (MAIN · migration 20261128b_act03_smf_main.sql) · เขียน = สิทธิ์ `act_smf:manage` (RLS has_perm คีย์เดียวกัน)
   · ตาราง/ฟอร์มใช้ของ 5S (`Table5s` · `FormModal`) — ห้ามก๊อปแยก */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import { toast } from '../../components/Toast';
import { UserContext } from '../../App';
import { supabase } from '../../supabaseClient';
import useTabParam from '../../utils/useTabParam';
import useStrategySetting from '../../utils/useStrategySetting';
import { useNavSubItems } from '../../utils/navSubItems';
import { ACTIVITY_TABS } from '../../utils/activityPages';
import { canSeeded } from '../../utils/permissions';
import { checkWrite, checkWriteRows } from '../../utils/dbWrite';
import { askConfirm } from '../../utils/askConfirm';
import { yearDisplay } from '../../utils/dateFormat';
import useLang from '../../utils/useLang';
import { FormModal, Table5s } from '../activity5s/setting';
import { missingField } from '../activity5s/sections';
import { ACT_CODE, DASH_SECTIONS, PERM, SETTING_SECTIONS, teamKey } from './labels.js';
import { sectionsFor, stamp } from './sections.js';
import DashboardSmf from './Dashboard';

const THIS_YEAR = new Date().getFullYear();
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: '60vh' };
const sel = { width: 'auto', padding: '4px 8px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 12 };

export default function ActivitySmf() {
  const { tr } = useLang();
  const { pathname } = useLocation();
  const { role } = useContext(UserContext);
  const canEdit = canSeeded(PERM[0], PERM[1], role);
  /* กลยุทธ์ใช้สิทธิ์เดียวกับ RLS ของ act_strategy (act_5s:manage ชั่วคราวทุกกิจกรรม) */
  const st = useStrategySetting(ACT_CODE, 'Smart Factory', canSeeded('act_5s', 'manage', role));
  const [tab, setTab] = useTabParam(ACTIVITY_TABS.map(t => t.key), ACTIVITY_TABS[0].key);
  const [sp] = useSearchParams();

  const sections = useMemo(() => {
    const list = tab === 'setting' ? SETTING_SECTIONS : tab === 'dashboard' ? DASH_SECTIONS : [];
    return list.map(s => ({ key: s.key, label: tr(s.label) }));
  }, [tab, tr]);
  useNavSubItems(pathname, tab, 'sec', sections, { all: false });
  const sec = sections.find(s => s.key === sp.get('sec'))?.key || sections[0]?.key || null;

  const [year, setYear] = useState(THIS_YEAR);
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0);
  const askedRefresh = useRef(false);
  const reload = useCallback(() => setTick(t => t + 1), []);
  const refresh = useCallback(() => { askedRefresh.current = true; setTick(t => t + 1); }, []);
  const doneRefresh = useCallback((err) => {
    if (!askedRefresh.current) return;
    askedRefresh.current = false;
    if (err) toast.error(`${tr('รีเฟรชไม่สำเร็จ')}: ${err}`); else toast.success(tr('รีเฟรชข้อมูลแล้ว'));
  }, [tr]);

  /* ตัวเลือกในฟอร์มที่ขึ้นกับปี: โครงการ (ทีม · แผนงาน) + ข้อหลัก (แผนงาน) */
  const [opts, setOpts] = useState({ key: null, projects: [], heads: [], err: '' });
  const optKey = `${year}|${tick}`;
  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from('act03_project').select('code, name, status').eq('year', year).order('sort_no'),
      supabase.from('act03_task').select('act_task, sort_no, title').eq('year', year).is('parent_id', null).order('sort_no'),
    ]).then(([p, h]) => {
      if (alive) setOpts({ key: optKey, projects: p.data || [], heads: h.data || [], err: p.error?.message || h.error?.message || '' });
    });
    return () => { alive = false; };
  }, [year, optKey]);
  const SECTIONS = useMemo(() => sectionsFor({ projects: opts.projects, heads: opts.heads }), [opts.projects, opts.heads]);
  const cfg = tab === 'setting' && sec ? SECTIONS[sec] || null : null;

  const scope = cfg ? `${sec}|${year}` : '';
  const [got, setGot] = useState({ scope: null, rows: [], err: '' });
  const [pick, setPick] = useState({ scope: '', id: null });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!cfg) return undefined;
    let qy = supabase.from(cfg.dbTable).select(cfg.select).eq('year', year);
    for (const [col, asc] of cfg.order) qy = qy.order(col, { ascending: asc, nullsFirst: false });
    qy.then(({ data, error }) => {
      if (!alive) return;
      setGot({ scope, rows: error ? [] : (data || []), err: error ? error.message : '' });
      doneRefresh(error?.message);
    });
    return () => { alive = false; };
  }, [cfg, year, tick, scope, doneRefresh]);
  const loading = !!cfg && got.scope !== scope;
  const rows = useMemo(() => {
    const list = got.scope === scope ? got.rows : [];
    return cfg?.arrange ? cfg.arrange(list) : list;
  }, [got, scope, cfg]);
  const err = opts.err || (got.scope === scope ? got.err : '');
  const picked = pick.scope === scope ? pick.id : null;
  const setPicked = (id) => setPick({ scope, id });

  const ctx = useMemo(() => {
    const no = new Map(opts.heads.map(h => [h.act_task, h.sort_no]));
    return { headNo: (id) => no.get(id) ?? '?', areaName: () => '-' };
  }, [opts.heads]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!cfg || !n) return rows;
    return rows.filter(r => cfg.search(r, ctx).toLowerCase().includes(n));
  }, [rows, q, cfg, ctx]);
  const current = rows.find(r => cfg && r[cfg.key] === picked) || null;

  const openAdd = () => setForm({ mode: 'add', value: cfg.blank(year, rows) });
  const openEdit = (r) => setForm({ mode: 'edit', value: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)])), id: r[cfg.key] });

  const save = async () => {
    const v = form.value;
    const miss = missingField(cfg, v) || (cfg.check(v) ? tr(cfg.check(v)) : null);
    if (miss) { toast.error(miss); return; }
    const row = { ...cfg.toRow(v), ...stamp() };
    setBusy(true);
    const res = form.mode === 'add'
      ? await supabase.from(cfg.dbTable).insert([row]).select(cfg.key)
      : await supabase.from(cfg.dbTable).update(row).eq(cfg.key, form.id).select(cfg.key);
    setBusy(false);
    const label = form.mode === 'add' ? tr('เพิ่ม') : tr('บันทึก');
    if (form.mode === 'add' ? !checkWrite(res, label) : !checkWriteRows(res, label)) return;
    toast.success(`${label} ${cfg.name(cfg.toRow(v), ctx)} ${tr('แล้ว')}`);
    setForm(null); setPicked(res.data?.[0]?.[cfg.key] ?? null); reload();
  };

  /* ตั้งทีม/โครงการปีใหม่: คัดลอกของปีก่อน (ที่ใช้งาน) มาปีนี้ · ที่มีแล้วข้าม · ถามยืนยันพร้อมจำนวน */
  const copyPrev = async () => {
    const prev = year - 1;
    const isTeam = sec === 'team';
    const cols = isTeam ? 'employee_code, employee_name, role, unit, department, status' : 'code, name, sort_no, target_name, unit, team_type, target_type, target_count, status';
    const { data, error } = await supabase.from(cfg.dbTable).select(cols).eq('year', prev).eq('status', 'Active');
    if (error) { toast.error(`${tr('อ่านข้อมูลปีก่อนไม่ได้')}: ${error.message}`); return; }
    if (!data?.length) { toast.info(`${tr('ปี')} ${yearDisplay(prev)} ${tr('ยังไม่มีข้อมูล')}`); return; }
    const have = new Set(rows.map(r => (isTeam ? r.team_key : r.code)));
    const add = data.map(r => ({ ...r, year })).map(r => (isTeam ? { ...r, team_key: teamKey(r) } : r)).map(r => ({ ...r, ...stamp() }))
      .filter(r => !have.has(isTeam ? r.team_key : r.code));
    if (!add.length) { toast.info(tr('ทุกรายการของปีก่อนอยู่ในปีนี้แล้ว')); return; }
    if (!await askConfirm(`${tr('คัดลอกจากปี')} ${yearDisplay(prev)} ${tr('มาปี')} ${yearDisplay(year)} ${add.length} ${tr('รายการ')} ?`)) return;
    setBusy(true);
    const res = await supabase.from(cfg.dbTable).insert(add).select(cfg.key);
    setBusy(false);
    if (!checkWrite(res, tr('คัดลอกจากปีก่อน'))) return;
    toast.success(`${tr('คัดลอกแล้ว')} ${res.data?.length ?? add.length} ${tr('รายการ')}`);
    reload();
  };

  const remove = async () => {
    if (!current) return;
    const extra = sec === 'plan' && !current.parent_id ? ` ${tr('(ข้อย่อยทั้งหมดของข้อนี้จะถูกลบด้วย)')}` : '';
    if (!await askConfirm(`${tr('ลบ')} "${cfg.name(current, ctx)}" ?${extra}`)) return;
    const res = await supabase.from(cfg.dbTable).delete().eq(cfg.key, current[cfg.key]).select(cfg.key);
    if (!checkWriteRows(res, tr('ลบ'))) return;
    toast.success(`${tr('ลบ')} ${cfg.name(current, ctx)} ${tr('แล้ว')}`);
    setPicked(null); reload();
  };

  const tableSec = !!cfg;
  const strategySec = tab === 'setting' && sec === 'strategy';
  /* ป้ายเป็นไทยล้วน — ToolBar แปลตอนวาด · ปุ่มจาง = บอกเหตุผลที่ title */
  const tools = strategySec ? [{ key: 'refresh', label: 'รีเฟรช', onClick: st.reload }, ...st.tools] : [
    { key: 'refresh', label: 'รีเฟรช', onClick: refresh },
    { key: 'add', label: 'เพิ่ม', onClick: openAdd, disabled: !(tableSec && canEdit), why: !tableSec ? 'ส่วนนี้ไม่มีตารางให้เพิ่ม' : 'ไม่มีสิทธิ์แก้ Smart Factory' },
    { key: 'edit', label: 'แก้ไข', onClick: () => current && openEdit(current), disabled: !(tableSec && canEdit && current), why: !canEdit ? 'ไม่มีสิทธิ์แก้ Smart Factory' : 'คลิกเลือกแถวในตารางก่อน' },
    { key: 'delete', label: 'ลบ', onClick: remove, disabled: !(tableSec && canEdit && current), why: !canEdit ? 'ไม่มีสิทธิ์แก้ Smart Factory' : 'คลิกเลือกแถวในตารางก่อน' },
  ];

  const years = [THIS_YEAR + 1, THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2];
  const yearPick = (
    <select style={sel} value={year} onChange={e => setYear(Number(e.target.value))} aria-label={tr('ปี')}>
      {years.map(y => <option key={y} value={y}>{yearDisplay(y)}</option>)}
    </select>
  );

  return (
    <Page top="flush">
      <PageHeader layout="std" icon="🏭" title="Smart Factory" tabs={ACTIVITY_TABS} tab={tab} onTab={setTab} tools={tools} />
      {/* 🔍 ช่องค้นหาซ่อน — ปุ่ม 🔍 บน Tool Bar พิมพ์ลงช่องนี้ (data-tool-search · แบบเดียวกับ 5S) */}
      <input type="search" hidden data-tool-search="1" value={q} onChange={e => setQ(e.target.value)} placeholder={tr('ค้นหา…')} aria-label={tr('ค้นหา')} />
      <div data-activity-card="1" style={tab === 'dashboard' ? { display: 'flex', flexDirection: 'column', gap: 12 } : card}>
        {tab === 'dashboard' && sec && <DashboardSmf sec={sec} year={year} yearPick={yearPick} tick={tick} q={q} onLoaded={doneRefresh} />}

        {tab === 'edit' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Smart Factory · Edit Data</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('ยังไม่มีข้อมูลบนหน้านี้ — ผลงานรายเดือน + Work Flow Automation ทำในรอบถัดไป')}</div>
          </>
        )}

        {strategySec && st.body}

        {cfg && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {yearPick}
              {(sec === 'team' || sec === 'project') && canEdit && (
                <button className="pg-btn" onClick={copyPrev} disabled={busy || loading} title={tr('คัดลอกรายการที่ใช้งานของปีก่อนมาปีนี้ (ที่มีแล้วข้าม)')}>
                  📋 {tr('คัดลอกจากปีที่แล้ว')}
                </button>
              )}
              <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{loading ? tr('กำลังโหลด…') : `${shown.length} ${tr('รายการ')}`}</span>
            </div>
            {!canEdit && (
              <div style={{ fontSize: 12, color: 'var(--amber)' }}>
                {tr('ดูอย่างเดียว — บัญชีนี้ยังไม่มีสิทธิ์แก้ข้อมูล Smart Factory (สิทธิ์ "act_smf:manage" · ผู้ดูแลระบบเปิดให้ที่หน้าสิทธิ์)')}
              </div>
            )}
            {sec === 'plan' && !opts.projects.length && <div style={{ fontSize: 12, color: 'var(--amber)' }}>{tr('ปีนี้ยังไม่มีโครงการ — เพิ่มที่ Setting → โครงการ ก่อน (ข้อหลักต้องผูกโครงการ)')}</div>}
            {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>}
            <Table5s cfg={cfg} rows={shown} ctx={ctx} selected={picked} onSelect={setPicked}
              onOpen={(r) => canEdit && openEdit(r)} empty={loading ? tr('กำลังโหลด…') : tr('ยังไม่มีรายการ')} />
          </>
        )}
      </div>

      {form && cfg && (
        <FormModal cfg={cfg} mode={form.mode} value={form.value} busy={busy}
          onChange={(next) => setForm(f => ({ ...f, value: typeof next === 'function' ? next(f.value) : next }))}
          onSave={save} onClose={() => setForm(null)} />
      )}
    </Page>
  );
}
