import { useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import ProductSelect from './ProductSelect';
import { checkWrite } from '../utils/dbWrite';
import { normKey } from '../utils/ediMerge';

/* ─── 🔗 แก้คำเตือนจับคู่พาร์ท EDI บนจอ preview (2026-10-01 · คำสั่ง user) ──────────────
   user: *"แจ้ง error มาก็ไม่รู้จะไปแก้ยังไง · แจ้งให้เช็คว่าจับคู่ถูกมั้ย แล้วตัดสินใจอะไรได้"*

   3 คำเตือนเดิม = ข้อความล้วน ส่งคนไปหน้าอื่น แล้วให้อัพไฟล์ใหม่ ⇒ ไม่มีใครแก้ เตือนซ้ำทุกวัน
   ตอนนี้ทุกแถว "ตัดสินได้ตรงนี้" → บันทึกที่ `edi_part_map` (DR) → อ่านไฟล์ชุดเดิมใหม่ทันที
   ⇒ แถวที่ตัดสินแล้วหายจากคำเตือน และ**รอบหน้าไม่ถามซ้ำ** (ตัวนำเข้าใช้คำตัดสินก่อนการเดาทุกชั้น)

   🔴 ระบบเสนอ คนตัดสิน — ไม่มีปุ่ม "ยืนยันทั้งหมด" ให้กดผ่านๆ (การเดาผิด = ออเดอร์เข้าเลข SAP ผิดทั้งเดือน)
   🔴 ไม่เขียน dr_products.p_no — 1 เลขพาร์ทลูกค้าผูกได้หลาย MAT ตาม ship-to ซึ่ง p_no เก็บไม่ได้
   เอกสาร: docs/modules/logistic-planner-sales.md §🔗 จับคู่พาร์ท */

const box = (rgb) => ({
  marginBottom: 10, padding: '10px 12px', borderRadius: 8,
  background: `rgba(${rgb},0.08)`, border: `1px solid rgba(${rgb},0.35)`,
});
const head = (color) => ({ fontSize: 12.5, fontWeight: 800, color, marginBottom: 4 });
const hint = { fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 8 };
const row = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 8px',
  borderRadius: 6, background: 'var(--card)', border: '1px solid var(--border)', marginTop: 4,
};
const mono = { fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--text)' };
const btn = (primary) => ({
  fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
  background: primary ? 'var(--accent)' : 'var(--bg2)', color: primary ? '#08130a' : 'var(--text2)',
  border: `1px solid ${primary ? 'var(--accent)' : 'var(--border)'}`, fontFamily: 'var(--font-body)',
});
const LIMIT = 8;

