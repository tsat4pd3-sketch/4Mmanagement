/* ══ ♻️ กิจกรรม 5S (/activity-5s) — ยกจากระบบ Core (2026-11-27 · คำสั่ง user "ยก 5ส ที่เราสร้าง ก๊อปไปสร้างใน ESM" · loop smf01) ══
   โครงเดียวกับหน้ากิจกรรมอื่น (`pages/Activity.jsx`): ส่วน Dashboard / Edit Data / Setting สลับที่ Sub Bar (`?tab=`) ·
   Detail Bar = ส่วนย่อย (`?sec=`) · Tool Bar ตำแหน่งตายตัว (รีเฟรช · เพิ่ม · แก้ไข · ลบ — 🔍 ของ Tool Bar หาช่องค้นหาในการ์ดเอง)
   · รอบ 1 (27/11): Setting = พื้นที่ · ทีม · หัวข้อตรวจ · แผนตรวจ · เกณฑ์ผ่าน
   · รอบ 2 (27/11): Dashboard = กลยุทธ์ · ภาพรวม · อันดับ · ผู้ตรวจ · แผนงาน · ทีม (`Dashboard.jsx` + สูตร `dash.js`) · Edit Data = รอบถัดไป
   · ข้อมูล: ตาราง act02_* (MAIN · migration 20261127_act02_5s_main.sql) · เขียน = สิทธิ์ `act_5s:manage` (RLS has_perm คีย์เดียวกัน)
   · ปีเลือกในการ์ด (ไม่ใช้ `filters=` — มี filters แล้ว Tool Bar/Detail Bar ไม่ค้าง ตามกติกา PageHeader std) */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import Page from '../../components/Page';
import PageHeader from '../../components/PageHeader';
import { toast } from '../../components/Toast';
import { UserContext } from '../../App';
import { supabase } from '../../supabaseClient';
import useTabParam from '../../utils/useTabParam';
import { useNavSubItems } from '../../utils/navSubItems';
import { ACTIVITY_TABS } from '../../utils/activityPages';
import { canSeeded } from '../../utils/permissions';
import { checkWrite, checkWriteRows } from '../../utils/dbWrite';
import { askConfirm } from '../../utils/askConfirm';
import { yearDisplay } from '../../utils/dateFormat';
import useLang from '../../utils/useLang';
import { DASH_SECTIONS, PERM, SETTING_SECTIONS } from './labels';
import Dashboard5s from './Dashboard';
import { FormModal, Table5s, TargetForm } from './setting';
import { SECTIONS, missingField, stamp } from './sections';

