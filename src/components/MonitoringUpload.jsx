/* ═══ 📗 อัพโหลดไฟล์ Monitoring ของแพลนนิ่ง — ช่องทางที่ 4 ของความต้องการลูกค้า (2026-09-23) ═══
   user 23/09: *"ไฟล์ที่แพลนนิ่งบอกว่าใช้วางแผนงานรายการอื่น"* (1.Monitoring-<เดือน>.xlsx)
   ลูกค้าที่ไม่ส่ง EDI — TSPK · TSESA · TSLA · TSRA · GWM · Argen — แพลนนิ่งคุมด้วยไฟล์นี้มือ

   🔴 กติกาของจอนี้
   1. **ดูก่อนเขียนเสมอ** — กดอัพโหลดแล้วขึ้นสรุปว่าจะเขียนอะไรกี่แถว ต้องกดยืนยันอีกที
      (ไฟล์นี้แตะ 5 ตารางพร้อมกัน รวมสต็อกจริง — พลาดแล้วตามแก้ยาก)
   2. **ชีทที่แกะไม่ได้ / แถวที่ตกเลข SAP / ยอดติดลบ / บล็อกซ้ำ ต้องขึ้นจอทุกตัว ห้ามเงียบ**
   3. **ยอดคงเหลือติดลบไม่เขียนทับสต็อก** — ในไฟล์นี้แปลว่า "ยังไม่ได้ผลิต" ไม่ใช่ของติดลบ
   4. **ประวัติการส่งลง `monitoring_shipments` เท่านั้น** ห้ามลง `customer_shipping_orders`
      (/dept-dashboard กรอง due_date วันนี้/พรุ่งนี้ แล้วนับ "ส่งแล้วกี่ใบ" ⇒ ตัวเลขส่งมอบจะเฟ้อ)
   5. **LOT/Packing ไม่เขียนทับ `kanban_standards`** — ตารางนั้นมี 30 ไฟล์พึ่งพา (kanban card ·
      OEE · Heijunka · QR) · จอนี้แค่**เทียบให้เห็นว่าต่างกันตรงไหน** แล้วให้คนไปแก้เอง
      (กฎเดิมของระบบ: ระบบเสนอ คนตัดสิน)
   ═══════════════════════════════════════════════════════════════════════════════ */
import { useState, useCallback, useRef } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import fetchAllRows from '../utils/fetchAllRows';
import { parseMonitoringWorkbook, monitoringToRecords } from '../utils/monitoringSheet';

/* วันที่งาน (ตัด 08:00 — งานกะดึกข้ามวันนับเป็นวันก่อนหน้า)
   ⚠️ ห้ามใช้ toISOString() — คืน UTC ทำให้วันที่เพี้ยนสำหรับไทย (กฎ Date/Time ใน CLAUDE.md)
   (ยังไม่มี util กลางของ getWorkDate — ทุกหน้าประกาศเองเหมือนกันหมด) */
const getWorkDate = () => {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const monthKeyOf = (d) => String(d || '').slice(0, 7);
const fmt = (n) => (Number(n) || 0).toLocaleString();
const CHUNK = 400;   // กันคำขอยาวเกินเพดาน proxy (กฎเหล็กการเขียน DB ข้อ 5)

async function insertChunked(table, rows, label) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    if (!checkWrite(await supabaseDR.from(table).insert(rows.slice(i, i + CHUNK)), label)) return false;
  }
  return true;
}

