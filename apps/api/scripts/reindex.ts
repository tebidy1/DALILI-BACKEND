import { loadEnv } from '../src/env'
import { createDb } from '../src/db/client'
import { rebuildIndex } from '../src/search/index'

/**
 * إعادة بناء فهرس البحث كاملًا من guides.data.
 * إلزامية بعد أي تغيير في normalizeFa/lightStem أو الأوزان — وتُوثَّق في ملاحظات الإصدار.
 * تشغيل: pnpm --filter @dalili/api reindex
 */
const env = loadEnv()
const { sqlite, db } = createDb(env.dataDir)
// فتح درizzle فقط لإبقاء الاتصال حيًّا خلال العملية
void db
const { guides, rows } = rebuildIndex(sqlite)
console.log(`أُعيد بناء الفهرس: ${guides} دليلًا → ${rows} صفًا مفهرسًا`)
sqlite.close()
