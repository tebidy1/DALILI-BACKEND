import fs from 'node:fs'

/**
 * OPS-02: فحص الجهوزية — يفصل «العملية حية» (/health) عن «قادرة على الخدمة» (/ready):
 * القاعدة تجيب والقرص يقبل الكتابة. فشل أيهما = 503 برسالة عربية، لا استمرار خادع.
 */

export interface ReadyCheck {
  ok: boolean
  errorAr?: string
}

interface MinimalSqlite {
  prepare(sql: string): { get(...params: unknown[]): unknown }
}

export function checkReady(sqlite: MinimalSqlite, filesDir: string): ReadyCheck {
  try {
    const row = sqlite.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined
    if (!row || row.ok !== 1) {
      return { ok: false, errorAr: 'الخدمة غير جاهزة — قاعدة البيانات لا تجيب' }
    }
  } catch {
    return { ok: false, errorAr: 'الخدمة غير جاهزة — قاعدة البيانات لا تجيب' }
  }
  try {
    fs.accessSync(filesDir, fs.constants.W_OK)
  } catch {
    return { ok: false, errorAr: 'الخدمة غير جاهزة — مجلد الملفات غير قابل للكتابة' }
  }
  return { ok: true }
}
