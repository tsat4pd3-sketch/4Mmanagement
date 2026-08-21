/* ═══ 🔀 ย้ายมินิสโตร์จาก "ไลน์แม่" ไป "ไลน์ลูก" ═══════════════════════════════
   (2026-08-21 · คำสั่ง user: "ไลน์แม่จะเป็นเหมือนแค่แผนกใหญ่ แต่งานจะอยู่ไลน์ลูกหมด")

   ปัญหาที่แก้ — backflush ไม่เคยทำงาน:
     `fn_explode_child_demand` หักมินิสโตร์ด้วย **ชื่อไลน์ที่เปิดกะ** (= ไลน์ลูก)
     แต่ Store จ่ายพาร์ทเข้า **ไลน์แม่** (LINE APRON ASSY) → หากันไม่เจอ
     ⇒ consume = 0 ตลอด (ledger จริง: issue 5,908 แถว : consume 40 แถว)
     ยอดมินิสโตร์ไม่เคยลด · ความต้องการไหลเข้า accumulator ทั้งก้อนทั้งที่ของอยู่หน้าไลน์แล้ว

   ⚠️ ระบบ "เสนอ" ปลายทาง คนกด "ย้าย" เอง — ห้ามย้ายอัตโนมัติ
      ข้อมูลจริง 31 พาร์ทที่ค้างบนไลน์แม่: 22 ตัวชี้ไลน์ลูกเดียวชัดเจน · **9 ตัวใช้หลายไลน์ลูก**
      (แร็คเดียวป้อนทั้ง Line 60 + Line 61 จริง) — เดาแล้วหักสต็อกผิดตัว ย้อนยาก

   วิธีย้าย: เขียน 2 แถวใน ledger (ไม่ลบของเก่า ไม่แก้ย้อนหลัง)
     ไลน์แม่  : issue qty ติดลบ  → ยอดลด
     ไลน์ลูก : issue qty บวก     → ยอดเพิ่ม
   ทั้งคู่ note เดียวกัน จึงย้อนดูได้ว่าใครย้ายอะไรเมื่อไหร่ (และย้ายกลับได้ด้วยวิธีเดียวกัน)
   ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';

const th = { padding: '7px 10px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '6px 10px', fontSize: 12, color: 'var(--text)', borderTop: '1px solid var(--border)' };
const inp = { padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12 };

/**
 * @param lines       production_lines (ต้องมี name, parent_line_name)
 * @param stock       line_stock_summary rows
 * @param products    dr_products [{id, mat_no, line_name}]
 * @param productBom  { product_id: [{mat_no}] }
 * @param workDate    วันงานปัจจุบัน
 */
