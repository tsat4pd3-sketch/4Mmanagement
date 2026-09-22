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
   4. รูปไหนพัง/โหลดไม่ได้ = ข้ามแล้วรายงาน **ห้ามหยุดทั้งชุด** (ผังใบเดียวเสียไม่ควรบล็อกที่เหลือ)
   5. **ห้ามใส่งานที่ "ข้ามถาวร" เข้าคิว และห้ามกลับไปแบ่งล็อตแบบมีตัวกันวน `done === 0`** (2026-09-22)
      เคยพังจริง: ไฟล์ที่เป็น .webp แล้ว / เล็กกว่าเกณฑ์อยู่แล้ว ถูกใส่คิวไว้หน้าสุด**ทุกรอบ**
      (มันไม่เคยเปลี่ยนสภาพ จึงไม่เคยหลุดออกจากลิสต์) ⇒ ล็อตแรก 150 ใบเป็น skip ทั้งก้อน
      ⇒ `done === 0` ⇒ ตัวกันวนเข้าใจผิดว่า "ติดปัญหา" แล้วหยุด ⇒ **งานท้ายคิวไม่เคยถูกแตะเลย**
      (รูปซ่อม MO 85 MB = ก้อนใหญ่สุดที่เหลือ · user กด 3 ครั้งขนาดรวมไม่ลดเลย)
      ⇒ กรอง .webp ออกตอน**สร้างคิว** · ถามขนาดด้วย HEAD ก่อนโหลด · ผู้เรียกส่ง `limit: 0` รอบเดียวจบ            */
import { compressLayoutImage, compressPhotoImage } from './layoutImage.js';
import { uploadOpts } from './storageUpload.js';

/** รูปผัง: เล็กกว่านี้ถือว่าโอเคแล้ว ไม่ต้องแตะ (บีบต่อได้นิดเดียว แต่เสี่ยงเท่าเดิม) */
export const RECOMPRESS_MIN_BYTES = 600 * 1024;

/** รูปจุดตรวจ PM: ไฟล์เล็กกว่ารูปผังมาก (เฉลี่ย ~100 KB) แต่มีเป็นพัน ⇒ เกณฑ์ต่ำกว่า */
export const PHOTO_MIN_BYTES = 40 * 1024;

/** เพดานเริ่มต้นต่อการเรียก 1 ครั้ง — **จอจริงส่ง `limit: 0` (รอบเดียวจบ)** ดูกฎข้อ 5 หัวไฟล์
 *  ค่านี้เหลือไว้เป็น default กันเผลอเรียกแบบไม่จำกัดจากที่อื่น ไม่ใช่วิธีใช้งานปกติ */
export const RECOMPRESS_BATCH = 150;

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
async function recompressOne({ storage, url, newPathOf, saveRows, oldName, minBytes = RECOMPRESS_MIN_BYTES, compress = compressLayoutImage }) {
  // ไฟล์ที่เป็น webp อยู่แล้ว = เคยผ่านตัวนี้มาแล้ว ⇒ ข้ามโดยไม่ต้องโหลดลงมาเสียเปล่า
  // (ทำให้กดซ้ำได้เรื่อยๆ ปลอดภัย — สำคัญมากเพราะรูป PM มีเป็นพันไฟล์ ต้องทำหลายรอบ)
  if (/\.webp$/i.test(String(oldName || ''))) return { status: 'skip', msg: 'เป็น WebP แล้ว' };

  /* 🔴 ถามขนาดด้วย HEAD ก่อนโหลดตัวไฟล์ (2026-09-22)
     เดิมโหลดไฟล์เต็มก้อนมาก่อนแล้วเพิ่งเช็ค `before < minBytes` ⇒ ไฟล์ที่ "เล็กอยู่แล้ว"
     ถูกดาวน์โหลดทิ้งทุกครั้งที่กดปุ่ม · วัดจริง: รูป PM 198 ใบที่ต่ำกว่าเกณฑ์ (เฉลี่ย 33-44 KB)
     = **เสีย egress ~9 MB ต่อการกด 1 ครั้ง เพื่อจะรู้ว่าไม่ต้องทำอะไร**
     HEAD คืนแค่หัว (ไม่มี body) ⇒ ~ไม่กี่ร้อยไบต์ · ถ้า HEAD ใช้ไม่ได้/ไม่บอกขนาด ก็ถอยไปโหลดจริง */
  try {
    const h = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const len = Number(h.headers.get('content-length'));
    if (h.ok && Number.isFinite(len) && len > 0 && len < minBytes) {
      return { status: 'skip', before: len, msg: 'เล็กอยู่แล้ว' };
    }
  } catch { /* HEAD ไม่ผ่าน = ไม่ใช่เหตุให้ล้มงาน ไปโหลดจริงต่อ */ }

  let blob;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { status: 'error', msg: `โหลดรูปไม่ได้ (HTTP ${res.status})` };
    blob = await res.blob();
  } catch (e) { return { status: 'error', msg: 'โหลดรูปไม่ได้: ' + (e?.message || e) }; }

  const before = blob.size;
  if (before < minBytes) return { status: 'skip', before, msg: 'เล็กอยู่แล้ว' };

  let out;
  try { out = await compress(blob); }
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
 * @param {number}   [o.limit]  ทำแค่กี่ไฟล์ต่อรอบ (0 = ไม่จำกัด) — ที่เหลือคืนใน `remaining`
 * @param {boolean}  [o.scanOnly] สำรวจว่าเหลือกี่ใบ **ไม่โหลด/ไม่แก้รูปเลย** → คืน `{scan:true,total,byGroup}`
 * @returns {Promise<{done:number, skip:number, error:number, savedBytes:number, remaining:number, errors:string[], scan?:boolean, byGroup?:object}>}
 */
