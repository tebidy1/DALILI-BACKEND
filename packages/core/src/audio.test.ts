import { describe, expect, it } from 'vitest'
import {
  chunkAbsMs,
  currentStepIndexAt,
  deriveDurationMs,
  nearestStepIndexAt,
  netDurationMs,
  pausedMsBefore,
  stepAudioMs,
  stepAudioRanges,
  syncMaxDriftMs,
} from './audio'

/**
 * VOX-02: مزامنة الصوت بالخطوات — كل الحسابات نقية قابلة للاختبار الكامل.
 * البوابة الملزمة: ±300ms مقيسة لا مقدّرة.
 */

describe('stepAudioMs', () => {
  it('يشتق زمن الخطوة في مسار الصوت من فرق الطوابع المطلقة', () => {
    const startedAt = 1_000_000
    expect(stepAudioMs(startedAt, startedAt + 4_500, 60_000)).toBe(4_500)
    expect(stepAudioMs(startedAt, startedAt, 60_000)).toBe(0)
  })

  it('خطوة قبل بدء التسجيل تُحصر عند الصفر — لا زمن سالب', () => {
    expect(stepAudioMs(1_000_000, 999_000, 60_000)).toBe(0)
  })

  it('خطوة بعد نهاية التسجيل تُحصر عند المدة الكاملة', () => {
    expect(stepAudioMs(1_000_000, 1_070_000, 60_000)).toBe(60_000)
  })
})

describe('الإيقاف المؤقت — الصوت يقف مع الالتقاط والزمن يقفز فوقه', () => {
  const t0 = 1_000_000
  const pauses: Array<[number, number]> = [[t0 + 10_000, t0 + 25_000]]

  it('pausedMsBefore يجمع ما أُوقف قبل اللحظة فقط', () => {
    expect(pausedMsBefore(pauses, t0 + 5_000)).toBe(0)
    expect(pausedMsBefore(pauses, t0 + 15_000)).toBe(5_000) // داخل الفترة
    expect(pausedMsBefore(pauses, t0 + 40_000)).toBe(15_000) // بعدها كاملًا
    expect(pausedMsBefore([], t0 + 40_000)).toBe(0)
  })

  it('خطوة بعد الاستئناف تتخطى زمن الإيقاف — المزامنة تصمد', () => {
    // خطوة بعد الاستئناف بثانيتين: زمنها = 27s − 15s إيقاف = 12s
    expect(stepAudioMs(t0, t0 + 27_000, 120_000, pauses)).toBe(12_000)
    // خطوة أثناء الإيقاف (قبل الاستئناف): تُربط بنهاية ما قبل الإيقاف
    expect(stepAudioMs(t0, t0 + 20_000, 120_000, pauses)).toBe(10_000)
  })

  it('فترتا إيقاف متتاليتان تُجمعان معًا', () => {
    const two: Array<[number, number]> = [
      [t0 + 10_000, t0 + 15_000],
      [t0 + 30_000, t0 + 32_000],
    ]
    expect(stepAudioMs(t0, t0 + 40_000, 120_000, two)).toBe(40_000 - 7_000)
  })
})

describe('currentStepIndexAt', () => {
  const stepMs = [0, 4_000, 9_000, 20_000]

  it('أول زمن أكبر من أو يساوي زمنه يحدد الخطوة الحالية', () => {
    expect(currentStepIndexAt(stepMs, 0)).toBe(0)
    expect(currentStepIndexAt(stepMs, 3_999)).toBe(0)
    expect(currentStepIndexAt(stepMs, 4_000)).toBe(1)
    expect(currentStepIndexAt(stepMs, 15_000)).toBe(2)
    expect(currentStepIndexAt(stepMs, 20_000)).toBe(3)
  })

  it('قبل أول خطوة لا إبراز (-1) وبعد آخرها تبقى الأخيرة', () => {
    expect(currentStepIndexAt(stepMs, -1)).toBe(-1)
    expect(currentStepIndexAt(stepMs, 999_999)).toBe(3)
  })
})

describe('nearestStepIndexAt — أقرب فعل زمنيًا (حدود المنتصفات)', () => {
  const stepMs = [0, 4_000, 9_000, 20_000]

  it('الحدّ منتصف الفعلين المتجاورين — الشرح-قبل-الفعل يلتحق بفعله لا بالسابق', () => {
    // منتصف 0 و4000 = 2000: قبله للأولى، بعده للثانية
    expect(nearestStepIndexAt(stepMs, 1_999)).toBe(0)
    expect(nearestStepIndexAt(stepMs, 2_001)).toBe(1)
    // منتصف 4000 و9000 = 6500: 6000 أقرب للثانية رغم أنه بعدها (النموذج القديم كان يعطيها الثانية أيضًا)
    expect(nearestStepIndexAt(stepMs, 6_000)).toBe(1)
    // 7000 أقرب للثالثة (9000) من الثانية (4000) — النموذج القديم كان يخطئ ويعطيها الثانية
    expect(nearestStepIndexAt(stepMs, 7_000)).toBe(2)
  })

  it('التعادل يذهب للخطوة الأبكر (استقرار)', () => {
    expect(nearestStepIndexAt(stepMs, 2_000)).toBe(0) // منتصف تمامًا
    expect(nearestStepIndexAt(stepMs, 6_500)).toBe(1)
  })

  it('قبل أول فعل يلتحق بالأولى، وبعد آخر فعل بالأخيرة', () => {
    expect(nearestStepIndexAt(stepMs, -500)).toBe(0)
    expect(nearestStepIndexAt(stepMs, 999_999)).toBe(3)
  })

  it('بلا خطوات يعيد -1', () => {
    expect(nearestStepIndexAt([], 100)).toBe(-1)
  })
})

