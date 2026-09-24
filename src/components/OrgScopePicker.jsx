import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import { SCOPE_KIND_META, scopeKey, parseScopeKey, filterScopeOptions, isPlant } from '../utils/orgScope';

/* ══ <OrgScopePicker> — เลือก "ขอบเขต" ตามผังองค์กร ทุกมิติ (2026-09-23 · คำสั่ง user) ═════════════
   *"เลือกส่วนงานตอนนี้เหมือนเลือกได้แค่ section และไม่ตรงกับผังองค์กร ควรกรองได้ทุกมิติในผังองค์กร"*

   ⚠️ กฎ: จอที่ให้ผู้ใช้ "เลือกขอบเขตดูข้อมูล/ตั้ง KPI" (OBEYA ทั้ง 4 แท็บ · KPI · รายงานตามหน่วยงาน)
      ใช้ component นี้เท่านั้น — ห้ามวาด `<select>` ส่วนงานจาก `org_nodes kind='section'` เอง
      (แผนกขึ้นตรงฝ่าย MTN/JIG MTN/QA จะหายจากตัวเลือก = บั๊กที่ทำให้ต้องมีตัวนี้)
   · ค่า = `{ kind, value }` (kind ∈ plant/division/section/department/line_group/line/cost_center)
     เก็บลง URL ด้วย `scopeKey()` → `?scope=department:JIG MTN` · อ่านกลับด้วย `parseScopeKey()`
   · ดัชนีมาจาก `useOrgScope(lines)` — ผู้เรียกส่ง `index` มา (โหลดครั้งเดียวต่อหน้า)
   · `scopeSet`/`sections` = ขอบเขตของ user (ตัดตัวเลือกด้วย `filterScopeOptions`) — ห้ามลืมส่ง
     ไม่งั้นหัวหน้า PD3 เลือกดู PD1 ได้ (ข้อมูลกรองอยู่แล้ว แต่ตัวเลือกไม่ควรหลอก)
   · 2 หน้าตา: `native` (default · `<select>` ย่อหน้าตามชั้น + optgroup ตามฝ่าย — เร็วบนมือถือ/รีโมท TV
     และไม่ดันหัวเพจตอนกาง) · `native={false}` = `<SearchSelect>` พิมพ์ค้นได้ (ใช้ในโมดัล/ฟอร์ม)
   · node ที่ไม่มีไลน์ผลิต (แผนกช่าง · สโตร์) ยังเลือกได้ — ติดป้าย "ไม่มีไลน์ผลิต" ไม่ใช่ซ่อน

   ── 🔴 Cost Center **แยกช่อง ห้ามปนในลิสต์ผัง** (23/09 · คำสั่ง user) ────────────────────────────
   *"อย่าปนกัน cost center แยกอีกช่อง · เลือก PD4 ก็ควรโชว์รหัสของมัน · พิมพ์ 2140462000 ก็ควรเจอ PD3"*
   เดิมรหัส cc ~74 ตัวถูกต่อท้ายลิสต์เดียวกับผังองค์กร ⇒ เลื่อนหาหน่วยงานไม่เจอ และรหัสเปล่าๆ
   ไม่บอกว่าเป็นของใคร · ตอนนี้:
     · ช่องซ้าย = ผังองค์กรล้วน (ไม่มี cc) · ช่องขวา = 💰 Cost Center ล้วน (`รหัส · ชื่อจากทะเบียน`)
     · **ค่ายังเป็นค่าเดียว** (`scope`) — เลือกช่องไหน อีกช่องกลับเป็นว่างเอง (KPI 1 แถวมี 1 ขอบเขต)
     · หน่วยที่มีรหัสผูกอยู่ โชว์ชิป `💰 รหัส` ต่อท้าย **กดเพื่อสลับไปใช้รหัสนั้นเป็นขอบเขตได้**
     · พิมพ์รหัสในช่องผัง (โหมดค้นหา) เจอหน่วยงานเจ้าของรหัส — `cost_center` อยู่ใน keywords
     · กลุ่มไลน์ที่ลูกใช้หลายรหัส **ไม่เดาเอารหัสใดรหัสหนึ่ง** — เขียนว่า "N รหัส"
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const INDENT = '  ';   // en-space ×2 ต่อชั้น — `<option>` ไม่เคารพ CSS padding ในทุกเบราว์เซอร์

function optionLabel(o, { withIcon = true } = {}) {
  const m = SCOPE_KIND_META[o.kind] || {};
  const icon = o.icon || m.icon || '';
  const flags = [o.noData ? '· ไม่มีไลน์ผลิต' : '', o.unlinked ? '· ผังยังไม่ผูก' : ''].filter(Boolean).join(' ');
  return `${INDENT.repeat(Math.max(0, o.depth))}${withIcon && icon ? icon + ' ' : ''}${o.label}${flags ? ' ' + flags : ''}`;
}

/**
 * @param index     จาก useOrgScope(lines).index
 * @param value     { kind, value } | null (null/plant = ทั้งโรงงาน)
 * @param onChange  ({ kind, value }) => void
 * @param kinds     จำกัดชนิดที่เลือกได้ (เช่น ['section','department'] ตอนตั้ง KPI ระดับหน่วยงาน) — ค่าว่าง = ทุกชนิด
 * @param plantLabel ป้ายของตัวเลือก "ทั้งโรงงาน" (เช่น 'ทุกส่วนงานในขอบเขต') — null = ไม่มีตัวเลือกโรงงาน
 * @param costCenter true = มีช่อง 💰 Cost Center แยกต่อท้าย (default) · false = ซ่อนแกนนี้ไปเลย
 */
