import { useState, useEffect, useMemo, useRef, useCallback, useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import SearchInput from '../components/SearchInput';
import { allOf } from '../utils/filterLabels';
import InfoMore from '../components/InfoMore';
import useTabParam, { useMergeParams } from '../utils/useTabParam';
import useIsMobile from '../utils/useIsMobile';
import { toast } from '../components/Toast';
import { supabase, supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster } from '../utils/masterCache';
import { SCHEMA_TTL } from '../utils/refreshRates';
import { bugReportText, tableSummaryText, fkLine } from '../utils/schemaReport';
import { auditProject, auditText, fmtBytes } from '../utils/schemaAudit';
import { openFeedback } from '../utils/feedbackPrefill';
import { UserContext } from '../App';
import USAGE from 'virtual:schema-usage';

/* ══ 🗄️ โครงสร้างฐานข้อมูล (Data Map) — /schema ═══════════════════════════════════════
   2026-09-22 · คำขอ user: "ทีมงานเจอบัค อยากเห็นว่า table ชื่ออะไร PK/FK กันแบบไหน
                            จะได้รายงานปัญหาได้ตรง"

   3 อย่างที่หน้านี้ตอบ:
     1) ระบบมีตารางอะไรบ้าง · อยู่ project ไหน (Main / DR — คนละฐานข้อมูล ชื่อคล้ายกันมาก)
     2) ตารางนั้นคีย์อะไร (PK) · ผูกกับตารางไหน (FK ออก/เข้า) · มี RLS/trigger อะไร
     3) **หน้าไหนในแอปแตะตารางนั้น** (และกลับกัน: หน้านี้ใช้ตารางอะไรบ้าง)

   ที่มาของข้อมูล — ทั้ง 2 ทางเป็น "ของจริง ณ ตอนนั้น" ไม่มีลิสต์ที่เขียนมือเลยสักจุด:
     • โครงสร้าง  ← RPC `esm_schema_overview()` / `esm_schema_table()` อ่าน pg_catalog สด
                    (migration 20260922_schema_catalog_rpc_{main,dr}.sql) · cache 12 ชม.
     • หน้า→ตาราง ← สแกนซอร์สตอน build (`virtual:schema-usage`)
   ⚠️ ห้ามเปลี่ยนไปเขียนรายชื่อตารางมือเด็ดขาด — snapshot ที่เขียนมือในโปรเจคนี้ล้าสมัยทุกครั้ง
      (docs/sql/00_schema_snapshot_*.sql dump ปี 2026-07-10 แล้วไม่เคยตามอีกเลย)

   egress: overview ~35 KB/โปรเจค (cache 12 ชม. ข้ามการเปิดแอป) · รายละเอียดตารางดึง
   "ทีละใบตอนเปิด" (~3-8 KB) ตามกฎเหล็กข้อ 11 — ห้ามรวมคอลัมน์ทุกตารางมาก้อนเดียว
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const PROJ = {
  main: {
    key: 'main', label: '🗄️ ระบบหลัก', short: 'Main', screen: 'MAIN',
    id: 'ewhdfqwfwofivojtsizn', client: supabase, color: '#22c55e',
    desc: 'ผู้ใช้/สิทธิ์ · พนักงาน & ทักษะ · ไลน์/องค์กร · 4M · QA · PE · NPI · KPI · ทะเบียนเอกสาร',
  },
  dr: {
    key: 'dr', label: '🏭 ข้อมูลผลิต', short: 'DR', screen: 'Product DB',
    id: 'eyhclzkifitbhbljgoav', client: supabaseDR, color: '#38bdf8',
    desc: 'ใบผลิต/กะ · Downtime & ของเสีย · เครื่องจักร/แม่พิมพ์/จิ๊ก · สินค้า & BOM · สโตร์ · งานซ่อม',
  },
};
const PKEYS = ['main', 'dr'];

const fmtRows = (n) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `~${(v / 1_000_000).toFixed(1)} ล้าน`;
  if (v >= 1000) return `~${Math.round(v / 1000)},000`;
  return `~${v}`;
};
const DEL_RULE = { a: 'ห้ามลบแม่ถ้ายังมีลูก (NO ACTION)', r: 'ห้ามลบแม่ถ้ายังมีลูก (RESTRICT)', c: 'ลบแม่ = ลบลูกตาม (CASCADE)', n: 'ลบแม่ = ลูกเป็น null (SET NULL)', d: 'ลบแม่ = ลูกกลับเป็นค่า default' };

/* จัดกลุ่มตารางจาก "คำนำหน้า" ที่มีจริงในชื่อ (npi_ · kpi_ · qa_ · mtn_ …)
   data-driven ล้วน — ไม่มีลิสต์กลุ่ม hardcode ให้ต้องตามแก้เวลามีโมดูลใหม่
   กลุ่มที่มีสมาชิกเดียวถูกโยนรวมไว้ "อื่นๆ" (กลุ่มละ 1 ตัว = ลิสต์รกกว่าเดิม) */
function groupTables(rows) {
  const by = new Map();
  for (const r of rows) {
    const pre = String(r.t).includes('_') ? String(r.t).split('_')[0] : '';
    const k = pre || '—';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  const groups = [];
  const rest = [];
  for (const [k, list] of by) {
    if (k !== '—' && list.length >= 2) groups.push({ key: k, label: `${k}_*`, rows: list });
    else rest.push(...list);
  }
  groups.sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key));
  if (rest.length) groups.push({ key: '__rest', label: 'อื่นๆ (ชื่อไม่ซ้ำกลุ่มใคร)', rows: rest.sort((a, b) => a.t.localeCompare(b.t)) });
  return groups;
}

