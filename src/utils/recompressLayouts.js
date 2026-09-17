/* ── recompressLayouts — บีบ "รูปผังที่อัปไว้แล้ว" ให้เล็กลง (งานครั้งเดียว) ────────────────
   (2026-09-17 · งานลด egress — ดู `docs/EGRESS-AUDIT-2026-09-17.md` §4)

   ═══ ทำไมต้องมีเครื่องมือนี้ ═══════════════════════════════════════════════════
   `src/utils/layoutImage.js` แก้ให้รูปผัง**ที่อัปใหม่**เป็น WebP แล้ว — แต่รูปเดิมยังเป็น PNG ก้อนโต
   ของจริง 17/09: `layout_LINE_APRON_ASSY_*.png` = **8.4 MB** (ยังมี 5.3 · 3.0 · 2.5 · 2.4 · 2.3 MB อีก)
   ทุกเครื่องที่ยังไม่เคยเปิดผังนั้นต้องโหลดเต็มก้อน ⇒ **40 เครื่อง × 8.4 MB = 336 MB แค่ผังใบเดียว**
   (cacheControl เป็น 1 ปีอยู่แล้ว — ช่วยเฉพาะ "เครื่องเดิมเปิดซ้ำ" ไม่ช่วย "เครื่องใหม่")

   ทำไมต้องรันจากเบราว์เซอร์ ไม่ใช่ script/Edge Function:
   ตัวบีบภาพใช้ `canvas` ซึ่งมีแต่ในเบราว์เซอร์ · และ session ของ AI ต่อ Supabase Storage ไม่ได้ (proxy)
   ⇒ ทำเป็นปุ่มให้คนที่ดูแลผังกดเองครั้งเดียว

   ═══ กติกาความปลอดภัยของงานนี้ (ห้ามลัด) ═══════════════════════════════════════
   1. **อัปไฟล์ใหม่ → อัปเดต DB ให้สำเร็จก่อน → ค่อยลบไฟล์เก่า** (ลำดับเดียวกับโค้ดอัปโหลดเดิม)
      สลับลำดับเมื่อไหร่ = update พลาดแล้วไฟล์เก่าหายไปแล้ว ⇒ **ผังนั้นเสียถาวร กู้ไม่ได้**
   2. **ผัง 1 รูปอาจถูกใช้หลายไลน์** (ไลน์ลูกยืมของไลน์แม่ / ตั้ง URL เดียวกันไว้) ⇒ จัดกลุ่มตาม URL
      แล้วอัปเดต**ทุกแถวที่ชี้รูปนั้น** ก่อนลบ — ไม่งั้นไลน์อื่นรูปหาย
   3. **บีบแล้วไม่เล็กลงจริง = ไม่ต้องเปลี่ยน** (ปล่อยของเดิมไว้ ดีกว่าเสี่ยงเปล่าๆ)
   4. รูปไหนพัง/โหลดไม่ได้ = ข้ามแล้วรายงาน **ห้ามหยุดทั้งชุด** (ผังใบเดียวเสียไม่ควรบล็อกที่เหลือ)            */
import { compressLayoutImage } from './layoutImage.js';
import { uploadOpts } from './storageUpload.js';

/** เล็กกว่านี้ถือว่าโอเคแล้ว ไม่ต้องแตะ (บีบต่อได้นิดเดียว แต่เสี่ยงเท่าเดิม) */
export const RECOMPRESS_MIN_BYTES = 600 * 1024;

/** ต้องเล็กลงอย่างน้อยเท่านี้ถึงจะยอมสลับไฟล์ */
export const RECOMPRESS_MIN_GAIN = 0.20;   // 20%

/** ชื่อไฟล์ใน bucket จาก public URL (คืน null ถ้า URL ไม่ใช่ของ bucket นั้น) */
export function objectNameFromUrl(url, bucket) {
  const marker = `/${bucket}/`;
  const i = String(url || '').indexOf(marker);
  if (i < 0) return null;
  return decodeURIComponent(String(url).slice(i + marker.length).split('?')[0]);
}

/** จัดกลุ่มแถวตาม url — รูปเดียวอาจถูกหลายไลน์ใช้ร่วมกัน (กฎข้อ 2) */
export function groupByUrl(rows, urlOf) {
  const m = new Map();
  rows.forEach((r) => {
    const u = urlOf(r);
    if (!u) return;
    if (!m.has(u)) m.set(u, []);
    m.get(u).push(r);
  });
  return m;
}

/**
 * บีบรูปผังหนึ่งใบแล้วสลับไฟล์
 * @returns {Promise<{status:'done'|'skip'|'error', before?:number, after?:number, msg?:string}>}
 */
