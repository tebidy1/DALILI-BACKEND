/** TRNS-01: محوّل قروك للترجمة — Chat Completions بنمط JSON، تقسيم 40 بندًا،
 *  إعادة محاولة واحدة عند JSON مشوه، والبند الغائب يُسقط (يرتد حقلُه للعربية).
 *  fetch محقون للاختبارات بلا شبكة — نمط stt/groq.ts حرفيًا. */
import { z } from 'zod'
import type { TranslateItem } from './payload'
import type { TranslateProvider } from './provider'

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'
/** قروك سحبت llama-3.3-70b-versatile — gpt-oss-120b هو الأقوى المتاح لهذا المفتاح (مُجرَّب حيًّا 2026-09-25) */
const DEFAULT_MODEL = 'openai/gpt-oss-120b'
const CHUNK = 40
const SYSTEM_PROMPT =
  'You are a professional translator for workplace standard-operating-procedure content, Arabic to English. ' +
  'Translate each value faithfully and concisely. Step titles: short imperative. ' +
  'Keep numbers, URLs, product names, and on-screen UI labels as written. No additions, no notes. ' +
  'Reply with a single JSON object mapping each id to its English translation string.'

const zTranslationJson = z.record(z.string(), z.unknown())

/** يقرأ سجل id→نص من رد الموديل ويسقط ما ليس نصًا مفيدًا */
export function parseGroqTranslation(json: unknown): Array<{ id: string; text: string }> {
  const parsed = zTranslationJson.safeParse(json)
  if (!parsed.success) return []
  const out: Array<{ id: string; text: string }> = []
  for (const [id, v] of Object.entries(parsed.data)) {
    if (typeof v === 'string' && v.trim()) out.push({ id, text: v })
  }
  return out
}

interface ChatJson {
  choices?: Array<{ message?: { content?: string } }>
}

export function createGroqTranslateProvider(cfg: {
  apiKey: string
  model?: string
  fetchImpl?: typeof fetch
}): TranslateProvider {
  const model = cfg.model ?? DEFAULT_MODEL
  const doFetch = cfg.fetchImpl ?? fetch

  async function post(body: string): Promise<string | undefined> {
    const res = await doFetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`فشل الترجمة من قروك (${res.status}) — ${text.slice(0, 200)}`)
    }
    const json = (await res.json()) as ChatJson
    return json.choices?.[0]?.message?.content
  }

  /** فك محتوى الرد — يرد أزواجًا صالحة، وإعادتها فارغة تعني JSON مشوه يستفز الإعادة */
  function parseContent(content: string | undefined): Array<{ id: string; text: string }> {
    try {
      return parseGroqTranslation(JSON.parse(content ?? ''))
    } catch {
      return []
    }
  }

  async function callChunk(chunk: TranslateItem[]): Promise<Array<{ id: string; text: string }>> {
    const body = JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(Object.fromEntries(chunk.map((i) => [i.id, i.text]))) },
      ],
    })
    let pairs = parseContent(await post(body))
    if (pairs.length === 0) {
      pairs = parseContent(await post(body)) // إعادة واحدة — الموديل قد يتجاوز JSON مرة
    }
    const wanted = new Set(chunk.map((i) => i.id))
    return pairs.filter((p) => wanted.has(p.id))
  }

  return {
    name: `groq:${model}`,
    async translate({ items }) {
      const out: Array<{ id: string; text: string }> = []
      for (let i = 0; i < items.length; i += CHUNK) {
        out.push(...(await callChunk(items.slice(i, i + CHUNK))))
      }
      return out
    },
  }
}
