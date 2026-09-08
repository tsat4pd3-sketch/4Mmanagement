/* 📷 HEIC/HEIF → JPEG — ให้รูปจากกล้องมือถือยุคใหม่ใช้งานได้โดยไม่ต้องไปตั้งค่ากล้อง
   (single source of truth — ทั้ง resizeImage.js และ ImageCropModal เรียกตัวนี้ ห้ามเขียนซ้ำ)

   ⚠️ เคสจริงที่ทำให้ต้องมีไฟล์นี้ (feedback หน้างาน 2026-08-25):
     หัวหน้าส่วนใช้ Samsung ที่ตั้งกล้องเป็น "รูปภาพประสิทธิภาพสูง (HEIF)" → แนบรูปใบซ่อมไม่ได้
     แล้ว **ลดความละเอียดกล้องต่ำสุดก็ไม่หาย** เพราะปัญหาคือฟอร์แมตที่ Chrome decode ไม่ได้
     ไม่ใช่ขนาดไฟล์ · รอบแรกแก้แค่ "ข้อความ error ให้ไปปิด HEIF" ซึ่งเป็นการแก้ที่ *อาการ*
     — พนักงานเปลี่ยนเครื่อง/คนใหม่เข้ามา ปัญหาก็กลับมาอีก จึงต้องให้ระบบแปลงเองได้

   หลักการ (ตามลำดับ — ห้ามสลับ):
     1. ไม่ใช่ HEIC → คืนไฟล์เดิม ไม่แตะอะไรเลย (ทางเดินปกติต้องไม่เปลี่ยนพฤติกรรม)
     2. เบราว์เซอร์ decode เองได้ (Safari/iOS ทำได้) → คืนไฟล์เดิม **ไม่ต้องโหลด wasm 1.3MB**
     3. decode เองไม่ได้ (Chrome/Android) → lazy import `heic2any` แล้วแปลงเป็น JPEG
     4. แปลงไม่สำเร็จ → โยน error ที่บอก "ทำยังไงต่อ" (ไปปิด HEIF ที่กล้อง) — ห้ามเงียบ

   ⚠️ `heic2any` ต้อง **dynamic import เท่านั้น** (ไฟล์เดียว ~1.3MB) — import แบบ static
      จะไปฝังใน bundle หลักทุกหน้า ทั้งที่คนส่วนใหญ่ไม่เคยส่ง HEIC
      (กฎเดียวกับ pptxgenjs / xlsx / exceljs)

   ⚠️⚠️ กับดัก worker ของ heic2any@0.0.4 (feedback หน้างาน 2026-09-08 — Samsung/Android ทั้ง PWA และ Chrome:
        "รูปแรกลงได้ ลงไปหลายรูปแล้วลงไม่ได้อีกเลย แม้รูปเดิม จนกว่าจะรีเฟรช")
      อ่านจากซอร์สใน node_modules (dist/heic2any.js):
        · `window.__heic2any__worker = new Worker(blobURL)` ถูกสร้าง **ตอน evaluate โมดูล** ตัวเดียวทั้งหน้า
          ไม่มี terminate · ไม่มี `onerror` · ไม่เคยสร้างใหม่
        · ทุกการแปลง = `postMessage` + `addEventListener('message')` **เพิ่ม listener ใหม่ทุกครั้ง ไม่เคยถอด**
        · เมื่อ worker ตาย (หน่วยความจำหมดบนมือถือหลังแปลงหลายรูป) `postMessage` **ไม่ throw**
          และไม่มีข้อความตอบกลับ → promise ของ heic2any **ค้างตลอดกาล** → ปุ่มบันทึกหมุนไม่หยุด
          state `converting` ค้าง และทุกรูปหลังจากนั้นค้างเหมือนกัน (แม้รูปที่เคยลงได้)
      สิ่งที่ทำในไฟล์นี้:
        (a) แข่งเวลา — เกิน `HEIC_TIMEOUT_MS` = โยน `HEIC_STUCK_MSG` (บอกให้รีเฟรช/ปิดแอปเปิดใหม่)
        (b) `poisoned` flag ระดับโมดูล — พอ timeout/worker error ครั้งเดียว ทุกครั้งถัดไปโยนทันทีด้วยข้อความเดียวกัน
            แทนที่จะให้ผู้ใช้รอ 45 วิ ซ้ำๆ · **สร้าง worker ใหม่ในหน้าไม่ได้**: ซอร์ส worker (`workerString`)
            ถูกปิดอยู่ใน closure ของโมดูล ไม่ export · blob URL ที่ใช้สร้างไม่ได้เก็บไว้ · และ ES module ถูก cache
            ตอน import ครั้งแรก (dynamic import ซ้ำได้ instance เดิม ไม่ evaluate ใหม่) — ทางเดียวที่ได้ worker ใหม่
            คือโหลดหน้าใหม่ จึงต้องบอกผู้ใช้ตรงๆ
        (c) แปลงทีละไฟล์ผ่าน promise chain — worker ตัวเดียว decode 2 รูปซ้อนกัน = peak memory ×2
        (d) ไฟล์ที่ MIME บอกชัดว่า HEIC → **ข้ามการ probe ด้วย createImageBitmap ทั้งไฟล์**
            (probe = decode รูปเต็มอีกรอบ กินหน่วยความจำเท่ารูปจริง ก่อนจะไปให้ worker กินอีกรอบ)
            คง probe ไว้เฉพาะเคส MIME ว่าง/octet-stream ที่รู้แค่จากนามสกุล (ยังต้องรู้ว่า Safari อ่านเองได้ไหม)
*/

