/* ═══ 🚚 ตารางรอบรับของลูกค้า (milk-run pickup schedule) — แก้ได้จากหน้าจอ ═══════════════
   user 2026-09-09: *"ต้องทำเป็นระบบให้รองรับการแก้ไขได้นะ สำหรับโรงงานอื่น แต่ของเรา seed ไปเลย"*

   🔴 ทำไมรอบส่ง "คำนวณเอา" ไม่ได้:
      ตารางจริงของ AAT ระยะจากปลายช่วงดึงถึงเวลารถมารับ **ไม่คงที่**
        10:00-12:00 → รับ 14:00 (2 ชม.) · 14:00-16:00 → รับ 22:00 (6 ชม.) · 16:00-22:00 → รับ 23:00 (1 ชม.)
      สูตร `ปลายช่วง + lead_min` เดาช่วง 10:00-12:00 เป็น 13:00 = **ผิดเงียบ** จนเอาไปเทียบใบกระดาษถึงรู้
   ⇒ ที่นี่คือ single source of truth ของ "รอบไหนรับกี่โมง" · `pickPullRound` ใน pullSignal.js อ่านตัวนี้ */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';

const PATTERNS = [
  { key: 'normal',   label: 'ปกติ' },
  { key: 'ot_day',   label: 'OT กลางวัน' },
  { key: 'ot_night', label: 'OT กลางคืน' },
];
const patLabel = (k) => PATTERNS.find(p => p.key === k)?.label || k;

const BLANK = {
  ship_to: '', dock_code: '', supplier_code: '', pattern: 'normal',
  period_start: '', period_end: '', prepare_from: '', prepare_to: '',
  pickup_time: '', pickup_day_offset: 0, delivery_time: '', note: '',
};

const hhmm = (v) => {
  const m = String(v ?? '').match(/^(\d{1,2}):(\d{2})/);
  return m ? `${String(+m[1]).padStart(2, '0')}:${m[2]}` : '';
};

