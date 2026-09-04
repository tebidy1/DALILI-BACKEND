import type { EmbeddingProvider } from './provider'

/**
 * SRCH-06: المزوّد المحلي — multilingual-e5-small عبر transformers.js/onnxruntime:
 * بلا مفتاح، بلا كلفة، وبلا خروج أي بيانات من الخادم (إقامة كاملة PLAT-04).
 * الاستيراد ديناميكي كي لا يُحمَّل onnxruntime في الوحدات التي لا تطلب التضمين (اختبارات).
 * بادئات e5 ملزمة: «query:» للاستعلام و«passage:» للأدلة، مع تطبيع L2.
 * فشل تحميل النموذج يبقى معلنًا حتى إعادة التشغيل — كل بحث يعيد رسالة الصدق ولا مطاردة تنزيل فاشل.
 */

const DEFAULT_MODEL = 'Xenova/multilingual-e5-small'

/** زمن انتظار جاهزية النموذج في مسار البحث — بعده سبب عربي صادق والتحميل يكمل خلفه */
export const QUERY_READY_TIMEOUT_MS = 8_000

export class ModelNotReadyError extends Error {
  constructor() {
    super('البحث بالمعنى يجهّز نفسه الآن (تحميل النموذج الأول) — أعد المحاولة بعد لحظات')
    this.name = 'ModelNotReadyError'
  }
}

type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): unknown }>

export function createLocalEmbeddingProvider(cfg: {
  modelsDir: string
  model?: string
}): EmbeddingProvider {
  const model = cfg.model ?? DEFAULT_MODEL
  let extractor: Promise<Extractor> | null = null

  function ensure(): Promise<Extractor> {
    if (!extractor) {
      extractor = (async () => {
        const tf = await import('@huggingface/transformers')
        tf.env.cacheDir = cfg.modelsDir
        tf.env.allowLocalModels = false
        const pipe = await tf.pipeline('feature-extraction', model, { dtype: 'q8' })
        return pipe as unknown as Extractor
      })()
      // رفض مخزَّن عمدًا: من لم ينتظره لا يُسقط العملية بانفجار غير معالَج
      extractor.catch(() => {})
    }
    return extractor
  }

  async function embed(prefixed: string[], timeoutMs?: number): Promise<Float32Array[]> {
    let ex: Extractor
    if (timeoutMs !== undefined) {
      // مسار البحث لا يعلّق على تحميل أول — مهلة صادقة والتحميل يكمل خلفها
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new ModelNotReadyError()), timeoutMs)
      })
      try {
        ex = await Promise.race([ensure(), timeout])
      } finally {
        clearTimeout(timer)
      }
    } else {
      ex = await ensure()
    }
    const out = await ex(prefixed, { pooling: 'mean', normalize: true })
    const list = out.tolist() as number[][]
    return list.map((v) => new Float32Array(v))
  }

  return {
    name: `local-e5:${model}`,

    async embedPassages(texts) {
      if (texts.length === 0) return []
      return embed(texts.map((t) => `passage: ${t}`))
    },

    async embedQuery(text) {
      const [v] = await embed([`query: ${text}`], QUERY_READY_TIMEOUT_MS)
      return v ?? new Float32Array(0)
    },
  }
}
