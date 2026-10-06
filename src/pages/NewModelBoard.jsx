import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import useIsMobile from '../utils/useIsMobile';
import { supabase } from '../supabaseClient';
import { fetchByIds } from '../utils/fetchByIds';
import { summarizeNpi, npiLinkFor, linkedPanelCount } from '../utils/nmNpiLink';
import {
  EVA, evaMeta, rollupEva, evaCounts, countsLabel, freshness, freshLabel,
  PROJECT_AXES, projectEva, customerEva, PANEL_KIND, panelsNeedingAttention, overdueActions,
  tvWeightedLayout, panelWeight,
  BUCKETS, bucketOf, flattenPop, mainEva, bucketCounts, leavesInBucket, redWithoutNote, EVA_RULE,
} from '../utils/nmBoard';
import {
  IEC_TEAMS, CUSTOMERS, PROJECTS, SPTT_REQUIREMENTS, TMA_SPTT_DOCS, SOURCE_DATE,
} from '../data/nmBoard737D';

/* ══ 🧭 บอร์ด New Model (IEC) — บอร์ด OBEYA ของงานพาร์ทรุ่นใหม่ในเวอร์ชันออนไลน์ ═════════
   ลำดับการเจาะ = work flow ที่ IEC ส่งมาเอง (Obeya_E_Board-V2.pptx · 2026-09-24):
     ภาพรวม → ลูกค้า → **รุ่น = 4 แผง** (① ถัง EVA ② POP ③ ล็อต/คุณภาพ ④ ผู้รับผิดชอบ)
     → POP main KPI → sub KPI → หัวข้อเอกสาร
   ★ ทางลัดที่ IEC ขอเป็นพิเศษ: *"ถ้ามี Delay 7 วัน สามารถ click ไปยังหัวข้อที่ Delay>7 ได้เลย"*
     ⇒ กดถัง Delay บนหัวบอร์ด = กระโดดข้ามชั้นไปที่รายการปัญหาทันที (?bucket=delay)
   กฎ/สูตรอยู่ใน src/utils/nmBoard.js เท่านั้น · ข้อมูลอยู่ใน src/data/nmBoard737D.js
   เอกสาร: docs/IEC-NEW-MODEL-OBEYA-DESIGN.md
   ⚠️ เฟสนี้ข้อมูลมาจากการถอดบอร์ดกระดาษ ยังไม่ต่อฐานข้อมูล — ตัวโหลดอยู่จุดเดียว (useBoardData)
   ═════════════════════════════════════════════════════════════════════════════════════ */

const CARD = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 };

/** จุดสถานะ — วงกลมเท่านั้น (UI-CONVENTIONS) ห้ามเหลี่ยม ห้ามกระพริบในจอนี้ */
function Dot({ eva, size = 14, title }) {
  const m = evaMeta(eva);
  return (
    <span title={title || m.label} style={{
      width: size, height: size, borderRadius: '50%', flex: `0 0 ${size}px`,
      background: m.color, display: 'inline-block',
      border: eva === 'none' || !eva ? '1px dashed var(--border2)' : 'none',
      opacity: eva === 'none' || !eva ? 0.55 : 1,
    }} />
  );
}

/* ไฟสถานะหลักของรุ่น — วงแหวน (ไม่ใช่วงกลมทึบ) ชุดเดียวกับหัวบอร์ดโหมดจอ TV
   เดิมเป็นวงกลมสีทึบตัวอักษรดำ = ดูเป็น badge ของ bootstrap ทั่วไป · วงแหวน + แกนมืดอ่านง่ายกว่า
   บนพื้นเข้ม และไม่ตะโกนทับชื่อแกน */
function EvaBadge({ eva, label, note, big }) {
  const m = evaMeta(eva);
  const none = eva === 'none' || !eva;
  const d = big ? 42 : 30;
  return (
    <div className="nmb-card" data-eva={eva || 'none'}
      style={{ ...CARD, display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0,
        padding: '12px 13px 12px 17px', borderRadius: 10,
        borderColor: none ? 'var(--border)' : `${m.color}4d`,
        '--nmb-color': none ? 'var(--border2)' : m.color, '--nmb-rail': big ? '5px' : '4px' }}>
      <div className="nmb-ring" style={{
        width: d, height: d, flex: `0 0 ${d}px`, fontWeight: 800, fontSize: big ? 17 : 13,
        color: none ? 'var(--muted)' : m.color,
        '--nmb-color': none ? 'var(--border2)' : m.color,
        '--nmb-glow': eva === 'R' ? 'rgba(239,68,68,0.3)' : 'transparent',
        '--nmb-ring-w': big ? '4px' : '3px',
      }}>{m.short}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.005em' }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{m.label}</div>
        {note && <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 4, lineHeight: 1.45 }}>{note}</div>}
      </div>
    </div>
  );
}

function FreshChip({ iso }) {
  const f = freshness(iso);
  const color = f === 'bad' ? '#ef4444' : f === 'warn' ? '#eab308' : 'var(--muted)';
  return (
    <span style={{ fontSize: 11, color, whiteSpace: 'nowrap' }}>
      {f === 'bad' ? '⏳ ' : f === 'warn' ? '⏳ ' : '🕒 '}{freshLabel(iso)}
    </span>
  );
}

function Trail({ items }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, marginBottom: 10 }}>
      {items.map((it, i) => (
        <span key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {i > 0 && <span style={{ color: 'var(--muted)' }}>›</span>}
          {it.onClick
            ? <button onClick={it.onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 12 }}>{it.label}</button>
            : <span style={{ color: 'var(--text)', fontWeight: 700 }}>{it.label}</span>}
        </span>
      ))}
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ ...CARD, color: 'var(--muted)', fontSize: 12.5, textAlign: 'center', padding: 22 }}>{text}</div>;
}

function Scroller({ children }) {
  return <div style={{ overflowX: 'auto' }}>{children}</div>;
}

const th = { textAlign: 'left', padding: '7px 9px', fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
const td = { padding: '7px 9px', fontSize: 12.5, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };

/* ── ตัวโหลดข้อมูล — จุดเดียวที่ต้องแก้ตอนย้ายไปฐานข้อมูลจริง ───────────────── */
function useBoardData() {
  return useMemo(() => {
    const byCustomer = new Map();
    for (const c of CUSTOMERS) byCustomer.set(c.code, { ...c, projects: [] });
    for (const p of PROJECTS) byCustomer.get(p.customer)?.projects.push(p);
    return { customers: [...byCustomer.values()], projects: PROJECTS };
  }, []);
}

/* ══ 🔗 โปรเจค NPI ที่ผูกกับรุ่นนี้ (2026-10-06 · คำสั่ง user "2 หน้านี้ต้อง link กัน") ══════
   บอร์ด = ภาพที่คนตัดสินใจร่วมกัน (สีมาจากคน) · NPI = หลักฐาน (สถานะมาจากเอกสารจริง)
   ⇒ ยกตัวเลขจริงมาโชว์ข้างบอร์ด **ไม่เขียนอะไรกลับ ไม่แตะสี EVA** (กฎ IEC ข้อ 1)
   🔴 โหลดไม่สำเร็จ ≠ ยังไม่ผูก — ต้องแยก 3 สถานะให้จอเขียนต่างกัน: loading / unlinked / error
      ("โหลดล่ม" แล้วเขียนว่า "ยังไม่ผูก" = จอโกหก · กฎความซื่อสัตย์ของจอ) */
function useNpiLink(boardProjectId) {
  const [state, setState] = useState({ loading: true, sum: null, error: null });

  useEffect(() => {
    if (!boardProjectId) { setState({ loading: false, sum: null, error: null }); return undefined; }
    let alive = true;                                  // กัน stale-response race (กฎเขียน DB ข้อ 4)
    setState({ loading: true, sum: null, error: null });
    (async () => {
      /* เลือกเฉพาะคอลัมน์ที่ใช้ — ตารางนี้กว้าง (15 คอลัมน์) และ egress คิดเป็นไบต์ (กฎข้อ 11) */
      const pr = await supabase.from('npi_projects')
        .select('id, project_code, name, customer, model, status, leader_name, sop_date')
        .eq('nm_board_id', boardProjectId).limit(1);
      if (!alive) return;
      if (pr.error) { setState({ loading: false, sum: null, error: pr.error.message }); return; }
      const project = pr.data?.[0] || null;
      if (!project) { setState({ loading: false, sum: null, error: null }); return; }

      const [partsRes, eciRes] = await Promise.all([
        supabase.from('npi_parts').select('id, ppap_status').eq('project_id', project.id),
        supabase.from('npi_change_requests').select('id, status').eq('project_id', project.id),
      ]);
      if (!alive) return;
      const parts = partsRes.error ? null : (partsRes.data || []);
      const ecis = eciRes.error ? null : (eciRes.data || []);

      /* เอกสารผูกกับ "พาร์ท" ไม่ใช่โปรเจค ⇒ ต้องไล่จาก part ids · ผ่าน fetchByIds (กฎข้อ 5: .in ยาว = URL ล้น) */
      let deliverables = null;
      if (parts?.length) {
        const r = await fetchByIds(parts.map(x => x.id),
          (ids) => supabase.from('npi_deliverables').select('id, status').in('part_id', ids));
        if (!alive) return;
        deliverables = r.error || r.truncated ? null : r.rows;   // นับไม่ครบ = ไม่รู้ ห้ามโชว์ % ที่ต่ำกว่าจริง
      } else if (parts) {
        deliverables = [];
      }
      setState({ loading: false, error: null, sum: summarizeNpi({ project, parts, deliverables, ecis }) });
    })();
    return () => { alive = false; };
  }, [boardProjectId]);

  return state;
}

/* ตัวชี้อย่างเดียว (ไม่ดึงพาร์ท/เอกสาร) — ใช้ในหน้าแผงที่ต้องการแค่ "ลิงก์ไปไหน"
   แยกจาก useNpiLink เพราะหน้าแผงไม่ต้องใช้ตัวเลขสรุป ⇒ ไม่ต้องจ่าย egress ของ 3 คิวรีนั้น (กฎข้อ 11) */
function useNpiProjectRef(boardProjectId) {
  const [ref, setRef] = useState({ loading: true, id: null, code: null });
  useEffect(() => {
    if (!boardProjectId) { setRef({ loading: false, id: null, code: null }); return undefined; }
    let alive = true;
    setRef({ loading: true, id: null, code: null });
    supabase.from('npi_projects').select('id, project_code').eq('nm_board_id', boardProjectId).limit(1)
      .then(({ data, error }) => {
        if (!alive) return;
        const row = error ? null : data?.[0];
        setRef({ loading: false, id: row?.id || null, code: row?.project_code || null });
      });
    return () => { alive = false; };
  }, [boardProjectId]);
  return ref;
}

/* แถบ "ของจริงของแผงนี้อยู่ที่ไหน" — โผล่เฉพาะแผงที่ NPI เป็นเจ้าของข้อมูลนั้นจริง (PANEL_NPI_MAP) */
function PanelNpiLink({ proj, panel }) {
  const ref = useNpiProjectRef(proj.id);
  const link = npiLinkFor(panel.key, ref.id);
  if (ref.loading || !link) return null;
  return (
    <div className="nmb-card" data-eva="G" style={{ ...CARD, marginTop: 12, padding: '10px 12px 10px 16px', borderRadius: 10,
      '--nmb-color': 'var(--accent)', fontSize: 12.5, lineHeight: 1.55 }}>
      🔗 <b>ของจริงของแผงนี้อยู่ใน NPI</b> — {link.what}
      {' · '}<a href={link.href} style={{ color: 'var(--accent)' }}>เปิด {link.label}{ref.code ? ` ของ ${ref.code}` : ''} →</a>
    </div>
  );
}

/** ตัวเลข 1 ช่องในการ์ด NPI — ไม่รู้ค่า = ขีด `–` ห้ามโชว์ 0 */
function NpiStat({ label, value, suffix, tone }) {
  const unknown = value === null || value === undefined;
  return (
    <div style={{ minWidth: 0 }}>
      <div className="nmb-eyebrow" style={{ fontSize: 11 }}>{label}</div>
      <div className="nmb-num" style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.25, color: unknown ? 'var(--muted)' : (tone || 'var(--text)') }}>
        {unknown ? '–' : value}{!unknown && suffix ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}> {suffix}</span> : null}
      </div>
    </div>
  );
}

