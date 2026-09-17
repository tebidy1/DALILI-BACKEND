import type {
  CommentResponseDto,
  CommentsResponseDto,
  CreateCommentDto,
  DiscoverResponseDto,
  FolderDto,
  GuideDetailsDto,
  GuideDto,
  GuideSummaryDto,
  ListGuidesDto,
  ListGuidesQuery,
  LibraryOverviewDto,
  MeDto,
  MineReportDto,
  PublicGuideDto,
  SearchResponseDto,
  ShareInfoDto,
  StepDto,
  TeamDto,
  TranscribeResultDto,
  TranscribeStepsResultDto,
  UpdateCommentDto,
  MemberDto,
  InviteMemberReq,
  UpdateMemberReq,
  InviteCreateReq,
  InviteDto,
  InviteInfoDto,
  AcceptInviteReq,
  ThemeChoiceDto,
  VersionSummaryDto,
  ListVersionsDto,
  GuideVersionDetailsDto,
  AssignedItemDto,
  AssignmentBoardDto,
  AssignTargetDto,
  DeviceDto,
  DevicePendingDto,
} from './contract'

export class DaliliApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DaliliApiError'
  }
}

interface ReqOpts {
  method?: string
  json?: unknown
  body?: BodyInit
  signal?: AbortSignal
}

/** عميل HTTP مطبوع — كل الفشل يُلقى برسالة عربية صادقة */
export class DaliliClient {
  constructor(private base = '') {}

  private async req<T>(path: string, opts: ReqOpts = {}): Promise<T> {
    let res: Response
    try {
      res = await fetch(this.base + path, {
        method: opts.method ?? (opts.json !== undefined || opts.body !== undefined ? 'POST' : 'GET'),
        credentials: 'include',
        headers: opts.json !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
        signal: opts.signal,
      })
    } catch (err) {
      // الإلغاء قرار المتصل لا فشل شبكة — لا نكذب عليه برسالة اتصال
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new DaliliApiError(0, 'تعذر الاتصال بالخادم — تأكد من تشغيله على المنفذ 8787')
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { errorAr?: string } | null
      throw new DaliliApiError(res.status, body?.errorAr ?? `فشل الطلب (${res.status})`)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  register(email: string, password: string) {
    return this.req<MeDto>('/api/auth/register', { json: { email, password } })
  }

  login(email: string, password: string) {
    return this.req<MeDto>('/api/auth/login', { json: { email, password } })
  }

  async logout() {
    await this.req<void>('/api/auth/logout', { method: 'POST' })
  }

  /** 401 → null (زائر)؛ فشل الشبكة يُلقى خطأً صادقًا */
  async me(): Promise<MeDto | null> {
    try {
      return await this.req<MeDto>('/api/auth/me')
    } catch (e) {
      if (e instanceof DaliliApiError && e.status === 401) return null
      throw e
    }
  }

  async uploadBlob(blob: Blob, filename = 'shot.jpg'): Promise<{ fileId: string; thumbFileId?: string; fileUrl: string; thumbUrl?: string }> {
    const fd = new FormData()
    fd.append('file', blob, filename)
    return this.req<{ fileId: string; thumbFileId?: string; fileUrl: string; thumbUrl?: string }>('/api/uploads', { body: fd })
  }

  listGuides(query: Partial<ListGuidesQuery> = {}, signal?: AbortSignal) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') qs.set(k, String(v))
    }
    const suffix = qs.size > 0 ? `?${qs.toString()}` : ''
    return this.req<ListGuidesDto>(`/api/guides${suffix}`, { signal })
  }

  listFolders(signal?: AbortSignal) {
    return this.req<FolderDto[]>('/api/folders', { signal })
  }

  /** المرحلة ب (الهوم): اسم المساحة ودوري والعدادات وأعلى المواقع — نداء واحد للشريط والإحصاءات */
  libraryOverview(signal?: AbortSignal) {
    return this.req<LibraryOverviewDto>('/api/library/overview', { signal })
  }

