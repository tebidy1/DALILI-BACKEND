import { describe, expect, it } from 'vitest'
import { makeFileSigner, ORIGINAL_TTL_S, SHARE_TTL_S } from '../src/lib/file-cap'

const T0 = Date.UTC(2026, 8, 15, 10, 0, 0)
const parse = (url: string) => {
  const u = new URL(url, 'http://x')
  return { id: u.pathname.split('/').pop()!, q: Object.fromEntries(u.searchParams) as Record<string, string> }
}

describe('روابط الملفّات الموقَّعة', () => {
  it('رابط الأصل يُتحقَّق منه وينتهي عند حدّ اليوم + ٧ أيّام', () => {
    const s = makeFileSigner('secret-1234567890', () => T0)
    const { id, q } = parse(s.original('abcDEF12345'))
    expect(id).toBe('abcDEF12345')
    expect(Number(q.e)).toBe(Date.UTC(2026, 8, 16) / 1000 + ORIGINAL_TTL_S)
    expect(s.verify(id, q)).toEqual({ ok: true })
  })

  it('الرابط ثابت طوال اليوم نفسه (كاش المتصفّح يعمل)', () => {
    const a = makeFileSigner('secret-1234567890', () => T0).original('abcDEF12345')
    const b = makeFileSigner('secret-1234567890', () => T0 + 5 * 3600_000).original('abcDEF12345')
    expect(a).toBe(b)
  })

  it('رابط المشاركة يحمل الرمز ويعيده عند التحقّق', () => {
    const s = makeFileSigner('secret-1234567890', () => T0)
    const { id, q } = parse(s.shared('abcDEF12345', 'tok_12345678'))
    expect(Number(q.e)).toBe(Date.UTC(2026, 8, 16) / 1000 + SHARE_TTL_S)
    expect(s.verify(id, q)).toEqual({ ok: true, share: 'tok_12345678' })
  })

  it('يُرفض: معرّف آخر · توقيع معدَّل · رمز مُزال · انتهاء · سرّ آخر · حقول ناقصة', () => {
    const s = makeFileSigner('secret-1234567890', () => T0)
    const { id, q } = parse(s.shared('abcDEF12345', 'tok_12345678'))
    expect(s.verify('otherID12345', q).ok).toBe(false)
    expect(s.verify(id, { ...q, c: q.c!.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')) }).ok).toBe(false)
    expect(s.verify(id, { e: q.e, c: q.c }).ok).toBe(false)
    const late = makeFileSigner('secret-1234567890', () => T0 + 3 * 86400_000)
    expect(late.verify(id, q).ok).toBe(false)
    expect(makeFileSigner('another-secret-123', () => T0).verify(id, q).ok).toBe(false)
    expect(s.verify(id, {}).ok).toBe(false)
    expect(s.verify(id, { e: 'NaN', c: q.c }).ok).toBe(false)
  })
})

// علّة 2026-09-30 (بلاغ المالك «اللقطات لا تظهر في الدليل»، وتشمل الإضافة):
// الرابط كان نسبيًّا دائمًا، والعمارة تفترض أنّ الويب والـAPI أصلٌ واحد
// (‏DEPLOYMENT.md §٢١٨). بعد فصل الدومينين صار `/files/<id>` يُحلّ على أصل
// **الويب** فيردّ صفحة HTML لا صورة ⇒ `img.onload` لا يقع ⇒ لوحةٌ فارغة.
// العلاج في موضعٍ واحد: الخادم يوقّع **مطلقًا** من `PUBLIC_BASE` — فيُصلح
// كلّ عميل (ويب · إضافة · ديسكتوب) بلا إعادة بناء أيٍّ منها.
describe('قاعدة الخادم في رابط الملفّ (فصل دومين الويب عن الـAPI)', () => {
  it('الرابط يخرج مطلقًا بقاعدة الخادم — أصلًا وحصّةً', () => {
    const s = makeFileSigner('secret-1234567890', () => T0, 'https://apidaleel.example.com')
    expect(s.original('abcDEF12345')).toMatch(
      /^https:\/\/apidaleel\.example\.com\/files\/abcDEF12345\?/,
    )
    expect(s.shared('abcDEF12345', 'tok_12345678')).toMatch(
      /^https:\/\/apidaleel\.example\.com\/files\/abcDEF12345\?/,
    )
  })

  it('التوقيع لا يشمل المضيف — نقلُ الدومين لا يُبطل رابطًا موقَّعًا', () => {
    const withBase = makeFileSigner('secret-1234567890', () => T0, 'https://apidaleel.example.com')
    const { id, q } = parse(withBase.original('abcDEF12345'))
    expect(withBase.verify(id, q)).toEqual({ ok: true })
    // الحارس نفسه بلا قاعدة يقبل التوقيع — البصمة على المعرّف والانتهاء فقط
    expect(makeFileSigner('secret-1234567890', () => T0).verify(id, q)).toEqual({ ok: true })
  })

  it('شرطةٌ مائلة زائدة في القاعدة لا تُنتج «//files»', () => {
    const s = makeFileSigner('secret-1234567890', () => T0, 'https://apidaleel.example.com/')
    expect(s.original('abcDEF12345')).toMatch(/^https:\/\/apidaleel\.example\.com\/files\//)
  })

  it('بلا قاعدة يبقى نسبيًّا — نشرُ الأصل الواحد لا يتغيّر سلوكه', () => {
    const s = makeFileSigner('secret-1234567890', () => T0)
    expect(s.original('abcDEF12345')).toMatch(/^\/files\/abcDEF12345\?/)
  })
})
