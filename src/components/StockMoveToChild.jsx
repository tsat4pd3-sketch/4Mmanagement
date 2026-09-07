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
import { moveTargets } from '../utils/moveTargets';
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

  const typeOf = useMemo(() => {
    const m = {}; (lines || []).forEach(l => { m[l.name] = l.line_type || null; });
    return m;
  }, [lines]);

  // ไลน์ปลายทางที่เป็นไปได้ทั้งโรงงาน = ไลน์ที่ไม่มีลูก (ของอยู่ที่หน่วยย่อยที่สุดเสมอ)
  const allLeaf = useMemo(() =>
    (lines || []).filter(l => l.is_active !== false && !childrenOf[l.name]).map(l => l.name),
    [lines, childrenOf]);

  // mat → ไลน์ที่ผลิตพาร์ทนั้นเอง (ใช้ตอน BOM ช่วยไม่ได้ เช่นงาน blank)
  const madeAt = useMemo(() => {
    const m = {}; (products || []).forEach(p => { if (p.mat_no && p.line_name) m[p.mat_no] = p.line_name; });
    return m;
  }, [products]);

  const rows = useMemo(() => (stock || [])
    .filter(s => childrenOf[s.line_name] && Math.abs(parseFloat(s.qty_on_hand) || 0) > 0)
    .map(s => {
      /* 🔴 ปลายทางมาจาก moveTargets — เสนอลำดับ ไม่ตัดตัวเลือกทิ้ง (ดูเหตุผลในไฟล์นั้น)
         เดิมเสนอจาก BOM ได้ตัวเดียวแล้ว "ตัดไลน์ลูกที่เหลือทิ้ง" → เลือกตัวที่ถูกไม่ได้เลย
         (เคสจริง: coil ที่ HYDROFORM มีให้เลือกแค่ LASER-789 · HDF1/HDF2 หายจาก dropdown) */
      const t = moveTargets(s.mat_no, {
        at: s.line_name, partName: s.part_name, childrenOf, typeOf,
        usedAt: [...(suggestFor[s.mat_no] || [])], madeAt: madeAt[s.mat_no] || null, allLeaf,
      });
      // คีย์ต้องรวมชื่อไลน์ — mat เดียวค้างได้หลายไลน์แม่พร้อมกัน (50031601 อยู่ทั้ง HYDROFORM และ APRON ASSY)
      return { ...s, key: `${s.line_name}|${s.mat_no}`, qty: parseFloat(s.qty_on_hand) || 0, ...t };
    })
    .sort((a, b) => (b.sure - a.sure) || (b.qty - a.qty)),
    [stock, childrenOf, suggestFor, typeOf, madeAt, allLeaf]);

  if (!rows.length) return null;
  const sureCount = rows.filter(r => r.sure).length;
  const wrongDept = rows.filter(r => r.warn).length;   // วัตถุดิบ/blank ค้างในแผนกที่ไม่มีไลน์ขึ้นรูป

  const move = async (r) => {
    const to = pick[r.key]?.to || r.best || '';
    const qty = Number(pick[r.key]?.qty ?? r.qty);
    if (!to) { toast.error('เลือกไลน์ปลายทางก่อน'); return; }
    if (!(qty > 0)) { toast.error('จำนวนต้องมากกว่า 0'); return; }
    if (qty > r.qty && !window.confirm(`ย้าย ${qty.toLocaleString()} ชิ้น มากกว่าคงเหลือ ${r.qty.toLocaleString()} — ยอดที่ ${r.line_name} จะติดลบ\nยืนยัน?`)) return;
    /* 🔴 เลือกปลายทางที่ยัง "ไม่ผ่านขั้นขึ้นรูป" ทั้งที่ของเป็นวัตถุดิบ/blank = ถามยืนยันอีกชั้น
       เตือนดัง ไม่บล็อก — บางไลน์ปั๊ม+ประกอบรวมกันจริง และ line_type อาจยังไม่ได้ตั้ง */
    const g = r.groups.find(x => x.lines.includes(to));
    if (r.needsForming && (g?.key === 'bom' || g?.key === 'rest')
      && !window.confirm(`🔴 ปลายทางนี้ไม่ใช่ไลน์ขึ้นรูป\n\n${r.mat_no} เป็นวัตถุดิบ/งาน blank — ตาม pattern ต้องขึ้นรูปก่อน แล้วค่อยส่งเข้าขั้นถัดไป\n\n→ ${to}\n\nยืนยันว่าถูกต้องจริง?`)) return;
    // ข้ามแผนก = ของอยู่ผิดแผนก ไม่ใช่แค่ผิดชั้น — ต้องยืนยันแยก
    const cross = !(childrenOf[r.line_name] || []).includes(to);
    if (cross && !window.confirm(`⚠️ ย้ายข้ามแผนก\n\n${r.line_name} → ${to}\n\n${to} ไม่ใช่ไลน์ลูกของ ${r.line_name}\nยืนยันว่าของอยู่ผิดแผนกจริง?`)) return;
    if (!window.confirm(`ย้าย ${r.mat_no} จำนวน ${qty.toLocaleString()} ชิ้น\n${r.line_name} → ${to} ?`)) return;

    setBusy(r.key);
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
          ชี้ปลายทางชัดเจน {sureCount} · ต้องเลือกเอง {rows.length - sureCount}
          {wrongDept > 0 && <b style={{ color: '#ef4444' }}> · 🔴 อยู่ผิดแผนก {wrongDept}</b>}
        </span>
      </div>

      {open && (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7, margin: '8px 0 10px' }}>
            ไลน์แม่ (เช่น <b>LINE APRON ASSY</b>) เป็น<b>ระดับแผนก</b> — งานผลิตจริงเปิดกะที่ไลน์ลูก (Line 60 / Line 61 / SUB APRON)
            ระบบหักพาร์ทตอนปิดใบผลิตด้วย<b>ชื่อไลน์ที่เปิดกะ</b> จึงหาของที่ฝากไว้ที่ไลน์แม่ไม่เจอ → ยอดมินิสโตร์ไม่เคยลด
            <br />ปลายทางเป็นการ <b>เสนอลำดับ ไม่ใช่ข้อสรุป</b> — dropdown แสดง<b>ทุกไลน์ที่เป็นไปได้</b> พร้อมเหตุผลของแต่ละกลุ่ม
            (BOM ชี้ / ไลน์ขึ้นรูป / ไลน์ที่ผลิตพาร์ทนี้) พาร์ทที่ใช้หลายไลน์ต้องเลือก/แบ่งเอง
            <br />⚠️ <b>วัตถุดิบ (5xx) และงาน blank ต้องเข้าไลน์ขึ้นรูปก่อนเสมอ</b> — BOM ในระบบ&ldquo;แบน&rdquo; (5xx ผูกใต้ FG โดยตรง)
            และชั้น OP ไม่อยู่ใน BOM ⇒ BOM จะชี้ไป<b>ขั้นถัดไป</b> (เลเซอร์/ประกอบ) ไม่ใช่ที่รับวัตถุดิบ
            {wrongDept > 0 && (
              <><br /><b style={{ color: '#ef4444' }}>🔴 {wrongDept} รายการอยู่ผิดแผนก</b> — แผนกที่ของค้างอยู่ไม่มีไลน์ขึ้นรูปเลย
              ระบบจึงเสนอไลน์ขึ้นรูปของแผนกอื่นให้ (ย้ายข้ามแผนกต้องยืนยันอีกชั้น)</>
            )}
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
                  const sel = pick[r.key]?.to ?? (r.best || '');
                  const hint = r.groups.find(g => g.lines.includes(sel));
                  return (
                    <tr key={r.key}>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9' }}>{r.mat_no}</td>
                      <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.part_name || ''}>{r.part_name || '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{r.qty.toLocaleString()}</td>
                      <td style={{ ...td, color: 'var(--muted)' }}>{r.line_name}</td>
                      <td style={td}>
                        {/* จัดกลุ่มพร้อมเหตุผล — ทุกไลน์ที่เป็นไปได้ต้องอยู่ในลิสต์เสมอ ห้ามตัดทิ้ง */}
                        <select value={sel} disabled={!canIssue} style={{ ...inp, width: 190 }}
                          onChange={e => setPick(p => ({ ...p, [r.key]: { ...p[r.key], to: e.target.value } }))}>
                          <option value="">— เลือก —</option>
                          {r.groups.map(g => (
                            <optgroup key={g.key} label={g.note ? `${g.label} · ${g.note}` : g.label}>
                              {g.lines.map(n => <option key={n} value={n}>{n}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        {/* 🔴 ของอยู่ผิดแผนก ไม่ใช่แค่ผิดชั้น — ปลายทางที่ถูกอยู่คนละแผนก */}
                        {r.warn && (
                          <div style={{ fontSize: 10, color: '#ef4444', marginTop: 3, fontWeight: 700, maxWidth: 210, whiteSpace: 'normal', lineHeight: 1.45 }}>
                            🔴 {r.warn.text}
                          </div>
                        )}
                        {!r.sure && !r.warn && (
                          <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>⚠ มีหลายปลายทาง — เลือกเอง</div>
                        )}
                        {sel && hint?.note && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{hint.label} — {hint.note}</div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <input type="number" disabled={!canIssue} style={{ ...inp, width: 90, textAlign: 'right' }}
                          value={pick[r.key]?.qty ?? r.qty}
                          onChange={e => setPick(p => ({ ...p, [r.key]: { ...p[r.key], qty: e.target.value } }))} />
                      </td>
                      <td style={td}>
                        <button disabled={!canIssue || busy === r.key} onClick={() => move(r)}
                          style={{ padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700,
                            background: canIssue ? '#f59e0b' : 'var(--muted)', color: '#fff', cursor: canIssue ? 'pointer' : 'not-allowed' }}>
                          {busy === r.key ? '...' : '🔀 ย้าย'}
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