  /** مزامنة الثيم: كتابة الاختيار على الخادم — الامتداد يقرؤه عند إقلاعه التالي */
  async setMyTheme(theme: ThemeChoiceDto) {
    return this.req<{ myTheme: ThemeChoiceDto }>('/api/me/theme', { method: 'PUT', json: { theme } })
  }

  /** المرحلة ج (أنشئ بواسطي + التقارير): التقرير المجمّع لأدلتي — شريط أعلى الشاشة */
  myReport(signal?: AbortSignal) {
    return this.req<MineReportDto>('/api/reports/mine', { signal })
  }

  /** ASG: إسناد الدليل/الكرّاسة لأهداف متعددة بملاحظة اختيارية */
  assignGuide(id: string, targets: AssignTargetDto[], note?: string) {
    return this.req<{ created: number }>(`/api/guides/${id}/assign`, { json: { targets, note } })
  }

  deleteAssignment(assignmentId: string) {
    return this.req<void>(`/api/assignments/${assignmentId}`, { method: 'DELETE' })
  }

  /** ASG: «أُسند إليّ» — يحلّ (أنا/فريقي/المساحة) مع حالتي */
  listAssigned(signal?: AbortSignal) {
    return this.req<AssignedItemDto[]>('/api/assigned', { signal })
  }

  /** ASG: يضبط opened تلقائيًا؛ done=true/false يبدّل الإتمام */
  setAssignmentProgress(assignmentId: string, done?: boolean) {
    return this.req<{ openedAt: string; doneAt: string | null }>(`/api/assignments/${assignmentId}/progress`, {
      method: 'POST',
      json: done === undefined ? {} : { done },
    })
  }

  /** ASG: لوحة المُسنِد بالأسماء لدليل بعينه */
  guideAssignments(id: string, signal?: AbortSignal) {
    return this.req<AssignmentBoardDto>(`/api/guides/${id}/assignments`, { signal })
  }

  async createFolder(name: string) {
    return this.req<FolderDto>('/api/folders', { json: { name } })
  }

  async renameFolder(id: string, name: string) {
    return this.req<FolderDto>(`/api/folders/${id}`, { method: 'PATCH', json: { name } })
  }

  async deleteFolder(id: string) {
    await this.req<void>(`/api/folders/${id}`, { method: 'DELETE' })
  }

  async updateGuideMeta(id: string, meta: { folderId?: string | null; starred?: boolean; tags?: string[]; visibility?: 'private' | 'workspace' }) {
    return this.req<GuideSummaryDto>(`/api/guides/${id}/meta`, { method: 'PATCH', json: meta })
  }

  duplicateGuide(id: string) {
    return this.req<{ id: string }>(`/api/guides/${id}/duplicate`, { method: 'POST' })
  }

  async restoreGuide(id: string) {
    return this.req<GuideSummaryDto>(`/api/guides/${id}/restore`, { method: 'POST' })
  }

  createGuide(guide: GuideDto) {
    return this.req<{ id: string }>('/api/guides', { json: { guide } })
  }

  /** CAP-17: إضافة خطوات ملتقطة لدليل قائم — بالإدراج في موضع محدد أو النهاية */
  appendSteps(id: string, steps: StepDto[], insertAt?: number) {
    return this.req<{ id: string; stepCount: number }>(`/api/guides/${id}/steps`, {
      json: { steps, insertAt },
    })
  }

  getGuide(id: string, signal?: AbortSignal) {
    return this.req<GuideDetailsDto>(`/api/guides/${id}`, { signal })
  }

  async updateGuide(id: string, guide: GuideDto) {
    await this.req<void>(`/api/guides/${id}`, { method: 'PATCH', json: { guide } })
  }

  async deleteGuide(id: string, opts: { permanent?: boolean } = {}) {
    const suffix = opts.permanent ? '?permanent=1' : ''
    await this.req<void>(`/api/guides/${id}${suffix}`, { method: 'DELETE' })
  }

  /** VER-01: التقاط لقطة عند «تم» — الخادم يُسقط التكرار المتجاور فيرد 204 فنعيد null.
   *  الفشل غير الصامت (شبكة/خطأ صادق) يُلقى كـDaliliApiError برسالة عربية. */
  async createVersion(guideId: string): Promise<VersionSummaryDto | null> {
    const r = await this.req<VersionSummaryDto | undefined>(`/api/guides/${guideId}/versions`, { method: 'POST' })
    return r ?? null
  }

