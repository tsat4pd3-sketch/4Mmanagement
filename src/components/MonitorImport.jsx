import { useState, useCallback, useRef } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import { parseSheetForBoard } from '../utils/monitoringSheet';
import {
  ROW_PRESETS, BOARD_DEFAULTS, BOARD_TABS, boardKeyOfSheet, SHEET_LINE_HINT, ROW_LABEL,
  partRowKey, dedupeByKey,
} from '../utils/monitorBoards';

/* ══ 📗 MonitorImport — ยกไฟล์ Excel ของทีมวางแผนเข้าเป็นบอร์ด (2026-10-01) ═══════════════
   🔴 กติกาเดียวกับจอนำเข้าตัวอื่นในระบบ (MonitoringUpload 23/09 วางมาตรฐานไว้แล้ว):
   1. **ดูก่อนเขียนเสมอ** — เลือกไฟล์แล้วขึ้นสรุปว่าจะสร้าง/อัพเดทอะไรกี่แถว ต้องกดยืนยันอีกที
   2. **ชีทที่ยกไม่ได้ ต้องขึ้นจอพร้อมเหตุผล ห้ามเงียบ** — แยก "ตั้งใจไม่ยก" ออกจาก "แกะไม่ได้"
      (ไฟล์เดือนหน้าอาจเพิ่มชีทใหม่ ถ้าจอบอกแค่ "ข้าม 3 ชีท" ไม่มีใครรู้ว่าต้องไปทำอะไรต่อ)
   3. **นำเข้าซ้ำ = อัพเดทบอร์ดเดิม ไม่สร้างซ้ำ** (คีย์บอร์ดมาจากชื่อชีท) — ทีมวางแผนนำเข้า
      ไฟล์เดือนใหม่ทับได้เรื่อยๆ โดยบอร์ดไม่งอก
   4. **ไม่แตะตารางอื่นเลย** — ไม่เขียน dr_products / kanban_standards / customer_shipping_orders
      (จอ `/planner-sales?tab=monitoring` เป็นคนทำหน้าที่นั้น และมีกฎของมันเอง) ⇒ นำเข้าผิดก็
      ลบบอร์ดทิ้งได้ ไม่กระทบข้อมูลผลิตจริง

   ⚠️ **ไม่ยัดค่าแถวที่คำนวณได้ลงฐาน** — UNBOUND/BALANCE ที่อ่านมาจากไฟล์ถูกเก็บเฉพาะ
      "ช่องยอดยกมา" (คอลัมน์แรก) ช่องที่เหลือปล่อยให้ `monitorGrid` คิดใหม่ทุกครั้ง
      เก็บทั้งแถว = มี 2 แหล่งความจริง แล้ววันที่สูตรเปลี่ยน ของเก่าไม่ตามไปด้วย
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const CHUNK = 400;                 // กันคำขอยาวเกินเพดาน proxy (กฎเหล็กการเขียน DB ข้อ 5)
const FS = 12;
const fmt = (n) => Number(n || 0).toLocaleString();

/** แถวที่ "คำนวณได้" — เก็บจากไฟล์เฉพาะช่องยอดยกมา */
const RECUR_KEYS = new Set(['unbound', 'balance', 'at_vendor']);

async function insertChunked(table, rows, label, conflict) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await supabaseDR.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict: conflict });
    /* index เก่า (board_id, mat_no) ยังอยู่ = MAT เดียวกันคนละพาร์ทถูกปฏิเสธ — บอกทางแก้ ไม่ใช่โยนข้อความ pg ดิบ */
    if (/monitor_board_parts_(bm_)?uniq/.test(res.error?.message || '')) {
      toast.error('ยังไม่ได้ถอด index เก่า (board_id, mat_no) ของ monitor_board_parts — '
        + 'MAT เดียวกันคนละพาร์ท (เช่น 300T คว่ำครีบ/หงายครีบ) จึงถูกปฏิเสธ · แจ้ง admin รัน SQL ถอด index');
      return false;
    }
    if (!checkWrite(res, label)) return false;
  }
  return true;
}

