import { describe, expect, it } from 'vitest'
import { segmentTranscript, type TranscriptSegment } from './transcript'

/**
 * VOX-05: توزيع مقاطع التفريغ على الخطوات — نقي بلا شبكة أو DOM.
 * كل مقطع يلتحق بالخطوة التي يقع بدؤه في نطاقها الزمني (نفس محور «زمن محتوى الصوت»
 * الذي عليه stepAudioMs). المخرجات مقترحات لكل خطوة، لا تُكتب تلقائيًا.
 */

describe('segmentTranscript', () => {
  const stepTimes = [0, 5_000, 12_000] // ثلاث خطوات على مسار الصوت

  it('يوزّع كل مقطع على الخطوة التي يقع بدؤه في نطاقها', () => {
    const segs: TranscriptSegment[] = [
      { startMs: 500, text: 'افتح القائمة' },
      { startMs: 6_000, text: 'اضغط الزر الأزرق' },
      { startMs: 13_000, text: 'احفظ التغييرات' },
    ]
    expect(segmentTranscript(stepTimes, segs)).toEqual([
      'افتح القائمة',
      'اضغط الزر الأزرق',
      'احفظ التغييرات',
    ])
  })

  it('مقطع قبل أول خطوة يُضم للخطوة الأولى (تمهيد الشرح)', () => {
    const segs: TranscriptSegment[] = [{ startMs: -200, text: 'مرحبًا سنبدأ الآن' }]
    expect(segmentTranscript(stepTimes, segs)).toEqual(['مرحبًا سنبدأ الآن', '', ''])
  })

  it('خطوة بلا كلام فيها تبقى مقترحًا فارغًا', () => {
    const segs: TranscriptSegment[] = [
      { startMs: 100, text: 'الأولى' },
      { startMs: 12_500, text: 'الثالثة' },
    ]
    expect(segmentTranscript(stepTimes, segs)).toEqual(['الأولى', '', 'الثالثة'])
  })

  it('عدة مقاطع في خطوة تُدمج بالترتيب بمسافة واحدة ومقلّمة', () => {
    // حدود المنتصفات: 2500 و8500. 5100 و7000 للثانية، و9000 (>8500) أقرب للثالثة
    const segs: TranscriptSegment[] = [
      { startMs: 5_100, text: '  اضغط ' },
      { startMs: 7_000, text: 'ثم اختر ' },
      { startMs: 8_400, text: 'الحفظ' },
    ]
    expect(segmentTranscript(stepTimes, segs)).toEqual(['', 'اضغط ثم اختر الحفظ', ''])
  })

  it('الشرح-قبل-الفعل يلتحق بفعله لا بالخطوة السابقة (النموذج الاحترافي)', () => {
    // مقطع عند 4000: يبدأ قبل الفعل (5000) بثانية — «الآن سأنقر الزر».
    // النموذج القديم (محاذاة يسار) كان يعطيه الخطوة 0؛ الأقرب-زمنيًا يعطيه الخطوة 1 بحق.
    const segs: TranscriptSegment[] = [{ startMs: 4_000, text: 'الآن سأنقر الزر الأزرق' }]
    expect(segmentTranscript(stepTimes, segs)).toEqual(['', 'الآن سأنقر الزر الأزرق', ''])
  })

  it('بلا خطوات يعيد مصفوفة فارغة (لا يفقد كلامًا في العدم)', () => {
    expect(segmentTranscript([], [{ startMs: 0, text: 'شيء' }])).toEqual([])
  })

  it('مقاطع فارغة أو فراغات لا تلوّث المقترح', () => {
    const segs: TranscriptSegment[] = [
      { startMs: 100, text: '   ' },
      { startMs: 200, text: 'نص' },
    ]
    expect(segmentTranscript(stepTimes, segs)).toEqual(['نص', '', ''])
  })
})
