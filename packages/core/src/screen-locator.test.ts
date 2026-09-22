import { describe, expect, it } from 'vitest'
import { urlTokens, rankDiscover, type DiscoverCandidate } from './screen-locator'

/** SRCH-04 تطوّر: المُجزّئ الموحّد بين الفهرس والامتداد — رموز الشاشة بلا الأجزاء المتغيّرة */
describe('urlTokens', () => {
  it('مسار عادي → المضيف بمسافات ورموز المسار', () => {
    const r = urlTokens('https://erp.example.com/sales/orders?page=2')
    expect(r.host).toBe('erp example com')
    expect(r.screen).toContain('sales')
    expect(r.screen).toContain('orders')
    // رقم الصفحة متغيّر — يُسقط
    expect(r.screen).not.toContain('2')
  })

  it('أودو hash: هوية الشاشة في الـhash تدخل الرموز', () => {
    const r = urlTokens('https://odoo.corp.sa/web#action=311&model=sale.order&view_type=list&id=42')
    expect(r.screen).toEqual(expect.arrayContaining(['web', 'model', 'sale', 'order', 'view', 'type']))
    // الأرقام المتغيّرة (action id، السجل) تُسقط
    expect(r.screen).not.toContain('311')
    expect(r.screen).not.toContain('42')
  })

  it('يُسقط التوكنات الطويلة والـhex الطويل (رموز جلسة/سجل)', () => {
    const r = urlTokens('https://app.sa/orders/a1b2c3d4e5f6/edit?token=abcdef0123456789abcdef')
    expect(r.screen).toContain('orders')
    expect(r.screen).toContain('edit')
    expect(r.screen).not.toContain('a1b2c3d4e5f6') // hex طويل
    expect(r.screen).not.toContain('abcdef0123456789abcdef') // توكن طويل
  })

  it('غير http (chrome/about) → مضيف فارغ', () => {
    expect(urlTokens('chrome://extensions/').host).toBe('')
    expect(urlTokens('about:blank').host).toBe('')
  })
})

function cand(id: string, urlText: string, views: number, updatedAt = '2026-01-01T00:00:00Z'): DiscoverCandidate {
  return { id, title: `دليل ${id}`, updatedAt, views, urlText }
}

/** SRCH-04 تطوّر: القسمة لمجموعتين والترتيب بالمشاهدات */
describe('rankDiscover', () => {
  const host = ['erp', 'example', 'com']

  it('يفصل أدلة الشاشة عن أدلة الموقع بتطابق رمز شاشة', () => {
    const cands = [
      cand('a', 'erp example com sales orders', 3),
      cand('b', 'erp example com purchases', 5), // موقع فقط — لا يطابق شاشة المبيعات
    ]
    const { onScreen, onSite } = rankDiscover(cands, ['sales', 'orders'], host, 5)
    expect(onScreen.map((g) => g.id)).toEqual(['a'])
    expect(onSite.map((g) => g.id)).toEqual(['b'])
  })

  it('داخل المجموعة: الأكثر مشاهدة أولًا', () => {
    const cands = [
      cand('low', 'erp example com sales', 2),
      cand('high', 'erp example com sales', 40),
      cand('mid', 'erp example com sales', 10),
    ]
    const { onScreen } = rankDiscover(cands, ['sales'], host, 5)
    expect(onScreen.map((g) => g.id)).toEqual(['high', 'mid', 'low'])
  })

  it('رموز المضيف لا تُحسب تطابق شاشة — وإلا كل الموقع «شاشة»', () => {
    const cands = [cand('x', 'erp example com dashboard', 1)]
    // رموز الشاشة الحالية = المضيف فقط (صفحة جذر) → لا تطابق شاشة
    const { onScreen, onSite } = rankDiscover(cands, [], host, 5)
    expect(onScreen).toHaveLength(0)
    expect(onSite.map((g) => g.id)).toEqual(['x'])
  })
})
