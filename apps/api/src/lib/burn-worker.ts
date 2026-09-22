import fs from 'node:fs'
import { parentPort } from 'node:worker_threads'
import { burnJpeg, type BurnSpec } from './burn'

/**
 * خصوصيّة ٢ب: الحرق خارج خيط الخادم — jpeg-js النقيّة تحتاج ~1.7s للقطة 1920×1080
 * (قيس 2026-09-15)، فلو جرت في الخيط الرئيسي لتجمّد كل طلب آخر أثناءها.
 * الكتابة إلى ملفّ مؤقّت ثم إعادة تسمية: لا يرى أحد مشتقًّا نصف مكتوب.
 */
parentPort!.on('message', (m: { id: number; src: string; out: string; spec: BurnSpec }) => {
  let ok = false
  try {
    const burned = burnJpeg(fs.readFileSync(m.src), m.spec)
    if (burned) {
      fs.writeFileSync(`${m.out}.tmp`, burned)
      fs.renameSync(`${m.out}.tmp`, m.out)
      ok = true
    }
  } catch {
    ok = false
  }
  parentPort!.postMessage({ id: m.id, ok })
})