export default function MonitoringUpload({ canUpload, fullName, onImported }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);   // { fileName, month, rec, parsed, stockPlan, lotDiff }
  const fileRef = useRef(null);

  /* ── อ่านไฟล์ → แกะ → เตรียมสิ่งที่จะเขียน (ยังไม่เขียน) ─────────────────── */
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setBusy(true); setPreview(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheets = wb.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true }),
      }));
      const today = getWorkDate();
      const parsed = parseMonitoringWorkbook(sheets, { asOf: today });
      if (!parsed.press.length && !parsed.customer.length) {
        toast.error('แกะไฟล์นี้ไม่ได้ — ไม่พบชีทแบบ Monitoring (ไลน์ปั๊ม / ชีทลูกค้า)');
        setBusy(false); return;
      }

      /* ไลน์ของพาร์ท + ยอดคงเหลือปัจจุบัน — อ่านจากทะเบียนจริง ไม่เดาในไฟล์ */
      const { data: prodRows, error: prodErr } = await fetchAllRows(
        supabaseDR, 'dr_products', 'mat_no, name, line_name', q => q.order('mat_no'));
      if (prodErr) { toast.error(`อ่านทะเบียนสินค้าไม่สำเร็จ: ${prodErr.message} — ยังไม่เขียนอะไร`); setBusy(false); return; }
      const norm = (s) => String(s ?? '').replace(/[\s-]/g, '').toUpperCase();
      const lineOfMat = {}, nameOfMat = {};
      (prodRows || []).forEach(p => {
        const k = norm(p.mat_no);
        if (!k) return;
        if (p.line_name && !lineOfMat[k]) lineOfMat[k] = p.line_name;
        if (!nameOfMat[k]) nameOfMat[k] = p.name || '';
      });

      const month = monthKeyOf(today);
      const rec = monitoringToRecords(parsed, { monthKey: month, today, lineOfMat: (m) => lineOfMat[norm(m)] || null });

      /* สต็อก: คิดส่วนต่างจากยอดปัจจุบัน (ลง ledger เป็น adjust — ย้อนได้ ตรวจได้) */
      const { data: stkRows, error: stkErr } = await fetchAllRows(
        supabaseDR, 'line_stock_summary', 'line_name, mat_no, qty_on_hand', q => q.order('line_name').order('mat_no'));
      if (stkErr) { toast.error(`อ่านยอดคงเหลือไม่สำเร็จ: ${stkErr.message} — ยังไม่เขียนอะไร`); setBusy(false); return; }
      const have = {};
      (stkRows || []).forEach(s => { have[`${s.line_name}|${norm(s.mat_no)}`] = Number(s.qty_on_hand) || 0; });
      const stockPlan = rec.stock.map(s => {
        const cur = have[`${s.line_name}|${norm(s.mat_no)}`] || 0;
        return { ...s, have: cur, delta: s.qty - cur };
      }).filter(s => s.delta !== 0);

      /* LOT/Packing: เทียบกับ kanban_standards — แสดงอย่างเดียว ไม่เขียน */
      const { data: kbRows, error: kbErr } = await fetchAllRows(
        supabaseDR, 'kanban_standards', 'mat_no, qty_per_kanban, lot_size', q => q.order('mat_no'));
      if (kbErr) toast.info('อ่านทะเบียน kanban ไม่ได้ — ข้ามการเทียบ LOT/Packing (ส่วนอื่นยังนำเข้าได้)');
      const kb = {};
      (kbRows || []).forEach(k => { kb[norm(k.mat_no)] = k; });
      const lotDiff = rec.lots.map(l => {
        const cur = kb[norm(l.mat_no)];
        const dLot = l.lot_size != null && cur && Number(cur.lot_size) !== l.lot_size;
        const dPack = l.qty_per_kanban != null && cur && Number(cur.qty_per_kanban) !== l.qty_per_kanban;
        if (!cur) return { ...l, status: 'ไม่มีในทะเบียน kanban' };
        if (dLot || dPack) return { ...l, status: 'ไม่ตรง', curLot: cur.lot_size, curPack: cur.qty_per_kanban };
        return null;
      }).filter(Boolean);

      setPreview({ fileName: file.name, month, parsed, rec, stockPlan, lotDiff, nameOfMat, norm, today });
    } catch (e) {
      toast.error(`อ่านไฟล์ไม่สำเร็จ: ${e.message}`);
    }
    setBusy(false);
  }, []);

  /* ── เขียนจริง (หลังกดยืนยัน) ────────────────────────────────────────────── */
  const doImport = useCallback(async () => {
    if (!preview) return;
    const { rec, month, stockPlan, nameOfMat, norm, today } = preview;
    setBusy(true);
    const by = fullName || 'Monitoring import';
    let ok = true;

    // ① FC รายเดือน — ลบของรอบก่อนของเดือนนี้ก่อน (อัพซ้ำได้ ไม่เกิดแถวซ้ำ)
    ok = ok && checkWrite(await supabaseDR.from('customer_forecasts')
      .delete().eq('source', 'monitoring').eq('period_month', `${month}-01`), 'ล้าง forecast รอบก่อน');
    if (ok && rec.forecasts.length) {
      ok = await insertChunked('customer_forecasts', rec.forecasts.map(f => ({
        mat_no: f.mat_no, part_name: f.part_name || null, customer_part_no: f.customer_part_no,
        period_month: f.period_month, qty: f.qty, source: 'monitoring', note: f.note,
      })), 'บันทึก forecast');
    }

    // ② ออเดอร์ล่วงหน้า — เฉพาะดิวตั้งแต่วันนี้ไป (ดิวเก่าเป็นประวัติ ไม่ใช่ backlog)
    const future = rec.orders.filter(o => !o.past);
    if (ok) ok = checkWrite(await supabaseDR.from('customer_shipping_orders')
      .delete().eq('source', 'monitoring').eq('status', 'pending'), 'ล้างออเดอร์รอบก่อน');
    if (ok && future.length) {
      ok = await insertChunked('customer_shipping_orders', future.map(o => ({
        mat_no: o.mat_no, part_name: o.part_name || nameOfMat[norm(o.mat_no)] || null,
        customer_part_no: o.customer_part_no, due_date: o.due_date, qty: o.qty,
        status: 'pending', source: 'monitoring', note: o.note, created_by_name: by,
      })), 'บันทึกออเดอร์');
    }

    // ③ ประวัติการส่ง → ตารางของตัวเอง (ห้ามปนกับใบส่งของ)
    const hist = [
      ...rec.shipped.filter(s => s.due_date < today)
        .map(s => ({ mat_no: s.mat_no, ship_date: s.due_date, qty: s.qty, kind: 'out', sheet: s.sheet })),
      ...rec.orders.filter(o => o.past)
        .map(o => ({ mat_no: o.mat_no, ship_date: o.due_date, qty: o.qty, kind: 'requirement',
                     sheet: (String(o.note || '').split('·')[1] || '').trim() || null })),
    ];
    const seen = new Set(), histUniq = [];
    hist.forEach(h => {
      const k = `${h.mat_no}|${h.ship_date}|${h.kind}|${h.sheet || ''}`;
      if (seen.has(k)) return;
      seen.add(k); histUniq.push({ ...h, created_by_name: by });
    });
    if (ok && histUniq.length) {
      for (let i = 0; i < histUniq.length && ok; i += CHUNK) {
        ok = checkWrite(await supabaseDR.from('monitoring_shipments')
          .upsert(histUniq.slice(i, i + CHUNK), { onConflict: 'mat_no,ship_date,kind,sheet', ignoreDuplicates: true }),
          'บันทึกประวัติการส่ง');
      }
    }

    // ④ MIN/MAX ต่อไลน์
    if (ok && rec.levels.length) {
      const lv = rec.levels.map(l => ({
        line_name: l.line_name, mat_no: l.mat_no, min_qty: l.min_qty,
        max_qty: l.max_qty != null && l.max_qty >= l.min_qty ? l.max_qty : null,
        note: l.note, updated_by_name: by,
      }));
      for (let i = 0; i < lv.length && ok; i += CHUNK) {
        ok = checkWrite(await supabaseDR.from('line_part_levels')
          .upsert(lv.slice(i, i + CHUNK), { onConflict: 'line_name,mat_no' }), 'บันทึก MIN/MAX');
      }
    }

    // ⑤ สต็อกให้ตรงชีท — ลง ledger เป็น adjust (ไม่ลบของเก่า ย้อนได้)
    if (ok && stockPlan.length) {
      const tx = stockPlan.map(s => ({
        line_name: s.line_name, mat_no: s.mat_no, part_name: s.part_name || nameOfMat[norm(s.mat_no)] || null,
        qty: s.delta, type: 'adjust', work_date: today, status: 'approved',
        note: `ตั้งยอดให้ตรงไฟล์ Monitoring ${s.sheet} (ก่อนหน้า ${s.have} → ${s.qty})`,
        created_by: by, reviewed_by: by, reviewed_at: new Date().toISOString(),
      }));
      ok = await insertChunked('line_stock_transactions', tx, 'ปรับยอดสต็อก');
    }

    setBusy(false);
    if (!ok) { toast.error('นำเข้าไม่ครบ — ดูข้อความแดงด้านบน แล้วลองใหม่ (อัพซ้ำได้ ไม่เกิดแถวซ้ำ)'); return; }
    toast.success(`นำเข้าสำเร็จ — FC ${rec.forecasts.length} · ออเดอร์ ${future.length} · ประวัติ ${histUniq.length} · MIN ${rec.levels.length} · สต็อก ${stockPlan.length}`);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
    onImported?.();
  }, [preview, fullName, onImported]);

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 };
  const warnBox = (bg, bd) => ({ ...card, background: bg, border: `1px solid ${bd}`, marginTop: 12 });

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>📗 ไฟล์ Monitoring ของแพลนนิ่ง</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
          ไฟล์ <b>1.Monitoring-&lt;เดือน&gt;.xlsx</b> — ลูกค้าที่ไม่ได้ส่ง EDI (TSPK · TSESA · TSLA · TSRA · GWM · Argen)<br />
          ระบบจะอ่าน: <b>FC รายเดือน</b> · <b>MIN/MAX</b> · <b>ออเดอร์ล่วงหน้า</b>ของชีทลูกค้า/Argen ·
          <b> ยอดคงเหลือ</b> · <b>ประวัติการส่ง</b> — แล้วขึ้นสรุปให้ตรวจก่อนเขียนเสมอ
          <div style={{ marginTop: 6, color: 'var(--muted)' }}>
            ⏱️ ยอดคงเหลืออ่าน <b>ณ วันที่ {getWorkDate()}</b> · ช่องวันอนาคตในไฟล์เป็นยอดพยากรณ์ ไม่ใช่ของจริง
          </div>
        </div>
        {!canUpload && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#f59e0b' }}>
            ⚠️ บัญชีนี้ไม่มีสิทธิ์อัพโหลด (ขอสิทธิ์ <code>demand:upload</code> ที่หน้าจัดการสิทธิ์)
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xlsb,.xls" disabled={!canUpload || busy}
                 onChange={e => handleFile(e.target.files?.[0])}
                 style={{ width: 'auto', fontSize: 13 }} />
          {busy && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--muted)' }}>กำลังอ่าน…</span>}
        </div>
      </div>

      {preview && <PreviewPanel p={preview} onCancel={() => { setPreview(null); if (fileRef.current) fileRef.current.value = ''; }}
                                onConfirm={doImport} busy={busy} card={card} warnBox={warnBox} />}
    </div>
  );
}