async function recompressOne({ storage, url, newPathOf, saveRows, oldName }) {
  let blob;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { status: 'error', msg: `โหลดรูปไม่ได้ (HTTP ${res.status})` };
    blob = await res.blob();
  } catch (e) { return { status: 'error', msg: 'โหลดรูปไม่ได้: ' + (e?.message || e) }; }

  const before = blob.size;
  if (before < RECOMPRESS_MIN_BYTES) return { status: 'skip', before, msg: 'เล็กอยู่แล้ว' };

  let out;
  try { out = await compressLayoutImage(blob); }
  catch (e) { return { status: 'error', before, msg: 'บีบไม่สำเร็จ: ' + (e?.message || e) }; }

  const after = out.blob.size;
  // กฎข้อ 3 — ไม่เล็กลงพอ ก็อย่าไปยุ่งกับของเดิม
  if (after > before * (1 - RECOMPRESS_MIN_GAIN)) return { status: 'skip', before, after, msg: 'บีบแล้วไม่เล็กลงพอ' };

  const newPath = newPathOf(out.ext);
  const up = await storage.upload(newPath, out.blob, uploadOpts());
  if (up.error) return { status: 'error', before, after, msg: 'อัปโหลดไม่สำเร็จ: ' + up.error.message };

  // กฎข้อ 1 — DB ต้องสำเร็จก่อน ถ้าพลาดให้เก็บกวาดไฟล์ใหม่ทิ้ง แล้วคงของเดิมไว้ครบ
  const saved = await saveRows(newPath);
  if (saved?.error) {
    await storage.remove([newPath]).catch(() => {});
    return { status: 'error', before, after, msg: 'อัปเดตฐานข้อมูลไม่สำเร็จ: ' + saved.error.message };
  }

  if (oldName && oldName !== newPath) await storage.remove([oldName]).catch(() => {});
  return { status: 'done', before, after };
}

/**
 * ไล่บีบรูปผังทั้งหมด (ผังไลน์ · ผังโรงงาน · ผังเครื่องจักร)
 * @param {object}   o
 * @param {object}   o.supabase   client ฝั่ง Main
 * @param {object}   o.supabaseDR client ฝั่ง DR
 * @param {function} o.onProgress (text, doneCount, total) — อัปเดตข้อความบนจอ
 * @returns {Promise<{done:number, skip:number, error:number, savedBytes:number, errors:string[]}>}
 */
export async function recompressLayouts({ supabase, supabaseDR, onProgress = () => {} }) {
  const sum = { done: 0, skip: 0, error: 0, savedBytes: 0, errors: [] };
  const jobs = [];

  /* 1) ผังไลน์ — Main · bucket employee-photos · layouts/ */
  const { data: layoutRows } = await supabase.from('line_layouts').select('line_name, image_url');
  const mainStore = supabase.storage.from('employee-photos');
  groupByUrl(layoutRows || [], r => r.image_url).forEach((rows, url) => {
    const oldName = objectNameFromUrl(url, 'employee-photos');
    if (!oldName || !oldName.startsWith('layouts/')) return;   // URL นอก bucket เรา = ไม่แตะ
    jobs.push({
      label: `ผังไลน์ ${rows.map(r => r.line_name).join(', ')}`,
      url, oldName, storage: mainStore,
      newPathOf: ext => `layouts/${oldName.replace(/^layouts\//, '').replace(/\.[^.]+$/, '')}_c.${ext}`,
      saveRows: async (newPath) => {
        const { data: pub } = mainStore.getPublicUrl(newPath);
        // อัปเดต **ทุกไลน์ที่ใช้รูปนี้ร่วมกัน** (กฎข้อ 2) ด้วยการชี้จาก url เดิม
        return supabase.from('line_layouts').update({ image_url: pub.publicUrl }).eq('image_url', url);
      },
    });
  });

  /* 2) ผังโรงงาน — Main · factory/ */
  const { data: mapRows } = await supabase.from('factory_map').select('id, image_url');
  groupByUrl(mapRows || [], r => r.image_url).forEach((rows, url) => {
    const oldName = objectNameFromUrl(url, 'employee-photos');
    if (!oldName || !oldName.startsWith('factory/')) return;
    jobs.push({
      label: 'ผังโรงงาน',
      url, oldName, storage: mainStore,
      newPathOf: ext => `factory/${oldName.replace(/^factory\//, '').replace(/\.[^.]+$/, '')}_c.${ext}`,
      saveRows: async (newPath) => {
        const { data: pub } = mainStore.getPublicUrl(newPath);
        return supabase.from('factory_map').update({ image_url: pub.publicUrl }).in('id', rows.map(r => r.id));
      },
    });
  });

  /* 3) ผังเครื่องจักร — DR · bucket jig-images · เก็บเป็น path ไม่ใช่ URL */
  const drStore = supabaseDR.storage.from('jig-images');
  const { data: areaRows } = await supabaseDR.from('pm_facility_areas').select('id, image_path');
  (areaRows || []).filter(a => a.image_path).forEach((a) => {
    const { data: pub } = drStore.getPublicUrl(a.image_path);
    jobs.push({
      label: `ผังเครื่องจักรโซน ${a.id}`,
      url: pub.publicUrl, oldName: a.image_path, storage: drStore,
      newPathOf: ext => `facility/${a.id}.${ext}`,
      saveRows: async (newPath) => supabaseDR.from('pm_facility_areas').update({ image_path: newPath }).eq('id', a.id),
    });
  });

  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    onProgress(`กำลังบีบ: ${j.label}`, i, jobs.length);
    const r = await recompressOne(j);
    if (r.status === 'done') { sum.done++; sum.savedBytes += (r.before - r.after); }
    else if (r.status === 'skip') sum.skip++;
    else { sum.error++; sum.errors.push(`${j.label} — ${r.msg}`); }
  }
  onProgress('เสร็จแล้ว', jobs.length, jobs.length);
  return sum;
}

export default recompressLayouts;
