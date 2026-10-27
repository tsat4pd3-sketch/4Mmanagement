/* ══ QaMoPending — "ใบซ่อมที่รอ QA ตรวจหลังซ่อม" ในหน้า /qa (2026-10-22) ═══════════════════
   ที่มา (คำสั่ง user 21/10 · *"ตอนนี้ QA จะรู้ได้ยังไงว่ามี MO ที่ค้างรอ QA อนุมัติกี่ใบ"*):
   ใบรอ QA มีจริง **92 ใบ เก่าสุด 36 วัน** (วัด 22/10) แต่หน้า `/qa` ทั้ง 9 แท็บ **ไม่มีที่ไหนพูดถึงใบซ่อมเลย**
   ทางเดียวที่เห็นคือบรรทัดสรุปในแผง 📌 คิวงานของฉัน ชั้น "ค้างทั้งโรงงาน" ซึ่งคนทำ QA ไม่ได้เปิดทุกวัน
   (และตัวเลขนั้นเคยต่ำกว่าจริงเพราะชุดข้อมูลถูกตัดที่ 300 แถว — แก้แล้วในคอมมิทเดียวกัน)

   🔴 **"ใบนี้รอ QA ไหม" ตัดสินด้วย `moWaitMeta()` เท่านั้น ห้ามเช็ค `status === 'qa'`**
      ขั้นที่รออยู่ขึ้นกับ **ฟอร์ม** (ขั้น 5 = QA ของ JIG/DIE แต่ = รับมอบ ของ MTN) และ **ด่านอนุมัติ**
      ⇒ เทียบสถานะดิบ = ลากใบ MTN ที่ลูปไม่มี QA เข้ามาด้วย (กฎเหล็ก CLAUDE.md §MTN Work-Order)
   🔴 ไม่กรองขอบเขตส่วนงาน — QA ตรวจทั้งโรงงาน · แต่โชว์ส่วนงานในแถวให้แยกเองได้
   🔴 อ่านไม่ได้ = เขียนบนจอ **ห้ามโชว์ 0** · ชนเพดานคิวรี = บอกว่า "อย่างน้อย"
      (ลิสต์ว่าง 2 ความหมาย · กฎเหล็กข้อ 12) */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabaseDR } from '../supabaseClient';
import { OPEN_MO_STATUSES, moWaitMeta } from '../utils/mtnStepPerm';
import { ageDays, OLD_DAYS } from '../utils/myQueue';
import SearchInput from './SearchInput';

/* เพดานต่อคิวรีของ PostgREST (กฎเหล็กข้อ 5) — ได้ครบพอดี = อาจมีมากกว่านี้ ⇒ ต้องเขียนบอก */
const LIMIT = 1000;
const COLS = [
  'id', 'mo_no', 'work_date', 'status', 'dept_section', 'line_name', 'machine_no',
  'item_type', 'problem_detail',
  // ต้องครบพอให้ moWaitMeta() ตัดสินขั้นที่รออยู่ — ขาดช่องใดช่องหนึ่ง = กองเพี้ยนเงียบ
  'mtn_dept', 'qa_skipped_at', 'purpose', 'mtn_head_at', 'approve_at',
  'dept_manager_at', 'plant_manager_at',
].join(', ');

const card = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
  padding: 14, marginBottom: 14, boxShadow: 'var(--shadow-sm)',
};

