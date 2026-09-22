/**
 * PNG صغير مولَّد يدويًا (بلا اعتماد خارجي) للإثباتات البصرية: خلفية فاتحة
 * وثلاثة مستطيلات داكنة تمثّل «أزرارًا» تقع عليها أطر الهدف. الترميز RGB خام
 * داخل IDAT مضغوط بـzlib — كافٍ تمامًا لفحص رسم الإطار فوق صورة حقيقية.
 */
import { deflateSync } from 'node:zlib'

const W = 640
const H = 400

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** مستطيلات «الأزرار» — تطابق مواضع أطر الهدف في سكربت الإثبات */
const BUTTONS = [
  { x: 60, y: 90, w: 200, h: 70 },
  { x: 380, y: 90, w: 200, h: 70 },
  { x: 60, y: 250, w: 200, h: 70 },
]

export function createCanvasPng() {
  const raw = Buffer.alloc((W * 3 + 1) * H)
  let p = 0
  for (let y = 0; y < H; y++) {
    raw[p++] = 0 // filter: none
    for (let x = 0; x < W; x++) {
      const onBtn = BUTTONS.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
      const [r, g, bl] = onBtn ? [45, 55, 72] : [244, 244, 240]
      raw[p++] = r
      raw[p++] = g
      raw[p++] = bl
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
