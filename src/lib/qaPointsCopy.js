import { supabase } from '../supabaseClient';
import { QA_BUCKET, qaFileUrl, qaPathOfUrl } from './qaImages';
import { qaItemCopyRow, qaCopyPath } from '../utils/qaPointCopy';

/* ── 📋 คัดลอกจุดตรวจ QA ไป "พาร์ทอื่น" ทีละหลายพาร์ท (2026-10-19) ─────────────────────
   หลักเดียวกับ PM `copyChecklistToEquipment()` (`lib/pmChecklists.js`) — user เรียนครั้งเดียวใช้ได้ทั้งคู่
   ใช้จริง: สาย 060/061 (RH/LH) สเปคเหมือนกันทั้งชุด ต่างแค่แบบ ⇒ ตั้ง 1 ตัวแล้วคัดลอก ไม่ต้องพิมพ์ 130 จุดซ้ำ

   🔴 ผลลัพธ์เป็น **รายพาร์ท** — ตัวเรียกต้องโชว์ว่าตัวไหนสำเร็จ/ข้ามเพราะอะไร ห้ามสรุปก้อนเดียว
   🔴 ปลายทางที่ "มีจุดตรวจอยู่แล้ว" = ข้ามเสมอ ไม่ทับ (ไม่มีโหมด replace — แก้ที่โมดัลของพาร์ทนั้นแทน)
   🔴 นับไม่สำเร็จ = "ไม่รู้" ห้าม `?? 0` (จะ insert ทับเป็นจุดตรวจซ้ำสองชุดเงียบๆ)
   🔴 ไฟล์ (แผ่นแบบ/รูปโคลสอัพ) **คัดลอกเข้าโฟลเดอร์ของพาร์ทปลายทาง ห้ามแชร์ path** — เหตุผลอยู่ `utils/qaPointCopy.js`
   🔴 ล้มกลางทาง = เก็บกวาดของที่เพิ่งสร้าง: ลบแถวแผ่นแบบ → **นับแถวครบ** → ค่อยลบไฟล์ (กฎเหล็ก DB ข้อ 2)
   · `withDrawings` = คัดลอกแผ่นแบบไปด้วย **เฉพาะปลายทางที่ยังไม่มีแผ่นเลย** (หมุดอยู่ตำแหน่งเดิม)
     ปลายทางมีแบบของตัวเองแล้ว = ไม่แตะแบบ · ล้างหมุดให้ปักใหม่
   · ด่านขอบเขตไลน์ (`canWriteLine`) อยู่ที่ตัวเรียก — ส่งมาเฉพาะพาร์ทที่แก้ได้ */

const bucket = () => supabase.storage.from(QA_BUCKET);

async function countOf(table, partId) {
  const r = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('part_id', partId);
  if (r.error || r.count == null) throw new Error(`นับ ${table} ของปลายทางไม่สำเร็จ — ยังคัดลอกไม่ได้ ${r.error?.message || ''}`);
  return r.count;
}

async function copyFile(from, to, made) {
  const { error } = await bucket().copy(from, to);
  if (error) throw new Error(`คัดลอกไฟล์ไม่สำเร็จ (${from.split('/').pop()}): ${error.message}`);
  made.push(to);
}

