import { useMemo, useState } from 'react';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import OrgScopePicker from '../components/OrgScopePicker';
import InfoMore from '../components/InfoMore';
import { toast } from '../components/Toast';
import useTabParam from '../utils/useTabParam';
import useProductionLines from '../utils/useProductionLines';
import useOrgScope from '../utils/useOrgScope';
import { isPlant, scopeKey, scopeCovers, scopePathText, sameScope, PLANT } from '../utils/orgScope';
import { rint, rnd } from '../utils/seededRandom';
import { getWorkDate, addDaysStr } from '../utils/workDate';

/* ══ 📢 ประกาศ / ชี้แจงบริษัท — MOCKUP workflow (2026-10-29 · คำสั่ง user จากโน้ตลายมือ) ══════════
   โจทย์: "Workflow การรับประกาศของบริษัท"  Issue → Approve → Publish
     · ผู้แจ้งกรอก หัวข้อ · รายละเอียด · ผู้รับ (เลือกขอบเขตจากผังองค์กร) · Effective date
     · Submit ⇒ แจ้งเตือนหัวหน้า (สมมติ = EVP) · อนุมัติแล้ว ⇒ แจ้งผู้แจ้ง
     · ถึง Effective date ⇒ ระบบประกาศถึง user ในส่วนงานที่เลือก

   ⚠️ เป็นตัวอย่างหน้าจอ ไม่ใช่ระบบจริง — **ไม่เขียน DB ใดๆ** ข้อมูลประกาศ/แจ้งเตือนอยู่ใน state ของหน้า
      (รีเฟรช = เริ่มใหม่) · อ่านของจริงอย่างเดียวคือผังองค์กร (useOrgScope) เพื่อให้เลือกขอบเขตได้ตรงผัง
   · "ผู้รับเห็นไหม" ตัดสินด้วย `scopeCovers()` ตัวเดียวกับที่ KPI ใช้ — ขอบเขตแม่ครอบหน่วยลูกทั้งหมด
   · Step 4 Feedback = พนักงานกด "รับทราบ" แล้วนับ X / N คน (user 29/10) — **ไม่ปิดขั้น โชว์ตัวเลขอย่างเดียว**
     ผู้รับ N = **รายชื่อจำลอง** 2–4 คนต่อหน่วยในผัง (seeded — ตัวเลขนิ่งทุกครั้งที่รีเฟรช) ไม่แตะ employees จริง
   · วันที่จำลอง = ปุ่มเลื่อนวัน เพื่อเดโมว่าประกาศขึ้นตาม Effective date (ไม่ต้องรอวันจริง)
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

const TABS = [
  { key: 'issue', label: '📝 ผู้แจ้ง (Issue)' },
  { key: 'approve', label: '✅ EVP อนุมัติ (Approve)' },
  { key: 'board', label: '📢 พนักงาน (Publish)' },
];

const ISSUER = 'ผู้แจ้ง (ตัวอย่าง)';
const APPROVER = 'EVP (ตัวอย่าง)';

const STATUS = {
  pending:   { label: 'รอ EVP อนุมัติ', color: '#f59e0b' },
  scheduled: { label: 'อนุมัติแล้ว · รอถึงวันมีผล', color: '#4d9fff' },
  published: { label: 'ประกาศแล้ว', color: '#22c55e' },
  rejected:  { label: 'ตีกลับ', color: '#ef4444' },
};
/* published/scheduled ไม่เก็บเป็นสถานะ — คิดจาก approved + effective date เทียบวันจำลอง
   (เก็บแยก = ต้องมีงานเบื้องหลังมาพลิกสถานะ ไม่มีใครพลิก = ประกาศค้างไม่ขึ้น) */
const statusOf = (a, today) => (a.state !== 'approved' ? a.state : (a.effective <= today ? 'published' : 'scheduled'));

