/* ══ 🧩 WfFormFields — วาดช่องกรอกของใบ e-Workflow ตาม form_schema (2026-11-13) ══════════════
   ชนิดช่อง = ทะเบียน `FIELD_TYPES` ใน utils/wfSchema.js
   🔴 ช่องคน/เครื่อง/MAT/ไลน์ = picker กลางเท่านั้น (UI §5.1.2) — ห้ามแตกเป็น <input> เปล่า
   readOnly = โชว์ค่า (ใบที่ส่งแล้ว / ตัวอย่างในหน้าออกแบบ)
   ═══════════════════════════════════════════════════════════════════════════════════ */
import { inp, Field } from './NpiUi';
import PersonSelect from './PersonSelect';
import MachineSelect from './MachineSelect';
import ProductSelect from './ProductSelect';
import LineSelect from './LineSelect';
import useProductionLines from '../utils/useProductionLines';
import { FIELD_TYPE_MAP } from '../utils/wfSchema';
import { tr } from '../utils/i18n';

const show = (f, v) => {
  if (v == null || v === '') return '—';
  if (f.type === 'yesno') return v === 'yes' ? tr('ใช่') : v === 'no' ? tr('ไม่ใช่') : String(v);
  return String(v);
};

export default function WfFormFields({ form, data = {}, onChange, readOnly = false }) {
  const lines = useProductionLines();
  const set = (k, v) => onChange?.({ ...data, [k]: v });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, alignContent: 'start' }}>
      {(form?.fields || []).map(f => {
        const meta = FIELD_TYPE_MAP[f.type];
        if (meta?.display) {
          return <div key={f.key} style={{ gridColumn: '1 / -1', fontSize: 13, fontWeight: 800, color: 'var(--text)', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginTop: 4 }}>{f.label}</div>;
        }
        const label = `${f.label}${f.required ? ' *' : ''}`;
        const wide = f.type === 'textarea';
        const v = data[f.key] ?? '';
        let input;
        if (readOnly) input = <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', minHeight: 20 }}>{show(f, data[f.key])}</div>;
        else if (!meta) input = <div style={{ fontSize: 12, color: 'var(--red)' }}>{tr('ชนิดช่องไม่รู้จัก')}: {f.type}</div>;
        else if (f.type === 'textarea') input = <textarea value={v} onChange={e => set(f.key, e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} />;
        else if (f.type === 'number') input = <input type="text" inputMode="decimal" value={v} onChange={e => set(f.key, e.target.value)} style={inp} />;
        else if (f.type === 'date') input = <input type="date" value={v} onChange={e => set(f.key, e.target.value)} style={inp} />;
        else if (f.type === 'yesno') input = (
          <select value={v} onChange={e => set(f.key, e.target.value)} style={inp}>
            <option value="">{tr('— เลือก —')}</option><option value="yes">{tr('ใช่')}</option><option value="no">{tr('ไม่ใช่')}</option>
          </select>);
        else if (f.type === 'select') input = (
          <select value={v} onChange={e => set(f.key, e.target.value)} style={inp}>
            <option value="">{tr('— เลือก —')}</option>
            {(f.options || []).filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
          </select>);
        else if (f.type === 'person') input = <PersonSelect value={v} onChange={(p) => set(f.key, p?.name || '')} />;
        else if (f.type === 'machine') input = <MachineSelect value={v} onChange={(m) => set(f.key, m?.machine_no ?? m?.value ?? '')} />;
        else if (f.type === 'mat') input = <ProductSelect value={v} onChange={(p) => set(f.key, p?.mat_no || '')} />;
        else if (f.type === 'line') input = <LineSelect lines={lines} value={v} onChange={(x) => set(f.key, typeof x === 'string' ? x : (x?.target?.value ?? ''))} />;
        else input = <input type="text" value={v} onChange={e => set(f.key, e.target.value)} style={inp} />;
        return <div key={f.key} style={wide ? { gridColumn: '1 / -1' } : undefined}><Field label={label}>{input}</Field></div>;
      })}
    </div>
  );
}
