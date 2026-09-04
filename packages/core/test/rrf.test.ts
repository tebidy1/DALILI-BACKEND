import { describe, expect, it } from 'vitest'
import { fuseRanked, relativeCutoff } from '../src/rrf'

describe('fuseRanked — دمج المراكز لا الدرجات', () => {
  it('الدليل الموجود في القائمتين يتقدم على من في واحدة', () => {
    const fused = fuseRanked(['a', 'b', 'c'], ['b', 'd'])
    expect([...fused.keys()][0]).toBe('b') // مركز 1 دلاليًا + مركز 1 حرفيًا
  })
  it('خلو الحرفي يُبقي الدلالي وحده مرتبًا كما هو', () => {
    const fused = fuseRanked(['x', 'y'], [])
    expect([...fused.keys()]).toEqual(['x', 'y'])
  })
  it('الوزن الدلالي يرفع وصول الدلالي فقط عند التعادل', () => {
    const even = fuseRanked(['a', 'z'], ['b', 'a'])
    const boosted = fuseRanked(['a', 'z'], ['b', 'a'], { semanticWeight: 3 })
    expect(even.get('a')!).toBeGreaterThan(even.get('b')!) // a في القائمتين يفوز أصلًا
    expect(boosted.get('a')!).toBeGreaterThan(even.get('a')!) // والوزن يرفعه أكثر
  })
})

describe('relativeCutoff — فجوة الثقة', () => {
  const scores = new Map([['a', 0.9], ['b', 0.88], ['c', 0.3]])
  it('يبقي المتقارب مع القمة ويقصّ الهابط', () => {
    expect(relativeCutoff(['a', 'b', 'c'], scores, 0.5)).toEqual(['a', 'b'])
  })
  it('قائمة منبسطة لا تُقص (كلها متقاربة)', () => {
    const flat = new Map([['a', 0.85], ['b', 0.84], ['c', 0.83]])
    expect(relativeCutoff(['a', 'b', 'c'], flat, 0.5)).toEqual(['a', 'b', 'c'])
  })
  it('قائمة فارغة تبقى فارغة', () => {
    expect(relativeCutoff([], new Map())).toEqual([])
  })
})