  /** VER-01: قائمة السجل — من الأحدث للأقدم، بلا حقل data (JSON قد يكون كبيرًا) */
  listVersions(guideId: string, signal?: AbortSignal) {
    return this.req<ListVersionsDto>(`/api/guides/${guideId}/versions`, { signal })
  }

  /** VER-01: تفاصيل نسخة كاملة — الشكل يمرّ عبر عارض القراءة القائم بلا فرع خاص */
  getVersion(guideId: string, versionId: string, signal?: AbortSignal) {
    return this.req<GuideVersionDetailsDto>(`/api/guides/${guideId}/versions/${versionId}`, { signal })
  }

  createShare(id: string) {
    return this.req<ShareInfoDto>(`/api/guides/${id}/share`, { method: 'POST' })
  }

  /** VOX-05: يفرّغ صوت الدليل لكل خطوة — بلا apply اقتراحات (زر المحرر)، ومع apply تُملأ
   *  الملاحظات الفارغة خادميًا (الوضع التلقائي بعد النشر — قرار المالك 2026-08-30). الفشل يُلقى برسالة عربية */
  transcribeGuide(id: string, opts: { apply?: boolean; signal?: AbortSignal } = {}) {
    return this.req<TranscribeResultDto>(`/api/guides/${id}/transcribe`, {
      method: 'POST',
      json: { apply: opts.apply ?? false },
      signal: opts.signal,
    })
  }

  /** VOX-09: تفريغ تعليقات الخطوات الصوتية (ميك الخطوة) — يملأ الملاحظة الفارغة ويُلحق
   *  أسفل المكتوبة، ولا يمس صوتًا ولا نصًا أبدًا. كل خطوة بنتيجتها بصدق */
  transcribeSteps(id: string, signal?: AbortSignal) {
    return this.req<TranscribeStepsResultDto>(`/api/guides/${id}/transcribe-steps`, { method: 'POST', signal })
  }

  /** VIEW-06: عدّاد مشاهدات مجمّع — نداء ناري من العارض العام بعد تحميل ناجح */
  trackShareView(token: string) {
    return this.req<void>(`/api/share/${token}/view`, { method: 'POST' })
  }

  async revokeShare(id: string) {
    await this.req<void>(`/api/guides/${id}/share`, { method: 'DELETE' })
  }

  publicGuide(token: string, signal?: AbortSignal) {
    return this.req<PublicGuideDto>(`/api/share/${token}`, { signal })
  }

  search(
    params: { q: string; limit?: number; from?: string; to?: string; shared?: boolean; folder?: string; site?: string },
    signal?: AbortSignal,
  ) {
    const qs = new URLSearchParams({ q: params.q })
    if (params.limit !== undefined) qs.set('limit', String(params.limit))
    if (params.from !== undefined) qs.set('from', params.from)
    if (params.to !== undefined) qs.set('to', params.to)
    if (params.shared !== undefined) qs.set('shared', String(params.shared))
    if (params.folder !== undefined) qs.set('folder', params.folder)
    if (params.site !== undefined) qs.set('site', params.site)
    return this.req<SearchResponseDto>(`/api/search?${qs.toString()}`, { signal })
  }

  searchSuggest(q: string, signal?: AbortSignal) {
    return this.req<SearchResponseDto>(`/api/search/suggest?q=${encodeURIComponent(q)}`, { signal })
  }

  /** SRCH-04: شارة الاكتشاف — أدلة المالك على نطاق التبويب النشط، مرتّبة بالشاشة ثم الموقع */
  discover(site: string, screen?: string, signal?: AbortSignal) {
    const q = screen ? `&screen=${encodeURIComponent(screen)}` : ''
    return this.req<DiscoverResponseDto>(`/api/discover?site=${encodeURIComponent(site)}${q}`, { signal })
  }

  // ——— GM-05: تعليقات الخطوات ——