const btnPrimary = { padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 800,
  background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' };
const btnGhost = { padding: '6px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700,
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)' };

const fmtDate = (s) => { try { return new Date(`${s}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };

let seq = 3;
const seed = (today) => ([
  {
    id: 1, topic: 'กำหนดวันหยุดประจำปี 2570', detail: 'บริษัทประกาศวันหยุดประจำปี 2570 รวม 16 วัน รายละเอียดตามเอกสารแนบ (ตัวอย่าง)',
    scopes: [{ ...PLANT }], effective: addDaysStr(today, -2), state: 'approved', issuer: ISSUER, seedAck: 0.4,
    log: [{ at: addDaysStr(today, -4), text: 'ผู้แจ้งส่งขออนุมัติ' }, { at: addDaysStr(today, -3), text: 'EVP อนุมัติ' }],
  },
  {
    id: 2, topic: 'ปรับเวลาพักกลางวันช่วงปิดปรับปรุงโรงอาหาร', detail: 'ช่วงปรับปรุงโรงอาหาร พักกลางวันเหลื่อมเวลาเป็น 2 รอบ (ตัวอย่าง)',
    scopes: [{ ...PLANT }], effective: addDaysStr(today, 3), state: 'pending', issuer: ISSUER,
    log: [{ at: today, text: 'ผู้แจ้งส่งขออนุมัติ' }],
  },
]);

function Chip({ children, color = 'var(--muted)', onRemove }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 'var(--r-pill)',
      border: `1px solid ${color}`, color, fontSize: 12, background: 'var(--card)' }}>
      {children}
      {onRemove && <button type="button" onClick={onRemove} aria-label="เอาออก"
        style={{ border: 'none', background: 'none', color, cursor: 'pointer', fontSize: 13, padding: 0 }}>✕</button>}
    </span>
  );
}

function StatusChip({ st }) {
  const m = STATUS[st] || STATUS.pending;
  return <Chip color={m.color}>{m.label}</Chip>;
}

/* แถบสถานะ 4 ขั้น (โน้ต user 29/10 "อยากให้แสดงว่าเอกสารนี้ถึงไหน") — วงกลมทึบ = ผ่านแล้ว · วงขอบหนา = อยู่ขั้นนี้
   ขั้น 4 Feedback = นับคนกดรับทราบ X / N — ไม่ปิดขั้นโดยตั้งใจ (user 29/10 "ไม่ปิดขั้น แค่โชว์ตัวเลข")
   ตีกลับ = ขั้น 2 แดง ✕ (สีนิ่ง ไม่กระพริบ) */
const STEPS = ['Issue', 'Approve', 'Announce', 'Feedback'];
const STEP_SUB = ['ผู้แจ้งส่ง', 'EVP อนุมัติ', 'ประกาศถึงผู้รับ', 'ผู้รับกดรับทราบ'];
function FlowBar({ st, ack }) {
  const at = st === 'pending' || st === 'rejected' ? 1 : st === 'scheduled' ? 2 : st === 'published' ? 3 : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`, maxWidth: 560, paddingTop: 4 }}>
      {STEPS.map((label, i) => {
        const done = i < at;
        const bad = st === 'rejected' && i === at;
        const cur = i === at && !bad;
        const c = bad ? '#ef4444' : done ? '#22c55e' : cur ? 'var(--accent)' : 'var(--muted)';
        const lineC = i < at ? '#22c55e' : 'var(--border2)';
        return (
          <div key={label} style={{ position: 'relative', display: 'grid', justifyItems: 'center', alignContent: 'start', gap: 3, textAlign: 'center' }}>
            {i < STEPS.length - 1 && (
              <span style={{ position: 'absolute', top: 10, left: '50%', width: '100%', height: 2, background: lineC }} />
            )}
            <span aria-current={cur ? 'step' : undefined}
              style={{ position: 'relative', width: 22, height: 22, borderRadius: '50%', boxSizing: 'border-box',
                display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800,
                background: done || bad ? c : 'var(--card)', border: `${cur ? 3 : 2}px solid ${c}`,
                color: done || bad ? '#fff' : c }}>
              {bad ? '✕' : done ? '✓' : i + 1}
            </span>
            <span style={{ fontSize: 12, fontWeight: done || cur || bad ? 700 : 400, color: c }}>Step {i + 1} · {label}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{bad ? 'ถูกตีกลับ' : cur ? `ถึงขั้นนี้ · ${STEP_SUB[i]}` : STEP_SUB[i]}</span>
            {i === 3 && at === 3 && ack && (
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                รับทราบ {ack.done} / {ack.total} คน{ack.total ? ` (${Math.round((ack.done / ack.total) * 100)}%)` : ''}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AnnouncementMockup() {
  const [tab, setTab] = useTabParam(TABS.map(t => t.key), 'issue');
  const lines = useProductionLines();
  const { index, failed } = useOrgScope(lines);

  const realToday = getWorkDate();
  const [today, setToday] = useState(realToday);           // วันจำลอง (เดโม effective date)
  const [items, setItems] = useState(() => seed(realToday));
  const [notifs, setNotifs] = useState(() => ([
    { id: 1, to: 'evp', at: realToday, text: 'มีประกาศรออนุมัติ: ปรับเวลาพักกลางวันช่วงปิดปรับปรุงโรงอาหาร', annId: 2 },
  ]));

  // ── ฟอร์มผู้แจ้ง ──
  const blank = { topic: '', detail: '', scopes: [], effective: addDaysStr(realToday, 1) };
  const [form, setForm] = useState(blank);
  const [pick, setPick] = useState(null);
  // ── EVP ──
  const [rejectFor, setRejectFor] = useState(null);
  const [reason, setReason] = useState('');
  // ── พนักงาน ──
  const [myUnit, setMyUnit] = useState(null);
  const [meId, setMeId] = useState('');
  const [acks, setAcks] = useState({});                       // { [annId]: { [empId]: วันที่กด } }

  /* 👥 รายชื่อจำลอง — 2–4 คนต่อหน่วยในผัง (ส่วนงาน/แผนก/กลุ่มไลน์/ไลน์) · ฝ่าย/โรงงาน/CC ไม่มีคนของตัวเอง */
  const roster = useMemo(() => (index?.options || [])
    .filter(o => ['section', 'department', 'line_group', 'line'].includes(o.kind))
    .flatMap(o => Array.from({ length: rint(`ann-roster:${o.key}`, 2, 4) }, (_, i) => ({
      id: `${o.key}#${i + 1}`, name: `พนักงาน ${o.value} #${i + 1}`, unit: { kind: o.kind, value: o.value },
    }))), [index]);
  const recipientsOf = (a) => (index ? roster.filter(e => a.scopes.some(sc => scopeCovers(index, sc, e.unit))) : []);
  // seedAck = สัดส่วนที่กดไว้แล้วของประกาศตัวอย่าง (ให้เดโมเห็นตัวเลขไม่เป็น 0 ตั้งแต่เปิด)
  const ackAt = (a, e) => acks[a.id]?.[e.id] || (a.seedAck && rnd(`ann-ack:${a.id}:${e.id}`) < a.seedAck ? a.effective : null);
  const ackStat = (a) => { const r = recipientsOf(a); const done = r.filter(e => ackAt(a, e)); return { total: r.length, done: done.length, pending: r.filter(e => !ackAt(a, e)) }; };
  const myPeople = myUnit && !isPlant(myUnit) ? roster.filter(e => sameScope(e.unit, myUnit)) : [];
  const me = myPeople.find(e => e.id === meId) || null;
  const acknowledge = (a) => {
    if (!me) return;
    setAcks(m => ({ ...m, [a.id]: { ...(m[a.id] || {}), [me.id]: today } }));
    toast.success(`${me.name} รับทราบแล้ว`);
  };

  const notify = (to, text, annId) => setNotifs(n => [{ id: Date.now() + Math.random(), to, at: today, text, annId }, ...n]);
  const label = (sc) => (index ? scopePathText(index, sc) : (isPlant(sc) ? 'ทั้งโรงงาน' : sc.value));

  const addScope = () => {
    const sc = pick || { ...PLANT };
    const k = isPlant(sc) ? 'plant' : scopeKey(sc.kind, sc.value);
    setForm(f => {
      if (f.scopes.some(x => (isPlant(x) ? 'plant' : scopeKey(x.kind, x.value)) === k)) return f;
      // เลือก "ทั้งโรงงาน" = ครอบทุกหน่วยแล้ว ⇒ ตัวอื่นซ้ำซ้อน
      return { ...f, scopes: isPlant(sc) ? [sc] : [...f.scopes.filter(x => !isPlant(x)), sc] };
    });
  };

  const missing = [
    !form.topic.trim() && 'หัวข้อ',
    !form.detail.trim() && 'รายละเอียด',
    !form.scopes.length && 'ผู้รับ (ส่วนงาน)',
    !form.effective && 'วันมีผล',
  ].filter(Boolean);

  const submit = () => {
    if (missing.length) { toast.error(`กรอกไม่ครบ: ${missing.join(' · ')}`); return; }
    const id = seq++;
    setItems(xs => [{ id, ...form, topic: form.topic.trim(), detail: form.detail.trim(), state: 'pending', issuer: ISSUER,
      log: [{ at: today, text: 'ผู้แจ้งส่งขออนุมัติ' }] }, ...xs]);
    notify('evp', `มีประกาศรออนุมัติ: ${form.topic.trim()}`, id);
    toast.success('ส่งแล้ว — แจ้งเตือนถึง EVP (จำลอง)');
    setForm(blank); setPick(null);
  };

  const approve = (a) => {
    setItems(xs => xs.map(x => (x.id === a.id ? { ...x, state: 'approved', log: [...x.log, { at: today, text: 'EVP อนุมัติ' }] } : x)));
    notify('issuer', `EVP อนุมัติแล้ว: ${a.topic} · ประกาศจะขึ้นวันที่ ${fmtDate(a.effective)}`, a.id);
    toast.success('อนุมัติแล้ว — แจ้งผู้แจ้ง (จำลอง)');
  };
  const reject = (a) => {
    if (!reason.trim()) { toast.error('ตีกลับต้องใส่เหตุผล'); return; }
    setItems(xs => xs.map(x => (x.id === a.id ? { ...x, state: 'rejected', reject_reason: reason.trim(), log: [...x.log, { at: today, text: `EVP ตีกลับ: ${reason.trim()}` }] } : x)));
    notify('issuer', `EVP ตีกลับ: ${a.topic} — ${reason.trim()}`, a.id);
    setRejectFor(null); setReason('');
  };

  const pending = items.filter(a => a.state === 'pending');
  const coversMe = (a) => !!index && a.scopes.some(sc => scopeCovers(index, sc, myUnit || PLANT));
  const board = items.filter(a => statusOf(a, today) === 'published' && coversMe(a))
    .sort((x, y) => (x.effective < y.effective ? 1 : -1));
  const upcomingForMe = items.filter(a => statusOf(a, today) === 'scheduled' && coversMe(a)).length;

  const tabs = TABS.map(t => (t.key === 'approve' ? { ...t, badge: pending.length || null } : t));
  const inbox = (to) => notifs.filter(n => n.to === to);

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)' };
  const h3 = { margin: '0 0 10px', fontSize: 15 };

  const AnnRow = ({ a, children, ackList = false }) => {
    const st = statusOf(a, today);
    const ack = st === 'published' ? ackStat(a) : null;
    return (
      <div style={{ ...card, borderLeft: `4px solid ${(STATUS[st] || STATUS.pending).color}`, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>{a.topic}</b><StatusChip st={st} />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>มีผล {fmtDate(a.effective)}</span>
        </div>
        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{a.detail}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
          <span style={{ color: 'var(--muted)' }}>ผู้รับ:</span>
          {a.scopes.map(sc => <Chip key={isPlant(sc) ? 'plant' : scopeKey(sc.kind, sc.value)}>{label(sc)}</Chip>)}
        </div>
        <FlowBar st={st} ack={ack} />
        {ackList && ack && ack.pending.length > 0 && (
          <details style={{ fontSize: 12 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>ยังไม่รับทราบ {ack.pending.length} คน</summary>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {ack.pending.map(e => <Chip key={e.id}>{e.name}</Chip>)}
            </div>
          </details>
        )}
        {a.reject_reason && <div style={{ fontSize: 12, color: '#ef4444' }}>เหตุผลที่ตีกลับ: {a.reject_reason}</div>}
        {children}
      </div>
    );
  };

  const Inbox = ({ to, title }) => {
    const list = inbox(to);
    return (
      <div style={card}>
        <h3 style={h3}>🔔 {title} ({list.length})</h3>
        {list.length ? (
          <div style={{ display: 'grid', gap: 6 }}>
            {list.map(n => (
              <div key={n.id} style={{ fontSize: 13, borderBottom: '1px dashed var(--border)', paddingBottom: 6 }}>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDate(n.at)} · </span>{n.text}
              </div>
            ))}
          </div>
        ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>ยังไม่มีแจ้งเตือน</div>}
      </div>
    );
  };

  return (
    <Page>
      <PageHeader
        title="ประกาศ / ชี้แจงบริษัท"
        icon="📢"
        sub={<span><b style={{ color: '#f59e0b' }}>🧪 MOCKUP</b> · ข้อมูลจำลองในหน้านี้ ไม่บันทึกลงฐานข้อมูล (รีเฟรช = เริ่มใหม่)</span>}
        tabs={tabs} tab={tab} onTab={setTab}
        filters={(
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>📅 วันที่จำลอง</span>
            <button type="button" style={btnGhost} onClick={() => setToday(d => addDaysStr(d, -1))}>‹</button>
            <input type="date" value={today} onChange={e => e.target.value && setToday(e.target.value)} />
            <button type="button" style={btnGhost} onClick={() => setToday(d => addDaysStr(d, 1))}>›</button>
            {today !== realToday && <button type="button" style={btnGhost} onClick={() => setToday(realToday)}>กลับวันนี้</button>}
          </div>
        )}
      />

      <div style={{ marginBottom: 12 }}>
        <InfoMore lead="ลำดับงาน: ผู้แจ้งกรอก → แจ้งเตือน EVP → EVP อนุมัติ (แจ้งกลับผู้แจ้ง) → ถึงวันมีผล ประกาศขึ้นให้ user ในส่วนงานที่เลือก">
          สลับแท็บด้านบนเพื่อดูมุมของแต่ละคน · เลื่อน "วันที่จำลอง" เพื่อดูประกาศขึ้นตามวันมีผล ·
          ผู้รับเลือกจากผังองค์กรจริง — เลือกหน่วยแม่ = ครอบหน่วยลูกทั้งหมด ·
          ระบบจริงต้องมีตารางประกาศ + สิทธิ์ + แจ้งเตือนในแอป (ยังไม่ได้ทำ)
        </InfoMore>
      </div>
      {failed && <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', marginBottom: 12 }}>⚠ {failed} — ตัวเลือกผู้รับอาจไม่ครบ</div>}

      {tab === 'issue' && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', alignItems: 'start' }}>
          <div style={{ ...card, display: 'grid', gap: 10 }}>
            <h3 style={{ ...h3, margin: 0 }}>📝 ออกประกาศใหม่</h3>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>หัวข้อ (Topic)
              <input value={form.topic} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))} placeholder="เช่น ประกาศวันหยุด / ชี้แจงกฎความปลอดภัย" />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>รายละเอียด (Detail)
              <textarea rows={5} value={form.detail} onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} />
            </label>
            <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>ผู้รับ (Who's receive) — เลือกจากผังองค์กร
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <OrgScopePicker index={index} failed={failed} value={pick} onChange={setPick} costCenter={false} />
                <button type="button" style={btnGhost} onClick={addScope}>+ เพิ่ม</button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {form.scopes.length
                  ? form.scopes.map((sc, i) => (
                    <Chip key={isPlant(sc) ? 'plant' : scopeKey(sc.kind, sc.value)} color="var(--accent)"
                      onRemove={() => setForm(f => ({ ...f, scopes: f.scopes.filter((_, j) => j !== i) }))}>{label(sc)}</Chip>))
                  : <span style={{ color: 'var(--muted)', fontSize: 12 }}>ยังไม่ได้เลือก</span>}
              </div>
            </div>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>วันมีผล (Effective date)
              <input type="date" value={form.effective} onChange={e => setForm(f => ({ ...f, effective: e.target.value }))} style={{ maxWidth: 200 }} />
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={btnPrimary} onClick={submit}>ส่งขออนุมัติ → EVP</button>
              {missing.length > 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>ยังขาด: {missing.join(' · ')}</span>}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <Inbox to="issuer" title="แจ้งเตือนของผู้แจ้ง" />
            <h3 style={{ ...h3, margin: 0 }}>ประกาศที่ฉันออก ({items.length})</h3>
            {items.map(a => <AnnRow key={a.id} a={a} ackList />)}
          </div>
        </div>
      )}

      {tab === 'approve' && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <h3 style={{ ...h3, margin: 0 }}>รอ {APPROVER} อนุมัติ ({pending.length})</h3>
            {pending.length ? pending.map(a => (
              <AnnRow key={a.id} a={a}>
                {rejectFor === a.id ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <input value={reason} onChange={e => setReason(e.target.value)} placeholder="เหตุผลที่ตีกลับ (บังคับ)" style={{ flex: 1, minWidth: 200 }} />
                    <button type="button" style={{ ...btnGhost, color: '#ef4444' }} onClick={() => reject(a)}>ยืนยันตีกลับ</button>
                    <button type="button" style={btnGhost} onClick={() => { setRejectFor(null); setReason(''); }}>ยกเลิก</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" style={btnPrimary} onClick={() => approve(a)}>✅ อนุมัติ</button>
                    <button type="button" style={btnGhost} onClick={() => { setRejectFor(a.id); setReason(''); }}>↩ ตีกลับ</button>
                  </div>
                )}
              </AnnRow>
            )) : <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>ไม่มีประกาศรออนุมัติ</div>}
          </div>
          <Inbox to="evp" title={`แจ้งเตือนของ ${APPROVER}`} />
        </div>
      )}

      {tab === 'board' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>👷 ดูในฐานะพนักงานของ</span>
            <OrgScopePicker index={index} failed={failed} value={myUnit} onChange={(v) => { setMyUnit(v); setMeId(''); }} costCenter={false} plantLabel="— เลือกหน่วยงานของพนักงาน —" />
            <select value={meId} onChange={e => setMeId(e.target.value)} disabled={!myPeople.length} style={{ width: 240 }}>
              <option value="">{myPeople.length ? '— ฉันคือ (รายชื่อจำลอง) —' : 'หน่วยนี้ไม่มีรายชื่อจำลอง'}</option>
              {myPeople.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              ประกาศที่ขึ้น = อนุมัติแล้ว + ถึงวันมีผล ({fmtDate(today)}) + ผู้รับครอบหน่วยนี้
              {upcomingForMe > 0 && ` · อีก ${upcomingForMe} ฉบับรอถึงวันมีผล`}
            </span>
          </div>
          {board.length ? board.map((a) => {
            const at = me ? ackAt(a, me) : null;
            return (
              <AnnRow key={a.id} a={a}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {at
                    ? <span style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>✓ {me.name} รับทราบแล้ว ({fmtDate(at)})</span>
                    : <button type="button" style={btnPrimary} disabled={!me} onClick={() => acknowledge(a)}>✋ รับทราบ</button>}
                  {!me && <span style={{ fontSize: 12, color: 'var(--muted)' }}>เลือก "ฉันคือ" ก่อนจึงกดรับทราบได้</span>}
                </div>
              </AnnRow>
            );
          }) : (
            <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>
              ไม่มีประกาศสำหรับหน่วยนี้ ณ วันที่ {fmtDate(today)}
              {upcomingForMe > 0 ? ` (มี ${upcomingForMe} ฉบับอนุมัติแล้วแต่ยังไม่ถึงวันมีผล — ลองเลื่อนวันที่จำลอง)` : ''}
            </div>
          )}
        </div>
      )}
    </Page>
  );
}
