/* ══════════════════════════════════════════════════════════════════════════
   <SimpleMasterPanel> — แผงจัดการทะเบียน master แบบ "รหัส + ชื่อ + ฟิลด์เสริม" ตัวกลาง  (2026-09-08)

   ใช้กับทะเบียนใหม่จาก single-source audit: customers · suppliers · die_press_lines (DR) · cost_centers (Main)
   — จุดใหม่ที่ต้องการแผง CRUD ทะเบียนเล็กๆ ให้ใช้ตัวนี้ ห้ามก๊อป SimpleNameMaster (Report.jsx) ไปเขียนซ้ำอีก

   กติกา (UI-CONVENTIONS §5.4 — หน้า setup ต้องยืนยันก่อนเขียน):
     · เพิ่มแถว / เปิดใช้กลับ = เขียนทันที (additive) · แก้ค่า = draft ต่อแถว + ปุ่ม 💾 · ปิดใช้ / ลบ = confirm()
     · ทุก write ผ่าน checkWrite (supabase-js ไม่ throw) · UPDATE/DELETE ที่ RLS ปฏิเสธ = 0 แถวเงียบ → .select(keyCol) แล้วนับ
     · ลบ = เตือนว่าข้อมูลเก่าที่เก็บ "ชื่อ/รหัส" นี้ยังอ่านออก (คอลัมน์ปลายทางเป็น text ไม่ผูก FK) — แนะนำปิดใช้แทน

   props:
     client      supabase (Main) | supabaseDR (DR)        table   ชื่อตาราง
     keyCol      คอลัมน์คีย์ (default 'code')             keyFrom (row) => code อัตโนมัติจากฟอร์มเพิ่ม (ไม่ส่ง = กรอกเอง)
     fields      [{ key, label, type: 'text'|'number'|'select'|'tags'|'textarea', options: [{value,label}], required, width, mono, placeholder }]
     stampCol    คอลัมน์ชื่อผู้แก้ (เช่น 'updated_by_name') + stampName — ไม่ส่ง = ไม่แตะ
     canManage   สิทธิ์เขียน (ผู้เรียกตัดสินผ่าน can()) · onChanged() เรียกหลังเขียนสำเร็จ (ให้ invalidate cache picker)
     title · help · emptyText · offNote (ข้อความเตือนตอนปิดใช้)
   ══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';

const inp = { padding: '5px 8px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', width: '100%' };
const btn = (bg, color = '#fff') => ({ padding: '5px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', background: bg, color, border: '1px solid var(--border)', whiteSpace: 'nowrap' });

const fromInput = (f, v) => {
  if (f.type === 'number') return v === '' || v == null ? null : Number(v);
  if (f.type === 'tags') return String(v ?? '').split(/[,|]/).map(s => s.trim()).filter(Boolean);
  return v === '' ? null : v;
};
const toInput = (f, v) => {
  if (f.type === 'tags') return Array.isArray(v) ? v.join(', ') : (v || '');
  return v == null ? '' : String(v);
};

function FieldInput({ f, value, onChange, disabled }) {
  const st = { ...inp, fontFamily: f.mono ? 'monospace' : undefined };
  if (f.type === 'select') return (
    <select value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value)} style={st}>
      {!f.required && <option value="">—</option>}
      {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label ?? o.value}</option>)}
    </select>
  );
  if (f.type === 'textarea') return <textarea rows={2} value={value ?? ''} disabled={disabled} placeholder={f.placeholder} onChange={e => onChange(e.target.value)} style={st} />;
  return <input type={f.type === 'number' ? 'number' : 'text'} value={value ?? ''} disabled={disabled} placeholder={f.placeholder} onChange={e => onChange(e.target.value)} style={st} />;
}

export default function SimpleMasterPanel({
  client, table, keyCol = 'code', keyFrom, fields = [], stampCol, stampName,
  canManage = false, onChanged, title, help, emptyText = 'ยังไม่มีรายการ', offNote = 'รายการนี้จะไม่โผล่ในตัวเลือกให้เลือกใหม่ (ข้อมูลเก่าที่ใช้อยู่ไม่กระทบ)',
  maxHeight = 360,
}) {
  const [rows, setRows] = useState([]);
  const [missing, setMissing] = useState(false);
  const [q, setQ] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [draft, setDraft] = useState({});     // key → { field: inputValue }
  const [adding, setAdding] = useState(null); // { [keyCol], ...fields } | null
  const [busy, setBusy] = useState(false);

  const cols = useMemo(() => [keyCol, ...fields.map(f => f.key), 'is_active', 'sort_order'].join(', '), [keyCol, fields]);
  const load = useCallback(async () => {
    const { data, error } = await client.from(table).select(cols).order('sort_order').order(keyCol);
    if (error) { setMissing(true); setRows([]); return; }
    setMissing(false); setRows(data || []);
  }, [client, table, cols, keyCol]);
  useEffect(() => { load(); }, [load]);

  const stamp = stampCol && stampName ? { [stampCol]: stampName } : {};
  const done = () => { onChanged?.(); load(); };

  const add = async () => {
    const payload = {};
    for (const f of fields) {
      const v = fromInput(f, adding?.[f.key]);
      if (f.required && (v == null || v === '' || (Array.isArray(v) && !v.length))) { toast.error(`กรอก "${f.label}" ก่อน`); return; }
      payload[f.key] = v;
    }
    const key = String(keyFrom ? keyFrom(payload) : (adding?.[keyCol] || '')).trim();
    if (!key) { toast.error(`กรอก "${keyCol}" ก่อน`); return; }
    if (rows.some(r => String(r[keyCol]).toUpperCase() === key.toUpperCase())) { toast.error(`มี ${key} ในทะเบียนแล้ว`); return; }
    setBusy(true);
    const ok = checkWrite(await client.from(table).insert([{ [keyCol]: key, ...payload, sort_order: Math.max(100, ...rows.map(r => r.sort_order || 0)) + 1, ...stamp }]), `เพิ่ม ${key}`);
    setBusy(false);
    if (!ok) return;
    toast.success(`เพิ่ม ${key} แล้ว`); setAdding(null); done();
  };

  const saveRow = async (r) => {
    const d = draft[r[keyCol]]; if (!d) return;
    const payload = {};
    for (const f of fields) if (f.key in d) payload[f.key] = fromInput(f, d[f.key]);
    setBusy(true);
    const res = await client.from(table).update({ ...payload, ...stamp }).eq(keyCol, r[keyCol]).select(keyCol);
    setBusy(false);
    if (!checkWrite(res, `บันทึก ${r[keyCol]}`)) return;
    if (!res.data?.length) { toast.error('บันทึกไม่ติด (0 แถว) — อาจไม่มีสิทธิ์แก้ทะเบียนนี้'); return; }
    toast.success('บันทึกแล้ว'); setDraft(x => { const n = { ...x }; delete n[r[keyCol]]; return n; }); done();
  };

  const toggle = async (r) => {
    if (r.is_active !== false && !window.confirm(`ปิดใช้ "${r[keyCol]}" ?\n\n${offNote}\n(เปิดกลับได้ภายหลัง)`)) return;
    const res = await client.from(table).update({ is_active: r.is_active === false, ...stamp }).eq(keyCol, r[keyCol]).select(keyCol);
    if (!checkWrite(res, 'เปลี่ยนสถานะ')) return;
    if (!res.data?.length) { toast.error('เปลี่ยนสถานะไม่ติด (0 แถว) — อาจไม่มีสิทธิ์'); return; }
    done();
  };

  const remove = async (r) => {
    if (!window.confirm(`ลบ "${r[keyCol]}" ออกจากทะเบียน?\n\nข้อมูลเก่าที่บันทึกด้วยชื่อ/รหัสนี้ยังอ่านออก (ไม่ผูก FK) — ถ้าแค่เลิกใช้ แนะนำกด "ปิดใช้" แทน`)) return;
    const res = await client.from(table).delete().eq(keyCol, r[keyCol]).select(keyCol);
    if (!checkWrite(res, `ลบ ${r[keyCol]}`)) return;
    if (!res.data?.length) { toast.error('ลบไม่ติด (0 แถว) — อาจไม่มีสิทธิ์'); return; }
    done();
  };

  const shown = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return rows.filter(r => showOff || r.is_active !== false)
      .filter(r => !nq || [r[keyCol], ...fields.map(f => toInput(f, r[f.key]))].some(v => String(v || '').toLowerCase().includes(nq)));
  }, [rows, q, showOff, fields, keyCol]);
  const offCount = rows.filter(r => r.is_active === false).length;

  return (
    <div>
      {title && <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>{title} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>({rows.length})</span></div>}
      {help && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{help}</div>}
      {missing ? (
        <div style={{ fontSize: 12, color: '#f59e0b' }}>⚠ ยังไม่ได้ apply migration ของตาราง {table} (แจ้ง admin) — ระหว่างนี้ช่องเลือกยังพิมพ์เองได้พร้อมป้ายเตือน</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <input placeholder="🔍 ค้นหา…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inp, width: 220 }} />
            {offCount > 0 && <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} /> แสดงที่ปิดใช้ ({offCount})</label>}
            <div style={{ flex: 1 }} />
            {canManage && !adding && <button onClick={() => setAdding({})} style={btn('var(--accent)', '#08130a')}>+ เพิ่ม</button>}
          </div>

          {adding && (
            <div style={{ display: 'grid', gridTemplateColumns: `${keyFrom ? '' : '150px '}repeat(${fields.length}, minmax(120px, 1fr)) auto`, gap: 6, alignItems: 'end', padding: 8, borderRadius: 8, background: 'var(--bg2)', border: '1px dashed var(--border2)', marginBottom: 8 }}>
              {!keyFrom && <div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{keyCol}</div><input value={adding[keyCol] || ''} onChange={e => setAdding(a => ({ ...a, [keyCol]: e.target.value }))} style={{ ...inp, fontFamily: 'monospace' }} /></div>}
              {fields.map(f => <div key={f.key}><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{f.label}{f.required ? ' *' : ''}</div><FieldInput f={f} value={adding[f.key]} onChange={v => setAdding(a => ({ ...a, [f.key]: v }))} /></div>)}
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={add} disabled={busy} style={btn('var(--accent)', '#08130a')}>บันทึก</button>
                <button onClick={() => setAdding(null)} style={btn('var(--bg3)', 'var(--text2)')}>ยกเลิก</button>
              </div>
            </div>
          )}

          <div style={{ maxHeight, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: 'var(--bg3)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)' }}>{keyCol}</th>
                {fields.map(f => <th key={f.key} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', width: f.width }}>{f.label}</th>)}
                {canManage && <th style={{ width: 150 }} />}
              </tr></thead>
              <tbody>
                {shown.map(r => {
                  const k = r[keyCol]; const d = draft[k];
                  return (
                    <tr key={k} style={{ borderTop: '1px solid var(--border)', opacity: r.is_active === false ? 0.55 : 1 }}>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>{k}{r.is_active === false && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)' }}>⏸</span>}</td>
                      {fields.map(f => (
                        <td key={f.key} style={{ padding: '4px 6px' }}>
                          {canManage
                            ? <FieldInput f={f} value={d && f.key in d ? d[f.key] : toInput(f, r[f.key])} onChange={v => setDraft(x => ({ ...x, [k]: { ...(x[k] || {}), [f.key]: v } }))} />
                            : <span>{f.type === 'select' ? (f.options?.find(o => o.value === r[f.key])?.label ?? r[f.key] ?? '') : toInput(f, r[f.key])}</span>}
                        </td>
                      ))}
                      {canManage && (
                        <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                          {d && <button onClick={() => saveRow(r)} disabled={busy} style={{ ...btn('var(--accent)', '#08130a'), marginRight: 4 }}>💾</button>}
                          <button onClick={() => toggle(r)} style={{ ...btn('transparent', 'var(--text2)'), marginRight: 4 }}>{r.is_active === false ? 'เปิดใช้' : 'ปิดใช้'}</button>
                          <button onClick={() => remove(r)} style={btn('transparent', '#ef4444')}>ลบ</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={fields.length + 2} style={{ padding: 10, color: 'var(--muted)' }}>{emptyText}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
