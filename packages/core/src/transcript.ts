/** VOX-04/05: توزيع التفريغ على الخطوات — نقي بلا شبكة أو DOM أو chrome.* */

import { nearestStepIndexAt } from './audio'

/** مقطع تفريغ: نصّه ولحظة بدئه على محور «زمن محتوى الصوت» (ms) — نفس محور stepAudioMs */
export interface TranscriptSegment {
  startMs: number
  text: string
}

/**
 * VOX-05: نصّ مقترح لكل خطوة — كل مقطع يلتحق **بأقرب فعل زمنيًا** لبدئه (حدود المنتصفات
 * بين الأفعال)، فالشرح-قبل-الفعل يلتحق بفعله لا بالخطوة السابقة، وما قبل أول فعل يُضم
 * للأولى. نفس دالة إبراز التشغيل، فالنص والصوت يتقطّعان بنفس الطريقة. مقترحات لا تُكتب تلقائيًا.
 */
export function segmentTranscript(
  stepAudioTimes: number[],
  segments: TranscriptSegment[],
): string[] {
  const buckets: string[][] = stepAudioTimes.map(() => [])
  if (buckets.length === 0) return []
  for (const seg of segments) {
    const text = seg.text.trim()
    if (!text) continue
    const idx = nearestStepIndexAt(stepAudioTimes, seg.startMs)
    buckets[idx]!.push(text)
  }
  return buckets.map((parts) => parts.join(' '))
}
