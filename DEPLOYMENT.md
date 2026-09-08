# دليل النشر — رَقيم / دليلي (dalili)

> هذا الملف مصدر الحقيقة الوحيد لفريق النشر: كل ما يلزم لتشغيل التطبيق على بيئة اختبار حقيقية (خادم مضيف + دومين) بأقل عدد من القرارات وأصفر مفاجآت.
> إن اختلف هذا الملف عن أي وثيقة أخرى — **هذا الملف أحدث**، فالوثائق الأقدم لم تعد تعكس واقع الكود.

- **آخر تحديث:** 2026-09-08
- **الفرع المرجعي:** `feature/learner-experience-v2`
- **المستودعات المنشورة:**
  - Backend (الخادم): `https://github.com/tebidy1/DALILI-BACKEND`
  - Frontend (الويب + الامتداد): `https://github.com/tebidy1/DALILI-FRONTEND`
- **صيغة الترخيص/الملكية:** خاص، لا نشر عام قبل موافقة صاحب المستودع.

---

## 1. نظرة معمارية على ما ستنشره

التطبيق ثلاث قطع تعمل معًا، تُنشر عادةً على مضيف واحد خلف بروكسي عكسي (Nginx / Caddy):

| القطعة | التقنية | الدور | العنوان الافتراضي |
|---|---|---|---|
| **API** | Fastify 5 + better-sqlite3 + Drizzle | كل المنطق الخادمي: مصادقة، أدلة، تعليقات، بحث، رفع لقطات، STT | `127.0.0.1:8787` (لا تعرضه للإنترنت مباشرة) |
| **الويب** | Vite 6 + React 19 (SPA) | المكتبة + المحرر + العارض العام | `/` من دومينك (ملفات ستاتيك) |
| **الامتداد** | WXT (Manifest V3) + React | التقاط خطوات المتصفح | يُبنى إلى ملف zip يُثبَّت من متجر كروم أو يدويًا |

**نمط الطلبات:**

```
المتصفح ──► https://your-domain.com/            → ملفات SPA (dist من apps/web)
المتصفح ──► https://your-domain.com/api/*       → بروكسي عكسي إلى 127.0.0.1:8787
المتصفح ──► https://your-domain.com/files/*     → بروكسي عكسي إلى 127.0.0.1:8787
الامتداد ──► https://api.your-domain.com/api/*  → مباشرة إلى API (يعتمد VITE_API_BASE وقت بناء الامتداد)
```

**قواعد ملزمة** (لا تكسرها في الإنتاج):

- **API لا يخدم HTTPS بنفسه** — يعتمد على البروكسي (Nginx/Caddy). لا تحاول ربطه بشهادة مباشرة.
- **الكوكي `secure=true` في الإنتاج** — يعني الدومين لازم HTTPS، وإلا لا جلسات ولا دخول.
- **قاعدة البيانات SQLite في وضع WAL** — لا تنسخ ملف `.db` مباشرة أثناء التشغيل؛ استخدم سكربت النسخ الاحتياطي.

---

## 2. المتطلبات على المضيف

| البند | الإصدار الأدنى | ملاحظات |
|---|---|---|
| Node.js | **20.x LTS** أو أحدث (اختُبر على 20، 22) | يجب أن يدعم better-sqlite3 v12 (native module) |
| pnpm | **9.x** | التطبيق مونوريبو ولا يعمل بـ npm/yarn |
| نظام التشغيل | Linux (Ubuntu 22.04+ / Debian 12+) موصى به | Windows Server يعمل، لكن systemd الأسهل للإدارة |
| ذاكرة | 1 GB RAM كحد أدنى؛ 2 GB مريح | نموذج التضمين المحلي (~100 MB) يُحمَّل عند أول إقلاع |
| قرص | 5 GB مبدئيًا، ثم بمعدل حجم لقطات المستخدمين | اللقطات PNG تُخزَّن في `data/files/` |
| مكتبات بناء (لينكس) | `build-essential`, `python3` | مطلوبة لتصريف `better-sqlite3` عند `pnpm install` |
| Nginx أو Caddy | أي إصدار حديث | يعمل بروكسيًا عكسيًا ويقدّم ملفات SPA |
| شهادة SSL | Let’s Encrypt أو غيرها | إجباري — راجع «فخ الكوكي» أدناه |

**ملاحظة GLIBC:** إذا نصّبت على توزيعة قديمة جدًا (Ubuntu 18 أو أقدم)، سيفشل `onnxruntime-node` (البحث بالمعنى) بصمت — التطبيق يقلع لكن يعود إلى «البحث الحرفي». Ubuntu 22.04+ آمن.

