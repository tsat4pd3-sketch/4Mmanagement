// 3D model helpers for PM equipment.
// Every supported upload is normalised to GLB on the client so the viewer only
// ever loads one format (fast, single GLTFLoader path). Heavy deps (three loaders,
// OpenCascade WASM ~7.6MB) are dynamically imported here so pages that never touch
// 3D don't pay for them.
//
// Renderable in-browser:  .glb .gltf (native) · .stl .obj (mesh) · .stp/.step .igs/.iges (CAD via OCCT)
// NOT renderable (proprietary B-rep — must export to STEP/IGES first from the CAD app):
//   .prt (NX/Creo) · .sldprt (SolidWorks) · .catpart (CATIA) · .ipt (Inventor) · .x_t (Parasolid)

export const MODEL_ACCEPT = '.glb,.gltf,.stl,.obj,.stp,.step,.igs,.iges'
export const MODEL_REJECT = { prt: 'NX / Creo', sldprt: 'SolidWorks', catpart: 'CATIA', ipt: 'Inventor', x_t: 'Parasolid', x_b: 'Parasolid' }

export function modelExt(name) { return (name.split('.').pop() || '').toLowerCase() }

export function modelReason(ext) {
  if (MODEL_REJECT[ext]) return `ไฟล์ .${ext} (${MODEL_REJECT[ext]}) เป็นฟอร์แมตเฉพาะ เปิดบนเว็บไม่ได้ — export เป็น STEP (.stp) หรือ IGES (.igs) จากโปรแกรม CAD ก่อน`
  return `ไม่รองรับไฟล์ .${ext} — ใช้ .glb .gltf .stl .obj .stp/.step .igs/.iges`
}

// File (any supported) → GLB Blob. Throws with a Thai message on unsupported/failed.
export async function fileToGlb(file) {
  const ext = modelExt(file.name)
  if (ext === 'glb') return file // already renderable as-is
  const THREE = await import('three')
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')

  if (ext === 'gltf') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const url = URL.createObjectURL(file)
    try { const gltf = await new GLTFLoader().loadAsync(url); return await exportGlb(gltf.scene, GLTFExporter) }
    finally { URL.revokeObjectURL(url) }
  }
  if (ext === 'stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
    const geo = new STLLoader().parse(await file.arrayBuffer())
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb4bcc6, metalness: 0.1, roughness: 0.7 }))
    return await exportGlb(mesh, GLTFExporter)
  }
  if (ext === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
    const obj = new OBJLoader().parse(await file.text())
    return await exportGlb(obj, GLTFExporter)
  }
  if (['stp', 'step', 'igs', 'iges'].includes(ext)) {
    const group = await cadToGroup(file, ext, THREE)
    return await exportGlb(group, GLTFExporter)
  }
  throw new Error(modelReason(ext))
}

async function cadToGroup(file, ext, THREE) {
  const occtimportjs = (await import('occt-import-js')).default
  const wasmUrl = (await import('occt-import-js/dist/occt-import-js.wasm?url')).default
  const occt = await occtimportjs({ locateFile: () => wasmUrl })
  const buf = new Uint8Array(await file.arrayBuffer())
  // คุมความละเอียด mesh ให้ไฟล์ไม่บวม (สำคัญกับ storage/egress free tier) — ยังคมพอสำหรับดูภาพรวม
  const params = { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.002, angularDeflection: 0.4 }
  const result = ['igs', 'iges'].includes(ext) ? occt.ReadIgesFile(buf, params) : occt.ReadStepFile(buf, params)
  if (!result || !result.success) throw new Error('อ่านไฟล์ CAD ไม่สำเร็จ — ไฟล์อาจเสีย หรือไม่ใช่ STEP/IGES ที่ถูกต้อง')
  if (!result.meshes?.length) throw new Error('ไฟล์นี้ไม่มี geometry แบบตัน (solid/surface) ที่ทำเป็น 3D ได้ — ลอง export เป็น STEP แบบ solid หรือใช้ STL/GLB แทน')
  const group = new THREE.Group()
  let totalVerts = 0
  for (const m of result.meshes) {
    const posArr = m.attributes?.position?.array
    if (!posArr?.length) continue
    totalVerts += posArr.length / 3
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3))
    if (m.attributes.normal?.array?.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3))
    if (m.index?.array?.length) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(m.index.array), 1))
    if (!m.attributes.normal?.array?.length) geo.computeVertexNormals()
    const col = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color(0xb4bcc6)
    group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, metalness: 0.15, roughness: 0.65 })))
  }
  if (totalVerts === 0) throw new Error('แปลงแล้วไม่มีพื้นผิว 3D (อาจเป็นไฟล์ที่มีแต่เส้น/จุด หรือ assembly ว่าง) — ลอง export เป็น STL/GLB จากโปรแกรม CAD แทน')
  return group
}

function exportGlb(object, GLTFExporter) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(object, (glb) => resolve(new Blob([glb], { type: 'model/gltf-binary' })), (err) => reject(err instanceof Error ? err : new Error('แปลงเป็น GLB ไม่สำเร็จ')), { binary: true })
  })
}
