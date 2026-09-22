/**
 * DTOP-04: أصول CORS المسموحة من الإعدادات — الافتراضي يطابق سلوك ما قبلها،
 * مع تضييق واحد: «أيّ امتداد» صار «أيّ معرّف امتداد بصيغته الحقيقيّة» (٣٢ حرفًا a-p).
 */
export const DEFAULT_CORS_ORIGINS = 'chrome-extension://*,http://localhost:5174,http://127.0.0.1:5174'

const ANY_EXTENSION = /^chrome-extension:\/\/[a-p]{32}$/
const WEB_ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i

export function parseCorsOrigins(raw: string | undefined): Array<string | RegExp> {
  const items = (raw ?? DEFAULT_CORS_ORIGINS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (items.length === 0) throw new Error('قيمة بيئة غير صالحة (CORS_ORIGINS) في .env — القائمة فارغة')
  return items.map((item) => {
    if (item === 'chrome-extension://*') return ANY_EXTENSION
    if (ANY_EXTENSION.test(item) || WEB_ORIGIN.test(item)) return item
    throw new Error(`قيمة بيئة غير صالحة (CORS_ORIGINS) في .env — «${item}» ليس أصلًا صالحًا`)
  })
}
