import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'
import type Database from 'better-sqlite3'

/**
 * EXAM-01: تغذية بنك الأسئلة من seed/*.json — صيانة إقلاع متكررة (نمط purgeExpiredTrash)
 * لا ترحيلًا: البذور محتوى قد يكتمل بعد تطبيق السكيمة، فالفحص «البنك فارغ؟» هو حاجز
 * التكرار. ملء البنك لاحقًا = إضافة ملفات أو أداة استيراد — لا يُعاد زرع بنك غير فارغ.
 */

interface SeedQuestion {
  domain: string
  difficulty?: number
  stem: string
  options: string[]
  answerIndex: number
  explanationAr?: string
}

const SEED_PARTS = ['oeem-part1.json', 'oeem-part2.json', 'oeem-part3.json', 'oeem-part4.json']

export function seedExamIfEmpty(sqlite: Database.Database): void {
  const existing = (sqlite.prepare('SELECT count(*) AS c FROM exam_questions').get() as { c: number }).c
  if (existing > 0) return
  const insert = sqlite.prepare(
    `INSERT INTO exam_questions (id, domain, difficulty, stem, options, answer_index, explanation_ar, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  )
  // ذرّية: بنك ناقص من إقلاع انقطع أسوأ من بنك فارغ — الكل أو لا شيء
  sqlite.transaction(() => {
    for (const part of SEED_PARTS) {
      let raw: string
      try {
        raw = readFileSync(fileURLToPath(new URL(`./seed/${part}`, import.meta.url)), 'utf8')
      } catch {
        // ملف بذور غائب — لا يُسقط الإقلاع، البنك يعمل بما توفر
        continue
      }
      let items: SeedQuestion[]
      try {
        items = JSON.parse(raw) as SeedQuestion[]
      } catch {
        continue
      }
      for (const q of items) {
        if (!q || typeof q.stem !== 'string' || !Array.isArray(q.options)) continue
        if (typeof q.answerIndex !== 'number' || q.answerIndex < 0 || q.answerIndex >= q.options.length) continue
        insert.run(
          'eq' + nanoid(16),
          String(q.domain),
          Number(q.difficulty) || 2,
          q.stem,
          JSON.stringify(q.options),
          q.answerIndex,
          String(q.explanationAr ?? ''),
        )
      }
    }
  })()
}