/** ข้อความเมื่อแปลงไม่ผ่าน — ชี้ที่ "ฟอร์แมต + วิธีตั้งกล้อง" ห้ามพูดเรื่องขนาดไฟล์ (ดู IMG_READ_ERROR) */
export const HEIC_FAIL_MSG =
  'แปลงรูปจากกล้อง (HEIC/HEIF) ไม่สำเร็จ — วิธีแก้: ตั้งกล้องให้ถ่ายเป็น JPEG · ' +
  'Samsung: ตั้งค่ากล้อง → รูปแบบภาพ → ปิด "รูปภาพประสิทธิภาพสูง (HEIF)" · ' +
  'iPhone: ตั้งค่า → กล้อง → รูปแบบ → เลือก "เข้ากันได้มากที่สุด" แล้วถ่ายใหม่';

/** ข้อความเมื่อตัวแปลงค้าง/ตาย (timeout หรือ worker error) — ทางแก้เดียวคือโหลดหน้าใหม่
    ⚠️ ห้ามพูดเรื่อง "ไฟล์ใหญ่เกิน" (ดูคอมเมนต์ใน resizeImage.js) */
export const HEIC_STUCK_MSG =
  'ตัวแปลงรูปจากกล้อง (HEIC/HEIF) ไม่ตอบสนอง — กรุณารีเฟรชหน้านี้ หรือปิดแอปแล้วเปิดใหม่ แล้วลองแนบรูปอีกครั้ง · ' +
  'ถ้าเกิดซ้ำบ่อย ตั้งกล้องให้ถ่ายเป็น JPEG (Samsung: ตั้งค่ากล้อง → รูปแบบภาพ → ปิด HEIF)';

/** เพดานเวลาแปลง 1 รูป — รูป 12MP บนมือถือกลางๆ ใช้ ~5-15 วิ · 45 วิ = ค้างแน่ ไม่ใช่ช้า */
export const HEIC_TIMEOUT_MS = 45_000;

const HEIC_MIME = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
const HEIC_EXT = /\.(heic|heif)$/i;

/**
 * ไฟล์นี้เป็น HEIC/HEIF ไหม
 * ⚠️ ดูนามสกุลด้วยเสมอ — Android/Chrome หลายรุ่นส่ง `type` มาเป็นค่าว่างหรือ
 *    `application/octet-stream` กับไฟล์ .heic (เช็คแต่ MIME จะหลุด แล้วไปพังที่ decoder แทน)
 */
export function isHeicFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase().trim();
  if (HEIC_MIME.has(type)) return true;
  // MIME บอกชัดว่าเป็นรูปชนิดอื่น (jpeg/png/gif/webp) = เชื่อ MIME ไม่ต้องดูนามสกุล
  if (type.startsWith('image/')) return false;
  return HEIC_EXT.test(String(file.name || ''));
}

/** MIME ยืนยันแล้วว่าเป็น HEIC (ไม่ใช่รู้จากนามสกุลอย่างเดียว) → ไม่ต้องเสียหน่วยความจำ probe */
function isHeicByMime(file) {
  return HEIC_MIME.has(String(file?.type || '').toLowerCase().trim());
}

/** เบราว์เซอร์กลุ่มที่ decode HEIC ได้เอง (Safari/WebKit) — ใช้ตัดสินว่าคุ้มจะ probe ไหม
    ตอบ true = ยัง probe (อาจไม่ต้องโหลด wasm) · false (Chrome/Android/Firefox) = ข้าม probe ไปแปลงเลย */
function browserDecodesHeic() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Android/.test(ua);
}

/** เบราว์เซอร์นี้ decode ไฟล์นี้เองได้ไหม (Safari อ่าน HEIC ได้ → ไม่ต้องโหลดตัวแปลง)
    ⚠️ decode รูปเต็มใบ — เรียกเฉพาะเคสที่ยังไม่แน่ใจว่าเป็น HEIC จริง (ดูข้อ (d) บนหัวไฟล์) */
async function browserCanDecode(file) {
  if (typeof createImageBitmap !== 'function') return false;
  let bmp = null;
  try {
    bmp = await createImageBitmap(file);
    return true;
  } catch {
    return false;
  } finally {
    bmp?.close?.();
  }
}

/* ───── สถานะระดับโมดูล (worker ตัวเดียวทั้งหน้า → สถานะก็ต้องตัวเดียวทั้งหน้า) ───── */
let poisoned = false;             // ตัวแปลงตาย/ค้างไปแล้ว — ทุกครั้งถัดไปโยนทันที
let chain = Promise.resolve();    // คิวแปลงทีละไฟล์
let timeoutMs = HEIC_TIMEOUT_MS;
let workerHooked = false;