export default function OrgScopePicker({
  index, value, onChange, scopeSet = null, sections = [], kinds = null, costCenter = true,
  plantLabel = SCOPE_KIND_META.plant.label, native = true, width = 260, style, inputStyle, disabled, title, id,
}) {
  const ccAllowed = costCenter && (!kinds || kinds.includes('cost_center'));
  const all = useMemo(() => {
    if (!index) return [];
    let list = filterScopeOptions(index, { scopeSet, sections });
    if (kinds && kinds.length) list = list.filter(o => o.kind === 'plant' || kinds.includes(o.kind));
    if (plantLabel == null) list = list.filter(o => o.kind !== 'plant');
    return list;
  }, [index, scopeSet, sections, kinds, plantLabel]);

  // 🔴 แยก 2 ลิสต์ตั้งแต่ต้น — ผังองค์กรห้ามมีรหัส cc ปน
  const opts = useMemo(() => all.filter(o => o.kind !== 'cost_center'), [all]);
  const ccOpts = useMemo(() => all.filter(o => o.kind === 'cost_center'), [all]);

  const isCc = value?.kind === 'cost_center';
  const curKey = isPlant(value) ? 'plant' : scopeKey(value.kind, value.value);
  const orgKey = isCc ? 'plant' : curKey;     // เลือก cc อยู่ ⇒ ช่องผังกลับไปที่ "ทั้งโรงงาน"
  // ค่าที่เลือกไว้แต่ไม่อยู่ในตัวเลือก (นอกขอบเขต/ผังเปลี่ยน) ต้องไม่หายเงียบ — โชว์เป็นแถว ⚠
  const known = all.some(o => o.key === curKey);
  const ghost = !known && curKey !== 'plant'
    ? { key: curKey, kind: value.kind, value: value.value, depth: 0, label: `${index?.labelOf?.(value.kind, value.value) || value.value} ⚠ ไม่อยู่ในตัวเลือกของคุณ` }
    : null;

  const emit = (key) => onChange?.(parseScopeKey(key));

  /* ชิปรหัสของหน่วยที่เลือกอยู่ — ตอบ "เลือก PD4 แล้วรหัสอะไร" โดยไม่ต้องเปิดอีกช่อง
     กดแล้วสลับไปใช้รหัสนั้นเป็นขอบเขต (ถ้ารหัสนั้นอยู่ในตัวเลือกจริง) */
  const ccHint = useMemo(() => {
    if (!index || !ccAllowed || isCc || isPlant(value)) return null;
    const { code, multi } = index.ccOf(value.kind, value.value);
    if (multi) return { text: `💰 ${multi} รหัส`, title: 'ไลน์ในกลุ่มนี้ใช้ cost center คนละรหัส — เลือกทีละรหัสที่ช่อง 💰', code: null };
    if (!code) return null;
    const pickable = ccOpts.some(o => o.value === code);
    return {
      text: `💰 ${code}`, code: pickable ? code : null,
      title: pickable ? `cost center ของหน่วยนี้ — กดเพื่อดูตามรหัสนี้แทน` : `cost center ของหน่วยนี้ (${code})`,
    };
  }, [index, value, ccAllowed, isCc, ccOpts]);

  const ccSelect = ccAllowed && ccOpts.length ? (
    <select
      value={isCc ? curKey : ''} disabled={disabled}
      title="Cost Center — แกนคนละสายกับผังองค์กร (1 กลุ่มไลน์ครอบหลายรหัสได้ และหลายไลน์ใช้รหัสเดียวกันได้)"
      onChange={e => (e.target.value ? emit(e.target.value) : emit('plant'))}
      style={{ width: 210, fontSize: 13, ...inputStyle }}>
      <option value="">💰 Cost Center — ทั้งหมด</option>
      {/* รหัสที่เลือกไว้แต่ไม่อยู่ในตัวเลือก (ผังเปลี่ยน/นอกขอบเขต) ต้องไม่หายเงียบ */}
      {ghost && isCc && <option value={ghost.key}>⚠ {ghost.label}</option>}
      {ccOpts.map(o => (
        <option key={o.key} value={o.key}>
          {`💰 ${o.value}${o.cc_name ? ` · ${o.cc_name}` : ''}`}
        </option>
      ))}
    </select>
  ) : null;

  const wrap = (node) => (ccSelect || ccHint
    ? (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {node}
        {ccHint && (ccHint.code
          ? (
            <button type="button" onClick={() => emit(scopeKey('cost_center', ccHint.code))} title={ccHint.title}
              style={{ padding: '3px 8px', fontSize: 11.5, borderRadius: 999, cursor: 'pointer', fontWeight: 700, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)' }}>
              {ccHint.text}
            </button>
          )
          : (
            <span title={ccHint.title}
              style={{ padding: '3px 8px', fontSize: 11.5, borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--muted)' }}>
              {ccHint.text}
            </span>
          ))}
        {ccSelect}
      </span>
    )
    : node);

  if (!native) {
    /* โหมดค้นหา: ช่องเดียวแต่แยก "กลุ่ม" ชัด + พิมพ์รหัส cc แล้วเจอหน่วยงานเจ้าของรหัส */
    const orgRows = [...(ghost ? [ghost] : []), ...opts].map(o => ({
      id: o.key,
      label: o.kind === 'plant' ? `${SCOPE_KIND_META.plant.icon} ${plantLabel}` : optionLabel(o),
      sub: o.kind === 'plant' || o.kind === 'division' ? '' : [
        index.pathOf(o.kind, o.value).join(' › ') || (SCOPE_KIND_META[o.kind]?.label || ''),
        o.cost_center ? `💰 ${o.cost_center}` : (o.cc_multi ? `💰 ${o.cc_multi} รหัส` : ''),
      ].filter(Boolean).join(' · '),
      group: o.kind === 'plant' ? '' : (SCOPE_KIND_META[o.kind]?.label || ''),
      // 🔴 รหัส cc อยู่ใน keywords ⇒ พิมพ์ "2140462000" เจอ "PD3" (คำสั่ง user 23/09)
      keywords: [o.kind, SCOPE_KIND_META[o.kind]?.label, o.cost_center, ...(index.pathOf(o.kind, o.value) || [])].filter(Boolean).join(' '),
    }));
    const ccRows = ccOpts.map(o => ({
      id: o.key,
      label: `💰 ${o.value}${o.cc_name ? ` · ${o.cc_name}` : ''}`,
      sub: (o.owners || []).length
        ? `ผูกกับ ${(o.owners || []).map(w => index.labelOf(w.kind, w.value)).join(' · ')}`
        : 'ผังยังไม่มีหน่วยไหนผูกรหัสนี้',
      group: '💰 Cost Center',
      keywords: [o.cc_name, ...(o.owners || []).map(w => w.value)].filter(Boolean).join(' '),
    }));
    const sOpts = ccAllowed ? [...orgRows, ...ccRows] : orgRows;
    const sel = sOpts.find(o => o.id === curKey) || null;
    return (
      <SearchSelect value={sel ? sel.id : ''} text={sel ? sel.label : ''} options={sOpts}
        onChange={({ id: k }) => { if (k) emit(k); else if (plantLabel != null) emit('plant'); }}
        placeholder={ccAllowed ? 'ค้นส่วนงาน / แผนก / ไลน์ / รหัส cost center…' : 'ค้นส่วนงาน / แผนก / ไลน์…'}
        emptyText="ไม่พบในผังองค์กร — ตั้งผังที่ /org-setup"
        maxRows={999} disabled={disabled} inputId={id} style={{ width, ...style }} inputStyle={inputStyle} />
    );
  }

  /* native <select>: optgroup ตามฝ่าย (ลูกของ division) · โรงงาน/ส่วนที่ไม่มีฝ่ายอยู่นอกกลุ่ม */
  const groups = [];
  let cur = null;
  const flush = () => { if (cur && cur.items.length) groups.push(cur); cur = null; };
  opts.forEach((o) => {
    if (o.kind === 'plant') { flush(); groups.push({ label: null, items: [o] }); return; }
    if (o.kind === 'division') { flush(); cur = { label: `${o.icon || '🏢'} ${o.label}`, items: [], div: o }; return; }
    if (o.parentKey === 'plant') { flush(); cur = { label: null, items: [o] }; return; }
    if (!cur) cur = { label: null, items: [] };
    cur.items.push(o);
  });
  flush();
  // ฝ่ายเองก็เลือกได้ — เป็น option แรกในกลุ่มของมัน (optgroup label กดไม่ได้)
  const render = (o) => (
    <option key={o.key} value={o.key}>
      {o.kind === 'plant' ? `${SCOPE_KIND_META.plant.icon} ${plantLabel}` : optionLabel(o)}
    </option>
  );
  return wrap(
    <select id={id} value={orgKey} disabled={disabled} title={title}
      onChange={e => emit(e.target.value)}
      style={{ width, fontSize: 13, ...style, ...inputStyle }}>
      {ghost && !isCc && <option value={ghost.key}>⚠ {ghost.label}</option>}
      {groups.map((g, i) => (g.label
        ? (
          <optgroup key={i} label={g.label}>
            {g.div && (!kinds || kinds.includes('division')) && (
              <option value={g.div.key}>{`${g.div.icon || '🏢'} ${g.div.label} (ทั้งฝ่าย)`}</option>
            )}
            {g.items.map(render)}
          </optgroup>
        )
        : g.items.map(render)))}
    </select>,
  );
}
