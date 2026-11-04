import { useMemo, useState } from 'react';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import InfoMore from '../components/InfoMore';
import { toast } from '../components/Toast';
import useTabParam from '../utils/useTabParam';

/* ══ 🧾 อ่านเอกสารอัตโนมัติ (OCR) + เชื่อมต่อข้อมูล — MOCKUP (2026-11-04 · คำสั่ง user) ══════════════
   ที่มา: concept "e-workflow" — เอกสารตัวพิมพ์ที่มาจากคนนอก (ใบส่งของ / ใบวางบิล) ปัจจุบันต้องให้คน
   พิมพ์ซ้ำเข้าระบบ ⇒ อัปโหลดรูป/PDF → OCR อ่านเป็นช่อง → จับคู่ทะเบียน → **คนตรวจแล้วกดยืนยัน**
   → ส่งต่อไป Google Sheet / Shared Drive ได้ · อยู่หมวด sidebar "E-Workflow" ร่วมกับประกาศบริษัท + เบิกเดินทาง

   🔴 หลักที่ระบบจริงต้องคงไว้ (ห้ามหลุดตอนทำของจริง):
     · ผล OCR = "ร่าง" ไม่ใช่ข้อมูล — **ห้ามเขียนลงฐาน/สต็อกเองอัตโนมัติ** (ENGINEERING-PRINCIPLES §2 ห้ามเดาแทนคน)
     · ช่องที่อ่านไม่ออก = ❓ ต้องให้คนกรอก **ห้ามเติม 0/ค่าเดา** · ยืนยันไม่ได้จนกว่าไม่มี ❓ เหลือ
     · เก็บไฟล์ต้นฉบับผูกกับใบเสมอ (ใบที่รับมาแล้ว = บันทึก)
   ⚠️ ตัวอย่างหน้าจอ — **ไม่เขียน DB · ไม่เรียก OCR/AI จริง · ไม่ต่อ Google จริง**
      ข้อมูลอยู่ใน state ของหน้า (รีเฟรช = เริ่มใหม่) · ชื่อผู้ขาย/รหัสสินค้า/ราคา เป็นตัวอย่างทั้งหมด
   ยังไม่ตัดสิน (ต้องถาม user ก่อนทำของจริง): ชนิดเอกสารตัวแรก · อนุญาตส่งรูปให้ AI ภายนอกไหม ·
   เก็บลงตารางไหน · Sheet ปลายทางของใคร — 📄 `docs/modules/e-workflow.md`
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

const TABS = [
  { key: 'read', label: '📥 อัปโหลด & ตรวจ' },
  { key: 'list', label: '📋 ทะเบียนเอกสาร' },
  { key: 'link', label: '🔗 เชื่อมต่อข้อมูล' },
];

/* ทะเบียนจำลอง — ระบบจริงจับคู่กับ `suppliers` / `parts_master` (DR) */
const SAMPLE_SUPPLIERS = ['บริษัท ตัวอย่าง ก จำกัด', 'บริษัท ตัวอย่าง ข จำกัด'];
const SAMPLE_PARTS = {
  'NUT-M8-01': 'น็อต M8 (ตัวอย่าง)',
  'BLT-M10-25': 'โบลท์ M10x25 (ตัวอย่าง)',
  'WSH-M8-02': 'แหวน M8 (ตัวอย่าง)',
};