const THIS_YEAR = new Date().getFullYear();
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: '60vh' };
const sel = { width: 'auto', padding: '4px 8px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 12 };

export default function Activity5s() {
  const { tr } = useLang();
  const { pathname } = useLocation();
  const { role } = useContext(UserContext);
  const canEdit = canSeeded(PERM[0], PERM[1], role);
  const [tab, setTab] = useTabParam(ACTIVITY_TABS.map(t => t.key), ACTIVITY_TABS[0].key);
  const [sp] = useSearchParams();

  const sections = useMemo(() => {
    const list = tab === 'setting' ? SETTING_SECTIONS : tab === 'dashboard' ? DASH_SECTIONS : [];
    return list.map(s => ({ key: s.key, label: tr(s.label) }));
  }, [tab, tr]);
  useNavSubItems(pathname, tab, 'sec', sections, { all: false });
  /* Dashboard เปิดมาที่ "ภาพรวม" (กลยุทธ์อยู่ซ้ายสุดแต่ไม่ใช่หน้าแรก — แบบเดียวกับ Core) */
  const sec = sections.find(s => s.key === sp.get('sec'))?.key || (tab === 'dashboard' ? 'summary' : sections[0]?.key) || null;
  const cfg = tab === 'setting' && sec ? SECTIONS[sec] : null;

  const [year, setYear] = useState(THIS_YEAR);
  const [q, setQ] = useState('');
  const scope = cfg ? `${sec}|${cfg.yearly ? year : ''}` : '';
  const [got, setGot] = useState({ scope: null, rows: [], err: '' });   // แถวของส่วน/ปีที่โหลดเสร็จล่าสุด
  const [areas, setAreas] = useState([]);
  const [areaErr, setAreaErr] = useState('');
  const [pick, setPick] = useState({ scope: '', id: null });            // แถวที่เลือก (ของส่วน/ปีนี้เท่านั้น)
  const [form, setForm] = useState(null);      // { mode: 'add' | 'edit', value }
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  /* รีเฟรชจากปุ่ม Tool Bar = บอกเมื่อโหลดเสร็จจริง (28/11 คำสั่ง user "กดรีเฟรชแล้วไม่รู้ว่ากด") · บันทึก/ลบ ไม่ต้องบอกซ้ำ (มี toast ของมันแล้ว) */
  const askedRefresh = useRef(false);
  const reload = useCallback(() => setTick(t => t + 1), []);
  const refresh = useCallback(() => { askedRefresh.current = true; setTick(t => t + 1); }, []);
  const doneRefresh = useCallback((err) => {
    if (!askedRefresh.current) return;
    askedRefresh.current = false;
    if (err) toast.error(`${tr('รีเฟรชไม่สำเร็จ')}: ${err}`); else toast.success(tr('รีเฟรชข้อมูลแล้ว'));
  }, [tr]);

  /* พื้นที่ใช้ทุกส่วน (ชื่อพื้นที่ในทีม / แผนตรวจ · ตัวเลือกในฟอร์ม) */
  useEffect(() => {
    let alive = true;
    supabase.from('act02_area').select('act_area, area_code, act_area_name, area_type, status').order('area_code').then(({ data, error }) => {
      if (!alive) return;
      setAreaErr(error ? error.message : '');
      setAreas(data || []);
    });
    return () => { alive = false; };
  }, [tick]);

  useEffect(() => {
    let alive = true;
    if (!cfg) return undefined;
    let qy = supabase.from(cfg.dbTable).select(cfg.select);
    if (cfg.yearly) qy = qy.eq('year', year);
    for (const [col, asc] of cfg.order) qy = qy.order(col, { ascending: asc, nullsFirst: false });
    qy.then(({ data, error }) => {
      if (!alive) return;
      setGot({ scope, rows: error ? [] : (data || []), err: error ? error.message : '' });
      doneRefresh(error?.message);
    });
    return () => { alive = false; };
  }, [cfg, year, tick, scope, doneRefresh]);
  const loading = !!cfg && got.scope !== scope;
  const rows = useMemo(() => (got.scope === scope ? got.rows : []), [got, scope]);
  const err = areaErr || (got.scope === scope ? got.err : '');
  const picked = pick.scope === scope ? pick.id : null;
  const setPicked = (id) => setPick({ scope, id });

  const ctx = useMemo(() => {
    const m = new Map(areas.map(a => [a.act_area, `${a.area_code} ${a.act_area_name}`]));
    return { areaName: (id) => (id ? m.get(id) || '-' : '-') };
  }, [areas]);
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

  const remove = async () => {
    if (!current) return;
    if (!await askConfirm(`${tr('ลบ')} "${cfg.name(current, ctx)}" ?`)) return;
    const res = await supabase.from(cfg.dbTable).delete().eq(cfg.key, current[cfg.key]).select(cfg.key);
    if (!checkWriteRows(res, tr('ลบ'))) return;
    toast.success(`${tr('ลบ')} ${cfg.name(current, ctx)} ${tr('แล้ว')}`);
    setPicked(null); reload();
  };

  /* Tool Bar: ปุ่มที่ใช้ไม่ได้ในส่วนนี้ = จาง (ไม่ส่ง / disabled) · ไม่มีสิทธิ์ = จาง */
  const tableSec = !!cfg;
  /* ป้ายเป็นไทยล้วน — ToolBar แปลตอนวาดเอง (กฎ i18n-map-label-at-declaration: ห้าม label: tr('…') ที่จุดประกาศ) */
  const tools = [
    { key: 'refresh', label: 'รีเฟรช', onClick: refresh },
    { key: 'add', label: 'เพิ่ม', onClick: openAdd, disabled: !(tableSec && canEdit) },
    { key: 'edit', label: 'แก้ไข', onClick: () => current && openEdit(current), disabled: !(tableSec && canEdit && current) },
    { key: 'delete', label: 'ลบ', onClick: remove, disabled: !(tableSec && canEdit && current) },
  ];

  const years = [THIS_YEAR + 1, THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2];
  const yearPick = (
    <select style={sel} value={year} onChange={e => setYear(Number(e.target.value))} aria-label={tr('ปี')}>
      {years.map(y => <option key={y} value={y}>{yearDisplay(y)}</option>)}
    </select>
  );

  return (
    <Page top="flush">
      <PageHeader layout="std" icon="♻️" title="5S" tabs={ACTIVITY_TABS} tab={tab} onTab={setTab} tools={tools} />
      {/* 🔍 ช่องค้นหาของหน้า = ซ่อน (28/11 คำสั่ง user "ค้นหาไม่ต้องมีในหน้า ใช้ปุ่ม 🔍 บน Tool Bar") · ปุ่ม 🔍 พิมพ์ลงช่องนี้ (data-tool-search) */}
      <input type="search" hidden data-tool-search="1" value={q} onChange={e => setQ(e.target.value)} placeholder={tr('ค้นหา…')} aria-label={tr('ค้นหา')} />
      {/* Dashboard = การ์ดย่อยวางบนพื้นหน้าเลย (28/11 คำสั่ง user "ตัดพื้นหลังการ์ด") · Setting/Edit Data = การ์ดเดิม */}
      <div data-activity-card="1" style={tab === 'dashboard' ? { display: 'flex', flexDirection: 'column', gap: 12 } : card}>
        {tab === 'dashboard' && sec && (
          <Dashboard5s sec={sec} year={year} yearPick={yearPick} areas={areas} tick={tick} q={q} onLoaded={doneRefresh} />
        )}

        {tab === 'edit' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>5S · Edit Data</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('ยังไม่มีข้อมูลบนหน้านี้ — ส่วนบันทึกใบตรวจทำในรอบถัดไป (Dashboard อ่านใบตรวจที่นำเข้าแล้ว)')}</div>
          </>
        )}

        {tab === 'setting' && sec === 'target' && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{yearPick}</div>
            <TargetForm year={year} canEdit={canEdit} />
          </>
        )}

        {cfg && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {cfg.yearly && yearPick}
              <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{loading ? tr('กำลังโหลด…') : `${shown.length} ${tr('รายการ')}`}</span>
            </div>
            {err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>}
            <Table5s cfg={cfg} rows={shown} ctx={ctx} selected={picked} onSelect={setPicked}
              onOpen={(r) => canEdit && openEdit(r)} empty={loading ? tr('กำลังโหลด…') : tr('ยังไม่มีรายการ')} />
          </>
        )}
      </div>

      {form && cfg && (
        <FormModal cfg={cfg} mode={form.mode} value={form.value} busy={busy} areas={areas}
          onChange={(next) => setForm(f => ({ ...f, value: typeof next === 'function' ? next(f.value) : next }))}
          onSave={save} onClose={() => setForm(null)} />
      )}
    </Page>
  );
}
