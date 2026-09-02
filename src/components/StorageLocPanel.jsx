/**
 * 🏬 StorageLocPanel — ทะเบียนรหัสคลัง (SAP Storage Location) · 2026-09-02
 *
 * user กำหนดรูปแบบเอง: ตัวอักษร 1-3 ตัว + เลข 3 หลัก · ตัวอักษรนำหน้าบอกชนิดพื้นที่
 *   S401 สโตร์ชิ้นส่วน · P401/P402 พื้นที่ผลิต · W401 warehouse (FG) · R401 สโตร์เหล็ก
 *
 * ⚠️⚠️ คนละเรื่องกับ `storage_zones` (โซนกองของที่ตีกรอบบนผังโรงงาน) — **ห้ามยุบรวม**
 *   นี่คือ "รหัสบัญชีคลัง" ที่อ้างในทุกบรรทัด BOM (`bom_items.storage_location`) แบบ SAP
 *   1 SLoc ครอบได้หลายโซน · ผูกกันเมื่อไหร่ค่อยเพิ่มคอลัมน์ทีหลัง
 *
 * ⚠️ รูปแบบ/ชนิด/การตรวจ อยู่ที่ `src/utils/storageLoc.js` ที่เดียว **ห้ามเขียน regex ซ้ำที่นี่**
 * ⚠️ ยังไม่ผูกกับการตัดสต็อก — fn_explode_child_demand ยังหักตาม line_name เหมือนเดิม
 *    (จอต้องเขียนบอกไว้ ไม่งั้นคนกรอกแล้วคิดว่ามีผลทันที)
 */
import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import ReadOnlyNote from './ReadOnlyNote';
import { SLOC_KINDS, slocKindMeta, slocKindGuess, slocLabel, slocValid, SLOC_FORMAT_HINT } from '../utils/storageLoc';

const inputSt = {
  width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)',
};

