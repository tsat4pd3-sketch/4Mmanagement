/**
 * QrLabels — 🏷️ พิมพ์ป้าย QR อุปกรณ์ (2026-08-03)
 *
 * เลือกไลน์/หมวด → ติ๊กรายการ → พิมพ์เป็นแผ่นสติกเกอร์ (A4 หลายดวงต่อแผ่น)
 * ป้ายแต่ละดวงมี: QR (uuid — ไม่เปลี่ยนแม้เปลี่ยนเลขเครื่อง) + เลขเครื่องตัวใหญ่ให้คนอ่าน + ชื่อ/ไลน์
 *
 * ทำไม QR เก็บ uuid ไม่ใช่เลขเครื่อง: ดูเหตุผลเต็มใน src/utils/qrCode.js
 * เอกสารพิมพ์ผ่านทะเบียนเอกสารกลาง (doc_key `qr_label`) ตามกฎ CLAUDE.md — ห้าม hardcode เลขฟอร์ม
 */
import { useState, useEffect, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { inSectionScope } from '../utils/sectionScope';
import { buildQrPayload, QR_KINDS } from '../utils/qrCode';
import { withDocFoot, loadDocForms, docFormSync, fullCode } from '../utils/docForms';
import LineSelect from '../components/LineSelect';
import useProductionLines from '../utils/useProductionLines';

const SIZES = {
  sm: { key: 'sm', label: 'เล็ก 40×25mm', w: 40, h: 25, qr: 17, no: 8, sub: 4.6 },
  md: { key: 'md', label: 'กลาง 60×40mm', w: 60, h: 40, qr: 26, no: 12, sub: 6 },
  lg: { key: 'lg', label: 'ใหญ่ 90×60mm', w: 90, h: 60, qr: 38, no: 17, sub: 8 },
};

export default function QrLabels() {
  const { role, sections: scopeSecs = [], lineId } = useContext(UserContext);
  const canPrint = can('qr_labels', 'print', role);

  const [kind, setKind] = useState('machine');   // machine | jig
  const [lines, setLines] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterLine, setFilterLine] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [size, setSize] = useState('md');
  const [shadowCount, setShadowCount] = useState(0);   // เครื่องจักรที่มีแถวเงาในทะเบียน PM (ถูกกรองออกจากแท็บจิ๊ก)

  useEffect(() => { loadDocForms(); }, []);

  /* ── ไลน์ที่ user มีสิทธิ์เห็น (pattern มาตรฐาน: leader → family, อื่น → sections) ── */
  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name')
      .then(({ data }) => setLines(data || []));
  }, []);

  const scopedLineNames = useMemo(() => {
    if (!lines.length) return null;                       // ยังไม่โหลด = ยังไม่กรอง
    if (role === 'leader' && lineId) {
      const self = lines.find(l => String(l.id) === String(lineId));
      return self ? new Set(getLineFamilyNames(lines, self.name)) : new Set();
    }
    if (scopeSecs.length) return new Set(lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name));
    return null;                                          // ไม่จำกัด
  }, [lines, role, lineId, scopeSecs]);

  /* ── โหลดอุปกรณ์ ── */
  useEffect(() => {
    let alive = true;
    setLoading(true); setSel(new Set()); setShadowCount(0);
    const load = async () => {
      if (kind === 'machine') {
        const { data } = await supabaseDR.from('machines')
          .select('id, machine_no, machine_name, line_name, equipment_category, is_active')
          .eq('is_active', true).order('line_name').order('machine_no');
        if (alive) setRows(data || []);
      } else {
        const { data } = await supabaseDR.from('jigs')
          .select('id, jig_no, name, part_name, line_name, equipment_type, machine_id')
          .order('line_name').order('jig_no');
        // ⚠️ ตาราง jigs ไม่ใช่ "ตารางจิ๊ก" — เป็นทะเบียนอุปกรณ์ที่มีแผน PM
        // เครื่องจักรที่ถูกวางบนผัง PM จะมี "แถวเงา" อยู่ในนี้ด้วย (machine_id ชี้กลับไป machines)
        // ต้องกรองเงาออก ไม่งั้นพิมพ์ป้ายซ้ำ = QR 2 ใบคนละรหัสติดเครื่องตัวเดียวกัน (สแกนแล้วคนละที่)
        // เครื่องจักรพิมพ์จากแท็บ "เครื่องจักร" ทางเดียวเท่านั้น
        const realJigs = (data || []).filter(j => !j.machine_id && j.equipment_type !== 'machine');
        if (alive) { setRows(realJigs); setShadowCount((data || []).length - realJigs.length); }
      }
      if (alive) setLoading(false);
    };
    load();
    return () => { alive = false; };
  }, [kind]);

  const visible = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter(r => {
      const ln = r.line_name || '';
      if (scopedLineNames && ln && !scopedLineNames.has(ln)) return false;
      if (filterLine && ln !== filterLine) return false;
      if (!kw) return true;
      return [r.machine_no, r.jig_no, r.machine_name, r.name, r.part_name, ln]
        .some(v => String(v || '').toLowerCase().includes(kw));
    });
  }, [rows, q, filterLine, scopedLineNames]);

  const prodLines = useProductionLines();   // ทะเบียนไลน์ (ให้ dropdown มีลำดับชั้น)
  const lineOpts = useMemo(() => {
    const s = new Set(rows.map(r => r.line_name).filter(Boolean)
      .filter(n => !scopedLineNames || scopedLineNames.has(n)));
    return [...s].sort();
  }, [rows, scopedLineNames]);

  const noOf = (r) => (kind === 'machine' ? r.machine_no : r.jig_no) || '';
  const nameOf = (r) => (kind === 'machine' ? r.machine_name : (r.name || r.part_name)) || '';
  const missingNo = visible.filter(r => !noOf(r).trim()).length;

  const toggle = (id) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(prev => prev.size === visible.length ? new Set() : new Set(visible.map(r => r.id)));

  /* ── พิมพ์ ── */
  const handlePrint = async () => {
    const picked = visible.filter(r => sel.has(r.id));
    if (!picked.length) return toast.error('ยังไม่ได้เลือกรายการ');
    const sz = SIZES[size];
    const QR = (await import('qrcode')).default;
    const df = docFormSync('qr_label', { form_code: null, title: 'ป้าย QR อุปกรณ์' });

    const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const cells = [];
    for (const r of picked) {
      const payload = buildQrPayload(kind, r.id);
      // margin:0 + errorCorrectionLevel M — ป้ายเล็กสแกนติดง่ายกว่าเมื่อ QR เต็มพื้นที่
      const svg = await QR.toString(payload, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
      const no = noOf(r) || '— ยังไม่มีเลข —';
      cells.push(`<div class="lb">
        <div class="qr">${svg}</div>
        <div class="tx">
          <div class="no">${esc(no)}</div>
          <div class="nm">${esc(nameOf(r))}</div>
          <div class="ln">${esc(r.line_name || '')}</div>
        </div>
      </div>`);
    }

    const head = fullCode(df) ? `<div class="hd">${esc(fullCode(df))}</div>` : '';
    const html = `<html><head><meta charset="utf-8"><title>ป้าย QR ${QR_KINDS[kind].label}</title>
<style>
  @page { size: A4; margin: 8mm; }
  body { font-family: Sarabun, Tahoma, sans-serif; margin: 0; color: #000; }
  .hd { font-size: 9px; color: #555; margin-bottom: 4mm; }
  .sheet { display: flex; flex-wrap: wrap; gap: 3mm; }
  .lb { width: ${sz.w}mm; height: ${sz.h}mm; border: 0.4mm dashed #999; border-radius: 1.5mm;
        display: flex; align-items: center; gap: 1.5mm; padding: 1.5mm; box-sizing: border-box;
        page-break-inside: avoid; overflow: hidden; }
  .qr { width: ${sz.qr}mm; height: ${sz.qr}mm; flex: none; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .tx { min-width: 0; flex: 1; }
  .no { font-size: ${sz.no}px; font-weight: 800; line-height: 1.05; word-break: break-all; }
  .nm { font-size: ${sz.sub}px; color: #333; line-height: 1.15; margin-top: 0.6mm;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .ln { font-size: ${sz.sub}px; color: #666; margin-top: 0.4mm; }
</style></head><body>${head}<div class="sheet">${cells.join('')}</div>
<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script>
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) return toast.error('เบราว์เซอร์บล็อก popup — อนุญาตแล้วลองใหม่');
    w.document.write(withDocFoot(html, 'qr_label'));
    w.document.close();
  };

  const th = { padding: '8px 10px', fontSize: 12, color: 'var(--muted)', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border)' };
  const td = { padding: '7px 10px', fontSize: 13, color: 'var(--text)', borderBottom: '1px solid var(--border)' };
  const chip = (active, color) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? color : 'var(--border2)'}`,
    background: active ? `${color}18` : 'var(--bg3)', color: active ? color : 'var(--muted)',
  });

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px) clamp(14px,3.5vw,32px)', background: 'var(--bg)', minHeight: '100%' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 }}>🏷️ พิมพ์ป้าย QR อุปกรณ์</h1>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, marginBottom: 18 }}>
        พิมพ์ป้ายติดเครื่องจักร/จิ๊ก แล้วสแกนเลือกอุปกรณ์ได้ทันทีในหน้าแจ้งซ่อม · ตรวจ PM · บันทึก Downtime
      </div>

      {/* เลือกชนิด */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => setKind('machine')} style={chip(kind === 'machine', '#4d9fff')}>⚙️ เครื่องจักร</button>
        <button onClick={() => setKind('jig')} style={chip(kind === 'jig', '#34d399')}>🧩 จิ๊ก/แม่พิมพ์</button>
      </div>

      {/* ตัวกรอง */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {/* ไลน์ของอุปกรณ์ — จัดลำดับชั้นตามผัง · ชื่อกลุ่มเครื่องปั๊มที่ไม่มีในทะเบียนไลน์
            (เช่นไลน์แม่พิมพ์) แยก optgroup ไว้ท้าย ห้ามตัดทิ้ง ไม่งั้นกรองหาอุปกรณ์ไม่เจอ */}
        <LineSelect
          lines={prodLines.filter(l => lineOpts.includes(l.name))}
          value={filterLine} onChange={setFilterLine} placeholder="ทุกไลน์"
          style={{ width: 200, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13 }}
          extraGroups={[{ label: '🔧 อื่นๆ', options: lineOpts.filter(n => !prodLines.some(l => l.name === n)).map(n => ({ value: n })) }]}
        />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา เลข/ชื่อ…"
          style={{ width: 220, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13 }} />
        <select value={size} onChange={e => setSize(e.target.value)}
          style={{ width: 170, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13 }}>
          {Object.values(SIZES).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>เลือก {sel.size} / {visible.length}</span>
        {canPrint && (
          <button onClick={handlePrint} disabled={!sel.size}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', fontSize: 13.5, fontWeight: 800, cursor: sel.size ? 'pointer' : 'not-allowed', background: sel.size ? 'var(--accent)' : 'var(--bg3)', color: sel.size ? '#08130c' : 'var(--muted)' }}>
            🖨️ พิมพ์ป้าย ({sel.size})
          </button>
        )}
      </div>

      {kind === 'jig' && shadowCount > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--text2)', background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
          ℹ️ ซ่อน {shadowCount} รายการที่จริงๆ แล้วเป็น <b>เครื่องจักร</b> (อยู่ในทะเบียน PM ด้วยเพราะมีแผนตรวจ) —
          พิมพ์ป้ายเครื่องจักรที่แท็บ <b>⚙️ เครื่องจักร</b> ทางเดียว ไม่งั้นจะได้ QR 2 ใบคนละรหัสติดเครื่องตัวเดียวกัน
        </div>
      )}
      {kind === 'jig' && !loading && !visible.length && (
        <div style={{ fontSize: 12.5, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
          ⚠️ ยังไม่มีข้อมูลจิ๊ก/แม่พิมพ์ในระบบ — ลงทะเบียนที่หน้า PM Setup ก่อน แล้วกลับมาพิมพ์ป้ายได้ทันที
        </div>
      )}
      {missingNo > 0 && (
        <div style={{ fontSize: 12.5, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          ⚠️ {missingNo} รายการยังไม่มีเลขกำกับ — พิมพ์ป้ายได้ (QR ใช้รหัสภายใน) แต่คนอ่านป้ายจะไม่เห็นเลข แนะนำใส่เลขให้ครบก่อน
        </div>
      )}

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 44 }}>
                <input type="checkbox" checked={visible.length > 0 && sel.size === visible.length} onChange={toggleAll} style={{ width: 'auto', cursor: 'pointer' }} />
              </th>
              <th style={th}>เลข</th>
              <th style={th}>ชื่อ</th>
              <th style={th}>ไลน์</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด…</td></tr>}
            {!loading && !visible.length && <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--muted)' }}>ไม่พบรายการ</td></tr>}
            {visible.map(r => (
              <tr key={r.id} onClick={() => toggle(r.id)} style={{ cursor: 'pointer', background: sel.has(r.id) ? 'var(--accent-dim)' : 'transparent' }}>
                <td style={td}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} onClick={e => e.stopPropagation()} style={{ width: 'auto', cursor: 'pointer' }} /></td>
                <td style={{ ...td, fontWeight: 700, fontFamily: 'monospace' }}>{noOf(r) || <span style={{ color: '#f59e0b' }}>— ไม่มีเลข —</span>}</td>
                <td style={td}>{nameOf(r)}</td>
                <td style={{ ...td, color: 'var(--text2)' }}>{r.line_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