export default function QaMoPending() {
  const [rows, setRows] = useState(null);     // null = ยังไม่รู้ (โหลด/ล้ม) · [] = รู้แล้วว่าไม่มี
  const [fail, setFail] = useState(null);
  const [capped, setCapped] = useState(false);
  const [busy, setBusy] = useState(true);
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    let alive = true;                          // กัน stale-response (กฎเหล็กข้อ 4)
    setBusy(true);
    supabaseDR.from('mtn_orders').select(COLS)
      .in('status', OPEN_MO_STATUSES)
      .order('work_date', { ascending: true })
      .limit(LIMIT)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setFail(error.message || 'อ่านข้อมูลไม่สำเร็จ'); setRows(null); }
        else {
          setFail(null);
          setCapped((data || []).length >= LIMIT);
          /* กรองด้วยกติกาเดียวกับทั้งระบบ — ห้ามเทียบ status ดิบ */
          setRows((data || []).filter(o => moWaitMeta(o).stage === 'qa'));
        }
        setBusy(false);
      });
    return () => { alive = false; };
  }, []);
  useEffect(() => load(), [load]);

  const view = useMemo(() => {
    if (!rows) return null;
    const s = q.trim().toLowerCase();
    const list = !s ? rows : rows.filter(r => [r.mo_no, r.line_name, r.machine_no, r.item_type, r.dept_section]
      .some(v => String(v || '').toLowerCase().includes(s)));
    const withAge = list.map(r => ({ ...r, age: ageDays(r.work_date) }));
    withAge.sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
    const oldest = withAge.reduce((m, r) => (r.age != null && (m == null || r.age > m) ? r.age : m), null);
    const noSection = rows.filter(r => !String(r.dept_section || '').trim()).length;
    return { list: withAge, oldest, noSection, over: withAge.filter(r => (r.age ?? 0) >= OLD_DAYS).length };
  }, [rows, q]);

  return (
    <div>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>🔧 ใบซ่อมที่รอ QA ตรวจหลังซ่อม</span>
          <button onClick={load} disabled={busy}
            style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none',
                     cursor: busy ? 'default' : 'pointer', padding: 0, textDecoration: 'underline' }}>
            {busy ? 'กำลังโหลด…' : 'โหลดใหม่'}
          </button>
          <div style={{ marginLeft: 'auto', minWidth: 190 }}>
            <SearchInput value={q} onChange={setQ} fields="เลข MO / ไลน์ / เครื่อง / อุปกรณ์" />
          </div>
        </div>

        {/* อ่านไม่ได้ = เขียนบนจอ ห้ามปล่อยให้เข้าใจว่า "ไม่มีงาน" */}
        {fail && (
          <div style={{ fontSize: 12, color: 'var(--accent2)', marginTop: 8, lineHeight: 1.6 }}>
            ⚠️ อ่านรายการใบซ่อมไม่สำเร็จ: {fail}<br />
            <span style={{ color: 'var(--muted)' }}>ยังไม่ทราบว่ามีใบรอตรวจกี่ใบ — ไม่ใช่ว่าไม่มี</span>
          </div>
        )}
        {busy && !fail && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>กำลังอ่านข้อมูล…</div>}

        {!busy && !fail && view && (
          <div style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7 }}>
            {rows.length === 0 ? (
              <span style={{ color: 'var(--accent)' }}>✅ ไม่มีใบซ่อมรอ QA ตรวจ</span>
            ) : (
              <>
                <b style={{ fontSize: 15 }}>{rows.length.toLocaleString()} ใบ</b> รอตรวจ
                {capped && <span style={{ color: 'var(--accent2)' }}> (อย่างน้อย — ชนเพดานคิวรี นับได้ไม่ครบ)</span>}
                {view.oldest != null && <> · เก่าสุด <b style={{ color: view.oldest >= OLD_DAYS ? 'var(--accent2)' : 'inherit' }}>{view.oldest} วัน</b></>}
                {view.over > 0 && <> · ค้างเกิน {OLD_DAYS} วัน <b style={{ color: 'var(--accent2)' }}>{view.over} ใบ</b></>}
                {q.trim() && <> · ตรงคำค้น {view.list.length.toLocaleString()} ใบ</>}
                {view.noSection > 0 && (
                  <div style={{ color: 'var(--accent2)', fontSize: 11.5 }}>
                    ⚠️ ในนั้น <b>{view.noSection}</b> ใบไม่ระบุส่วนงาน — ไม่เข้าคิวของหน่วยงานไหนเลย
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {!busy && !fail && view && view.list.length > 0 && (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg2)', textAlign: 'left' }}>
                {['เลข MO', 'วันที่แจ้ง', 'ค้าง', 'ส่วนงาน', 'ไลน์ / เครื่อง', 'อุปกรณ์', 'อาการ'].map(h => (
                  <th key={h} style={{ padding: '7px 9px', fontWeight: 800, whiteSpace: 'nowrap',
                                       borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.list.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 9px', whiteSpace: 'nowrap' }}>
                    <Link to={`/mtn-repair?mo=${encodeURIComponent(r.id)}`}
                      style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>
                      {r.mo_no || '(ยังไม่มีเลข)'}
                    </Link>
                  </td>
                  <td style={{ padding: '6px 9px', whiteSpace: 'nowrap' }}>{r.work_date || '—'}</td>
                  <td style={{ padding: '6px 9px', whiteSpace: 'nowrap',
                               color: (r.age ?? 0) >= OLD_DAYS ? 'var(--accent2)' : 'inherit',
                               fontWeight: (r.age ?? 0) >= OLD_DAYS ? 800 : 400 }}>
                    {r.age == null ? '—' : `${r.age} วัน`}
                  </td>
                  <td style={{ padding: '6px 9px', whiteSpace: 'nowrap' }}>
                    {String(r.dept_section || '').trim() || <span style={{ color: 'var(--accent2)' }}>ไม่ระบุ</span>}
                  </td>
                  <td style={{ padding: '6px 9px' }}>{[r.line_name, r.machine_no].filter(Boolean).join(' / ') || '—'}</td>
                  <td style={{ padding: '6px 9px' }}>{r.item_type || '—'}</td>
                  <td style={{ padding: '6px 9px', maxWidth: 320 }}>{r.problem_detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