export default function StockMoveToChild({ lines, stock, products, productBom, canIssue, fullName, workDate, onDone }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState({});     // mat_no → { to, qty }
  const [busy, setBusy] = useState('');

  // ไลน์ที่ "มีลูก" = ระดับแผนก — งานจริงอยู่ไลน์ลูก จึงไม่ควรมีมินิสโตร์ค้างอยู่
  const childrenOf = useMemo(() => {
    const m = {};
    (lines || []).forEach(l => { if (l.parent_line_name) (m[l.parent_line_name] ||= []).push(l.name); });
    return m;
  }, [lines]);

  // child mat → ไลน์ลูกที่ใช้จริง (จาก BOM ของ FG × ไลน์ที่ผลิต FG นั้น)
  const suggestFor = useMemo(() => {
    const byId = {}; (products || []).forEach(p => { byId[p.id] = p; });
    const m = {};
    Object.entries(productBom || {}).forEach(([pid, kids]) => {
      const ln = byId[pid]?.line_name;
      if (!ln || childrenOf[ln]) return;      // ข้ามไลน์แม่ — ปลายทางต้องเป็นไลน์ลูกเท่านั้น
      kids.forEach(k => { (m[k.mat_no] ||= new Set()).add(ln); });
    });
    return m;
  }, [products, productBom, childrenOf]);

  const rows = useMemo(() => (stock || [])
    .filter(s => childrenOf[s.line_name] && Math.abs(parseFloat(s.qty_on_hand) || 0) > 0)
    .map(s => {
      const all = [...(suggestFor[s.mat_no] || [])];
      // เสนอเฉพาะไลน์ลูกของไลน์แม่ตัวนี้ — ของไลน์แม่อื่นไม่เกี่ยว
      const opts = all.filter(n => childrenOf[s.line_name].includes(n));
      return { ...s, qty: parseFloat(s.qty_on_hand) || 0, opts: opts.length ? opts : childrenOf[s.line_name] , sure: opts.length === 1 };
    })
    .sort((a, b) => (b.sure - a.sure) || (b.qty - a.qty)), [stock, childrenOf, suggestFor]);

  if (!rows.length) return null;
  const sureCount = rows.filter(r => r.sure).length;

  const move = async (r) => {
    const to = pick[r.mat_no]?.to || (r.sure ? r.opts[0] : '');
    const qty = Number(pick[r.mat_no]?.qty ?? r.qty);
    if (!to) { toast.error('เลือกไลน์ลูกปลายทางก่อน'); return; }
    if (!(qty > 0)) { toast.error('จำนวนต้องมากกว่า 0'); return; }
    if (qty > r.qty && !window.confirm(`ย้าย ${qty.toLocaleString()} ชิ้น มากกว่าคงเหลือ ${r.qty.toLocaleString()} — ยอดที่ ${r.line_name} จะติดลบ\nยืนยัน?`)) return;
    if (!window.confirm(`ย้าย ${r.mat_no} จำนวน ${qty.toLocaleString()} ชิ้น\n${r.line_name} → ${to} ?`)) return;

    setBusy(r.mat_no);
    const note = `ย้ายมินิสโตร์: ${r.line_name} → ${to}`;
    const base = { mat_no: r.mat_no, part_name: r.part_name || null, type: 'issue', status: 'approved',
      work_date: workDate, note, created_by: fullName || 'ย้ายมินิสโตร์' };
    // ⚠️ นับแถวที่เขียนจริง — RLS ปฏิเสธ insert จะ error แต่ 0 แถวก็ต้องไม่ขึ้นว่าสำเร็จ
    const { data, error } = await supabaseDR.from('line_stock_transactions').insert([
      { ...base, line_name: r.line_name, qty: -qty },   // ออกจากไลน์แม่ (issue ติดลบ = หักออก)
      { ...base, line_name: to, qty },                  // เข้าไลน์ลูก
    ]).select('id');
    setBusy('');
    if (error) { toast.error(error.message); return; }
    if ((data?.length || 0) < 2) { toast.error('เขียนไม่ครบ 2 แถว — ตรวจสิทธิ์แล้วลองใหม่'); return; }
    toast.success(`✓ ย้าย ${r.mat_no} → ${to} แล้ว`);
    onDone?.();
  };

  return (
    <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>
          {open ? '▼' : '▶'} 🔀 มีสต๊อกค้างอยู่ที่ “ไลน์แม่” {rows.length} พาร์ท — ระบบหักตอนผลิตไม่ได้
        </span>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
          ชี้ไลน์ลูกชัดเจน {sureCount} · ต้องเลือกเอง {rows.length - sureCount}
        </span>
      </div>

      {open && (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7, margin: '8px 0 10px' }}>
            ไลน์แม่ (เช่น <b>LINE APRON ASSY</b>) เป็น<b>ระดับแผนก</b> — งานผลิตจริงเปิดกะที่ไลน์ลูก (Line 60 / Line 61 / SUB APRON)
            ระบบหักพาร์ทตอนปิดใบผลิตด้วย<b>ชื่อไลน์ที่เปิดกะ</b> จึงหาของที่ฝากไว้ที่ไลน์แม่ไม่เจอ → ยอดมินิสโตร์ไม่เคยลด
            <br />ปลายทางที่เสนอมาจาก <b>BOM ของ FG × ไลน์ที่ผลิต FG นั้น</b> — เป็นการ<b>เสนอ ไม่ใช่ข้อสรุป</b>
            พาร์ทที่ใช้หลายไลน์ (แร็คเดียวป้อน 2 ไลน์) ต้องเลือก/แบ่งเอง
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead><tr style={{ background: 'var(--bg2)', position: 'sticky', top: 0 }}>
                <th style={th}>MAT</th><th style={th}>ชื่อพาร์ท</th><th style={{ ...th, textAlign: 'right' }}>คงเหลือ</th>
                <th style={th}>อยู่ที่ (ไลน์แม่)</th><th style={th}>ย้ายไป (ไลน์ลูก)</th>
                <th style={{ ...th, textAlign: 'right' }}>จำนวน</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const sel = pick[r.mat_no]?.to ?? (r.sure ? r.opts[0] : '');
                  return (
                    <tr key={`${r.line_name}|${r.mat_no}`}>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9' }}>{r.mat_no}</td>
                      <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.part_name || '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{r.qty.toLocaleString()}</td>
                      <td style={{ ...td, color: 'var(--muted)' }}>{r.line_name}</td>
                      <td style={td}>
                        <select value={sel} disabled={!canIssue} style={{ ...inp, width: 150 }}
                          onChange={e => setPick(p => ({ ...p, [r.mat_no]: { ...p[r.mat_no], to: e.target.value } }))}>
                          <option value="">— เลือก —</option>
                          {r.opts.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                        {!r.sure && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>⚠ ใช้หลายไลน์ — เลือกเอง</div>}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <input type="number" disabled={!canIssue} style={{ ...inp, width: 90, textAlign: 'right' }}
                          value={pick[r.mat_no]?.qty ?? r.qty}
                          onChange={e => setPick(p => ({ ...p, [r.mat_no]: { ...p[r.mat_no], qty: e.target.value } }))} />
                      </td>
                      <td style={td}>
                        <button disabled={!canIssue || busy === r.mat_no} onClick={() => move(r)}
                          style={{ padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700,
                            background: canIssue ? '#f59e0b' : 'var(--muted)', color: '#fff', cursor: canIssue ? 'pointer' : 'not-allowed' }}>
                          {busy === r.mat_no ? '...' : '🔀 ย้าย'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!canIssue && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>🔒 ต้องมีสิทธิ์ <b>จ่ายพาร์ทเข้าไลน์</b> (line_stock:issue) ถึงจะย้ายได้</div>}
        </>
      )}
    </div>
  );
}
