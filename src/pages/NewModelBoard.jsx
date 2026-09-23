import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import useIsMobile from '../utils/useIsMobile';
import {
  EVA, evaMeta, rollupEva, evaCounts, countsLabel, freshness, freshLabel,
  PROJECT_AXES, projectEva, customerEva, PANEL_KIND, panelsNeedingAttention, overdueActions,
} from '../utils/nmBoard';
import {
  IEC_TEAMS, CUSTOMERS, PROJECTS, SPTT_REQUIREMENTS, TMA_SPTT_DOCS, SOURCE_DATE,
} from '../data/nmBoard737D';

/* ══ 🧭 บอร์ด New Model (IEC) — บอร์ด OBEYA ของงานพาร์ทรุ่นใหม่ในเวอร์ชันออนไลน์ ═════════
   ไล่ดู 4 ชั้น: ภาพรวม → ลูกค้า → รุ่น (บอร์ด 21 แผง) → ในแผง
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

function EvaBadge({ eva, label, note, big }) {
  const m = evaMeta(eva);
  return (
    <div style={{ ...CARD, display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
      <div style={{
        width: big ? 40 : 30, height: big ? 40 : 30, borderRadius: '50%', flex: `0 0 ${big ? 40 : 30}px`,
        background: m.color, color: '#0b1220', fontWeight: 800, fontSize: big ? 18 : 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: eva === 'none' || !eva ? 0.55 : 1,
      }}>{m.short}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
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

/* ══ ชั้นที่ 3 — บอร์ด 21 แผงของรุ่น ═════════════════════════════════════════ */
function LevelProject({ proj, go }) {
  const isMobile = useIsMobile();
  const counts = evaCounts(proj.panels);
  return (
    <>
      <div style={{ display: 'grid', gap: 10, alignContent: 'start', marginBottom: 12,
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(230px, 1fr))' }}>
        {PROJECT_AXES.map(a => <EvaBadge key={a.key} big eva={proj.eva?.[a.key]} label={a.label} />)}
      </div>
      {proj.evaNote && (
        <div style={{ ...CARD, borderLeft: '3px solid #ef4444', marginBottom: 12, fontSize: 12.5, lineHeight: 1.5 }}>
          <b>ทำไมถึงแดง:</b> {proj.evaNote}
        </div>
      )}

      {!!proj.lots?.length && (
        <div style={{ ...CARD, marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 7 }}>
            ล็อตส่งงานของโปรเจคนี้ <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11.5 }}>
              · แกนนี้เป็นของ "โปรเจค" ไม่ใช่ของลูกค้า — คนละชุดกับรุ่นอื่นของลูกค้าเดียวกันได้</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {proj.lots.map(l => (
              <span key={l} style={{ fontSize: 11.5, background: 'var(--bg3)', padding: '3px 9px', borderRadius: 99 }}>{l}</span>
            ))}
          </div>
          {proj.evaStatus && (
            <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 8, lineHeight: 1.5 }}>
              ใบ <b>PROJECT EVA STATUS</b> บนบอร์ดนับตัวชี้วัดแยกรายล็อต —
              KPI หลัก <b>{proj.evaStatus.mainTotal}</b> หัวข้อ · หัวข้อย่อย <b>{proj.evaStatus.subTotal}</b> หัวข้อ
              {proj.evaStatus.note && <div style={{ color: 'var(--accent2)' }}>⚠️ {proj.evaStatus.note}</div>}
            </div>
          )}
        </div>
      )}
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
        แผงบนบอร์ด {proj.panels.length} แผง <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11.5 }}>· {countsLabel(counts)}</span>
      </div>
      <div style={{ display: 'grid', gap: 9, alignContent: 'start',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(245px, 1fr))' }}>
        {proj.panels.map(p => {
          const kind = PANEL_KIND[p.kind] || PANEL_KIND.doc;
          return (
            <button key={p.key} onClick={() => go({ cust: proj.customer, proj: proj.id, panel: p.key })}
              style={{ ...CARD, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column',
                gap: 6, minHeight: 104 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                <Dot eva={p.eva} size={15} />
                <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{p.label}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{kind.icon} {kind.label}</div>
              {p.evaNote && <div style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.45 }}>{p.evaNote}</div>}
              <div style={{ marginTop: 'auto' }}><FreshChip iso={p.updated_at} /></div>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ══ ชั้นที่ 4 — ในแผง (วาดตามชนิดของแผง) ═══════════════════════════════════ */
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

/* ══ หน้า ═══════════════════════════════════════════════════════════════════ */
export default function NewModelBoard() {
  const data = useBoardData();
  const [sp, setSp] = useSearchParams();
  const custCode = sp.get('cust') || '';
  const projId = sp.get('proj') || '';
  const panelKey = sp.get('panel') || '';

  const cust = data.customers.find(c => c.code === custCode) || null;
  const proj = cust?.projects.find(p => p.id === projId) || null;
  const panel = proj?.panels.find(p => p.key === panelKey) || null;

  const go = (next) => {
    const q = new URLSearchParams();
    if (next.cust) q.set('cust', next.cust);
    if (next.proj) q.set('proj', next.proj);
    if (next.panel) q.set('panel', next.panel);
    setSp(q);
  };

  const trail = [
    { label: '🧭 ภาพรวม', onClick: (cust || proj || panel) ? () => go({}) : null },
    cust && { label: cust.name, onClick: (proj || panel) ? () => go({ cust: cust.code }) : null },
    proj && { label: proj.title, onClick: panel ? () => go({ cust: cust.code, proj: proj.id }) : null },
    panel && { label: panel.label },
  ].filter(Boolean);

  const sub = panel ? `แผงบนบอร์ดของ ${proj.title}`
    : proj ? `${proj.title} · ด่าน ${proj.stage} · ทีม ${proj.team} · ผู้นำโปรเจค ${proj.leader}`
    : cust ? `รุ่นของ ${cust.name} ที่อยู่ในระบบ`
    : `ถอดจากบอร์ดผนังของ IEC เมื่อ ${SOURCE_DATE} · ยังไม่ต่อฐานข้อมูล`;

  return (
    <div style={{ padding: 14, maxWidth: 1500, margin: '0 auto' }}>
      <PageHeader title="บอร์ด New Model (IEC)" icon="🧭" sub={sub} />
      <Trail items={trail} />

      <div style={{ ...CARD, borderLeft: '3px solid var(--accent2)', marginBottom: 12, fontSize: 12, lineHeight: 1.55 }}>
        ℹ️ <b>เฟสดูภาพรวม</b> — ข้อมูลถอดจากรูปบอร์ดกระดาษ ({SOURCE_DATE}) ยังแก้ในจอไม่ได้ และยังไม่ต่อฐานข้อมูล ·
        ลูกค้าที่ไม่มีโปรเจคในระบบขึ้นเป็นสีเทา <b>ไม่ใช่เขียว</b> เพราะยังไม่มีข้อมูลจริง ·
        รายละเอียดการออกแบบอยู่ใน <code>docs/IEC-NEW-MODEL-OBEYA-DESIGN.md</code>
      </div>

      {panel ? <LevelPanel proj={proj} panel={panel} />
        : proj ? <LevelProject proj={proj} go={go} />
        : cust ? <LevelCustomer cust={cust} go={go} />
        : <LevelOverview data={data} go={go} />}
    </div>
  );
}
