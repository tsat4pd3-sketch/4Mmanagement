import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import LineSelect from '../components/LineSelect';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { visibleInterval } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';

/* ─── STORE MONITOR — เฝ้าระวังสต๊อก/รอบส่ง (Abnormality Monitor) ─────────────
   ถอดจากตาราง "Abnormality case of TEI-TEI system" (17 เคส) ของ Toyota TPS
   → เฟส 1 จับเฉพาะเคสที่ detect ได้จริงจากข้อมูลปัจจุบัน แล้วสรุปเป็นผล
   Shortage (จะขาด 🟥) / Over stock (ล้น 🟧) แบบ andon (แดงกระพริบ / เหลืองนิ่ง)

   read-only ทั้งหน้า — ไม่แตะ write-path ของ store · store-wide + ฟิลเตอร์ไลน์
   (โมดูล logistic เป็น store-wide ตาม convention — ผู้ใช้หลักคือ store/logistic)

   เคสที่จับ (เฟส 1):
   #A ต่ำกว่า Min (on_hand < kanban_standards.min_qty) → Shortage
   #B เกิน Max  (on_hand > kanban_standards.max_qty)  → Over stock
   #C รอบส่งเลยเวลา (round ถึงเวลาส่งแล้วยังไม่ยืนยันส่ง) → Shortage
   #D รับไม่ครบ (kanban_deliveries.received_status = 'partial') → Shortage
   #E สั่งซื้อค้าง (purchase_requests ยังไม่รับ เกินวันกำหนด) → Shortage
   เคสอื่นใน 17 (ผิดกล่อง/pattern/pallet) ต้องมี kanban-scan/pattern ก่อน = เฟสถัดไป */

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 };
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const workDateStr = () => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); return dateStr(d); };
const hm2m = (s) => { if (!s) return null; const p = String(s).split(':').map(Number); return p[0] * 60 + (p[1] || 0); };

