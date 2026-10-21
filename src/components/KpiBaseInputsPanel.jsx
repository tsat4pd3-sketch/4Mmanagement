/* ══ 💰 แผงกรอก "ตัวเลขฐาน" จากบัญชี/SAP — เดือนละครั้ง ระบบคำนวณ KPI การเงินให้ (2026-10-15 · คำสั่ง user) ════════
   user: "ควรให้คนคนนึงคอยกรอกค่าที่ใช้ร่วมกันทั้งโรงงาน · DL ของแต่ละส่วนงานก็ไปกรอกยอดเงินอย่างเดียว ระบบเอาไปหารกับยอดขายให้"
   · 2 ชั้น: 🏭 ค่ากลางทั้งโรงงาน (ยอดขาย · COGS · ตัวหารวัน) แก้ได้เฉพาะตอนดูขอบเขต ทั้งโรงงาน — คนกลางคนเดียว (ต้องมี kpi:manage + ใบผ่าน
     scope:all_units ตามกฎสิทธิ์ 3 ชั้น) · 🏢 ยอดเงินของหน่วย (DL · OH · วัตถุดิบ …) แก้ที่ขอบเขตของหน่วยนั้น
   · ตาราง `kpi_base_inputs` unique index มี `coalesce(scope_value,'')` = expression ⇒ **ห้าม upsert** (42P10 · กฎ DB ข้อ 3) → หาแถวเดิมจาก
     ดัชนีแล้ว update ตาม id ไม่มีค่อย insert · ทุกการเขียนนับแถว (RLS ปฏิเสธ = 0 แถวเงียบ · กฎ DB ข้อ 2)
   · สูตร/ตัวแปรอยู่ `utils/kpiSetup.js` + `utils/kpiFormula.js` — แผงนี้ไม่คำนวณอะไรเอง */
import { useState, useEffect, useContext } from 'react';
import { UserContext } from '../App';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { checkWriteRows } from '../utils/dbWrite';
import { isPlant } from '../utils/orgScope';
import { BASE_VARS_BY_LEVEL, baseScopeKeyOf, baseScopeColumns, buildBaseIndex, formulasUsingVar, PLANT_BASE_KEY } from '../utils/kpiFormula';
import KpiBaseImportModal from './KpiBaseImportModal';

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const fmt = (v) => (v == null ? '' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2 }));

function Cell({ value, auto, disabled, onCommit }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);
  /* ≈ ค่าอัตโนมัติ (กำลังคนจากทะเบียนพนักงาน) — โชว์จางเมื่อยังไม่มีค่ากรอกมือ · กรอกทับได้ · ลบที่กรอก = กลับไปใช้ค่าอัตโนมัติ */
  const autoTxt = value == null && auto != null ? `≈ ${fmt(auto)}` : '';
  if (disabled) {
    return <span title={autoTxt ? 'ค่าอัตโนมัติจากทะเบียนพนักงาน (ยังไม่มีใครกรอก)' : undefined}
      style={{ display: 'inline-block', minWidth: 72, textAlign: 'right', fontSize: 12, color: value == null ? 'var(--muted)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value == null ? (autoTxt || '–') : fmt(value)}</span>;
  }
  return (
    <input value={v} onChange={e => setV(e.target.value)} onBlur={() => onCommit(v.trim())} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
      inputMode="decimal" placeholder={autoTxt} title={autoTxt ? 'ค่าอัตโนมัติจากทะเบียนพนักงาน — กรอกทับได้ถ้าตัวเลขจริงต่างจากนี้' : undefined}
      style={{ width: 92, padding: '3px 5px', fontSize: 12, textAlign: 'right', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border)',
        color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }} />
  );
}

/**
 * @param scope   ขอบเขตที่ดู (canonical แล้ว — CC ของหน่วย = หน่วย)
 * @param rows    แถว kpi_base_inputs ของปีนี้ (ทุกขอบเขต)
 * @param canManage  สิทธิ์เขียนที่ขอบเขตนี้ (kpi:manage + ชั้น ③ ผ่านแล้ว)
 * @param onChanged  โหลดแถวใหม่หลังบันทึก
 */
