/* ══════════════════════════════════════════════════════════════════════════
   /ppe-setup — 🦺 ตั้งค่า "หน่วยงานนี้บังคับ PPE อะไรบ้าง"  (2026-11-10 · คำสั่ง user)

   โจทย์: *"ยังขาดหน้าที่จะเอาไว้ setup ppe requirement ของแต่ละหน้างาน
           บางไลน์ต้องมีผ้ากันเปื้อน ปลอกแขน แว่นตาอีก"*
   เดิมมีแค่ 3 คอลัมน์ bool ตายตัวทั้งโรงงาน (หมวก/รองเท้า/ถุงมือ) ⇒ ไลน์ที่ต้องใส่อย่างอื่น
   บันทึกไม่ได้เลย

   🔴 กติกาที่ห้ามพัง:
   1. **กฎการตกทอดอยู่ `src/utils/ppeRequirements.js` ที่เดียว** — หน้านี้แค่วาด/เขียนทะเบียน
      ห้ามคิดลำดับชั้นเองในหน้า (ไลน์ลูกชนะไลน์แม่ ฯลฯ)
   2. **3 ค่าต่อรายการ ห้ามยุบเป็นติ๊ก/ไม่ติ๊ก** — ตกทอด · บังคับ · ยกเว้น
      "ไม่ได้ตั้ง" กับ "ตั้งว่าไม่ต้อง" คนละความหมาย (ยุบ = ยกเว้นรายไลน์ไม่ได้เลย)
   3. **ทุกแถวต้องเขียนว่าค่าที่เห็นมาจากชั้นไหน** — ไม่งั้นคนตั้งค่าไปแก้ผิดชั้นแล้วกระทบคนอื่น
   4. อ่านทะเบียนไม่ได้ = เขียนบนจอ **ห้ามโชว์ลิสต์ว่างเฉยๆ** (ลิสต์ว่าง 2 ความหมาย)
   ══════════════════════════════════════════════════════════════════════════ */
import { useContext, useEffect, useMemo, useState } from 'react';
import { UserContext } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import FilterBar from '../components/FilterBar';
import Segmented from '../components/Segmented';
import LineSelect from '../components/LineSelect';
import NoticeBar from '../components/NoticeBar';
import { toast } from '../components/Toast';
import { supabase } from '../supabaseClient';
import { canSeeded } from '../utils/permissions';
import { checkWrite, checkWriteRows } from '../utils/dbWrite';
import { useProductionLinesState } from '../utils/useProductionLines';
import { useOrgSections } from '../utils/useOrgSections';
import { inSectionScope } from '../utils/sectionScope';
import { resolvePpe, ppeSourceText, PPE_SCOPE_LABEL } from '../utils/ppeRequirements';

const SCOPE_OPTS = [
  { value: 'plant',   label: 'ทั้งโรงงาน' },
  { value: 'section', label: 'ส่วนงาน' },
  { value: 'line',    label: 'ไลน์' },
  { value: 'station', label: 'จุดงาน' },
];
/* 3 ค่าต่อรายการ — ดูกฎข้อ 2 ที่หัวไฟล์ */
const VAL_OPTS = [
  { value: 'inherit',  label: 'ตกทอด' },
  { value: 'required', label: 'บังคับ' },
  { value: 'excluded', label: 'ยกเว้น' },
];
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 14 };