  /** تعليقات دليل من رابط المشاركة — للضيف في العارض العام */
  shareComments(token: string, signal?: AbortSignal) {
    return this.req<CommentsResponseDto>(`/api/share/${token}/comments`, { signal })
  }

  /** ضيف يعلّق عبر رابط المشاركة — بلا حساب، الاسم اختياري */
  addShareComment(token: string, input: CreateCommentDto) {
    return this.req<CommentResponseDto>(`/api/share/${token}/comments`, { json: input })
  }

  /** تعليقات دليل المالك — للمحرر حيث يردّ ويوسم محلولًا */
  guideComments(id: string, signal?: AbortSignal) {
    return this.req<CommentsResponseDto>(`/api/guides/${id}/comments`, { signal })
  }

  /** المالك يعلّق/يردّ من المحرر — يظهر بعلامة «صاحب الدليل» */
  addGuideComment(id: string, input: CreateCommentDto) {
    return this.req<CommentResponseDto>(`/api/guides/${id}/comments`, { json: input })
  }

  updateGuideComment(id: string, commentId: string, patch: UpdateCommentDto) {
    return this.req<CommentResponseDto>(`/api/guides/${id}/comments/${commentId}`, {
      method: 'PATCH',
      json: patch,
    })
  }

  async deleteGuideComment(id: string, commentId: string) {
    await this.req<void>(`/api/guides/${id}/comments/${commentId}`, { method: 'DELETE' })
  }

  // ——— إدارة الفريق (Team Management) ——

  getTeamMembers() {
    return this.req<MemberDto[]>('/api/team')
  }

  inviteMember(input: InviteMemberReq) {
    return this.req<MemberDto>('/api/team', { method: 'POST', json: input })
  }

  updateMember(userId: string, patch: UpdateMemberReq) {
    return this.req<MemberDto>(`/api/team/${userId}`, { method: 'PATCH', json: patch })
  }

  async removeMember(userId: string) {
    await this.req<void>(`/api/team/${userId}`, { method: 'DELETE' })
  }

  // ——— الفرق ككيان (المرحلة د — WS-08، ترحيل 0010) ——

  listTeams(signal?: AbortSignal) {
    return this.req<TeamDto[]>('/api/team/teams', { signal })
  }

  async createTeam(name: string) {
    return this.req<TeamDto>('/api/team/teams', { json: { name } })
  }

  async renameTeam(id: string, name: string) {
    return this.req<{ id: string; name: string }>(`/api/team/teams/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: { name },
    })
  }

  async deleteTeam(id: string) {
    await this.req<void>(`/api/team/teams/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  // ——— دعوات المساحة (WS-01) — رابط يُرسل واتساب، بلا SMTP ——

  createInvite(input: InviteCreateReq) {
    return this.req<InviteDto>('/api/team/invites', { method: 'POST', json: input })
  }

  /** علنًا بلا جلسة — صفحة /invite/:token تقرأ به */
  getInvite(token: string) {
    return this.req<InviteInfoDto>(`/api/invites/${encodeURIComponent(token)}`)
  }

  /** علنًا بلا جلسة — يعيد جلسة العضو الجديد بكوكي */
  acceptInvite(token: string, input: AcceptInviteReq) {
    return this.req<{ id: string; email: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      json: input,
    })
  }

  // ——— البوكمارك (WS-04) ——

  toggleBookmark(guideId: string) {
    return this.req<{ bookmarked: boolean }>(`/api/guides/${encodeURIComponent(guideId)}/bookmark`, {
      method: 'POST',
    })
  }

  // ——— DTOP-03: ربط الأجهزة (المتصفّح يوافق ويدير؛ الديسكتوب يطلب الرمز من Rust مباشرة) ——

  devicePending(code: string, signal?: AbortSignal) {
    return this.req<DevicePendingDto>(`/api/device/pending?code=${encodeURIComponent(code)}`, { signal })
  }

  deviceApprove(userCode: string, approve: boolean) {
    return this.req<{ ok: true }>('/api/device/approve', { json: { userCode, approve } })
  }

  listDevices(signal?: AbortSignal) {
    return this.req<DeviceDto[]>('/api/devices', { signal })
  }

  async revokeDevice(id: string) {
    await this.req<void>(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}
