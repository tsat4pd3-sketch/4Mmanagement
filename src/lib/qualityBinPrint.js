/**
 * qualityBinPrint — พิมพ์เอกสารบันทึกถังเหลือง (ชิ้นงานต้องสงสัย) / ถังแดง (ชิ้นงานเสีย)
 * A4 แนวนอน · ตรึง 15 แถวเหมือนฟอร์มกระดาษ (เกิน 15 = ขึ้นใบใหม่)
 *
 * ที่มา: ฟอร์มกระดาษที่หัวหน้าส่งมา 2026-08-19
 * เลขฟอร์ม/Rev/footer อ่านจากทะเบียนกลาง doc_key 'qbin_yellow' / 'qbin_red' — ห้าม hardcode
 *
 * ⚠️ หมายเหตุท้ายใบเป็น "เนื้อฟอร์ม" (บอกขั้นตอนงาน) ไม่ใช่ footer ของทะเบียน จึงอยู่ในโค้ด
 */
import { getDocForm, fullCode, withDocFoot } from '../utils/docForms';
import tsLogoUrl from '../assets/TS logo.png';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ROWS_PER_PAGE = 15;

async function urlToDataUrl(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

const d2 = v => (v ? new Date(v + 'T00:00:00').toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const n0 = v => (v == null || v === '' ? '' : Number(v).toLocaleString('th-TH'));

/** นิยามคอลัมน์ของแต่ละถัง — ตรงกับฟอร์มกระดาษ (หัว 2 ชั้นใช้ `sub`) */
const SPEC = {
  yellow: {
    key: 'qbin_yellow',
    title: 'เอกสารบันทึกรายการชิ้นงานต้องสงสัย (ถังสีเหลือง)',
    head: '#fde9c8', accent: '#f5b942',
    cols: [
      { h: 'No.', w: 26, get: (r, i) => i + 1, c: 1 },
      { h: 'วันที่ลงถัง', w: 62, get: r => d2(r.work_date), c: 1 },
      { h: 'จำนวนงาน<br>รอพิจารณา', w: 58, get: r => n0(r.qty), c: 1 },
      { h: 'ชื่อ/รหัสชิ้นงาน<br>(Part Name / Part No.)', w: 132, get: r => [r.part_name, r.part_no || r.mat_no].filter(Boolean).join(' / ') },
      { h: 'สาเหตุ', w: 108, get: r => r.cause },
      { h: 'ผู้แจ้ง<br>(พนักงาน)', w: 60, get: r => r.reported_by, c: 1 },
      { h: 'วันที่ซ่อม<br>ชิ้นงาน', w: 58, get: r => d2(r.repair_date), c: 1 },
      { h: 'รายละเอียดการซ่อมชิ้นงาน', w: 150, get: r => r.repair_detail },
      { h: 'ผู้ดำเนิน<br>การซ่อม', w: 58, get: r => r.repair_by, c: 1 },
      { h: 'ผู้ตรวจสอบ<br>(QA)', w: 58, get: r => r.qa_by, c: 1 },
      { h: 'OK', w: 34, get: r => n0(r.qty_ok), c: 1, grp: 'ผลการซ่อมชิ้นงาน (ชิ้น)', bg: '#cfe8cf' },
      { h: 'NG', w: 34, get: r => n0(r.qty_ng), c: 1, grp: 'ผลการซ่อมชิ้นงาน (ชิ้น)', bg: '#f08a8a' },
      { h: 'วันที่นำกลับ<br>เข้ากระบวนการ', w: 66, get: r => d2(r.return_date), c: 1 },
      { h: 'หมายเหตุ', w: 70, get: r => r.note },
    ],
    foot: 'หมายเหตุ : หากซ่อมชิ้นงานแล้ว OK ให้ระบุวันที่นำชิ้นงานหลังซ่อมกลับเข้ากระบวนการทุกครั้ง '
        + '/ แต่หากซ่อมชิ้นงานแล้ว NG ให้ทำการติดแท็กแดง (Tag Reject) ที่ชิ้นงานและลงบันทึกเอกสารบันทึกรายการชิ้นงานเสีย '
        + 'พร้อมทั้งนำชิ้นงานวางในตะกร้าสีแดง',
  },
  red: {
    key: 'qbin_red',
    title: 'เอกสารบันทึกรายการชิ้นงานเสีย (ถังสีแดง)',
    head: '#f6cdb4', accent: '#e07b52',
    cols: [
      { h: 'No.', w: 26, get: (r, i) => i + 1, c: 1 },
      { h: 'วันที่ลงถัง', w: 66, get: r => d2(r.work_date), c: 1 },
      { h: 'จำนวน<br>ชิ้นงานเสีย', w: 62, get: r => n0(r.qty), c: 1 },
      { h: 'ชื่อ/รหัสชิ้นงาน<br>(Part Name / Part No.)', w: 150, get: r => [r.part_name, r.part_no || r.mat_no].filter(Boolean).join(' / ') },
      { h: 'ไลน์การผลิต', w: 84, get: r => r.line_name, c: 1 },
      { h: 'สาเหตุ', w: 210, get: r => r.cause },
      { h: 'ผู้แจ้ง<br>(พนักงาน)', w: 72, get: r => r.reported_by, c: 1 },
      { h: 'ผู้ตรวจสอบ<br>(QA)', w: 72, get: r => r.qa_by, c: 1 },
      { h: 'ผู้กำจัดทำลาย', w: 78, get: r => r.disposed_by, c: 1 },
      { h: 'ตำแหน่ง<br><span style="font-weight:400;font-size:8px">ระดับหัวหน้ากลุ่ม-วิศวกรขึ้นไป</span>', w: 86, get: r => r.disposed_position, c: 1 },
      { h: 'หมายเหตุ', w: 84, get: r => r.note },
    ],
    foot: 'หมายเหตุ : เมื่อพบชิ้นงานเสีย (ไม่สามารถซ่อมได้) ให้หัวหน้างานจัดทำเอกสารใบรายงานของเสีย (Scrap Report) '
        + 'และขออนุมัติทำลายของเสียตาม DOA โดยกำหนดให้ต้องทำลายสภาพเดิมของชิ้นงานเสียให้เสียรูปทุกครั้งก่อนนำของเสียทิ้งลงในถัง Scrap',
  },
};

/** หัวตาราง — คอลัมน์ที่มี `grp` เดียวกันติดกัน จะถูกรวมเป็นหัว 2 ชั้น (เช่น ผลการซ่อม OK|NG) */
function headHtml(cols, headBg) {
  const groups = [];
  cols.forEach((c, i) => {
    const last = groups[groups.length - 1];
    if (c.grp && last && last.grp === c.grp) last.cols.push(i);
    else groups.push({ grp: c.grp || null, cols: [i] });
  });
  const hasTwoRow = groups.some(g => g.grp && g.cols.length > 1);
  if (!hasTwoRow) {
    return `<tr>${cols.map(c => `<th style="width:${c.w}px">${c.h}</th>`).join('')}</tr>`;
  }
  const r1 = groups.map(g => g.grp && g.cols.length > 1
    ? `<th colspan="${g.cols.length}">${esc(g.grp)}</th>`
    : `<th rowspan="2" style="width:${cols[g.cols[0]].w}px">${cols[g.cols[0]].h}</th>`).join('');
  const r2 = groups.filter(g => g.grp && g.cols.length > 1)
    .flatMap(g => g.cols.map(i => `<th style="width:${cols[i].w}px;background:${cols[i].bg || headBg}">${cols[i].h}</th>`)).join('');
  return `<tr>${r1}</tr><tr>${r2}</tr>`;
}

/**
 * @param bin      'yellow' | 'red'
 * @param records  แถวจาก quality_bin_records (เรียงแล้ว)
 * @param sample   แถวตัวอย่างสีเหลืองบนสุดตามฟอร์มกระดาษ (ไม่ส่ง = ไม่พิมพ์แถวตัวอย่าง)
 */
export async function printQualityBin({ bin, records = [], sample = null, section = null }) {
  const S = SPEC[bin];
  if (!S) return false;
  const df = await getDocForm(S.key, { title: S.title }, section ? { section } : {});
  const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);
  const code = fullCode(df);

  const pages = [];
  for (let i = 0; i < Math.max(1, Math.ceil(records.length / ROWS_PER_PAGE)); i++) {
    pages.push(records.slice(i * ROWS_PER_PAGE, (i + 1) * ROWS_PER_PAGE));
  }

  const rowHtml = (r, i) => `<tr>${S.cols.map(c => {
    const v = r ? (c.get(r, i) ?? '') : (c.h === 'No.' ? i + 1 : '');
    return `<td${c.c ? ' class="c"' : ''}>${esc(String(v))}</td>`;
  }).join('')}</tr>`;

  const pageHtml = (rows, pageIdx) => `
  <section class="pg">
    <div class="hd">
      <div class="lg">${logo ? `<img src="${logo}" alt="">` : ''}</div>
      <h1>${esc(df.title || S.title)}</h1>
      <div class="pn">${pages.length > 1 ? `หน้า ${pageIdx + 1}/${pages.length}` : ''}</div>
    </div>
    <table>
      <thead>${headHtml(S.cols, S.head)}</thead>
      <tbody>
        ${pageIdx === 0 && sample ? `<tr class="sample">
          <td class="c sam">ตัวอย่าง</td>
          ${S.cols.slice(1).map(c => `<td${c.c ? ' class="c"' : ''}>${esc(String(c.get(sample, 0) ?? ''))}</td>`).join('')}
        </tr>` : ''}
        ${Array.from({ length: ROWS_PER_PAGE }, (_, i) => rowHtml(rows[i], pageIdx * ROWS_PER_PAGE + i)).join('')}
      </tbody>
    </table>
    <div class="ft">${esc(S.foot)}</div>
  </section>`;

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>${esc(S.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4 landscape; margin: 6mm; }
  * { box-sizing: border-box }
  html, body { margin:0; padding:0; background:#fff }
  body { font-family:'Sarabun',sans-serif; color:#000; font-size:10px }
  .pg { width: 285mm; page-break-after: always }
  .pg:last-child { page-break-after: auto }
  .hd { display:flex; align-items:center; border:1.4px solid #000; border-bottom:none; padding:2px 6px; gap:8px }
  .hd .lg { width:56px; flex:0 0 auto } .hd .lg img { max-width:100%; max-height:30px }
  .hd h1 { flex:1; margin:0; text-align:center; font-size:15px; font-weight:800 }
  .hd .pn { width:56px; text-align:right; font-size:9px; color:#444 }
  table { border-collapse:collapse; width:100%; table-layout:fixed }
  th, td { border:1px solid #000; padding:2px 3px; font-size:9.5px; word-wrap:break-word }
  th { background:${S.head}; font-weight:700; text-align:center; font-size:9.5px; line-height:1.15 }
  td { height:19px }
  td.c { text-align:center }
  tr.sample td { background:#ffff00; font-weight:600 }
  tr.sample td.sam { writing-mode:vertical-rl; transform:rotate(180deg); font-size:8px; padding:0 }
  .ft { border:1.4px solid #000; border-top:none; padding:3px 6px; font-size:8.5px; line-height:1.35 }
  .code { text-align:right; font-size:8px; color:#555; margin-top:2px }
</style></head><body>
  ${pages.map(pageHtml).join('')}
  ${code ? `<div class="code">${esc(code)}${df.effective_date ? ` · Effective: ${esc(df.effective_date)}` : ''}</div>` : ''}
<script>
  (function () {
    function go() { window.focus(); window.print(); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ setTimeout(go, 80); });
    else window.addEventListener('load', function(){ setTimeout(go, 200); });
  })();
</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(withDocFoot(html, S.key, section ? { section } : {}));
  w.document.close();
  return true;
}

export { SPEC as QBIN_SPEC, ROWS_PER_PAGE };
