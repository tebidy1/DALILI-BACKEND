import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_PATH = path.join(here, '..', 'src', 'db', 'migrations.ts')

/**
 * الترحيل سجلّ تاريخي: ما أنتجه يوم كُتب يجب أن ينتجه اليوم على قاعدة جديدة.
 * استيراد منطق حيّ من core يجعل تعديلًا مستقبليًّا في core يغيّر ترحيلًا ماضيًا
 * أثرًا رجعيًّا. المرحلة ١ ستعيد تسمية primarySiteOf وتوسّعه — فنقطع الخيط الآن.
 */
describe('تجميد الترحيلات', () => {
  it('migrations.ts لا يستورد من @dalili/core', () => {
    const src = fs.readFileSync(MIGRATIONS_PATH, 'utf8')
    expect(src).not.toMatch(/from\s+['"]@dalili\/core['"]/)
  })
})
