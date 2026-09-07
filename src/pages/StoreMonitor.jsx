import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import LineSelect from '../components/LineSelect';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { visibleInterval } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { splitBySide, sideMatches } from '../utils/logisticSide';
import SideFilterChips from '../components/SideFilterChips';

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

export default function StoreMonitor() {
  const { role, lineId, sections: scopeSecs } = useContext(UserContext);
  const [prodLines, setProdLines] = useState([]); // production_lines (id/name/section/parent) — ใช้คิด scope
  const [findings, setFindings] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [cutMsg, setCutMsg] = useState('');   // ชนเพดานแถว — ข้อมูลมาแล้วแต่ไม่ครบ (คนละเรื่องกับโหลดพัง)
  const [lineFilter, setLineFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('all');   // all | shortage | over
  // ฝั่งงาน — '' ทั้งหมด (default: จอเฝ้าระวังต้องเห็นภาพรวมก่อน) · inbound Store · outbound Warehouse+Delivery
  const [sideFilter, setSideFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // ⚠️ เงื่อนไขตรวจทั้ง 5 เคสอยู่ในวิว `v_store_abnormal` (DR) ที่เดียว —
    //    ตัวแจ้งเตือน (edge store-daily-scan) อ่านวิวตัวเดียวกัน จึงไม่มีทาง drift
    //    ห้ามย้ายเงื่อนไขกลับมาคิดในหน้า
    /* 🔴 กับดักเพดาน 1000 แถว (แก้ 2026-08-26) — เดิม `.select('*')` เฉยๆ ตัดที่ 1000 แถวเงียบ
       ⇒ ตัวนับบนจอเป็นเลขปลอม และเคสที่เกินหายไปโดยไม่มีใครรู้ (แจ้งเตือนก็เจอบั๊กเดียวกัน)
       เรียงรุนแรงก่อน — ชนเพดานเมื่อไหร่จะได้ตัดตัวเบาทิ้ง ไม่ใช่ตัดตัวหนัก
       ⚠️ `.range()` ต้องคู่กับ `.order()` ที่คงที่ ไม่งั้นแถวหลุด/ซ้ำระหว่างหน้า */
    const PAGE = 1000, MAX_PAGES = 12;
    const rows = []; let error = null, cut = false, p = 0;
    for (; p < MAX_PAGES; p++) {
      const { data, error: e } = await supabaseDR.from('v_store_abnormal').select('*')
        .order('sev', { ascending: false }).order('code').order('mat_no')
        .range(p * PAGE, (p + 1) * PAGE - 1);
      if (e) { error = e; break; }
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    if (p >= MAX_PAGES) cut = true;
    const { data: lines } = await supabase.from('production_lines').select('id, name, section, parent_line_name, is_active');
    const f = rows;
    setProdLines(lines || []);
    // โหลดไม่สำเร็จ ≠ ไม่มีเรื่องผิดปกติ — ต้องบอกให้รู้ ห้ามขึ้นจอเขียว "ปกติดี"
    setLoadErr(error ? (error.message || 'โหลดไม่สำเร็จ') : '');
    // ⚠️ ชนเพดาน ≠ โหลดพัง — คนละข้อความ (ข้อมูลมาแล้วแค่ไม่ครบ) แต่ห้ามเงียบเหมือนกัน
    setCutMsg(!error && cut ? `${PAGE * MAX_PAGES}` : '');
    setFindings(error ? [] : (f || []).map(r => ({
      kind: r.kind, code: r.code, title: r.title,
      line: r.line_name || '', mat: r.mat_no || '', part: r.part_name || '',
      detail: r.detail, sev: Number(r.sev) || 1,
    })));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const stopPoll = visibleInterval(load, RATE.ANALYTIC);
    return () => stopPoll();
  }, [load]);


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
  // ⚠️ แถวของ "คลังกลาง" (STORE / FG WAREHOUSE — line ที่ไม่ใช่ไลน์ผลิตในทะเบียน) ต้องผ่าน scope เสมอ
  //    เหมือน line ว่าง — ไม่งั้น role ที่ถูกจำกัด sections/leader มองไม่เห็น shortage ของคลังกลางเลย
  //    ทั้งที่เป็นของส่วนกลางที่ทุกคนพึ่ง (QC flow-audit #33)
  const allProdNames = useMemo(() => new Set(prodLines.map(l => l.name)), [prodLines]);
  const scoped = useMemo(
    () => (scopeLineNames
      ? findings.filter(f => !f.line || !allProdNames.has(f.line) || scopeLineNames.has(f.line))
      : findings),
    [findings, scopeLineNames, allProdNames]);

  const lines = useMemo(() => [...new Set(scoped.map(f => f.line).filter(Boolean))].sort(), [scoped]);
  /* จอนี้คาบ 2 ฝั่งโดยธรรมชาติ (เคส A/B เทียบ min-max ของทุกเลข MAT · E ใบสั่งซื้อค้าง)
     → ให้กรองฝั่งได้ แต่ default = ทั้งหมด เพราะเป็นจอเฝ้าระวังภาพรวม (mat = ตัวจัดฝั่ง) */
  const sideCounts = useMemo(() => {
    const g = splitBySide(scoped, f => f.mat);
    return { inbound: g.inbound.length, outbound: g.outbound.length, unknown: g.unknown.length };
  }, [scoped]);
  const shown = scoped
    .filter(f => !lineFilter || f.line === lineFilter)
    .filter(f => kindFilter === 'all' || f.kind === kindFilter)
    .filter(f => sideMatches(f.mat, sideFilter))
    .sort((a, b) => b.sev - a.sev || String(a.line).localeCompare(String(b.line)));

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
          จับความผิดปกติแล้วสรุปเป็นผล 🟥 จะขาด (Shortage) / 🟧 ล้น (Over stock) — แนวคิดจาก TEI-TEI ของ Toyota · เงื่อนไขตรวจอยู่ในวิว v_store_abnormal ที่เดียว (ตัวแจ้งเตือนใช้ตัวเดียวกัน)
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

      {/* หน้านี้อยู่ทั้งหมวดขาเข้า-ขาออก (คาบ 2 ฝั่งจริง) → กรองฝั่งได้ แต่ default เห็นภาพรวมทั้งหมด */}
      <div style={{ marginBottom: 12 }}>
        <SideFilterChips value={sideFilter} onChange={setSideFilter} counts={sideCounts} unit="เรื่อง" />
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

      {loadErr && (
        <div style={{ ...card, borderColor: 'rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.08)', padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#ef4444', fontWeight: 700 }}>
          ⚠ โหลดข้อมูลเฝ้าระวังไม่สำเร็จ — <b>ไม่ได้แปลว่าไม่มีเรื่องผิดปกติ</b> ({loadErr})
        </div>
      )}
      {cutMsg && (
        <div style={{ ...card, borderColor: 'rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.08)', padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#f59e0b', fontWeight: 700 }}>
          ⚠ รายการผิดปกติเกิน {cutMsg} รายการ — แสดงเฉพาะที่รุนแรงที่สุด <b>ตัวเลขบนจอยังไม่ครบ</b>
        </div>
      )}
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
                // พื้นการ์ด = สีการ์ด + เคลือบสีสถานะจางๆ
                // ⚠️ ห้ามใช้ color-mix() — Chromium ต้อง 111+ แต่จอ TV ที่ใช้จริง (LG webOS 23) = Chromium 94
                //    ค่าที่ parse ไม่ได้ = ทั้งบรรทัด background ถูกทิ้ง → การ์ดพื้นโปร่งบนจอ TV
                //    ใช้ gradient 2 stop สีเดียวแทน = เคลือบทับสีการ์ดเหมือนกันเป๊ะ แต่รองรับทุกเบราว์เซอร์
                background: 'var(--card)',
                backgroundImage: `linear-gradient(${tone}14, ${tone}14)`,
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
