/* ══════════════════════════════════════════════════════════════════════════
   🧩 <CustomerFileFormats> — ทะเบียน "ฟอร์แมตไฟล์ความต้องการของลูกค้า"  (2026-09-22)

   ที่มา (audit แผนผลิต 22/09 · user ยืนยัน): ความต้องการเข้าระบบได้แค่ 3 ทาง
   (EDI 830 · 862 · e-SMART) ซึ่งเป็นตระกูล Ford ทั้งหมด ⇒ วัดจริง **72 จาก 115 พาร์ท active
   ไม่มีความต้องการในระบบเลย** (TSRA 28 · TSPK 15 ที่เป็น FG ทั้งหมด · ISUZU RT50 · GWM · TSESA …)
   ⇒ 10 จาก 22 ไลน์หายจากแผนผลิต · ลูกค้าพวกนี้ส่ง Excel/CSV เหมือนกัน **แต่คนละหน้าตากับ Ford**

   เดิมชื่อหัวคอลัมน์ถูก hardcode ใน `src/utils/ediDetect.js` ⇒ ลูกค้าใหม่ = แก้โค้ด + deploy
   ตอนนี้: **เพิ่มแถวในทะเบียนนี้ = ระบบอ่านไฟล์เจ้านั้นออกทันที ไม่ต้อง deploy**

   ⚠️ ทำไมไม่ใช้ `<SimpleMasterPanel>`: alias อยู่ใน `col_map` (jsonb ซ้อน 1 ชั้น)
      ไม่ใช่คอลัมน์ระดับบนสุดที่ตัวนั้นเขียนได้ — ถ้าวันหน้ามีทะเบียน jsonb อีกหลายตัว
      ค่อยยกความสามารถนี้ขึ้นไปไว้ที่ SimpleMasterPanel แล้วให้ตัวนี้เรียกใช้

   ⚠️ alias ของ **ทุกแถวถูกรวมเป็นพจนานุกรมเดียว** ตอนอ่านไฟล์ (`buildEdiDict`)
      ⇒ ชื่อคอลัมน์ที่เพิ่มให้ลูกค้า A จะถูกยอมรับกับไฟล์ของลูกค้า B ด้วย
      (ตั้งใจ — ไฟล์ไม่ได้บอกว่าเป็นของใครจนกว่าจะอ่านคอลัมน์ ship-to ข้างใน)
      ⇒ **อย่าใส่ชื่อคอลัมน์กว้างๆ ที่แปลว่าคนละเรื่องในไฟล์เจ้าอื่น**
   ══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import { FALLBACK_EDI_DICT } from '../utils/ediDetect';

/* ช่องที่ระบบอ่านได้ — 3 ตัวแรกขาดไม่ได้ (ไม่มี = ประกอบความต้องการไม่ได้เลย) */
const FIELDS = [
  { key: 'part', label: 'เลขพาร์ท', required: true },
  { key: 'qty', label: 'จำนวน', required: true },
  { key: 'date', label: 'วันที่ส่ง', required: true },
  { key: 'time', label: 'เวลาส่ง', hint: 'มีคอลัมน์นี้ = ระบบตีว่าเป็นใบสั่งส่งรายวัน (862)' },
  { key: 'dock', label: 'ท่ารับของ (dock)' },
  { key: 'ship_to', label: 'รหัส/ชื่อ ship-to' },
  { key: 'po', label: 'เลข PO' },
];

const KINDS = [
  { value: 'order', label: '📦 ใบสั่งส่งรายวัน (เทียบเท่า 862)' },
  { value: 'forecast', label: '📅 แผนล่วงหน้า (เทียบเท่า 830)' },
];

const inp = { padding: '5px 8px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', width: '100%' };
const btn = (bg, color = '#fff') => ({ padding: '5px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', background: bg, color, border: '1px solid var(--border)', whiteSpace: 'nowrap' });

const toTags = (v) => (Array.isArray(v) ? v.join(', ') : '');
const fromTags = (v) => String(v ?? '').split(/[,|]/).map(s => s.trim()).filter(Boolean);

