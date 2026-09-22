import { describe, it, expect } from 'vitest'
import { createGesturePacer } from './gesture-pacer'

/**
 * ساعة يدويّة بلا fake timers: `now` عدّاد نحرّكه باليد، و`schedule` يسجّل
 * النداءات في مصفوفة يشغّلها الاختبار عندئذ — كل مهمّة تحفظ موعد استحقاقها المطلق.
 */
function manualClock() {
  let t = 0
  const jobs: Array<{ dueAt: number; fn: () => void; cancelled: boolean }> = []
  return {
    now: () => t,
    schedule: (fn: () => void, ms: number) => {
      const job = { dueAt: t + ms, fn, cancelled: false }
      jobs.push(job)
      return () => {
        job.cancelled = true
      }
    },
    advance(ms: number) {
      t += ms
    },
    /** يشغّل المهام غير الملغاة التي حان موعدها بترتيب الجدولة */
    runDue() {
      for (const j of [...jobs]) {
        if (!j.cancelled && j.dueAt <= t) {
          j.cancelled = true
          j.fn()
        }
      }
    },
    pending: () => jobs.filter((j) => !j.cancelled),
    all: jobs,
  }
}

function make(collectMs = 60, maxMs = 400) {
  const clock = manualClock()
  const flushed: string[][] = []
  const pacer = createGesturePacer<string>({
    collectMs,
    maxMs,
    now: clock.now,
    schedule: clock.schedule,
    onFlush: (items) => flushed.push(items),
  })
  return { clock, flushed, pacer }
}

describe('createGesturePacer — آلة توقيت الإيماءة النقية (ساعة ومجدول محقونان)', () => {
  it('أول حدث يفتح النافذة ويجدول الإغلاق بعد صمت collectMs', () => {
    const { clock, pacer } = make()
    expect(clock.pending()).toHaveLength(0) // بلا نافذة لا جدولة
    pacer.add('a')
    expect(pacer.seenCount()).toBe(1)
    const pending = clock.pending()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.dueAt).toBe(60) // صمت ٦٠مث من فتح النافذة
  })

  it('صمت collectMs يغلق النافذة ويصرّف العناصر إلى onFlush', () => {
    const { clock, flushed, pacer } = make()
    pacer.add('a')
    pacer.add('b')
    clock.advance(60)
    clock.runDue()
    expect(flushed).toEqual([['a', 'b']])
    expect(pacer.seenCount()).toBe(0)
    expect(clock.pending()).toHaveLength(0)
  })

  it('حدث جديد قبل الإغلاق يلغي الجدولة السابقة ويجدول صمتًا جديدًا من آخر حدث', () => {
    const { clock, flushed, pacer } = make()
    pacer.add('a') // استحقاق ٦٠
    clock.advance(30)
    const first = clock.all[0]!
    pacer.add('b')
    expect(first.cancelled).toBe(true) // الجدولة القديمة أُلغيت
    expect(clock.pending()).toHaveLength(1)
    expect(clock.pending()[0]!.dueAt).toBe(90) // صمت ٦٠مث من الحدث الأخير (٣٠+٦٠)
    clock.advance(60)
    clock.runDue()
    expect(flushed).toEqual([['a', 'b']])
  })

  it('سقف maxMs يقصّر التأجيل حتى يفوز على صمت collectMs', () => {
    const { clock, flushed, pacer } = make(60, 100)
    pacer.add('a') // استحقاق ٦٠
    clock.advance(50)
    pacer.add('b') // الصمت يقول ١١٠ لكن السقف ١٠٠ ⇒ استحقاق ١٠٠
    expect(clock.pending()[0]!.dueAt).toBe(100)
    clock.advance(40) // t=90
    pacer.add('c') // المتبقي للسقف ١٠ ⇒ استحقاق ١٠٠
    expect(clock.pending()[0]!.dueAt).toBe(100)
    clock.advance(10)
    clock.runDue()
    expect(flushed).toEqual([['a', 'b', 'c']])
    expect(pacer.seenCount()).toBe(0) // أُغلقت عند السقف بالضبط
  })

  it('flush على فراغ بلا أثر: لا onFlush ولا جدولة', () => {
    const { clock, flushed, pacer } = make()
    pacer.flush()
    pacer.open()
    pacer.flush()
    clock.advance(1000)
    clock.runDue()
    expect(flushed).toEqual([])
    expect(clock.pending()).toHaveLength(0)
  })

  it('seenCount يعكس عناصر النافذة الحيّة ويصير صفرًا بعد الإغلاق', () => {
    const { clock, flushed, pacer } = make()
    pacer.add('a')
    pacer.add('b')
    pacer.add('c')
    expect(pacer.seenCount()).toBe(3)
    pacer.flush()
    expect(pacer.seenCount()).toBe(0)
    expect(flushed).toEqual([['a', 'b', 'c']])
    pacer.add('d') // نافذة جديدة تُفتح تلقائيًّا بعد الإغلاق
    expect(pacer.seenCount()).toBe(1)
  })

  it('الإغلاق المزدوج آمن: لا صرف مرّتين، وopen يصرّف المعلّق فورًا', () => {
    const { clock, flushed, pacer } = make()
    pacer.add('a')
    clock.advance(60)
    clock.runDue()
    clock.runDue() // لا شيء معلّق
    pacer.flush()
    expect(flushed).toEqual([['a']])
    // open أثناء وجود إيماءة معلّقة يصرّفها فورًا (سلوك الضغطة الجديدة)
    pacer.add('b')
    clock.advance(10)
    pacer.open()
    expect(flushed).toEqual([['a'], ['b']])
    expect(pacer.seenCount()).toBe(0)
    clock.advance(1000)
    clock.runDue()
    expect(flushed).toEqual([['a'], ['b']]) // النافذة الجديدة الفارغة لا تُصرَّف متأخرًا
  })

  it('collectMs=0 يجدول إغلاقًا فوريًّا (تأجيل صفر)', () => {
    const { clock, flushed, pacer } = make(0, 400)
    pacer.add('a')
    expect(clock.pending()[0]!.dueAt).toBe(0)
    clock.runDue()
    expect(flushed).toEqual([['a']])
    expect(pacer.seenCount()).toBe(0)
  })
})
