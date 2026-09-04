import type { TranscriptSegment } from '@dalili/core'

/**
 * VOX-04 / قرار ت5: كل مزوّد تفريغ خلف هذا العقد الواحد، مفتاحه في `apps/api/.env` وحده.
 * قروك اليوم، محلي (faster-whisper) للمؤسسة لاحقًا — بلا تغيير كود المستدعي.
 */
export interface SttProvider {
  readonly name: string
  transcribe(
    audio: Uint8Array,
    /** language غيابها = كشف تلقائي (القرار المقيس 2026-08-30: فرض ar هلوس على غير العربي) */
    opts: { mimeType: string; language?: string },
  ): Promise<TranscriptSegment[]>
}