/* การ์ด "โปรเจค NPI ของรุ่นนี้" — อยู่บนสุดของชั้นรุ่น เพราะเป็นคำตอบของ "หลักฐานอยู่ไหน" */
function NpiLinkCard({ proj, isMobile }) {
  const { loading, sum, error } = useNpiLink(proj.id);
  const linkable = linkedPanelCount(proj.panels);

  if (loading) {
    return <div style={{ ...CARD, marginBottom: 12, fontSize: 12, color: 'var(--muted)' }}>🔗 กำลังอ่านโปรเจค NPI ที่ผูกกับรุ่นนี้…</div>;
  }
  if (error) {
    /* 🔴 โหลดล่ม ต้องเขียนว่าล่ม ห้ามกลืนเป็น "ยังไม่ผูก" */
    return (
      <div className="nmb-card" data-eva="R" style={{ ...CARD, marginBottom: 12, padding: '12px 13px 12px 17px', borderRadius: 10,
        '--nmb-color': '#ef4444', fontSize: 12.5 }}>
        <b>อ่านข้อมูล NPI ไม่สำเร็จ</b> — ตัวเลขฝั่ง NPI จึงยังไม่แสดง (ไม่ได้แปลว่ารุ่นนี้ยังไม่ผูก)
        <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 3 }}>{error}</div>
      </div>
    );
  }
  if (!sum) {
    return (
      <div className="nmb-card" data-eva="none" style={{ ...CARD, marginBottom: 12, padding: '12px 13px 12px 17px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.6 }}>
        🔗 <b>รุ่นนี้ยังไม่ผูกกับโปรเจค NPI</b> — บอร์ดจึงแสดงได้แค่สิ่งที่ถอดจากบอร์ดกระดาษ
        <div style={{ color: 'var(--text2)', marginTop: 4 }}>
          ผูกที่ <a href="/npi" style={{ color: 'var(--accent)' }}>🚀 พาร์ทใหม่ APQP / PPAP</a> → เลือกโปรเจค → <b>✏️ โปรเจค</b> → ช่อง
          <b> “🧭 รุ่นบนบอร์ด New Model”</b> → เลือก <b>{proj.title}</b>
          {linkable > 0 && <> · ผูกแล้ว <b>{linkable}</b> แผงบนบอร์ดนี้จะกดเข้าไปดูของจริงได้</>}
        </div>
      </div>
    );
  }

  const st = { display: 'grid', gap: 14, alignContent: 'start',
    gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(auto-fit, minmax(96px, 1fr))' };
  return (
    <div className="nmb-card" data-eva="G" style={{ ...CARD, marginBottom: 12, padding: '12px 13px 12px 17px', borderRadius: 10,
      '--nmb-color': 'var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="nmb-eyebrow" style={{ fontSize: 11 }}>โปรเจค NPI ของรุ่นนี้</span>
        <b style={{ fontSize: 13 }}>{sum.code || '(ไม่มีรหัสโปรเจค)'}</b>
        <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sum.name}</span>
        <a href={`/npi?project=${encodeURIComponent(sum.projectId)}`} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
          เปิดใน /npi →
        </a>
      </div>
      <div style={st}>
        <NpiStat label="พาร์ท" value={sum.parts} suffix="ตัว" />
        <NpiStat label="PPAP ผ่าน" value={sum.ppapApproved} suffix={sum.parts != null ? `/ ${sum.parts}` : ''} />
        <NpiStat label="เอกสารครบ" value={sum.docPct} suffix="%" />
        <NpiStat label="ECI ยังไม่จบ" value={sum.eciOpen} suffix={sum.eciTotal != null ? `/ ${sum.eciTotal}` : ''}
          tone={sum.eciOpen ? '#eab308' : undefined} />
        <NpiStat label="ถึง SOP" value={sum.sopIn == null ? null : (sum.sopIn >= 0 ? sum.sopIn : -sum.sopIn)}
          suffix={sum.sopIn == null ? '' : (sum.sopIn >= 0 ? 'วัน' : 'วัน (เลยแล้ว)')}
          tone={sum.sopIn != null && sum.sopIn < 0 ? '#ef4444' : undefined} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 9, lineHeight: 1.5 }}>
        ตัวเลขชุดนี้มาจากเอกสารจริงใน NPI · <b>ไม่ได้เอาไปเปลี่ยนสี EVA บนบอร์ด</b> — สีบอร์ดคนตั้งเองตามกติกา IEC
        {sum.docTotal === null && ' · นับเอกสารไม่ครบรอบนี้ จึงยังไม่แสดง %'}
      </div>
    </div>
  );
}

/* ══ ชั้นที่ 1 — ภาพรวมทั้งฝ่าย ═══════════════════════════════════════════════ */
function LevelOverview({ data, go }) {
  const isMobile = useIsMobile();
  const projects = data.projects;
  const axes = PROJECT_AXES.map(a => ({ ...a, eva: rollupEva(projects.map(p => p.eva?.[a.key])) }));
  const overdue = overdueActions(projects);
  const attention = projects.flatMap(p => panelsNeedingAttention(p.panels).map(x => ({ ...x, project: p })));

  return (
    <>
      <div style={{ display: 'grid', gap: 10, alignContent: 'start', marginBottom: 14,
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(230px, 1fr))' }}>
        {axes.map(a => <EvaBadge key={a.key} big eva={a.eva} label={a.label} note={a.hint} />)}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 8px' }}>ลูกค้า</div>
      <div style={{ display: 'grid', gap: 10, alignContent: 'start', marginBottom: 16,
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(215px, 1fr))' }}>
        {data.customers.map(c => {
          const eva = customerEva(c.projects);
          const teams = IEC_TEAMS.filter(t => t.customers.includes('*') || t.customers.includes(c.code)).map(t => t.key);
          const worst = c.projects.find(p => projectEva(p) === 'R');
          return (
            <button key={c.code} onClick={() => c.projects.length && go({ cust: c.code })}
              style={{ ...CARD, textAlign: 'left', cursor: c.projects.length ? 'pointer' : 'default',
                opacity: c.projects.length ? 1 : 0.6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Dot eva={eva} size={16} />
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>{c.name}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {c.projects.length ? `${c.projects.length} รุ่นในระบบ` : 'ยังไม่มีโปรเจคในระบบ'}
              </div>
              {!!c.projects.length && (
                <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                  {c.projects.map(p => p.title).join(' · ')} — ด่าน {c.projects[0].stage}
                </div>
              )}
              {worst && <div style={{ fontSize: 11.5, color: '#ef4444' }}>🔴 {worst.title}</div>}
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                ทีม {teams.join(' · ') || '–'} · ด่าน {c.milestones.length ? c.milestones.join(' → ') : 'ยังไม่ตั้งแม่แบบ'}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gap: 12, alignContent: 'start',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(330px, 1fr))' }}>
        <div style={CARD}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>⏰ งานเลยกำหนด ({overdue.length})</div>
          {!overdue.length ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่มี</div> : overdue.map((r, i) => (
            <button key={i} onClick={() => go({ cust: r.project.customer, proj: r.project.id, panel: r.panel.key })}
              style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--border)', width: '100%',
                textAlign: 'left', padding: '7px 0', cursor: 'pointer' }}>
              <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{r.issue}</div>
              <div style={{ fontSize: 11.5, color: '#ef4444' }}>
                เลย {r.late} วัน · กำหนด {r.due} · {r.pic} · {r.project.title} / {r.panel.label}
              </div>
            </button>
          ))}
        </div>
        <div style={CARD}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🚨 แผงที่ต้องรีบดู ({attention.length})</div>
          {!attention.length ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่มี</div> : attention.map((p, i) => (
            <button key={i} onClick={() => go({ cust: p.project.customer, proj: p.project.id, panel: p.key })}
              style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--border)', width: '100%',
                textAlign: 'left', padding: '7px 0', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Dot eva={p.eva} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5 }}>{p.label} <span style={{ color: 'var(--muted)' }}>· {p.project.title}</span></div>
                {p.evaNote && <div style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.45 }}>{p.evaNote}</div>}
                <FreshChip iso={p.updated_at} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ══ ชั้นที่ 2 — รุ่นของลูกค้า ═══════════════════════════════════════════════ */
function LevelCustomer({ cust, go }) {
  const isMobile = useIsMobile();
  if (!cust.projects.length) return <Empty text={`ยังไม่มีโปรเจคของ ${cust.name} ในระบบ`} />;
  return (
    <div style={{ display: 'grid', gap: 10, alignContent: 'start',
      gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))' }}>
      {cust.projects.map(p => (
        <button key={p.id} onClick={() => go({ cust: cust.code, proj: p.id })}
          style={{ ...CARD, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Dot eva={projectEva(p)} size={16} />
            <span style={{ fontSize: 15, fontWeight: 700 }}>{p.title}</span>
            {p.focus && <span style={{ fontSize: 11, background: 'var(--bg3)', padding: '1px 7px', borderRadius: 99 }}>⭐ Focus</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>ด่านปัจจุบัน {p.stage} · สภาพชิ้นงาน {p.partCondition}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>ส่งชิ้นงาน (PAD) {p.pad} · ปิด SPTT#2 ภายใน {p.targetSptt2}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
            {PROJECT_AXES.map(a => (
              <span key={a.key} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11.5 }}>
                <Dot eva={p.eva?.[a.key]} size={11} />{a.label}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{countsLabel(evaCounts(p.panels))} · {p.panels.length} แผง</div>
        </button>
      ))}
    </div>
  );
}

/* ══ 🎨 ชิ้นส่วนของหน้าจอรุ่น (4 แผงตาม work flow IEC) ═══════════════════════════════ */

/** ป้ายเกณฑ์สี — IEC ให้เกณฑ์มาไม่เหมือนกันทุกแผง ⇒ จอต้องบอกว่าแผงนี้ใช้เกณฑ์ไหน
 *  (กฎ "ไฟต้องพกเหตุผลมาด้วย" — คนดูบอร์ดต้องรู้ว่าแดงนี้วัดจากอะไร) */
function RuleNote({ ruleKey }) {
  const r = EVA_RULE[ruleKey];
  if (!r) return null;
  return (
    <div style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.6, marginTop: 8,
      borderTop: '1px dashed var(--border)', paddingTop: 7 }}>
      <b style={{ color: 'var(--muted)' }}>เกณฑ์สีของแผงนี้</b> ·{' '}
      <Dot eva="R" size={9} /> {r.red} ·{' '}
      <Dot eva="Y" size={9} /> {r.yellow} ·{' '}
      <Dot eva="G" size={9} /> {r.green}
    </div>
  );
}

function SectionHead({ n, title, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 0 8px' }}>
      <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)' }}>{n}</span>
      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</span>
      {sub && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{sub}</span>}
    </div>
  );
}

/** ① 3 ถังบนหัวบอร์ด — กดแล้วกระโดดไปที่รายการเลย (ทางลัดที่ IEC ขอ) */
function BucketBar({ proj, leaves, go, isMobile }) {
  const c = bucketCounts(leaves);
  const noNote = redWithoutNote(leaves);
  return (
    <div style={{ marginBottom: 14 }}>
      <SectionHead n="①" title="สรุป EVA ของ sub KPI ทั้งใบ POP"
        sub={`ประเมินแล้ว ${c.total - c.none} จาก ${c.total} หัวข้อ`} />
      <div style={{ display: 'grid', gap: 9, alignContent: 'start',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        {BUCKETS.map(b => {
          const n = c[b.key];
          const meta = evaMeta(b.eva);
          return (
            <button key={b.key} onClick={() => n && go({ cust: proj.customer, proj: proj.id, bucket: b.key })}
              disabled={!n} title={b.hint}
              className={b.key === 'delay' && n ? 'mo-card-alert' : undefined}
              style={{ ...CARD, textAlign: 'left', cursor: n ? 'pointer' : 'default', opacity: n ? 1 : 0.55,
                borderLeft: `3px solid ${meta.color}`, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: meta.color, lineHeight: 1 }}>{n}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{b.label}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>
                {n ? 'กดเพื่อดูรายการ' : 'ยังไม่มีหัวข้อในถังนี้'}
              </div>
            </button>
          );
        })}
        <div style={{ ...CARD, borderLeft: '3px solid var(--border2)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--muted)', lineHeight: 1 }}>{c.none}</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>ยังไม่ประเมิน</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>
            ยังไม่ถึงด่าน หรือยังไม่มีใครตั้งสี — <b>ไม่ใช่ผ่าน</b>
          </div>
        </div>
      </div>
      {!!noNote.length && (
        <div style={{ ...CARD, marginTop: 9, borderLeft: '3px solid #ef4444', fontSize: 12, lineHeight: 1.55 }}>
          ⚠️ <b>แดงแต่ไม่มีคำอธิบาย {noNote.length} หัวข้อ</b> — IEC กำหนดว่าแดงต้องเขียนว่าเกิดอะไร
          แก้ยังไง ไม่งั้นคนมาดูบอร์ดไม่รู้เรื่อง:{' '}
          <span style={{ color: 'var(--text2)' }}>{noNote.map(l => `${l.no} ${l.label}`).join(' · ')}</span>
        </div>
      )}
    </div>
  );
}

/** ② POP STATUS — Main KPI 14 หัวข้อ (จำนวน sub ต่างกันได้ตามรุ่น) */
function PopTable({ proj, go }) {
  if (!proj.pop?.length) {
    return (
      <div style={{ marginBottom: 14 }}>
        <SectionHead n="②" title="POP STATUS" />
        <Empty text="รุ่นนี้ยังไม่ได้ผูกใบ POP เข้าระบบ" />
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 14 }}>
      <SectionHead n="②" title="POP STATUS" sub={`Main KPI ${proj.pop.length} หัวข้อ · กดเพื่อกางหัวข้อย่อย`} />
      <div style={CARD}>
        <Scroller>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
            <thead><tr>
              <th style={{ ...th, width: 34 }}>EVA</th><th style={{ ...th, width: 40 }}>#</th>
              <th style={th}>Topic</th><th style={th}>หัวข้อย่อย</th><th style={th}>สถานะ</th>
            </tr></thead>
            <tbody>
              {proj.pop.map(m => {
                const eva = mainEva(m);
                const kids = m.subs || [];
                const kc = kids.length ? evaCounts(kids) : null;
                return (
                  <tr key={m.key} onClick={() => go({ cust: proj.customer, proj: proj.id, pop: m.key })}
                    style={{ cursor: 'pointer' }}>
                    <td style={td}><Dot eva={eva} title={evaMeta(eva).label} /></td>
                    <td style={{ ...td, color: 'var(--muted)', fontWeight: 700 }}>{m.no}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{m.label}</td>
                    <td style={{ ...td, color: 'var(--muted)', fontSize: 11.5 }}>
                      {kids.length ? `${kids.length} หัวข้อ` : '—'}
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: 'var(--text2)' }}>
                      {kc ? countsLabel(kc) : (m.note || (eva === 'none' ? 'ยังไม่ประเมิน' : evaMeta(eva).label))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Scroller>
        <RuleNote ruleKey="pop" />
      </div>
    </div>
  );
}

/** ③ ล็อตส่งงาน — 2 แกนคนละเกณฑ์: ส่งได้ไหม (delivery) กับ คุณภาพผ่านไหม (quality) */
function LotTable({ proj }) {
  const rows = proj.lotRows;
  if (!rows?.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <SectionHead n="③" title="PART DELIVERY / PART QUALITY STATUS"
        sub={`${rows.length} ล็อต · 2 แกนนี้ใช้เกณฑ์สีคนละชุด`} />
      <div style={CARD}>
        <Scroller>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
            <thead><tr>
              <th style={{ ...th, width: 40 }}>#</th><th style={th}>ล็อต</th>
              <th style={th}>เงื่อนไขที่ต้องผ่าน</th>
              <th style={{ ...th, width: 90 }}>ส่งมอบ</th><th style={{ ...th, width: 90 }}>คุณภาพ</th>
            </tr></thead>
            <tbody>
              {rows.map(l => (
                <tr key={l.key}>
                  <td style={{ ...td, color: 'var(--muted)' }}>{l.no}</td>
                  <td style={{ ...td, fontWeight: 700 }}>
                    {l.label}
                    {l.renamed && <div style={{ fontSize: 11, color: 'var(--accent2)', fontWeight: 400 }}>⚠️ {l.renamed}</div>}
                  </td>
                  <td style={{ ...td, fontSize: 11.5, color: 'var(--text2)' }}>{l.cond}</td>
                  <td style={td}><Dot eva={l.delivery} /> <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{evaMeta(l.delivery).label}</span></td>
                  <td style={td}><Dot eva={l.quality} /> <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{evaMeta(l.quality).label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
        <RuleNote ruleKey="delivery" />
        <RuleNote ruleKey="quality" />
      </div>
    </div>
  );
}

/** ④ Responsible — บอร์ดจริงแปะรูป+เบอร์ไว้ให้โทรหาได้ทันทีตอนเจอของแดง */
function ResponsibleCard({ proj, isMobile }) {
  const list = proj.responsible;
  if (!list?.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <SectionHead n="④" title="Responsible" sub="เจอของแดงแล้วโทรหาใคร" />
      <div style={{ display: 'grid', gap: 9, alignContent: 'start',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {list.map(r => (
          <div key={r.email} style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 700 }}>{r.role}</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{r.name}</div>
            <a href={`tel:${r.tel}`} style={{ fontSize: 12.5, color: 'var(--text2)' }}>📞 {r.tel}</a>
            <a href={`mailto:${r.email}`} style={{ fontSize: 11.5, color: 'var(--text2)', wordBreak: 'break-all' }}>✉️ {r.email}</a>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══ ชั้นที่ 3 — รุ่น (4 แผงตาม work flow IEC) ═══════════════════════════════════════ */
function LevelProject({ proj, go }) {
  const isMobile = useIsMobile();
  const counts = evaCounts(proj.panels);
  const leaves = useMemo(() => flattenPop(proj.pop), [proj.pop]);

  return (
    <>
      <div style={{ display: 'grid', gap: 10, alignContent: 'start', marginBottom: 12,
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(230px, 1fr))' }}>
        {PROJECT_AXES.map(a => <EvaBadge key={a.key} big eva={proj.eva?.[a.key]} label={a.label} />)}
      </div>

      {/* 🔗 หลักฐานของรุ่นนี้อยู่ที่ไหน — ตอบก่อนทุกอย่าง (2026-10-06) */}
      <NpiLinkCard proj={proj} isMobile={isMobile} />
      {proj.evaNote && (
        <div style={{ ...CARD, borderLeft: '3px solid #ef4444', marginBottom: 12, fontSize: 12.5, lineHeight: 1.5 }}>
          <b>ทำไมถึงแดง:</b> {proj.evaNote}
        </div>
      )}

      <BucketBar proj={proj} leaves={leaves} go={go} isMobile={isMobile} />
      <PopTable proj={proj} go={go} />
      <LotTable proj={proj} />
      <ResponsibleCard proj={proj} isMobile={isMobile} />

      {proj.partsNote && (
        <div style={{ ...CARD, marginBottom: 12, fontSize: 12, color: 'var(--text2)' }}>📦 {proj.partsNote}</div>
      )}

      <div style={{ ...CARD, marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 7 }}>เส้นทางด่าน</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {proj.sptt.map(s => (
            <span key={s.name} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5,
              background: 'var(--bg3)', padding: '4px 9px', borderRadius: 99 }}>
              <Dot eva={s.eva} size={10} /><b>{s.name}</b><span style={{ color: 'var(--muted)' }}>{s.plan}</span>
            </span>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 8px' }}>
        แผงบนบอร์ดกระดาษ {proj.panels.length} แผง
        <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11.5 }}> · {countsLabel(counts)} · หลักฐานที่ใบ POP อ้างถึง</span>
      </div>
      <div style={{ display: 'grid', gap: 9, alignContent: 'start',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(245px, 1fr))' }}>
        {proj.panels.map(p => {
          const kind = PANEL_KIND[p.kind] || PANEL_KIND.doc;
          /* น้ำหนักเดียวกับโหมดจอ TV — ใบแดงมีเหตุผลต้องอ่าน กินสองคอลัมน์
             (ลำดับแผงคงเดิมเสมอ ⇒ ห้ามใส่ gridAutoFlow:'dense' มาอุดรู มันสลับที่ใบ) */
          const hot = panelWeight(p) >= 3 && !isMobile;
          return (
            <button key={p.key} onClick={() => go({ cust: proj.customer, proj: proj.id, panel: p.key })}
              data-eva={p.eva || 'none'} className={`nmb-card${hot ? ' mo-card-alert' : ''}`}
              style={{ ...CARD, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column',
                gap: 6, minHeight: 104, gridColumn: hot ? 'span 2' : undefined,
                padding: '12px 13px 12px 17px', borderRadius: 10,
                /* วัสดุชุดเดียวกับโหมดจอ TV — สีอยู่ที่รางซ้าย ไม่ใช่กรอบสีเต็มใบ */
                borderColor: p.eva === 'none' || !p.eva ? 'var(--border)' : `${evaMeta(p.eva).color}4d`,
                '--nmb-color': p.eva === 'none' || !p.eva ? 'var(--border2)' : evaMeta(p.eva).color,
                '--nmb-rail': hot ? '6px' : '4px' }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
                <span className="nmb-num" style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 800,
                  letterSpacing: '0.04em', color: p.eva === 'none' || !p.eva ? 'var(--muted)' : evaMeta(p.eva).color }}>
                  {evaMeta(p.eva).short}
                </span>
                <span style={{ fontSize: hot ? 15 : 13, fontWeight: hot ? 800 : 700, lineHeight: 1.3 }}>{p.label}</span>
                <span className="nmb-go" style={{ marginLeft: 'auto', color: 'var(--text2)', fontSize: 14, flex: '0 0 auto' }}>›</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{kind.icon} {kind.label}</div>
              {p.evaNote
                ? <div style={{ fontSize: hot ? 12.5 : 11.5, color: hot ? 'var(--text)' : 'var(--text2)', lineHeight: 1.45 }}>{p.evaNote}</div>
                : p.eva === 'R'
                  /* กฎ IEC ข้อ 2 — แดงต้องมีข้อความ · ยังไม่เขียน = ฟ้องบนจอ ห้ามปล่อยว่างเนียนๆ */
                  ? <div style={{ fontSize: 11.5, color: '#fca5a5', lineHeight: 1.45 }}>⚠️ แดงแต่ยังไม่เขียนว่าเกิดอะไร / จะแก้ยังไง</div>
                  : null}
              <div style={{ marginTop: 'auto' }}><FreshChip iso={p.updated_at} /></div>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ══ ★ ทางลัด — กดถังแล้วมาที่รายการเลย (?bucket=) ═══════════════════════════════════ */
function LevelBucket({ proj, bucket, go }) {
  const b = BUCKETS.find(x => x.key === bucket);
  const leaves = useMemo(() => leavesInBucket(flattenPop(proj.pop), bucket), [proj.pop, bucket]);
  return (
    <>
      <div style={{ ...CARD, marginBottom: 12, borderLeft: `3px solid ${evaMeta(b?.eva).color}`, fontSize: 12.5, lineHeight: 1.55 }}>
        <b>{b?.label}</b> — {b?.hint}
        <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 3 }}>
          ข้ามจากหัวบอร์ดมาที่นี่โดยไม่ต้องไล่ทีละชั้น (ทางลัดที่ IEC ขอไว้ใน work flow)
        </div>
      </div>
      {!leaves.length ? <Empty text="ไม่มีหัวข้อในถังนี้" /> : (
        <div style={CARD}>
          <Scroller>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead><tr>
                <th style={{ ...th, width: 34 }}>EVA</th><th style={{ ...th, width: 40 }}>#</th>
                <th style={th}>หัวข้อ</th><th style={th}>อยู่ใต้</th><th style={th}>คำอธิบาย</th>
              </tr></thead>
              <tbody>
                {leaves.map(l => (
                  <tr key={l.path} onClick={() => go({ cust: proj.customer, proj: proj.id, pop: l.mainKey })}
                    style={{ cursor: 'pointer' }}>
                    <td style={td}><Dot eva={l.eva} /></td>
                    <td style={{ ...td, color: 'var(--muted)', fontWeight: 700 }}>{l.no}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{l.label}</td>
                    <td style={{ ...td, fontSize: 11.5, color: 'var(--muted)' }}>
                      {l.path === l.mainKey ? '—' : l.mainLabel}
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: l.note ? 'var(--text2)' : '#ef4444' }}>
                      {l.note || (l.eva === 'R' ? '⚠️ แดงแต่ยังไม่มีคำอธิบาย' : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>
        </div>
      )}
    </>
  );
}

/* ══ ชั้นที่ 4 — POP main KPI → sub KPI (?pop=) ══════════════════════════════════════ */
function LevelPop({ proj, main, go }) {
  const kids = main.subs || [];
  const eva = mainEva(main);
  return (
    <>
      <div style={{ ...CARD, marginBottom: 12, borderLeft: `3px solid ${evaMeta(eva).color}` }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <Dot eva={eva} size={17} />
          <b style={{ fontSize: 14 }}>{main.no}. {main.label}</b>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.5 }}>
          ไฟของหัวข้อใหญ่ = <b>แย่สุดของหัวข้อย่อยชนะ</b> — IEC เขียนไว้ว่า
          &ldquo;ถ้ามี 1 ตัวเป็นสีแดง ต้องโชว์แดงเลย&rdquo;
        </div>
        <RuleNote ruleKey="pop" />
      </div>
      {!kids.length ? (
        <div style={CARD}>
          <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            หัวข้อนี้ไม่มีหัวข้อย่อย — ประเมินที่ตัวมันเอง
            {main.panel && <> · หลักฐานอยู่ที่แผง <b>{proj.panels.find(p => p.key === main.panel)?.label}</b></>}
          </div>
          {main.note && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>{main.note}</div>}
          {main.panel && (
            <button onClick={() => go({ cust: proj.customer, proj: proj.id, panel: main.panel })}
              style={{ marginTop: 9, background: 'var(--bg3)', border: '1px solid var(--border)',
                color: 'var(--text)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>
              เปิดแผงหลักฐาน →
            </button>
          )}
        </div>
      ) : (
        <div style={CARD}>
          <Scroller>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead><tr>
                <th style={{ ...th, width: 34 }}>EVA</th><th style={{ ...th, width: 44 }}>#</th>
                <th style={th}>sub KPI</th><th style={th}>ข้างใน</th><th style={th}>ที่มาของไฟ</th>
              </tr></thead>
              <tbody>
                {kids.map(s => {
                  const clickable = !!s.topics?.length;
                  return (
                    <tr key={s.key} style={{ cursor: clickable ? 'pointer' : 'default' }}
                      onClick={() => clickable && go({ cust: proj.customer, proj: proj.id, pop: main.key, sub: s.key })}>
                      <td style={td}><Dot eva={s.eva} /></td>
                      <td style={{ ...td, color: 'var(--muted)', fontWeight: 700 }}>{s.no}</td>
                      <td style={{ ...td, fontWeight: 700 }}>
                        {s.label}
                        {s.owner && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}> · {s.owner}อัปเดตเอง</span>}
                      </td>
                      <td style={{ ...td, fontSize: 11.5, color: 'var(--muted)' }}>
                        {s.topics?.length ? `${s.topics.length} หัวข้อ →` : '—'}
                      </td>
                      <td style={{ ...td, fontSize: 11.5, color: 'var(--text2)' }}>
                        {s.fromStage ? `ด่าน ${s.fromStage}`
                          : s.panel ? `แผง ${proj.panels.find(p => p.key === s.panel)?.label || s.panel}`
                          : 'ยังไม่มีหลักฐานผูกไว้'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Scroller>
        </div>
      )}
    </>
  );
}

/* ══ ชั้นที่ 5 — หัวข้อเอกสารใน 7.1 / 7.2 (?pop=document&sub=) ═══════════════════════ */
function LevelPopSub({ proj, main, sub, go }) {
  const topics = sub.topics || [];
  return (
    <>
      <div style={{ ...CARD, marginBottom: 12, borderLeft: `3px solid ${evaMeta(sub.eva).color}` }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <Dot eva={sub.eva} size={17} /><b style={{ fontSize: 14 }}>{sub.no} {sub.label}</b>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.5 }}>
          {sub.owner ? `ทีม${sub.owner}เข้ามาอัปเดตเอง · ` : ''}ทุกหัวข้อต้องประเมินได้หมด ·
          ของจริงจะแนบไฟล์ + เขียนรายละเอียดได้ในแต่ละแถว
        </div>
        <RuleNote ruleKey="doc" />
      </div>
      {!topics.length ? <Empty text="ยังไม่มีรายการหัวข้อของเอกสารชุดนี้" /> : (
        <div style={CARD}>
          <Scroller>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
              <thead><tr>
                <th style={{ ...th, width: 34 }}>EVA</th><th style={th}>Topic</th>
                <th style={th}>หลักฐาน</th><th style={th}>บันทึก</th>
              </tr></thead>
              <tbody>
                {topics.map(t => (
                  <tr key={t.label} style={{ cursor: t.panel ? 'pointer' : 'default' }}
                    onClick={() => t.panel && go({ cust: proj.customer, proj: proj.id, panel: t.panel })}>
                    <td style={td}><Dot eva={t.eva} /></td>
                    <td style={{ ...td, fontWeight: 700 }}>{t.label}</td>
                    <td style={{ ...td, fontSize: 11.5, color: 'var(--muted)' }}>
                      {t.panel ? `แผง ${proj.panels.find(p => p.key === t.panel)?.label || t.panel} →` : 'ยังไม่ผูก'}
                    </td>
                    <td style={{ ...td, fontSize: 11.5, color: 'var(--text2)' }}>{t.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>
        </div>
      )}
    </>
  );
}

/* ══ ชั้นสุดท้าย — ในแผงบนบอร์ดกระดาษ (วาดตามชนิดของแผง) ═══════════════════════════════════ */
function PanelActivity({ p }) {
  const cols = p.columns || ['กิจกรรม', 'แผน', 'สถานะ'];
  return (
    <Scroller>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
        <thead><tr><th style={{ ...th, width: 34 }}>EVA</th>{cols.map(c => <th key={c} style={th}>{c}</th>)}<th style={th}>ผู้รับผิดชอบ</th></tr></thead>
        <tbody>
          {p.rows.map((r, i) => (
            <tr key={i}>
              <td style={td}><Dot eva={r.eva} /></td>
              <td style={{ ...td, minWidth: 240 }}>{r.name}</td>
              <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--text2)' }}>{r.plan || '–'}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.status || '–'}</td>
              <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{r.pic || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  );
}

function PanelMatrix({ p }) {
  const ms = p.milestones || [];
  const checks = p.checks || [];
  return (
    <Scroller>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
        <thead>
          <tr>
            <th style={th} rowSpan={2}>พาร์ท</th>
            {ms.map((m, i) => <th key={m} style={{ ...th, textAlign: 'center', borderLeft: '1px solid var(--border)' }} colSpan={checks.length + 1}>
              {m}{p.targets?.[i] && <div style={{ fontWeight: 400, color: 'var(--text2)' }}>{p.targets[i]}</div>}
            </th>)}
          </tr>
          <tr>
            {ms.map(m => [...checks.map(c => <th key={`${m}-${c}`} style={{ ...th, textAlign: 'center' }}>{c}</th>),
              <th key={`${m}-eva`} style={{ ...th, textAlign: 'center' }}>EVA</th>])}
          </tr>
        </thead>
        <tbody>
          {p.rows.map(r => (
            <tr key={r.part}>
              <td style={td}><div style={{ fontWeight: 700 }}>{r.part}</div><div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.name}</div></td>
              {ms.map(m => {
                const cell = r.cells?.[m] || {};
                return [...checks.map(c => (
                  <td key={`${m}-${c}`} style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {cell[c] ? (cell[c] === 'Y' ? '✓' : cell[c]) : <span style={{ color: 'var(--muted)' }}>–</span>}
                  </td>
                )), (
                  <td key={`${m}-eva`} style={{ ...td, textAlign: 'center' }}>
                    <span style={{ display: 'inline-flex' }}><Dot eva={cell.eva} /></span>
                  </td>
                )];
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
        ⚪ = ยังไม่ถึงด่าน (ไม่ใช่ไม่ผ่าน) — บนบอร์ดกระดาษคือบล็อกที่ยังเว้นว่างไว้
      </div>
    </Scroller>
  );
}

function PanelIssues({ p }) {
  const STATUS = { open: '🔴 เปิด', doing: '🟡 กำลังแก้', done: '🟢 ปิดแล้ว' };
  return (
    <Scroller>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
        <thead><tr>
          {['#', 'วันที่', 'หมวด', 'ปัญหา', 'สาเหตุ', 'มาตรการ', 'ผู้รับผิดชอบ', 'กำหนด', 'สถานะ'].map(c => <th key={c} style={th}>{c}</th>)}
        </tr></thead>
        <tbody>
          {p.rows.map(r => (
            <tr key={r.no}>
              <td style={td}>{r.no}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.date}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.cat}</td>
              <td style={{ ...td, minWidth: 190 }}>{r.issue}</td>
              <td style={{ ...td, minWidth: 170, color: 'var(--text2)' }}>{r.cause || '–'}</td>
              <td style={{ ...td, minWidth: 190 }}>{r.action}</td>
              <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{r.pic}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.due || '–'}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{STATUS[r.status] || r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  );
}

function PanelDoc({ p }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {p.summary && <div style={{ fontSize: 13, lineHeight: 1.6 }}>{p.summary}</div>}
      {!!p.fields?.length && (
        <Scroller>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
            <tbody>{p.fields.map(([k, v]) => (
              <tr key={k}>
                <td style={{ ...td, width: 190, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{k}</td>
                <td style={td}>{v}</td>
              </tr>
            ))}</tbody>
          </table>
        </Scroller>
      )}
      {!!p.tree?.length && (
        <Scroller>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
            <thead><tr>{['ลำดับ', 'ชื่อชิ้นงาน', 'เลขพาร์ท', 'สเปกวัสดุ'].map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
            <tbody>{p.tree.map(t => (
              <tr key={t.seq}>
                <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{t.seq}</td>
                <td style={{ ...td, paddingLeft: 9 + (t.seq.split('.').length - 1) * 16 }}>
                  {t.name}{t.tag && <span style={{ fontSize: 11, color: 'var(--accent2)', marginLeft: 6 }}>{t.tag}</span>}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{t.no}</td>
                <td style={{ ...td, color: 'var(--text2)' }}>{t.spec}</td>
              </tr>
            ))}</tbody>
          </table>
        </Scroller>
      )}
      {p.table && (
        <Scroller>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead><tr>{p.table.columns.map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
            <tbody>{p.table.rows.map((r, i) => (
              <tr key={i}>{r.map((v, j) => <td key={j} style={{ ...td, whiteSpace: 'nowrap' }}>{v}</td>)}</tr>
            ))}</tbody>
          </table>
        </Scroller>
      )}
    </div>
  );
}

function PanelNetwork({ p }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {p.summary && <div style={{ fontSize: 13 }}>{p.summary}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {p.tiers.map(t => (
          <div key={t.tier} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ width: 88, fontSize: 11.5, color: 'var(--muted)', flex: '0 0 88px' }}>{t.tier}</div>
            {t.nodes.map(n => (
              <span key={n.name} style={{ background: 'var(--bg3)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '6px 11px', fontSize: 12 }}>
                <b>{n.name}</b>{n.note && <span style={{ color: 'var(--muted)' }}> · {n.note}</span>}
              </span>
            ))}
          </div>
        ))}
      </div>
      {!!p.fields?.length && p.fields.map(([k, v]) => (
        <div key={k} style={{ fontSize: 12, color: 'var(--text2)' }}><span style={{ color: 'var(--muted)' }}>{k}:</span> {v}</div>
      ))}
    </div>
  );
}

function LevelPanel({ proj, panel }) {
  const kind = PANEL_KIND[panel.kind] || PANEL_KIND.doc;
  const Body = panel.kind === 'activity' ? PanelActivity
    : panel.kind === 'matrix' ? PanelMatrix
    : panel.kind === 'issues' ? PanelIssues
    : panel.kind === 'network' ? PanelNetwork : PanelDoc;
  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
        <EvaBadge big eva={panel.eva} label={panel.label} note={panel.evaNote} />
        <div style={{ ...CARD, fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>{kind.icon} {kind.label}</span>
          <span>{kind.hint}</span>
          <FreshChip iso={panel.updated_at} />
        </div>
      </div>
      <div style={CARD}><Body p={panel} /></div>
      <PanelNpiLink proj={proj} panel={panel} />
      {panel.key === 'eva-milestone' && (
        <div style={{ ...CARD, marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>เกณฑ์ผ่านของแต่ละด่าน (Requirement of SPTT Milestone)</div>
          <Scroller>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead><tr>{['SPTT', 'ด่านลูกค้า', 'Off-Tool', 'Off-Process', 'คุณภาพที่ต้องได้', 'กำลังผลิตที่ต้องได้'].map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
              <tbody>{SPTT_REQUIREMENTS.map(r => (
                <tr key={r.sptt}>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700 }}>{r.sptt}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.milestone}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{r.offTool}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{r.offProcess}</td>
                  <td style={td}>{r.quality}</td>
                  <td style={{ ...td, color: 'var(--text2)' }}>{r.capacity}</td>
                </tr>
              ))}</tbody>
            </table>
          </Scroller>
        </div>
      )}
      {panel.key === 'pop' && (
        <div style={{ ...CARD, marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>ชุดเอกสารที่ลูกค้าบังคับต่อด่าน (TMA SPTT Document · ตัวเลข = จำนวนหน้า)</div>
          <Scroller>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 660 }}>
              <thead><tr>{['#', 'เอกสาร', 'CV 1st', 'CV 2nd', '1A (LVPT)', 'MPT (HVPT)', 'QCS', 'SOP'].map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
              <tbody>{TMA_SPTT_DOCS.map(d => (
                <tr key={d.seq}>
                  <td style={td}>{d.seq}</td>
                  <td style={td}>{d.doc}</td>
                  {['cv1', 'cv2', 'a1', 'mpt', 'qcs', 'sop'].map(k => (
                    <td key={k} style={{ ...td, textAlign: 'center', color: d[k] ? 'var(--text)' : 'var(--muted)' }}>{d[k] ?? '–'}</td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </Scroller>
        </div>
      )}
    </>
  );
}


/* ══ 📺 โหมดจอ TV 70" — วางทั้งบอร์ดในจอเดียว ไม่มีเลื่อน =======================
   ข้อยกเว้น "บอร์ดจอ TV" ตาม UI-CONVENTIONS §6.8 — เป็นข้อยกเว้นราย *มุมมอง* (`?tv=1`)
   ไม่ใช่ทั้งหน้า · ไม่มี PageHeader/แถบข้อมูล เพราะแนวตั้งทุกพิกเซลเป็นของบอร์ด
   🔴 ห้ามให้จอนี้ต้องเลื่อน — บอร์ดกระดาษคือผนังแผ่นเดียวที่เห็นหมดในพริบตา
   🔴 ต้องมีทางออกเสมอ (ปุ่มมุมขวาบน) ห้ามตัดทางออกแม้เป็นจอแขวน
   ⚠️ เบราว์เซอร์เป้าหมาย = สมาร์ททีวี Chromium 94 → ห้าม dvh/svh · ห้าม color-mix · ห้าม @container
   ═════════════════════════════════════════════════════════════════════════════ */
function TvView({ projects, index, onIndex, onExit, openPanelKey, onPick, onClosePanel }) {
  const proj = projects[index] || projects[0];
  const [now, setNow] = useState(() => new Date());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // สลับรุ่นอัตโนมัติเมื่อมีมากกว่า 1 บอร์ด (จอแขวนไม่มีคนกด)
  useEffect(() => {
    if (paused || openPanelKey || projects.length < 2) return undefined;
    const t = setInterval(() => onIndex((index + 1) % projects.length), 25000);
    return () => clearInterval(t);
  }, [paused, openPanelKey, projects.length, index, onIndex]);

  /* ⎋ ปิดแผงที่เปิดอยู่ — จอแขวนบางตัวมีแต่รีโมท ปุ่ม Back/Esc คือทางออกเดียวที่มี
     🔴 ห้ามหยุดสลับรุ่นค้างไว้ตอนเปิดแผง ถ้าไม่มีใครปิด (จอแขวนไม่มีคนยืนเฝ้า) ⇒ ปิดเองใน 90 วิ */
  useEffect(() => {
    if (!openPanelKey) return undefined;
    const esc = (e) => { if (e.key === 'Escape') onClosePanel?.(); };
    window.addEventListener('keydown', esc);
    const t = setTimeout(() => onClosePanel?.(), 90000);
    return () => { window.removeEventListener('keydown', esc); clearTimeout(t); };
  }, [openPanelKey, onClosePanel]);

  if (!proj) return null;
  const { rows } = tvWeightedLayout(proj.panels);
  /* แถวที่มีใบแดงสูงกว่าแถวเขียวล้วน — น้ำหนักต้องต่างทั้ง "กว้าง" และ "สูง"
     ไม่งั้นแถวที่มี 7 ใบเขียวจะสูงเท่าแถวที่มี 2 ใบแดงที่มี 4 บรรทัดต้องอ่าน */
  const rowFlex = (row) => {
    const top = row.items.reduce((m, p) => Math.max(m, panelWeight(p)), 1);
    return top >= 3 ? 1.45 : top === 2 ? 1.15 : 1;
  };
  const openPanel = proj.panels.find(p => p.key === openPanelKey) || null;
  const counts = evaCounts(proj.panels);
  const clock = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

  const F = { // ขนาดตัวอักษรอิงความกว้างจอ — 70" ดูจากระยะไกล ต้องใหญ่กว่าจอ PC มาก
    title: 'clamp(20px, 2.1vw, 58px)',
    sub:   'clamp(12px, 0.95vw, 26px)',
    axis:  'clamp(13px, 1.05vw, 28px)',
    panel: 'clamp(12px, 1.02vw, 27px)',
    note:  'clamp(10px, 0.78vw, 20px)',
    // ชั้น "ร้อน" (แดง) — ใหญ่กว่าชั้นปกติ ~25% · ขั้นต่ำยังเกิน 11px ตาม UI §จอ TV
    panelHot: 'clamp(14px, 1.3vw, 34px)',
    noteHot:  'clamp(11.5px, 0.92vw, 24px)',
    eyebrow:  'clamp(9px, 0.62vw, 16px)',
    clock:    'clamp(22px, 2.3vw, 62px)',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900, background: 'var(--bg)', color: 'var(--text)',
      display: 'flex', flexDirection: 'column', padding: '1.1vh 1vw', gap: '1vh', overflow: 'clip',
    }}>
      {/* ══ หัวบอร์ด ══ ป้าย MODEL เป็น eyebrow · ชื่อรุ่นเป็น hero เดียวของจอ
           เดิมเขียน "MODEL : 737D MLM" รวมเป็นบรรทัดเดียวขนาดเท่ากันหมด = ไม่มีลำดับสายตา */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.4vw', flex: '0 0 auto' }}>
        <div style={{ minWidth: 0 }}>
          <div className="nmb-eyebrow" style={{ fontSize: F.eyebrow, lineHeight: 1 }}>Model</div>
          <div style={{
            fontSize: F.title, fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.015em',
            whiteSpace: 'nowrap', overflow: 'clip', textOverflow: 'ellipsis', marginTop: '0.3vh',
          }}>{proj.title}</div>
          <div style={{ display: 'flex', gap: '0.5vw', flexWrap: 'wrap', marginTop: '0.6vh' }}>
            {[
              ['ลูกค้า', proj.customer?.toUpperCase()],
              ['ด่าน', proj.stage],
              ['ส่งชิ้นงาน', proj.pad],
              ['ทีม', proj.team],
            ].filter(([, v]) => v).map(([k, v]) => (
              <span key={k} style={{
                display: 'inline-flex', alignItems: 'baseline', gap: '0.3vw',
                background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 999,
                padding: '0.25vh 0.7vw', fontSize: F.sub, whiteSpace: 'nowrap',
              }}>
                <span style={{ color: 'var(--muted)' }}>{k}</span>
                <b className="nmb-num" style={{ color: 'var(--text)' }}>{v}</b>
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1vw', marginLeft: 'auto', alignItems: 'center' }}>
          {PROJECT_AXES.map(a => {
            const k = proj.eva?.[a.key] || 'none';
            const m = evaMeta(k);
            return (
              <div key={a.key} style={{ textAlign: 'center' }}>
                <div className="nmb-ring" style={{
                  width: '4.4vw', height: '4.4vw', maxWidth: 104, maxHeight: 104, minWidth: 44, minHeight: 44,
                  margin: '0 auto', fontWeight: 800, color: k === 'none' ? 'var(--muted)' : m.color,
                  fontSize: 'clamp(15px, 1.75vw, 42px)',
                  '--nmb-color': k === 'none' ? 'var(--border2)' : m.color,
                  '--nmb-glow': k === 'R' ? 'rgba(239,68,68,0.35)' : 'transparent',
                  '--nmb-ring-w': 'clamp(3px, 0.32vw, 8px)',
                }}>{m.short}</div>
                <div className="nmb-eyebrow" style={{ fontSize: F.eyebrow, marginTop: '0.6vh', whiteSpace: 'nowrap' }}>{a.label}</div>
              </div>
            );
          })}
          <div style={{ textAlign: 'right', marginLeft: '0.6vw' }}>
            <div className="nmb-num" style={{ fontSize: F.clock, fontWeight: 300, lineHeight: 1, letterSpacing: '-0.02em' }}>{clock}</div>
            <div style={{ fontSize: F.note, color: 'var(--muted)', marginTop: '0.4vh' }}>ข้อมูลจากบอร์ด {SOURCE_DATE}</div>
          </div>
          <button onClick={onExit} title="ออกจากโหมดจอ TV" style={{
            background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)',
            borderRadius: 999, width: '2.2vw', height: '2.2vw', minWidth: 30, minHeight: 30,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: F.sub, padding: 0,
          }}>✕</button>
        </div>
      </div>

      {/* เส้นคั่นหัวบอร์ดกับเนื้อบอร์ด — hairline ไล่จาง ไม่ใช่เส้นตรงทึบทั้งเส้น */}
      <div style={{ flex: '0 0 auto', height: 1, background: 'linear-gradient(90deg, var(--border2), rgba(0,0,0,0) 70%)' }} />

      {/* เหตุผลที่แดง — บนบอร์ดจริงเป็นกล่องคำอธิบายชี้ที่แถวต้นเหตุ */}
      {proj.evaNote && (
        <div className="nmb-card" data-eva="R" style={{
          flex: '0 0 auto', borderRadius: 10, padding: '0.8vh 1vw 0.8vh 1.5vw',
          '--nmb-color': '#ef4444', '--nmb-rail': 'clamp(4px, 0.3vw, 8px)',
        }}>
          {/* ป้ายไทย — ห้ามใช้ชั้น .nmb-eyebrow (letter-spacing .16em ดันสระ/วรรณยุกต์ออกจากพยัญชนะ) */}
          <div style={{ fontSize: F.eyebrow, color: '#f87171', fontWeight: 700, letterSpacing: '0.02em' }}>ทำไมบอร์ดถึงแดง</div>
          <div style={{ fontSize: F.axis, lineHeight: 1.35, marginTop: '0.25vh' }}>{proj.evaNote}</div>
        </div>
      )}

      {/* ผังแผง — แถวละหลายใบ กว้างตามน้ำหนัก (แดง 3 : เหลือง 2 : เขียว/ยังไม่ประเมิน 1)
         🔴 ความกว้าง = "ปริมาณที่ต้องอ่าน" ไม่ใช่ลำดับความสำคัญลอยๆ · ลำดับแผงคงเดิมเสมอ
         🔴 ห้ามกลับไปใช้กริด 1fr เท่ากันทุกใบ — 67% ของใบไม่มีข้อความให้อ่าน แต่กินที่เท่าใบแดง
            (feedback user 2026-10-05) · สูตรอยู่ที่ tvWeightedLayout ห้ามคิดเองในหน้า */}
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.8vh' }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ flex: `${rowFlex(row)} 1 0`, minHeight: 0, display: 'flex', gap: '0.6vw' }}>
            {row.items.map(p => {
              const m = evaMeta(p.eva);
              const w = panelWeight(p);
              const hot = p.eva === 'R';
              return (
                <button key={p.key} onClick={() => onPick(p)} title={`เปิดแผง ${p.label}`}
                  data-eva={p.eva || 'none'}
                  className={`nmb-card${hot ? ' mo-card-alert' : ''}`}
                  style={{
                    flex: `${w} 1 0`, minWidth: 0, minHeight: 0, overflow: 'clip', textAlign: 'left',
                    font: 'inherit', color: 'var(--text)', cursor: 'pointer',
                    borderRadius: 10, borderColor: p.eva === 'none' || !p.eva ? 'var(--border)' : `${m.color}4d`,
                    /* สีสถานะอยู่ที่ "ราง" ซ้าย + พื้นไล่สีจางๆ — ไม่ใช่กรอบสีเต็มใบทั้ง 21 ใบ */
                    '--nmb-color': p.eva === 'none' || !p.eva ? 'var(--border2)' : m.color,
                    '--nmb-rail': hot ? 'clamp(5px, 0.34vw, 9px)' : 'clamp(3px, 0.2vw, 6px)',
                    backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0) 46%)${
                      hot ? `, linear-gradient(100deg, ${m.color}1f, rgba(0,0,0,0) 62%)` : ''}`,
                    padding: hot ? '1vh 1vw 1vh 1.5vw' : '0.7vh 0.7vw 0.7vh 1.1vw',
                    display: 'flex', flexDirection: 'column', gap: '0.35vh',
                  }}>
                  <div style={{ display: 'flex', gap: '0.45vw', alignItems: 'baseline', minWidth: 0 }}>
                    {/* 🔤 ตัวอักษร EVA — สถานะต้องอ่านได้โดย**ไม่พึ่งสีอย่างเดียว**
                        (ตาบอดสี/จอ TV ที่สีเพี้ยน · กติกาเดียวกับวงแหวน R/Y/G บนหัวบอร์ด) */}
                    <span className="nmb-num" style={{
                      flex: '0 0 auto', fontSize: F.note, fontWeight: 800, letterSpacing: '0.04em',
                      color: p.eva === 'none' || !p.eva ? 'var(--muted)' : m.color,
                    }}>{m.short}</span>
                    <span style={{
                      fontSize: hot ? F.panelHot : F.panel, fontWeight: hot ? 800 : 700,
                      lineHeight: 1.16, minWidth: 0, letterSpacing: hot ? '-0.01em' : 0,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'clip',
                    }}>{p.label}</span>
                    <span className="nmb-go" style={{ marginLeft: 'auto', color: 'var(--text2)', fontSize: F.panel, flex: '0 0 auto' }}>›</span>
                  </div>
                  {p.evaNote ? (
                    /* 🔴 ต้องมี `flex:'0 1 auto'` + `minHeight:0` — ไม่งั้นกล่องข้อความไม่ยอมหด
                       แล้วบรรทัด "อัปเดต N วันก่อน" ถูกดันทับข้อความ (เจอจริงที่ใบ Order Information
                       บนจอ 1366 · 2026-10-05) · ใบน้ำหนัก 1 แคบกว่า ⇒ ตัดที่ 2 บรรทัด */
                    <div style={{
                      flex: '0 1 auto', minHeight: 0,
                      fontSize: hot ? F.noteHot : F.note, color: hot ? 'var(--text)' : 'var(--text2)', lineHeight: 1.32,
                      display: '-webkit-box', WebkitLineClamp: hot ? 4 : w === 2 ? 3 : 2,
                      WebkitBoxOrient: 'vertical', overflow: 'clip',
                    }}>{p.evaNote}</div>
                  ) : hot ? (
                    /* กฎ IEC ข้อ 2: แดงต้องมีข้อความ — ยังไม่เขียน = ฟ้องบนจอ ห้ามย่อการ์ดให้เนียน */
                    <div style={{ fontSize: F.noteHot, color: '#fca5a5', lineHeight: 1.32 }}>
                      ⚠️ แดงแต่ยังไม่เขียนว่าเกิดอะไร / จะแก้ยังไง
                    </div>
                  ) : null}
                  <div style={{ marginTop: 'auto', flex: '0 0 auto', fontSize: F.note,
                    color: freshness(p.updated_at) === 'fresh' ? 'var(--muted)' : '#eab308' }}>
                    {freshLabel(p.updated_at)}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* 🔎 แผงที่กดเจาะ — ซ้อนบนบอร์ด ไม่ใช่ออกจากโหมดจอ TV
           บอร์ดยังอยู่ข้างหลัง ⇒ คนที่ยืนประชุมไม่หลุดบริบทว่ากำลังดูรุ่นไหน
           🔴 บอร์ด (ข้างหลัง) ห้ามเลื่อน — แต่ "ใบที่เปิดอ่าน" เลื่อนในตัวเองได้
              (ตาราง Kadai/เมทริกซ์พาร์ท ยาวเกินจอจริง · ตัดทิ้ง = จอโกหก) */}
      {openPanel && (
        <div onClick={onClosePanel} style={{
          position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(2,6,23,0.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3vh 3vw',
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12,
            width: 'min(1500px, 94vw)', maxHeight: '94vh', overflow: 'auto',
            padding: '18px 20px', boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                {proj.title} · แผงบนบอร์ด
              </div>
              <button onClick={onClosePanel} style={{
                marginLeft: 'auto', background: 'var(--bg3)', border: '1px solid var(--border)',
                color: 'var(--text)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13,
              }}>✕ ปิด (Esc)</button>
            </div>
            <LevelPanel proj={proj} panel={openPanel} />
          </div>
        </div>
      )}

      {/* แถบล่าง — ตัวนับสี + ตัวสลับรุ่น */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '1vw', fontSize: F.sub, color: 'var(--muted)' }}>
        {/* ตัวนับสถานะเป็น "ชิป" — ตัวอักษร EVA + จำนวน (ไม่ใช่อีโมจิวงกลมต่อกันเป็นพรืด)
            🔴 ชิปที่นับได้ 0 ต้องยังอยู่ แค่จาง — "ไม่มีใบแดงเลย" เป็นข้อมูล ห้ามให้หายไปเฉยๆ */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.45vw', flexWrap: 'wrap' }}>
          <span className="nmb-num" style={{ color: 'var(--text2)' }}>{proj.panels.length} แผง</span>
          {['R', 'Y', 'G', 'none'].map(k => {
            const m = evaMeta(k);
            const n = counts[k] || 0;
            return (
              <span key={k} title={m.label} style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3vw', opacity: n ? 1 : 0.35,
                background: 'var(--bg2)', border: `1px solid ${n ? `${m.color}59` : 'var(--border)'}`,
                borderRadius: 999, padding: '0.2vh 0.55vw', fontSize: F.sub, lineHeight: 1.3,
              }}>
                <span style={{ width: '0.5vw', height: '0.5vw', minWidth: 7, minHeight: 7, maxWidth: 12, maxHeight: 12,
                  borderRadius: '50%', background: m.color, flex: '0 0 auto' }} />
                <b className="nmb-num" style={{ color: 'var(--text)' }}>{n}</b>
                <span style={{ color: 'var(--muted)' }}>{m.label}</span>
              </span>
            );
          })}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.5vw', alignItems: 'center' }}>
          {projects.length > 1 && (
            <>
              <button onClick={() => setPaused(v => !v)} style={{
                background: 'none', border: '1px solid var(--border)', color: 'var(--text2)',
                borderRadius: 6, padding: '0.3vh 0.6vw', cursor: 'pointer', fontSize: F.sub,
              }}>{paused ? '▶ เล่นต่อ' : '⏸ หยุดสลับ'}</button>
              {projects.map((pj, i) => (
                <button key={pj.id} onClick={() => onIndex(i)} title={pj.title} style={{
                  width: '0.8vw', height: '0.8vw', minWidth: 10, minHeight: 10, borderRadius: '50%',
                  border: 'none', cursor: 'pointer', padding: 0,
                  background: i === index ? 'var(--accent)' : 'var(--border2)',
                }} />
              ))}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/* ══ หน้า ═══════════════════════════════════════════════════════════════════ */
export default function NewModelBoard() {
  const data = useBoardData();
  const [sp, setSp] = useSearchParams();
  const custCode = sp.get('cust') || '';
  const projId = sp.get('proj') || '';
  const panelKey = sp.get('panel') || '';
  const popKey = sp.get('pop') || '';
  const subKey = sp.get('sub') || '';
  const bucketKey = sp.get('bucket') || '';

  const tvOn = sp.get('tv') === '1';
  // 📺 จอแขวนจะถูกตั้ง URL ไว้ถาวร (เช่น ?proj=d02d-tmt&tv=1) ⇒ ต้องเปิดมาที่รุ่นนั้นเลย
  //    ไม่ใช่เริ่มที่รุ่นแรกเสมอ (เคยพลาดตอนทดสอบ: ลิงก์ D02D แต่จอขึ้น 737D)
  const [tvIndex, setTvIndex] = useState(() => {
    const i = PROJECTS.findIndex(p => p.id === sp.get('proj'));
    return i >= 0 ? i : 0;
  });
  useEffect(() => {
    const i = PROJECTS.findIndex(p => p.id === projId);
    if (i >= 0) setTvIndex(i);
  }, [projId]);

  const cust = data.customers.find(c => c.code === custCode) || null;
  const proj = cust?.projects.find(p => p.id === projId) || null;
  const panel = proj?.panels.find(p => p.key === panelKey) || null;
  const popMain = proj?.pop?.find(m => m.key === popKey) || null;
  const popSub = popMain?.subs?.find(s => s.key === subKey) || null;
  const bucket = bucketKey && BUCKETS.some(b => b.key === bucketKey) ? bucketKey : '';

  const go = (next) => {
    const q = new URLSearchParams();
    if (next.cust) q.set('cust', next.cust);
    if (next.proj) q.set('proj', next.proj);
    if (next.panel) q.set('panel', next.panel);
    if (next.pop) q.set('pop', next.pop);
    if (next.sub) q.set('sub', next.sub);
    if (next.bucket) q.set('bucket', next.bucket);
    if (next.tv) q.set('tv', next.tv);
    setSp(q);
  };

  const deep = !!(panel || popMain || bucket);
  const trail = [
    { label: '🧭 ภาพรวม', onClick: (cust || proj || deep) ? () => go({}) : null },
    cust && { label: cust.name, onClick: (proj || deep) ? () => go({ cust: cust.code }) : null },
    proj && { label: proj.title, onClick: deep ? () => go({ cust: cust.code, proj: proj.id }) : null },
    bucket && { label: BUCKETS.find(b => b.key === bucket)?.label },
    popMain && { label: `${popMain.no}. ${popMain.label}`,
      onClick: popSub ? () => go({ cust: cust.code, proj: proj.id, pop: popMain.key }) : null },
    popSub && { label: `${popSub.no} ${popSub.label}` },
    panel && { label: panel.label },
  ].filter(Boolean);

  const sub = popSub ? `${popSub.no} ${popSub.label} · ${proj.title}`
    : popMain ? `POP ข้อ ${popMain.no} · ${proj.title}`
    : bucket ? `${BUCKETS.find(b => b.key === bucket)?.label} · ${proj.title}`
    : panel ? `แผงบนบอร์ดของ ${proj.title}`
    : proj ? `${proj.title} · ด่าน ${proj.stage} · ทีม ${proj.team} · ผู้นำโปรเจค ${proj.leader}`
    : cust ? `รุ่นของ ${cust.name} ที่อยู่ในระบบ`
    : `ถอดจากบอร์ดผนังของ IEC เมื่อ ${SOURCE_DATE} · ยังไม่ต่อฐานข้อมูล`;

  if (tvOn && data.projects.length) {
    const tvProj = data.projects[Math.min(tvIndex, data.projects.length - 1)];
    return <TvView projects={data.projects} index={Math.min(tvIndex, data.projects.length - 1)}
      onIndex={setTvIndex} onExit={() => go({ cust: custCode || undefined, proj: projId || undefined })}
      openPanelKey={panelKey}
      /* กดการ์ด = เปิดแผงซ้อนบนบอร์ด **คง `tv=1` ไว้** — ออกจากโหมดจอไปเลยจะทำให้
         จอแขวนที่ไม่มีคีย์บอร์ดกลับเข้าโหมดจอเองไม่ได้ (เคยเป็นกับดักของหน้าอื่นมาแล้ว) */
      onPick={(p) => go({ cust: tvProj.customer, proj: tvProj.id, panel: p.key, tv: '1' })}
      onClosePanel={() => go({ cust: tvProj.customer, proj: tvProj.id, tv: '1' })} />;
  }

  return (
    <Page>
      {/* UI-STANDARD 2026-09-24: กรอบ <Page> + ปุ่มโหมดจอ TV ย้ายเข้า actions ของหัวเพจ (โหมด ?tv=1 ยังเต็มจอเหมือนเดิม) */}
      <PageHeader title="บอร์ด New Model (IEC)" icon="🧭" sub={sub}
        actions={proj && !panel && !popMain && !bucket ? (
          <button onClick={() => { setTvIndex(Math.max(0, data.projects.findIndex(p => p.id === proj.id))); go({ cust: cust.code, proj: proj.id, tv: '1' }); }}
            style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)',
              borderRadius: 8, padding: '7px 13px', cursor: 'pointer', fontSize: 12.5 }}>
            📺 เปิดโหมดจอ TV (70 นิ้ว)
          </button>
        ) : null} />
      <Trail items={trail} />

      <div style={{ ...CARD, borderLeft: '3px solid var(--accent2)', marginBottom: 12, fontSize: 12, lineHeight: 1.55 }}>
        ℹ️ <b>เฟสดูภาพรวม</b> — ข้อมูลถอดจากรูปบอร์ดกระดาษ ({SOURCE_DATE}) ยังแก้ในจอไม่ได้ และยังไม่ต่อฐานข้อมูล ·
        ลูกค้าที่ไม่มีโปรเจคในระบบขึ้นเป็นสีเทา <b>ไม่ใช่เขียว</b> เพราะยังไม่มีข้อมูลจริง ·
        รายละเอียดการออกแบบอยู่ใน <code>docs/IEC-NEW-MODEL-OBEYA-DESIGN.md</code>
      </div>

      {panel ? <LevelPanel proj={proj} panel={panel} />
        : popSub ? <LevelPopSub proj={proj} main={popMain} sub={popSub} go={go} />
        : popMain ? <LevelPop proj={proj} main={popMain} go={go} />
        : bucket && proj ? <LevelBucket proj={proj} bucket={bucket} go={go} />
        : proj ? <LevelProject proj={proj} go={go} />
        : cust ? <LevelCustomer cust={cust} go={go} />
        : <LevelOverview data={data} go={go} />}
    </Page>
  );
}