export default function EdiMatchFixer({ edi, canEdit, custLabel, onSaved }) {
  const [busy, setBusy] = useState('');
  const [pick, setPick] = useState({});      // part → mat_no ที่เลือกใน picker
  const [scope, setScope] = useState({});    // part → ship_to ('' = ทุก ship-to)
  const [showAll, setShowAll] = useState({});
  const lbl = (c) => (custLabel ? custLabel(c) : c);

  const save = async (shipTo, part, mat, note) => {
    if (!mat) { toast.error('เลือก MAT SAP ก่อน'); return; }
    const key = `${shipTo}|${part}`;
    setBusy(key);
    const res = await supabaseDR.from('edi_part_map')
      .upsert({ ship_to: shipTo || '', part_key: normKey(part), customer_part_no: part, mat_no: mat, note: note || null },
        { onConflict: 'ship_to,part_key' })
      .select('id');
    if (checkWrite(res, 'บันทึกการจับคู่พาร์ท')) {
      if (!res.data?.length) toast.error('บันทึกไม่สำเร็จ (0 แถว)');
      else {
        toast.success(`✅ จำแล้ว: ${part}${shipTo ? ` (${lbl(shipTo)})` : ''} → ${mat} · อ่านไฟล์ใหม่…`);
        await onSaved?.();
      }
    }
    setBusy('');
  };

  const list = (k, arr) => (showAll[k] ? arr : arr.slice(0, LIMIT));
  const more = (k, arr) => arr.length > LIMIT && (
    <button type="button" style={{ ...btn(false), marginTop: 6 }} onClick={() => setShowAll(s => ({ ...s, [k]: !s[k] }))}>
      {showAll[k] ? 'ย่อ' : `แสดงทั้งหมด (${arr.length})`}
    </button>
  );
  const readOnly = !canEdit && (
    <div style={{ fontSize: 12, color: 'var(--muted)' }}>👁 ดูอย่างเดียว — คนที่มีสิทธิ์อัพโหลดเป็นคนตัดสินคู่พาร์ท</div>
  );

  /* ① แยกลูกค้าไม่ออก — ตัดสินราย ship-to (เลขเดียวกันไปคนละ MAT ตามปลายทาง) */
  const ambRows = (edi.ambiguous || []).flatMap(a => a.shipTos.map(st => ({ ...a, st })));
  /* ② จับคู่ไม่ได้ */
  const unm = edi.unmatched || [];
  /* ③ เดาจาก base part */
  const base = edi.baseMatched || [];

  return (
    <>
      {ambRows.length > 0 && (
        <div style={box('239,68,68')}>
          <div style={head('#ef4444')}>🔴 {ambRows.length} คู่ (พาร์ท × ship-to) มีหลาย MAT — เลือกว่าปลายทางนี้ใช้ MAT ไหน</div>
          <div style={hint}>
            ถ้าไม่เลือก ระบบจะใส่ MAT ตัวแรกให้ทุกปลายทาง ⇒ <b>MAT ที่เหลือดูเหมือนไม่มีใครสั่ง</b> ·
            กดปุ่ม MAT ที่ถูกต้อง ระบบจำไว้ใช้ครั้งต่อไปเลย
          </div>
          {list('amb', ambRows).map(a => (
            <div key={`${a.part}|${a.st}`} style={row}>
              <span style={mono}>{a.part}</span>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>→ {lbl(a.st)}</span>
              <span style={{ flex: 1 }} />
              {canEdit ? (a.cands || a.mats.map(m => ({ mat_no: m }))).map(c => (
                <button key={c.mat_no} type="button" disabled={!!busy} style={btn(false)}
                  title={[c.name, c.customer && `ลูกค้า ${c.customer}`].filter(Boolean).join(' · ')}
                  onClick={() => save(a.st, a.part, c.mat_no, 'เลือกจาก MAT ที่ใช้ P/N เดียวกัน')}>
                  {c.mat_no}{c.customer ? ` · ${c.customer}` : ''}
                </button>
              )) : <span style={{ fontSize: 12, color: 'var(--muted)' }}>{a.mats.join(' | ')}</span>}
            </div>
          ))}
          {more('amb', ambRows)}
          {readOnly}
        </div>
      )}

      {unm.length > 0 && (
        <div style={box('245,158,11')}>
          <div style={head('#f59e0b')}>⚠️ {unm.length} พาร์ท ยังไม่รู้ว่าเป็น MAT ไหน — เลือก MAT แล้วกดจำ</div>
          <div style={hint}>
            ถ้าไม่เลือก จะบันทึกด้วยเลขพาร์ทลูกค้าไปก่อน (ไม่ผูกกับสินค้าในระบบ = ไม่ขึ้นในแผนผลิต) ·
            ถ้าหา MAT ไม่เจอในรายการ แปลว่ายังไม่มีสินค้านี้ใน Product Master ให้เพิ่มที่นั่นก่อน
          </div>
          {list('unm', unm).map(part => {
            const sts = edi.unmatchedShipTos?.[part] || [];
            return (
              <div key={part} style={row}>
                <span style={mono}>{part}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{sts.map(lbl).join(', ')}</span>
                <span style={{ flex: 1 }} />
                {canEdit && (
                  <>
                    <div style={{ minWidth: 240 }}>
                      <ProductSelect value={pick[part] || ''} onChange={o => setPick(p => ({ ...p, [part]: o?.mat_no || '' }))} />
                    </div>
                    <select value={scope[part] ?? ''} onChange={e => setScope(s => ({ ...s, [part]: e.target.value }))}
                      style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                      <option value="">ใช้กับทุก ship-to</option>
                      {sts.map(st => <option key={st} value={st}>เฉพาะ {lbl(st)}</option>)}
                    </select>
                    <button type="button" disabled={!!busy || !pick[part]} style={btn(true)}
                      onClick={() => save(scope[part] ?? '', part, pick[part], 'เลือกเองบนจอนำเข้า EDI')}>
                      {busy === `${scope[part] ?? ''}|${part}` ? '…' : 'จำคู่นี้'}
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {more('unm', unm)}
          {readOnly}
        </div>
      )}

      {base.length > 0 && (
        <div style={box('245,158,11')}>
          <div style={head('#f59e0b')}>💡 {base.length} พาร์ท ระบบเดาจากเลขฐาน (rev ต่างกัน) — ยืนยันหรือเปลี่ยน</div>
          <div style={hint}>
            rev สะกดต่างแต่เป็นพาร์ทเดิม = กด <b>✓ ถูก</b> · ถ้าเป็นพาร์ทใหม่จาก EC (ออกเลขใหม่) ให้เลือก MAT ใหม่แทน
            ไม่งั้นความต้องการจะเข้า MAT rev เก่า
          </div>
          {list('base', base).map(b => (
            <div key={b.part} style={row}>
              <span style={mono}>{b.part}</span>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>→ {b.mat}{b.name ? ` · ${b.name}` : ''}</span>
              <span style={{ flex: 1 }} />
              {canEdit && (
                <>
                  <button type="button" disabled={!!busy} style={btn(true)}
                    onClick={() => save('', b.part, b.mat, 'ยืนยันคู่ที่เดาจาก base part')}>✓ ถูก</button>
                  <div style={{ minWidth: 220 }}>
                    <ProductSelect value={pick[b.part] || ''} onChange={o => setPick(p => ({ ...p, [b.part]: o?.mat_no || '' }))} />
                  </div>
                  <button type="button" disabled={!!busy || !pick[b.part]} style={btn(false)}
                    onClick={() => save('', b.part, pick[b.part], 'เปลี่ยนจากคู่ที่เดาจาก base part')}>เปลี่ยนเป็นตัวนี้</button>
                </>
              )}
            </div>
          ))}
          {more('base', base)}
          {readOnly}
        </div>
      )}
    </>
  );
}