export default function StorageLocPanel() {
  const { role, fullName } = useContext(UserContext);
  const canManage = can('storage', 'manage', role);

  const [rows, setRows]     = useState([]);
  const [used, setUsed]     = useState([]);      // รหัสที่ถูกใช้ใน bom_items จริง
  const [missing, setMissing] = useState(false); // ตารางยังไม่ apply (42P01) — ห้ามเงียบ
  const [loading, setLoading] = useState(true);
  const [edit, setEdit]     = useState(null);    // null | {} (ใหม่) | row (แก้)

  const load = useCallback(async () => {
    setLoading(true);
    const [r1, r2] = await Promise.all([
      supabaseDR.from('storage_locations').select('*').order('sort_order').order('code'),
      supabaseDR.from('bom_items').select('storage_location').eq('is_active', true),
    ]);
    setLoading(false);
    if (r1.error?.code === '42P01') { setMissing(true); setRows([]); return; }
    if (r1.error) { toast.error(r1.error.message); return; }
    setMissing(false);
    setRows(r1.data || []);
    // ⚠️ ยังไม่ apply migration ของ bom_items = อ่านคอลัมน์ไม่ได้ → ถือว่ายังไม่มีใครใช้ (ไม่ใช่ error)
    setUsed(r2.error ? [] : [...new Set((r2.data || []).map(b => slocLabel(b.storage_location)).filter(Boolean))]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const usedCount = useMemo(() => {
    const m = {};
    used.forEach(c => { m[c] = true; });
    return m;
  }, [used]);
  /* รหัสที่ถูกใช้ใน BOM แต่ยังไม่มีในทะเบียน = worklist **ห้ามซ่อน**
     (ซ่อนแล้วหาตัวที่พิมพ์ผิด/ตัวที่ต้องลงทะเบียนไม่เจอ — หลักเดียวกับ optgroup "นอกผัง") */
  const orphan = useMemo(() => {
    const reg = new Set(rows.map(r => slocLabel(r.code)));
    return used.filter(c => !reg.has(c));
  }, [rows, used]);

  const save = async (form) => {
    const code = slocLabel(form.code);
    if (!code) { toast.error('ใส่รหัสคลัง'); return false; }
    if (!slocValid(code)) { toast.error(`รหัสไม่ถูกรูปแบบ — ${SLOC_FORMAT_HINT}`); return false; }
    if (!form.name.trim()) { toast.error('ใส่ชื่อพื้นที่'); return false; }
    const payload = {
      code, name: form.name.trim(), kind: form.kind || null,
      note: form.note?.trim() || null,
      sort_order: Number(form.sort_order) || 100,
      is_active: !!form.is_active,
      updated_by_name: fullName || null,
    };
    // แก้รหัส = สร้างแถวใหม่ (code เป็น PK) → บล็อกไว้ ให้ลบแล้วสร้างใหม่แทน กันรหัสกำพร้าใน BOM
    const q = edit?.code
      ? supabaseDR.from('storage_locations').update(payload).eq('code', edit.code)
      : supabaseDR.from('storage_locations').insert(payload);
    const { error } = await q;
    if (error) {
      toast.error(error.code === '23505' ? `รหัส ${code} มีอยู่แล้วในทะเบียน`
        : error.code === '23514' ? `รหัสไม่ถูกรูปแบบ — ${SLOC_FORMAT_HINT}`
        : error.message);
      return false;
    }
    toast.success(edit?.code ? 'แก้ไขแล้ว' : `เพิ่มรหัส ${code} แล้ว`);
    setEdit(null); load();
    return true;
  };

  const remove = async (r) => {
    const n = usedCount[slocLabel(r.code)] ? 1 : 0;
    if (n) { toast.error(`รหัส ${r.code} ถูกใช้ใน BOM อยู่ — ปิดใช้งานแทนการลบ (กดแก้ไข → เอาติ๊ก "ใช้งาน" ออก)`); return; }
    if (!window.confirm(`ลบรหัส ${r.code} · ${r.name}?`)) return;
    const { error } = await supabaseDR.from('storage_locations').delete().eq('code', r.code);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบแล้ว'); load();
  };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>🏬 ทะเบียนรหัสคลัง (Storage Location)</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            รหัสบัญชีคลังแบบ SAP ที่อ้างในทุกบรรทัดของ BOM · {SLOC_FORMAT_HINT}
            <br />⚠️ <b>ยังไม่ผูกกับการตัดสต็อก</b> — ระบบยังหักของตามชื่อไลน์เหมือนเดิม · คนละเรื่องกับ “โซนคลัง (ผัง)” ด้านล่าง
          </div>
        </div>
        {canManage && !missing && (
          <button onClick={() => setEdit({ code: '', name: '', kind: '', note: '', sort_order: (rows.length + 1) * 10, is_active: true })}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#08130a', fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-body)' }}>
            + เพิ่มรหัสคลัง
          </button>
        )}
      </div>

      <ReadOnlyNote show={!canManage && !missing} role={role} what="จัดการทะเบียนรหัสคลัง" permKey="storage:manage" />

      {missing && (
        <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', fontSize: 12.5, color: '#f59e0b', fontWeight: 700 }}>
          ⚠️ ยังไม่ได้ apply migration <code>20260902_storage_locations_master.sql</code> — ทะเบียนยังใช้ไม่ได้ (แจ้ง admin)
        </div>
      )}

      {!missing && orphan.length > 0 && (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', fontSize: 12, color: '#f59e0b', marginBottom: 10 }}>
          <b>⚠ มีรหัสที่ถูกใช้ใน BOM แต่ยังไม่อยู่ในทะเบียน {orphan.length} รหัส</b> — อาจพิมพ์ผิด หรือเป็นพื้นที่ใหม่ที่ยังไม่ลงทะเบียน
          <div style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {orphan.map(c => (
              <span key={c} onClick={canManage ? () => setEdit({ code: c, name: '', kind: slocKindGuess(c) || '', note: '', sort_order: (rows.length + 1) * 10, is_active: true }) : undefined}
                style={{ fontFamily: 'monospace', fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(245,158,11,0.16)', cursor: canManage ? 'pointer' : 'default' }}>
                {c}{canManage ? ' +' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด...</div>
      ) : !missing && rows.length === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: 'var(--bg2)', borderRadius: 8, border: '1px dashed var(--border)' }}>
          ยังไม่มีรหัสคลังในทะเบียน{canManage && ' — กด "+ เพิ่มรหัสคลัง"'}
        </div>
      ) : !missing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(r => {
            const meta = slocKindMeta(r.kind);
            const inUse = !!usedCount[slocLabel(r.code)];
            return (
              <div key={r.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8,
                background: 'var(--bg2)', border: '1px solid var(--border)', opacity: r.is_active ? 1 : 0.5 }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, padding: '3px 9px', borderRadius: 8, background: `${meta.color}1f`, color: meta.color, flexShrink: 0 }}>
                  {r.code}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                    {meta.icon} {meta.label}
                    {!r.kind && <span style={{ color: '#f59e0b' }}> · ⚠ ยังไม่ระบุชนิด</span>}
                    {r.note && <span> · {r.note}</span>}
                    {!r.is_active && <span style={{ color: '#f59e0b' }}> · ปิดใช้งาน</span>}
                  </div>
                </div>
                {inUse && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>ใช้ใน BOM</span>}
                {canManage && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="tbtn" onClick={() => setEdit(r)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>✏️</button>
                    <button className="tbtn" onClick={() => remove(r)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>🗑</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {edit && <LocForm init={edit} isNew={!rows.some(r => r.code === edit.code)} onSave={save} onClose={() => setEdit(null)} />}
    </div>
  );
}

function LocForm({ init, isNew, onSave, onClose }) {
  const [f, setF] = useState({ ...init, code: slocLabel(init.code) });
  const [busy, setBusy] = useState(false);
  const code = slocLabel(f.code);
  const badFormat = code !== '' && !slocValid(code);
  const guess = slocKindGuess(code);

  const submit = async () => { setBusy(true); await onSave(f); setBusy(false); };

  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(420px,100%)' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 14 }}>
          {isNew ? '➕ เพิ่มรหัสคลัง' : `✏️ แก้ไข ${init.code}`}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>รหัส *</label>
            <input autoFocus={isNew} disabled={!isNew} maxLength={6}
              style={{ ...inputSt, fontFamily: 'monospace', fontSize: 18, fontWeight: 800, textAlign: 'center', textTransform: 'uppercase', opacity: isNew ? 1 : 0.55 }}
              value={f.code} onChange={e => setF(v => ({ ...v, code: e.target.value }))} placeholder="S401" />
            <div style={{ fontSize: 10.5, marginTop: 3, lineHeight: 1.45 }}>
              {badFormat
                ? <span style={{ color: '#ef4444', fontWeight: 700 }}>🔴 {SLOC_FORMAT_HINT}</span>
                : <span style={{ color: 'var(--muted)' }}>{SLOC_FORMAT_HINT}</span>}
              {/* รหัสเป็น PK และถูกอ้างใน BOM → แก้ไม่ได้ ต้องบอกเหตุผล ไม่ใช่ปิดเฉยๆ */}
              {!isNew && <div style={{ color: 'var(--muted)' }}>รหัสแก้ไม่ได้ (ถูกอ้างใน BOM) — ถ้าตั้งผิด ให้เพิ่มรหัสใหม่แล้วปิดใช้งานตัวเก่า</div>}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ชื่อพื้นที่ *</label>
            <input autoFocus={!isNew} style={inputSt} value={f.name} onChange={e => setF(v => ({ ...v, name: e.target.value }))} placeholder="เช่น พื้นที่สโตร์เก็บชิ้นส่วน" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ชนิดพื้นที่</label>
            <select style={inputSt} value={f.kind || ''} onChange={e => setF(v => ({ ...v, kind: e.target.value }))}>
              <option value="">— ยังไม่ระบุ —</option>
              {Object.entries(SLOC_KINDS).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
            </select>
            {/* 💡 ระบบเสนอจากตัวอักษรนำหน้า **คนกดยืนยันเอง** ไม่เติมให้อัตโนมัติ */}
            {guess && guess !== f.kind && (
              <div onClick={() => setF(v => ({ ...v, kind: guess }))} style={{ fontSize: 10.5, color: '#0ea5e9', cursor: 'pointer', marginTop: 3, fontWeight: 700 }}>
                💡 รหัสขึ้นต้น {code[0]} — น่าจะเป็น “{slocKindMeta(guess).label}” (กดเพื่อใช้)
              </div>
            )}
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
            <input style={inputSt} value={f.note || ''} onChange={e => setF(v => ({ ...v, note: e.target.value }))} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!f.is_active} onChange={e => setF(v => ({ ...v, is_active: e.target.checked }))} />
            ใช้งาน (เอาติ๊กออก = ซ่อนจากตัวเลือก แต่ BOM เดิมที่อ้างอยู่ยังอ่านได้)
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-body)' }}>ยกเลิก</button>
          <button onClick={submit} disabled={busy || badFormat}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', cursor: busy || badFormat ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-body)', opacity: busy || badFormat ? 0.5 : 1 }}>
            {busy ? '...' : '💾 บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