export default function MonitorImport({ onClose, fullName, today, onImported }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setBusy(true); setPreview(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheets = wb.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true }),
      }));
      const made = [];
      const skipped = [];
      for (const { name, rows } of sheets) {
        const r = parseSheetForBoard(name, rows, { asOf: today });
        if (!r.kind) { skipped.push({ name, why: r.why, intentional: r.intentional }); continue; }
        const cellCount = r.parts.reduce(
          (a, p) => a + Object.entries(p.cells || {}).reduce(
            (b, [rk, m]) => b + (RECUR_KEYS.has(rk) ? Math.min(1, Object.keys(m).length) : Object.keys(m).length), 0), 0);
        made.push({ ...r, name, cellCount });
      }
      setPreview({ fileName: file.name, made, skipped });
      if (!made.length) toast.error('ไม่พบชีทที่ยกเข้าระบบได้ในไฟล์นี้');
    } catch (e) {
      toast.error(`อ่านไฟล์ไม่สำเร็จ: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [today]);

  const run = useCallback(async () => {
    if (!preview?.made?.length) return;
    setBusy(true);
    try {
      let boardsN = 0, partsN = 0, cellsN = 0;
      let mergedParts = 0, mergedCells = 0, conflictParts = 0, conflictCells = 0;
      for (const sh of preview.made) {
        const kind = sh.kind;
        const def = BOARD_DEFAULTS[kind] || BOARD_DEFAULTS.line;
        /* ชีทไลน์ปั๊มที่มีแถว WIP ใช้ชุดแถวอีกชุด — ตัดสินจากสิ่งที่อยู่ในไฟล์จริง ไม่ใช่เดาจากชื่อ */
        const preset = kind === 'line' && sh.rowKeys.includes('wip')
          ? ROW_PRESETS.line_wip
          : (ROW_PRESETS[kind] || ROW_PRESETS.line);
        const boardKey = boardKeyOfSheet(kind, sh.name);
        const startDate = sh.dates?.[0] || null;

        const bRes = await supabaseDR.from('monitor_boards').upsert({
          board_key: boardKey,
          name: sh.name.trim(),
          kind,
          line_name: SHEET_LINE_HINT[sh.name.trim()] || null,
          period_kind: def.period_kind,
          period_count: Math.max(1, Math.min(200, sh.dates?.length || def.period_count)),
          start_date: startDate,
          rows: preset,
          sl_row: def.sl_row,
          sl_includes_seed: def.sl_includes_seed,
          is_active: true,
          updated_by_name: fullName || null,
        }, { onConflict: 'board_key' }).select('id').single();
        if (!checkWrite(bRes, `สร้างบอร์ด ${sh.name}`)) { setBusy(false); return; }
        const boardId = bRes.data?.id;
        if (!boardId) { toast.error(`สร้างบอร์ด ${sh.name} ไม่สำเร็จ — ไม่มีสิทธิ์เขียน`); setBusy(false); return; }
        boardsN++;

        /* พาร์ท — upsert ตาม (board_id, row_key) = MAT + เลขพาร์ท
           🔴 ห้ามใช้ MAT เดี่ยวเป็นคีย์: 300T มี 20059152 สองแถว (คว่ำครีบ/หงายครีบ) Total SL ต่างกัน
           · พาร์ทที่ไม่มีเลข MAT ข้าม (ไม่มีอะไรให้ผูกกับระบบ) */
        const partRowsRaw = sh.parts
          .filter((p) => String(p.mat_no || '').trim())
          .map((p) => ({
            board_id: boardId,
            mat_no: String(p.mat_no).trim(),
            part_no: (p.part_no == null ? null : String(p.part_no).trim() || null),
            row_key: partRowKey(p.mat_no, p.part_no),
            part_name: p.part_name ?? null,
            model: p.model ?? null,
            raw_mat: p.raw_mat ?? null,
            process: p.process ?? null,
            rack: p.rack ?? null,
            lot_qty: p.lot_qty ?? null,
            packing: p.packing ?? null,
            cost: p.cost ?? null,
            ct_sec: p.ct_sec ?? null,
            fc: p.fc ?? null,
            pieces_per_shot: p.pieces_per_shot ?? null,
            kg_per_piece: p.kg_per_piece ?? null,
            spec: p.spec ?? null,
            semi_part: p.semi_part ?? null,
            note: p.mat_after ? `หลังชุบ: ${p.mat_after}` : null,
            is_active: true,
            updated_by_name: fullName || null,
          }));
        /* ไฟล์จริงวางบล็อกซ้ำไว้ (Argen ซ้ำ 2 พาร์ท ค่าเท่ากันทุกช่อง) — ยุบก่อนส่ง
           ไม่ยุบ = PostgreSQL ปฏิเสธทั้งก้อน "cannot affect row a second time" */
        const dPart = dedupeByKey(partRowsRaw, (r) => r.row_key, (a, b) => a.part_name === b.part_name && a.fc === b.fc);
        const partRows = dPart.rows.map((r, i) => ({ ...r, sort_order: i }));
        mergedParts += dPart.merged; conflictParts += dPart.conflict;
        if (partRows.length && !await insertChunked('monitor_board_parts', partRows, `พาร์ทของ ${sh.name}`, 'board_id,row_key')) {
          setBusy(false); return;
        }
        partsN += partRows.length;

        /* ต้องอ่าน id กลับมาเพื่อผูกช่อง (upsert คืนเฉพาะที่เพิ่งเขียน ไม่ครบเมื่อนำเข้าซ้ำ) */
        const { data: saved, error: sErr } = await supabaseDR
          .from('monitor_board_parts').select('id, mat_no, part_no').eq('board_id', boardId).eq('is_active', true);
        if (sErr) { toast.error(`อ่านพาร์ทกลับไม่สำเร็จ: ${sErr.message}`); setBusy(false); return; }
        const idOf = new Map((saved || []).map((r) => [partRowKey(r.mat_no, r.part_no), r.id]));

        const cellRowsRaw = [];
        const seed = sh.dates?.[0] || null;
        for (const p of sh.parts) {
          const pid = idOf.get(partRowKey(p.mat_no, p.part_no));
          if (!pid) continue;
          for (const [rk, byDate] of Object.entries(p.cells || {})) {
            for (const [d, v] of Object.entries(byDate || {})) {
              /* แถวที่คำนวณได้: เก็บเฉพาะช่องยอดยกมา ที่เหลือให้สูตรคิดใหม่ */
              if (RECUR_KEYS.has(rk) && d !== seed) continue;
              if (!Number.isFinite(Number(v))) continue;
              cellRowsRaw.push({ board_part_id: pid, row_key: rk, period_key: d, qty: Number(v), txt: null, updated_by_name: fullName || null });
            }
          }
          for (const [rk, byDate] of Object.entries(p.texts || {})) {
            for (const [d, v] of Object.entries(byDate || {})) {
              cellRowsRaw.push({ board_part_id: pid, row_key: rk, period_key: d, qty: null, txt: String(v), updated_by_name: fullName || null });
            }
          }
        }
        /* บล็อกซ้ำในไฟล์ส่งช่องเดียวกันมา 2 ครั้ง — ยุบ (ค่าล่างชนะ) แล้วนับที่ค่าไม่ตรงกันไว้บอกบนจอ */
        const dCell = dedupeByKey(
          cellRowsRaw,
          (r) => `${r.board_part_id}|${r.row_key}|${r.period_key}`,
          (a, b) => a.qty === b.qty && a.txt === b.txt,
        );
        mergedCells += dCell.merged; conflictCells += dCell.conflict;
        if (dCell.rows.length && !await insertChunked('monitor_cells', dCell.rows, `ข้อมูลของ ${sh.name}`, 'board_part_id,row_key,period_key')) {
          setBusy(false); return;
        }
        cellsN += dCell.rows.length;
      }
      toast.success(`นำเข้าแล้ว — ${boardsN} บอร์ด · ${fmt(partsN)} พาร์ท · ${fmt(cellsN)} ช่อง`
        + (mergedParts || mergedCells ? ` · ยุบของซ้ำในไฟล์ ${fmt(mergedParts)} พาร์ท/${fmt(mergedCells)} ช่อง` : ''));
      /* ซ้ำแล้วค่าไม่ตรงกัน = ไฟล์ขัดกันเอง ต้องให้คนไปดู ห้ามกลืน (ใช้ค่าบล็อกล่าง) */
      if (conflictParts || conflictCells) {
        toast.error(`⚠️ ของซ้ำในไฟล์ที่ค่าไม่ตรงกัน ${fmt(conflictParts)} พาร์ท · ${fmt(conflictCells)} ช่อง`
          + ' — ระบบใช้ค่าของบล็อกล่างสุด ให้ทีมวางแผนตรวจไฟล์');
      }
      onImported?.();
    } catch (e) {
      toast.error(`นำเข้าไม่สำเร็จ: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [preview, fullName, onImported]);

  const tabName = (k) => BOARD_TABS.find((t) => t.key === k)?.label || k;

  return (
    /* 🔴 ไม่ปิดจาก backdrop — ห้ามใส่ onClick={onClose} ที่ชั้นนี้ (UI-CONVENTIONS §5)
       จอนี้นับเป็น "ฟอร์ม" ถึงไม่มีช่องพิมพ์ — เผลอแตะพื้นหลังแล้วต้องเลือกไฟล์+ตรวจสรุปใหม่ทั้งชุด */
    <div className="overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(860px, 96vw)', maxHeight: '92vh', overflowY: 'auto', display: 'grid', gap: 12 }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>📗 นำเข้าไฟล์ Monitoring</div>
            <div style={{ fontSize: FS - 0.5, color: 'var(--muted)', marginTop: 2 }}>
              ไฟล์ <code>1.Monitoring-&lt;เดือน&gt;.xlsx</code> ของทีมวางแผน — แต่ละชีทกลายเป็น 1 บอร์ด ·
              นำเข้าซ้ำ = อัพเดทบอร์ดเดิม ไม่สร้างซ้ำ
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" title="ปิด"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 2 }}>✕</button>
        </div>

        <input ref={fileRef} type="file" accept=".xlsx,.xlsm" disabled={busy}
          onChange={(e) => handleFile(e.target.files?.[0])}
          style={{ fontSize: FS + 1 }} />

        {busy && !preview ? <div style={{ fontSize: FS + 1, color: 'var(--muted)' }}>กำลังอ่านไฟล์…</div> : null}

        {preview ? (
          <>
            <div style={{ fontSize: FS + 1, fontWeight: 700 }}>
              {preview.fileName} — จะยกเข้า {preview.made.length} บอร์ด
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              {preview.made.map((sh) => (
                <div key={sh.name} style={{
                  border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px',
                  background: 'var(--bg2)', fontSize: FS,
                }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <b style={{ fontSize: FS + 1 }}>{sh.name}</b>
                    <span style={{ color: 'var(--muted)' }}>→ {tabName(sh.kind)}</span>
                    {SHEET_LINE_HINT[sh.name.trim()] ? (
                      <span style={{ color: 'var(--accent)' }}>ผูกไลน์ {SHEET_LINE_HINT[sh.name.trim()]}</span>
                    ) : null}
                    <span style={{ marginLeft: 'auto', color: 'var(--text2)' }}>
                      {sh.parts.length} พาร์ท · {sh.dates.length} คอลัมน์ · {fmt(sh.cellCount)} ช่อง
                    </span>
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: FS - 1, marginTop: 2 }}>
                    แถว: {sh.rowKeys.map((k) => ROW_LABEL[k] || k).join(' · ') || '—'}
                  </div>
                  {sh.warnings?.map((w, i) => (
                    <div key={i} style={{ color: 'var(--accent2)', fontSize: FS - 1, marginTop: 2 }}>⚠️ {w}</div>
                  ))}
                </div>
              ))}
            </div>

            {preview.skipped.length ? (
              <div style={{ fontSize: FS, lineHeight: 1.8 }}>
                <b>ชีทที่ไม่ได้ยกเข้า {preview.skipped.length} ชีท</b>
                {preview.skipped.map((s) => (
                  <div key={s.name} style={{ color: s.intentional ? 'var(--muted)' : '#f87171' }}>
                    {s.intentional ? '⏭' : '🔴'} <b>{s.name}</b> — {s.why}
                  </div>
                ))}
                {preview.skipped.some((s) => !s.intentional) ? (
                  <div style={{ color: '#f87171', marginTop: 2 }}>
                    ชีทที่ขึ้น 🔴 คือระบบแกะโครงไม่ได้ ไม่ใช่ของที่ตั้งใจข้าม — ถ้าเป็นชีทที่ต้องใช้ ให้แจ้งไว้
                  </div>
                ) : null}
              </div>
            ) : null}

            <div style={{ fontSize: FS - 0.5, color: 'var(--muted)', lineHeight: 1.8, background: 'var(--bg2)', borderRadius: 6, padding: '7px 10px' }}>
              ℹ️ ช่อง <b>UNBOUND / BALANCE / ค้างที่ร้านชุบ</b> เก็บเฉพาะ “ยอดยกมา” ของคอลัมน์แรก —
              ช่องที่เหลือระบบคำนวณใหม่ทุกครั้งด้วยสูตรเดียวกับในไฟล์ จึงไม่มีทางขัดกันเอง ·
              การนำเข้านี้ <b>ไม่แตะทะเบียนสินค้า คัมบัง หรือออเดอร์ลูกค้า</b> — ยกผิดก็ลบบอร์ดทิ้งได้
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} disabled={busy}
                style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' }}>
                ยกเลิก
              </button>
              <button type="button" onClick={run} disabled={busy || !preview.made.length}
                style={{ fontSize: 13, fontWeight: 700, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' }}>
                {busy ? 'กำลังนำเข้า…' : `✅ ยืนยันนำเข้า ${preview.made.length} บอร์ด`}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
