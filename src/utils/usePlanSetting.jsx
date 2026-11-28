/* ══ 📅 Setting → แผนงาน (ทุกกิจกรรม · 28/11) — ตาราง + ฟอร์ม เพิ่ม/แก้ไข/ลบ แผนงาน 2 ชั้น · คืน { tools, body, rows } ══
   ใช้กับ: 5S (`act02_task`) · กิจกรรมอื่น (`act_task` + `activity`) · Smart Factory มีของตัวเอง (ผูกโครงการ)
   · คลิกแถว = เลือก (แก้ไข/ลบ) · ดับเบิลคลิก = แก้ไข · ลบข้อหลัก = ข้อย่อยหายด้วย (บอกก่อนลบ)
   · ผู้รับผิดชอบเลือกจากทะเบียนพนักงาน (PersonSelect ผ่าน FormModal type person) · ตาราง/ฟอร์มของกลางจาก 5S */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from '../components/Toast';
import { tr } from './i18n';
import { fmtDate } from './dateFormat';
import { checkWrite, checkWriteRows } from './dbWrite';
import { askConfirm } from './askConfirm';
import { FormModal, Table5s } from '../pages/activity5s/setting';
import { missingField, stamp } from '../pages/activity5s/sections';

const num = (v) => (v === '' || v == null ? null : Number(v));
const txt = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

function planCfg(dbTable, heads, rows) {
  const headNo = new Map(heads.map(h => [h.act_task, h.sort_no]));
  return {
    dbTable, key: 'act_task',
    columns: [
      { key: 'sort_no', label: 'ข้อ', width: 64, render: (r) => (r.parent_id ? `${headNo.get(r.parent_id) ?? '?'}.${r.sort_no}` : String(r.sort_no)) },
      { key: 'title', label: 'รายการ', render: (r) => (r.parent_id ? `↳ ${r.title}` : r.title) },
      { key: 'owner_name', label: 'ผู้รับผิดชอบ', render: (r) => r.owner_name || r.owner_code || '-' },
      { key: 'start_date', label: 'ช่วงเวลา', render: (r) => (r.start_date ? `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` : '-') },
      { key: 'progress', label: '%', align: 'right', width: 60, render: (r) => `${r.progress ?? 0}%` },
      { key: 'done_on', label: 'วันที่เสร็จ', render: (r) => (r.done_on ? fmtDate(r.done_on) : '-') },
    ],
    fields: [
      { key: 'title', label: 'รายการ', required: true, wide: true },
      { key: 'parent_id', label: 'อยู่ใต้ข้อหลัก', type: 'select', required: true, allowEmpty: true,
        options: (f) => [{ value: '', label: '— เป็นข้อหลัก —' }, ...heads.filter(h => h.act_task !== f.act_task).map(h => ({ value: h.act_task, label: `${h.sort_no}. ${h.title}` }))] },
      { key: 'sort_no', label: 'ลำดับ', type: 'number' },
      { key: 'start_date', label: 'วันเริ่ม', type: 'date' },
      { key: 'end_date', label: 'วันจบ', type: 'date' },
      { key: 'progress', label: 'ความคืบหน้า (%)', type: 'number' },
      { key: 'done_on', label: 'วันที่ทำเสร็จ', type: 'date', showIf: (f) => Number(f.progress) >= 100 },
      { key: 'owner_code', label: 'ผู้รับผิดชอบ', type: 'person', codeKey: 'owner_code', nameKey: 'owner_name', wide: true },
      { key: 'note', label: 'หมายเหตุ', wide: true },
    ],
    blank: (year, parent = '') => ({
      year, title: '', parent_id: parent, start_date: '', end_date: '', progress: '0', done_on: '', owner_code: '', owner_name: '', note: '',
      sort_no: String(Math.max(0, ...rows.filter(r => (r.parent_id || '') === parent).map(r => Number(r.sort_no) || 0)) + 1),
    }),
    toRow: (f) => ({
      year: Number(f.year), title: f.title.trim(), parent_id: f.parent_id || null, sort_no: num(f.sort_no) ?? 1,
      start_date: f.start_date || null, end_date: f.end_date || null, progress: Math.max(0, Math.min(100, Math.round(num(f.progress) ?? 0))),
      done_on: Number(f.progress) >= 100 ? (f.done_on || null) : null, owner_code: txt(f.owner_code), owner_name: txt(f.owner_name), note: txt(f.note),
    }),
    check: (f) => {
      if (Boolean(f.start_date) !== Boolean(f.end_date)) return 'ระบุวันเริ่มและวันจบให้ครบ (หรือเว้นว่างทั้งคู่)';
      if (f.start_date && f.end_date < f.start_date) return 'วันจบต้องไม่ก่อนวันเริ่ม';
      if (f.parent_id && !f.start_date) return 'ข้อย่อยต้องมีวันเริ่มและวันจบ';
      const p = Number(f.progress);
      return p >= 0 && p <= 100 ? null : 'ความคืบหน้า 0–100%';
    },
    name: (r) => r.title,
    search: (r) => `${r.title} ${r.owner_name || ''} ${r.owner_code || ''} ${r.note || ''}`,
  };
}

/**
 * @param {{ dbTable: string, activity?: string, year: number, yearPick: any, canEdit: boolean, tick: number, q: string,
 *   reload: () => void, onLoaded?: (err:string) => void, active: boolean, noPermText?: string }} p
 */