export async function recompressLayouts({ supabase, supabaseDR, onProgress = () => {}, limit = RECOMPRESS_BATCH, scanOnly = false }) {
  const sum = { done: 0, skip: 0, error: 0, savedBytes: 0, remaining: 0, errors: [] };
  const jobs = [];

  /* 1) ผังไลน์ — Main · bucket employee-photos · layouts/ */
  const { data: layoutRows } = await supabase.from('line_layouts').select('line_name, image_url');
  const mainStore = supabase.storage.from('employee-photos');
  groupByUrl(layoutRows || [], r => r.image_url).forEach((rows, url) => {
    const oldName = objectNameFromUrl(url, 'employee-photos');
    if (!oldName || !oldName.startsWith('layouts/')) return;   // URL นอก bucket เรา = ไม่แตะ
    if (/\.webp$/i.test(oldName)) return;                     // ทำแล้ว — ไม่ต้องนับเข้าคิว (ให้เลข "เหลือ" ตรงความจริง)
    jobs.push({
      group: 'ผังไลน์', label: `ผังไลน์ ${rows.map(r => r.line_name).join(', ')}`,
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
    if (/\.webp$/i.test(oldName)) return;
    jobs.push({
      group: 'ผังโรงงาน', label: 'ผังโรงงาน',
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
      group: 'ผังเครื่องจักร', label: `ผังเครื่องจักรโซน ${a.id}`,
      url: pub.publicUrl, oldName: a.image_path, storage: drStore,
      newPathOf: ext => `facility/${a.id}.${ext}`,
      saveRows: async (newPath) => supabaseDR.from('pm_facility_areas').update({ image_path: newPath }).eq('id', a.id),
    });
  });

  /* 4) รูปอ้างอิงจุดตรวจ PM + เฟรมหมุน — DR · bucket jig-images · jigs/
        **ก้อนใหญ่สุดฝั่ง Storage ของ DR: 90.1 MB/วัน** (1,014 ไฟล์ = 102 MB)
        ⚠️ path เดียวถูกอ้างจาก **3 ตาราง** (jig_images · jigs · jig_checkpoints) ⇒ ต้องอัปเดตครบทั้ง 3
           ก่อนลบไฟล์เก่า ไม่งั้นรูปหายจากจอใดจอหนึ่งแบบไม่รู้ตัว */
  const [jiRes, jgRes, cpRes] = await Promise.all([
    supabaseDR.from('jig_images').select('image_path').not('image_path', 'is', null),
    supabaseDR.from('jigs').select('image_path').not('image_path', 'is', null),
    supabaseDR.from('jig_checkpoints').select('image_path').not('image_path', 'is', null),
  ]);
  const photoPaths = [...new Set([...(jiRes.data || []), ...(jgRes.data || []), ...(cpRes.data || [])]
    .map(r => r.image_path).filter(p => p && p.startsWith('jigs/') && !/\.webp$/i.test(p)))];
  photoPaths.forEach((p) => {
    const { data: pub } = drStore.getPublicUrl(p);
    jobs.push({
      group: 'รูปจุดตรวจ PM', label: `รูป PM ${p.split('/').pop()}`,
      url: pub.publicUrl, oldName: p, storage: drStore,
      minBytes: PHOTO_MIN_BYTES, compress: compressPhotoImage,
      newPathOf: ext => `${p.replace(/\.[^./]+$/, '')}.${ext}`,
      saveRows: async (newPath) => {
        // อัปเดตทั้ง 3 ตารางที่อาจชี้ path นี้ — ตัวไหนล้มถือว่าล้มทั้งงาน (ผู้เรียกจะลบไฟล์ใหม่ทิ้ง)
        for (const t of ['jig_images', 'jigs', 'jig_checkpoints']) {
          const r = await supabaseDR.from(t).update({ image_path: newPath }).eq('image_path', p);
          if (r.error) return r;
        }
        return { error: null };
      },
    });
  });

  /* 5) รูปซ่อม (ก่อน/หลัง/QA) — DR · bucket mtn-images · 39 MB/วัน
        ⚠️ ต่างจากกลุ่มอื่น: `mtn_orders` เก็บเป็น **URL เต็ม** ไม่ใช่ path ⇒ ต้องแปลงกลับ
           และเขียนกลับเป็น URL เต็มเช่นกัน · ห้ามแตะโฟลเดอร์ `sign/` (ลายเซ็น PNG โปร่ง ไฟล์เล็ก) */
  const mtnStore = supabaseDR.storage.from('mtn-images');
  const IMG_COLS = ['before_img', 'after_img', 'qa_img'];
  const { data: moRows } = await supabaseDR.from('mtn_orders')
    .select('id, before_img, after_img, qa_img').limit(2000);
  (moRows || []).forEach((o) => {
    IMG_COLS.forEach((col) => {
      const url = o[col];
      const oldName = objectNameFromUrl(url, 'mtn-images');
      if (!oldName || oldName.startsWith('sign/') || /\.webp$/i.test(oldName)) return;
      jobs.push({
        group: 'รูปซ่อม MO', label: `รูปซ่อม ${col} · ${oldName.split('/').pop()}`,
        url, oldName, storage: mtnStore,
        minBytes: PHOTO_MIN_BYTES, compress: compressPhotoImage,
        newPathOf: ext => `${oldName.replace(/\.[^./]+$/, '')}.${ext}`,
        saveRows: async (newPath) => {
          const { data: pub } = mtnStore.getPublicUrl(newPath);
          return supabaseDR.from('mtn_orders').update({ [col]: pub.publicUrl }).eq('id', o.id);
        },
      });
    });
  });

  /* 6) รูปพนักงาน — Main · bucket employee-photos · ไฟล์อยู่ราก (ไม่มี `/` ในชื่อ)
        **ก้อนใหญ่สุดที่เหลือฝั่ง Main: 54.9 MB/วัน** (วัดจริง 21/09 — 1,391 ครั้ง × 40 KB)
        ของในถัง: jpg 231 ไฟล์ (เฉลี่ย 66 KB) · **png 44 ไฟล์ (เฉลี่ย 628 KB)** ⇒ png คือหางยาวที่แพง
        ⚠️ `layouts/` และ `factory/` อยู่ถังเดียวกันแต่เป็นงานกลุ่ม 1-2 แล้ว ⇒ ที่นี่รับเฉพาะไฟล์ราก */
  const { data: empRows } = await supabase.from('employees')
    .select('id, name, image_url').not('image_url', 'is', null);
  groupByUrl(empRows || [], r => r.image_url).forEach((rows, url) => {
    const oldName = objectNameFromUrl(url, 'employee-photos');
    if (!oldName || oldName.includes('/')) return;          // ผัง/ผังโรงงาน = คนละงาน
    if (/\.gif$/i.test(oldName)) return;                    // GIF บีบไม่ได้ (คงการเคลื่อนไหว)
    jobs.push({
      group: 'รูปพนักงาน', label: `รูปพนักงาน ${rows[0]?.name || oldName}`,
      url, oldName, storage: mainStore,
      minBytes: PHOTO_MIN_BYTES, compress: compressPhotoImage,
      newPathOf: ext => `${oldName.replace(/\.[^.]+$/, '')}.${ext}`,
      saveRows: async (newPath) => {
        const { data: pub } = mainStore.getPublicUrl(newPath);
        // อัปเดตทุกคนที่ใช้รูปนี้ร่วมกัน (กฎข้อ 2) — ชี้จาก url เดิม
        return supabase.from('employees').update({ image_url: pub.publicUrl }).eq('image_url', url);
      },
    });
  });

  const total = jobs.length;

  /* 🔍 โหมดสำรวจ — ตอบว่า "ยังเหลือให้บีบกี่ใบ แยกตามกลุ่ม" **โดยไม่โหลดรูปแม้ใบเดียว**
     (อ่านแค่แถวใน DB ซึ่งอ่านอยู่แล้วข้างบน ⇒ ไม่มีค่า egress ของรูปเลย)
     มีไว้เพื่อให้จอบอกได้ว่า "กดแล้วได้อะไร" — เดิมกดแล้วต้องรอจนจบถึงจะรู้ว่าไม่มีอะไรเหลือ
     ⚠️ ตัวเลขนี้คือ "จำนวนใบที่เข้าเกณฑ์จะถูกหยิบ" ไม่ใช่ "จำนวนใบที่จะถูกเปลี่ยนจริง" —
        ใบที่โหลดมาแล้วเล็กอยู่แล้ว/บีบไม่ลง จะถูกนับเป็น skip ตอนรันจริง */
  if (scanOnly) {
    const byGroup = {};
    jobs.forEach(j => { byGroup[j.group || 'อื่นๆ'] = (byGroup[j.group || 'อื่นๆ'] || 0) + 1; });
    return { ...sum, scan: true, total, byGroup };
  }

  const batch = limit > 0 ? jobs.slice(0, limit) : jobs;
  for (let i = 0; i < batch.length; i++) {
    const j = batch[i];
    onProgress(`กำลังบีบ: ${j.label}`, i, batch.length);
    const r = await recompressOne(j);
    if (r.status === 'done') { sum.done++; sum.savedBytes += (r.before - r.after); }
    else if (r.status === 'skip') sum.skip++;
    else { sum.error++; sum.errors.push(`${j.label} — ${r.msg}`); }
  }
  sum.remaining = Math.max(0, total - batch.length);
  onProgress('เสร็จแล้ว', batch.length, batch.length);
  return sum;
}

export default recompressLayouts;