export default function KpiBaseInputsPanel({ year, scope, org, rows = [], base: baseIn = null, canManage = false, onChanged, onGoPlant, defaultOpen = false, blockText = '' }) {
  const { fullName } = useContext(UserContext);
  /* ใครกรอก — 20/10 พบว่าค่าที่นำเข้าจากเว็บ 63 แถว created_by ว่างหมด ⇒ แยกไม่ออกจากตัวนำเข้าอัตโนมัติ (ซึ่งเขียน 'acct-import') */
  const stamp = async () => ({ created_by: (await supabase.auth.getUser()).data?.user?.id ?? null, created_by_name: fullName || null });
  const plant = isPlant(scope);
  const base = baseIn || buildBaseIndex(rows);
  const [importing, setImporting] = useState(false);
  const mySk = baseScopeKeyOf(scope);
  const label = plant ? 'ทั้งโรงงาน' : org.labelOf(scope.kind, scope.value);
  const [busy, setBusy] = useState('');

  const save = async (varKey, sk, month, raw) => {
    if (!canManage) { toast.error(blockText || 'ไม่มีสิทธิ์กรอกตัวเลขฐานของขอบเขตนี้'); return; }
    const value = raw === '' ? null : Number(raw);
    if (raw !== '' && !Number.isFinite(value)) { toast.error('กรอกเป็นตัวเลขเท่านั้น'); return; }
    const existing = base.row(sk, varKey, month);
    const prev = existing?.value == null ? null : Number(existing.value);
    if (prev === value) return;
    if (!existing && value == null) return;
    const tag = `ตัวเลขฐาน ${varKey} ${MONTHS[month - 1]}`;
    setBusy(`${sk}|${varKey}|${month}`);
    const ok = existing
      ? checkWriteRows(await supabase.from('kpi_base_inputs').update({ value }).eq('id', existing.id).select('id'), tag)
      : checkWriteRows(await supabase.from('kpi_base_inputs').insert({ year, month, var_key: varKey, value, ...baseScopeColumns(sk === PLANT_BASE_KEY ? { kind: 'plant', value: '' } : scope), ...(await stamp()) }).select('id'), tag);
    setBusy('');
    if (ok) onChanged?.();
  };

  /* 📥 นำเข้าจาก Excel — เขียนทีละค่า (ไม่ upsert · unique index เป็น expression) · นับแถวทุกครั้ง · คืนจำนวนที่สำเร็จ */
  const saveMany = async (values) => {
    /* 🔴 ด่านต้องอยู่ใน "ฟังก์ชันที่เขียน DB จริง" ไม่ใช่แค่ในโมดัล (QC audit 20/10)
       `save()` เช็ค `canManage` ถูกแล้ว แต่ทางนำเข้า Excel ไม่เช็คเลย — พึ่งด่านชั้น UI ชั้นเดียว
       (`KpiBaseImportModal` กรองด้วย `canPlant`/`canUnit`) ⇒ สลับ props/เรียกจากที่อื่นเมื่อไหร่
       คนที่ถือ `kpi:manage` ที่ขอบเขตหน่วย จะเขียน **ยอดขาย/COGS กลางของโรงงาน** ได้เงียบๆ */
    if (!canManage) { toast.error(blockText || 'ไม่มีสิทธิ์กรอกตัวเลขฐานของขอบเขตนี้'); return 0; }
    let n = 0, fail = 0;
    for (const [varKey, byMonth] of Object.entries(values)) {
      const lvl = [...BASE_VARS_BY_LEVEL.plant, ...BASE_VARS_BY_LEVEL.unit].find(v => v.key === varKey)?.level;
      /* 🔴 ตัวแปรระดับ "ทั้งโรงงาน" เขียนได้เฉพาะตอนยืนอยู่ที่ขอบเขตทั้งโรงงาน (เท่ากับ `canPlant`
         ที่ส่งเข้าโมดัล) — เช็คซ้ำที่นี่ ไม่ใช่เชื่อว่าโมดัลกรองมาแล้ว */
      if (lvl === 'plant' && !plant) {
        toast.error('ยอดกลางของโรงงาน (ยอดขาย/COGS) กรอกได้ที่ขอบเขต "ทั้งโรงงาน" เท่านั้น');
        fail++; continue;
      }
      const sk = lvl === 'plant' ? PLANT_BASE_KEY : mySk;
      const cols = lvl === 'plant' ? { scope_kind: 'plant', scope_value: '' } : baseScopeColumns(scope);
      for (const [m, value] of Object.entries(byMonth)) {
        const month = Number(m);
        const existing = base.row(sk, varKey, month);
        const prev = existing?.value == null ? null : Number(existing.value);
        if (prev === value) continue;
        const tag = `นำเข้า ${varKey} ${MONTHS[month - 1]}`;
        const ok = existing
          ? checkWriteRows(await supabase.from('kpi_base_inputs').update({ value }).eq('id', existing.id).select('id'), tag)
          : checkWriteRows(await supabase.from('kpi_base_inputs').insert({ year, month, var_key: varKey, value, ...cols, ...(await stamp()) }).select('id'), tag);
        if (ok) n += 1; else fail += 1;
      }
    }
    if (fail) toast.error(`บันทึกไม่สำเร็จ ${fail} ค่า (ดูข้อความด้านบน)`);
    if (n) onChanged?.();
    return n;
  };

  const td = { padding: '3px 4px', borderBottom: '1px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap' };
  const th = { ...td, fontSize: 11, color: 'var(--muted)', fontWeight: 700, textAlign: 'center' };
  const nameTd = { ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 200, fontSize: 12 };

  const block = (title, vars, sk, editable, hint) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {title}
        {hint && <span style={{ fontSize: 11.5, fontWeight: 500, color: '#f59e0b' }}>{hint}</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead><tr><th style={{ ...th, textAlign: 'left' }}>ตัวแปร</th>{MONTHS.map(m => <th key={m} style={th}>{m}</th>)}</tr></thead>
          <tbody>
            {vars.map(v => (
              <tr key={v.key}>
                <td style={nameTd}>
                  <b>{v.label}</b> <span style={{ color: 'var(--muted)', fontSize: 11 }}>({v.unit})</span>
                  {formulasUsingVar(v.key).length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>ใช้ในสูตร: {formulasUsingVar(v.key).join(' · ')}</div>
                  )}
                </td>
                {MONTHS.map((_, i) => {
                  const r = base.row(sk, v.key, i + 1);
                  const val = r?.value == null ? null : Number(r.value);
                  const k = `${sk}|${v.key}|${i + 1}`;
                  const autoV = r ? null : (base.src && base.src(sk, v.key, i + 1) === 'auto' ? base.get(sk, v.key, i + 1) : null);
                  return (
                    <td key={i} style={{ ...td, opacity: busy === k ? 0.5 : 1 }}>
                      <Cell value={val} auto={autoV} disabled={!editable} onCommit={raw => save(v.key, sk, i + 1, raw)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <details open={defaultOpen} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 16px' }}>
      <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>
        💰 ตัวเลขฐานจากบัญชี/SAP (กรอกเดือนละครั้ง) — ระบบคำนวณ %DL+OH · %RM · DSI · ยอดขาย/หัว ให้เอง
        <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 500, color: 'var(--muted)' }}>
          ขอบเขต: {label} · {rows.length} ค่าในปี {year + 543}
        </span>
        {/* 📥 อยู่บนหัวแผง (19/10 · user: "หาที่อัพไฟล์ไม่เจอ") — แผงพับอยู่ก็ยังเห็น · กันไม่ให้คลิกไปสลับพับ/กาง */}
        {canManage && (
          <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); setImporting(true); }}
            title="อัพโหลด monthly report ของบัญชี (.xlsx/.xlsb) แล้วให้ระบบอ่านแถว/เดือนให้ ตรวจก่อนบันทึก"
            style={{ marginLeft: 10, padding: '4px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-ink)', cursor: 'pointer', fontSize: 12, fontWeight: 700, verticalAlign: 'middle' }}>
            📥 นำเข้าจาก Excel บัญชี
          </button>
        )}
      </summary>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 6 }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6, flex: 1, minWidth: 280 }}>
          KPI ที่ตั้ง "ที่มาของตัวเลข = 🧮 คำนวณจากตัวเลขฐาน" (ปุ่ม ✏️ ของแถว) จะไม่ต้องกรอก % เอง — ระบบเอายอดเงินของหน่วย ÷ ยอดขายกลางของโรงงานให้ทุกเดือน ·
          ช่องว่าง = ยังไม่มีตัวเลข (ไม่ใช่ 0) · เดือนที่ขาดตัวแปรใดตัวแปรหนึ่ง แถว KPI จะเขียนบอกว่าขาดอะไร ·
          <b>≈ จาง = กำลังคนจากทะเบียนพนักงาน</b> (ยังไม่มีใครกรอก · ทะเบียนอาจไม่ครบ กรอกทับได้)
        </div>
      </div>
      {importing && (
        <KpiBaseImportModal year={year} unitLabel={label} unitSk={mySk} base={base} canPlant={plant && canManage} canUnit={canManage}
          onSave={saveMany} onClose={() => setImporting(false)} />
      )}
      {block('🏭 ค่ากลางทั้งโรงงาน — คนกลางกรอกครั้งเดียว ทุกหน่วยใช้ตัวเดียวกัน', BASE_VARS_BY_LEVEL.plant, PLANT_BASE_KEY, plant && canManage,
        plant ? (canManage ? '' : (blockText || 'ดูได้อย่างเดียว — ต้องมีสิทธิ์ kpi:manage + ใบผ่านทั้งโรงงาน'))
          : <span>อ่านอย่างเดียวที่นี่ — กรอกที่ขอบเขต <b style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={onGoPlant}>ทั้งโรงงาน</b></span>)}
      {block(plant ? '🏢 ยอดรวมทั้งโรงงาน (ตัวตั้งของ KPI ระดับโรงงาน)' : `🏢 ยอดเงินของ ${label} (กรอกยอดเงินอย่างเดียว ระบบหารให้)`,
        BASE_VARS_BY_LEVEL.unit, mySk, canManage, canManage ? '' : (blockText || 'ดูได้อย่างเดียว'))}
    </details>
  );
}
