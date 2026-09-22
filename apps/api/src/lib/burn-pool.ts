import os from 'node:os'
import { Worker } from 'node:worker_threads'
import type { BurnSpec } from './burn'

export interface BurnPool {
  /** يحرق src إلى out في خيط عامل — true عند النجاح، false لأي فشل (الفشل مغلق) */
  burn(src: string, out: string, spec: BurnSpec): Promise<boolean>
  close(): Promise<void>
}

/**
 * مجمع عمّال الحرق — كسول (لا خيط قبل أوّل لقطة مطموسة) وunref (لا يُبقي العمليّة حيّة).
 * العامل ملفّ .ts يُحمَّل عبر tsx — نفس طريقة تشغيل الخادم (pnpm start = tsx) بلا خطوة بناء.
 */
export function createBurnPool(size = Math.max(1, Math.min(2, os.cpus().length - 1))): BurnPool {
  const slots: Array<{ worker: Worker; jobs: Set<number> } | null> = new Array(size).fill(null)
  const pending = new Map<number, (ok: boolean) => void>()
  let seq = 0
  let turn = 0
  let closed = false

  function settle(id: number, ok: boolean) {
    const done = pending.get(id)
    pending.delete(id)
    done?.(ok)
  }

  function slot(i: number) {
    const existing = slots[i]
    if (existing) return existing
    const worker = new Worker(new URL('./burn-worker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] })
    worker.unref()
    const s = { worker, jobs: new Set<number>() }
    worker.on('message', (m: { id: number; ok: boolean }) => {
      s.jobs.delete(m.id)
      settle(m.id, m.ok)
    })
    // عامل مات: مهامّه تفشل صادقةً، والخانة تُعاد إنشاؤها عند الطلب التالي
    const fail = () => {
      for (const id of s.jobs) settle(id, false)
      s.jobs.clear()
      if (slots[i] === s) slots[i] = null
    }
    worker.on('error', fail)
    worker.on('exit', fail)
    slots[i] = s
    return s
  }

  return {
    burn(src, out, spec) {
      if (closed) return Promise.resolve(false)
      const id = ++seq
      const s = slot(turn++ % size)
      return new Promise<boolean>((resolve) => {
        pending.set(id, resolve)
        s.jobs.add(id)
        s.worker.postMessage({ id, src, out, spec })
      })
    },
    async close() {
      closed = true
      await Promise.all(slots.map((s) => s?.worker.terminate()))
      for (const id of [...pending.keys()]) settle(id, false)
    },
  }
}
