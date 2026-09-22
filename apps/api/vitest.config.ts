import { defineConfig } from 'vitest/config'

// bcrypt والبذر الثقيل يتجاوزان 5ث الافتراضية تحت الحمل المتوازي للمساحة —
// مهلة أوسع لا تخفي شيئًا: الفشل يبقى فشلًا داخل 20ث
export default defineConfig({
  test: {
    testTimeout: 20000,
  },
})