export default function PpeSetup() {
  const { role, lineId, sections: scopeSecs = [], scopeIdx } = useContext(UserContext);
  const canEdit = canSeeded('ppe', 'manage', role);
  const { rows: lines, failed: linesFailed } = useProductionLinesState();

  const [items, setItems] = useState(null);     // null = ยังไม่โหลด/โหลดไม่ได้ (คนละอย่างกับ [])
  const [reqs, setReqs]   = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [stations, setStations] = useState([]);
  const [saving, setSaving] = useState('');

  const [kind, setKind] = useState('plant');
  const [secKey, setSecKey] = useState('');
  const [lineKey, setLineKey] = useState('');
  const [stKey, setStKey] = useState('');

  const load = async () => {
    const [it, rq] = await Promise.all([
      supabase.from('ppe_items').select('id, code, name_th, icon, legacy_col, sort_order, is_active').order('sort_order'),
      supabase.from('ppe_requirements').select('id, scope_kind, scope_key, item_id, required, note'),
    ]);
    // 🔴 โหลดล้ม = คงเป็น null + เขียนบนจอ · ห้าม setState([]) แล้วโชว์ "ไม่มีข้อมูล" (จอโกหก)
    if (it.error || rq.error) { setLoadErr(it.error?.message || rq.error?.message); return; }
    setLoadErr(''); setItems(it.data || []); setReqs(rq.data || []);
  };
  useEffect(() => { load(); }, []);

  // จุดงานโหลดเฉพาะตอนเลือกชั้น "จุดงาน" และรู้ไลน์แล้ว (กฎ egress)
  useEffect(() => {
    if (kind !== 'station' || !lineKey) { setStations([]); return undefined; }
    let alive = true;
    supabase.from('workstations').select('id, name').eq('line_id', Number(lineKey)).order('name')
      .then(({ data, error }) => { if (alive) setStations(error ? [] : (data || [])); });
    return () => { alive = false; };
  }, [kind, lineKey]);

  /* 🗂️ ลิสต์ส่วนงานมาจากผังองค์กร (เรียงตาม sort_order) ห้ามเดาจาก production_lines.section
     แล้วกรองด้วยขอบเขตที่ผู้ใช้เห็นได้ (`sections` ว่าง = เห็นทั้งโรงงาน) */
  const orgSections = useOrgSections();
  const sectionNames = useMemo(
    () => orgSections.filter(s2 => !scopeSecs.length || inSectionScope(scopeSecs, s2)),
    [orgSections, scopeSecs]);
  const lineById = useMemo(() => Object.fromEntries((lines || []).map(l => [String(l.id), l])), [lines]);

  /* หน่วยที่กำลังตั้งค่าอยู่ + "ชั้นบนของมัน" (ไว้คำนวณค่าที่ตกทอดลงมา) */
  const scopeKey = kind === 'plant' ? '*' : kind === 'section' ? secKey : kind === 'line' ? lineKey : stKey;
  const ctxForResolve = useMemo(() => {
    if (kind === 'plant')   return {};
    if (kind === 'section') return { section: secKey };
    const ln = lineById[String(lineKey)];
    return { section: ln?.section, lineId: lineKey ? Number(lineKey) : null,
      stationId: kind === 'station' ? stKey : undefined };
  }, [kind, secKey, lineKey, stKey, lineById]);

  /** ค่าที่ "ตกทอดมาจากชั้นบน" = resolve โดยตัดแถวของชั้นนี้เองออก */
  const inherited = useMemo(() => resolvePpe({
    items, lines: lines || [], ...ctxForResolve,
    reqs: (reqs || []).filter(r => !(r.scope_kind === kind && String(r.scope_key) === String(scopeKey))),
  }), [items, reqs, lines, ctxForResolve, kind, scopeKey]);

  /** ผลสุดท้ายของหน่วยนี้ (รวมแถวของชั้นนี้) */
  const effective = useMemo(() => resolvePpe({ items, reqs, lines: lines || [], ...ctxForResolve }),
    [items, reqs, lines, ctxForResolve]);

  const ownRow = (itemId) => (reqs || []).find(r => r.scope_kind === kind
    && String(r.scope_key) === String(scopeKey) && String(r.item_id) === String(itemId));

  const valueOf = (itemId) => {
    const own = ownRow(itemId);
    if (!own) return 'inherit';
    return own.required ? 'required' : 'excluded';
  };

  const setValue = async (item, v) => {
    if (!canEdit || !scopeKey) return;
    setSaving(String(item.id));
    const own = ownRow(item.id);
    if (v === 'inherit') {
      if (own && !checkWriteRows(await supabase.from('ppe_requirements').delete().eq('id', own.id).select('id'), 'ยกเลิกการตั้งค่า')) {
        setSaving(''); return;
      }
    } else {
      const { data: u } = await supabase.auth.getUser();
      const row = { scope_kind: kind, scope_key: String(scopeKey), item_id: item.id,
        required: v === 'required', updated_at: new Date().toISOString(), updated_by: u?.user?.id || null };
      if (!checkWrite(await supabase.from('ppe_requirements').upsert(row, { onConflict: 'scope_kind,scope_key,item_id' }), 'บันทึกข้อกำหนด PPE')) {
        setSaving(''); return;
      }
    }
    await load();
    setSaving('');
  };

  const scopeName = kind === 'plant' ? 'ทั้งโรงงาน'
    : kind === 'section' ? (secKey || '—')
    : kind === 'line' ? (lineById[String(lineKey)]?.name || '—')
    : (stations.find(s => String(s.id) === String(stKey))?.name || '—');

  const loading = items === null && !loadErr;

  return (
    <Page>
      <PageHeader icon="🦺" title="ข้อกำหนด PPE ของแต่ละหน่วยงาน"
        subtitle="ตั้งว่าหน่วยไหนต้องใส่อะไร — ตกทอด ทั้งโรงงาน → ส่วนงาน → ไลน์ (แม่→ลูก) → จุดงาน · ชั้นล่างชนะชั้นบน"
        filters={(
          <FilterBar>
            <Segmented label="ตั้งค่าที่ชั้น" value={kind} options={SCOPE_OPTS}
              onChange={(v) => { setKind(v); if (v === 'plant') { setSecKey(''); setLineKey(''); setStKey(''); } }} />
            {kind === 'section' && (
              <select value={secKey} onChange={e => setSecKey(e.target.value)}>
                <option value="">— เลือกส่วนงาน —</option>
                {sectionNames.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {(kind === 'line' || kind === 'station') && (
              <LineSelect lines={lines || []} value={lineKey} valueKey="id" includeSupport
                onChange={v => { setLineKey(v); setStKey(''); }}
                role={role} lineId={lineId} sections={scopeSecs} scopeIdx={scopeIdx} />
            )}
            {kind === 'station' && (
              <select value={stKey} onChange={e => setStKey(e.target.value)} disabled={!lineKey}>
                <option value="">{lineKey ? '— เลือกจุดงาน —' : 'เลือกไลน์ก่อน'}</option>
                {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </FilterBar>
        )} />

      {loadErr && (
        <NoticeBar tone="bad">
          <b>อ่านทะเบียน PPE ไม่สำเร็จ</b> — ยังตั้งค่าไม่ได้ และหน้าจอนี้ไม่ได้แปลว่า "ไม่มีข้อกำหนด"
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{loadErr} · โหลดหน้าใหม่อีกครั้ง</div>
        </NoticeBar>
      )}
      {linesFailed && <NoticeBar tone="warn">อ่านทะเบียนไลน์ไม่สำเร็จ — ชั้น "ไลน์/จุดงาน" อาจไม่ครบ</NoticeBar>}
      {!canEdit && !loadErr && (
        <NoticeBar tone="warn">บัญชีนี้ดูได้อย่างเดียว (ต้องมีสิทธิ์ <code>ppe:manage</code>) — ขอสิทธิ์ที่หน้าจัดการสิทธิ์</NoticeBar>
      )}
      {loading && <div style={{ ...card, color: 'var(--muted)' }}>กำลังโหลด…</div>}

      {!loading && !loadErr && kind !== 'plant' && !scopeKey && (
        <div style={{ ...card, color: 'var(--muted)' }}>
          เลือก{PPE_SCOPE_LABEL[kind]}ที่ต้องการตั้งค่าก่อน — ระหว่างนี้ยังไม่แสดงรายการ เพราะแต่ละหน่วยตกทอดคนละชุด
        </div>
      )}

      {!loading && !loadErr && !!scopeKey && (<>
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>กำลังตั้งค่าที่</div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>{PPE_SCOPE_LABEL[kind]} · {scopeName}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
            ผลสุดท้ายของหน่วยนี้ = ต้องใส่ <b style={{ color: 'var(--green)' }}>{effective.required.length}</b> ชิ้น
            {effective.required.length > 0 && <> — {effective.required.map(i => i.name_th).join(' · ')}</>}
          </div>
        </div>

        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {(items || []).filter(i => i.is_active !== false).map(item => {
            const v = valueOf(item.id);
            const inhSrc = inherited.sourceOf.get(String(item.id));
            const inhOn = inherited.required.some(i => String(i.id) === String(item.id));
            const effOn = effective.required.some(i => String(i.id) === String(item.id));
            return (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                borderTop: '1px solid var(--border2)', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: effOn ? 'var(--text)' : 'var(--muted)' }}>
                    {effOn ? '🟢' : '⚪'} {item.name_th}
                    {item.legacy_col && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}> · มีช่องเดิมในใบเช็คชื่อ</span>}
                  </div>
                  {/* 🔴 กฎข้อ 3 — ต้องบอกเสมอว่าค่าที่เห็นมาจากชั้นไหน */}
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
                    {v === 'inherit'
                      ? (inhSrc ? `${inhOn ? 'บังคับ' : 'ยกเว้น'} — ${ppeSourceText(inhSrc, { nameOfLine: id => lineById[String(id)]?.name })}`
                        : 'ไม่มีชั้นไหนบังคับ')
                      : `ตั้งไว้ที่${PPE_SCOPE_LABEL[kind]}นี้เอง`}
                  </div>
                </div>
                <Segmented size="sm" value={v} options={VAL_OPTS} label={item.name_th}
                  onChange={(nv) => setValue(item, nv)} />
                {saving === String(item.id) && <span style={{ fontSize: 12, color: 'var(--amber)' }}>บันทึก…</span>}
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8, marginTop: 10 }}>
          <b>ตกทอด</b> = ใช้ตามชั้นบน (ไม่ได้ตั้งที่นี่) · <b>บังคับ</b> = หน่วยนี้ต้องใส่ ·
          <b> ยกเว้น</b> = หน่วยนี้ไม่ต้องใส่ แม้ชั้นบนจะบังคับ<br />
          รายการที่ตั้งไว้จะไปขึ้นให้ติ๊กตอน <b>สแกนบัตรเช็คชื่อ</b> — ขึ้นเฉพาะรายการที่หน่วยนั้นบังคับ
        </p>
      </>)}
    </Page>
  );
}