async function copyIntoPart(src, targetPartId, { withDrawings }) {
  if ((await countOf('qa_inspection_items', targetPartId)) > 0) return { copied: false, reason: 'target_has_points' };
  const takeDrawings = withDrawings && src.drawings.length > 0 && (await countOf('qa_part_drawings', targetPartId)) === 0;

  const tag = Date.now().toString(36);
  const madeFiles = [];
  const madeDwgs = [];
  try {
    let drawingMap = null;
    if (takeDrawings) {
      drawingMap = {};
      for (const d of src.drawings) {
        const p = qaPathOfUrl(d.drawing_url);
        let url = d.drawing_url;               // URL นอก bucket (ไม่ใช่ไฟล์ของเรา) = อ้างตัวเดิม
        if (p) { const to = qaCopyPath(p, targetPartId, tag); await copyFile(p, to, madeFiles); url = qaFileUrl(to); }
        const { data, error } = await supabase.from('qa_part_drawings')
          .insert({ part_id: targetPartId, title: d.title, drawing_url: url, drawing_rev: d.drawing_rev, sort: d.sort })
          .select('id').single();
        if (error) throw new Error(`เพิ่มแผ่นแบบไม่สำเร็จ: ${error.message}`);
        madeDwgs.push(data.id);
        drawingMap[d.id] = data.id;
      }
    }
    const imgMap = {};
    for (const it of src.items) {
      if (!it.image_path || imgMap[it.image_path]) continue;
      const to = qaCopyPath(it.image_path, targetPartId, tag);
      await copyFile(it.image_path, to, madeFiles);
      imgMap[it.image_path] = to;
    }
    const rows = src.items.map(it => qaItemCopyRow(it, { targetPartId, drawingMap, imagePath: imgMap[it.image_path] }));
    const { error } = await supabase.from('qa_inspection_items').insert(rows);
    if (error) throw new Error(`เพิ่มจุดตรวจไม่สำเร็จ: ${error.message}`);
    if (madeDwgs.length) {
      const st = await supabase.from('qa_parts').update({ drawing_updated_at: new Date().toISOString() }).eq('id', targetPartId);
      if (st.error) console.warn('[qaPointsCopy] ประทับเวลาแก้ drawing ไม่สำเร็จ', targetPartId, st.error.message);
    }
    return { copied: true, count: rows.length, drawings: madeDwgs.length, pinsKept: !!drawingMap };
  } catch (e) {
    await rollback(madeDwgs, madeFiles);
    throw e;
  }
}

/* เก็บกวาดของที่เพิ่งสร้างในรอบที่ล้ม — best-effort แต่ห้ามเงียบ (error ตัวจริงถูก rethrow ที่ตัวเรียก)
   ไฟล์ลบได้เฉพาะเมื่อแถวแผ่นแบบที่ชี้มันหายครบแล้ว · จุดตรวจ insert ทีเดียวทั้งก้อน ล้ม = ไม่มีแถวชี้รูปโคลสอัพ */
async function rollback(madeDwgs, madeFiles) {
  let rowsGone = true;
  if (madeDwgs.length) {
    const del = await supabase.from('qa_part_drawings').delete().in('id', madeDwgs).select('id');
    rowsGone = !del.error && (del.data || []).length === madeDwgs.length;
    if (!rowsGone) console.warn('[qaPointsCopy] ล้มแล้วลบแผ่นแบบที่เพิ่งเพิ่มคืนไม่ครบ — คงไฟล์ไว้', madeDwgs, del.error?.message);
  }
  if (rowsGone && madeFiles.length) {
    const rm = await bucket().remove(madeFiles);
    if (rm.error) console.warn('[qaPointsCopy] ล้มแล้วลบไฟล์ที่เพิ่งคัดลอกไม่สำเร็จ — เหลือไฟล์กำพร้า', madeFiles, rm.error.message);
  }
}

export async function copyQaPointsToParts(srcPartId, targetPartIds, { withDrawings = false } = {}) {
  const ids = [...new Set((targetPartIds || []).filter(Boolean))];
  if (!ids.length) return { results: [] };
  const [rI, rD] = await Promise.all([
    supabase.from('qa_inspection_items').select('*').eq('part_id', srcPartId),
    supabase.from('qa_part_drawings').select('id, title, drawing_url, drawing_rev, sort').eq('part_id', srcPartId).order('sort').order('created_at'),
  ]);
  if (rI.error) throw rI.error;
  if (rD.error) throw rD.error;
  const src = { items: rI.data || [], drawings: rD.data || [] };
  if (!src.items.length) return { results: ids.map(partId => ({ partId, copied: false, reason: 'empty' })) };

  const results = [];
  for (const partId of ids) {
    if (partId === srcPartId) { results.push({ partId, copied: false, reason: 'same' }); continue; }
    try {
      results.push({ partId, ...(await copyIntoPart(src, partId, { withDrawings })) });
    } catch (e) {
      // พาร์ทเดียวล้ม ต้องไม่ทำให้ทั้งชุดหยุด — เก็บเหตุผลไว้รายงาน
      results.push({ partId, copied: false, reason: 'error', message: e?.message || String(e) });
    }
  }
  return { results };
}
