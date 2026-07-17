// V4 — binary STL parser (worker-side). ASCII files are detected and refused
// with guidance (exports should be binary; ASCII STLs are 5-10× larger).

export interface ParsedStl {
  /** triangle soup, 9 floats per triangle, file units */
  positions: Float32Array
  triangles: number
}

export function looksAscii(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 84) return true
  const head = new Uint8Array(buf, 0, Math.min(512, buf.byteLength))
  let s = ''
  for (let i = 0; i < head.length; i++) s += String.fromCharCode(head[i])
  if (!s.trimStart().toLowerCase().startsWith('solid')) return false
  // binary files may also start with "solid" in the comment header — trust the
  // declared triangle count instead
  const n = new DataView(buf).getUint32(80, true)
  return buf.byteLength !== 84 + 50 * n
}

export function parseBinaryStl(buf: ArrayBuffer): ParsedStl {
  if (buf.byteLength < 84) throw new Error('file too small to be a binary STL')
  const view = new DataView(buf)
  const n = view.getUint32(80, true)
  if (buf.byteLength < 84 + 50 * n) {
    throw new Error(
      `truncated binary STL: header declares ${n.toLocaleString()} triangles `
      + `(${(84 + 50 * n).toLocaleString()} bytes) but the file has ${buf.byteLength.toLocaleString()}`)
  }
  const positions = new Float32Array(9 * n)
  let off = 84
  for (let t = 0; t < n; t++) {
    // skip the 12-byte normal — recomputed from winding where needed
    off += 12
    for (let k = 0; k < 9; k++) {
      positions[t * 9 + k] = view.getFloat32(off, true)
      off += 4
    }
    off += 2 // attribute byte count
  }
  return { positions, triangles: n }
}
