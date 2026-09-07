import { useMemo, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from '../components/Toast';
import { suggestFixtureCandidates } from '../utils/fixturePoints';
import { jigEquipTypeOf, EQUIPMENT_KINDS } from '../utils/equipmentKinds';

/* ═══════════════════════════════════════════════════════════════
   ⚙️ จัดชนิดอุปกรณ์เป็นชุด — เฟส 0 ของโมดูล Fixture Shim

   ⚠️ ทำไมต้องมีแท็บนี้ (ตรวจข้อมูลจริง 2026-09-01):
      จิ๊กบนผังไลน์จำนวนมากถูกติดป้าย equipment_kind='machine' ตอน backfill (2026-08-10)
      เพราะแกะจากชื่อไม่ออก — โดยเฉพาะจิ๊กเชื่อมของ Line 60/61 (JHYD05-* / JHYD06-*)
      ซึ่งเป็นกลุ่มที่ shim สำคัญที่สุด แต่ไม่อยู่ในทะเบียน fixture เลย

   🔴 กฎเหล็ก: **ระบบเสนอ คนติ๊กยืนยัน — ห้าม backfill อัตโนมัติจากชื่อ**
      "Welding" / "Tower load" / "MAGAZINE" แยกไม่ออกว่าเป็นจิ๊กหรือเครื่องจักร
      เดาผิด = อุปกรณ์ไปโผล่ผิดทะเบียน แล้ว PM/MO/ประวัติเดินตามผิดทั้งสาย
      (หลักเดียวกับ backfill ทะเบียนแม่พิมพ์ที่ปล่อยช่องที่แกะไม่ออกให้ว่างไว้)

   ⚠️ เปลี่ยน equipment_kind ต้อง sync `jigs.equipment_type` ของ "แถวเงา" ด้วยเสมอ
      (กฎใน equipmentKinds.js — แถวเงาเป็นสำเนา ห้ามตั้งอิสระ เคยเพี้ยนมาแล้ว 9 ตัว)
═══════════════════════════════════════════════════════════════ */

const chip = (bg, bd) => ({
  background: bg, border: `1px solid ${bd}`, borderRadius: 999,
  padding: '1px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
});

export default function FixtureClassify({ machines, mapKeys, canEdit, lines, onSaved }) {
  const [picked, setPicked] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [kind, setKind]     = useState('jig');
  const [q, setQ]           = useState('');
  const [lineF, setLineF]   = useState('');

  const cands = useMemo(
    () => suggestFixtureCandidates(machines, mapKeys),
    [machines, mapKeys],
  );

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return cands.filter(c =>
      (!lineF || c.line_name === lineF) &&
      (!kw || `${c.machine_no} ${c.machine_name}`.toLowerCase().includes(kw)));
  }, [cands, q, lineF]);

  const hiddenCount = cands.length - shown.length;
  const lineOpts = useMemo(
    () => [...new Set(cands.map(c => c.line_name).filter(Boolean))].sort(),
    [cands],
  );

  const toggle = (id) => setPicked(prev => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });
  const pickAllShown = () => setPicked(prev => {
    const s = new Set(prev);
    const allIn = shown.every(c => s.has(c.id));
    shown.forEach(c => (allIn ? s.delete(c.id) : s.add(c.id)));
    return s;
  });

  const save = async () => {
    if (!picked.size) return;
    const ids = [...picked];
    const label = EQUIPMENT_KINDS.find(k => k.key === kind)?.label || kind;
    if (!window.confirm(`ตั้ง ${ids.length} รายการเป็น "${label}" ?\n\nการเปลี่ยนชนิดมีผลกับทะเบียน/ผัง/ตัวกรองทุกหน้า`)) return;

    setSaving(true);
    try {
      const { data, error } = await supabaseDR
        .from('machines').update({ equipment_kind: kind }).in('id', ids).select('id');
      if (error) throw error;
      const okN = data?.length ?? 0;

      // sync แถวเงาใน jigs (ถ้ามี) — ห้ามปล่อยให้ชนิดสองที่ไม่ตรงกัน
      let shadowWarn = '';
      const { error: jErr } = await supabaseDR
        .from('jigs').update({ equipment_type: jigEquipTypeOf(kind) }).in('machine_id', ids);
      if (jErr) shadowWarn = ' · ⚠️ sync แถวเงาใน jigs ไม่สำเร็จ (แจ้ง admin)';

      if (okN < ids.length) {
        toast.error(`บันทึกได้ ${okN}/${ids.length} รายการ — ที่เหลือไม่ถูกเขียน (เช็คสิทธิ์/การเชื่อมต่อ)`);
      } else {
        toast.success(`ตั้งเป็น "${label}" แล้ว ${okN} รายการ${shadowWarn}`);
      }
      setPicked(new Set());
      onSaved?.();
    } catch (e) {
      toast.error(`บันทึกไม่สำเร็จ: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!cands.length) {
    return (
      <div style={{ background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.45)',
                    borderRadius: 10, padding: '14px 16px', fontSize: 13 }}>
        ✅ ไม่มีเครื่องที่ระบบสงสัยว่าเป็นจิ๊ก/ฟิกเจอร์แล้ว
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
          ระบบดูจากเลขเครื่อง (JHYD/GPHYD/JIG) · ชื่อ (JIG/GRIPPER/CENTERING/MARKING/POKA-YOKE) และการวางบนผังไลน์
          — ถ้ามีตัวที่ระบบไม่รู้จัก ให้เปลี่ยนชนิดรายตัวที่ <b>ฐานข้อมูลเครื่องจักร</b>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.45)',
                    borderRadius: 10, padding: '12px 14px', fontSize: 12.5, lineHeight: 1.65 }}>
        <b>⚠️ ระบบ “เสนอ” เท่านั้น — คนเป็นคนตัดสิน</b><br />
        ชื่ออย่าง <code>Welding</code> / <code>Tower load</code> / <code>MAGAZINE</code> แยกไม่ออกว่าเป็นจิ๊กหรือเครื่องจักร
        ระบบจึงไม่เปลี่ยนให้เอง · ติ๊กเฉพาะตัวที่ช่างยืนยันว่าเป็นจิ๊ก/ฟิกเจอร์จริง
        <div style={{ marginTop: 6, color: 'var(--muted)' }}>
          พบ <b>{cands.length}</b> รายการที่ยังเป็น “เครื่องจักร” แต่มีลักษณะของจิ๊ก ·
          ตั้งชนิดถูกแล้วถึงจะลงทะเบียนจุดชิมได้
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 ค้นเลขเครื่อง / ชื่อ"
               style={{ width: 220, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
                        background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }} />
        <select value={lineF} onChange={e => setLineF(e.target.value)}
                style={{ width: 190, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
                         background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}>
          <option value="">ทุกไลน์</option>
          {lineOpts.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={pickAllShown} style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12.5,
                background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer' }}>
          ติ๊ก/เอาออก ทั้งที่แสดง ({shown.length})
        </button>
        {hiddenCount > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>👁 ซ่อนอยู่ {hiddenCount} รายการ (ไม่ตรงตัวกรอง)</span>
        )}
      </div>

      <div style={{ maxHeight: '52vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 1 }}>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '8px 10px', width: 38 }}></th>
              <th style={{ padding: '8px 10px' }}>เลขเครื่อง</th>
              <th style={{ padding: '8px 10px' }}>ชื่อ</th>
              <th style={{ padding: '8px 10px' }}>ไลน์</th>
              <th style={{ padding: '8px 10px' }}>ทำไมระบบถึงเสนอ</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(c => (
              <tr key={c.id} style={{ borderTop: '1px solid var(--border)',
                                      background: picked.has(c.id) ? 'rgba(34,197,94,0.08)' : 'transparent' }}>
                <td style={{ padding: '6px 10px' }}>
                  <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)}
                         disabled={!canEdit} style={{ width: 'auto', cursor: canEdit ? 'pointer' : 'not-allowed' }} />
                </td>
                <td style={{ padding: '6px 10px', fontWeight: 700 }}>{c.machine_no}</td>
                <td style={{ padding: '6px 10px' }}>{c.machine_name || '—'}</td>
                <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>{c.line_name || '—'}</td>
                <td style={{ padding: '6px 10px' }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {c._reasons.map((r, i) => (
                      <span key={i} style={chip('rgba(59,130,246,0.12)', 'rgba(59,130,246,0.4)')}>{r}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5 }}>ตั้งเป็น:</span>
          <select value={kind} onChange={e => setKind(e.target.value)}
                  style={{ width: 200, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
                           background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}>
            {EQUIPMENT_KINDS.map(k => <option key={k.key} value={k.key}>{k.icon} {k.label}</option>)}
          </select>
          <button onClick={save} disabled={!picked.size || saving}
                  style={{ background: picked.size ? '#16a34a' : 'var(--bg2)', color: picked.size ? '#fff' : 'var(--muted)',
                           border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700,
                           cursor: picked.size && !saving ? 'pointer' : 'not-allowed' }}>
            {saving ? 'กำลังบันทึก…' : `บันทึก ${picked.size} รายการ`}
          </button>
        </div>
      )}
    </div>
  );
}