/* "ผลที่ OCR อ่านได้" ของเอกสารตัวอย่าง — `null` = อ่านไม่ออก (จงใจใส่ไว้ให้เห็นขั้นคนตรวจ) */
const SAMPLE_DOCS = [
  {
    key: 'dn', kind: 'ใบส่งของ', title: 'ใบส่งของ (ตัวอย่าง)',
    head: { supplier: 'บริษัท ตัวอย่าง ก จำกัด', doc_no: 'DN-6911-0042', doc_date: '2026-11-03', po_no: 'PO-6910-118' },
    lines: [
      { code: 'NUT-M8-01', qty: 2000, price: 0.85 },
      { code: 'BLT-M10-25', qty: 1500, price: null },
      { code: 'WSH-M8-0Z', qty: 2000, price: 0.3 },
    ],
  },
  {
    key: 'inv', kind: 'ใบวางบิล', title: 'ใบวางบิล (ตัวอย่าง)',
    head: { supplier: 'บริษัท ตัวอย่าง ข จํากัด', doc_no: 'BL-6911-007', doc_date: null, po_no: 'PO-6910-121' },
    lines: [
      { code: 'BLT-M10-25', qty: 800, price: 2.4 },
      { code: 'NUT-M8-01', qty: null, price: 0.85 },
    ],
  },
];

const HEAD_FIELDS = [
  { k: 'supplier', label: 'ผู้ขาย' },
  { k: 'doc_no', label: 'เลขที่เอกสาร' },
  { k: 'doc_date', label: 'วันที่เอกสาร' },
  { k: 'po_no', label: 'อ้างอิง PO' },
];

const ST = {
  ok: { icon: '✅', text: 'ตรงทะเบียน', color: '#22c55e' },
  warn: { icon: '⚠️', text: 'ไม่เจอในทะเบียน', color: '#f59e0b' },
  miss: { icon: '❓', text: 'อ่านไม่ออก', color: '#ef4444' },
  read: { icon: '📝', text: 'อ่านได้', color: '#94a3b8' },
};

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)' };
const h3 = { margin: 0, fontSize: 15 };
const muted = { fontSize: 12, color: 'var(--muted)' };
const btnPrimary = { padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 800, background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' };
const btnGhost = { padding: '6px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)' };
const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 13, textAlign: 'left' };

const paperCell = { color: '#222', background: 'transparent', borderBottom: '1px dashed #c8c8bc', padding: '4px 6px', fontSize: 12, fontFamily: 'monospace' };
const blank = (v) => v == null || String(v).trim() === '';
const num = (v) => (blank(v) ? null : Number(v));

/* สถานะของช่องหัวเอกสาร — ผู้ขายต้องตรงทะเบียน · ช่องอื่นแค่ต้องอ่านออก */
function headState(k, v) {
  if (blank(v)) return 'miss';
  if (k === 'supplier') return SAMPLE_SUPPLIERS.includes(String(v).trim()) ? 'ok' : 'warn';
  return 'read';
}
/* สถานะรายบรรทัด — เอาสถานะที่แย่ที่สุดของบรรทัด (อ่านไม่ออก > ไม่เจอในทะเบียน > ตรง) */
function lineState(l) {
  if (blank(l.code) || num(l.qty) == null || num(l.price) == null) return 'miss';
  return SAMPLE_PARTS[String(l.code).trim()] ? 'ok' : 'warn';
}

function Chip({ s }) {
  const m = ST[s];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
      color: m.color, background: `${m.color}1f`, border: `1px solid ${m.color}55` }}>{m.icon} {m.text}</span>
  );
}

/* "กระดาษ" จำลองของเอกสารต้นฉบับ — แทนรูปที่อัปโหลดในระบบจริง */
function PaperPreview({ doc }) {
  return (
    <div style={{ background: '#fdfdf8', color: '#222', borderRadius: 6, padding: 16, fontSize: 12,
      fontFamily: 'monospace', border: '1px solid #d4d4c8', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 14 }}>{doc.kind.toUpperCase()}</div>
      <div style={{ textAlign: 'center', marginBottom: 10 }}>{doc.head.supplier || '░░░░░░░░'}</div>
      <div>เลขที่: {doc.head.doc_no || '░░░░'} · วันที่: {doc.head.doc_date || '▒▒/▒▒/▒▒'}</div>
      <div style={{ marginBottom: 8 }}>อ้างอิง: {doc.head.po_no || '░░░░'}</div>
      {/* สีกระดาษต้องตั้งที่ th/td ตรงๆ — ไม่งั้นรับสี/พื้นตารางจากธีมมืดของระบบ ตัวอักษรจางจนอ่านไม่ออก */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ ...paperCell, textAlign: 'left' }}>รหัส</th><th style={{ ...paperCell, textAlign: 'right' }}>จำนวน</th><th style={{ ...paperCell, textAlign: 'right' }}>ราคา/หน่วย</th></tr></thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i}>
              <td style={paperCell}>{l.code || '░░░░'}</td>
              <td style={{ ...paperCell, textAlign: 'right' }}>{l.qty ?? '▒▒▒'}</td>
              <td style={{ ...paperCell, textAlign: 'right' }}>{l.price ?? '▒▒'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 10, color: '#888' }}>(▒ = รอยเปื้อน/ตัวจาง — OCR อ่านไม่ออก)</div>
    </div>
  );
}

