import { describe, expect, it } from 'vitest'
import { createGroqSttProvider, parseGroqSegments } from '../src/stt/groq'

/**
 * VOX-04: مزوّد التفريغ خلف عقد واحد (قرار ت5). المُحلِّل نقي؛ المزوّد يُختبر بـfetch محقون
 * بلا شبكة حقيقية — الإثبات الحي ضد قروك يجري منفصلًا في live-vox.mjs.
 */

describe('parseGroqSegments', () => {
  it('يحوّل مقاطع verbose_json (ثوانٍ) إلى مقاطع core (ms) مع تقليم النص', () => {
    const json = {
      text: 'كامل',
      segments: [
        { start: 0, end: 1.5, text: ' افتح القائمة ' },
        { start: 1.5, end: 3.2, text: 'اضغط الزر' },
      ],
    }
    expect(parseGroqSegments(json)).toEqual([
      { startMs: 0, text: 'افتح القائمة' },
      { startMs: 1_500, text: 'اضغط الزر' },
    ])
  })

  it('بلا مصفوفة مقاطع لكن بنص كامل → مقطع واحد عند الصفر', () => {
    expect(parseGroqSegments({ text: 'الشرح كله' })).toEqual([{ startMs: 0, text: 'الشرح كله' }])
  })

  it('استجابة بلا نص ولا مقاطع → لا مقاطع (لا اختراع كلام)', () => {
    expect(parseGroqSegments({})).toEqual([])
    expect(parseGroqSegments({ text: '   ' })).toEqual([])
  })
})

describe('createGroqSttProvider', () => {
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])

  it('بلا لغة (الكشف التلقائي — القرار المقيس 2026-08-30): لا حقل language إطلاقًا', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ segments: [{ start: 0, end: 1, text: 'مرحبًا' }] }), {
        status: 200,
      })
    }) as unknown as typeof fetch
    const p = createGroqSttProvider({ apiKey: 'k-test', fetchImpl: fakeFetch })
    const segs = await p.transcribe(webm, { mimeType: 'audio/webm' })

    expect(segs).toEqual([{ startMs: 0, text: 'مرحبًا' }])
    expect(calls[0]!.url).toContain('groq.com')
    const form = calls[0]!.init.body as FormData
    expect(form.has('language')).toBe(false) // فرض ar هلوس على غير العربي — ممنوع
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer k-test')
    expect(p.name).toContain('groq')
  })

  it('لغة صريحة عند طلبها تُرسل كما هي', async () => {
    const calls: Array<{ init: RequestInit }> = []
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      calls.push({ init })
      return new Response(JSON.stringify({ text: 'hi' }), { status: 200 })
    }) as unknown as typeof fetch
    const p = createGroqSttProvider({ apiKey: 'k', fetchImpl: fakeFetch })
    await p.transcribe(webm, { mimeType: 'audio/webm', language: 'en' })
    expect((calls[0]!.init.body as FormData).get('language')).toBe('en')
  })

  it('فشل الشبكة (401) → خطأ عربي يحمل رمز الحالة — لا فشل صامت', async () => {
    const fakeFetch = (async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch
    const p = createGroqSttProvider({ apiKey: 'bad', fetchImpl: fakeFetch })
    await expect(p.transcribe(webm, { mimeType: 'audio/webm', language: 'ar' })).rejects.toThrow(/401/)
  })
})