export default function PullRoundsPanel({ canEdit, shipToMap, fullName }) {
  const [rows, setRows] = useState([]);
  const [missing, setMissing] = useState(false);      // ตารางยังไม่ apply
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(null);
  const [draft, setDraft] = useState({});             // id → patch
  const [adding, setAdding] = useState(null);         // แถวใหม่ (object) หรือ null
  const [filterShipTo, setFilterShipTo] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabaseDR.from('customer_pull_rounds')
      .select('*').order('ship_to').order('dock_code').order('pattern').order('sort_order');
    if (error) {
      // ⚠️ ห้ามเงียบ — แยก "ยังไม่ apply migration" ออกจาก "โหลดพัง"
      setRows([]); setMissing(error.code === '42P01'); setLoadErr(error.code === '42P01' ? '' : error.message);
      return;
    }
    setRows(data || []); setMissing(false); setLoadErr(''); setDraft({});
  }, []);
  useEffect(() => { load(); }, [load]);

  const shipTos = useMemo(
    () => [...new Set(rows.map(r => r.ship_to).filter(Boolean))].sort(), [rows]);
  const shown = useMemo(
    () => rows.filter(r => !filterShipTo || r.ship_to === filterShipTo), [rows, filterShipTo]);

  /* จัดกลุ่มให้อ่านเหมือนใบที่ลูกค้าส่งมา: ลูกค้า → dock → pattern */
  const groups = useMemo(() => {
    const m = new Map();
    shown.forEach(r => {
      const k = `${r.ship_to}|${r.dock_code || '—'}|${r.pattern || 'normal'}`;
      if (!m.has(k)) m.set(k, { ship_to: r.ship_to, dock_code: r.dock_code, pattern: r.pattern, list: [] });
      m.get(k).list.push(r);
    });
    return [...m.values()];
  }, [shown]);

  const val = (r, k) => (draft[r.id]?.[k] ?? r[k] ?? '');
  const setVal = (r, k, v) => setDraft(d => ({ ...d, [r.id]: { ...d[r.id], [k]: v } }));
  const dirty = (id) => !!draft[id] && Object.keys(draft[id]).length > 0;

  const save = async (r) => {
    const d = draft[r.id]; if (!d) return;
    const patch = { ...d, updated_at: new Date().toISOString(), updated_by_name: fullName || null };
    ['period_start', 'period_end', 'pickup_time', 'prepare_from', 'prepare_to', 'delivery_time'].forEach(k => {
      if (k in patch) patch[k] = hhmm(patch[k]) || null;
    });
    if ('pickup_time' in patch && !patch.pickup_time) { toast.error('เวลารถมารับห้ามว่าง'); return; }
    setBusy(r.id);
    // ⚠️ RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" → ต้องนับแถวที่เขียนได้จริง (กฎเหล็กข้อ 2)
    const res = await supabaseDR.from('customer_pull_rounds').update(patch).eq('id', r.id).select('id');
    setBusy(null);
    if (!checkWrite(res, 'บันทึกรอบรับ')) return;
    if (!res.data?.length) { toast.error('บันทึกไม่ติด (0 แถว) — ตรวจสิทธิ์แล้วลองใหม่'); return; }
    toast.success('บันทึกแล้ว'); await load();
  };

  const addRow = async () => {
    const a = adding; if (!a) return;
    const rec = {
      ...a,
      ship_to: String(a.ship_to || '').trim().toUpperCase(),
      dock_code: String(a.dock_code || '').trim().toUpperCase() || null,
      supplier_code: String(a.supplier_code || '').trim().toUpperCase() || null,
      period_start: hhmm(a.period_start), period_end: hhmm(a.period_end),
      pickup_time: hhmm(a.pickup_time),
      prepare_from: hhmm(a.prepare_from) || null, prepare_to: hhmm(a.prepare_to) || null,
      delivery_time: hhmm(a.delivery_time) || null,
      pickup_day_offset: Number(a.pickup_day_offset) || 0,
      note: String(a.note || '').trim() || null,
      updated_by_name: fullName || null,
    };
    if (!rec.ship_to || !rec.period_start || !rec.period_end || !rec.pickup_time) {
      toast.error('ต้องกรอก ลูกค้า · ช่วงดึง (ต้น-ปลาย) · เวลารถมารับ'); return;
    }
    setBusy('new');
    const res = await supabaseDR.from('customer_pull_rounds').insert(rec).select('id');
    setBusy(null);
    if (res.error?.code === '23505') { toast.error('มีรอบของ ลูกค้า+dock+รูปแบบ+ช่วงเวลานี้อยู่แล้ว — แก้แถวเดิมแทน'); return; }
    if (!checkWrite(res, 'เพิ่มรอบรับ')) return;
    toast.success('เพิ่มแล้ว'); setAdding(null); await load();
  };

  const removeRow = async (r) => {
    if (!window.confirm(`ลบรอบ ${r.ship_to}${r.dock_code ? ` · ${r.dock_code}` : ''} · ${patLabel(r.pattern)}\n${r.period_start}-${r.period_end} → รับ ${r.pickup_time} ?\n\nไฟล์ e-SMART ช่วงนี้จะกลับไปใช้สูตรเดา (ปลายช่วง + lead_min)`)) return;
    setBusy(r.id);
    const res = await supabaseDR.from('customer_pull_rounds').delete().eq('id', r.id).select('id');
    setBusy(null);
    if (!checkWrite(res, 'ลบรอบรับ')) return;
    if (!res.data?.length) { toast.error('ลบไม่ติด (0 แถว) — ตรวจสิทธิ์แล้วลองใหม่'); return; }
    toast.success('ลบแล้ว'); await load();
  };

  const th = { padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' };
  const td = { padding: '5px 8px', borderTop: '1px solid var(--border)', fontSize: 12 };
  const inp = { background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '4px 6px', fontSize: 12, width: 92 };
  const btn = (c) => ({ background: c, border: 'none', color: '#0b1220', fontWeight: 800, fontSize: 11, borderRadius: 6, padding: '4px 9px', cursor: 'pointer' });

  return (
    <div style={{ marginTop: 18, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>🚚 ตารางรอบรับของลูกค้า (milk-run)</div>
        {shipTos.length > 1 && (
          <select value={filterShipTo} onChange={e => setFilterShipTo(e.target.value)} style={{ ...inp, width: 150 }}>
            <option value="">ทุกลูกค้า</option>
            {shipTos.map(c => <option key={c} value={c}>{shipToMap?.[c]?.customer_name || c}</option>)}
          </select>
        )}
        {canEdit && !missing && (
          <button onClick={() => setAdding({ ...BLANK, ship_to: filterShipTo || shipTos[0] || '' })}
            style={{ ...btn('var(--accent)'), marginLeft: 'auto' }}>➕ เพิ่มรอบ</button>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
        e-SMART ใช้ตารางนี้หา <b>รอบที่รถลูกค้ามารับ</b> จากช่วงเวลาในไฟล์ — <b>ไม่ใช่สูตรคำนวณ</b>
        (ระยะจากปลายช่วงถึงเวลารับไม่คงที่ 1–6 ชม. แล้วแต่รอบ) · ช่วงไหนไม่มีในตาราง ระบบจะเดาด้วย
        “ปลายช่วง + lead_min” <b>พร้อมขึ้นคำเตือนบนจออัพโหลด</b>
      </div>

      {missing && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 8, padding: 10, fontSize: 12 }}>
          ⚠️ ยังไม่ได้สร้างตาราง <code>customer_pull_rounds</code> — รัน migration
          <code> 20260909_customer_pull_rounds.sql</code> ที่ project <b>Product DB (DR)</b> ก่อน
          · ระหว่างนี้ระบบใช้สูตร lead_min เดารอบให้ และเตือนบนจออัพโหลดทุกครั้ง
        </div>
      )}
      {loadErr && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 8, padding: 10, fontSize: 12 }}>
          🔴 โหลดตารางรอบรับไม่สำเร็จ: {loadErr}
        </div>
      )}

      {adding && (
        <div style={{ background: 'var(--bg2)', border: '1px dashed var(--accent)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {[['ship_to', 'ลูกค้า (code)', 'text'], ['dock_code', 'Dock', 'text'], ['supplier_code', 'รหัสผู้ส่ง', 'text']].map(([k, l]) => (
              <label key={k} style={{ fontSize: 11, color: 'var(--muted)' }}>{l}<br />
                <input value={adding[k]} onChange={e => setAdding(a => ({ ...a, [k]: e.target.value }))} style={inp} /></label>
            ))}
            <label style={{ fontSize: 11, color: 'var(--muted)' }}>รูปแบบ<br />
              <select value={adding.pattern} onChange={e => setAdding(a => ({ ...a, pattern: e.target.value }))} style={inp}>
                {PATTERNS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select></label>
            {[['period_start', 'ช่วงดึง ต้น'], ['period_end', 'ช่วงดึง ปลาย'], ['prepare_from', 'เตรียม ต้น'],
              ['prepare_to', 'เตรียม ปลาย'], ['pickup_time', '⭐ รถมารับ'], ['delivery_time', 'ถึงลูกค้า']].map(([k, l]) => (
              <label key={k} style={{ fontSize: 11, color: 'var(--muted)' }}>{l}<br />
                <input type="time" value={adding[k]} onChange={e => setAdding(a => ({ ...a, [k]: e.target.value }))} style={inp} /></label>
            ))}
            <label style={{ fontSize: 11, color: 'var(--muted)' }}>รับ +วัน<br />
              <input type="number" value={adding.pickup_day_offset}
                onChange={e => setAdding(a => ({ ...a, pickup_day_offset: e.target.value }))} style={{ ...inp, width: 60 }} /></label>
            <button onClick={addRow} disabled={busy === 'new'} style={btn('var(--accent)')}>บันทึก</button>
            <button onClick={() => setAdding(null)} style={{ ...btn('var(--bg3)'), color: 'var(--text)' }}>ยกเลิก</button>
          </div>
        </div>
      )}

      {groups.map(g => (
        <div key={`${g.ship_to}|${g.dock_code}|${g.pattern}`} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
            {shipToMap?.[g.ship_to]?.customer_name || g.ship_to}
            {g.dock_code ? <> · Dock <b>{g.dock_code}</b></> : ' · ทุก Dock'}
            <span style={{ color: 'var(--muted)', fontWeight: 600 }}> · {patLabel(g.pattern)}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
              <thead><tr>
                <th style={th}>ช่วงดึง</th><th style={th}>เตรียมของ</th>
                <th style={th}>⭐ รถมารับ</th><th style={th}>ถึงลูกค้า</th>
                <th style={th}>หมายเหตุ</th>{canEdit && <th style={th} />}
              </tr></thead>
              <tbody>
                {g.list.map(r => (
                  <tr key={r.id}>
                    <td style={td}>
                      {canEdit ? (
                        <><input type="time" value={hhmm(val(r, 'period_start'))} onChange={e => setVal(r, 'period_start', e.target.value)} style={{ ...inp, width: 80 }} />
                          {' – '}
                          <input type="time" value={hhmm(val(r, 'period_end'))} onChange={e => setVal(r, 'period_end', e.target.value)} style={{ ...inp, width: 80 }} /></>
                      ) : `${hhmm(r.period_start)} – ${hhmm(r.period_end)}`}
                    </td>
                    <td style={{ ...td, color: 'var(--muted)' }}>
                      {canEdit ? (
                        <><input type="time" value={hhmm(val(r, 'prepare_from'))} onChange={e => setVal(r, 'prepare_from', e.target.value)} style={{ ...inp, width: 80 }} />
                          {' – '}
                          <input type="time" value={hhmm(val(r, 'prepare_to'))} onChange={e => setVal(r, 'prepare_to', e.target.value)} style={{ ...inp, width: 80 }} /></>
                      ) : (r.prepare_from ? `${hhmm(r.prepare_from)} – ${hhmm(r.prepare_to)}` : '—')}
                    </td>
                    <td style={{ ...td, fontWeight: 800 }}>
                      {canEdit
                        ? <input type="time" value={hhmm(val(r, 'pickup_time'))} onChange={e => setVal(r, 'pickup_time', e.target.value)} style={{ ...inp, width: 80 }} />
                        : hhmm(r.pickup_time)}
                      {Number(r.pickup_day_offset) ? <span style={{ color: '#f59e0b', fontSize: 11 }}> (+{r.pickup_day_offset}ว)</span> : null}
                    </td>
                    <td style={{ ...td, color: 'var(--muted)' }}>
                      {canEdit
                        ? <input type="time" value={hhmm(val(r, 'delivery_time'))} onChange={e => setVal(r, 'delivery_time', e.target.value)} style={{ ...inp, width: 80 }} />
                        : (hhmm(r.delivery_time) || '—')}
                    </td>
                    <td style={{ ...td, color: 'var(--muted)', fontSize: 11, maxWidth: 260 }}>{r.note || ''}</td>
                    {canEdit && (
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <button onClick={() => save(r)} disabled={!dirty(r.id) || busy === r.id}
                          style={{ ...btn(dirty(r.id) ? 'var(--accent)' : 'var(--bg3)'), color: dirty(r.id) ? '#0b1220' : 'var(--muted)' }}>บันทึก</button>
                        {' '}
                        <button onClick={() => removeRow(r)} disabled={busy === r.id}
                          style={{ ...btn('rgba(239,68,68,0.9)'), color: '#fff' }}>ลบ</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {!missing && !loadErr && !groups.length && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีรอบรับในทะเบียน — กด ➕ เพิ่มรอบ</div>
      )}
    </div>
  );
}