export default function EWorkflowOcrMockup() {
  const [tab, setTab] = useTabParam(TABS.map(t => t.key), 'read');
  const [draft, setDraft] = useState(null); // { src, head, lines }
  const [reading, setReading] = useState(false);
  const [records, setRecords] = useState([]);
  const [sheet, setSheet] = useState({ url: '', sheetName: 'รับเอกสาร', on: false });
  const [syncLog, setSyncLog] = useState([]);

  const startRead = (doc) => {
    setReading(true);
    setDraft(null);
    // จำลองเวลาที่ OCR ใช้อ่าน — ระบบจริง = edge function เรียกบริการ OCR
    setTimeout(() => {
      setDraft({ src: doc, head: { ...doc.head }, lines: doc.lines.map(l => ({ ...l })) });
      setReading(false);
    }, 700);
  };

  const states = useMemo(() => {
    if (!draft) return null;
    const head = Object.fromEntries(HEAD_FIELDS.map(f => [f.k, headState(f.k, draft.head[f.k])]));
    const lines = draft.lines.map(lineState);
    const all = [...Object.values(head), ...lines];
    return { head, lines, miss: all.filter(s => s === 'miss').length, warn: all.filter(s => s === 'warn').length,
      total: all.length, ok: all.filter(s => s === 'ok' || s === 'read').length };
  }, [draft]);

  const setHead = (k, v) => setDraft(d => ({ ...d, head: { ...d.head, [k]: v } }));
  const setLine = (i, k, v) => setDraft(d => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));

  const confirm = () => {
    if (!draft || states.miss > 0) return;
    const id = records.length + 1;
    const amount = draft.lines.reduce((s, l) => s + (num(l.qty) || 0) * (num(l.price) || 0), 0);
    setRecords(r => [{
      id, kind: draft.src.kind, ...draft.head, lines: draft.lines.map(l => ({ ...l })), amount,
      warn: states.warn, status: 'confirmed', synced: false,
    }, ...r]);
    setDraft(null);
    toast.success(`ยืนยันเอกสาร ${draft.head.doc_no} แล้ว (จำลอง — ไม่บันทึกลงฐาน)`);
  };
  const reject = () => { setDraft(null); toast.info('ตีกลับเอกสาร — ไม่บันทึก (จำลอง)'); };

  const pending = records.filter(r => !r.synced);
  const pushSheet = () => {
    if (!sheet.on || !sheet.url.trim()) { toast.error('ยังไม่ได้ตั้งค่า Sheet ปลายทาง'); return; }
    if (!pending.length) { toast.info('ไม่มีเอกสารใหม่ที่ต้องส่ง'); return; }
    const rows = pending.reduce((s, r) => s + r.lines.length, 0);
    setRecords(rs => rs.map(r => ({ ...r, synced: true })));
    setSyncLog(l => [{ at: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }), docs: pending.length, rows }, ...l]);
    toast.success(`จำลองส่ง ${pending.length} เอกสาร · ${rows} แถว ไป "${sheet.sheetName}"`);
  };

  const tabs = TABS.map(t => ({ ...t, badge: t.key === 'link' && pending.length ? pending.length : undefined }));
  const inp = { width: '100%', minWidth: 0 };

  return (
    <Page>
      <PageHeader
        title="อ่านเอกสารอัตโนมัติ (OCR)"
        icon="🧾"
        sub={<span><b style={{ color: '#f59e0b' }}>🧪 MOCKUP</b> · ข้อมูลจำลองในหน้านี้ ไม่บันทึกลงฐานข้อมูล ไม่เรียก OCR/Google จริง (รีเฟรช = เริ่มใหม่)</span>}
        tabs={tabs} tab={tab} onTab={setTab}
      />
      <div style={{ marginBottom: 12 }}>
        <InfoMore lead="ลำดับงาน: อัปโหลดรูป/PDF → OCR อ่านเป็นช่อง → จับคู่ทะเบียนผู้ขาย/สินค้า → คนตรวจแล้วกดยืนยัน → ส่งต่อ Google Sheet">
          ผล OCR เป็นแค่ "ร่าง" — ระบบไม่บันทึกเองอัตโนมัติ · ช่อง ❓ อ่านไม่ออกต้องกรอกเองก่อนจึงยืนยันได้ ·
          ⚠️ ไม่เจอในทะเบียน = ยืนยันได้แต่ระบบจะติดป้ายไว้ · ผู้ขาย/รหัสสินค้า/ราคาทั้งหมดเป็นตัวอย่าง
        </InfoMore>
      </div>

      {tab === 'read' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ ...card, display: 'grid', gap: 10 }}>
            <h3 style={h3}>① เลือกเอกสาร (จำลองการอัปโหลด)</h3>
            <div style={muted}>ระบบจริง: ถ่ายรูปหรือแนบ PDF — ไฟล์ต้นฉบับถูกเก็บผูกกับใบนี้ตลอด</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SAMPLE_DOCS.map(d => (
                <button key={d.key} type="button" style={btnGhost} disabled={reading} onClick={() => startRead(d)}>📄 {d.title}</button>
              ))}
            </div>
            {reading && <div style={{ fontSize: 13 }}>🔍 กำลังอ่านเอกสาร…</div>}
          </div>

          {draft && states && (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
              <div style={{ ...card, display: 'grid', gap: 8 }}>
                <h3 style={h3}>ต้นฉบับ</h3>
                <PaperPreview doc={draft.src} />
              </div>
              <div style={{ ...card, display: 'grid', gap: 10 }}>
                <h3 style={h3}>② ตรวจผลที่อ่านได้ — {draft.src.kind}</h3>
                <div style={{ fontSize: 13 }}>
                  อ่าน/จับคู่ได้ <b>{states.ok}</b> จาก {states.total} ช่อง ·
                  <span style={{ color: ST.warn.color }}> ⚠️ {states.warn}</span> ·
                  <span style={{ color: ST.miss.color }}> ❓ {states.miss}</span>
                </div>
                {HEAD_FIELDS.map(f => (
                  <label key={f.k} style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{f.label} <Chip s={states.head[f.k]} /></span>
                    <input style={inp} type={f.k === 'doc_date' ? 'date' : 'text'} value={draft.head[f.k] ?? ''} onChange={e => setHead(f.k, e.target.value)} />
                  </label>
                ))}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={cell}>รหัสสินค้า</th><th style={cell}>จำนวน</th><th style={cell}>ราคา/หน่วย</th><th style={cell}>สถานะ</th></tr></thead>
                    <tbody>
                      {draft.lines.map((l, i) => (
                        <tr key={i}>
                          <td style={cell}>
                            <input style={{ ...inp, maxWidth: 130 }} value={l.code ?? ''} onChange={e => setLine(i, 'code', e.target.value)} />
                            <div style={muted}>{SAMPLE_PARTS[String(l.code || '').trim()] || '—'}</div>
                          </td>
                          <td style={cell}><input style={{ ...inp, maxWidth: 90 }} type="number" value={l.qty ?? ''} onChange={e => setLine(i, 'qty', e.target.value)} /></td>
                          <td style={cell}><input style={{ ...inp, maxWidth: 80 }} type="number" step="0.01" value={l.price ?? ''} onChange={e => setLine(i, 'price', e.target.value)} /></td>
                          <td style={cell}><Chip s={states.lines[i]} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {states.miss > 0 && <div style={{ fontSize: 12, color: ST.miss.color }}>❓ ยังมี {states.miss} ช่องที่อ่านไม่ออก — กรอกให้ครบก่อนยืนยัน (ระบบไม่เติมค่าแทน)</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" style={btnGhost} onClick={reject}>ตีกลับ</button>
                  <button type="button" style={{ ...btnPrimary, opacity: states.miss ? 0.5 : 1 }} disabled={states.miss > 0} onClick={confirm}>✔ ยืนยันข้อมูล</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'list' && (
        <div style={card}>
          <h3 style={{ ...h3, marginBottom: 8 }}>เอกสารที่ยืนยันแล้ว ({records.length})</h3>
          {records.length === 0 ? <div style={muted}>ยังไม่มีเอกสาร — ไปแท็บ "อัปโหลด & ตรวจ" เพื่อลองอ่านเอกสารตัวอย่าง</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['ชนิด', 'เลขที่', 'ผู้ขาย', 'วันที่', 'PO', 'บรรทัด', 'ยอดรวม (บาท)', 'ป้าย', 'ส่ง Sheet'].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id}>
                      <td style={cell}>{r.kind}</td><td style={cell}>{r.doc_no}</td><td style={cell}>{r.supplier}</td>
                      <td style={cell}>{r.doc_date}</td><td style={cell}>{r.po_no}</td><td style={cell}>{r.lines.length}</td>
                      <td style={cell}>{r.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      <td style={cell}>{r.warn ? <span style={{ color: ST.warn.color }}>⚠️ {r.warn} ช่องไม่ตรงทะเบียน</span> : '—'}</td>
                      <td style={cell}>{r.synced ? '✅ ส่งแล้ว' : '⏳ รอส่ง'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'link' && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
          <div style={{ ...card, display: 'grid', gap: 10 }}>
            <h3 style={h3}>ปลายทาง: Google Sheet / Shared Drive</h3>
            <div style={muted}>ระบบจริง: ต้องแชร์ Sheet ให้ service account ของบริษัท · ส่งเฉพาะเอกสารที่คนยืนยันแล้ว</div>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>ลิงก์ Sheet
              <input style={inp} value={sheet.url} onChange={e => setSheet(s => ({ ...s, url: e.target.value }))} placeholder="https://docs.google.com/spreadsheets/d/…" />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>ชื่อแผ่นงาน
              <input style={inp} value={sheet.sheetName} onChange={e => setSheet(s => ({ ...s, sheetName: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={sheet.on} onChange={e => setSheet(s => ({ ...s, on: e.target.checked }))} /> เปิดการเชื่อมต่อ (จำลอง)
            </label>
            <div style={{ fontSize: 13 }}>คอลัมน์ที่จะส่ง: ชนิด · เลขที่ · ผู้ขาย · วันที่ · PO · รหัสสินค้า · จำนวน · ราคา/หน่วย (1 แถวต่อ 1 บรรทัดสินค้า)</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13 }}>รอส่ง <b>{pending.length}</b> เอกสาร</span>
              <button type="button" style={btnPrimary} onClick={pushSheet}>⇪ ส่งไป Sheet (จำลอง)</button>
            </div>
          </div>
          <div style={{ ...card, display: 'grid', gap: 8 }}>
            <h3 style={h3}>ประวัติการส่ง</h3>
            {syncLog.length === 0 ? <div style={muted}>ยังไม่เคยส่ง</div> : syncLog.map((s, i) => (
              <div key={i} style={{ fontSize: 13 }}>🕑 {s.at} — {s.docs} เอกสาร · {s.rows} แถว</div>
            ))}
          </div>
        </div>
      )}
    </Page>
  );
}
