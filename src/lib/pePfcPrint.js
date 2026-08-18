/**
 * pePfcPrint — พิมพ์/บันทึก PDF ผังกระบวนการผลิต (Process Flow Chart)
 *
 * pattern เดียวกับฟอร์มพิมพ์อื่น (VSM/LPA/OJT/MO/Scrap): window.open + print
 * เลขฟอร์ม/Rev/ช่องลายเซ็น/โลโก้/footer อ่านจากทะเบียนกลาง doc_key 'pe_pfc' — ห้าม hardcode
 *
 * ⚠️ ตัวผังไม่ได้วาดใหม่ที่นี่ — รับ `svgHtml` ที่ clone มาจาก <PeFlowChart> ตัวจริงบนจอ
 *    (กฎ CLAUDE.md: ห้ามจำลอง layout ใบจริงมาไว้ในตัวพิมพ์ จะกลายเป็น layout ชุดที่ 2 ที่ต้องตามแก้)
 *
 * ⚠️ ใบนี้คือ "ผังที่ระบบวาดจากข้อมูลในระบบ" **ไม่ใช่ไฟล์ PFC เดิมของ PE**
 *    ต้องมีข้อความกำกับบนใบเสมอ ห้ามถอดออก — ไม่งั้นเอาไปใช้แทนเอกสารควบคุมตัวจริงโดยไม่รู้ตัว
 */