function PreviewPanel({ p, onCancel, onConfirm, busy, card, warnBox }) {
  const { rec, parsed, stockPlan, lotDiff, month, fileName } = p;
  const future = rec.orders.filter(o => !o.past);
  const past = rec.orders.length - future.length;
  const histCount = rec.shipped.filter(s => s.due_date < p.today).length + past;
  const rows = [
    ['📈 Forecast', `${rec.forecasts.length} แถว · ${fmt(rec.forecasts.reduce((s, r) => s + r.qty, 0))} ชิ้น`, `เดือน ${month} — เขียนทับรอบก่อนของเดือนนี้`],
    ['🚚 ออเดอร์ล่วงหน้า', `${future.length} แถว · ${fmt(future.reduce((s, r) => s + r.qty, 0))} ชิ้น`, 'ดิวตั้งแต่วันนี้ไป — เขียนทับรอบก่อน'],
    ['📜 ประวัติการส่ง', `${histCount} แถว`, 'ลงตารางประวัติ ไม่ใช่ใบส่งของ · อัพซ้ำไม่เกิดแถวซ้ำ'],
    ['📉 MIN/MAX', `${rec.levels.length} พาร์ท`, 'ต่อไลน์ — ทับค่าเดิมของพาร์ทนั้น'],
    ['📦 ปรับยอดสต็อก', `${stockPlan.length} รายการ`, 'ลงเป็นรายการ adjust (ไม่ลบของเก่า ย้อนได้)'],
  ];
  return (
    <div style={{ ...card, borderColor: 'var(--accent)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
        ตรวจก่อนเขียน — <span style={{ color: 'var(--accent)' }}>{fileName}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
        ชีทที่อ่านได้: {[...parsed.press.map(s => s.sheet), ...parsed.customer.map(s => s.sheet)].join(' · ') || '—'}
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map(([t, v, note]) => (
          <div key={t} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) minmax(140px,1fr) 2fr',
                                gap: 8, fontSize: 12, padding: '6px 8px', background: 'var(--bg2)', borderRadius: 6 }}>
            <b>{t}</b><span>{v}</span><span style={{ color: 'var(--muted)' }}>{note}</span>
          </div>
        ))}
      </div>

      {/* ── สิ่งที่ "ไม่" เขียน ต้องบอกให้ครบ ห้ามเงียบ ── */}
      {!!parsed.skipped.length && (
        <div style={warnBox('#78350f22', '#f59e0b')}>
          <b style={{ fontSize: 12 }}>⚠️ ชีทที่อ่านไม่ได้ {parsed.skipped.length} ชีท — ไม่ถูกนำเข้า</b>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{parsed.skipped.join(' · ')}</div>
        </div>
      )}
      {!!parsed.warnings.length && (
        <div style={warnBox('#78350f22', '#f59e0b')}>
          <b style={{ fontSize: 12 }}>⚠️ ข้อมูลในไฟล์ไม่ครบ</b>
          <ul style={{ fontSize: 12, color: 'var(--text2)', margin: '4px 0 0', paddingLeft: 18 }}>
            {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      {!!rec.stockNegative?.length && (
        <div style={warnBox('#7f1d1d22', '#ef4444')}>
          <b style={{ fontSize: 12, color: '#ef4444' }}>🚫 ยอดคงเหลือติดลบ {rec.stockNegative.length} พาร์ท — ไม่เอาไปตั้งยอดสต็อก</b>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
            ในไฟล์นี้ยอดติดลบแปลว่า <b>ความต้องการที่ยังไม่ได้ผลิต</b> ไม่ใช่ของติดลบในคลัง —
            เขียนทับสต็อกจริงไม่ได้ · ตัวอย่าง: {rec.stockNegative.slice(0, 5).map(s => `${s.mat_no} (${fmt(s.qty)})`).join(' · ')}
          </div>
        </div>
      )}
      {!!rec.orderDupes && (
        <div style={warnBox('#78350f22', '#f59e0b')}>
          <b style={{ fontSize: 12 }}>🔁 บล็อกซ้ำในไฟล์ {rec.orderDupes} แถว — ยุบให้แล้ว</b>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
            พาร์ทเดียวถูกเขียนไว้หลายบล็อกในชีทเดียวกัน · ถ้าไม่ยุบ ความต้องการจะกลายเป็น 2 เท่า
          </div>
        </div>
      )}
      {!!lotDiff.length && (
        <div style={warnBox('#1e3a8a22', '#60a5fa')}>
          <b style={{ fontSize: 12 }}>📋 LOT / Packing ไม่ตรงกับทะเบียน kanban {lotDiff.length} พาร์ท — <u>ระบบไม่แก้ให้</u></b>
          <div style={{ fontSize: 12, color: 'var(--text2)', margin: '4px 0 6px' }}>
            ทะเบียน kanban ใช้ร่วมกับบัตรคานบัง · OEE · Heijunka · ป้าย QR — เขียนทับอัตโนมัติกระทบกว้างเกินไป
            ให้ไปแก้เองที่ <b>/products → 🎴 Kanban Std</b> ถ้ายืนยันว่าค่าในไฟล์ถูกกว่า
          </div>
          <div style={{ maxHeight: 160, overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                <th>MAT</th><th>LOT ไฟล์</th><th>LOT ทะเบียน</th><th>Packing ไฟล์</th><th>Packing ทะเบียน</th><th>สถานะ</th>
              </tr></thead>
              <tbody>
                {lotDiff.slice(0, 40).map((l, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border2)' }}>
                    <td>{l.mat_no}</td><td>{l.lot_size ?? '—'}</td><td>{l.curLot ?? '—'}</td>
                    <td>{l.qty_per_kanban ?? '—'}</td><td>{l.curPack ?? '—'}</td><td>{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lotDiff.length > 40 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>… อีก {lotDiff.length - 40} พาร์ท</div>}
          </div>
        </div>
      )}
      {!!past && (
        <div style={{ ...warnBox('var(--bg2)', 'var(--border)'), fontSize: 12, color: 'var(--text2)' }}>
          ℹ️ ความต้องการที่ดิวเก่ากว่าวันนี้ <b>{past} แถว</b> ถูกเก็บเป็น<b>ประวัติ</b> ไม่ใช่งานค้างส่ง —
          ไม่งั้นแผนรายวันจะขึ้น backlog ปลอมก้อนใหญ่ในวันแรก
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={onConfirm} disabled={busy}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 6,
                         background: 'var(--accent)', color: '#062', border: 'none', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'กำลังเขียน…' : '✔ ยืนยันนำเข้า'}
        </button>
        <button onClick={onCancel} disabled={busy}
                style={{ padding: '8px 16px', fontSize: 13, borderRadius: 6, background: 'var(--bg3)',
                         color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer' }}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