describe('chunkAbsMs', () => {
  it('التحويل للساعة المطلقة: t0 + (ساعة المقطع − ساعة البداية)', () => {
    expect(chunkAbsMs(1_700_000_000_000, 500, 1_500)).toBe(1_700_000_001_000)
    expect(chunkAbsMs(100, 0, 0)).toBe(100)
  })
})

describe('deriveDurationMs', () => {
  it('المدة = ساعة آخر مقطع − ساعة البدء (مقاطع 1000ms)', () => {
    expect(deriveDurationMs(1_000, 0, 3_500)).toBe(3_500)
    expect(deriveDurationMs(1_000, 200, 1_200)).toBe(1_000)
  })

  it('لا مدة سالبة أبدًا', () => {
    expect(deriveDurationMs(1_000, 0, 0)).toBe(0)
    expect(deriveDurationMs(1_000, 500, 100)).toBe(0)
  })
})

describe('netDurationMs — عدد صحيح دائمًا (المخطط يرفض العشري)', () => {
  it('يخصم فترات الإيقاف من المدة الخام', () => {
    // t0=1000, آخر مقطع عند offset=10000 → خام=10000ms، أُوقف بين +2000..+5000 → 3000ms
    expect(netDurationMs(1_000, 10_000, [[3_000, 6_000]])).toBe(7_000)
  })

  it('يقرّب دومًا إلى عدد صحيح — performance.now يعطي كسورًا', () => {
    // مدة كسرية شائعة من ساعة الأداء
    const out = netDurationMs(1_000.4, 10_000.7, [])
    expect(Number.isInteger(out)).toBe(true)
    expect(out).toBe(10_001)
  })

  it('صفر أو أقل يعود صفرًا', () => {
    expect(netDurationMs(1_000, 0, [])).toBe(0)
    // إيقاف يغطي كامل مدة التسجيل → الصافي صفر (لا سالب)
    expect(netDurationMs(1_000, 100, [[1_000, 1_500]])).toBe(0)
  })
})

describe('syncMaxDriftMs — بوابة ±300ms', () => {
  it('انحراف ساعة واقعي (50ppm) عبر 30 دقيقة يبقى داخل البوابة', () => {
    // ساعة الأداء تسبق الحقيقية بـ 50 جزءًا من المليون — حد الكريستال الأسوأ واقعيًا
    const PPM = 50
    const chunkClocks: number[] = []
    for (let i = 1; i <= 1_800; i++) chunkClocks.push(i * 1_000 * (1 + PPM / 1_000_000))
    expect(syncMaxDriftMs(chunkClocks, 0)).toBeLessThanOrEqual(300)
  })

  it('انحراف مرتفع (2000ppm) عبر 10 دقائق يتجاوز البوابة — الفاحص يكشفه', () => {
    const PPM = 2_000
    const chunkClocks: number[] = []
    for (let i = 1; i <= 600; i++) chunkClocks.push(i * 1_000 * (1 + PPM / 1_000_000))
    expect(syncMaxDriftMs(chunkClocks, 0)).toBeGreaterThan(300)
  })
})

describe('stepAudioRanges — نطاق صوت كل خطوة (توزيع الصوت على الخطوات)', () => {
  it('حدود المنتصفات: ما تقرأه الخطوة هو ما تسمعه', () => {
    // خطوات عند 1ث/9ث/27ث ومدة 60ث → [0,5] [5,18] [18,60] ثانية
    expect(stepAudioRanges([1_000, 9_000, 27_000], 60_000)).toEqual([
      { startMs: 0, endMs: 5_000 },
      { startMs: 5_000, endMs: 18_000 },
      { startMs: 18_000, endMs: 60_000 },
    ])
  })

  it('خطوة وحيدة تملأ التسجيل كله', () => {
    expect(stepAudioRanges([2_000], 8_000)).toEqual([{ startMs: 0, endMs: 8_000 }])
  })

  it('لا خطوات → لا نطاقات', () => {
    expect(stepAudioRanges([], 10_000)).toEqual([])
  })

  it('زمن خطوة يتجاوز المدة يُقصّ — لا نطاق يتجاوز التسجيل', () => {
    expect(stepAudioRanges([10_000], 5_000)).toEqual([{ startMs: 0, endMs: 5_000 }])
  })

  it('خطوتان بنفس الزمن (كتابة+نقر متلاصقان) → لا سالب ولا انقلاب ترتيب', () => {
    const out = stepAudioRanges([5_000, 5_000], 20_000)
    expect(out[0]).toEqual({ startMs: 0, endMs: 5_000 })
    expect(out[1]).toEqual({ startMs: 5_000, endMs: 20_000 })
    for (const r of out) expect(r.endMs).toBeGreaterThanOrEqual(r.startMs)
  })
})