const blankDraft = () => ({
  code: '', name: '', customer_name: '', kind: 'order',
  col_map: Object.fromEntries(FIELDS.map(f => [f.key, ''])),
});

export default function CustomerFileFormats({ canManage, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null);      // แถวที่กำลังแก้ (null = ไม่ได้แก้อะไร)
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabaseDR.from('customer_pull_formats')
      .select('code, name, customer_name, kind, col_map, is_active, note')
      .in('kind', ['order', 'forecast']).order('kind').order('code');
    if (error) toast.error('โหลดทะเบียนฟอร์แมตไม่สำเร็จ — ระบบจะใช้ชื่อคอลัมน์ค่าสำรองในโค้ดแทน');
    setRows(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const startEdit = (r) => setDraft({
    code: r.code, name: r.name || '', customer_name: r.customer_name || '', kind: r.kind,
    col_map: Object.fromEntries(FIELDS.map(f => [f.key, toTags(r.col_map?.[f.key])])),
    _edit: true,
  });

  const save = async () => {
    const d = adding ? draft : draft;
    if (!d) return;
    const code = String(d.code || '').trim();
    if (!code) { toast.error('ต้องมีรหัสฟอร์แมต (เช่น tsra_order)'); return; }
    const missing = FIELDS.filter(f => f.required && !fromTags(d.col_map[f.key]).length);
    if (missing.length) {
      toast.error(`ต้องกรอกชื่อคอลัมน์ของ: ${missing.map(f => f.label).join(' · ')} — ขาดตัวใดตัวหนึ่งระบบอ่านไฟล์ไม่ได้`);
      return;
    }
    const col_map = {};
    FIELDS.forEach(f => { const a = fromTags(d.col_map[f.key]); if (a.length) col_map[f.key] = a; });
    const payload = {
      code, name: d.name?.trim() || code, customer_name: d.customer_name?.trim() || null,
      kind: d.kind, col_map, is_active: true,
    };
    setBusy(true);
    const res = d._edit
      ? await supabaseDR.from('customer_pull_formats').update(payload).eq('code', code).select('code')
      : await supabaseDR.from('customer_pull_formats').insert(payload).select('code');
    setBusy(false);
    if (!checkWrite(res, 'บันทึกฟอร์แมตไฟล์')) return;
    // RLS ปฏิเสธ UPDATE = สำเร็จ 0 แถว ไม่มี error → ต้องนับแถว ห้ามขึ้นเขียวจาก !error
    if (!res.data?.length) { toast.error('บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ — ได้ 0 แถว)'); return; }
    toast.success(d._edit ? 'อัปเดตฟอร์แมตแล้ว' : 'เพิ่มฟอร์แมตแล้ว — อัพไฟล์ของลูกค้าเจ้านี้ได้เลย');
    setDraft(null); setAdding(false);
    await load(); onChanged?.();
  };

  const toggleActive = async (r) => {
    if (r.is_active && !window.confirm(`ปิดใช้ "${r.name || r.code}"?\n\nไฟล์ของลูกค้าเจ้านี้จะอ่านไม่ออกจนกว่าจะเปิดกลับ (ข้อมูลที่นำเข้าไปแล้วไม่หาย)`)) return;
    const res = await supabaseDR.from('customer_pull_formats')
      .update({ is_active: !r.is_active }).eq('code', r.code).select('code');
    if (!checkWrite(res, 'เปลี่ยนสถานะฟอร์แมต')) return;
    if (!res.data?.length) { toast.error('เปลี่ยนสถานะไม่สำเร็จ (สิทธิ์ไม่พอ — ได้ 0 แถว)'); return; }
    await load(); onChanged?.();
  };

  const D = draft || {};
  const editing = adding || !!draft;

  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <b style={{ fontSize: 13 }}>🧩 ฟอร์แมตไฟล์ความต้องการของลูกค้า</b>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          ลูกค้าเจ้าใหม่ที่ส่งไฟล์คนละหน้าตา — เพิ่มที่นี่ ไม่ต้องแก้โปรแกรม
        </span>
        {canManage && !editing && (
          <button onClick={() => { setDraft(blankDraft()); setAdding(true); }} style={{ ...btn('var(--accent)'), marginLeft: 'auto' }}>+ เพิ่มฟอร์แมต</button>
        )}
      </div>

      {loading ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด…</div> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {rows.map(r => (
            <div key={r.code} style={{
              display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px',
              borderRadius: 6, background: 'var(--card)', border: '1px solid var(--border)',
              opacity: r.is_active ? 1 : 0.55,
            }}>
              <span style={{ fontSize: 11.5, fontFamily: 'monospace', color: 'var(--muted)', minWidth: 90 }}>{r.code}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{r.name || r.code}</span>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {r.customer_name || 'ไม่ระบุลูกค้า'} · {KINDS.find(k => k.value === r.kind)?.label || r.kind}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {FIELDS.filter(f => (r.col_map?.[f.key] || []).length).length}/{FIELDS.length} ช่อง
              </span>
              {!r.is_active && <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>ปิดใช้</span>}
              {canManage && !editing && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button onClick={() => startEdit(r)} style={btn('var(--bg2)', 'var(--text)')}>✎ แก้</button>
                  <button onClick={() => toggleActive(r)} style={btn('var(--bg2)', 'var(--text)')}>{r.is_active ? '⏸ ปิดใช้' : '▶ เปิดใช้'}</button>
                </span>
              )}
            </div>
          ))}
          {!rows.length && (
            <div style={{ fontSize: 12, color: '#f59e0b' }}>
              ⚠ ทะเบียนว่าง — ระบบใช้ชื่อคอลัมน์ค่าสำรองในโค้ด (อ่านไฟล์ Ford 830/862 ได้ตามเดิม)
            </div>
          )}
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'var(--card)', border: '1px solid var(--accent)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 8 }}>
            <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>รหัส (ห้ามซ้ำ)
              <input value={D.code || ''} disabled={D._edit} placeholder="tsra_order"
                onChange={e => setDraft({ ...D, code: e.target.value })} style={{ ...inp, fontFamily: 'monospace' }} />
            </label>
            <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>ชื่อที่แสดง
              <input value={D.name || ''} placeholder="ใบสั่งซื้อ TSRA"
                onChange={e => setDraft({ ...D, name: e.target.value })} style={inp} />
            </label>
            <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>ลูกค้า
              <input value={D.customer_name || ''} placeholder="TSRA"
                onChange={e => setDraft({ ...D, customer_name: e.target.value })} style={inp} />
            </label>
            <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>ชนิดไฟล์
              <select value={D.kind} onChange={e => setDraft({ ...D, kind: e.target.value })} style={inp}>
                {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </label>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
            ชื่อหัวคอลัมน์ในไฟล์ของลูกค้า — ใส่ได้หลายชื่อคั่นด้วยจุลภาค (ระบบเทียบแบบไม่สนตัวพิมพ์/เว้นวรรค/ขีด)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {FIELDS.map(f => (
              <label key={f.key} style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {f.label}{f.required && <span style={{ color: '#ef4444' }}> *</span>}
                <input value={D.col_map?.[f.key] || ''} placeholder={(FALLBACK_EDI_DICT[f.key] || []).slice(0, 2).join(', ')}
                  onChange={e => setDraft({ ...D, col_map: { ...D.col_map, [f.key]: e.target.value } })} style={inp} />
                {f.hint && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{f.hint}</div>}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button disabled={busy} onClick={save} style={btn('var(--accent)')}>{busy ? 'กำลังบันทึก…' : '💾 บันทึก'}</button>
            <button disabled={busy} onClick={() => { setDraft(null); setAdding(false); }} style={btn('var(--bg2)', 'var(--text)')}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
        💡 ชื่อคอลัมน์จากทุกแถวถูกรวมเป็นพจนานุกรมเดียวตอนอ่านไฟล์ — ระบบยังแยก "ใบส่ง" กับ "แผนล่วงหน้า"
        ด้วยสัญญาณในไฟล์เอง (มีคอลัมน์เวลา/ท่ารับ = ใบส่ง · ไม่มีและวันที่ยิงยาวข้ามปี = แผน) แล้วให้คนยืนยันก่อนนำเข้าเสมอ
      </div>
    </div>
  );
}
