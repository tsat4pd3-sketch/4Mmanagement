/**
 * 🎯 DeliveryPointPanel — จุดส่งงานหน้าไลน์ (แผงใน /linesetup · ลูปสโตร์เฟส 4 · 2026-09-03)
 *
 * ตอบ "ของจากสโตร์ต้องมาวางตรงไหนของไลน์นี้" — ตั้งจุด → พิมพ์ป้าย QR (ESM:D:<id>) ที่ /qr-labels
 * → สโตร์ยิงป้ายตอนวางของ = หมุดเวลา delivered_at + ด่านตรวจ "ส่งถูกจุดไหม" (docs/STORE-PULL-LOOP-DESIGN.md §4.5/§4.6)
 *
 * ⚠️ กฎของแผงนี้:
 *   1. **ไลน์ต้องเป็น leaf** (หน่วยย่อยที่สุด) — ไลน์แม่ที่มีลูก = แผนก ไม่ใช่จุดวางของ (user เคาะ 2026-08-31)
 *      เปิดที่ไลน์แม่ = ไม่ให้ตั้ง บอกให้ไปตั้งที่ไลน์ลูก
 *   2. **1 จุดหลายไลน์ได้** (แร็คเดียวป้อน Line 60+61) — `line_names text[]`
 *   3. ปิดใช้งาน/ลบ ต้องยืนยัน (UI-CONVENTIONS §5.4) · ลบไม่ได้ถ้ามีป้ายพิมพ์ไปแล้ว? — ระบบไม่รู้ว่าพิมพ์หรือยัง
 *      ⇒ **ไม่มีปุ่มลบ มีแต่ปิดใช้งาน** (ป้ายเก่าที่ยังติดอยู่หน้างานสแกนแล้วต้องได้คำตอบ "จุดนี้ปิดแล้ว" ไม่ใช่ "ไม่รู้จัก")
 *   4. ไม่ตั้ง = สโตร์ส่งได้แต่ตรวจไม่ได้ (gate `no_point`) — แผงฝั่งไลน์ (LinePartCallPanel) ขึ้น worklist ให้
 *
 * ตาราง: line_delivery_points (DR · anon) · สิทธิ์ `delivery_point:manage` · actor stamp ผ่าน DR_AUDIT_TABLES
 */
import { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { isLeafLine, getChildLineNames } from '../utils/lineHierarchy';
import ReadOnlyNote from './ReadOnlyNote';
import LineSelect from './LineSelect';

const inputSt = {
  width: '100%', padding: '8px 11px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)',
};
const btnSt = (bg, color, border = 'transparent') => ({
  padding: '7px 14px', borderRadius: 8, border: `1px solid ${border}`, background: bg, color,
  fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-body)',
});
const emptyForm = (lineName) => ({ id: null, code: '', name: '', line_names: lineName ? [lineName] : [], note: '', is_active: true });

