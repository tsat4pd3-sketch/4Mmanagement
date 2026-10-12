/**
 * QualityPhotoField — ช่องแนบ "รูปหลักฐานของเสีย" ที่ใช้ร่วมกันทั้ง 3 ขั้นของสายงาน
 *   ลงงานเสียในกะ (Daily Report) → ลงถังเหลือง/แดง (QualityBins) → ใบรายงานของเสีย (ScrapReport)
 *
 * 🔴 กติกาที่ห้ามแก้ที่หน้า (2026-10-12 · คำสั่ง user):
 *   · ไฟล์ผ่าน `<ImageCropModal allowFull>` เสมอ — **ครอบได้ แต่ต้องกด "ใช้ทั้งรูป" ได้ด้วย**
 *     รูปหลักฐานที่ครอบจนตำหนิหลุดกรอบ = รูปใช้ไม่ได้เลย (บทเรียนเดียวกับรูปผังเครื่องจักร 21/08)
 *   · บีบ/อัปโหลดผ่าน `src/utils/qualityImage.js` เท่านั้น (ด่าน `quality-photo-via-helper`)
 *   · **รูปเป็นทางเลือกเสมอ ห้ามทำเป็นช่องบังคับ** — หน้างานใส่ถุงมือ/รีบ บังคับถ่ายทุกใบ = คนเลิกลงข้อมูล
 *   · "ยังไม่มีรูป" ต้องเขียนบนจอ **ห้ามซ่อนช่องเงียบๆ** (กฎความซื่อสัตย์ของจอ)
 *
 * ค่าที่คืน: `onPick(File | null)` — `null` = สั่งลบรูปที่มีอยู่
 *   หน้าแม่เก็บ File ไว้ใน state แล้วค่อยอัปโหลดตอนกดบันทึก (ไม่อัปทันที — กดยกเลิกแล้วต้องไม่มีไฟล์ค้าง)
 */
import { useState } from 'react';
import ImageCropModal from './ImageCropModal';
import { acceptImageFile } from '../utils/acceptImageFile';
import { QUALITY_IMG_ASPECT } from '../utils/qualityImage';

const lbl = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 };

export default function QualityPhotoField({
  label, url = null, file = null, onPick, readOnly = false, hint = null,
}) {
  const [cropFile, setCropFile] = useState(null);
  // รูปที่ยังไม่ได้อัปโหลด (File ใน state) ต้องเห็นพรีวิวด้วย ไม่งั้นแนบแล้วเหมือนไม่มีอะไรเกิดขึ้น
  const preview = file ? URL.createObjectURL(file) : url;

  return (
    <div>
      <label style={lbl}>
        {label}
        {hint && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {hint}</span>}
      </label>

      {preview ? (
        <a href={preview} target="_blank" rel="noreferrer" title="เปิดรูปเต็ม">
          <img src={preview} alt={label} style={{
            display: 'block', maxHeight: 120, maxWidth: '100%', borderRadius: 8,
            border: '1px solid var(--border)', marginBottom: 6,
          }} />
        </a>
      ) : (
        /* 🔴 ว่างต้องเขียนว่าว่าง ห้ามปล่อยเป็นช่องเปล่าให้เดาเอง */
        <div style={{
          fontSize: 11.5, color: 'var(--muted)', padding: '10px 12px', marginBottom: 6,
          border: '1px dashed var(--border)', borderRadius: 8, background: 'var(--bg2)',
        }}>ยังไม่มีรูป</div>
      )}

      {!readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="file" accept="image/*" style={{ fontSize: 11.5, maxWidth: '100%' }}
            onChange={async (e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';                       // เลือกไฟล์เดิมซ้ำต้องยิง change อีกครั้ง
              const f = await acceptImageFile(picked);   // ปฏิเสธแล้ว toast ขึ้นให้เอง
              if (f) setCropFile(f);
            }}
          />
          {(file || url) && (
            <button type="button" onClick={() => onPick(null)}
              style={{
                fontSize: 11.5, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)',
              }}>🗑 เอารูปออก</button>
          )}
        </div>
      )}

      {cropFile && (
        <ImageCropModal
          file={cropFile} aspect={QUALITY_IMG_ASPECT} outputSize={1024} quality={0.8} webp
          allowFull fullLabel="ใช้ทั้งรูป (ไม่ครอบ) — แนะนำสำหรับรูปหลักฐาน"
          title="จัดกรอบรูปหลักฐานของเสีย"
          onCancel={() => setCropFile(null)}
          onConfirm={(cropped) => { onPick(cropped); setCropFile(null); }}
        />
      )}
    </div>
  );
}
