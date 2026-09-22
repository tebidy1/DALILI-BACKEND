import type { TranscriptSegment } from '@dalili/core'
import type { SttProvider } from './provider'

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
/** قرار د1: الأرخص أولًا (‏$0.04/ساعة، 4–9× أرخص) → قياس WER قبل الترقية */
const DEFAULT_MODEL = 'whisper-large-v3-turbo'

interface GroqSegment {
  start?: unknown
  end?: unknown
  text?: unknown
}

/**
 * verbose_json من Groq/OpenAI: `segments[]` بثوانٍ. نحوّلها لمقاطع core (ms).
 * بلا مقاطع لكن بنص كامل → مقطع واحد عند الصفر؛ بلا شيء → لا مقاطع (لا اختراع كلام).
 */
export function parseGroqSegments(json: unknown): TranscriptSegment[] {
  const obj = (json ?? {}) as { text?: unknown; segments?: unknown }
  const raw = Array.isArray(obj.segments) ? (obj.segments as GroqSegment[]) : []
  if (raw.length > 0) {
    const out: TranscriptSegment[] = []
    for (const s of raw) {
      const text = typeof s.text === 'string' ? s.text.trim() : ''
      if (!text) continue
      const startSec = typeof s.start === 'number' ? s.start : 0
      out.push({ startMs: Math.round(startSec * 1_000), text })
    }
    return out
  }
  const whole = typeof obj.text === 'string' ? obj.text.trim() : ''
  return whole ? [{ startMs: 0, text: whole }] : []
}

/** VOX-04: محوّل قروك خلف عقد SttProvider — fetch محقون للاختبار بلا شبكة */
export function createGroqSttProvider(cfg: {
  apiKey: string
  model?: string
  fetchImpl?: typeof fetch
}): SttProvider {
  const model = cfg.model ?? DEFAULT_MODEL
  const doFetch = cfg.fetchImpl ?? fetch
  return {
    name: `groq:${model}`,
    async transcribe(audio, opts) {
      const form = new FormData()
      // Uint8Array صالح BlobPart وقت التشغيل؛ صرامة تباين ArrayBuffer في TS تحتاج التمرير الصريح
      form.append('file', new Blob([audio as BlobPart], { type: opts.mimeType }), 'audio.webm')
      form.append('model', model)
      // القرار المقيس 2026-08-30: بلا لغة = كشف تلقائي — فرضها كان يهلوس نصًا عربيًا على صوت غير عربي
      if (opts.language) form.append('language', opts.language)
      form.append('response_format', 'verbose_json')
      const res = await doFetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: form,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`فشل التفريغ من قروك (${res.status}) — ${body.slice(0, 200)}`)
      }
      return parseGroqSegments(await res.json())
    },
  }
}