---

## 3. المتغيرات البيئية — كل مفتاح، ماذا يفعل، ومتى يلزم

المتغيرات تُقرأ من `apps/api/.env`. الملف يُنشأ ذاتيًا عند أول إقلاع بقيم افتراضية آمنة للتطوير، **لكن للإنتاج يجب كتابتها يدويًا قبل الإقلاع**.

انسخ `apps/api/.env.example` إلى `apps/api/.env` ثم املأ:

| المفتاح | مطلوب؟ | الوصف | مثال إنتاج |
|---|---|---|---|
| `NODE_ENV` | **نعم** | يجب أن يكون `production` — يحوّل كوكي الجلسة إلى `secure+lax`. غيابه = وضع تطوير غير آمن. | `production` |
| `PORT` | لا (افتراضي 8787) | منفذ يستمع عليه Fastify على `127.0.0.1` | `8787` |
| `DATA_DIR` | نعم | مسار مطلق يفضّل، أو نسبي إلى `apps/api/`. سيحوي `dalili.db` + `files/` + `backups/`. | `/var/lib/dalili/data` |
| `COOKIE_SECRET` | **نعم** | ≥ 16 حرفًا، عشوائي. يُوقّع كوكيز الجلسة. تغييره = تسجيل خروج للجميع. | ولّد بـ `openssl rand -hex 32` |
| `PUBLIC_BASE` | **نعم** | الدومين العام الكامل (مع بروتوكول، بلا شرطة). يُستخدم لبناء روابط المشاركة والدعوات في الردود. | `https://raqeem.your-domain.com` |
| `GROQ_API_KEY` | لا (اختياري) | مفتاح Groq لتفريغ الصوت (STT). غيابه = زر «تفريغ» يردّ 503 برسالة عربية — لا يكسر شيئًا آخر. | `gsk_...` |

**قواعد أمان صارمة:**

- `.env` يجب أن يكون `chmod 600` ومملوكًا للمستخدم الذي يشغل الخدمة.
- لا تلتزم `.env` أبدًا إلى git — التزام `.env.example` فقط (وهو ما هو ملتزم).
- `COOKIE_SECRET` ضعيف = جلسات قابلة للتزوير. لا تنسخ من التطوير.
- `PUBLIC_BASE` خاطئ = روابط المشاركة/الدعوة تعطي 404 عند الفتح.

---

## 4. تركيب وتشغيل الخادم (API) — أول مرة

```bash
# 1) استنسخ المستودع
git clone https://github.com/tebidy1/DALILI-BACKEND.git /opt/dalili
cd /opt/dalili

# 2) ثبّت التبعيات (سيصرّف better-sqlite3 وقت التنصيب)
pnpm install --frozen-lockfile

# 3) هيئ البيئة
cp apps/api/.env.example apps/api/.env
$EDITOR apps/api/.env    # املأ القيم من الفقرة 3

# 4) هيئ مجلد البيانات (إن اخترت مسارًا خارج المشروع)
sudo mkdir -p /var/lib/dalili/data
sudo chown -R $USER:$USER /var/lib/dalili

# 5) شغّل يدويًا للتحقق (سترى «دليلي API جاهز على http://127.0.0.1:8787»)
pnpm --filter @dalili/api start
```

**عند نجاح الإقلاع تُنشأ تلقائيًا:**

- `dalili.db` + ملفات WAL في `DATA_DIR/`.
- كل جداول القاعدة (عبر ترحيلات مرقّمة في `apps/api/src/db/migrations.ts` — لا حاجة لتشغيل شيء يدويًا).
- مجلد `DATA_DIR/files/` للقطات المرفوعة.
- بصمات البحث بالمعنى تُبنى في الخلفية بعد الإقلاع (السجل يقول «البحث بالمعنى جاهز — بصمات N دليلًا»).

**فحص صحة الخادم بعد الإقلاع:**

```bash
curl http://127.0.0.1:8787/health   # {"ok":true,"name":"dalili-api"}
curl http://127.0.0.1:8787/ready    # {"ready":true,"db":true,"files":true} — الأخير هو الحقيقي
```

`/health` = العملية حية. `/ready` = تجيب القاعدة وقرص الملفات قابل للكتابة. **استعمل `/ready` في فحوص المُوازِن أو systemd، لا `/health`.**

---

## 5. تشغيل الخادم كخدمة نظامية (systemd) — موصى به

أنشئ `/etc/systemd/system/dalili-api.service`:

```ini
[Unit]
Description=Dalili API
After=network.target

[Service]
Type=simple
User=dalili
WorkingDirectory=/opt/dalili
Environment=NODE_ENV=production
ExecStart=/usr/bin/pnpm --filter @dalili/api start
Restart=on-failure
RestartSec=3
# قصر الوصول للقرص إلى مجلد البيانات فقط
ReadWritePaths=/var/lib/dalili /opt/dalili/apps/api
# قصر الشبكة — API محلي فقط، البروكسي يفتحه للإنترنت
IPAddressAllow=localhost
IPAddressDeny=any
# سجلات JSON منظمة إلى journald
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /var/lib/dalili --shell /usr/sbin/nologin dalili
sudo chown -R dalili:dalili /var/lib/dalili /opt/dalili
sudo systemctl daemon-reload
sudo systemctl enable --now dalili-api
sudo systemctl status dalili-api
journalctl -u dalili-api -f    # مراقبة السجلات
```

**السجلات:** بصيغة JSON (Pino) مع إخفاء الكوكيز تلقائيًا (`OPS-02`). كل طلب يحمل `req.id` — استخدمه للربط عبر السجلات.

---

## 6. قاعدة البيانات — SQLite في وضع WAL

**لا يوجد Postgres ولا خدمة قاعدة منفصلة.** القاعدة ملف واحد `DATA_DIR/dalili.db` مع ملفات WAL/SHM بجانبه.

**الترحيلات تُطبَّق ذاتيًا عند كل إقلاع** — لا يوجد أمر `pnpm migrate`. كل ترحيل يُسجَّل في جدول `_migrations` داخل القاعدة نفسها، فلن يُطبَّق مرتين.

### النسخ الاحتياطي

```bash
# نسخة كاملة (قاعدة + ملفات) — آمن أثناء تشغيل الخدمة، يستخدم SQLite backup API الصحيح
cd /opt/dalili
pnpm --filter @dalili/api backup
```

- الوجهة: `DATA_DIR/backups/YYYYMMDD-HHMMSS/`.
- يحتفظ بآخر **14** نسخة تلقائيًا (الأقدم يُحذف).
- شغّله يوميًا عبر cron:

```cron
30 3 * * *  cd /opt/dalili && /usr/bin/pnpm --filter @dalili/api backup >> /var/log/dalili-backup.log 2>&1
```

### الاستعادة

```bash
# 1) أوقف الخدمة أولًا — استعادة قاعدة قيد الاستخدام خطر
sudo systemctl stop dalili-api

# 2) شغّل سكربت الاستعادة (يأخذ اسم مجلد النسخة من data/backups/)
pnpm --filter @dalili/api restore -- 20260908-030030

# 3) أعد التشغيل
sudo systemctl start dalili-api
```

### ماذا تنسخ خارج المضيف؟

- `DATA_DIR/backups/` كاملًا إلى تخزين خارجي (S3, R2, Backblaze...) يوميًا.
- **لا تنسخ** `dalili.db-wal` و `dalili.db-shm` وحدها — لا معنى لها بدون قاعدة متسقة.

---

## 7. الواجهة (apps/web) — بناء ثابت

الويب SPA خالصة (Vite + React Router). تُبنى مرة، تخدم كملفات ستاتيك، وتوجّه `/api` و `/files` عبر البروكسي.

```bash
cd /opt/dalili
pnpm --filter @dalili/web build
# الناتج: apps/web/dist/  (index.html + assets/*)
```

**ملاحظة مهمة:** الويب لا يستعمل أي متغير بيئة وقت البناء. يفترض أن `/api` و `/files` متاحان من نفس الأصل عبر البروكسي. **إن أردت وضع الويب على دومين مختلف عن الـ API**، عليك إما:
1. إعداد البروكسي بحيث ينقل `/api` و `/files` من دومين الويب إلى الـ API (الطريقة الأنظف)، أو
2. تعديل الكود ليقرأ `VITE_API_BASE` (غير مدعوم حاليًا — يحتاج تطويرًا صغيرًا).

### إعداد Nginx (المضيف الواحد — النمط الافتراضي)

