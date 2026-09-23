import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import { SCOPE_KIND_META, scopeKey, parseScopeKey, filterScopeOptions, isPlant } from '../utils/orgScope';

/* ══ <OrgScopePicker> — เลือก "ขอบเขต" ตามผังองค์กร ทุกมิติ ในช่องเดียว (2026-09-23 · คำสั่ง user) ═════
   *"เลือกส่วนงานตอนนี้เหมือนเลือกได้แค่ section และไม่ตรงกับผังองค์กร ควรกรองได้ทุกมิติในผังองค์กร"*

   ⚠️ กฎ: จอที่ให้ผู้ใช้ "เลือกขอบเขตดูข้อมูล/ตั้ง KPI" (OBEYA ทั้ง 3 แท็บ · KPI · รายงานตามหน่วยงาน)
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
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const INDENT = '  ';   // en-space ×2 ต่อชั้น — `<option>` ไม่เคารพ CSS padding ในทุกเบราว์เซอร์

function optionLabel(o, { withIcon = true } = {}) {
  const m = SCOPE_KIND_META[o.kind] || {};
  const icon = o.icon || m.icon || '';
  const flags = [o.noData ? '· ไม่มีไลน์ผลิต' : '', o.unlinked ? '· ผังยังไม่ผูก' : ''].filter(Boolean).join(' ');
  return `${INDENT.repeat(Math.max(0, o.depth - (o.kind === 'cost_center' ? 1 : 0)))}${withIcon && icon ? icon + ' ' : ''}${o.label}${flags ? ' ' + flags : ''}`;
}

/**
 * @param index     จาก useOrgScope(lines).index
 * @param value     { kind, value } | null (null/plant = ทั้งโรงงาน)
 * @param onChange  ({ kind, value }) => void
 * @param kinds     จำกัดชนิดที่เลือกได้ (เช่น ['section','department'] ตอนตั้ง KPI ระดับหน่วยงาน) — ค่าว่าง = ทุกชนิด
 * @param plantLabel ป้ายของตัวเลือก "ทั้งโรงงาน" (เช่น 'ทุกส่วนงานในขอบเขต') — null = ไม่มีตัวเลือกโรงงาน
 */
export default function OrgScopePicker({
  index, value, onChange, scopeSet = null, sections = [], kinds = null,
  plantLabel = SCOPE_KIND_META.plant.label, native = true, width = 260, style, inputStyle, disabled, title, id,
}) {
  const opts = useMemo(() => {
    if (!index) return [];
    let list = filterScopeOptions(index, { scopeSet, sections });
    if (kinds && kinds.length) list = list.filter(o => o.kind === 'plant' || kinds.includes(o.kind));
    if (plantLabel == null) list = list.filter(o => o.kind !== 'plant');
    return list;
  }, [index, scopeSet, sections, kinds, plantLabel]);

  const curKey = isPlant(value) ? 'plant' : scopeKey(value.kind, value.value);
  // ค่าที่เลือกไว้แต่ไม่อยู่ในตัวเลือก (นอกขอบเขต/ผังเปลี่ยน) ต้องไม่หายเงียบ — โชว์เป็นแถว ⚠
  const known = opts.some(o => o.key === curKey);
  const ghost = !known && curKey !== 'plant'
    ? { key: curKey, kind: value.kind, value: value.value, depth: 0, label: `${index?.labelOf?.(value.kind, value.value) || value.value} ⚠ ไม่อยู่ในตัวเลือกของคุณ` }
    : null;

  const emit = (key) => onChange?.(parseScopeKey(key));

  if (!native) {
    const sOpts = [...(ghost ? [ghost] : []), ...opts].map(o => ({
      id: o.key,
      label: o.kind === 'plant' ? `${SCOPE_KIND_META.plant.icon} ${plantLabel}` : optionLabel(o),
      sub: o.kind === 'plant' || o.kind === 'division' ? '' : (index.pathOf(o.kind, o.value).join(' › ') || (SCOPE_KIND_META[o.kind]?.label || '')),
      group: o.kind === 'cost_center' ? '💰 Cost Center' : (o.kind === 'plant' ? '' : (SCOPE_KIND_META[o.kind]?.label || '')),
      keywords: [o.kind, SCOPE_KIND_META[o.kind]?.label, ...(index.pathOf(o.kind, o.value) || [])].filter(Boolean).join(' '),
    }));
    const sel = sOpts.find(o => o.id === curKey) || null;
    return (
      <SearchSelect value={sel ? sel.id : ''} text={sel ? sel.label : ''} options={sOpts}
        onChange={({ id: k }) => { if (k) emit(k); else if (plantLabel != null) emit('plant'); }}
        placeholder="ค้นส่วนงาน / แผนก / ไลน์ / cost center…" emptyText="ไม่พบในผังองค์กร — ตั้งผังที่ /org-setup"
        maxRows={999} disabled={disabled} inputId={id} style={{ width, ...style }} inputStyle={inputStyle} />
    );
  }

  /* native <select>: optgroup ตามฝ่าย (ลูกของ division) · โรงงาน/ส่วนที่ไม่มีฝ่ายอยู่นอกกลุ่ม · CC กลุ่มท้าย */
  const groups = [];
  let cur = null;
  const flush = () => { if (cur && cur.items.length) groups.push(cur); cur = null; };
  opts.forEach((o) => {
    if (o.kind === 'plant') { flush(); groups.push({ label: null, items: [o] }); return; }
    if (o.kind === 'division') { flush(); cur = { label: `${o.icon || '🏢'} ${o.label}`, items: [], div: o }; return; }
    if (o.kind === 'cost_center') { if (!cur || cur.label !== '💰 Cost Center') { flush(); cur = { label: '💰 Cost Center', items: [] }; } cur.items.push(o); return; }
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
  return (
    <select id={id} value={curKey} disabled={disabled} title={title}
      onChange={e => emit(e.target.value)}
      style={{ width, fontSize: 13, ...style, ...inputStyle }}>
      {ghost && <option value={ghost.key}>⚠ {ghost.label}</option>}
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
    </select>
  );
}