export default function DeliveryPointPanel({ lineName, lines = [] }) {
  const { role, lineId, sections } = useContext(UserContext);
  const canManage = can('delivery_point', 'manage', role);

  const [open, setOpen]       = useState(false);
  const [rows, setRows]       = useState([]);
  const [missing, setMissing] = useState(false);   // ตารางยังไม่ apply migration (42P01) — บอกบนจอ ห้ามเงียบ
  const [loadErr, setLoadErr] = useState('');
  const [form, setForm]       = useState(null);    // null | form
  const [saving, setSaving]   = useState(false);
  const [addLine, setAddLine] = useState('');

  const isLeaf = useMemo(() => isLeafLine(lines, lineName), [lines, lineName]);
  const kids   = useMemo(() => getChildLineNames(lines, lineName), [lines, lineName]);
  // จุดส่งผูกได้เฉพาะไลน์ leaf — dropdown เพิ่มไลน์ต้องกรองไลน์แม่ออกตั้งแต่ต้น (กรอง dropdown ด้วย ไม่ใช่แค่ข้อมูล)
  const leafLines = useMemo(() => lines.filter(l => isLeafLine(lines, l.name)), [lines]);

  const load = useCallback(async () => {
    if (!lineName) return;
    setLoadErr('');
    const { data, error } = await supabaseDR.from('line_delivery_points').select('*')
      .contains('line_names', [lineName]).order('sort_order').order('name');
    if (error) {
      if (error.code === '42P01') { setMissing(true); setRows([]); return; }
      setLoadErr(error.message); return;
    }
    setMissing(false);
    setRows(data || []);
  }, [lineName]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { setForm(null); }, [lineName]);

  const active = rows.filter(r => r.is_active !== false);
  const inactive = rows.filter(r => r.is_active === false);

  const save = async () => {
    const name = (form.name || '').trim();
    const code = (form.code || '').trim().toUpperCase();
    const lineNames = [...new Set((form.line_names || []).map(s => String(s).trim()).filter(Boolean))];
    if (!name) { toast.error('ใส่ชื่อจุดส่ง (เช่น "จุดรับของหน้า OP10")'); return; }
    if (!lineNames.length) { toast.error('จุดส่งต้องผูกกับไลน์อย่างน้อย 1 ไลน์'); return; }
    const notLeaf = lineNames.filter(n => !isLeafLine(lines, n));
    if (notLeaf.length) { toast.error(`${notLeaf.join(', ')} เป็นไลน์แม่ (แผนก) — จุดส่งต้องผูกกับไลน์ย่อยที่สุดเท่านั้น`); return; }
    setSaving(true);
    const payload = { code: code || null, name, line_names: lineNames, note: (form.note || '').trim() || null, is_active: !!form.is_active };
    const q = form.id
      ? supabaseDR.from('line_delivery_points').update(payload).eq('id', form.id)
      : supabaseDR.from('line_delivery_points').insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) {
      // 23505 = รหัสสั้นซ้ำ (unique upper(code)) — บอกให้รู้ว่าชนกับใคร ไม่ใช่โยน SQL ใส่หน้า
      toast.error(error.code === '23505' ? `รหัส "${code}" ถูกใช้กับจุดส่งอื่นแล้ว — ตั้งรหัสอื่น` : error.message);
      return;
    }
    toast.success(form.id ? 'บันทึกจุดส่งแล้ว' : `เพิ่มจุดส่ง "${name}" แล้ว — อย่าลืมพิมพ์ป้าย QR ไปติดหน้างาน`);
    setForm(null);
    load();
  };

  const toggleActive = async (r) => {
    const turnOff = r.is_active !== false;
    // ปิดใช้งาน = ป้ายที่ติดอยู่หน้างานจะสแกนไม่ผ่านทันที → ต้องยืนยัน (§5.4) · เปิดกลับ = additive ไม่ถาม
    if (turnOff && !window.confirm(`ปิดใช้งานจุดส่ง "${r.name}" ?\n\nป้าย QR ที่ติดอยู่หน้างานจะสแกนแล้วขึ้น "จุดนี้ปิดแล้ว" — สโตร์ส่งของที่จุดนี้ไม่ผ่านด่าน`)) return;
    const { error } = await supabaseDR.from('line_delivery_points').update({ is_active: !turnOff }).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  if (!lineName) return null;

  const box = { marginTop: 16, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' };

  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setOpen(v => !v)} className="tbtn"
          style={{ background: 'none', border: 'none', color: 'var(--text)', fontSize: 14, fontWeight: 800, cursor: 'pointer', padding: 0 }}>
          {open ? '▾' : '▸'} 🎯 จุดส่งงานหน้าไลน์
          {open && rows.length > 0 && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>{active.length} จุด{inactive.length ? ` · ปิดแล้ว ${inactive.length}` : ''}</span>}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ป้าย QR ที่สโตร์สแกนตอนวางของถึงไลน์ (ลูปเรียกชิ้นส่วนขั้น 7)</span>
        {open && canManage && isLeaf && !form && !missing && (
          <button onClick={() => setForm(emptyForm(lineName))} style={{ ...btnSt('var(--accent)', '#08130c'), marginLeft: 'auto' }}>+ เพิ่มจุดส่ง</button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <ReadOnlyNote show={!canManage} role={role} what="ตั้งจุดส่งงานของไลน์" permKey="delivery_point:manage" compact />

          {missing && (
            <div style={{ fontSize: 12.5, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '8px 12px' }}>
              ⚠️ ยังไม่ได้ apply migration <code>20260903_line_delivery_points.sql</code> (DR) — ตั้งจุดส่งยังไม่ได้ แจ้ง admin
            </div>
          )}
          {loadErr && <div style={{ fontSize: 12.5, color: '#ef4444' }}>โหลดจุดส่งไม่สำเร็จ: {loadErr}</div>}

          {/* ไลน์แม่ที่มีลูก = แผนก ไม่ใช่จุดวางของ — ไม่ให้ตั้ง บอกทางไป */}
          {!isLeaf && !missing && (
            <div style={{ fontSize: 12.5, color: 'var(--text2)', background: 'var(--bg3)', border: '1px dashed var(--border2)', borderRadius: 8, padding: '8px 12px' }}>
              🏢 <b>{lineName}</b> เป็นไลน์แม่ (มีไลน์ย่อย {kids.length} ไลน์) — ของถูกส่งเข้าไลน์ย่อยเสมอ ให้ตั้งจุดส่งที่ไลน์ย่อยแทน:
              <span style={{ marginLeft: 6 }}>{kids.join(' · ')}</span>
            </div>
          )}

          {isLeaf && !missing && rows.length === 0 && !form && (
            <div style={{ fontSize: 12.5, color: '#f59e0b' }}>
              ⚠️ ไลน์นี้ยังไม่มีจุดส่งงาน — สโตร์กด "จัดส่งแล้ว" ได้แต่ระบบ<b>ตรวจไม่ได้</b>ว่าวางถูกจุดไหม (ใบจะถูกมาร์ก "ไลน์ยังไม่ตั้งจุดส่ง")
            </div>
          )}

          {rows.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px,100%), 1fr))', gap: 8, alignContent: 'start', marginTop: 8 }}>
              {rows.map(r => {
                const off = r.is_active === false;
                const others = (Array.isArray(r.line_names) ? r.line_names : []).filter(n => n !== lineName);
                return (
                  <div key={r.id} style={{ border: `1px solid ${off ? 'var(--border)' : 'rgba(34,197,94,0.35)'}`, borderRadius: 10, padding: '9px 12px', background: off ? 'var(--bg3)' : 'var(--bg2)', opacity: off ? 0.7 : 1 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      {r.code && <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: off ? 'var(--muted)' : '#22c55e' }}>{r.code}</span>}
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: '1 1 120px' }}>{r.name}</span>
                      {off && <span style={{ fontSize: 11, color: 'var(--muted)' }}>⏸ ปิดใช้งาน</span>}
                    </div>
                    {others.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>🔀 ใช้ร่วมกับ {others.join(' · ')}</div>}
                    {r.note && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{r.note}</div>}
                    {canManage && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => setForm({ id: r.id, code: r.code || '', name: r.name || '', line_names: Array.isArray(r.line_names) ? r.line_names : [lineName], note: r.note || '', is_active: r.is_active !== false })}
                          style={btnSt('var(--bg3)', 'var(--text)', 'var(--border2)')}>✏️ แก้</button>
                        <button onClick={() => toggleActive(r)} style={btnSt('transparent', off ? '#22c55e' : '#f59e0b', off ? 'rgba(34,197,94,0.5)' : 'rgba(245,158,11,0.5)')}>
                          {off ? '▶ เปิดใช้งาน' : '⏸ ปิดใช้งาน'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {active.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 10 }}>
              🖨️ พิมพ์ป้าย QR ไปติดหน้างานที่ <Link to="/qr-labels?kind=delivery" style={{ color: 'var(--accent)', fontWeight: 700 }}>พิมพ์ป้าย QR → 🎯 จุดส่งงาน</Link>
            </div>
          )}

          {/* ฟอร์มเพิ่ม/แก้ — draft + ปุ่มบันทึก (§5.4) */}
          {form && (
            <div style={{ marginTop: 12, border: '1px solid var(--border2)', borderRadius: 10, padding: 12, background: 'var(--bg3)' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>{form.id ? '✏️ แก้จุดส่ง' : '+ จุดส่งใหม่'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px,100%), 1fr))', gap: 10, alignItems: 'start' }}>
                <label style={{ fontSize: 12, color: 'var(--text2)' }}>ชื่อจุด *
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder='เช่น "จุดรับของหน้า OP10"' style={inputSt} />
                </label>
                <label style={{ fontSize: 12, color: 'var(--text2)' }}>รหัสสั้นบนป้าย (ให้คนอ่าน/พิมพ์มือ)
                  <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="เช่น DP-60A" style={{ ...inputSt, fontFamily: 'monospace' }} />
                </label>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text2)' }}>ไลน์ที่รับของที่จุดนี้ (ไลน์ย่อยที่สุดเท่านั้น · จุดเดียวใช้หลายไลน์ได้)</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 5 }}>
                {(form.line_names || []).map(n => (
                  <span key={n} style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 12, background: 'rgba(59,130,246,0.12)', color: '#3b82f6', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {n}
                    {(form.line_names || []).length > 1 && (
                      <button onClick={() => setForm(f => ({ ...f, line_names: f.line_names.filter(x => x !== n) }))} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}>✕</button>
                    )}
                  </span>
                ))}
                <LineSelect lines={leafLines.filter(l => !(form.line_names || []).includes(l.name))} value={addLine}
                  onChange={(v) => { if (v) setForm(f => ({ ...f, line_names: [...(f.line_names || []), v] })); setAddLine(''); }}
                  placeholder="+ เพิ่มไลน์ที่ใช้จุดนี้ร่วม" role={role} lineId={lineId} sections={sections}
                  style={{ width: 240, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12.5 }} />
              </div>
              <label style={{ display: 'block', marginTop: 10, fontSize: 12, color: 'var(--text2)' }}>หมายเหตุ (ตำแหน่งจริง เช่น "ข้างเสา C4 ฝั่งซ้ายของสายพาน")
                <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inputSt} />
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <button onClick={() => setForm(null)} disabled={saving} style={btnSt('transparent', 'var(--muted)', 'var(--border2)')}>ยกเลิก</button>
                <button onClick={save} disabled={saving} style={btnSt('var(--accent)', '#08130c')}>{saving ? 'กำลังบันทึก…' : '💾 บันทึก'}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