```nginx
server {
    listen 443 ssl http2;
    server_name raqeem.your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/raqeem.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/raqeem.your-domain.com/privkey.pem;

    # سقف رفع اللقطات — أعلى قليلًا من حد multipart (27 MB) الذي يفرضه API
    client_max_body_size 30M;

    # SPA — ملفات ستاتيك مع fallback إلى index.html للتوجيه من جانب العميل
    root /opt/dalili/apps/web/dist;
    index index.html;

    location / {
        try_files $uri /index.html;
        add_header Cache-Control "no-cache" always;   # index.html لا يُخزَّن
    }

    # الأصول المُهاش (assets/*.<hash>.js|css) — تخزين طويل جدًا
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # كل مسارات API وملفات اللقطات → إلى الـ API الداخلي
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 60s;    # STT قد يستغرق نصف الدقيقة
    }
    location /files/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 7d;
    }

    location = /health { proxy_pass http://127.0.0.1:8787; access_log off; }
    location = /ready  { proxy_pass http://127.0.0.1:8787; access_log off; }
}

# إعادة توجيه HTTP → HTTPS (إجباري لأن الكوكي secure=true)
server {
    listen 80;
    server_name raqeem.your-domain.com;
    return 301 https://$host$request_uri;
}
```

### أو Caddy (تلقائي أكثر)

```
raqeem.your-domain.com {
    root * /opt/dalili/apps/web/dist
    try_files {path} /index.html
    file_server

    handle /api/* { reverse_proxy 127.0.0.1:8787 }
    handle /files/* { reverse_proxy 127.0.0.1:8787 }
    handle /health { reverse_proxy 127.0.0.1:8787 }
    handle /ready  { reverse_proxy 127.0.0.1:8787 }

    request_body { max_size 30MB }
    encode zstd gzip
}
```

Caddy يستخرج شهادة Let’s Encrypt تلقائيًا — لا حاجة لـ certbot.

---

## 8. الامتداد (apps/extension) — البناء والنشر

الامتداد يعتمد **عند البناء** متغيرات بيئية لعناوين API والويب:

```bash
cd /opt/dalili
export VITE_API_BASE=https://raqeem.your-domain.com
export VITE_WEB_BASE=https://raqeem.your-domain.com
pnpm --filter @dalili/extension build
# الناتج: apps/extension/.output/chrome-mv3/
```

لتوليد zip جاهز للرفع لمتجر كروم:

```bash
pnpm --filter @dalili/extension zip
# الناتج: apps/extension/.output/dalili-<version>-chrome.zip
```

**قواعد ملزمة لتحديث الامتداد:**

- **رقم الإصدار** يُرفع في `apps/extension/wxt.config.ts` عند كل رفع لمتجر كروم — متجر كروم يرفض نفس الرقم مرتين.
- **الأيقونات** موجودة في `apps/extension/public/icons/` — يولّدها `scripts/make-icons.mjs` إن لزم.
- **صلاحيات الامتداد** حاليًا: `storage, unlimitedStorage, tabs, sidePanel, offscreen` + `host_permissions: <all_urls>` — راجعها فريق الأمان قبل الرفع لأول مرة.

### تثبيت يدوي (للاختبار قبل النشر لمتجر)

`chrome://extensions` → فعّل «وضع المطور» → «تحميل غير مضغوط» → اختر `apps/extension/.output/chrome-mv3/`.

---

## 9. CORS و الأصول المسموح بها — نقطة تحتاج انتباهك

في `apps/api/src/app.ts` قائمة CORS **مثبتة داخل الكود**:

```ts
origin: [/^chrome-extension:\/\//, /^http:\/\/(localhost|127\.0\.0\.1):5174$/]
```

**عند النشر على دومين حقيقي يجب تعديل هذا السطر** ليشمل دومينك (أو تحويله ليقرأ من ENV). مثال بديل جاهز:

```ts
origin: [
  /^chrome-extension:\/\//,
  'https://raqeem.your-domain.com',
]
```

إن نسيت هذا فسترى في المتصفح: `CORS policy blocked` والويب يعمل والامتداد لا. اطلب تحويل هذا لمتغير بيئي في أول جولة تطوير بعد النشر — القيمة الحالية مقصورة على التطوير.

---

## 10. فخاخ إنتاج معروفة (لا تسقط فيها)

