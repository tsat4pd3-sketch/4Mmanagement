/* ══ 📘 KPI Standard ของกลุ่ม — เลือกข้อ KPI ตามทะเบียนกลาง ════════════════════════
   2026-09-23 · ปิดช่องว่าง "ทะเบียน `kpi_standard_items` seed ไว้ 21/09 แล้วไม่มีจอไหนอ่านเลย"
   (บันทึกไว้เป็นงานค้างใน docs/modules/schema-map.md §7.5)

   🔴 กติกาการเลือก KPI ของแต่ละส่วนงาน **เป็นของกลุ่มอยู่แล้ว ห้ามคิดเอง** (CLAUDE.md §OBEYA):
     · ทุกแถวติดป้าย `fixed` (บังคับ ตัดทิ้งไม่ได้) / `choice` (เลือกได้ตามภาระงานจริง)
     · `requirement = null` = **แถวหัวข้อแม่ ไม่ใช่ KPI** — หยิบเข้าใบไม่ได้
     · หยิบ fixed ครบ + ติ๊ก choice แล้ว **ถ่วงน้ำหนักรวม 50 เสมอ**
   ⚠️ **เตือนเท่านั้น ห้ามบล็อกการบันทึก** — ใบจริงบางใบเพิ่มของนอกมาตรฐานได้ (kpiSetup §6)

   🔴 กฎความซื่อสัตย์ของจอ (CLAUDE.md §OBEYA): หน่วยงานที่ยังไม่ได้ seed หรือปีที่ยังไม่มีทะเบียน
      **ต้องเขียนบนจอว่ายังไม่มี ห้ามโชว์ตารางว่างเฉยๆ ให้เข้าใจผิดว่า "ไม่มีข้อบังคับ"**

   ตัวจับคู่/ตัวตรวจอยู่ใน `src/utils/kpiSetup.js` (pure + มีเทส) — ห้ามคำนวณซ้ำในไฟล์นี้ */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import {
  KPI_STD_UNITS, KPI_TOTAL_WEIGHT, stdUnitLabel, isStdParent, isStdFixed,
  matchStdItems, checkStdSelection, requirementOf, KPI_PERSPECTIVES,
} from '../utils/kpiSetup';

