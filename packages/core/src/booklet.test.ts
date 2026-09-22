import { describe, expect, it } from 'vitest'
import {
  BOOKLET_MAX_BLOCKS,
  BOOKLET_MAX_EMBEDS,
  bookletOutline,
  canAddBlock,
  canAddEmbed,
  embedIdsOf,
} from './booklet'
import type { Step } from './guide'

const step = (over: Partial<Step>): Step => ({
  id: 's1',
  kind: 'click',
  title: '',
  target: {},
  sensitive: false,
  url: '',
  pageTitle: '',
  ts: 0,
  ...over,
})

describe('سقوف الكرّاسة — رفض صادق برسالة محددة', () => {
  it('يقبل تحت السقف ويرفض عنده برسالة تذكر الحد', () => {
    expect(canAddBlock(BOOKLET_MAX_BLOCKS - 1)).toEqual({ ok: true })
    const no = canAddBlock(BOOKLET_MAX_BLOCKS)
    expect(no.ok).toBe(false)
    expect(no.ok === false && no.reason).toContain('٣٠٠')
  })

  it('سقف الأدلة المضمّنة منفصل عن سقف الكتل', () => {
    expect(canAddEmbed(BOOKLET_MAX_EMBEDS - 1)).toEqual({ ok: true })
    expect(canAddEmbed(BOOKLET_MAX_EMBEDS).ok).toBe(false)
  })
})

describe('embedIdsOf — معرّفات الأدلة المضمّنة بترتيب ظهورها بلا تكرار', () => {
  it('يجمع المعرّفات ويسقط التكرار ويتجاهل الكتل الأخرى', () => {
    const steps = [
      step({ id: 'a', block: 'embed', embed: { guideId: 'g1', expanded: false } }),
      step({ id: 'b', block: 'text' }),
      step({ id: 'c', block: 'embed', embed: { guideId: 'g2', expanded: true } }),
      step({ id: 'd', block: 'embed', embed: { guideId: 'g1', expanded: false } }),
    ]
    expect(embedIdsOf(steps)).toEqual(['g1', 'g2'])
  })

  it('كرّاسة بلا تضمين تعطي مصفوفة فارغة لا undefined', () => {
    expect(embedIdsOf([step({ block: 'text' })])).toEqual([])
  })

  it('كتلة تضمين بلا حقل embed لا تُسقط الدالة', () => {
    expect(embedIdsOf([step({ block: 'embed' })])).toEqual([])
  })
})

describe('bookletOutline — الفهرس الجانبي من كتل العنوان', () => {
  it('يعيد العناوين بمعرّفاتها بترتيبها', () => {
    const steps = [
      step({ id: 'h1', block: 'header', title: 'التمهيد' }),
      step({ id: 't1', block: 'text' }),
      step({ id: 'h2', block: 'header', title: 'التنفيذ' }),
    ]
    expect(bookletOutline(steps)).toEqual([
      { id: 'h1', title: 'التمهيد' },
      { id: 'h2', title: 'التنفيذ' },
    ])
  })

  it('يسقط العنوان الفارغ فلا يظهر بند بلا نص', () => {
    expect(bookletOutline([step({ id: 'h', block: 'header', title: '  ' })])).toEqual([])
  })
})