import { getDocForm, fullCode, withDocFoot, sigAt, pageCss } from '../utils/docForms';
import tsLogoUrl from '../assets/TS logo.png';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function urlToDataUrl(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

export async function printPfc({ set, procs = [], svgHtml, legendHtml = '', section = null }) {
  const df = await getDocForm('pe_pfc', {
    form_code: 'FM-PE1-020', rev: 'Rev.01', effective_date: '17/03/2015',
    title: 'ผังกระบวนการผลิต (Process Flow Chart)',
    sig_blocks: ['Issued By', 'Checked By', 'Approved By'],
  }, section ? { section } : {});

  const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);
  const code = fullCode(df);
  const kinds = procs.reduce((m, p) => ({ ...m, [p.kind]: (m[p.kind] || 0) + 1 }), {});
  const sigs = [sigAt(df, 0), sigAt(df, 1), sigAt(df, 2)];

  /* ที่ว่างสำหรับผังบนกระดาษ 1 หน้า = ความสูงกระดาษ − ขอบ − หัวเอกสาร/หมายเหตุ/legend/ช่องเซ็น/footer
     (A3 แนวนอน สูง 297mm · A4 แนวนอน 210mm · แนวตั้งสลับด้าน) */
  const paper = String(df.paper_size || 'A3').toUpperCase();
  const landscape = String(df.orientation || 'landscape').toLowerCase() !== 'portrait';
  const SHORT = { A3: 297, A4: 210, LETTER: 216 }[paper] ?? 297;
  const LONG = { A3: 420, A4: 297, LETTER: 279 }[paper] ?? 420;
  const mapMaxMm = Math.max(70, (landscape ? SHORT : LONG) - 16 /* margin */ - 66 /* หัว+หมายเหตุ+legend+เซ็น+footer */);
  const mapWidMm = (landscape ? LONG : SHORT) - 16 - 14;

  /* ผังลงหน้าเดียวเสมอ แต่ "ลงได้" ไม่ได้แปลว่า "อ่านออก" — ประเมินขนาดตัวอักษรบนกระดาษจริงแล้วเตือน
     (ตัวหนังสือในผังคือ 11 หน่วย viewBox · ย่อตามด้านที่บีบก่อน) */
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svgHtml || '');
  const scale = vb ? Math.min(mapWidMm / +vb[1], mapMaxMm / +vb[2]) : null;
  const fontMm = scale ? 11 * scale : null;
  const tooSmall = fontMm != null && fontMm < 1.6;   // ≈ 4.5pt — เล็กกว่านี้อ่านด้วยตาเปล่าไม่ไหว

  const field = (k, v) => `<div><span class="k">${esc(k)}</span><span class="v">${esc(v || '—')}</span></div>`;

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>Process Flow ${esc(set.part_no)}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  @page { size: ${pageCss(df, 'A3 landscape')}; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family:'Sarabun',sans-serif; color:#111827; margin:0; background:#fff; }
  .hd { display:flex; align-items:stretch; border:1.4px solid #374151; }
  .hd .logo { width:150px; display:flex; align-items:center; justify-content:center; border-right:1.2px solid #374151; padding:6px }
  .hd .logo img { max-width:100%; max-height:46px }
  .hd .mid { flex:1; padding:6px 12px; border-right:1.2px solid #374151 }
  .hd .mid h1 { margin:0; font-size:16px; font-weight:800 }
  .hd .mid .sub { font-size:11px; color:#4b5563; margin-top:2px }
  .hd .meta { width:300px; padding:6px 10px; font-size:10.5px }
  .hd .meta div { display:flex; justify-content:space-between; gap:8px; line-height:1.55 }
  .hd .meta .k { color:#4b5563 } .hd .meta .v { font-weight:700 }
  .note { font-size:10.5px; padding:5px 12px; border:1.2px solid #374151; border-top:none; background:#fffbeb; color:#92400e }
  .legend { font-size:10.5px; padding:5px 12px; border:1.2px solid #374151; border-top:none; display:flex; gap:14px; flex-wrap:wrap; align-items:center }
  .legend svg { vertical-align:middle }
  /* ⚠️ บังคับให้ผังลง "หน้าเดียว" เสมอ — จำกัดความสูงของ SVG ไว้เท่าที่เหลือบนกระดาษ
     SVG มี viewBox + preserveAspectRatio ค่าเริ่มต้น (meet) → ย่อลงพอดีกรอบ ไม่ยืดผิดสัดส่วน
     ตัวเลขนี้ = ความสูงกระดาษ − หัวเอกสาร/หมายเหตุ/legend/ช่องเซ็น/footer */
  .map { border:1.2px solid #374151; border-top:none; padding:6px; page-break-inside:avoid }
  .map svg { width:100%; height:auto; max-height:${mapMaxMm}mm; display:block; margin:0 auto }
  html, body { height:100% }
  .sig { display:flex; border:1.2px solid #374151; border-top:none }
  .sig div { flex:1; padding:8px 10px 24px; font-size:10.5px; border-right:1px solid #9ca3af }
  .sig div:last-child { border-right:none }
  .sig .nm { font-weight:700; margin-top:16px; border-top:1px dotted #6b7280; padding-top:3px; text-align:center }
</style></head><body>
<div class="hd">
  ${logo ? `<div class="logo"><img src="${logo}" alt=""></div>` : ''}
  <div class="mid">
    <h1>${esc(df.title || 'ผังกระบวนการผลิต (Process Flow Chart)')}</h1>
    <div class="sub">${esc(set.part_name)} &nbsp;·&nbsp; <b>${esc(set.part_no)}</b>${set.mat_no ? ` &nbsp;·&nbsp; MAT ${esc(set.mat_no)}` : ''}</div>
  </div>
  <div class="meta">
    ${field('เอกสารเลขที่', set.doc_no_pfc)}
    ${field('Model', set.model)}
    ${field('ลูกค้า', set.customer)}
    ${field('ไลน์ผลิต', set.line_name)}
    ${field('จำนวนขั้นงาน', `${procs.length} OP`)}
  </div>
</div>
<div class="note"><b>⚠️ ผังนี้ระบบวาดขึ้นจากรายการขั้นงาน (OP) ในระบบ ณ วันที่พิมพ์ — ไม่ใช่ไฟล์ PFC ต้นฉบับที่ควบคุมโดย PE</b>
&nbsp;·&nbsp; ใช้สำหรับทบทวน/ประชุม/สอบกลับ · เอกสารควบคุมตัวจริงยังเป็นไฟล์ Excel ของ PE</div>
${legendHtml ? `<div class="legend">${legendHtml}</div>` : ''}
<div class="map">${svgHtml}</div>
<div class="sig">
  ${sigs.map((s) => `<div>${esc(s.label)}<div class="nm">${esc(s.name || '')}</div></div>`).join('')}
</div>
${code ? '' : ''}
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return { ok: false, reason: 'popup' };
  w.document.write(withDocFoot(html, 'pe_pfc', section ? { section } : {}));
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* ผู้ใช้สั่งพิมพ์เองได้ */ } }, 600);
  return { ok: true, kinds, tooSmall, paper, landscape, fontMm };
}