export default function KpiStandardModal({ year, section, group, defs = [], canManage, onClose, onChanged }) {
  /* หน่วยงานมาตรฐานที่ใบนี้อิงอยู่ — จำไว้ที่ `kpi_definitions.std_unit` ของแถวในใบ
     (ไม่มีตารางตั้งค่าแยก: ใบคือของจริง ทะเบียนเป็นเอกสารอ้างอิง) */
  const savedUnit = useMemo(() => defs.map(d => d.std_unit).find(Boolean) || '', [defs]);
  const [unit, setUnit] = useState(savedUnit);
  const [items, setItems] = useState(null);      // null = ยังไม่โหลด
  const [missing, setMissing] = useState(false); // ยังไม่ apply migration
  const [busy, setBusy] = useState('');

  useEffect(() => { setUnit(savedUnit); }, [savedUnit]);

  const load = useCallback(async () => {
    if (!unit) { setItems(null); return; }
    const { data, error } = await supabase.from('kpi_standard_items')
      .select('id, seq, sort_order, perspective, topic, formula_text, requirement, note')
      .eq('year', year).eq('std_unit', unit).order('sort_order');
    if (error) {
      setMissing((error.code || '') === '42P01');
      if ((error.code || '') !== '42P01') toast.error('โหลดทะเบียนมาตรฐานไม่สำเร็จ: ' + error.message);
      setItems([]);
      return;
    }
    setMissing(false);
    setItems(data || []);
  }, [year, unit]);
  useEffect(() => { load(); }, [load]);

  const matched = useMemo(() => matchStdItems(items || [], defs), [items, defs]);
  const check = useMemo(() => checkStdSelection(defs, items || null), [defs, items]);
  const seeded = useMemo(() => KPI_STD_UNITS.find(u => u.unit === unit)?.seeded, [unit]);

  /* หยิบข้อจากทะเบียน → สร้างแถวในใบ (ยังไม่มีเป้า/น้ำหนัก — คนกรอกต่อที่ตาราง)
     ⚠️ ไม่ตั้งน้ำหนักให้อัตโนมัติโดยตั้งใจ: เอกสารกลุ่มให้หน่วยงานถ่วงเอง ระบบเดาแทนไม่ได้ */
  const pick = async (it) => {
    if (!canManage || isStdParent(it)) return;
    setBusy(it.id);
    try {
      const ok = checkWrite(await supabase.from('kpi_definitions').insert({
        year, section: section || null, category: it.perspective,
        name: it.topic, formula_text: it.formula_text || null,
        // ⚠️ ต้องผูกกลุ่มไลน์ที่กำลังดูอยู่ ไม่งั้นแถวใหม่หายจากจอทันที (ตารางกรองด้วย line_group)
        line_group: group || null,
        /* 🔴 ผูกกลับไปหาแถวในทะเบียนด้วย `std_item_id` (คอลัมน์เพิ่ม 23/09) — `matchStdItems()`
           เช็ค id ก่อนแล้วค่อยตกไปเทียบชื่อ · ถ้าไม่ส่ง id มันจะเหลือแต่การเทียบชื่อ
           ซึ่งพังทันทีที่คนแก้ชื่อ KPI ให้สั้นลง/ใส่วงเล็บเพิ่ม ⇒ จอฟ้อง "ยังไม่ได้หยิบ" ทั้งที่หยิบแล้ว */
        std_item_id: it.id,
        std_unit: unit, is_active: true,
      }), `หยิบ "${it.topic}" เข้าใบ`);
      if (ok) { toast.success(`เพิ่ม "${it.topic}" แล้ว — ไปตั้งเป้า/น้ำหนักที่ตาราง`); onChanged?.(); }
    } finally { setBusy(''); }
  };

  /* หยิบข้อ fixed ที่ยังขาดทั้งหมดในครั้งเดียว — ข้อบังคับไม่มีอะไรให้ตัดสินใจ */
  const pickAllFixed = async () => {
    const todo = matched.filter(m => !m.row && isStdFixed(m.item)).map(m => m.item);
    if (!todo.length) return;
    if (!window.confirm(`หยิบข้อบังคับที่ยังขาด ${todo.length} ข้อเข้าใบของ${section ? ` ${section}` : 'ส่วนกลาง'} ปี ${year + 543}?\n\nเป้า/น้ำหนักยังต้องกรอกเองที่ตาราง`)) return;
    setBusy('all');
    try {
      const ok = checkWrite(await supabase.from('kpi_definitions').insert(todo.map(it => ({
        year, section: section || null, category: it.perspective,
        name: it.topic, formula_text: it.formula_text || null,
        line_group: group || null,
        std_item_id: it.id,                       // ดูเหตุผลที่ `pick()` ด้านบน
        std_unit: unit, is_active: true,
      }))), 'หยิบข้อบังคับที่ขาด');
      if (ok) { toast.success(`เพิ่ม ${todo.length} ข้อแล้ว`); onChanged?.(); }
    } finally { setBusy(''); }
  };

  const nFixed = matched.filter(m => isStdFixed(m.item)).length;
  const nPickedFixed = matched.filter(m => isStdFixed(m.item) && m.row).length;
  const nChoice = matched.filter(m => m.item.requirement === 'choice').length;
  const nPickedChoice = matched.filter(m => m.item.requirement === 'choice' && m.row).length;

  const td = { padding: '5px 8px', fontSize: 12, color: 'var(--text2)', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
  const btn = { padding: '3px 10px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', fontWeight: 700, fontSize: 11.5, cursor: 'pointer' };
  const sel = { padding: '5px 8px', fontSize: 13, borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', width: 300 };

  const Badge = ({ req }) => {
    const r = requirementOf(req);
    if (!r) return <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>หัวข้อแม่</span>;
    return (
      <span title={r.hint} style={{ fontSize: 10.5, fontWeight: 800, color: r.color, border: `1px solid ${r.color}55`, borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' }}>
        {r.label}
      </span>
    );
  };

  return (
    /* ไม่ใช่ฟอร์มที่กรอกค้าง แต่ปิดด้วยปุ่มอย่างเดียวให้เหมือนโมดัลอื่นในหน้านี้ (UI-CONVENTIONS §5) */
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14, padding: 18, width: 'min(1000px, 97vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
          📘 KPI Standard ของกลุ่ม — ปี {year + 543}{section ? ` · ${section}` : ' · ส่วนกลาง'}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '4px 0 10px', lineHeight: 1.6 }}>
          ทะเบียนนี้มาจาก <b>KPI Guideline ของกลุ่ม</b> (อ่านอย่างเดียว) — ESM ไม่ได้คิดเกณฑ์เอง ·
          หยิบข้อ <b style={{ color: '#ef4444' }}>บังคับ</b> ให้ครบ + ติ๊ก <b style={{ color: '#3b82f6' }}>เลือกได้</b> ตามภาระงานจริง
          แล้วถ่วงน้ำหนักรวมให้เป็น <b>{KPI_TOTAL_WEIGHT}</b> ที่ตาราง KPI
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>หน่วยงานตามเอกสารกลุ่ม</span>
          <select value={unit} onChange={e => setUnit(e.target.value)} style={sel}>
            <option value="">— เลือกหน่วยงาน —</option>
            {KPI_STD_UNITS.map(u => (
              <option key={u.unit} value={u.unit}>{stdUnitLabel(u.unit)}{u.seeded ? '' : ' (ยังไม่มีในทะเบียน)'}</option>
            ))}
          </select>
          {savedUnit && unit !== savedUnit && (
            <span style={{ fontSize: 11, color: '#f59e0b' }}>ใบนี้อิง <b>{savedUnit}</b> อยู่ — เปลี่ยนที่นี่ไม่ย้อนไปแก้แถวเดิม</span>
          )}
        </div>

        {missing && (
          <div style={{ fontSize: 12.5, color: '#f59e0b' }}>
            ยังไม่ได้ apply migration <code>20260921_kpi_standard_2026_main.sql</code> (Main) — แจ้ง admin
          </div>
        )}

        {!unit && !missing && (
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>เลือกหน่วยงานด้านบนเพื่อดูข้อ KPI มาตรฐานของหน่วยงานนั้น</div>
        )}

        {unit && !missing && items && !items.length && (
          /* 🔴 ห้ามโชว์ตารางว่างเฉยๆ — ต้องบอกว่า "ไม่มีข้อมูล" ไม่ใช่ "ไม่มีข้อบังคับ" */
          <div style={{ fontSize: 12.5, color: '#f59e0b', lineHeight: 1.7 }}>
            {seeded === false
              ? <>หน่วยงาน <b>{unit}</b> <b>ยังไม่ได้ถอดเข้าทะเบียน</b> (ตารางต้นฉบับหน้า 16-18 นับ Fixed/Choice ไม่ตรงกับ PDF จึงตั้งใจยังไม่ใส่) — ใช้ใบกระดาษของกลุ่มไปก่อน</>
              : <>ยังไม่มีทะเบียนมาตรฐานของ <b>{unit}</b> ปี {year + 543} — ทะเบียนที่ seed ไว้คือปี 2569 (2026)</>}
            <div style={{ color: 'var(--muted)', marginTop: 4 }}>นี่คือ &ldquo;ไม่มีข้อมูลในระบบ&rdquo; ไม่ใช่ &ldquo;หน่วยงานนี้ไม่มีข้อบังคับ&rdquo;</div>
          </div>
        )}

        {unit && !missing && !!items?.length && (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, marginBottom: 8 }}>
              <span style={{ color: 'var(--text2)' }}>
                บังคับ <b style={{ color: nPickedFixed === nFixed ? '#22c55e' : '#ef4444' }}>{nPickedFixed}/{nFixed}</b>
                <span style={{ color: 'var(--muted)' }}> · เลือกได้ {nPickedChoice}/{nChoice}</span>
              </span>
              <span style={{ color: 'var(--text2)' }}>
                น้ำหนักรวมในใบ <b style={{ color: check.diff === 0 ? '#22c55e' : '#f59e0b' }}>{check.weight}</b>
                <span style={{ color: 'var(--muted)' }}> / {KPI_TOTAL_WEIGHT}</span>
                {check.diff !== 0 && <b style={{ color: '#f59e0b' }}> ({check.diff > 0 ? `เกิน ${check.diff}` : `ขาด ${-check.diff}`})</b>}
              </span>
              {canManage && nPickedFixed < nFixed && (
                <button onClick={pickAllFixed} disabled={!!busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>
                  ＋ หยิบข้อบังคับที่ขาด ({nFixed - nPickedFixed})
                </button>
              )}
            </div>

            <div style={{ overflow: 'auto', flex: 1 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
                <tbody>
                  {KPI_PERSPECTIVES.map(p => {
                    const rows = matched.filter(m => m.item.perspective === p.key);
                    if (!rows.length) return null;
                    return [
                      <tr key={`h-${p.key}`}>
                        <td colSpan={5} style={{ ...td, fontWeight: 800, color: 'var(--text)', background: 'var(--bg2)', fontSize: 12 }}>{p.label}</td>
                      </tr>,
                      ...rows.map(({ item, row }) => (
                        <tr key={item.id} style={isStdParent(item) ? { opacity: 0.75 } : undefined}>
                          <td style={{ ...td, width: 44, textAlign: 'right', color: 'var(--muted)' }}>{item.seq}</td>
                          <td style={{ ...td, width: 62 }}><Badge req={item.requirement} /></td>
                          <td style={{ ...td, whiteSpace: 'normal' }}>
                            <b style={{ color: 'var(--text)' }}>{item.topic}</b>
                            {item.formula_text && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{item.formula_text}</div>}
                            {item.note && <div style={{ fontSize: 10.5, color: '#f59e0b' }}>{item.note}</div>}
                          </td>
                          <td style={{ ...td, width: 130, whiteSpace: 'nowrap' }}>
                            {row
                              ? <span style={{ color: '#22c55e', fontSize: 11.5 }}>✅ มีในใบแล้ว{row.weight != null ? ` (น้ำหนัก ${row.weight})` : ' (ยังไม่ตั้งน้ำหนัก)'}</span>
                              : isStdParent(item)
                                ? <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                                : <span style={{ color: isStdFixed(item) ? '#ef4444' : 'var(--muted)', fontSize: 11.5 }}>
                                  {isStdFixed(item) ? '⚠ ยังไม่ได้หยิบ' : 'ยังไม่ได้หยิบ'}
                                </span>}
                          </td>
                          <td style={{ ...td, width: 76, whiteSpace: 'nowrap' }}>
                            {canManage && !row && !isStdParent(item) && (
                              <button onClick={() => pick(item)} disabled={!!busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>＋ หยิบ</button>
                            )}
                          </td>
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
              หยิบเข้าใบแล้ว <b>ยังไม่มีเป้า/น้ำหนัก</b> — ตั้งต่อที่ตาราง KPI (เอกสารกลุ่มให้หน่วยงานถ่วงน้ำหนักเอง ระบบเดาแทนไม่ได้) ·
              ตัวเลขข้างบนเป็น <b>คำเตือน ไม่ได้บล็อกการบันทึก</b> — ใบจริงเพิ่มข้อนอกมาตรฐานได้
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onClose} style={{ ...btn, padding: '6px 16px', fontSize: 12.5 }}>ปิด</button>
        </div>
      </div>
    </div>
  );
}
