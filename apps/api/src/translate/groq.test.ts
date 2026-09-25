import { describe, expect, it } from 'vitest'
import { createGroqTranslateProvider, parseGroqTranslation } from './groq'

const okRes = (obj: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }),
})

describe('parseGroqTranslation', () => {
  it('يقرأ سجل id→نص ويسقط غير النص والفراغ', () => {
    expect(parseGroqTranslation({ a: 'Hello', b: 5, c: '  ', d: null })).toEqual([{ id: 'a', text: 'Hello' }])
  })
})

describe('createGroqTranslateProvider', () => {
  it('نداء ناجح: JSON mode + system prompt + يعيد البنود المطلوبة حصرًا', async () => {
    const calls: Array<{ url: unknown; body: string }> = []
    const p = createGroqTranslateProvider({
      apiKey: 'k',
      fetchImpl: async (url, init) => {
        calls.push({ url, body: String(init!.body) })
        return okRes({ title: 'Open the app', ghost: 'لا يُطلب' }) as never
      },
    })
    const out = await p.translate({ items: [{ id: 'title', text: 'افتح' }], target: 'en' })
    expect(out).toEqual([{ id: 'title', text: 'Open the app' }])
    expect(calls).toHaveLength(1)
    expect(String(calls[0]!.url)).toContain('api.groq.com/openai/v1/chat/completions')
    const body = JSON.parse(calls[0]!.body)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].role).toBe('system')
    expect(JSON.parse(body.messages[1].content)).toEqual({ title: 'افتح' })
  })

  it('التقسيم: 85 بندًا ⇒ 3 نداءات (40+40+5) بلا إعادة محاولة', async () => {
    let n = 0
    const p = createGroqTranslateProvider({
      apiKey: 'k',
      fetchImpl: async (_url, init) => {
        n++
        // يرد بترجمة كل المعرفات المطلوبة كي لا يستفز إعادة المحاولة
        const asked = Object.keys(JSON.parse(JSON.parse(String(init!.body)).messages[1].content))
        return okRes(Object.fromEntries(asked.map((id) => [id, `X-${id}`]))) as never
      },
    })
    const items = Array.from({ length: 85 }, (_, i) => ({ id: `k${i}`, text: `t${i}` }))
    const out = await p.translate({ items, target: 'en' })
    expect(n).toBe(3)
    expect(out).toHaveLength(85)
    expect(out[84]).toEqual({ id: 'k84', text: 'X-k84' })
  })

  it('JSON مشوه ⇒ محاولة أصلية + إعادة واحدة ثم يُسقط البند بصمت (يرتد للعربية)', async () => {
    let n = 0
    const p = createGroqTranslateProvider({
      apiKey: 'k',
      fetchImpl: async () => {
        n++
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ليس json' } }] }) } as never
      },
    })
    const out = await p.translate({ items: [{ id: 'a', text: 'x' }], target: 'en' })
    expect(out).toEqual([])
    expect(n).toBe(2)
  })

  it('فشل HTTP من المزوّد يرمي خطأ عربيًا', async () => {
    const p = createGroqTranslateProvider({
      apiKey: 'k',
      fetchImpl: (async () => ({ ok: false, status: 429, text: async () => 'rate' })) as never,
    })
    await expect(p.translate({ items: [{ id: 'a', text: 'x' }], target: 'en' })).rejects.toThrow('قروك')
  })
})
