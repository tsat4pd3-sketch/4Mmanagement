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
import { findClosedTwin, restoreQuestion } from '../utils/kpiClosed';
import {
  KPI_STD_UNITS, KPI_TOTAL_WEIGHT, stdUnitLabel, isStdParent, isStdFixed,
  matchStdItems, checkStdSelection, requirementOf, KPI_PERSPECTIVES,
} from '../utils/kpiSetup';

import { tr } from '../utils/i18n';
import { askConfirm } from '../utils/askConfirm';
import { MoreMark } from './InfoMore';
/* 23/09: รับ `scope`/`scopeCols` จาก OrgScopePicker (แทน section+group) — แถวที่หยิบเขียน scope_kind/scope_value ตรง */
export default function KpiStandardModal({ year, scopeCols = {}, scopeText = '', defs = [], canManage, onClose, onChanged, closedDefs = [], onRestore, initialUnit = '', onLinkUnit = null }) {
  /* หน่วยงานมาตรฐานที่ใบนี้อิงอยู่ — จำไว้ที่ `kpi_definitions.std_unit` ของแถวในใบ
     (ไม่มีตารางตั้งค่าแยก: ใบคือของจริง ทะเบียนเป็นเอกสารอ้างอิง) */
  const savedUnit = useMemo(() => defs.map(d => d.std_unit).find(Boolean) || '', [defs]);
  const [unit, setUnit] = useState(savedUnit || initialUnit);   // 25/11: แถบสถานะส่งหน่วยที่เลือกไว้มาได้ (ใบยังว่าง)
  const [items, setItems] = useState(null);      // null = ยังไม่โหลด
  const [missing, setMissing] = useState(false); // ยังไม่ apply migration
  const [busy, setBusy] = useState('');

  useEffect(() => { if (savedUnit) setUnit(savedUnit); }, [savedUnit]);

  const load = useCallback(async () => {
    if (!unit) { setItems(null); return; }
    const { data, error } = await supabase.from('kpi_standard_items')
      .select('id, seq, sort_order, perspective, topic, formula_text, requirement, note')
      .eq('year', year).eq('std_unit', unit).order('sort_order');
    if (error) {
      setMissing((error.code || '') === '42P01');
      if ((error.code || '') !== '42P01') toast.error((tr('โหลดทะเบียนมาตรฐานไม่สำเร็จ') + ': ') + error.message);
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
      const payload = {
        year, ...scopeCols, category: it.perspective,
        name: it.topic, formula_text: it.formula_text || null,
        // ⚠️ ต้องผูกขอบเขตที่กำลังดูอยู่เป๊ะ (scope_kind/scope_value) ไม่งั้นแถวใหม่หายจากจอทันที
        /* 🔴 ผูกกลับไปหาแถวในทะเบียนด้วย `std_item_id` (คอลัมน์เพิ่ม 23/09) — `matchStdItems()`
           เช็ค id ก่อนแล้วค่อยตกไปเทียบชื่อ · ถ้าไม่ส่ง id มันจะเหลือแต่การเทียบชื่อ
           ซึ่งพังทันทีที่คนแก้ชื่อ KPI ให้สั้นลง/ใส่วงเล็บเพิ่ม ⇒ จอฟ้อง "ยังไม่ได้หยิบ" ทั้งที่หยิบแล้ว */
        std_item_id: it.id,
        std_unit: unit, is_active: true,
      };
      /* 🗄️ ข้อนี้เคยถูก "ปิดใช้งาน" ไว้ในใบนี้ → เปิดคืนแถวเดิมแทน (insert ซ้ำจะชน unique 23505 แล้วค้างเป็นทางตัน · 07/10) */
      const twin = findClosedTwin(closedDefs, payload);
      if (twin && onRestore) {
        if (await askConfirm(restoreQuestion(twin, year + 543)) && await onRestore(twin)) onChanged?.();
        return;
      }
      const res = await supabase.from('kpi_definitions').insert(payload);
      if (res.error?.code === '23505') {
        toast.error(`"${it.topic}" ${tr("มีอยู่ในใบนี้แล้ว (อาจอยู่ในสถานะปิดใช้งาน — ดูแผง 🗄️ ปิดใช้งานอยู่ ที่ตารางแล้วกด เปิดคืน")})`);
        return;
      }
      const ok = checkWrite(res, `${tr("หยิบ")} "${it.topic}" ${tr("เข้าใบ")}`);
      if (ok) { toast.success(`${tr("เพิ่ม")} "${it.topic}" ${tr("แล้ว — ไปตั้งเป้า/น้ำหนักที่ตาราง")}`); onChanged?.(); }
    } finally { setBusy(''); }
  };

  /* หยิบข้อ fixed ที่ยังขาดทั้งหมดในครั้งเดียว — ข้อบังคับไม่มีอะไรให้ตัดสินใจ */
  const pickAllFixed = async () => {
    const todo = matched.filter(m => !m.row && isStdFixed(m.item)).map(m => m.item);
    if (!todo.length) return;
    if (!await askConfirm(`${tr("หยิบข้อบังคับที่ยังขาด")} ${todo.length} ${tr("ข้อเข้าใบของ")} ${scopeText || tr('ทั้งโรงงาน')} ${tr("ปี")} ${year + 543}?\n\n${tr("เป้า/น้ำหนักยังต้องกรอกเองที่ตาราง")}`)) return;
    setBusy('all');
    try {
      const ok = checkWrite(await supabase.from('kpi_definitions').insert(todo.map(it => ({
        year, ...scopeCols, category: it.perspective,
        name: it.topic, formula_text: it.formula_text || null,
        std_item_id: it.id,                       // ดูเหตุผลที่ `pick()` ด้านบน
        std_unit: unit, is_active: true,
      }))), 'หยิบข้อบังคับที่ขาด');
      if (ok) { toast.success(`${tr("เพิ่ม")} ${todo.length} ${tr("ข้อแล้ว")}`); onChanged?.(); }
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
    if (!r) return <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('หัวข้อแม่')}</span>;
    return (
      <span title={tr(r.hint)} style={{ fontSize: 11, fontWeight: 800, color: r.color, border: `1px solid ${r.color}55`, borderRadius: 'var(--r-xs)', padding: '1px 5px', whiteSpace: 'nowrap' }}>
        {tr(r.label)}
      </span>
    );
  };

  return (
    /* ไม่ใช่ฟอร์มที่กรอกค้าง แต่ปิดด้วยปุ่มอย่างเดียวให้เหมือนโมดัลอื่นในหน้านี้ (UI-CONVENTIONS §5) */
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border2)', borderRadius: 'var(--r-lg)', padding: 18, width: 'min(1000px, 97vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
          KPI Standard {tr("ของกลุ่ม — ปี")} {year + 543} · {scopeText || tr("ทั้งโรงงาน")}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '4px 0 10px', lineHeight: 1.6 }}>
          {tr("ทะเบียนนี้มาจาก")} <b>{tr('KPI Guideline ของกลุ่ม')}</b> ({tr("อ่านอย่างเดียว) — ESM ไม่ได้คิดเกณฑ์เอง · หยิบข้อ")} <b style={{ color: '#ef4444' }}>{tr('บังคับ')}</b> {tr('ให้ครบ + ติ๊ก')} <b style={{ color: '#3b82f6' }}>{tr('เลือกได้')}</b> {tr("ตามภาระงานจริง แล้วถ่วงน้ำหนักรวมให้เป็น")} <b>{KPI_TOTAL_WEIGHT}</b> {tr("ที่ตาราง")} KPI
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{tr('หน่วยงานตามเอกสารกลุ่ม')}</span>
          <select value={unit} onChange={e => setUnit(e.target.value)} style={sel}>
            <option value="">{tr('— เลือกหน่วยงาน —')}</option>
            {KPI_STD_UNITS.map(u => (
              <option key={u.unit} value={u.unit}>{stdUnitLabel(u.unit)}{u.seeded ? '' : tr(" (ยังไม่มีในทะเบียน)")}</option>
            ))}
          </select>
          {/* 25/11: เปลี่ยนหน่วยที่นี่ = แค่ "ดู" — ใบที่มีแถวแล้วต้องกดบันทึกการผูกจึงจะหายเตือน (เดิมไม่มีทางผูกเลย = user: "ผูกหมดแล้วทำไมยังแจ้งเตือน") */}
          {unit && unit !== savedUnit && defs.length > 0 && canManage && onLinkUnit && (
            <button type="button" className="pg-btn sm" onClick={() => onLinkUnit(unit)}
              title={tr('เขียนหน่วยงานนี้ลงทุกแถวของใบ — แถบสถานะและข้อบังคับจะอ่านจากหน่วยนี้')}>
              {tr('ใช้หน่วยนี้กับใบนี้')} ({defs.length} {tr('แถว')})
            </button>
          )}
          {savedUnit && unit !== savedUnit && (
            <span style={{ fontSize: 11, color: '#f59e0b' }}>{tr('ใบนี้อิง')} <b>{savedUnit}</b> {tr('อยู่ — กำลังดูหน่วยอื่น')}</span>
          )}
        </div>

        {missing && (
          <div style={{ fontSize: 12.5, color: '#f59e0b' }}>
            {tr("ยังไม่ได้")} apply migration <code>20260921_kpi_standard_2026_main.sql</code> (Main) — {tr("แจ้ง")} admin
          </div>
        )}

        {!unit && !missing && (
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('เลือกหน่วยงานด้านบนเพื่อดูข้อ KPI มาตรฐานของหน่วยงานนั้น')}</div>
        )}

        {unit && !missing && items && !items.length && (
          /* 🔴 ห้ามโชว์ตารางว่างเฉยๆ — ต้องบอกว่า "ไม่มีข้อมูล" ไม่ใช่ "ไม่มีข้อบังคับ" */
          <div style={{ fontSize: 12.5, color: '#f59e0b', lineHeight: 1.7 }}>
            {seeded === false
              ? <>{tr('หน่วยงาน')} <b>{unit}</b> <b>{tr('ยังไม่ได้ถอดเข้าทะเบียน')}</b> {tr('(ตารางต้นฉบับหน้า 16-18 นับ Fixed/Choice ไม่ตรงกับ PDF จึงตั้งใจยังไม่ใส่) — ใช้ใบกระดาษของกลุ่มไปก่อน')}</>
              : <>{tr('ยังไม่มีทะเบียนมาตรฐานของ')} <b>{unit}</b> {tr('ปี')} {year + 543} {tr('— ทะเบียนที่ seed ไว้คือปี 2569 (2026)')}</>}
            <div style={{ color: 'var(--muted)', marginTop: 4 }}>นี่คือ &ldquo;ไม่มีข้อมูลในระบบ&rdquo; ไม่ใช่ &ldquo;หน่วยงานนี้ไม่มีข้อบังคับ&rdquo;</div>
          </div>
        )}

        {unit && !missing && !!items?.length && (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, marginBottom: 8 }}>
              <span style={{ color: 'var(--text2)' }}>
                {tr("บังคับ")} <b style={{ color: nPickedFixed === nFixed ? '#22c55e' : '#ef4444' }}>{nPickedFixed}/{nFixed}</b>
                <span style={{ color: 'var(--muted)' }}> {tr('· เลือกได้')} {nPickedChoice}/{nChoice}</span>
              </span>
              <span style={{ color: 'var(--text2)' }}>
                {tr("น้ำหนักรวมในใบ")} <b style={{ color: check.diff === 0 ? '#22c55e' : '#f59e0b' }}>{check.weight}</b>
                <span style={{ color: 'var(--muted)' }}> / {KPI_TOTAL_WEIGHT}</span>
                {check.diff !== 0 && <b style={{ color: '#f59e0b' }}> ({check.diff > 0 ? `${tr("เกิน")} ${check.diff}` : `${tr("ขาด")} ${-check.diff}`})</b>}
              </span>
              {/* 🧾 ของนอกมาตรฐาน — เตือนให้เห็น ห้ามลบให้เอง (คนตัดสินว่าจะเก็บหรือปิด)
                  เคส Die MTN 19/11: ใบถือแบบของธุรกิจขายแม่พิมพ์ค้างอยู่ จอเดิมมองไม่เห็นเลย */}
              {check.extras?.length > 0 && (
                <span style={{ color: 'var(--amber)', fontWeight: 700 }}
                  title={check.extras.map(r => r?.name || r?.topic || '—').join(' · ')}>
                  {tr('นอกมาตรฐาน')} {check.extras.length} {tr('ข้อ')}{' '}
                  <MoreMark text={`${tr('ไม่มีในทะเบียนของหน่วยงานนี้')}: ${check.extras.map(r => r?.name || r?.topic || '—').join(' · ')} — ${tr('เก็บไว้ก็ได้ถ้าตั้งใจ · ไม่ใช้แล้วให้ปิดแถวนั้น (ไม่ต้องลบ)')}`} />
                </span>
              )}
              {canManage && nPickedFixed < nFixed && (
                <button onClick={pickAllFixed} disabled={!!busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>
                  {tr('＋ หยิบข้อบังคับที่ขาด (')}{nFixed - nPickedFixed})
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
                        <td colSpan={5} style={{ ...td, fontWeight: 800, color: 'var(--text)', background: 'var(--bg2)', fontSize: 12 }}>{tr(p.label)}</td>
                      </tr>,
                      ...rows.map(({ item, row }) => (
                        <tr key={item.id} style={isStdParent(item) ? { opacity: 0.75 } : undefined}>
                          <td style={{ ...td, width: 44, textAlign: 'right', color: 'var(--muted)' }}>{item.seq}</td>
                          <td style={{ ...td, width: 62 }}><Badge req={item.requirement} /></td>
                          <td style={{ ...td, whiteSpace: 'normal' }}>
                            <b style={{ color: 'var(--text)' }}>{item.topic}</b>
                            {item.formula_text && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.formula_text}</div>}
                            {item.note && <div style={{ fontSize: 11, color: '#f59e0b' }}>{item.note}</div>}
                          </td>
                          <td style={{ ...td, width: 130, whiteSpace: 'nowrap' }}>
                            {row
                              ? <span style={{ color: '#22c55e', fontSize: 11.5 }}>{tr('✅ มีในใบแล้ว')}{row.weight != null ? ` (${tr("น้ำหนัก")} ${row.weight})` : tr(" (ยังไม่ตั้งน้ำหนัก)")}</span>
                              : isStdParent(item)
                                ? <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                                : <span style={{ color: isStdFixed(item) ? '#ef4444' : 'var(--muted)', fontSize: 11.5 }}>
                                  {isStdFixed(item) ? tr("⚠ ยังไม่ได้หยิบ") : tr("ยังไม่ได้หยิบ")}
                                </span>}
                          </td>
                          <td style={{ ...td, width: 76, whiteSpace: 'nowrap' }}>
                            {canManage && !row && !isStdParent(item) && (
                              <button onClick={() => pick(item)} disabled={!!busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>{tr('＋ หยิบ')}</button>
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
              {tr("หยิบเข้าใบแล้ว")} <b>{tr('ยังไม่มีเป้า/น้ำหนัก')}</b> — {tr("ตั้งต่อที่ตาราง KPI (เอกสารกลุ่มให้หน่วยงานถ่วงน้ำหนักเอง ระบบเดาแทนไม่ได้) · ตัวเลขข้างบนเป็น")} <b>{tr('คำเตือน ไม่ได้บล็อกการบันทึก')}</b> — {tr("ใบจริงเพิ่มข้อนอกมาตรฐานได้")}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onClose} style={{ ...btn, padding: '6px 16px', fontSize: 12.5 }}>{tr('ปิด')}</button>
        </div>
      </div>
    </div>
  );
}
