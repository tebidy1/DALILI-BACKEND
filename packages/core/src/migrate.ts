/**
 * DTOP-01: الترحيل الكسول ١→٢ — دليل v1 مسطّح (url/pageTitle على الخطوة) يصير v2
 * بمصدر صريح لكل خطوة ذات رابط، وv2 تمرّ كما هي (idempotent).
 * نقية بلا zod: تُستدعى عند القراءة قبل فحص العقد. الغريب الشكل يُرفض بـnull — لا يُخترع دليل.
 * الخطوة بلا رابط (أو برابط فارغ) تبقى بلا source: هويتها تصير من مصدرها إن جاء لاحقًا.
 */
export function migrateGuide(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null) return null
  const guide = raw as Record<string, unknown>
  if (!Array.isArray(guide.steps)) return null
  const steps = guide.steps.map((step) => {
    if (typeof step !== 'object' || step === null) return step
    const s = step as Record<string, unknown>
    if (s.source || typeof s.url !== 'string' || s.url.trim() === '') return s
    return {
      ...s,
      source: { kind: 'web', url: s.url, pageTitle: typeof s.pageTitle === 'string' ? s.pageTitle : '' },
    }
  })
  return { ...guide, schemaVersion: 2, steps }
}
