/* ═══════════════════════════════════════════════════════════════════════════════
   🧩 ตัวตั้งค่าช่อง "ตารางตรวจ (คน × วัน)" ในหน้าออกแบบใบงาน (2026-11-26)
   ตั้งได้: แหล่งแถว · คีย์สิทธิ์บันทึก · ทะเบียนเอกสาร (/doc-forms) · สัญลักษณ์ · หัวข้อ · ตัวเติมอัตโนมัติ · แจ้งเตือน · หมายเหตุท้ายแถว
   🔴 แหล่งแถว/ตัวเติม = ตัวเลือกที่โปรแกรมเมอร์ลงทะเบียน (utils/checkGrid.js) — ไม่มีช่องพิมพ์สูตร
   🔴 ทะเบียนเอกสารเลือกจาก doc_forms ที่มีอยู่ (ห้ามสร้างทะเบียนแยก) · ข้อผิดพลาดตรวจที่ validateGrid() (+ฝั่ง DB)
   ═══════════════════════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Field, inp, ghost } from './NpiUi';
import { GRID_COLORS, GRID_ROW_SOURCES, GRID_AUTOFILL, autofillOf, validateGrid } from '../utils/checkGrid';
import { tr } from '../utils/i18n';

export default function WfGridFieldEditor({ value, onChange, readOnly, perms = [] }) {
  const g = value || {};
  const set = (patch) => onChange({ ...g, ...patch });
  const [docs, setDocs] = useState(null);
  const [docErr, setDocErr] = useState('');
  const [events, setEvents] = useState([]);
  useEffect(() => {
    let alive = true;
    supabase.from('doc_forms').select('doc_key, title, form_code').eq('is_active', true).order('doc_key')
      .then(({ data, error }) => { if (!alive) return; if (error) setDocErr(error.message); else setDocs(data || []); });
    supabase.from('notification_rules').select('event_key, label').order('event_key')
      .then(({ data }) => { if (alive) setEvents(data || []); });
    return () => { alive = false; };
  }, []);
  const marks = g.marks || [];
  const items = g.items || [];
  const setMark = (i, p) => set({ marks: marks.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const setItem = (i, p) => set({ items: items.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const af = autofillOf(g.autofill);
  const errs = validateGrid(g);
  const box = { border: '1px dashed var(--border2)', borderRadius: 'var(--r-md)', padding: 10, marginTop: 6 };
  const row = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, alignItems: 'end' };
  return (
    <div style={box}>
      <div style={row}>
        <Field label={tr('แถว = ใคร')}>
          <select value={g.rows || ''} disabled={readOnly} onChange={e => set({ rows: e.target.value })} style={inp}>
            <option value="">{tr('— เลือก —')}</option>
            {GRID_ROW_SOURCES.map(r => <option key={r.key} value={r.key}>{tr(r.label)}</option>)}
          </select></Field>
        <Field label={tr('สิทธิ์บันทึก (คีย์)')}>
          <select value={g.recordPerm || ''} disabled={readOnly} onChange={e => set({ recordPerm: e.target.value })} style={inp}>
            <option value="">{tr('— เลือก —')}</option>
            {[...new Set([g.recordPerm, ...perms.map(p => p.key)].filter(Boolean))].map(k => <option key={k} value={k}>{perms.find(p => p.key === k)?.label || k}</option>)}
          </select></Field>
        <Field label={tr('ทะเบียนเอกสาร (เลขฟอร์ม/Rev)')}>
          <select value={g.docKey || ''} disabled={readOnly || docs == null} onChange={e => set({ docKey: e.target.value || '' })} style={inp}>
            <option value="">{docs == null ? tr('กำลังโหลด…') : tr('— ไม่ผูก (ใบพิมพ์ไม่มีเลขฟอร์ม) —')}</option>
            {(docs || []).map(d => <option key={d.doc_key} value={d.doc_key}>{d.form_code ? `${d.form_code} · ` : ''}{d.title || d.doc_key}</option>)}
          </select></Field>
        <Field label={tr('เติมอัตโนมัติจาก')}>
          <select value={g.autofill || ''} disabled={readOnly} onChange={e => set({ autofill: e.target.value })} style={inp}>
            <option value="">{tr('— ไม่มี (กรอกเองทั้งหมด) —')}</option>
            {GRID_AUTOFILL.map(a => <option key={a.key} value={a.key}>{tr(a.label)}</option>)}
          </select></Field>
        <Field label={tr('แจ้งเตือนเมื่อทาสัญลักษณ์ที่ติ๊ก "แจ้ง"')}>
          <select value={g.alertEvent || ''} disabled={readOnly} onChange={e => set({ alertEvent: e.target.value })} style={inp}>
            <option value="">{tr('— ไม่แจ้ง —')}</option>
            {[...new Set([g.alertEvent, ...events.map(e => e.event_key)].filter(Boolean))].map(k => <option key={k} value={k}>{events.find(e => e.event_key === k)?.label || k}</option>)}
          </select></Field>
        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" disabled={readOnly} checked={!!g.rowNote} onChange={e => set({ rowNote: e.target.checked })} /> {tr('มีคอลัมน์หมายเหตุท้ายแถว')}</label>
      </div>
      {docErr && <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 4 }}>⚠ {tr('อ่านทะเบียนเอกสารไม่สำเร็จ')}: {docErr}</div>}

      <div style={{ fontWeight: 700, fontSize: 12.5, margin: '10px 0 4px' }}>{tr('สัญลักษณ์ในช่อง')}</div>
      {marks.map((m, i) => (
        <div key={i} style={{ ...row, padding: '4px 0' }}>
          <Field label={tr('รหัส')}><input value={m.key || ''} disabled={readOnly} onChange={e => setMark(i, { key: e.target.value.toLowerCase() })} style={inp} /></Field>
          <Field label={tr('ตัวในช่อง')}><input value={m.glyph || ''} disabled={readOnly || m.needsItem} maxLength={3} onChange={e => setMark(i, { glyph: e.target.value })} style={inp} /></Field>
          <Field label={tr('ความหมาย')}><input value={m.label || ''} disabled={readOnly} onChange={e => setMark(i, { label: e.target.value })} style={inp} /></Field>
          <Field label={tr('สี')}>
            <select value={m.color || 'muted'} disabled={readOnly} onChange={e => setMark(i, { color: e.target.value })} style={inp}>
              {Object.entries(GRID_COLORS).map(([k, c]) => <option key={k} value={k}>{tr(c.label)}</option>)}
            </select></Field>
          <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" disabled={readOnly} checked={!!m.needsItem} onChange={e => setMark(i, { needsItem: e.target.checked })} /> {tr('ต้องระบุเลขข้อ')}</label>
          <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" disabled={readOnly} checked={!!m.alert} onChange={e => setMark(i, { alert: e.target.checked })} /> {tr('แจ้ง')}</label>
          {!readOnly && <button type="button" style={ghost} onClick={() => set({ marks: marks.filter((_, j) => j !== i) })} aria-label={tr('ลบสัญลักษณ์')}>✕</button>}
        </div>
      ))}
      {!readOnly && <button type="button" style={ghost} onClick={() => set({ marks: [...marks, { key: `m${marks.length + 1}`, glyph: '', label: '', color: 'muted' }] })}>{tr('+ สัญลักษณ์')}</button>}

      <div style={{ fontWeight: 700, fontSize: 12.5, margin: '10px 0 4px' }}>
        <input value={g.itemsTitle || ''} disabled={readOnly} placeholder={tr('หัวข้อตรวจ')} onChange={e => set({ itemsTitle: e.target.value })} style={{ ...inp, maxWidth: 420 }} />
      </div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px minmax(0, 1fr) 200px auto', gap: 8, alignItems: 'center', padding: '3px 0' }}>
          <input type="number" min={1} value={it.seq ?? ''} disabled={readOnly} onChange={e => setItem(i, { seq: Number(e.target.value) })} style={inp} aria-label={tr('เลขข้อ')} />
          <input value={it.text || ''} disabled={readOnly} onChange={e => setItem(i, { text: e.target.value })} style={inp} aria-label={tr('ข้อความ')} />
          <select value={it.auto || ''} disabled={readOnly || !af} onChange={e => setItem(i, { auto: e.target.value || null })} style={inp} aria-label={tr('เติมอัตโนมัติ')}>
            <option value="">{tr('— สังเกตเอง —')}</option>
            {(af?.autoKeys || []).map(k => <option key={k.key} value={k.key}>{tr(k.label)}</option>)}
          </select>
          {!readOnly ? <button type="button" style={ghost} onClick={() => set({ items: items.filter((_, j) => j !== i) })} aria-label={tr('ลบหัวข้อ')}>✕</button> : <span />}
        </div>
      ))}
      {!readOnly && <button type="button" style={ghost} onClick={() => set({ items: [...items, { seq: (Math.max(0, ...items.map(x => x.seq || 0)) + 1), text: '', auto: null }] })}>{tr('+ หัวข้อ')}</button>}

      {errs.length > 0 && <ul style={{ fontSize: 12, color: 'var(--amber)', margin: '8px 0 0', paddingLeft: 18 }}>{errs.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </div>
  );
}