export default function SchemaMap() {
  const isMobile = useIsMobile();
  const { fullName } = useContext(UserContext);
  const [tab, setTab] = useTabParam(['tables', 'pages', 'audit'], 'tables');
  const [sp] = useSearchParams();
  const setParams = useMergeParams();

  const [over, setOver] = useState({ main: undefined, dr: undefined });  // undefined = กำลังโหลด · null = โหลดไม่ได้
  const [detail, setDetail] = useState(null);       // ผลของตารางที่เลือก
  const [detailErr, setDetailErr] = useState('');
  const [q, setQ] = useState('');
  const [pq, setPq] = useState('');
  const [side, setSide] = useState('all');          // ตัวกรองโปรเจคของลิสต์
  const [openGroups, setOpenGroups] = useState({});
  const [reloadKey, setReloadKey] = useState(0);
  const detailCache = useRef(new Map());            // `${proj}.${table}` → payload (ในหน่วยความจำรอบนี้พอ)
  const wantRef = useRef('');                       // กัน stale response ตอนกดสลับตารางเร็วๆ

  // ?t=<proj>.<table> — ให้ copy ลิงก์ไปแปะในใบแจ้งบัคได้ตรงตาราง
  const sel = useMemo(() => {
    const raw = sp.get('t') || '';
    const [p, ...rest] = raw.split('.');
    const name = rest.join('.');
    return PROJ[p] && name ? { proj: p, table: name } : null;
  }, [sp]);

  /* ── โหลดภาพรวมโครงสร้างทั้ง 2 project ─────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const k of PKEYS) {
        const data = await cachedMaster(`schema_ov_${k}`, async () => {
          const { data, error } = await PROJ[k].client.rpc('esm_schema_overview');
          if (error) throw new Error(error.message);
          return data;
        }, SCHEMA_TTL);
        if (!alive) return;
        // cachedMaster กลืน error ให้แล้ว (คืน undefined เมื่อโหลดไม่ได้เลย) → แปลงเป็น null = "บอกบนจอ"
        setOver(o => ({ ...o, [k]: data && Array.isArray(data.tables) ? data : null }));
      }
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  /* ── โหลดรายละเอียดตารางที่เลือก (ทีละใบ) ──────────────────────────────────────── */
  useEffect(() => {
    if (!sel) { setDetail(null); setDetailErr(''); return; }
    const key = `${sel.proj}.${sel.table}`;
    wantRef.current = key;
    const cached = detailCache.current.get(key);
    if (cached) { setDetail(cached); setDetailErr(''); return; }
    setDetail(null); setDetailErr('');
    let alive = true;
    (async () => {
      const { data, error } = await PROJ[sel.proj].client.rpc('esm_schema_table', { p_table: sel.table });
      if (!alive || wantRef.current !== key) return;   // ผู้ใช้กดตารางอื่นไปแล้ว — ห้ามเขียนทับจอใหม่
      if (error) { setDetailErr(error.message || 'โหลดรายละเอียดตารางไม่สำเร็จ'); return; }
      if (!data) { setDetailErr('ไม่พบตารางนี้ในฐานข้อมูลแล้ว (อาจถูกลบ/เปลี่ยนชื่อ)'); return; }
      detailCache.current.set(key, data);
      setDetail(data);
    })();
    return () => { alive = false; };
  }, [sel, reloadKey]);

  const pick = useCallback((proj, table) => {
    setParams({ t: `${proj}.${table}` });
    if (typeof window !== 'undefined') window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }, [setParams]);

  const reload = () => {
    PKEYS.forEach(k => invalidateMaster(`schema_ov_${k}`));
    detailCache.current.clear();
    setOver({ main: undefined, dr: undefined });
    setReloadKey(x => x + 1);
    toast.info('กำลังอ่านโครงสร้างใหม่จากฐานข้อมูล…');
  };

  /* ── ทะเบียนตารางจริง + ดัชนี "ตาราง → หน้าที่ใช้" ─────────────────────────────── */
  const catalog = useMemo(() => {
    const byProj = {};
    for (const k of PKEYS) byProj[k] = new Set((over[k]?.tables || []).map(r => r.t));
    return byProj;
  }, [over]);

  // ชื่อตารางในซอร์สที่ไม่มีอยู่จริงในฐาน (พิมพ์ผิด/ตารางถูกลบ) — โชว์ไว้ ไม่กลบ
  const usageIndex = useMemo(() => {
    const idx = new Map();     // `${proj}.${table}` → [หน้า]
    const ghosts = new Map();  // ชื่อที่หาไม่เจอในทั้ง 2 ฐาน → [หน้า]
    const add = (m, k, page) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(page)) m.get(k).push(page); };
    for (const p of USAGE.pages || []) {
      const put = (t, guess) => {
        // ชื่อจากซอร์สถูกยืนยันกับทะเบียนจริงเสมอ — ฝั่งไหนมีจริงก็ผูกฝั่งนั้น (client กลางไม่ฟันธงฝั่ง)
        const hits = PKEYS.filter(k => catalog[k]?.has(t));
        if (!hits.length) { add(ghosts, t, p.path); return; }
        const use = hits.includes(guess) ? [guess] : hits;
        use.forEach(k => add(idx, `${k}.${t}`, p.path));
      };
      (p.main || []).forEach(t => put(t, 'main'));
      (p.dr || []).forEach(t => put(t, 'dr'));
      (p.unknown || []).forEach(t => put(t, null));
    }
    return { idx, ghosts };
  }, [catalog]);

  /* ชื่อตารางที่โค้ดฝั่งแอปเรียกใช้จริง แยกตามฝั่ง — ใช้โดยแท็บ 🩺 (ของกำพร้า/ตารางว่าง) */
  const usedByProj = useMemo(() => {
    const out = { main: new Set(), dr: new Set() };
    for (const [key] of usageIndex.idx) {
      const i = key.indexOf('.');
      const k = key.slice(0, i);
      if (out[k]) out[k].add(key.slice(i + 1));
    }
    return out;
  }, [usageIndex]);

  const audits = useMemo(() => PKEYS.map(k => ({
    key: k,
    result: over[k] ? auditProject({ tables: over[k].tables, fks: over[k].fks, used: usedByProj[k], side: k }) : null,
  })), [over, usedByProj]);

  // ตัวเลขบนแท็บ = จำนวนข้อที่เป็น "ปัญหาจริง" (แดง/เหลือง) ไม่รวมข้อแจ้งเพื่อทราบ
  const auditBadge = audits.reduce((n, a) =>
    n + (a.result?.checks.filter(c => c.level === 'bad' || c.level === 'warn').length || 0), 0);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = [];
    for (const k of PKEYS) {
      if (side !== 'all' && side !== k) continue;
      for (const r of over[k]?.tables || []) {
        if (s && !r.t.toLowerCase().includes(s) && !String(r.note || '').toLowerCase().includes(s)) continue;
        out.push({ ...r, proj: k });
      }
    }
    return out.sort((a, b) => a.t.localeCompare(b.t));
  }, [over, q, side]);

  const groups = useMemo(() => groupTables(rows), [rows]);
  const searching = q.trim().length > 0;

  const loading = over.main === undefined || over.dr === undefined;
  const failed = PKEYS.filter(k => over[k] === null);
  const total = PKEYS.reduce((n, k) => n + (over[k]?.tables?.length || 0), 0);
  const totalFk = PKEYS.reduce((n, k) => n + (over[k]?.fks?.length || 0), 0);

  const selPages = sel ? (usageIndex.idx.get(`${sel.proj}.${sel.table}`) || []) : [];
  const selUrl = sel && typeof window !== 'undefined'
    ? `${window.location.origin}/schema?t=${sel.proj}.${sel.table}` : '';

  const copy = async (text, okMsg) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(okMsg || 'คัดลอกแล้ว');
    } catch {
      // จอ TV / เบราว์เซอร์เก่าไม่มี clipboard API — ห้ามเงียบ บอกทางออกแทน
      toast.error('เบราว์เซอร์นี้คัดลอกอัตโนมัติไม่ได้ — ลากคลุมข้อความในกล่องแล้วกด Ctrl+C');
    }
  };

  return (
    <Page>
      <PageHeader
        title="โครงสร้างฐานข้อมูล" icon="🗄️"
        sub={loading ? 'กำลังอ่านโครงสร้างจากฐานข้อมูล…'
          : `${total} ตาราง/วิว · ${totalFk} เส้นความสัมพันธ์ (FK) · ${USAGE.pages?.length || 0} หน้าในระบบ`}
        actions={<button onClick={reload} style={btn()}>🔄 อ่านใหม่</button>}
        tabs={[
          { key: 'tables', label: '📋 ตาราง / คีย์ / ความสัมพันธ์' },
          { key: 'pages', label: '🧭 หน้าไหนใช้ตารางไหน' },
          { key: 'audit', label: '🩺 ตรวจสุขภาพโครงสร้าง', badge: auditBadge || undefined },
        ]}
        tab={tab} onTab={setTab}
      />

      <div style={{ ...card(), marginBottom: 12, fontSize: 12.5, lineHeight: 1.65 }}>
        <InfoMore id="schema_intro" lead={<>
          🐛 <b>เจอบัคแล้วอยากแจ้งให้ตรงจุด</b> — หาตารางที่เกี่ยว กดดูรายละเอียด แล้วกดปุ่ม
          <b> “🐛 แจ้งบัคเรื่องตารางนี้”</b> ระบบจะใส่ชื่อตาราง · ฐานข้อมูล · PK · FK · หน้าที่ใช้ ไปให้เอง
        </>}>
          <div style={{ marginTop: 6, color: 'var(--text2)' }}>
            • <b>ระบบนี้มีฐานข้อมูล 2 ตัวแยกกัน</b> — {PROJ.main.label} (จอ Supabase เขียนว่า “{PROJ.main.screen}”)
            และ {PROJ.dr.label} (“{PROJ.dr.screen}”) · ชื่อตารางคล้ายกันหลายตัว เวลาแจ้งให้บอกฝั่งด้วยเสมอ
            <br />• ตัวเลขแถว = <b>ค่าประมาณจากสถิติของฐาน</b> (ไม่ได้นับจริงทุกครั้ง) ใช้ดูขนาดคร่าวๆ เท่านั้น
            <br />• “หน้าไหนใช้ตารางไหน” มาจาก<b>การสแกนซอร์สตอน build</b> — จับเฉพาะที่โค้ดเขียนชื่อตารางตรงๆ
            ถ้าหน้าไหนเรียกผ่านฟังก์ชันกลางที่ส่งชื่อตารางเป็นตัวแปร จะไม่ขึ้นในลิสต์นี้
            <br />• ข้อมูลโครงสร้าง cache ไว้ 12 ชม. — เพิ่ง apply migration ให้กด <b>🔄 อ่านใหม่</b>
          </div>
        </InfoMore>
      </div>

      {!!failed.length && (
        <div style={{ ...card(), marginBottom: 12, borderColor: 'rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.08)', fontSize: 12.5, lineHeight: 1.6 }}>
          ⚠️ <b>อ่านโครงสร้างของ {failed.map(k => PROJ[k].label).join(' และ ')} ไม่ได้</b> —
          ส่วนใหญ่แปลว่ายังไม่ได้ apply migration <code>20260922_schema_catalog_rpc_{failed[0]}.sql</code>
          (ฟังก์ชัน <code>esm_schema_overview()</code>) หรือสิทธิ์ execute ยังไม่ถูก grant ·
          ตารางฝั่งที่เหลือยังดูได้ตามปกติ
        </div>
      )}

      {tab === 'tables' && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'minmax(300px, 380px) 1fr', alignItems: 'start' }}>
          {/* ── ลิสต์ตาราง ─────────────────────────────────────────────── */}
          {(!isMobile || !sel) && (
            <div style={{ ...card(), display: 'grid', gap: 9, alignContent: 'start' }}>
              <SearchInput value={q} onChange={setQ} fields="ชื่อตาราง (เช่น downtime, employee)" />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[{ k: 'all', label: allOf('ฐานข้อมูล') },
                  ...PKEYS.map(k => ({ k, label: `${PROJ[k].label} (${over[k]?.tables?.length || 0})` }))].map(o => (
                  <button key={o.k} onClick={() => setSide(o.k)} style={chip(side === o.k)}>{o.label}</button>
                ))}
              </div>

              {loading && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>กำลังโหลด…</div>}
              {!loading && !rows.length && (
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  ไม่พบตารางที่ตรงกับ “{q}” — ลองคำสั้นลง หรือดูแท็บ 🧭 หน้าไหนใช้ตารางไหน
                </div>
              )}

              {groups.map(g => {
                const open = searching || openGroups[g.key];
                return (
                  <div key={g.key} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'clip' }}>
                    <button onClick={() => setOpenGroups(s => ({ ...s, [g.key]: !s[g.key] }))}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        background: 'var(--bg3)', border: 'none', color: 'var(--text)', padding: '7px 10px', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{open ? '▾' : '▸'} {g.label}</span>
                      <span style={{ color: 'var(--muted)', fontWeight: 500, flexShrink: 0 }}>{g.rows.length}</span>
                    </button>
                    {open && (
                      <div>
                        {g.rows.map(r => {
                          const on = sel && sel.proj === r.proj && sel.table === r.t;
                          const used = (usageIndex.idx.get(`${r.proj}.${r.t}`) || []).length;
                          return (
                            <button key={`${r.proj}.${r.t}`} onClick={() => pick(r.proj, r.t)} style={{
                              width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 7,
                              padding: '6px 10px', cursor: 'pointer', fontSize: 12.5,
                              background: on ? 'var(--bg3)' : 'transparent', color: 'var(--text)',
                              border: 'none', borderLeft: `3px solid ${on ? PROJ[r.proj].color : 'transparent'}`,
                            }}>
                              <span style={{ flexShrink: 0 }}>{r.proj === 'main' ? '🗄️' : '🏭'}</span>
                              <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: on ? 700 : 500 }}>
                                {r.t}{(r.k === 'v' || r.k === 'm') && <span style={{ color: 'var(--muted)' }}> (วิว)</span>}
                              </span>
                              <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--muted)' }}>
                                {r.cols} คอลัมน์{used ? ` · ${used} หน้า` : ''}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── รายละเอียดตาราง ────────────────────────────────────────── */}
          {(!isMobile || sel) && (
            <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              {!sel && (
                <div style={{ ...card(), fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
                  👈 เลือกตารางทางซ้ายเพื่อดู <b>คอลัมน์ · คีย์หลัก (PK) · ความสัมพันธ์ (FK) · RLS · trigger</b>
                  <div style={{ marginTop: 8 }}>
                    {PKEYS.map(k => (
                      <div key={k} style={{ marginTop: 6 }}>
                        <b style={{ color: PROJ[k].color }}>{PROJ[k].label}</b>
                        <span style={{ color: 'var(--muted)' }}> ({PROJ[k].screen} · {PROJ[k].id})</span>
                        <div style={{ fontSize: 12 }}>{PROJ[k].desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sel && (
                <TableDetail
                  sel={sel} detail={detail} err={detailErr} isMobile={isMobile}
                  size={(over[sel.proj]?.tables || []).find(r => r.t === sel.table)?.bytes}
                  pages={selPages} url={selUrl} userName={fullName}
                  onBack={() => setParams({ t: null })}
                  onPick={pick} onCopy={copy} catalog={catalog}
                  onGoPage={(p) => { setTab('pages'); setPq(p); }}
                />
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <AuditTab audits={audits} isMobile={isMobile} loading={loading} onPick={pick} onCopy={copy} />
      )}

      {tab === 'pages' && (
        <PagesTab
          q={pq} setQ={setPq} isMobile={isMobile}
          catalog={catalog} ghosts={usageIndex.ghosts} onPick={pick}
        />
      )}
    </Page>
  );
}

/* ══ รายละเอียดตารางเดียว ═══════════════════════════════════════════════════════════ */
function TableDetail({ sel, detail, err, isMobile, pages, url, userName, size, onBack, onPick, onCopy, catalog, onGoPage }) {
  const P = PROJ[sel.proj];
  const d = detail || {};
  const pkSet = new Set(d.pk || []);
  const fkByCol = new Map();
  (d.fks || []).forEach(f => (f.c || []).forEach(c => fkByCol.set(c, f)));

  const summary = () => tableSummaryText({
    table: sel.table, projectLabel: `${P.label} (${P.screen})`, projectId: P.id,
    detail: d, pages, url,
  });

  return (
    <>
      <div style={{ ...card(), display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            {isMobile && <button onClick={onBack} style={{ ...btn(), marginBottom: 6 }}>← กลับไปลิสต์ตาราง</button>}
            <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 800, wordBreak: 'break-all' }}>
              {sel.proj === 'main' ? '🗄️' : '🏭'} {sel.table}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {P.label} · จอ Supabase เขียนว่า “{P.screen}” · {P.id}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => onCopy(summary(), 'คัดลอกข้อมูลตารางแล้ว — วางในแชท/ใบแจ้งได้เลย')} style={btn()}>📋 คัดลอกข้อมูลตาราง</button>
            <button onClick={() => onCopy(url, 'คัดลอกลิงก์แล้ว')} style={btn()}>🔗 คัดลอกลิงก์</button>
            <button onClick={() => openFeedback(bugReportText({
              table: sel.table, projectLabel: `${P.label} (${P.screen})`, projectId: P.id,
              detail: d, pages, url,
            }) + (userName ? `ผู้แจ้ง: ${userName}\n` : ''))} style={{ ...btn(), background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.5)' }}>
              🐛 แจ้งบัคเรื่องตารางนี้
            </button>
          </div>
        </div>

        {err && (
          <div style={{ fontSize: 12.5, color: '#fca5a5' }}>
            ⚠️ {err} — ถ้าเพิ่งเพิ่มตารางใหม่ ลองกด “🔄 อ่านใหม่” ด้านบน
          </div>
        )}
        {!detail && !err && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>กำลังโหลดรายละเอียด…</div>}

        {detail && (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11.5 }}>
              <span style={tag()}>{d.k === 'v' || d.k === 'm' ? 'VIEW (ไม่ใช่ตารางจริง)' : 'ตาราง'}</span>
              <span style={tag()}>{(d.columns || []).length} คอลัมน์</span>
              <span style={tag()}>{fmtRows(d.rows)} แถว (ประมาณ)</span>
              {size ? <span style={tag()}>{fmtBytes(size)}</span> : null}
              <span style={tag(d.rls ? '#22c55e' : '#f59e0b')}>{d.rls ? 'RLS เปิด' : 'RLS ปิด'}</span>
              {!!(d.triggers || []).length && <span style={tag()}>{d.triggers.length} trigger</span>}
            </div>
            {d.note && <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>📝 {d.note}</div>}

            {/* คีย์ + ความสัมพันธ์ — ส่วนที่ user ขอมาตรงๆ */}
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', alignItems: 'start' }}>
              <div style={sub()}>
                <div style={subTitle()}>🔑 คีย์หลัก (PK) — ใช้ระบุ “แถวไหน”</div>
                {(d.pk || []).length
                  ? <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{d.pk.map(c => <span key={c} style={tag('#eab308')}>{c}</span>)}</div>
                  : <div style={{ fontSize: 12, color: '#f59e0b' }}>— ไม่มี PK (แจ้งบัคแล้วบอกคีย์อื่นที่ใช้ระบุแถวแทน)</div>}
                {!!(d.uniques || []).length && (
                  <div style={{ marginTop: 7 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ห้ามซ้ำ (unique):</div>
                    {d.uniques.map(u => <div key={u.name} style={{ fontSize: 12 }}>· {(u.c || []).join(' + ')}</div>)}
                  </div>
                )}
              </div>

              <div style={sub()}>
                <div style={subTitle()}>🔗 ความสัมพันธ์ (FK)</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>ตารางนี้ชี้ออกไปหา:</div>
                {(d.fks || []).length ? d.fks.map(f => (
                  <div key={f.name} style={{ fontSize: 12, marginBottom: 3 }}>
                    · {(f.c || []).join('+')} →{' '}
                    {catalog[sel.proj]?.has(f.rt)
                      ? <button onClick={() => onPick(sel.proj, f.rt)} style={linkBtn()}>{f.rt}</button>
                      : <span>{f.rt}</span>}
                    .{(f.rc || []).join('+')}
                    <span style={{ color: 'var(--muted)' }}> · {DEL_RULE[f.del] || ''}</span>
                  </div>
                )) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>— ไม่มี</div>}

                <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '7px 0 3px' }}>ตารางที่ชี้มาหาตารางนี้:</div>
                {(d.refs || []).length ? d.refs.map(r => (
                  <div key={r.name} style={{ fontSize: 12, marginBottom: 3 }}>
                    · <button onClick={() => onPick(sel.proj, r.t)} style={linkBtn()}>{r.t}</button>.{(r.c || []).join('+')}
                    <span style={{ color: 'var(--muted)' }}> · {DEL_RULE[r.del] || ''}</span>
                  </div>
                )) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>— ไม่มี</div>}
              </div>
            </div>

            {/* หน้าไหนใช้ตารางนี้ */}
            <div style={sub()}>
              <div style={subTitle()}>📄 หน้าที่ใช้ตารางนี้ (จากซอร์สตอน build)</div>
              {pages.length ? (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {pages.map(p => <button key={p} onClick={() => onGoPage(p)} style={chip(false)}>{pageLabel(p)}</button>)}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  — ไม่พบหน้าที่เรียกชื่อตารางนี้ตรงๆ (อาจถูกใช้ผ่าน Edge Function / trigger ฝั่งฐานข้อมูล
                  หรือเรียกด้วยชื่อตัวแปร ซึ่งตัวสแกนไม่เห็น)
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {detail && (
        <div style={{ ...card(), overflowX: 'auto' }}>
          <div style={{ ...subTitle(), marginBottom: 6 }}>📑 คอลัมน์ทั้งหมด ({(d.columns || []).length})</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560, fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr>
                {['คอลัมน์', 'ชนิดข้อมูล', 'ว่างได้?', 'คีย์', 'ค่าเริ่มต้น / หมายเหตุ'].map((h, i) => (
                  <th key={h} style={{ textAlign: 'left', padding: '5px 7px', borderBottom: '1px solid var(--border2)', color: 'var(--muted)', fontSize: 11.5, whiteSpace: 'nowrap', width: i === 4 ? '35%' : undefined }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(d.columns || []).map(c => {
                const fk = fkByCol.get(c.name);
                return (
                  <tr key={c.name} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '5px 7px', fontWeight: pkSet.has(c.name) ? 700 : 500, wordBreak: 'break-all' }}>{c.name}</td>
                    <td style={{ padding: '5px 7px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      {c.type}
                      {!!(c.enum || []).length && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'normal' }}>ค่าที่รับ: {c.enum.join(' · ')}</div>
                      )}
                    </td>
                    <td style={{ padding: '5px 7px', color: c.nn ? '#f59e0b' : 'var(--muted)', whiteSpace: 'nowrap' }}>{c.nn ? 'ต้องมีค่า' : 'ว่างได้'}</td>
                    <td style={{ padding: '5px 7px', whiteSpace: 'nowrap' }}>
                      {pkSet.has(c.name) && <span style={tag('#eab308')}>PK</span>}
                      {fk && <span style={{ ...tag('#38bdf8'), marginLeft: 3 }}>→ {fk.rt}</span>}
                    </td>
                    <td style={{ padding: '5px 7px', color: 'var(--muted)', wordBreak: 'break-word' }}>
                      {c.def ? <code style={{ fontSize: 11 }}>{c.def}</code> : ''}
                      {c.note ? <div>{c.note}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div style={{ ...card(), fontSize: 12, lineHeight: 1.7 }}>
          <InfoMore id="schema_tech" lead={<span style={subTitle()}>🔧 รายละเอียดเชิงเทคนิค (index · RLS policy · trigger)</span>}>
            <div style={{ marginTop: 6 }}>
              <div style={{ color: 'var(--muted)' }}>RLS policy ({(d.policies || []).length}) — ใครทำอะไรกับตารางนี้ได้:</div>
              {(d.policies || []).length ? d.policies.map(p => (
                <div key={p.name}>· <b>{p.cmd}</b> — {(p.roles || []).join(', ')} <span style={{ color: 'var(--muted)' }}>({p.name})</span></div>
              )) : <div style={{ color: d.rls ? '#f59e0b' : 'var(--muted)' }}>
                {d.rls ? '— เปิด RLS แต่ไม่มี policy เลย = อ่าน/เขียนไม่ได้ทั้งตาราง' : '— ไม่มี (RLS ปิดอยู่)'}
              </div>}

              <div style={{ color: 'var(--muted)', marginTop: 7 }}>Trigger ({(d.triggers || []).length}):</div>
              {(d.triggers || []).length ? d.triggers.map(t => <div key={t.name}>· {t.name} → {t.fn}()</div>)
                : <div style={{ color: 'var(--muted)' }}>— ไม่มี</div>}

              <div style={{ color: 'var(--muted)', marginTop: 7 }}>Index ({(d.indexes || []).length}):</div>
              {(d.indexes || []).map(i => (
                <div key={i.name} style={{ wordBreak: 'break-all' }}>· {i.name}{i.uniq ? ' (unique)' : ''}</div>
              ))}

              {!!(d.checks || []).length && (
                <>
                  <div style={{ color: 'var(--muted)', marginTop: 7 }}>กฎตรวจค่า (check constraint):</div>
                  {d.checks.map(c => <div key={c.name} style={{ wordBreak: 'break-all' }}>· <code style={{ fontSize: 11 }}>{c.src}</code></div>)}
                </>
              )}
            </div>
          </InfoMore>
        </div>
      )}
    </>
  );
}

/* ══ แท็บ "หน้าไหนใช้ตารางไหน" ═══════════════════════════════════════════════════════ */
function PagesTab({ q, setQ, isMobile, catalog, ghosts, onPick }) {
  const [open, setOpen] = useState({});
  const s = String(q || '').trim().toLowerCase();
  const pages = (USAGE.pages || []).filter(p =>
    !s || p.path.toLowerCase().includes(s) || String(p.label).toLowerCase().includes(s)
    || (p.main || []).some(t => t.includes(s)) || (p.dr || []).some(t => t.includes(s)));

  const sideOf = (t, guess) => {
    const hits = PKEYS.filter(k => catalog[k]?.has(t));
    if (!hits.length) return null;
    return hits.includes(guess) ? guess : hits[0];
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ ...card(), display: 'grid', gap: 8 }}>
        <SearchInput value={q} onChange={setQ} fields="ชื่อหน้า / path / ชื่อตาราง" />
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          แสดง {pages.length} หน้า จากทั้งหมด {(USAGE.pages || []).length} ·
          สแกนซอร์สเมื่อ {new Date(USAGE.builtAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })} (ตอน build)
          {!!ghosts.size && <> · <span style={{ color: '#f59e0b' }}>พบชื่อตารางในโค้ด {ghosts.size} ตัวที่ไม่มีอยู่จริงในฐานข้อมูล (ดูท้ายหน้า)</span></>}
        </div>
      </div>

      {pages.map(p => {
        const tables = [...(p.main || []).map(t => ({ t, guess: 'main' })),
                        ...(p.dr || []).map(t => ({ t, guess: 'dr' })),
                        ...(p.unknown || []).map(t => ({ t, guess: null }))];
        const on = open[p.path] ?? (!!s || tables.length <= 6);
        return (
          <div key={p.path} style={{ ...card(), padding: 0, overflow: 'clip' }}>
            <button onClick={() => setOpen(o => ({ ...o, [p.path]: !on }))} style={{
              width: '100%', textAlign: 'left', display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap',
              alignItems: 'center', gap: 8, background: 'transparent', border: 'none', color: 'var(--text)',
              padding: '9px 12px', cursor: 'pointer',
            }}>
              <span style={{ flexShrink: 0, fontSize: 15 }}>{p.icon || '📄'}</span>
              <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13.5, fontWeight: 700 }}>
                {p.label || p.comp}
              </span>
              <code style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0 }}>{p.path}</code>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0 }}>{on ? '▾' : '▸'} {tables.length} ตาราง</span>
            </button>
            {on && (
              <div style={{ padding: '0 12px 11px', display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ไฟล์: <code>{p.file}</code></div>
                {tables.length ? (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {tables.map(({ t, guess }) => {
                      const k = sideOf(t, guess);
                      return (
                        <button key={`${guess}-${t}`} onClick={() => k && onPick(k, t)} disabled={!k}
                          title={k ? `${PROJ[k].label} · กดเพื่อดูโครงสร้าง` : 'ไม่พบตารางนี้ในฐานข้อมูล'}
                          style={{ ...chip(false), opacity: k ? 1 : 0.55, cursor: k ? 'pointer' : 'default' }}>
                          {k === 'main' ? '🗄️' : k === 'dr' ? '🏭' : '❔'} {t}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>— หน้านี้ไม่ได้อ่าน/เขียนตารางตรงๆ (เป็นหน้ารวมลิงก์ หรือใช้ข้อมูลที่หน้าอื่นโหลดไว้)</div>
                )}
                {!!(p.rpc || []).length && (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ฟังก์ชันฝั่งฐานข้อมูล (RPC): {p.rpc.join(' · ')}</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!!ghosts.size && (
        <div style={{ ...card(), fontSize: 12, lineHeight: 1.7, borderColor: 'rgba(245,158,11,0.45)' }}>
          <b style={{ color: '#f59e0b' }}>⚠️ ชื่อตารางที่โค้ดเรียกใช้ แต่ไม่มีอยู่จริงในฐานข้อมูลทั้ง 2 ฝั่ง</b>
          <div style={{ color: 'var(--muted)' }}>
            (ตารางถูกลบ/เปลี่ยนชื่อไปแล้ว หรือชื่อในโค้ดพิมพ์ผิด — จุดพวกนี้จะพังเงียบตอนรันจริง ควรแจ้งให้ไปตรวจ)
          </div>
          {[...ghosts.entries()].map(([t, ps]) => (
            <div key={t}>· <code>{t}</code> — {ps.map(pageLabel).join(' · ')}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══ แท็บ 🩺 ตรวจสุขภาพโครงสร้าง ═══════════════════════════════════════════════════════
   ตัวตรวจอยู่ใน `src/utils/schemaAudit.js` (pure + มีเทส) — ที่นี่แค่วาดผล
   🔴 กฎของจอนี้: ทุกข้อต้องบอก **"ทำไมถึงเป็นปัญหา" + "แก้ยังไง"** เสมอ
      ลิสต์ชื่อตารางเฉยๆ ไม่ช่วยใครตัดสินใจ และจะกลายเป็นจอที่ทุกคนเมินภายใน 2 สัปดาห์   */
const LV = {
  bad:  { icon: '🔴', color: '#ef4444', label: 'ต้องแก้' },
  warn: { icon: '🟡', color: '#f59e0b', label: 'ควรดู' },
  info: { icon: '🔵', color: '#38bdf8', label: 'แจ้งเพื่อทราบ' },
  ok:   { icon: '✅', color: '#22c55e', label: 'ผ่าน' },
};

function AuditTab({ audits, isMobile, loading, onPick, onCopy }) {
  const [open, setOpen] = useState({});

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...card(), fontSize: 12.5, lineHeight: 1.7 }}>
        <InfoMore id="schema_audit_intro" lead={<>
          🩺 <b>ตรวจโครงสร้างจากฐานจริงทุกครั้งที่เปิดจอนี้</b> — ไม่ใช่รายงานที่ทำครั้งเดียวแล้วล้าสมัย ·
          ตัวเลขบนแท็บนับเฉพาะข้อที่เป็นปัญหาจริง (🔴/🟡)
        </>}>
          <div style={{ marginTop: 6, color: 'var(--text2)' }}>
            <b>ทำความสะอาดรอบแรกไปแล้ว 22/09/2026:</b> ตารางสำรองที่ migration เก่าสร้างค้างไว้ใน public
            <b> 37 ตัว</b> (ข้อมูลผลิต 33 · ระบบหลัก 4) ถูกย้ายเข้า schema <code>archive</code> —
            <b>ย้ายไม่ได้ลบ</b> ข้อมูลอยู่ครบทุกแถว ย้อนกลับได้ด้วยคำสั่งเดียวต่อตาราง ·
            ตารางในจอนี้จึงลดจาก 313 เหลือ 276
            <br />ที่ต้องย้ายเพราะ 35 ใน 37 ตัวนั้น <b>ไม่ได้เปิด RLS</b> (สำเนาข้อมูลมา แต่ policy ไม่ได้ตามมาด้วย)
            — ฝั่งข้อมูลผลิตที่ client วิ่งด้วย anon เสมอ แปลว่าใครมี anon key ก็อ่านสำเนาข้อมูลจริงได้โดยไม่ต้อง login
            <br /><br />⚠️ <b>“ไม่มีหน้าไหนเรียกใช้” ไม่ได้แปลว่าลบได้</b> — ตัวสแกนเห็นเฉพาะโค้ดฝั่งหน้าเว็บ
            ตารางอาจถูกใช้โดย trigger/function ฝั่งฐานข้อมูล หรือ Edge Function · ใช้เป็น “รายการที่ต้องไปตรวจ” เท่านั้น
          </div>
        </InfoMore>
      </div>

      {loading && <div style={{ ...card(), fontSize: 12.5, color: 'var(--muted)' }}>กำลังอ่านโครงสร้าง…</div>}

      {audits.map(({ key, result }) => {
        const P = PROJ[key];
        if (!result) return null;
        return (
          <div key={key} style={{ ...card(), display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ minWidth: 0, fontSize: 14, fontWeight: 800, color: P.color }}>
                {P.label} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>· {result.total} ตาราง/วิว</span>
              </div>
              <button onClick={() => onCopy(auditText(result, `${P.label} (${P.screen})`), 'คัดลอกผลตรวจแล้ว')} style={btn()}>
                📋 คัดลอกผลตรวจ
              </button>
            </div>

            {result.checks.map(c => {
              const lv = LV[c.level] || LV.info;
              const id = `${key}:${c.id}`;
              const on = open[id] ?? (c.level === 'bad' || c.level === 'warn');
              return (
                <div key={c.id} style={{ border: `1px solid ${c.level === 'ok' ? 'var(--border)' : lv.color + '66'}`, borderRadius: 8, overflow: 'clip' }}>
                  <button onClick={() => setOpen(o => ({ ...o, [id]: !on }))} style={{
                    width: '100%', textAlign: 'left', display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap',
                    alignItems: 'center', gap: 8, background: 'var(--bg2)', border: 'none', color: 'var(--text)',
                    padding: '8px 10px', cursor: 'pointer',
                  }}>
                    <span style={{ flexShrink: 0 }}>{c.rows.length ? lv.icon : '✅'}</span>
                    <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13, fontWeight: 700 }}>{c.title}</span>
                    <span style={{ flexShrink: 0, fontSize: 12, color: c.rows.length ? lv.color : 'var(--muted)', fontWeight: 700 }}>
                      {c.rows.length ? `${c.rows.length} รายการ` : 'ไม่พบ'}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 11.5, color: 'var(--muted)' }}>{on ? '▾' : '▸'}</span>
                  </button>
                  {on && (
                    <div style={{ padding: '8px 10px', display: 'grid', gap: 6, fontSize: 12, lineHeight: 1.6 }}>
                      <div style={{ color: 'var(--text2)' }}><b>ทำไมเป็นปัญหา:</b> {c.why}</div>
                      <div style={{ color: 'var(--text2)' }}><b>แก้ยังไง:</b> {c.fix}</div>
                      {c.rows.length ? (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
                          {c.rows.map(r => (
                            <button key={r.t} onClick={() => onPick(key, r.t)} style={chip(false)} title="ดูโครงสร้างตารางนี้">
                              {r.t} <span style={{ color: 'var(--muted)' }}>· {r.note}</span>
                            </button>
                          ))}
                        </div>
                      ) : <div style={{ color: 'var(--muted)' }}>— ไม่พบรายการในหมวดนี้</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ── ชิ้นส่วน style เล็กๆ (เฉพาะหน้านี้ — ไม่ใช่ pattern ที่หน้าอื่นต้องใช้ตาม) ──────── */
const pageLabel = (path) => {
  const p = (USAGE.pages || []).find(x => x.path === path);
  return p?.label ? `${p.icon || ''} ${p.label}`.trim() : path;
};
const card = () => ({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 12 });
const sub = () => ({ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' });
const subTitle = () => ({ fontSize: 12.5, fontWeight: 700, marginBottom: 5 });
const btn = () => ({ fontSize: 12.5, fontWeight: 700, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' });
const chip = (on) => ({ fontSize: 11.5, fontWeight: 700, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', background: on ? 'var(--accent)' : 'var(--bg3)', color: on ? '#08120a' : 'var(--text)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}` });
const tag = (color) => ({ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--bg3)', color: color || 'var(--text2)', border: `1px solid ${color || 'var(--border2)'}` });
const linkBtn = () => ({ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 12, textDecoration: 'underline' });
