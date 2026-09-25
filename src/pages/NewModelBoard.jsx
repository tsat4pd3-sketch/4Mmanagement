import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import useIsMobile from '../utils/useIsMobile';
import {
  EVA, evaMeta, rollupEva, evaCounts, countsLabel, freshness, freshLabel,
  PROJECT_AXES, projectEva, customerEva, PANEL_KIND, panelsNeedingAttention, overdueActions, tvGrid,
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
function TvView({ projects, index, onIndex, onExit }) {
  const proj = projects[index] || projects[0];
  const [now, setNow] = useState(() => new Date());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // สลับรุ่นอัตโนมัติเมื่อมีมากกว่า 1 บอร์ด (จอแขวนไม่มีคนกด)
  useEffect(() => {
    if (paused || projects.length < 2) return undefined;
    const t = setInterval(() => onIndex((index + 1) % projects.length), 25000);
    return () => clearInterval(t);
  }, [paused, projects.length, index, onIndex]);

  if (!proj) return null;
  const { cols, rows } = tvGrid(proj.panels.length);
  const counts = evaCounts(proj.panels);
  const clock = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });

  const F = { // ขนาดตัวอักษรอิงความกว้างจอ — 70" ดูจากระยะไกล ต้องใหญ่กว่าจอ PC มาก
    title: 'clamp(20px, 2.1vw, 58px)',
    sub:   'clamp(12px, 0.95vw, 26px)',
    axis:  'clamp(13px, 1.05vw, 28px)',
    panel: 'clamp(12px, 1.02vw, 27px)',
    note:  'clamp(10px, 0.78vw, 20px)',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900, background: 'var(--bg)', color: 'var(--text)',
      display: 'flex', flexDirection: 'column', padding: '1.1vh 1vw', gap: '1vh', overflow: 'clip',
    }}>
      {/* หัวบอร์ด */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.4vw', flex: '0 0 auto' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: F.title, fontWeight: 800, lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'clip', textOverflow: 'ellipsis' }}>
            MODEL : {proj.title}
          </div>
          <div style={{ fontSize: F.sub, color: 'var(--muted)' }}>
            ลูกค้า {proj.customer?.toUpperCase()} · ด่าน {proj.stage} · ส่งชิ้นงาน {proj.pad} · ทีม {proj.team}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.8vw', marginLeft: 'auto', alignItems: 'center' }}>
          {PROJECT_AXES.map(a => {
            const m = evaMeta(proj.eva?.[a.key]);
            return (
              <div key={a.key} style={{ textAlign: 'center' }}>
                <div style={{
                  width: '4.2vw', height: '4.2vw', maxWidth: 96, maxHeight: 96, minWidth: 40, minHeight: 40,
                  borderRadius: '50%', background: m.color, color: '#0b1220', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'clamp(16px, 1.9vw, 46px)', margin: '0 auto',
                  opacity: (proj.eva?.[a.key] || 'none') === 'none' ? 0.5 : 1,
                }}>{m.short}</div>
                <div style={{ fontSize: F.axis, marginTop: '0.4vh', whiteSpace: 'nowrap' }}>{a.label}</div>
              </div>
            );
          })}
          <div style={{ textAlign: 'right', marginLeft: '0.8vw' }}>
            <div style={{ fontSize: F.title, fontWeight: 700, lineHeight: 1 }}>{clock}</div>
            <div style={{ fontSize: F.note, color: 'var(--muted)' }}>ข้อมูลจากบอร์ด {SOURCE_DATE}</div>
          </div>
          <button onClick={onExit} title="ออกจากโหมดจอ TV" style={{
            background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)',
            borderRadius: 8, padding: '0.6vh 0.7vw', cursor: 'pointer', fontSize: F.sub,
          }}>✕</button>
        </div>
      </div>

      {/* เหตุผลที่แดง — บนบอร์ดจริงเป็นกล่องคำอธิบายชี้ที่แถวต้นเหตุ */}
      {proj.evaNote && (
        <div style={{
          flex: '0 0 auto', background: 'var(--card)', borderLeft: '0.4vw solid #ef4444',
          borderRadius: 6, padding: '0.7vh 0.9vw', fontSize: F.axis, lineHeight: 1.35,
        }}>{proj.evaNote}</div>
      )}

      {/* ผังแผง — 1fr ทุกช่อง ⇒ สูงเท่ากันและลงจอพอดีเสมอ */}
      <div style={{
        flex: '1 1 auto', minHeight: 0, display: 'grid', gap: '0.8vh 0.6vw',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}>
        {proj.panels.map(p => {
          const m = evaMeta(p.eva);
          return (
            <div key={p.key} className={p.eva === 'R' ? 'mo-card-alert' : undefined} style={{
              background: 'var(--card)', border: `2px solid ${p.eva === 'none' || !p.eva ? 'var(--border)' : m.color}`,
              borderRadius: 8, padding: '0.7vh 0.7vw', display: 'flex', flexDirection: 'column',
              gap: '0.4vh', minWidth: 0, minHeight: 0, overflow: 'clip',
            }}>
              <div style={{ display: 'flex', gap: '0.45vw', alignItems: 'center', minWidth: 0 }}>
                <span style={{
                  width: '0.95vw', height: '0.95vw', minWidth: 10, minHeight: 10, maxWidth: 22, maxHeight: 22,
                  borderRadius: '50%', background: m.color, flex: '0 0 auto',
                  opacity: p.eva === 'none' || !p.eva ? 0.5 : 1,
                }} />
                <span style={{
                  fontSize: F.panel, fontWeight: 700, lineHeight: 1.18, minWidth: 0,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'clip',
                }}>{p.label}</span>
              </div>
              {p.evaNote && (
                <div style={{
                  fontSize: F.note, color: 'var(--text2)', lineHeight: 1.3,
                  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'clip',
                }}>{p.evaNote}</div>
              )}
              <div style={{ marginTop: 'auto', fontSize: F.note, color: freshness(p.updated_at) === 'fresh' ? 'var(--muted)' : '#eab308' }}>
                {freshLabel(p.updated_at)}
              </div>
            </div>
          );
        })}
      </div>

      {/* แถบล่าง — ตัวนับสี + ตัวสลับรุ่น */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '1vw', fontSize: F.sub, color: 'var(--muted)' }}>
        <span>{proj.panels.length} แผง · {countsLabel(counts)}</span>
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
    return <TvView projects={data.projects} index={Math.min(tvIndex, data.projects.length - 1)}
      onIndex={setTvIndex} onExit={() => go({ cust: custCode || undefined, proj: projId || undefined })} />;
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
