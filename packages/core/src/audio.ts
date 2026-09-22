/** VOX-01..03: حسابات مزامنة الصوت بالخطوات — نقية بلا DOM أو chrome.* */

/** فترة إيقاف مؤقت [من، إلى] بالساعة المطلقة — الصوت توقف فيها فزمن المحتوى يقفز */
export type AudioPause = [number, number]

/**
 * كم أُوقف التسجيل (ms) قبل لحظة ما — فترات متجاورة أو منفصلة تُجمع كلها.
 */
export function pausedMsBefore(pauses: AudioPause[], wallMs: number): number {
  let total = 0
  for (const [from, to] of pauses) {
    if (wallMs <= from) break // مرتبة زمنيًا — ما بعدها كله بعد اللحظة
    total += Math.max(0, Math.min(to, wallMs) - from)
  }
  return total
}

/**
 * زمن خطوة داخل مسار الصوت: فرق طابعها المطلق عن لحظة بدء التسجيل مطروحًا منه
 * ما أُوقف من التسجيل قبلها (الصوت لا يجري أثناء الإيقاف)، محصورًا في [0, durationMs].
 */
export function stepAudioMs(
  startedAt: number,
  stepTs: number,
  durationMs: number,
  pauses: AudioPause[] = [],
): number {
  const raw = stepTs - startedAt - pausedMsBefore(pauses, stepTs)
  return Math.max(0, Math.min(raw, durationMs))
}

/**
 * فهرس الخطوة الحالية عند زمن تشغيل معين: آخر خطوة زمنها ≤ الزمن.
 * -1 قبل أول خطوة. بحث ثنائي — الأدلة قد تضم 1000 خطوة والحدث يصل كل ~250ms.
 */
export function currentStepIndexAt(stepAudioTimes: number[], tMs: number): number {
  let lo = 0
  let hi = stepAudioTimes.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (stepAudioTimes[mid]! <= tMs) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/**
 * أقرب خطوة زمنيًا لِـ tMs — الحدّ بين خطوتين متجاورتين هو منتصف زمنيهما، فيلتحق
 * الشرح بفعله سواء سبقه قليلًا أو تلاه (تماثل حول الفعل، لا انحياز للأبكر كما في
 * currentStepIndexAt). التعادل للأبكر (استقرار). قبل أول فعل → الأولى، بعد آخره → الأخيرة.
 * -1 حين لا خطوات. أساس توزيع النص وإبراز التشغيل معًا فيتقطّعان بنفس الطريقة.
 */
export function nearestStepIndexAt(stepAudioTimes: number[], tMs: number): number {
  if (stepAudioTimes.length === 0) return -1
  const lo = currentStepIndexAt(stepAudioTimes, tMs) // آخر فعل زمنه ≤ tMs، أو -1
  if (lo < 0) return 0 // قبل أول فعل — تمهيد الشرح للأولى
  if (lo >= stepAudioTimes.length - 1) return lo // عند آخر فعل أو بعده
  const hi = lo + 1
  // التعادل (المسافتان متساويتان) يبقى للأبكر — لهذا ≤
  return tMs - stepAudioTimes[lo]! <= stepAudioTimes[hi]! - tMs ? lo : hi
}

/** نطاق صوت خطوة واحدة: [البداية، النهاية) على محور زمن محتوى الصوت (ms) */
export interface StepAudioRange {
  startMs: number
  endMs: number
}

/**
 * VOX-03 موزّعًا: نطاق صوت كل خطوة — حدود المنتصفات نفسها التي يوزّع بها النص
 * (nearestStepIndexAt)، فما تقرأه الخطوة من تفريغ هو بالضبط ما يُسمَع عند تشغيلها.
 * الأولى تبدأ من صفر (تمهيدها لها)، والأخيرة تمتد حتى نهاية التسجيل.
 */
export function stepAudioRanges(stepAudioTimes: number[], durationMs: number): StepAudioRange[] {
  const n = stepAudioTimes.length
  return stepAudioTimes.map((t, i) => {
    const rawStart = i === 0 ? 0 : Math.round((stepAudioTimes[i - 1]! + t) / 2)
    const rawEnd = i === n - 1 ? durationMs : Math.round((t + stepAudioTimes[i + 1]!) / 2)
    const startMs = Math.max(0, Math.min(rawStart, durationMs))
    return { startMs, endMs: Math.max(startMs, Math.min(rawEnd, durationMs)) }
  })
}