/** โหลด heic2any (lazy) — แยกเป็นตัวแปรเพื่อให้เทส inject ตัวแปลงจำลองได้โดยไม่ต้อง import ของจริง */
let loadConverter = async () => {
  const mod = await import('heic2any');
  return mod?.default || mod;
};

function markPoisoned(reason) {
  if (!poisoned) console.warn('heic2any worker poisoned:', reason);
  poisoned = true;
}

/** ผูก onerror กับ worker กลางของ heic2any (best-effort — ตัวไลบรารีไม่ผูกให้) */
function hookWorker() {
  if (workerHooked) return;
  const w = typeof window !== 'undefined' ? window.__heic2any__worker : null;
  if (!w || typeof w.addEventListener !== 'function') return;
  workerHooked = true;
  w.addEventListener('error', (e) => markPoisoned(e?.message || 'worker error'));
}

/** เรียก heic2any 1 ครั้ง แข่งกับนาฬิกา — เกินเวลา = poison + โยน HEIC_STUCK_MSG */
function convertWithTimeout(heic2any, file, quality) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      markPoisoned(`timeout ${timeoutMs}ms`);
      reject(new Error(HEIC_STUCK_MSG));
    }, timeoutMs);
  });
  const work = Promise.resolve().then(() => heic2any({ blob: file, toType: 'image/jpeg', quality }));
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** แปลง HEIC → JPEG (โหลดตัวแปลงแบบ lazy · ทีละไฟล์ · มีเพดานเวลา) · คืน File ชื่อ .jpg */
function convert(file, quality) {
  const run = chain.then(async () => {
    if (poisoned) throw new Error(HEIC_STUCK_MSG);
    const heic2any = await loadConverter();
    hookWorker();
    const out = await convertWithTimeout(heic2any, file, quality);
    // ไฟล์ HEIC แบบ sequence (Live Photo / burst) คืนมาเป็น array — เอาเฟรมแรก
    const blob = Array.isArray(out) ? out[0] : out;
    if (!blob) throw new Error(HEIC_FAIL_MSG);
    const name = String(file.name || 'image').replace(HEIC_EXT, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  });
  // คิวเดินต่อได้เสมอ ไม่ว่าตัวก่อนหน้าจะล้ม (ผลลัพธ์/ error ส่งให้ผู้เรียกของตัวนั้นเอง)
  chain = run.catch(() => {});
  return run;
}

/**
 * คืนไฟล์ที่ "เบราว์เซอร์นี้อ่านออกแน่ๆ"
 * — ไม่ใช่ HEIC หรือ decode เองได้ = คืนไฟล์เดิม (ไม่มี overhead)
 * — เป็น HEIC ที่ decode ไม่ได้ = แปลงเป็น JPEG ให้
 * @throws Error(HEIC_FAIL_MSG)  เมื่อแปลงไม่สำเร็จ (ไฟล์อ่านไม่ออก) — ผู้เรียกต้องโชว์ข้อความนี้ ห้ามกลืน
 * @throws Error(HEIC_STUCK_MSG) เมื่อตัวแปลงค้าง/ตาย — ผู้เรียกต้องโชว์ข้อความนี้ และ **reset busy flag ใน finally เสมอ**
 */
export async function toDecodableImage(file, quality = 0.9) {
  if (!isHeicFile(file)) return file;
  // ตัวแปลงตายแล้ว = ไม่มีทางแปลงได้ในหน้านี้ — ตอบทันที ไม่เสียเวลา probe/รอ
  if (poisoned) throw new Error(HEIC_STUCK_MSG);
  // MIME ยืนยัน HEIC แล้วยัง probe เฉพาะเมื่อเบราว์เซอร์อ่าน HEIC ได้เอง (Safari) — Chrome/Android ข้ามไปแปลงเลย
  // ⚠️ เคสรู้จากนามสกุลอย่างเดียว (type ว่าง/octet-stream) ยังต้อง probe: อาจเป็น Safari ที่อ่านเองได้
  const skipProbe = isHeicByMime(file) && !browserDecodesHeic();
  if (!skipProbe && await browserCanDecode(file)) return file;
  try {
    return await convert(file, quality);
  } catch (e) {
    if (e?.message === HEIC_STUCK_MSG) throw e;   // ข้อความชี้ทางแก้อยู่แล้ว ห้ามแทนที่ด้วย FAIL_MSG
    console.warn('heic convert failed', e);
    throw new Error(HEIC_FAIL_MSG);
  }
}

/* ───── สำหรับเทสเท่านั้น (node:test ไม่มี DOM/worker) — ห้ามใช้ในโค้ดแอป ───── */
export const __heicTestHooks = {
  setLoader(fn) { loadConverter = fn; },
  setTimeoutMs(ms) { timeoutMs = ms; },
  isPoisoned() { return poisoned; },
  reset() { poisoned = false; chain = Promise.resolve(); timeoutMs = HEIC_TIMEOUT_MS; workerHooked = false; },
};