| الفخ | العرَض | الحل |
|---|---|---|
| `NODE_ENV` غير مضبوط | الكوكي تُرسل بدون `secure` والدخول ينجح ثم يفشل عشوائيًا | ضعه `production` في `.env` أو في `Environment=` بـ systemd |
| الدومين HTTP بلا SSL | الجلسة لا تُخزَّن (كوكي `secure` تُرفض من المتصفح) | HTTPS إلزامي — لا اختصار |
| `PUBLIC_BASE` لا يطابق الدومين | روابط مشاركة الأدلة/الدعوات تُبنى بعنوان خاطئ | صحّح `.env` وأعد التشغيل |
| CORS مثبت على `localhost:5174` | من المتصفح: `Access-Control-Allow-Origin missing` | عدّل `apps/api/src/app.ts` كما في الفقرة 9 |
| نسخ `.db` وقت التشغيل | نسخة تالفة عند الاستعادة (فاتها WAL) | استخدم `pnpm --filter @dalili/api backup` — يستعمل SQLite backup API |
| `DATA_DIR` على قرص شبكة (NFS/SMB) | `SQLITE_IOERR` عشوائي | ضع القاعدة على قرص محلي، وانسخ النسخ الاحتياطية للشبكة فقط |
| `client_max_body_size` في Nginx افتراضي (1M) | رفع اللقطات يفشل بـ 413 | ضعه `30M` كما في المثال |
| نموذج البحث بالمعنى (~100 MB) عند أول إقلاع | إقلاع أول بطيء (30-60 ثانية) | طبيعي — الإقلاعات اللاحقة سريعة. يُحمَّل إلى `apps/api/.models/` |
| Ubuntu 18 أو أقدم | onnxruntime-node يفشل بصمت والبحث بالمعنى معطل | استخدم Ubuntu 22.04+ أو تجاهل (البحث الحرفي كبديل) |
| كوكي `sameSite=lax` + دومين فرعي مختلف للامتداد | جلسة الامتداد لا تصمد | ضع الويب والـ API على نفس الأصل (نمط المضيف الواحد) |

---

## 11. قائمة تحقق ما قبل النشر (استخدمها كما هي)

- [ ] `.env` مملوء بـ `NODE_ENV`, `COOKIE_SECRET` (32 حرفًا +)، `PUBLIC_BASE`, `DATA_DIR`.
- [ ] `.env` صلاحياته `chmod 600` وليس في git.
- [ ] الدومين له سجل DNS يشير للمضيف، وشهادة SSL صالحة.
- [ ] `pnpm install --frozen-lockfile` نجح بلا أخطاء تصريف better-sqlite3.
- [ ] `pnpm --filter @dalili/api start` يقلع بلا أخطاء، `/ready` يردّ 200.
- [ ] `pnpm --filter @dalili/web build` نجح — `apps/web/dist/index.html` موجود.
- [ ] Nginx/Caddy يخدم SPA، ويوجّه `/api` و `/files` للـ API.
- [ ] CORS معدّل ليشمل دومينك (فقرة 9).
- [ ] فتح الدومين في متصفح خفي → تسجيل حساب جديد → إنشاء دليل من مصنف → مشاركة رابط → فتحه في نافذة خفية أخرى بلا دخول.
- [ ] الامتداد مبني بـ `VITE_API_BASE=https://your-domain`، ثبّتّه محليًا، سجّل خطوة، أُنشئ الدليل، فتحته في الويب.
- [ ] cron يومي للنسخ الاحتياطي مفعّل، ومحاولة استعادة على بيئة اختبار نجحت.
- [ ] `journalctl -u dalili-api -f` يظهر طلبات نظيفة، ولا كوكيز مسرَّبة في السجلات.
- [ ] فحص `/health` مضاف إلى المُوازِن/المراقب الخارجي (تنبيه عند 503).

---

## 12. تحديث الإصدار (بعد النشر الأول)

```bash
cd /opt/dalili
sudo systemctl stop dalili-api
git pull origin main
pnpm install --frozen-lockfile
pnpm --filter @dalili/web build
sudo systemctl start dalili-api
```

- الترحيلات الجديدة تُطبَّق تلقائيًا عند بدء الخدمة (سترى «applying migration N» في السجل).
- خذ نسخة احتياطية **قبل** كل ترقية: `pnpm --filter @dalili/api backup`.
- الويب يُعاد بناؤه إن كانت هناك تغييرات في `apps/web/` أو `packages/*`.
- الامتداد يُرفع لمتجر كروم منفصلًا بعد رفع رقم إصداره.

---

## 13. جهات الاتصال

- **صاحب المستودعات:** `tebidy1` على GitHub / `souglink@gmail.com`.
- **قناة المتابعة أثناء النشر:** حدّدها مع المالك قبل البدء.
- **مفتاح GROQ الحقيقي (STT):** يُسلَّم يدويًا خارج git — لا تطلبه في تذكرة أو قناة عامة.

---

## 14. مصادر داخلية (خارج نطاق هذا الملف)

- عقود API الرسمية: `packages/shared/src/contract.ts` — كل نقطة نهاية وشكل استجابتها.
- منطق الترحيلات: `apps/api/src/db/migrations.ts` — لكل تغيير سكيمة سبب مكتوب.
- سياسة الأمان (helmet/CSP/CORS/multipart): بداية `apps/api/src/app.ts`.
- سياسة الجلسة (`sameSite`/`secure`): `apps/api/src/auth/session.ts`.