export default function StoreMonitor() {
  const { role, lineId, sections: scopeSecs } = useContext(UserContext);
  const [prodLines, setProdLines] = useState([]); // production_lines (id/name/section/parent) — ใช้คิด scope
  const [summary, setSummary] = useState([]);
  const [ks, setKs] = useState({});
  const [rounds, setRounds] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [lineFilter, setLineFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('all');   // all | shortage | over
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    const today = workDateStr();
    const [{ data: sum }, { data: std }, { data: rnd }, { data: dlv }, { data: pur }, { data: lines }] = await Promise.all([
      supabaseDR.from('line_stock_summary').select('line_name, mat_no, part_name, qty_on_hand'),
      supabaseDR.from('kanban_standards').select('mat_no, part_name, min_qty, max_qty, lot_size').eq('is_active', true),
      supabaseDR.from('kanban_delivery_rounds').select('line_name, shift, round_no, cutoff_time, delivery_time, points_count, time_per_point_min, is_active').eq('is_active', true),
      supabaseDR.from('kanban_deliveries').select('line_name, shift, round_no, confirmed_at, received_status').eq('work_date', today),
      supabaseDR.from('purchase_requests').select('mat_no, part_name, dest_line, supplier, status, work_date, created_at').in('status', ['pending', 'ordered']),
      supabase.from('production_lines').select('id, name, section, parent_line_name, is_active'),
    ]);
    setProdLines(lines || []);
    setSummary(sum || []);
    const km = {}; (std || []).forEach(r => { km[r.mat_no] = r; }); setKs(km);
    setRounds(rnd || []);
    setDeliveries(dlv || []);
    setPurchases(pur || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const stopPoll = visibleInterval(() => { load(); setTick(x => x + 1); }, RATE.ANALYTIC);
    return () => stopPoll();
  }, [load]);

  const findings = useMemo(() => {
    const today = workDateStr();
    const now = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    const out = [];

    // #A / #B — on-hand เทียบ min/max ต่อ (ไลน์, mat)
    summary.forEach(s => {
      const std = ks[s.mat_no]; if (!std) return;
      const oh = parseFloat(s.qty_on_hand) || 0;
      const min = Number(std.min_qty), max = Number(std.max_qty);
      const name = s.part_name || std.part_name || '';
      if (min > 0 && oh < min) {
        out.push({ kind: 'shortage', code: 'A', title: 'ต่ำกว่า Min', line: s.line_name, mat: s.mat_no, part: name,
          detail: `คงเหลือ ${fmt(oh)} < Min ${fmt(min)} — ต้องเติมก่อนขาด`, sev: oh <= 0 ? 3 : 2, val: min > 0 ? oh / min : 1 });
      } else if (max > 0 && oh > max) {
        out.push({ kind: 'over', code: 'B', title: 'เกิน Max (ล้น)', line: s.line_name, mat: s.mat_no, part: name,
          detail: `คงเหลือ ${fmt(oh)} > Max ${fmt(max)} — จ่ายเกิน/สั่งเกิน`, sev: 1, val: max > 0 ? oh / max : 1 });
      }
    });

    // #C — รอบส่งเลยเวลา ยังไม่ยืนยันส่ง (จับเฉพาะรอบที่ delivery ผ่านมาแล้ววันนี้)
    const confirmed = new Set(), partial = [];
    deliveries.forEach(d => {
      const key = `${d.line_name}|${d.shift}|${d.round_no}`;
      if (d.confirmed_at) confirmed.add(key);
      if (d.received_status === 'partial') partial.push(d);
    });
    rounds.forEach(r => {
      const key = `${r.line_name}|${r.shift}|${r.round_no}`;
      const dM = hm2m(r.delivery_time);
      const finish = dM == null ? null : dM + (Number(r.points_count) || 0) * (Number(r.time_per_point_min) || 0);
      // เฉพาะกะกลางวัน (delivery < 20:00) เพื่อเทียบเวลาปัจจุบันตรงๆ · กะดึกข้ามวัน = เฟสถัดไป
      if (finish != null && dM < 20 * 60 && nowM > finish && !confirmed.has(key)) {
        out.push({ kind: 'shortage', code: 'C', title: 'รอบส่งเลยเวลา', line: r.line_name, mat: '', part: `รอบ ${r.round_no} · ${r.shift}`,
          detail: `กำหนดส่ง ${r.delivery_time} ผ่านมาแล้วยังไม่ยืนยันส่ง`, sev: 3, val: 0 });
      }
    });

    // #D — รับไม่ครบ (partial)
    partial.forEach(d => {
      out.push({ kind: 'shortage', code: 'D', title: 'รับไม่ครบ', line: d.line_name, mat: '', part: `รอบ ${d.round_no} · ${d.shift}`,
        detail: 'ไลน์ยืนยัน "รับไม่ครบ" — ของขาดที่ไลน์', sev: 2, val: 0 });
    });

    // #E — สั่งซื้อค้าง เกินวันกำหนด (ยังไม่รับของ)
    purchases.forEach(p => {
      const wd = p.work_date || (p.created_at ? p.created_at.slice(0, 10) : null);
      if (wd && wd < today) {
        out.push({ kind: 'shortage', code: 'E', title: 'สั่งซื้อค้าง (ยังไม่รับ)', line: p.dest_line || '', mat: p.mat_no, part: p.part_name || '',
          detail: `${p.status === 'ordered' ? 'สั่งแล้ว' : 'รอสั่ง'}ตั้งแต่ ${wd} ยังไม่รับเข้า${p.supplier ? ` · ${p.supplier}` : ''}`, sev: 2, val: 0 });
      }
    });

    return out;
  }, [summary, ks, rounds, deliveries, purchases, tick]);

  // mandatory scope filter — leader = family ไลน์ตัวเอง · role อื่นตาม sections (pattern มาตรฐาน CLAUDE.md)
  //   null = ไม่จำกัด (admin / role ที่ไม่มี scope) · กรองก่อน filter อิสระเสมอ · ครอบทั้งลิสต์ ตัวนับ และ dropdown
  const scopeLineNames = useMemo(() => {
    if (role === 'admin' || !prodLines.length) return null;
    if (role === 'leader' && lineId) {
      const self = prodLines.find(l => String(l.id) === String(lineId));
      return self ? new Set(getLineFamilyNames(prodLines, self.name)) : new Set();
    }
    if (scopeSecs?.length) return new Set(prodLines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name));
    return null;
  }, [prodLines, role, lineId, scopeSecs]);
  const scoped = useMemo(
    () => (scopeLineNames ? findings.filter(f => !f.line || scopeLineNames.has(f.line)) : findings),
    [findings, scopeLineNames]);

  const lines = useMemo(() => [...new Set(scoped.map(f => f.line).filter(Boolean))].sort(), [scoped]);
  const shown = scoped
    .filter(f => !lineFilter || f.line === lineFilter)
    .filter(f => kindFilter === 'all' || f.kind === kindFilter)
    .sort((a, b) => b.sev - a.sev || (a.val - b.val));

  const nShort = scoped.filter(f => f.kind === 'shortage').length;
  const nOver = scoped.filter(f => f.kind === 'over').length;
  const nLate = scoped.filter(f => f.code === 'C').length;

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 'min(96vw, 1600px)', margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          🚨 เฝ้าระวังสต๊อก & รอบส่ง (Abnormality Monitor)
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          จับความผิดปกติแล้วสรุปเป็นผล 🟥 จะขาด (Shortage) / 🟧 ล้น (Over stock) — แนวคิดจาก TEI-TEI ของ Toyota · refresh เองทุก 1 นาที
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {[
          { icon: '🟥', label: 'จะขาด (Shortage)', value: nShort, warn: nShort > 0, tone: '#ef4444' },
          { icon: '🟧', label: 'ล้น (Over stock)', value: nOver, warn: nOver > 0, tone: '#f59e0b' },
          { icon: '⏰', label: 'รอบส่งเลยเวลา', value: nLate, warn: nLate > 0, tone: '#ef4444' },
          { icon: '📊', label: 'รายการทั้งหมด', value: scoped.length, tone: 'var(--text)' },
        ].map(c => (
          <div key={c.label} style={{ flex: '1 1 170px', background: 'var(--bg2)', border: `1px solid ${c.warn ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`, borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{c.icon} {c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: c.warn && c.value > 0 ? c.tone : 'var(--text)', fontFamily: 'var(--font-display)' }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        {[['all', 'ทั้งหมด'], ['shortage', '🟥 จะขาด'], ['over', '🟧 ล้น']].map(([k, l]) => (
          <button key={k} onClick={() => setKindFilter(k)} style={{
            padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-body)',
            background: kindFilter === k ? 'var(--accent)' : 'var(--bg2)', color: kindFilter === k ? '#08130a' : 'var(--text2)',
            border: `1px solid ${kindFilter === k ? 'var(--accent)' : 'var(--border)'}`,
          }}>{l}</button>
        ))}
        {lines.length > 0 && (
          /* ไลน์ที่มีเรื่องเตือน — จัดลำดับชั้นตามผัง (แม่→ลูก) ส่วนคลังที่ไม่ใช่ไลน์ผลิตแยก optgroup
             scope ถูกกรองที่ `scoped` แล้ว จึงไม่ต้องส่ง role/sections ซ้ำ */
          <LineSelect
            lines={prodLines.filter(l => lines.includes(l.name))}
            value={lineFilter} onChange={setLineFilter} placeholder="ทุกไลน์"
            style={{ padding: '7px 10px', borderRadius: 8, fontSize: 13, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', width: 200, marginLeft: 'auto' }}
            extraGroups={[{ label: '🏬 คลัง', options: lines.filter(n => !prodLines.some(l => l.name === n)).map(n => ({ value: n })) }]}
          />
        )}
      </div>

      {loading ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>
      ) : shown.length === 0 ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: '#22c55e', fontSize: 14, fontWeight: 700 }}>
          ✅ ไม่พบความผิดปกติ — สต๊อกอยู่ในเกณฑ์ min/max และรอบส่งปกติ
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(290px, 100%), 1fr))', gap: 11 }}>
          {shown.map((f, i) => {
            const red = f.kind === 'shortage';
            const tone = red ? '#ef4444' : '#f59e0b';
            const blink = red && f.sev >= 3;   // Andon: แดงกระพริบเฉพาะรุนแรง (ขาดจริง/เลยเวลา) · เหลืองนิ่ง
            // กระพริบใช้ class กลาง .mo-card-alert (index.css) — มี [data-perf="lite"] override สำหรับจอ TV
            // ห้ามเขียน keyframes กระพริบเองต่อหน้า (UI-CONVENTIONS §2 · QC audit 2026-08-03)
            return (
              <div key={i} className={blink ? 'mo-card-alert' : undefined} style={{
                border: `1px solid ${tone}`, borderLeft: `3px solid ${tone}`, borderRadius: 11, padding: 12,
                background: `color-mix(in srgb, ${tone} 8%, var(--card))`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>{f.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: tone, whiteSpace: 'nowrap' }}>{red ? '🟥 จะขาด' : '🟧 ล้น'}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, fontWeight: 700 }}>
                  {f.line || '—'}{f.mat ? ` · ${f.mat}` : ''}
                </div>
                {f.part && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{f.part}</div>}
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6, borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
                  {f.detail} <span style={{ opacity: 0.7 }}>· เคส {f.code}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
        แหล่งข้อมูล: on-hand (line_stock_summary) เทียบ Min/Max (kanban_standards จาก 🎴 คำนวณ Kanban) · รอบส่ง (kanban_delivery_rounds/kanban_deliveries) · สั่งซื้อ (purchase_requests) ·
        เคส "ผิดกล่อง/pattern/pallet" ในตาราง TPS 17 เคส ต้องมีการสแกนคัมบัง/leveling pattern ก่อน = เฟสถัดไป
      </div>
    </div>
  );
}