export default function usePlanSetting({ dbTable, activity, year, yearPick, canEdit, tick, q, reload, onLoaded, active, noPermText }) {
  const key = `${dbTable}|${activity || ''}|${year}|${tick}`;
  const [got, setGot] = useState({ key: null, rows: [], err: '' });
  const [pick, setPick] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!active) return undefined;
    let qy = supabase.from(dbTable).select('*').eq('year', year).order('sort_no');
    if (activity) qy = qy.eq('activity', activity);
    qy.then(({ data, error }) => {
      if (!alive) return;
      setGot({ key, rows: error ? [] : (data || []), err: error ? error.message : '' });
      onLoaded?.(error?.message || '');
    });
    return () => { alive = false; };
  }, [dbTable, activity, year, key, active, onLoaded]);

  const raw = useMemo(() => (got.key === key ? got.rows : []), [got, key]);
  const loading = active && got.key !== key;
  const heads = useMemo(() => raw.filter(r => !r.parent_id).sort((a, b) => a.sort_no - b.sort_no), [raw]);
  const rows = useMemo(() => heads.flatMap(h => [h, ...raw.filter(r => r.parent_id === h.act_task).sort((a, b) => a.sort_no - b.sort_no)]), [heads, raw]);
  const cfg = useMemo(() => planCfg(dbTable, heads, raw), [dbTable, heads, raw]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter(r => cfg.search(r).toLowerCase().includes(needle)) : rows;
  const current = rows.find(r => r.act_task === pick) || null;

  const openAdd = () => setForm({ mode: 'add', value: cfg.blank(year, current && !current.parent_id ? current.act_task : '') });
  const openEdit = (r) => setForm({ mode: 'edit', id: r.act_task, value: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)])) });

  const save = async () => {
    const v = form.value;
    const miss = missingField(cfg, v) || (cfg.check(v) ? tr(cfg.check(v)) : null);
    if (miss) { toast.error(miss); return; }
    const row = { ...cfg.toRow(v), ...(activity ? { activity } : {}), ...stamp() };
    setBusy(true);
    const res = form.mode === 'add'
      ? await supabase.from(dbTable).insert([row]).select('act_task')
      : await supabase.from(dbTable).update(row).eq('act_task', form.id).select('act_task');
    setBusy(false);
    const label = form.mode === 'add' ? tr('เพิ่ม') : tr('บันทึก');
    if (form.mode === 'add' ? !checkWrite(res, label) : !checkWriteRows(res, label)) return;
    toast.success(`${label} ${row.title} ${tr('แล้ว')}`);
    setForm(null); setPick(res.data?.[0]?.act_task ?? null); reload();
  };

  const remove = async () => {
    if (!current) return;
    const extra = !current.parent_id && raw.some(r => r.parent_id === current.act_task) ? ` ${tr('(ข้อย่อยทั้งหมดของข้อนี้จะถูกลบด้วย)')}` : '';
    if (!await askConfirm(`${tr('ลบ')} "${current.title}" ?${extra}`)) return;
    const res = await supabase.from(dbTable).delete().eq('act_task', current.act_task).select('act_task');
    if (!checkWriteRows(res, tr('ลบ'))) return;
    toast.success(`${tr('ลบ')} ${current.title} ${tr('แล้ว')}`);
    setPick(null); reload();
  };

  const why = !canEdit ? (noPermText || 'ไม่มีสิทธิ์แก้แผนงาน') : 'คลิกเลือกแถวในตารางก่อน';
  /* ป้ายเป็นไทยล้วน — ToolBar แปลตอนวาด */
  const tools = [
    { key: 'add', label: 'เพิ่ม', onClick: openAdd, disabled: !canEdit, why },
    { key: 'edit', label: 'แก้ไข', onClick: () => current && openEdit(current), disabled: !(canEdit && current), why },
    { key: 'delete', label: 'ลบ', onClick: remove, disabled: !(canEdit && current), why },
  ];

  const body = (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {yearPick}
        <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {loading ? tr('กำลังโหลด…') : `${shown.length} ${tr('รายการ')} · ${tr('เลือกข้อหลักแล้วกดเพิ่ม = เพิ่มข้อย่อยใต้ข้อนั้น')}`}
        </span>
      </div>
      {!canEdit && <div style={{ fontSize: 12, color: 'var(--amber)' }}>{tr('ดูอย่างเดียว — บัญชีนี้ยังไม่มีสิทธิ์แก้แผนงาน')}</div>}
      {got.err && <div style={{ color: 'var(--red)', fontSize: 13 }}>{got.err}</div>}
      <Table5s cfg={cfg} rows={shown} ctx={{}} selected={pick} onSelect={setPick} onOpen={(r) => canEdit && openEdit(r)}
        empty={loading ? tr('กำลังโหลด…') : tr('ยังไม่มีแผนงานของปีนี้ — กดปุ่ม ➕ เพิ่ม')} />
      {form && (
        <FormModal cfg={cfg} mode={form.mode} value={form.value} busy={busy}
          onChange={(next) => setForm(f => ({ ...f, value: typeof next === 'function' ? next(f.value) : next }))}
          onSave={save} onClose={() => setForm(null)} />
      )}
    </>
  );
  return { tools, body, rows: raw, loading };
}
