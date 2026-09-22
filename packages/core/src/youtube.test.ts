import { describe, expect, it } from 'vitest'
import { youtubeEmbedUrl, youtubeId, youtubeWatchUrl } from './youtube'

describe('youtubeId — قراءة معرّف الفيديو (BKL-06)', () => {
  it('يقرأ الصيغ الخمس التي يلصقها الناس فعلًا', () => {
    const id = 'dQw4w9WgXcQ'
    expect(youtubeId(`https://www.youtube.com/watch?v=${id}`)).toBe(id)
    expect(youtubeId(`https://youtu.be/${id}`)).toBe(id)
    expect(youtubeId(`https://www.youtube.com/embed/${id}`)).toBe(id)
    expect(youtubeId(`https://www.youtube.com/shorts/${id}`)).toBe(id)
    expect(youtubeId(`https://m.youtube.com/watch?v=${id}&t=42s`)).toBe(id)
  })

  it('يتجاهل المسافات حول الرابط الملصوق', () => {
    expect(youtubeId('  https://youtu.be/dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ')
  })

  // الحارس الأمني: الإطار لا يُبنى إلا من مضيف يوتيوب ومعرّف مطابق حرفيًّا
  it('يرفض أي مضيف آخر ولو حمل نمط يوتيوب', () => {
    expect(youtubeId('https://evil.example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(youtubeId('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull()
  })

  it('يرفض البروتوكولات الخطرة والقيم المشوّهة', () => {
    expect(youtubeId('javascript:alert(1)')).toBeNull()
    expect(youtubeId('data:text/html,<script>')).toBeNull()
    expect(youtubeId('https://www.youtube.com/watch?v=<script>')).toBeNull()
    expect(youtubeId('https://www.youtube.com/watch?v=short')).toBeNull()
    expect(youtubeId('ليس رابطًا')).toBeNull()
    expect(youtubeId(undefined)).toBeNull()
  })

  it('رابط التضمين nocookie دائمًا ومن معرّف متحقَّق منه', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0',
    )
    expect(youtubeEmbedUrl('dQw4w9WgXcQ', false)).toContain('?rel=0')
    expect(youtubeEmbedUrl('dQw4w9WgXcQ')).not.toContain('youtube.com/embed')
  })

  it('رابط المشاهدة للتصدير والطباعة', () => {
    expect(youtubeWatchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })
})
