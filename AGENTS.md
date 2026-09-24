# AGENTS.md — حافظه پروژه Pure GitHub (برای دستیار opencode)

> این فایل را در شروع هر جلسه بخوان. آخرین به‌روزرسانی: 2026-09-24

## ۱) پروژه چیست؟

**Pure GitHub** — یک Discovery Engine برای پروژه‌های منبع‌باز که در ظاهر یک کانال
تلگرام است. هدف: پیدا کردن «GitHub Gems» (پروژه‌های ارزشمند کم‌دیده‌شده)، تولید
Caption فارسی، و انتشار در کانال پس از تأیید انسانی.

- سند اصلی: `Pute_GitHub_Project_Specification.md` (۴۷ بخش، فقط طرح — نه پیاده‌سازی)
- **نام درست پروژه `Pure` است، نه `Pute`.** اسم فایل سند غلط تایپی است.
- زبان محتوا: فارسی.
- کادنس: الان **یک پست در روز فقط برای تست**. در پروداکشن **۳ تا ۴ پست در روز**.
  سهمیه‌های `discovery/rules.js` برای همان ۳-۴ تنظیم شده‌اند، نه برای یکی.
- مسیر پروژه: `/home/nimux/Documents/PureGithub-project`
- **ایده‌ی «Schedule Message تلگرام» برای انتشار بررسی و رد شد (۲۰۲۶-۰۹-۰۹):**
  Bot API هیچ پارامتر زمان‌بندی در `sendMessage` ندارد؛ Schedule Message قابلیت
  کلاینت است نه API. لیست پیام‌های زمان‌بندی‌شده‌ی کانال هم از Bot API قابل
  خواندن/ویرایش نیست. به‌جایش فاز ۸ با زمان‌بند n8n ساخته شد.

### ⚠️ هدف پروژه عوض شده — این را قبل از هر کاری بخوان
سند و نسخه‌ی اول الگوریتم فقط دنبال «Hidden Gems» بودند. **کاربر این را صریحاً
تغییر داد.** هدف واقعی الان:

> **به درد برنامه‌نویس ایرانی بخورد.** ندیده‌شده بودن یکی از چند محور ارزش است،
> نه دروازه‌ی ورود.

شش خواسته‌ی صریح کاربر (۲۰۲۶-۰۹-۰۵):
1. باید مشکل کاربر ایرانی را حل کند (مثال خودش: کلاینت v2ray — ولی باید با
   رقیب‌هایش **تمایز** داشته باشد و بهترشان کند).
2. پروژه‌های حول هوش مصنوعی **ارزش بیشتری** دارند — چون «الان» این حوزه هر روز
   ابزار مفید بیرون می‌دهد.
3. سازنده‌ی ایرانی امتیاز بیشتر (کانال یک کامیونیتی برای برنامه‌نویس ایرانی است).
4. ریپوهای `awesome-*` هم **قبول** — گاهی مفیدند، مخصوصاً برای کاربر ایرانی.
5. ابزارهایی که **یکباره ترند شده‌اند هم باید منتشر شوند** — ترند شدن یعنی
   کاربردی بوده، پس معرفی‌اش مشکل آدم‌های بیشتری را حل می‌کند.
6. **پروژه‌های قدیمی اما کاربردی** هم باید معرفی شوند.
7. انبار کانفیگ («free v2ray config») را **خیلی جریمه کن** — نمی‌خواهد معرفی شود.

اگر روزی یک قاعده با یکی از این هفت مورد تناقض داشت، قاعده غلط است نه خواسته.

## ۲) وضعیت فعلی

**قدم ۱ (انتشار دستی) کامل و end-to-end تست‌شده.** سه پست در کانال منتشر شد و
یکی هم مسیر رد شدن را تست کرد.

**قدم ۲ (الگوریتم Discovery) کامل، کالیبره و end-to-end تست‌شده — workflow سوم
(Discovery) هم ساخته و تست شد (بخش ۴، اجرای ۱۲۰).** ربات تلگرام (workflow چهارم)
ساخته شد (۵۸ نود، بخش ۵). همه‌ی پیش‌نیازهای workflow سوم آماده‌اند:

| قطعه | فایل | وضعیت |
|---|---|---|
| سازنده‌ی کوئری | `discovery/queries.js` | ۱۴ کوئری، هر ۱۴ روی GitHub واقعی جواب داد |
| تأیید کوئری | `discovery/verify-queries.mjs` | ۰ کوئری مرده، ۷٪ هم‌پوشانی |
| cooldown | `COOLDOWN` + `shouldReconsider()` | ۵ اجرای متوالی، ۰ تکرار |
| انتخاب نهایی | `selectFinal()` | `maxPerCategory` که تا الان مرده بود |
| SQL | `db/discovery-queries.sql` | هر چهار کوئری روی DB واقعی اجرا شد |
| اسکیما | `db/schema.sql` | ۹ ستون + ۳ ایندکس + جدول لاگ + ۲ ویو، idempotent |
| باندل ن8ن | `discovery/bundle.generated.js` | خروجی‌اش با ماژول‌ها byte-identical |
| dry run | `discovery/dryrun.mjs` | فانل ۱۱۴۶→۱۲۰→۱۶ روی داده‌ی زنده |

قدم بعدی: **ساخت workflow سوم در n8n.** طرحش تأیید شده و پیش‌نیازهای فنی‌اش
اندازه‌گیری شده (§۱۷). **ساخت شروع شده — نود به نود ساخته و تست می‌شود.**

### پیشرفت ساخت workflow سوم (۲۰۲۶-۰۹-۰۶)
Workflow در n8n ساخته شد: **«Pure GitHub — Discovery»**، id=`hHSwbbOBKRIWStRU`
(اسکلت با `create_workflow_from_code`، بقیه با `update_workflow`/`addNode` گام‌به‌گام).
فایل منبع حقیقت: `workflows/puregh-discovery.ts` (نود Load Engine در آن
`<BUNDLE_EMBEDDED_BY_SCRIPT>` دارد؛ باندل از `discovery/bundle.lean.js` به‌صورت
JSON string تزریق می‌شود).

| نود | وضعیت |
|---|---|
| 1. Daily Schedule | ✅ تست شد — شلیک می‌کند |
| 2. Load Engine | ✅ تست شد — باندل ۵۱KB به‌صورت رشته بار می‌شود؛ بقیه با `new Function(eng + '; return PUREGH;')()` تزریق می‌کنند |
| 3. Build Query Plan | ✅ تست شد — ۱۴ کوئری از `buildQueries` می‌سازد (هر آیتم حامل `seed` است) |
| 4. Open Run Log | ✅ تست شد — در هر اجرا دقیقاً ۱ ردیف در `discovery_runs` |
| 5. GitHub Search | ✅ تست زنده — ۱۴ درخواست واقعی، همه موفق (با retry و timeout) |
| 6. Dedup and Collect | ✅ تست زنده — خروجی تکی {repos: ۸۹۲, idList, ثابت‌های rules} |
| 7. Cooldown Gate | ✅ تست شد — کوئری ۱ روی ۹۰۳ آیتم؛ با DB خالی همه gate='new' |
| 8. Score Stage A | ✅ تست شد — امتیاز متادیتا + عبور از gate |
| 9. Allocate README Budget | ✅ تست شد — ۱۲۰ ریپو با per-lane؛ خروجی ریپوی خام |
| 10. Fetch READMEs | ✅ تست زنده — ۱۲۰ درخواست موازی (batch 20)، ~۱۰ ثانیه |
| 11. Score Stage B | ✅ تست زنده — README از `json.data`؛ امتیاز کامل با لِین‌ها |
| 12. Select 16 | ✅ تست زنده — ۱۶ کاندیدا، توزیع لِین درست، خروجی repo+readme+scored |

گام بعدی: **بخش ۴** — Purpose Similarity → Loop 16 (Generate Caption → Assemble)
→ Select Final → Upsert + Save (زمان انتشار رندوم) → ارسال به ربات با ۴ دکمه‌ی اینلاین.
✅ انجام شد (اجرای ۱۲۰ موفق).

گام بعدی بعد از آن: **بخش ۵** — ربات تلگرام (workflow چهارم) + زمان‌بند انتشار. ✅ فازهای
۱-۷ ربات ساخته شد (۵۸ نود، `Zro6k6d8JcAOOpfn`)، فاز ۸ هم ساخته و تست شد
(`1tVlx8NwE7Qe4WWa`)، و مسیرهای متنی ربات تست زنده شدند (اجراهای ۱۲۶-۱۳۵).
باقی‌مانده: تست زنده‌ی دکمه‌های اینلاین (نیاز به URL عمومی)، همگام‌سازی فایل
`.ts` ربات، و فعال‌کردن workflow ها برای پروداکشن.

### ✅ بخش ۵ (ربات تلگرام) ساخته شد — فاز ۱ تا ۷ (۲۰۲۶-۰۹-۰۹)

Workflow جدید و مستقل: **«Pure GitHub — Telegram Bot»**، id=`Zro6k6d8JcAOOpfn`
(۲۸ فاز، ۵۸ نود، فعلاً غیرفعال). کاربر تصمیم گرفت ربات یک workflow جدا باشد تا
در آینده ارتقایش آسان‌تر باشد. فایل منبع حقیقت: `workflows/puregh-telegram-bot.ts`
(✅ کامیت `db3261e` — با نسخه‌ی کامل ۵۹نودی n8n همگام شد؛ ۵۷ نود عملکردی + ۲ استیکی).

ساخته‌شده (در n8n، با update_workflow گام‌به‌گام):
| قابلیت | مسیر نودها |
|---|---|
| ۴ دکمه (ok/rej/regen/manual) | Telegram Trigger → Parse Update → Route Update → Parse Callback → هر شاخه |
| ✅ تایید | فقط ack — پست دست‌نخورده در زمان خودش منتشر می‌شود |
| ❌ رد | `status='rejected'` + ویرایش پیام (حذف دکمه‌ها) — تریگر human_rejected ریپو را ابدی قفل می‌کند |
| 🔄 ساخت دوباره | Load Post → Load Repo → Fetch README (raw، retry) → Build Regen Facts → Regen Caption (LLM orcarouter→openrouter fallback) → Assemble → Save (attempt+1) → Edit Message با ۴ دکمه |
| ✍️ نوشتن دستی | Answer Manual → Set Pending Post (static data) → متن بعدی = کپشن → UPDATE + ویرایش پیام |
| 📋 لیست انتظار | Query Waiting List → Render → Send (HTTP مستقیم به Bot API با کیبورد داینامیک — چون telegram node کیبورد متغیر نمی‌پذیرد) |
| 🕒 تغییر زمان | sched:id → pendingSchedId → Parse Time (فارسی: «فردا ساعت ۱۸»، تاریخ جلالی ۱۴۰۵/۰۶/۲۰، روز هفته؛ تبدیل جلالی→میلادی تست شد) → UPDATE publish_at |
| ➕ افزودن به لیست | Parse Add URL → Check → Fetch Repo Metadata + Readme (GitHub API) → Build Facts → LLM → Assemble → Upsert Repo (source='submission') → Save Post (بدون publish_at) → پیش‌نمایش با ۴ دکمه → Save Bot Message |
| انصراف | پاک‌کردن همه‌ی pending state |

**نکات فنی که در این بخش محکم شد:**
- **کیبورد داینامیک**: telegram node پارامتر `inlineKeyboard` fixedCollection است و expression روی کلش نمی‌گیرد؛ برای تعداد متغیر دکمه باید مستقیم به Bot API POST کرد (body JSON کامل با `reply_markup`). ✅ تست زنده شد (اجرا ۱۳۳: پیام واقعی با کیبورد، message_id=25).
- **توکن در نود HTTP**: نود ارسال لیست از `$env.TELEGRAM_BOT_TOKEN` می‌خواند — این env در کانتینر n8n ست شده (از `.env` با `scripts/recreate-n8n.sh`) و کانتینر با `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` بازساخت شده تا expression اجازه‌ی خواندنش را داشته باشد.
- **payload انبوه در Postgres**: `jsonb_array_elements($1::jsonb)` + ستون‌های `r->>'...'`؛ topics باید `to_jsonb(r->'topics')` باشد نه cast مستقیم (خطای «invalid input syntax for type json»).
- **هشدارهای validate_workflow همه false-positive شناخته‌شده‌اند**: `resource:'callback'` در telegram node معتبر است (از سورس نود تأیید شد، خط ۵۴ مقدار 'callback' دارد) و هشدار DUPLICATE_SUBNODE_CONNECTION همان مستند discovery است (fallback به ورودی 1 درست وصل است). آنها را نادیده بگیر.

**باقی‌مانده:**
- ~~فاز ۸ = زمان‌بند انتشار~~ ✅ ساخته و تست شد (پایین را ببین).
- ~~`TELEGRAM_BOT_TOKEN`~~ ✅ در `.env` (gitignore) و با `scripts/recreate-n8n.sh` به‌صورت
  env کانتینر ست شد (اسکریپت حالا از `.env` می‌خواند؛ قبل از هر recreate چک می‌کند).
- ~~تست زنده مسیرهای متنی~~ ✅ شب ۲۰۲۶-۰۹-۰۹ با pin روی تریگر انجام شد (پایین).
- ~~تغییر env کانتینر + همگام‌سازی فایل .ts ربات~~ ✅ کامیت‌های `290bdea` و `db3261e` (۲۰۲۶-۰۹-۱۲).
- **تست زنده دکمه‌های اینلاین**: Telegram Trigger برخلاف آنچه قبلاً در مموری ثبت بود **polling نیست، webhook است** (از سورس نود تأیید شد — webhookMethods با setWebhook)؛ پس برای کلیک واقعی دکمه‌ها **URL عمومی لازم است** (مثل cloudflared quick tunnel). AGENTS §۱۵ هم به این اشاره دارد.
- **فعال‌کردن workflow ها برای پروداکشن** (Publisher → ربات → Discovery، به همین ترتیب تا صف پر باشد).

### ✅ تست زنده‌ی مسیرهای متنی ربات — اجراهای ۱۲۶ تا ۱۳۵ (۲۰۲۶-۰۹-۰۹)
روش: **pinData روی نود تریگر** (`Bot Updates`) — بدون URL عمومی، update پیام/کالبک
دستی pin می‌شود و اجرای manual زنجیره را راه می‌اندازد. پنج چیز با این تست‌ها
محکم شد (چهار باگ جدید + یک فیکس دنباله‌دار):

| # | علامت (اجرا) | علت ریشه‌ای | رفع |
|---|---|---|---|
| ۱ | `ExpressionError: access to env vars denied` در `Send Waiting List` (اجرا ۱۲۷) | در n8n جدید `N8N_BLOCK_ENV_ACCESS_IN_NODE` **پیش‌فرض true** است — `$env.TELEGRAM_BOT_TOKEN` در expression بلاک می‌شود (پیشنهاد خود خطا: حذف آن env) | کانتینر با `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` بازساخت شد (`scripts/recreate-n8n.sh`، یک‌بار برای همیشه — از HostConfig قابل مشاهده است). اجرای ۱۲۸ بعدش موفق |
| ۲ | `Bad Request: can't parse InlineKeyboardButton: Text buttons are not allowed in the inline keyboard` (اجرا ۱۳۲) | دکمه ساخته‌شده در Render فقط `text` داشت: `callback_data` در `additionalFields` مانده بود و expression ارسال `b.callback_data` را می‌خواند = `undefined` → تلگرام دکمه‌ی متنی خالص را در inline keyboard نمی‌پذیرد | حالا خود Render دکمه را با `callback_data` در سطح خود دکمه می‌سازد (`{ text, callback_data: 'sched:'+id }`) — ارسال همان `b.callback_data` را می‌خواند. اجرای ۱۳۳ موفق (message_id=25 واقعی) |
| ۳ | `cannot extract elements from an object` در `Upsert Add Repo` (اجرا ۱۳۰) | کوئری انبوه `jsonb_array_elements($1::jsonb)` را کپی کرده بود ولی `repoJson` یک **آبجکت تکی** سریالایزشده بود نه آرایه | `queryReplacement` حالا خودش wrap می‌کند: `[ JSON.stringify([ JSON.parse($json.repoJson) ]) ]` — هم شکل داده با SQL هم‌خوان می‌شود، هم قانون آرایه‌ای‌بودن expression رعایت می‌شود. اجرای ۱۳۱ موفق: upsert با id=4 برگشت |
| ۴ | `publish_at` سایلنت NULL می‌شد — UPDATE صفر ردیف بدون خطا (نیاز به فیکس دوباره در ۲۰:۴۹) | `Update Publish At` postId را از Parse Time می‌خواند که آن را از **static data** می‌گرفت — در اجرای manual بین نودها منتقل نمی‌شود → `undefined` → `sched:undefined` → UPDATE بی‌اثر (بدون RETURNING معلوم هم نمی‌شد) | postId مستقیم از paired item در Route Text خوانده می‌شود. اجرای ۱۳۵ موفق: «فردا ساعت ۱۸» → publish_at=2026-09-11 18:00+03:30 |
| ۵ | دکمه‌ی لیست انتظار برای پستِ بدون زمان، «۱۱ دی ساعت ۰۳:۳۰» نشان می‌داد (اجرا ۱۳۲) — تاریخ جلالیِ معتبرنما ولی بی‌معنا | `new Date(null)` در جاوااسکریپت **Invalid Date نیست** — null به 0 تبدیل می‌شود = Unix epoch؛ ۱ ژانویه ۱۹۷۰ ساعت ۳۰ دقیقه بعدازنیمه‌شب تهران = «۱۱ دی ۱۳۴۸» در تقویم فارسی. سال چاپ نمی‌شد پس خرابی شبیه تاریخ واقعی بود | تابع `fa` در Render نال‌گارد گرفت: `d ? new Date(d).toLocaleString('fa-IR',...) : 'بدون زمان'`. اجرای ۱۳۳ بعدش «بدون زمان» صحیح نشان داد |

**همه‌ی مسیرهای متنی تست‌شده و موفق:** لیست انتظار (خالی و پر)، افزودن به لیست با
`rastikerdar/vazirmatn` واقعی (metadata + README خام + LLM orcarouter با
`z-ai/glm-5.3-flash-free` → verdict=strong، پیش‌نمایش با ۴ دکمه، upsert با
source='submission')، و تغییر زمان انتشار. **«افزودن به لیست» عملاً اولین پست
کاربرمحور سیستم است** — کل زنجیره‌ی متادیتا→LLM→DB→پیام ربات بدون دست‌کاری کار کرد.

**داده‌ی باقی‌مانده در DB (عمداً، پاک نشده):** ریپوی vazirmatn (id=4،
source='submission') + پست id=4 با publish_at=2026-09-11 18:00+03:30 که **سررسیده
گذشته ولی منتشر نشده** — Publisher هنوز active نیست. این ردیف نباید دستی حذف شود؛
فعال‌کردن Publisher (یا تست بعدی فاز ۸) باید آن را واقعاً منتشر کند.

**دو نکته‌ی رفتاری از این تست‌ها:** (۱) پاسخ موفق Bot API مستقیماً `message_id`
دارد (در `result.message_id`) — برای ذخیره در Save Bot Message. (۲) structured
output زیر `output` برمی‌گردد و قانون `$json.output ?? $json` در مسیر add هم
برقرار است.

### ✅ فاز ۸ (زمان‌بند انتشار) ساخته و تست شد (۲۰۲۶-۰۹-۰۹)
Workflow پنجم: **«Pure GitHub — Publisher»**، id=`1tVlx8NwE7Qe4WWa` (۴ نود، فعلاً
غیرفعال). فایل منبع حقیقت: `workflows/puregh-publisher.ts`.

```
Every 10 Minutes → Claim Batch → Send to Channel → Mark Published
```

| مفهوم | پیاده‌سازی |
|---|---|
| Claim اتمیک | یک CTE: `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` — دو اجرای همزمان هرگز یک پست را دوبار نمی‌فرستند؛ `queryBatching: 'transaction'` |
| پست سررسیده | `status='draft' AND publish_at <= now()`، مرتب بر publish_at، سقف ۴ تا در هر tick |
| بن‌بست (گزینه‌ی الف) | پستِ گیرکرده در `publishing` بیش از ۳۰ دقیقه → دوباره claim می‌شود (خودترمیم) |
| Mark Published | `status='published'` + `published_at` + `telegram_message_id`؛ تریگر `posts_sync_published` خودش `repositories.published` را sync می‌کند (تست شد) |
| DB خالی | اجرای ۱۲۵: Claim صفر ردیف برگرداند → بقیه‌ی زنجیره خاموش (رفتار پیش‌فرض n8n، بدون alwaysOutputData) |

**تغییر اسکیما:** `posts.status` حالت `publishing` گرفت (در `schema.sql` و روی DB
زنده با ALTER — هر دو). حالت گذرا است، ردیف هیچ‌وقت نباید ابدی در آن بماند.

#### درس‌های فنی فاز ۸ (۲۰۲۶-۰۹-۰۹)
| علامت | علت ریشه‌ای | رفع |
|---|---|---|
| `there is no parameter $2` (اجرا ۱۲۱) | نود Postgres `queryReplacement` رشته‌ای را با **split(',')** به آرایه تبدیل می‌کند (utils.ts خط ۵۲)؛ کاما درون expression مقادیر را نمی‌بُرد و فقط ۱ پارامتر ساخته می‌شد | expression باید **آرایه** برگرداند: `={{ [ a, b ] }}` — سورس نود (executeQuery.operation.js خط ۹۷: `if (Array.isArray(queryReplacement)) values = queryReplacement`) |
| `invalid input syntax for bigint: "undefined"` (اجرا ۱۲۲) | خروجی تلگرام `{ok, result}` است — `id` ندارد؛ `String(undefined)` = "undefined" | `$('Claim Batch').item.json.id` از paired item — همان درس بخش ۴ |
| `duplicate key ... posts_one_published_per_repo_idx` (اجرا ۱۲۳) | فیکسچر تست خراب بود: دو پست روی یک ریپو. ایندکس یکتا **درست کار کرد** و جلوی انتشار دوبار یک ریپو را گرفت | DELETE پست قدیمی فیکسچر؛ در دیتای واقعی discovery چنین حالتی رخ نمی‌دهد (هر ریپو حداکثر یک ردیف draft فعال دارد) |

**تست‌های انجام‌شده:** SQL خام claim روی DB زنده (سررسیده + آینده + stuck-reclaim)؛
اجرا ۱۲۴ موفق end-to-end (پیام واقعی message_id=12 در کانال، status='published'،
sync ریپو)؛ اجرای ۱۲۵ با DB خالی. داده‌ی تست بعدش پاک شد (DB صفر). سه پیام تست
(message_id 10-12) در کانال ماند — دیده‌ای، اشکال ندارد، خودت حذف کن.

**نکته‌ی deployment:** workflow فعلاً `active: false` است. برای پروداکشن باید
publish شود — ولی قبلش ربات و discovery هم فعال شوند تا صف پر باشد.

### ✅ بخش ۴ ساخته و end-to-end تست شد (۲۰۲۶-۰۹-۰۹)
اجرا ۱۲۰ موفق: s-ui کشف شد، LLM واقعی (z-ai/glm-5.3-flash-free از orcarouter)
کپشن ساخت، ردیف draft با publish_at ذخیره شد، پیام ربات با ۴ دکمه فرستاده شد
(bot_message_id=22)، run log بسته شد. داده‌ی تست بعدش پاک شد (DB صفر).

نودهای جدید بخش ۴ (زنجیره بعد از Select 16):
`Purpose Similarity → Build LLM Facts → Loop Repos (batch 1)` با بدنه‌ی
`Generate Caption → Assemble Caption → Store Judgment → Wait 3 Minutes → Loop`
و پس از done: `Collect Judgments → Build Persist Payload → Upsert Repos →
Save Posts Payload → Save Final Posts → Join Posts To Sends → Loop Bot Sends`
با بدنه‌ی `Send to Bot → Save Bot Message → Loop` و در done آن `Close Run Log`.

| مفهوم | پیاده‌سازی |
|---|---|
| حافظه‌ی حلقه | `$getWorkflowStaticData('global').judged` — Store Judgment داخل حلقه append می‌کند؛ Build Query Plan در شروع هر اجرا null می‌کند (اجرای خراب اجرای بعدی را مسموم نکند) |
| انتخاب نهایی | `Collect Judgments` بعد از حلقه: `selectFinal()` روی همه‌ی ۱۶ قضاوت + زمان انتشار پخش ۲ ساعته از فردا ۹ص تهران (UTC+3:30، بدون DST) |
| verdict انتخاب‌نشده‌ها | فقط reject واقعی LLM یا duplicate-purpose → verdict='reject' + last_stage='llm' (cooldown ۳۶۵ روز)؛ بقیه verdict=NULL + last_stage='selected' (notSelected = ۳ روز) — هرگز status='rejected' در posts |
| upsert | یک آیتم به ازای هر ریپو با آرایه‌ی ۳۳پارامتری (کوئری ۳ discovery-queries.sql)؛ نود Postgres به ازای هر آیتم اجرا می‌شود |
| posts | INSERT انبوه با `jsonb_to_recordset` + JOIN روی github_id (نیازی به نگاشت id نیست)؛ executeOnce با setNodeSettings |
| ربات | هر پست جداگانه (Loop Bot Sends) با کپشن + زمان انتشار + ۴ دکمه (ok/rej/regen/manual + post_id)؛ Save Bot Message پیام را به ردیف وصل می‌کند |

#### باگ‌های بخش ۴ که یافت و رفع شدند (۲۰۲۶-۰۹-۰۹)
| علامت | علت ریشه‌ای | رفع |
|---|---|---|
| حلقه بی‌نهایت در تست pin (اجرا ۱۱۵: ۷۵ تکرار Loop Repos) | **نود pin شده را در حلقه قرار نده** — pin خروجی ثابت می‌دهد و splitInBatches هرگز به done نمی‌رسد | تست ساختاری حلقه را با pin نزن؛ تست زنده با Limit Test=1 بزن |
| «judged خالی» بلافاصله بعد از شروع حلقه (اجرا ۱۱۶-۱۱۹) | **SplitInBatches v3: خروجی 0=done، خروجی 1=loop** (تأیید از سورس نود + previousNodeOutput در دیتای اجرا). هر دو حلقه برعکس وصل بودند: بدنه‌ی حلقه روی done و مرحله‌ی پس از حلقه روی loop. همین علت خطای اجرای ۱۱۰ (Close Run Log زودهنگام) بود | بدنه روی خروجی 1، ادامه‌ی زنجیره روی خروجی 0 — در هر دو حلقه |
| «Node 'Collect Judgments' hasn't been executed» در Close Run Log (اجرا ۱۱۶) | Close Run Log هنوز از Loop Repos[done] قدیمی هم ورودی می‌گرفت و زودتر از Collect Judgments اجرا می‌شد | حذف اتصال قدیمی؛ تنها ورودی = done حلقه Loop Bot Sends |
| post_id در Save Bot Message پیدا نمی‌شد | `$json` این نود پاسخ تلگرام است ({ok, result}) — post_id ندارد | از `$('Join Posts To Sends').item.json.post_id` (paired item) خوانده شود |
| found_by همیشه NULL | خروجی GitHub Search پاسخ خام API است؛ label ندارد | Dedup از `pairedItem.item` اندیس آیتم کوئری را می‌گیرد و label را از Build Query Plan می‌خواند |
| هشدار DUPLICATE_SUBNODE_CONNECTION روی Generate Caption | با needsFallback=true نود chainLlm ورودی **دوم** مدل دارد؛ هر دو مدل به ورودی 0 وصل بودند | AI Model - Fallback به ai_languageModel ورودی index=1 |

**نکته‌ی SDK برای فایل‌های .ts:** حلقه در کد SDK باید با helper
`splitInBatches()` تعریف شود نه `node()` — متدهای `.onDone()/.onEachBatch()`
فقط روی خروجی آن helper معتبرند. `validate_workflow` ساخت jsCode با
`.join('\n')` را رد می‌کند (Method 'join' is not allowed) — فایل‌های .ts این
پروژه با آن الگو نوشته شده‌اند و parse نودها را نمی‌گذرند؛ wiring جداگانه با
نسخه‌ی ساده‌شده اعتبارسنجی شود و سینتکس با esbuild چک شود.

**نکته‌ی Test workflow:** نودهای داخل حلقه را pin نکن (بالا). Wait واقعی
منتظر می‌ماند و timeout تست را می‌خورَد — برای تست، Wait را موقتاً کم کن
یا disable کن و بعد برگردان.

### ⚠️ طرح بازبینی عوض شد — فرم n8n حذف، جایش ربات تلگرام (۲۰۲۶-۰۹-۰۸)
کاربر صریح گفت فرم بازبینی n8n لازم نیست. طرح جدید:
- هر پست ساخته‌شده به **چت خصوصی ربات** ارسال می‌شود (chat id `5622960785`)
  با ۴ دکمه‌ی اینلاین: **تایید / رد / ساخت دوباره کپشن / نوشتن دستی کپشن**
- پیام ربات دو بخش دارد: کپشن + زمان انتشار. زمان فقط در پیام ربات دیده می‌شود،
  نه در پست خود کانال.
- **«لیست انتظار»** = ردیف‌های جدول posts. هر پست یک زمان انتشار رندوم دارد:
  بازه ۴۸ ساعت از فردا صبح، ساعت ۹ تا ۲۳، حداقل ۲ ساعت فاصله بین دو پست.
- **پست لمس‌نشده = منتشر می‌شود** با همان کپشن در همان زمان. «تایید» فقط کپشن
  ویرایش‌شده را در لیست آپدیت می‌کند؛ «رد» پست را از لیست حذف می‌کند.
- «نوشتن دستی»: ربات منتظر متن بعدی کاربر می‌ماند، آن متن کپشن همان پست می‌شود،
  پیام edit می‌شود و ۴ دکمه دوباره می‌آید.
- دستورهای ربات: **«لیست انتظار»** (دکمه‌ی شیشه‌ای نام+زمان هر پست، کلیک =
  تغییر زمان انتشار) و **«افزودن به لیست»** (کاربر لینک GitHub می‌فرستد، ربات
  متادیتا می‌گیرد و کپشن می‌سازد — مثل workflow دستی — و پیش‌نمایش با ۴ دکمه
  می‌فرستد؛ خود کاربر زمان انتشار را تعیین می‌کند).
- انتشار خودکار: زمان‌بند دوره‌ای چک می‌کند کدام پست‌های لیست سررسیده‌اند و به
  کانال می‌فرستد + Mark Published.

تقسیم تأییدشده:
- **بخش ۴** (همان workflow سوم): ۴-۱ کشف نودها · ۴-۲ Purpose Similarity ·
  ۴-۳ حلقه ۱۶ Generate Caption (سب‌نود مدل Primary/Fallback — **provider را
  کاربر خودش وصل می‌کند، خالی بگذار**) · ۴-۴ Assemble · ۴-۵ Select Final ·
  ۴-۶ ذخیره در DB + زمان رندوم · ۴-۷ ارسال به چت ربات با ۴ دکمه ·
  ۴-۸ تست + همگام‌سازی + کامیت
- **بخش ۵** (workflow های جدید): ۵-۱ workflow ربات با Telegram Trigger و هندل
  ۴ دکمه + حالت منتظر-متن · ۵-۲ دستور لیست انتظار · ۵-۳ دستور افزودن به لیست ·
  ۵-۴ workflow زمان‌بند انتشار · ۵-۵ تست + کامیت
  (۵-۱ تا ۵-۴ انجام شد و تست شد؛ از ۵-۵ همگام‌سازی فایل .ts و کامیت نهایی مانده.)

نکته‌ی فنی: ⚠️ **این فرض قدیمی مموری غلط بود و اصلاح شد:** «Telegram Trigger فقط
در حالت Active کار می‌کند (polling، بدون URL عمومی)». سورس نود (TelegramTrigger.node.js)
نشان می‌دهد این trigger **webhook-based است** — در Active شدن با `setWebhook` به
`getNodeWebhookUrl('default')` ثبت می‌شود و سرورهای تلگرام باید بتوانند به n8n
برسند. برای کلیک واقعی دکمه‌ها **URL عمومی لازم است** (cloudflared quick tunnel،
یا استقرار روی VPS)؛ بدون آن فقط مسیر text (دستورهای متنی) قابل تست است.

### ⚠️ طرح حلقه‌ی LLM عوض شد — تک‌به‌تک + انتخاب پس از حلقه (۲۰۲۶-۰۹-۰۸)
اول حلقه‌ی batching پنج‌تایی ساخته شد؛ روی مدل‌های free سه بار شکست خورد:
- **اجرا ۱۰۸/۱۰۹:** «Payment required» بعد از ~۱۰ دقیقه، بعد «Model output doesn't
  fit required format» — مدل‌های free روی پرامپت بزرگ + آرایه‌ی JSON ۱۶تایی
  خراب می‌شوند و خرابی یک ریپو کل اجرا را می‌کشد.
- **اجرا ۱۱۰:** «there is no parameter $1» در Close Run Log — عبارت‌های
  `$('...').all()` روی نودهای **داخل حلقه** فقط آخرین تکرار را می‌بینند و وقتی
  نود هنوز اجرا نشده exception می‌دهند. درس: **در حلقه هرگز از `.all()` نودهای
  داخل حلقه برای شمارش/تجمیع استفاده نکن؛ از DB بشمار.**

طرح نهایی تأییدشده (پیشنهاد کاربر، بهتر از هر دو طرح قبلی):
1. حلقه تک‌به‌تک: `Loop Repos (batch 1)` → Generate Caption (۱ ریپو) →
   Assemble → Check Verdict، با **Wait ۳ دقیقه** بین ریپوها (سهمیه‌ی مدل free:
   ۲۰/دقیقه و ۵۰/روز — فاصله‌ی ۳ دقیقه‌ای یعنی ~۲۰ درخواست در ساعت).
   خرابی یک ریپو فقط خودش را می‌کشد؛ ~۱۶ ریپو ≈ ۴۸ دقیقه.
2. **سقف تنوع حین حلقه حذف شد.** هر ۱۶ کپشن در «حافظه» (خروجی نودهای حلقه)
   جمع می‌شوند و هیچ‌چیز حین حلقه به ربات نمی‌رود.
3. بعد از پایان حلقه: `selectFinal()` (همان تابع اصلی الگوریتم) از ۱۶ قضاوت
   **۸ تای نهایی** را برمی‌گزیند — سقف‌ها با دیدن همه‌ی ۱۶ نتیجه، نه حین حرکت.
4. فقط این ۸ تا در DB نوشته می‌شوند (ردیف posts با publish_at)، به ربات
   تلگرام می‌روند (۴ دکمه) و وارد لیست انتظار می‌شوند. ۸ تای انتخاب‌نشده
   فقط در repositories ثبت می‌شوند (verdict برای cooldown؛ notSelected = ۳ روز).
   **هشدار: ردیف posts انتخاب‌نشده نباید status='rejected' بگیرد — تریگر
   posts_sync_human_rejected آن را «رد انسانی» می‌شمارد و ریپو ابدی قفل می‌شود.
   اگر ردیفی ساخته شده باشد، DELETE کن.**
5. زمان انتشار: بازمحاسبه فقط برای ۸ تای نهایی بعد از انتخاب — پخش منظم
   ۲ ساعته در پنجره‌ی ۴۸ ساعته (فردا ۹ص تا ۲ روز بعد ۲۳ش).

نودهای مربوط به طرح‌های قبلی که باید در بازسازی حذف شوند: `Count Run Drafts`،
`Apply Caps`، `Save Drafts` داخل حلقه، `Send to Bot` داخل حلقه،
`Save Bot Message`، `Mark LLM Rejected` (به شکل فعلی). نود `Limit Test`
(۵ ریپو) فقط برای تست است — بعد از تست موفق به ۱۶ برگردانده یا حذف شود.

خطای «aborted (TLSSocket)» اجرای ۱۱۱ = بی‌ثباتی VPN روی tun0 (همان §۱۷)،
ناشی از طراحی نیست؛ با retry دوباره تست می‌شود.

نکته‌ی مربوط به `$('X').item.json` در حلقه: `.item` زنجیره‌ی pairedItem را
دنبال می‌کند و آیتم متناظر همین تکرار حلقه را می‌دهد (`.first()` همیشه اولین
می‌داد — باگ اجرای اول Assemble همین بود).

#### باگ‌های بخش ۳ که یافت و رفع شدند (۲۰۲۶-۰۹-۰۸)
| علامت | علت ریشه‌ای | رفع |
|---|---|---|
| `raw.githubusercontent.com/undefined/undefined/README.md` (اجرا ۹۶) | Allocate خروجی‌اش `scored.repo` بود — نرمال‌شده، بدون `full_name`/`default_branch` (normalize اینها را نگه نمی‌دارد) | Allocate حالا ریپوی خام را از Stage A برمی‌گرداند |
| Fetch READMEs ~۵ دقیقه معلق، سپس تایم‌اوت (اجرا ۹۷/۹۸) | ۱۲۰ درخواست **ترتیبی** با batchInterval 800 + timeout 30s روی شبکه VPN | batchSize 20 (موازی) + batchInterval 300 + timeout 15s؛ اجرا از ۵ دقیقه به ~۱۰ ثانیه رسید |
| همه ریپوها `no-readme` (اجرا ۱۰۰/۱۰۱) | خروجی httpRequest با `responseFormat: 'text'` زیر کلید **`data`** است؛ `String($json)` = `"[object Object]"` < 300 بایت | Score Stage B حالا `fetched[i].json.data` می‌خواند |
| همه ریپوها `no-lane`، Select 16 خالی (اجرا ۱۰۲) | Allocate ریپوی نرمال‌شده را به Stage B می‌داد؛ آن آبجکت `created_at`/`pushed_at` ندارد → دوباره normalize → سن = ۱ روز → همه لِین‌های minAgeDays رد | همان فیکس اول: Allocate ریپوی خام پاس می‌دهد (created_at سالم) |
| `there is no parameter $5` (اجرا ۱۰۳) | `R.COOLDOWN.llmRejectedDays` ناموجود — کلیدها پسوند `Days` ندارند؛ `R.THRESHOLDS` هم ناموجود است (نام درست `FUNNEL`). با DB خالی بی‌صدا null می‌شد و cooldown ها هرگز فعال نمی‌شدند | کلیدهای درست: `R.COOLDOWN.llmRejected` و `R.FUNNEL.minTotalForLlm` |

اجرای ۱۰۵ (پس از همه‌ی فیکس‌ها): **موفق در ۷۴ ثانیه** — ۱۶ کاندیدا با توزیع
لِین: ایران ۷ / AI ۳ / hidden_gem ۳ / ترند ۲ / فهرست ۱. همه با full_name و README کامل.
کاندیدای‌ها با مأموریت کانال منطبق‌اند (s-ui، Hiddify-Manager، 3x-ui، agentscope، deer-flow، wizmap).

نکته‌ی معماری برای نودهای Code این workflow: **همیشه ریپوی خام را پاس بده، نه
`scored.repo` را.** `normalize()` خروجی‌اش `ageDays`/`daysSincePush` دارد نه
`created_at`/`pushed_at`؛ هر بار normalize دوباره روی آبجکت نرمال‌شده سن را ۱ روز
می‌کند و همه‌ی لِین‌ها را می‌کشد. Select 16 هم برای همین ریپوی خام + README را
کنار scored برمی‌گرداند (LLM و upsert به هر سه نیاز دارند).

#### باگ‌های بخش ۲ که یافت و رفع شدند (۲۰۲۶-۰۹-۰۷)
| علامت | علت ریشه‌ای | رفع |
|---|---|---|
| `URL parameter must be a string, got undefined` (اجرا ۸۳) | GitHub Search به خروجی Open Run Log وصل بود (فقط `{id, started_at}`) به‌جای Build Query Plan | اتصال اصلاح شد: `Build Query Plan → GitHub Search` و `Build Query Plan → Open Run Log` (موازی) |
| فقط ۵ کوئری ساخته می‌شد (اجرا ۸۷/۸۸) | باندل داخل Load Engine کهنه بود — نسخه‌ی قبل از `queriesPerRun: 14` | باندل تازه از `bundle.lean.js` به‌صورت JSON string در نود تزریق شد؛ هش آن با دیسک byte-identical تأیید شد |
| `EAI_AGAIN` / `timeout of 30000ms exceeded` روی همان کوئری آخر (`curated`) (اجرا ۸۹/۹۰/۹۱) | ناپایداری موقت شبکه هنگام عوض شدن مسیر VPN — همان هشدار §۱۷؛ timeout ۳۰ ثانیه و تک‌تلاش کم بود | `timeout 60s` + `retryOnFail` + `maxTries 4` + `waitBetweenTries 1500` روی GitHub Search؛ اجرای ۹۲ بعد از فیکس همه‌ی ۱۴ درخواست موفق شد |

نکته‌ی اجرا ۹۱: هنوز نسخه‌ی قدیمی (timeout 30) را اجرا می‌کرد، به همین دلیل فقط ۳ کوئری ساخت و از همان جا خطا نداد (خطا به دلیل باندل کهنه نبود). بعد از فیکس، اجرای ۹۲ کامل بود: ۱۴ کوئری، ۸۹۲ ریپوی یکتا، ثابت‌های rules درست (minQuality 55, minTotal 70, llmCandidate 16, readmeFetch 120, seed 249).

#### اسکریپت تزریق باندل (`scripts/inject-bundle.mjs`)
باندل داخل Code node نمی‌شود دستی تایپ کرد (۵۳KB، خروجی inline در MCP وسطش کوتاه می‌شود و JSON خراب می‌شود). این اسکریپت از `bundle.lean.js` جیسکد نود Load Engine را می‌سازد:
- `node scripts/inject-bundle.mjs` → عملیات `update_workflow` را چاپ می‌کند.
- `node scripts/inject-bundle.mjs --file=out.json` → عملیات را در فایل می‌گذارد تا کاربر در رابط n8n پیست کند.
بعد از هر تغییر در `rules.js`/`algorithm.js`/`queries.js`: `node discovery/bundle.mjs --lean` بعد `node scripts/inject-bundle.mjs --file=...` و تزریق.

⚠️ **باگ `executeOnce` در addNode:** اسکیمای عملیات `addNode` در MCP فیلد
`executeOnce` را در آبجکت نود قبول نمی‌کند (سایلنت حذفش می‌کند). اگر نودی باید
یک‌بار برای همه‌ی آیتم‌ها اجرا شود (مثل Postgres انبوه)، یا (الف) فقط **یک آیتم**
ورودی بدهید، یا (ب) بعد از addNode با عملیات `setNodeSettings` مقدار
`settings.executeOnce: true` را بگذارید. با گزینه‌ی (ب) تست شد و درست شد.

### وضعیت فعلی دیتابیس (۲۰۲۶-۰۹-۱۴)
داده‌ی تست سه بار پاک شد: ۲۰۲۶-۰۹-۰۵ (۶ ریپو + ۶ پست)، ۲۰۲۶-۰۹-۰۶ (۱ ریپو +
۴ پست از تست‌های `imgcompress`)، و بعد از تست فاز ۸. بکاپ‌ها:
`backups/db-20260905-121624.dump` و `backups/db-20260906-010246-before-purge.dump`.
ردیف‌های `discovery_runs` از تست‌های workflow هم بارها TRUNCATE شدند.

**وضعیت فعلی (پس از فعال‌شدن Publisher در اجرای ۱۴۵):**
- پست id=4 (vazirmatn) **منتشر شد**: published_at=2026-09-14 15:00، message_id=13.
  همان پست سررسیده‌ی قدیمی بود که منتظر Publisher فعال بود — بدهی اشباح را داد.
- پست id=5 (`reloadlife/astrisk-web-ui`، verdict=maybe) هم منتشر شد (message_id=14،
  2026-09-14 16:20) — اولین پستِ تولیدشده با فلوی کامل UX جدید.
- پست‌های id=6 تا 9 هنوز `draft` بدون publish_at (ایجاد شده با مسیرهای add
  دستی/LLM — `mobinhasanghasemi/backend-skill`، `AlbusSec/Penetration-List`،
  `reloadlife/astrisk-web-ui`). کاربر زمانشان را با «لیست انتظار» تعیین می‌کند.
- repositories: id 4/6/7/8 همه source='submission'. (id=6 published=t ولی پستش
  draft است — از تست‌های UX؛ اشکالی ندارد.)

فیکسچرهای تست شباهت هدف بعد از تست پاک شدند (`github_id` های ۹۰۰۰۰۱ تا
۹۰۰۰۰۵)، و فیکسچرهای تست cooldown هم (۹۹۰۰۰۱ تا ۹۹۰۰۰۸).

**وضعیت ۲۰۲۶-۰۹-۲۲ (پس از تست‌های طرح دو لیست):** ۱ draft واقعی id=14
(`VoltAgent/awesome-design-md`، verdict strong) | rejected: 7, 8, 9 |
published: 4, 5, 6, 13. فیکسچرهای هر دو تست E2E (۱۵تایی و فرانت) پاک شدند.

فازهای بعدی: مهاجرت کامل به VM Freestyle (§۱۸/§۱۹ — الان فقط تست است) — ✅
**همین اتفاق افتاد (۲۰۲۶-۰۹-۱۵): مهاجرت کامل به VM شخصی `nimux` انجام شد.**
لپ‌تاپ حالا فقط کارخانه‌ی توسعه است. تولید روی `nimux` اجرا می‌شود (پایین، §۲۲).
بعد از آن Reference Learning، RAG، Feedback Loop مانده.
ابزار جدید (سند NEW.md): Discovery Engine دوم برای اخبار/داستان‌های AI Agent —
طرح تأییدشده، هنوز پیاده‌سازی نشده.

### ✅ مدل B و «Review Bot» — ساخته و تست زنده شد (۲۰۲۶-۰۹-۲۰)
کاربر خواست ﭘست‌ها از discovery به یک ربات بررسی جدید بروند (نه به workflow ربات
قدیمی تلگرام). ربات هفتم ساخته شد: **«Pure GitHub — Review Bot»**، id=
`KfWNSjAws4DQ2bjq` (۱۹ نود). فایل منبع حقیقت: `workflows/puregh-review-bot.ts`.
**این ربات روی لپ‌تاپ تست شده و هنوز به VM `nimux` منتقل و active نشده.**

- دو تریگر: `From Discovery` (executeWorkflowTrigger v1.2 passthrough) و
  `Bot Updates` (Telegram). وقتی discovery اجرا می‌شود، هر پست به‌صورت جدا برای
  ربات فرستاده می‌شود؛ ربات پیام با **دکمه‌ی web_app «باز کردن پنل بازبینی»**
  (`MINIAPP_URL/post/:id` → مینیاپ باز می‌شود) + دکمه‌ی **«🗑 حذف از لیست»**
  (`del:<post_id>`) می‌فرستد.
- `del:` → `DELETE FROM posts WHERE id AND status IN ('draft', 'approved')` — ریپو دست نمی‌خورد
  (تفاوت با reject که ریپو را ابدی قفل می‌کند؛ حذف از لیست یعنی همان ریپو در
  کشف بعدی می‌تواند دوباره بیاید). بعد از delete: ack + ویرایش پیام (حذف دکمه‌ها).
  **طرح دو لیست (۲۰۲۶-۰۹-۲۲):** del حالا روی draft **و** approved کار می‌کند.
- دستور/کالبک **«شروع دیسکاوری»** → `Execute Workflow` روی discovery (mode
  integrated). discovery حالا **تریگرش دیگر Daily Schedule نیست** — یک
  executeWorkflowTrigger v1.2 به نام From Review Bot (این طراحی deliberate است تا
  discovery فقط وقتی اجرا شود که کاربر خواسته؛ schedule حذف شد).
- **مسیرهای متنی ربات (۲۰۲۶-۰۹-۲۳):** `Route Text` (switchCase) سه متن را هدایت
  می‌کند: `/start` → `Send Hello` («سلام، ربات روشن است») · «شروع دیسکاوری» →
  `Send Discovery Started` («دیسکاوری شروع شد») + `Run Discovery` ·
  هر متن دیگر → `Send Unknown` («دستور ناشناخته است»). callback ها از `Parse
  Callback` و متن‌ها از `Route Text` ← خروجی ۱ `Route Update`؛ قبلاً `Is Start Text`
  فقط «شروع دیسکاوری» را تشخیص می‌داد و بقیه را گم می‌کرد. هر سه نود sendMessage
  `onError: continueRegularOutput` دارند (بحث همان ریسک زنجیره‌ای).
- 🔴 **ریسک زنجیره‌ای که رفع شد:** `answerStart.to(runDiscovery)` یعنی اگر ack
  تلگرام خطا بدهد discovery شلیک نمی‌شد. چون `answerQuery` best-effort است (query
  کهنه/تکراری را تلگرام رد می‌کند)، روی **۵ نود ack/ویرایش** (`Answer Start`,
  `Answer Del`, `Answer Del Not Draft`, `Answer Unknown`, `Edit Del Message`)
  `config.onError: 'continueRegularOutput'` گذاشته شد. تست: queryId ساختگی که قبلاً
  «Bad request» می‌داد حالا مسیر را متوقف نمی‌کند.

**تست‌های انجام‌شده (لپ‌تاپ، pin روی تریگر):**
| اجرا | مسیر | نتیجه |
|---|---|---|
| 426 | From Discovery (پست ۱۰) | ✅ پیام واقعی با ۲ دکمه رفت (message_id=147) |
| 428 | کلیک `del:10` | ✅ پست از DB حذف شد (فقط ack به‌خاطر queryId ساختگی خطا داد) |
| 431 | دستور «شروع دیسکاوری» | ✅ discovery اجرا 432 (integrated) تا Select 16 — صفر کاندیدا (همه در cooldown طبیعی) |
| 450 | کالبک `start:1` با queryId ساختگی | ✅ با onError، Run Discovery همچنان اجرا شد → discovery اجرا 451 |
| 452 | From Discovery (پست ۱۱، لینک جدید) | ✅ message_id=148 ارسال شد |

**تست زنده مینیاپ (توسط کاربر):** کلیک واقعی «حذف از لیست» در مینیاپ روی پست
id=11 → پست حذف شد، ریپو `nimux/fixture-review` دست‌نخورده ماند. فیکسچر بعدش پاک
شد (DB الان ۴ ریپو، صفر draft).

**MINIAPP_URL فعلی (تنها مرجع، ۲۰۲۶-۰۹-۲۱):**
`https://department-resolve-training-arabic.trycloudflare.com` — در
`backend/.env` و در ثابت `MINIAPP_URL` فایل `puregh-review-bot.ts` (دکمهی
web_app) + نود n8n `Send Review`. اگر URL عوض شد هر سه باید همگام شوند.

⚠️ **تشخیص «تانل خراب»:** اغلب اصلاً tunnel خراب نیست — origin پایین است. اگر
`curl https://<tunnel>/` خطای 530/connection refused داد، اول `ss -ltnp | rg :3001`
را چک کن و بک‌اند مینیاپ را بالا بیاور. پروسه‌ی cloudflared خودش می‌ماند و بعد از
بالا آمدن بک‌اند دوباره جواب می‌دهد.

⚠️ **quick tunnel بعد از هر ریاستارت/کرش URL جدید می‌گیرد و URL قبلی مرده می‌شود**
(Error 1033 در تلگرام). اگر دکمه‌ی web_app خطای Cloudflare Tunnel داد: اول با
`curl` تأیید کن tunnel زنده است، بعد URL تازه را در هر دو جا (`backend/.env` +
`puregh-review-bot.ts` + دکمه‌ی n8n) همگام کن و یک پیام **تازه** بفرست (پیام
قدیمی به قوت URL کهنه چسبیده است؛ ویرایش پیام کافی نیست). پروسه‌ی cloudflared
باید با `setsid ... > /tmp/cloudflared.log &` از شل جدا شود تا با بستن ترمینال
نمیرد.

### ✅ طرح دو لیست — پیاده‌سازی کامل end-to-end (۲۰۲۶-۰۹-۲۲)
کاربر طرح «دو لیست» را تأیید کرد و گام‌به‌گام اجرا شد (۷ گام تودو؛ در پایان جلسه
گام ۷ یعنی «آپدیت مموری + کامیت» ناتمام بود — **این آپدیت خودِ همان گام است؛
کامیت فقط با درخواست صریح کاربر**). جریان جدید:

```
هر ۱۶ کاندیدای Discovery → ردیف draft + پیام ربات با نظر مدل (verdict + دلیل)
→ تأیید انسانی در مینیاپ: draft → 'approved' (لیست نهایی) + اسلات انتشار
→ لیست نهایی دکمه‌های «همین الان بفرست» و «حذف از لیست» دارد
→ Publisher فقط 'approved' را منتشر می‌کند؛ draftهای لمس‌نشده برای همیشه می‌مانند
```

**همه‌ی این تغییرات روی لپ‌تاپ (محیط توسعه) اعمال شد؛ هنوز به VM `nimux` منتقل
نشده** — مهاجرت به‌طور عمدی به بعد از گام ۷ موکول شده بود. یعنی در VM فعلاً نسخه‌ی
قدیمی Discovery (انتخاب ۸ پس از حلقه) اجرا می‌شود.

#### Discovery — بازسازی (۳۱ → ۳۰ نود، ورژن `53a2fb1c-f163-42d4-b438-5ba65e33cb37`)
- **معناشناسی جدید: هیچ selectFinal در حلقه نیست — همه‌ی ۱۶ کاندیدا** کپشن + ردیف
  `draft` + پیام به Review Bot می‌گیرند. انتخاب نهایی=تأیید انسانی در مینیاپ.
- رینم: `Store Judgment`→`Track Run Stats`، `Collect Judgments`→`Collect Run Stats`،
  `Build Persist Payload`→`Build Loop Payload`. حذف: `Save Posts Payload` و
  `Join Posts To Sends`. افزودن: `Build Bot Payload` (کد v2، `runOnceForEachItem`).
- `Upsert Repos` حالا **۳۸ پارامتر** است: علاوه بر قبل، `verdict`، `verdict_reason`،
  `category`، `audience`، `evaluated_at`، `evaluated_model` ذخیره می‌شوند.
  ⚠️ `db/discovery-queries.sql` هنوز ۳۳ پارامتر را مستند می‌کند — بعداً همگام/کامنت.
- `Save Final Posts` = INSERT تکی per-item:
  `INSERT INTO posts (repository_id, caption, status, model) VALUES ($1::bigint, $2, 'draft', $3) RETURNING id, repository_id;`
  با `executeOnce:false` (addNode فیلد executeOnce را سایلنت حذف می‌کند — با
  `setNodeSettings` ست شود).
- `buildBotPayload` خروجی `{post_id, repository_id, caption, publish_at:null, full_name, verdict, reason}`.
- معناشناسی cooldown جدید: verdict **همیشه** ذخیره می‌شود؛ `last_stage='llm'` فقط
  برای reject (قفل ۳۶۵ روز) و `'selected'` برای strong/maybe (۳ روز). سطح آخر
  discriminating بین قفل طولانی و کوتاه است، نه خود verdict.
- `Build Query Plan` در شروع هر اجرا `sd.llmCount`/`sd.draftsCount` را null می‌کند.
- فایل `workflows/puregh-discovery.ts` بازنویسی و با esbuild بررسی شد (42.4kb)،
  همگام با n8n. تنها هشدار: `DUPLICATE_SUBNODE_CONNECTION` روی Generate Caption
  (false-positive شناخته‌شده).

#### Review Bot — کارت پیام و del دودرجه
- پیام `Send Review` سه بخش: کپشن + خط «🧠 نظر مدل» (نگاشت
  `{strong:'قوی ✅', maybe:'محتمل 🟡', reject:'ضعیف ❌'}`؛ `reason` اگر باشد) +
  زمان انتشار (فقط اگر `publish_at` دارد) + «🕒 لیست انتظار — پست تا تأیید و
  تنظیم زمان در پنل بازبینی منتشر نمی‌شود.»
- دکمه‌ها: web_app «📋 باز کردن پنل بازبینی» + «🗑 حذف از لیست» (`del:<post_id>`).
- **`del:` حالا روی `draft` و `approved` هر دو کار می‌کند**:
  `DELETE FROM posts WHERE id = $1::bigint AND status IN ('draft', 'approved');`
  (رنیم Gate: `Gate Del Status` با combinator `'or'` و `fallbackOutput='extra'`/
  `renameFallbackOutput='Not Draft'`؛ `Answer Del Not Draft`).
- **دکمه‌ی «همین الان بفرست» عمداً در ربات نمی‌آید — فقط در مینیاپ** (تصمیم
  صریح کاربر ۲۰۲۶-۰۹-۲۱). مسیرهای `del:` و `start:` بدون تغییر ماندند، فقط
  محتوای پیام/دکمه عوض شد.
- فایل `workflows/puregh-review-bot.ts` همگام (esbuild 12.8kb).

#### Publisher — claim روی draft و approved
کوئری claim حالا:
```
WHERE (status IN ('draft', 'approved') AND publish_at <= now())
   OR (status = 'publishing' AND publish_at <= now() - interval '30 minutes')
```
- `approved` به محض رسیدن اسلات منتشر می‌شود؛ `draft` لمس‌نشده‌ی بدون `publish_at`
  ابداً claim نمی‌شود (`NULL <= now()` برقرار نیست).
- تأیید از live: `approved in claim: True`. بقیه‌ی زنجیره (Send to Channel، Mark
  Published، reclaim ۳۰ دقیقه‌ای) دست نخورد. فایل `puregh-publisher.ts` همگام.

#### بک‌اند مینیاپ — approve واقعی + send-now + delete دودرجه (`routes.js`/`telegram.js`)
- `loadPost(id, statuses)` جایگزین `loadDraft`؛ پست published/rejected دیده نمی‌شود؛
  `verdict`/`verdict_reason` و `model`/`attempt` را هم برمی‌گرداند.
- `nextPublishSlot()`: آخرین slot ردیف‌های `approved`/`published` + ۲ ساعت؛ نه قبل
  از now+2h؛ نه قبل از فردا ۰۹:۰۰ تهران.
- **approve دیگر ack-only نیست**: `draft→approved` + اسلات (اگر زمان دستی نداشت) +
  ویرایش پیام ربات + ack.
- **send-now** (فقط approved): تراکنش `BEGIN` → claim اتمیک
  `UPDATE ... SET status='publishing', publish_at=now() WHERE id=$1 AND status='approved' RETURNING id`
  (۰ ردیف → 409 `already_sending`) → `sendToChannel(caption)` →
  `UPDATE ... status='published', telegram_message_id=... WHERE status='publishing'`
  → `COMMIT`. شکست تلگرام → `ROLLBACK` (پست به approved با اسلات اصلی برمی‌گردد،
  retryable). رقابت همزمان با Publisher اتمیک است. **قرارداد نهایی:**
  پست غیر-approved → **404**، درگیری همزمان → **409**، خروجی `{ok, message_id}`.
- **delete** برای `draft` و `approved` هر دو (حذف از لیست، نه رد دائمی؛ ریپو
  دست‌نخورده). **reject فقط روی draft** می‌ماند (قفل ابدی ریپو از طریق تریگر).
- caption/schedule/regen برای `approved` هم باز شد (لیست نهایی قابل ویرایش).
- `GET /api/posts/final` — لیست نهایی (فقط approved) با verdict/reason از JOIN ریپو،
  شامل پست‌های بدون زمان.
- `telegram.js`: `sendToChannel(caption)` جدید (sendMessage، HTML،
  disable_web_page_preview). `config.js` + `.env.example`: env `CHANNEL_CHAT_ID`
  (پیش‌فرض کانال `-1004481247137`).

#### فرانت مینیاپ
- `api.js`: `getFinalPosts()` + `sendNow(id)`؛ `main.jsx`: route `/final`؛
  `App.jsx`: تب دوم «لیست نهایی» با badge شمارنده (`finalCount`).
- **`pages/FinalList.jsx` (جدید)**: کارت هر پست approved — نام ریپو + زمان +
  verdict pill (قوی/محتمل/ضعیف + دلیل) + «🚀 همین الان بفرست» + «🗑 حذف از لیست»
  (مودال تأیید هر دو).
- `PostDetail.jsx`: پنل verdict زیر کپشن؛ برای approved دکمه‌ی send-now جایگزین
  approve/reject شد؛ delete همیشه دیده می‌شود؛ بک‌لینک به `/final` اگر approved.
- `styles.css`: کلاس‌های `.final-actions`, `.verdict-card`, `.verdict-tag`,
  `.notice` + دکمه‌ی send-now تمام‌عرض. بیلد Vite موفق.

#### تصمیم‌های این جلسه که قرارداد شدند
1. دکمه‌ی «همین الان بفرست» فقط در مینیاپ (لیست نهایی) — هرگز در ربات.
2. approve → `approved` + اسلات بعدی (آخرین اسلات +۲ ساعت).
3. reject → فقط draft + قفل ابدی ریپو (`human_rejected`).
4. delete → فقط حذف ردیف پست (draft **و** approved)؛ ریپو آزاد می‌ماند.
5. draft لمس‌نشده برای همیشه در لیست انتظار می‌ماند.
6. **نظر مدل (verdict + reason) در پیام ربات و مینیاپ دیده می‌شود، هرگز در کپشن
   منتشرشده نیامده.**

#### تست‌ها و وضعیت
- E2E بک‌اند (با `CHANNEL_CHAT_ID=5622960785` تا send-now به چت مالک برود نه
  کانال واقعی؛ auth با initData تلگرام self-signed): **۱۵/۱۵ پاس**، send-now →
  `message_id:158`، ردیف published + `telegram_message_id` + sync ریپو از همه.
  فیکسچرها بعد از تست پاک شدند.
- E2E فرانت زنده: فیکسچر verdict=strong → approve → اسلات فردا ۹ص تهران →
  آمدن در `/posts/final` → send-now → پیام واقعی تلگرام **message 159** به چت
  مالک → از هر دو لیست پاک شد. send-now روی پست draft → 404 درست.
- DB زنده VM (`127.0.0.1:5433`، db `puregh`): ۱ draft واقعی (id=14،
  `VoltAgent/awesome-design-md`، verdict strong)؛ rejected: 7, 8, 9؛
  published: 4, 5, 6, 13.
- گیت: **همه‌ی تغییرات uncommitted** (AGENTS.md، puregh-discovery.ts،
  puregh-review-bot.ts، puregh-publisher.ts، backend/.env.example، config.js،
  routes.js، telegram.js + فرانت + فایل جدید FinalList.jsx).

#### درس‌های فنی این جلسه
| علامت | علت/رفع |
|---|---|
| `ERR: scalar field not found: Close Run Log.query` در بیلدر ops | regex `extractScalar` فقط «' + newline» را می‌بست؛ با `readJsString` (پارس literal و دیکد escapeها) جایگزین شد |
| هشدار `INVALID_PARAMETER` روی jsCode | در n8n زنده `parameters.jsCode` باید **رشته** باشد نه آرایه → `jsCode.join('\n')` |
| هشدار `MISSING_EXPRESSION_PREFIX` | expression ها باید پیشوند `=` داشته باشند (SDK خودش اضافه می‌کند، دستی باید گذاشت) |
| کلاینت MCP بین سشن‌ها ناپدید می‌شود | `/tmp/opencode` پاک می‌شود؛ MCP سرور n8n **stateless** است (notifications/initialized → 202 با بدنه‌ی خالی)؛ کلاینت در شروع هر گام n8n بازسازی شود |
| رشته با متن فایل تطبیق نمی‌کرد | تفاوت **ZWNJ** (نیم‌فاصله) — دقیق همان متن فایل را کپی کن |
| فرانت `query_id` می‌فرستاد، بک‌اند `queryId` می‌خواند (باگ همیشگی) | helper `qid()` هر دو شکل را می‌پذیرد (اک/کپشن/send) |
| فیکسچر غلط ساخته می‌شد | `verdict` روی جدول `repositories` است نه `posts`؛ نام ستون‌ها `gh_created_at`/`gh_pushed_at`؛ `model` روی posts است |
| مرورگر تلفن/کامپیوتر برای تست در دسترس نبود | تست API زنده با همان initData + بررسی سروشدن بیلد جدید |

## ۳) محیط اجرا

- OS: EndeavourOS (Arch)، شل zsh. سخت‌افزار ضعیف: AMD A6، ۲ هسته، ۷GB RAM، بدون GPU.
  **Ollama محلی روی این سیستم جواب نمی‌دهد.**
- `sudo` رمز می‌خواهد (بدون NOPASSWD).
- VPN فعال: v2rayA با `tun0`. IP خروجی هاست و کانتینرها یکسان است.
  Gemini از این شبکه ‏403 می‌دهد (geo-block).
- `docker compose` v5.5.1 به‌صورت پلاگین کاربری نصب شد در
  `~/.docker/cli-plugins/docker-compose` (چون sudo نبود). `docker-compose` سیستمی نصب نیست.

### کانتینرها
| نام | image | نکته |
|---|---|---|
| `puregh-db` | `pgvector/pgvector:pg16` | مال همین پروژه. volume: `puregh_pgdata` |
| `n8n` | `docker.n8n.io/n8nio/n8n` v2.34.6 | مستقل (compose نیست). DB داخلی **SQLite** |
| `zamani-db` | `postgres:16-alpine` | **مال پروژه دیگری است — دست نزن** |

شبکه: `puregh-net`. کانتینر n8n با `docker network connect` به آن وصل شده.
`scripts/setup.sh` این کار را idempotent انجام می‌دهد.

### ⚠️ دو آدرس متفاوت برای یک دیتابیس
- **از داخل n8n (credential):** `puregh-db:5432`
- **از روی هاست (psql):** `127.0.0.1:5433` (چون 5432 مال zamani-db است)

اشتباه گرفتن این دو یک‌بار وقت تلف کرد. در credential ن8n **هرگز** `127.0.0.1` نگذار.

### ⚠️ باگ DNS کانتینر n8n — حل شد، ولی علتش را بدان (۲۰۲۶-۰۹-۰۵)
علامت: هر نود شبکه‌ای n8n خطای `EAI_AGAIN` می‌داد (openrouter، github، telegram،
حتی `ph.n8n.io` در لاگ خودش) **ولی `puregh-db` سالم بود**. همین تناقض گمراه‌کننده
است — آدم فکر می‌کند مشکل مال یک provider خاص است.

علت: داکر فایل `/etc/resolv.conf` کانتینر را **فقط یک‌بار، لحظه‌ی استارت** از
resolv.conf هاست می‌سازد. سر بوت لپ‌تاپ، dockerd قبل از NetworkManager بالا آمد و
هاست آن لحظه فقط nameserver لوکال داشت. پس resolver داخلی داکر (`127.0.0.11`)
هیچ upstream نگرفت. لاگ dockerd صریح گفته بود:

```
warning "DNS resolver has no external nameservers" cid=f20df218...  ← همان cid کانتینر n8n
```
و داخل کانتینر: `# NO EXTERNAL NAMESERVERS DEFINED`.

**چرا `puregh-db` سالم می‌ماند:** resolver داخلی اسم کانتینرها را خودش جواب
می‌دهد و فقط بقیه را forward می‌کند. پس نبودن upstream را کاملاً پنهان می‌کند.

**چرا `docker restart` کافی نیست:** مشکل را برای همان بوت حل می‌کند، ولی مسابقه
سر بوت بعدی تکرار می‌شود. راه دائمی `--dns` است تا کانتینر به زمان‌بندی هاست
وابسته نباشد: `scripts/recreate-n8n.sh` (با `1.1.1.1` و `8.8.8.8`، هر دو از داخل
کانتینر تست شدند). آدرس روتر عمداً استفاده نشد چون با عوض شدن شبکه تغییر می‌کند.

**چرا آن اسکریپت وجود دارد:** n8n داخل compose نیست، پس آرگومان‌های `docker run`
اش هیچ‌جا ثبت نبود جز HostConfig خود کانتینر — با `docker rm` از بین می‌رفت.
اسکریپت همان ثبت است. اگر روزی کانتینر را دستی ساختی، این شش env یادت نرود:
`TZ`، `GENERIC_TIMEZONE`، `N8N_MCP_ACCESS_ENABLED`، `N8N_MCP_MANAGED_BY_ENV`
(بی این دو MCP قطع می‌شود)، `TELEGRAM_BOT_TOKEN`، و
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (بی این، هر expression `$env` بلاک می‌شود —
اجرا ۱۲۷ ربات).

`scripts/setup.sh` حالا **یک اسم خارجی را هم صریح تست می‌کند**، نه فقط
`puregh-db` — چون همان‌طور که دیدیم رسیدن به DB هیچ چیزی درباره‌ی اینترنت ثابت
نمی‌کند.

## ۴) فایل‌های پروژه

```
docker-compose.yml          فقط DB. n8n داخلش نیست.
.env                        رمز DB (perm 600، در .gitignore)
db/schema.sql               اسکیما، idempotent، در initdb اجرا می‌شود
db/discovery-queries.sql    SQL قدم ۲ (cooldown، شباهت هدف، upsert، لاگ اجرا)
scripts/setup.sh            بالا آوردن DB + اتصال n8n به شبکه + تست DNS
scripts/recreate-n8n.sh     بازساخت کانتینر n8n با DNS ثابت (تنها ثبت آرگومان‌های run آن)
scripts/backup.sh           بکاپ DB + کلید رمز credential های n8n
scripts/up.sh               بالا آوردن کل استک لپ‌تاپ: DB → n8n → بک‌اند 3001 → build فرانت
                            → تونل‌های quick خودکار (پیش‌فرض) / --local بدون تونل (پایین، بند جدید)
workflows/*.ts              کد SDK همه‌ی workflow ها (منبع حقیقت؛ review-bot هم اینجا است)
puregh-miniapp/             مینیاپ تلگرام (فرانت React/Vite + بک‌اند Express) — §۲۳

discovery/rules.js          همه‌ی اعداد الگوریتم، با دلیل هر کدام
discovery/algorithm.js      منطق خالص، بدون عدد جادویی
discovery/queries.js        ساختن کوئری از QUERY_CLASSES + چرخش روزانه
discovery/bundle.mjs        ساخت باندل تک‌فایلی برای Code node ن8ن + تأیید صحتش
discovery/bundle.generated.js  خروجی باندل (تولیدشده — دستی ویرایش نکن)
discovery/bundle.lean.js       همان، بدون کامنت (۵۰KB جای ۱۱۳KB)
discovery/dryrun.mjs        اجرای کل فانل بدون LLM/DB/تلگرام
discovery/verify-queries.mjs  زدن ۱۴ کوئری واقعی و گزارش کوئری مرده
discovery/collect.mjs       جمع‌آوری کورپوس از GitHub API
discovery/calibrate.mjs     سنجش آستانه‌ها روی کورپوس
discovery/regression.mjs    ۳۷ فیکسچر مرجع در ۴ گروه (باید/نباید عبور کند)
```

`discovery/corpus.json` و `reference.json` در `.gitignore` هستند (حجیم و
با `collect.mjs` قابل بازتولید).

### ⚠️ مسیر فایل را نسبت به فایل اسکریپت بساز، نه به cwd
`regression.mjs` مسیر کش را `'./reference.json'` گذاشته بود. اجرا از ریشه‌ی
پروژه یک کش **دوم** در ریشه ساخت که `.gitignore` (فقط `discovery/reference.json`)
پوشش نمی‌داد، و دو کش با هم اختلاف داشتند — پاک کردن یک رکورد از فایل داخل
`discovery/` هیچ اثری نداشت چون اجرا از کپی ریشه می‌خواند. همین باگ در
`calibrate.mjs` هم بود (از ریشه اصلاً اجرا نمی‌شد). هر دو حالا
`import.meta.dirname` استفاده می‌کنند.

### ✅ `scripts/up.sh` — بالا آوردن کل استک در یک فرمان (۲۰۲۶-۰۹-۲۴)
«چطور کل پروژه را بعد از ری‌بوت بالا بیاوریم» دیگر سؤال نیست. `./scripts/up.sh`
به‌ترتیب: DB (docker compose) → n8n (فقط اگر نباشد) → بک‌اند مینیاپ :3001 →
build فرانت (فقط اگر سورس جدیدتر باشد) → **دو تونل quick** (پیش‌فرض) به 5678 و
3001. `--local` تونل‌ها را رد می‌کند. Idempotent است؛ چیزی که بالا است دست نمی‌خورد.

بخش تونل کارش را خودش می‌کند: URL تازه را از لاگ cloudflared می‌خواند، `N8N_WEBHOOK_URL`
را در `.env` و `MINIAPP_URL` را در `backend/.env` همگام می‌کند، اگر URL تغییر کرده
باشد کانتینر n8n را **بازسازی** می‌کند (env فقط موقع ساخت خوانده می‌شود) و بک‌اند
را ری‌استارت می‌کند تا MINIAPP_URL تازه را بگیرد.

**دو تله‌ی پیاده‌سازی که در تست زنده خوردیم (هر دو رفع و داخل اسکریپت مانده):**
| علامت | علت/رفع |
|---|---|
| `./.env: line 14: $'\E[1': command not found` — و خط 14 `.env` خراب شد: `N8N_WEBHOOK_URL=` + پیام `ok` با رنگ + URL | تابع `start_tunnel` پیام‌های موفقیت را در stdout می‌گفت؛ وقتی خروجی‌اش در `$(...)` گرفته می‌شود، «tunnel already running» وسط URL می‌نشیند. رفع: فقط URL در stdout، همه‌ی وضعیت‌ها در stderr (`>&2`) |
| `sed: unterminated 's' command` روی URL با جداکننده `\|` | regex با `\|` روی URL (که `/` دارد) می‌شکست. رفع: `set_env` فقط روی **کلید** regex می‌زند (حذف خط `^KEY=` با grep) و مقدار را append می‌کند — هیچ regex روی مقدار نمی‌رود |

**درس استقرار که این اسکریپت خودش حل می‌کند:** بعد از **بازسازی** کانتینر n8n
(نه restart)، تونل quick قدیمی به 5678 با `docker rm` قطع می‌شود و URL قبلی 530
دائمی می‌خورد — درست همان‌طور که تلگرام آن را با `last_error_message: "Wrong
response from the webhook: 530"` و `pending_update_count` رو به رشد نشان می‌دهد.
`up.sh` URL تازه را همه‌جا همگام می‌کند و کانتینر را بازسازی می‌کند؛ ولی **ثبت
مجدد وبوک** را دستی باید کنترل کرد (§۱۹ درس: بعد از تغییر env، unpublish→publish
یا چک getWebhookInfo). در تست ۲۰۲۶-۰۹-۲۴ بعد از بازسازی، n8n خودش وبوک را با URL
جدید setWebhook کرد (getWebhookInfo بدون دست‌کاری درست شد) — ولی برای اطمینان
همیشه getWebhookInfo را چک کن، و اگر مطابقت نداشت unpublish→publish بزن.

پروژه تحت **گیت** است (شاخه `main`، هویت repo-local: `nimux <nimux@local>`).
هفده کامیت تا ۲۰۲۶-۰۹-۱۲ — به ترتیب: `9c3507f` قدم ۱، `d8ba600` علامت‌گذاری
داده‌ی تست، `b52cfff` الگوریتم Discovery، `abe4a13` مستندسازی تغییر هدف،
`49ccd90` پیش‌نیازهای workflow سوم، `dafc7e7` ثبت هش کامیت پنجم، `aa896ab` قفل
کردن DNS کانتینر n8n و رفع بکاپ خالی، `75c30d2` اصلاح nearMiss، `df18eb4` ثبت
هش کامیت هشتم، `8937843` بخش ۲ discovery، `9a5aab5` بخش ۳ discovery، `f58cd9c`
طرح ربات تلگرام، `9e5acef` بخش ۴ discovery، `c9b3c59` درس‌های بخش ۴،
`d407af2` فاز ۸ publisher، `290bdea` env کانتینر (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`)،
`db3261e` همگام‌سازی کامل فایل .ts ربات (۵۹ نود).
remote ندارد — هنوز جایی push نشده.
بعد از هر تغییر workflow در n8n، فایل `.ts` را همگام کن و کامیت بزن.

## ۵) دیتابیس

`puregh` / user `puregh`. رمز در `.env`. اکستنشن‌ها: `vector` 0.8.6، `pg_trgm`.

دو جدول: `repositories` و `posts`.

تصمیم‌های طراحی که دلیل دارند:
- **رد شده‌ها هم ذخیره می‌شوند** — بدون این، همان ریپو فردا دوباره سهمیه LLM می‌سوزاند.
- **`verdict` سه‌حالته** (`strong`/`maybe`/`reject`) نه امتیاز ۰-۱۰۰. مدل‌ها در
  قضاوت سه‌حالته قابل‌اعتمادتر از عدد calibrated هستند.
- **ایندکس یکتای `posts_one_published_per_repo_idx`** — تضمین ساختاری ضد تکرار،
  نه منطق برنامه. تست شده که کار می‌کند.
- **تریگر `posts_sync_published`** — `repositories.published` را خودکار sync می‌کند.
- `pgvector` از روز اول فعال شد تا فاز RAG نیاز به migrate نداشته باشد.
- ویو `published_feed` برای مرور سریع.

## ۶) هفت workflow در n8n

| نام | id | کار |
|---|---|---|
| Pure GitHub — Manual Publish | `oSo3G6YhDd8603eu` | مسیر اصلی (قدم ۱) |
| Pure GitHub — Discovery | `hHSwbbOBKRIWStRU` | قدم ۲ — کشف (بخش ۱-۴؛ تریگرش از Review Bot شلیک می‌شود، نه Schedule). **طرح دو لیست (۲۰۲۶-۰۹-۲۲): ۳۰ نود — همه‌ی ۱۶ کاندیدا → draft + پیام ربات** |
| Pure GitHub — Telegram Bot | `Zro6k6d8JcAOOpfn` | ربات بازبینی (بخش ۵، فاز ۱-۸ + بازطراحی UX) |
| Pure GitHub — Review Bot | `KfWNSjAws4DQ2bjq` | **مدل B**: دریافت پست‌های discovery + کارت پیام با نظر مدل + دکمه web_app مینیاپ + del (draft/approved) + شلیک discovery |
| Pure GitHub — Publisher | `1tVlx8NwE7Qe4WWa` | زمان‌بند انتشار (فاز ۸) |
| Pure GitHub — Provider Check | `gpFQDxJSXQerF0VT` | تست هر provider سازگار OpenAI |
| Pure GitHub — Telegram Channel Check | `A3VMKNB4oVfkxHJx` | تشخیص خطای chat not found |

وضعیت active (۲۰۲۶-۰۹-۱۵، بعد از مهاجرت به VM `nimux`): **Discovery
(`hHSwbbOBKRIWStRU`)، ربات (`Zro6k6d8JcAOOpfn`) و Publisher
(`1tVlx8NwE7Qe4WWa`) هر سه فعال‌اند** — حالا روی VM `nimux` اجرا می‌شوند، نه
لپ‌تاپ. دامنه عمومی: `n8n.style.dev` (TLS rule به VM `nimux` پورت 5678).
وب‌هوک تلگرام به `https://n8n.style.dev/webhook/...` ثبت شده (تست زنده موفق).
بقیه غیرفعال. ⚠️ **Review Bot روی لپ‌تاپ ساخته و تست شده، هنوز به VM منتقل و
active نشده** — نوعش و دکمه‌هایش با workflow قدیمی ربات فرق دارد (بند «مدل B» بالا).
⚠️ **همه‌ی تغییرات طرح دو لیست (Discovery ۳۰ نود، Review Bot، Publisher) فقط روی
لپ‌تاپ است؛ VM `nimux` هنوز نسخه‌ی قدیمی Discovery را اجرا می‌کند** — مهاجرت بعد
از گام ۷ در صف است (کامیت نشده هنوز).

### زنجیره workflow اصلی
```
فرم (puregh-submit) → Parse URL → GitHub metadata → README
  → Compute Signals → Upsert Repository
  → Already Published? ─بله→ صفحه «تکراری است»
              ─خیر→ Generate Caption (LLM) → Assemble Caption
                     → Save Draft → Review Form
                       → Approve? ─بله→ Telegram → Mark Published
                                  ─خیر→ Mark Rejected
```

### اصل معماری که باید حفظ شود
**LLM هرگز عدد تولید نمی‌کند.** ستاره، زبان و لایسنس در `Assemble Caption` از
پاسخ GitHub تزریق می‌شوند. در prompt هم صریح گفته شده عدد نزن. این §۳۲ سند را از
یک توصیه به تضمین ساختاری تبدیل می‌کند — نشکنش.

## ۷) Credential ها (در n8n ساخته شده‌اند)

| نام | نوع | نکته |
|---|---|---|
| GitHub account | `githubApi` | PAT با scope فقط `public_repo` |
| AI Provider | `openAiApi` | **Base URL دلخواه** — هر provider سازگار OpenAI |
| Postgres account | `postgres` | `puregh-db:5432` |
| Telegram account | `telegramApi` | بات `@HermesNimux_robot` |

- کانال: `Pure github` / `@PureGithub` / chat id `-1004481247137`
- **مدل provider-agnostic است:** نود `lmChatOpenAi` استفاده می‌شود که در ظاهر
  OpenAI است ولی credential آن فیلد Base URL دارد. تغییر provider = عوض کردن
  credential و Model ID، بدون تغییر ساختار.
- **`Use Responses API` باید off بماند** — فقط خود OpenAI آن را دارد؛ هر gateway
  دیگری فقط `/chat/completions` کلاسیک را پیاده کرده.
- دو نود مدل: `AI Model - Primary` و `AI Model - Fallback` (با `needsFallback: true`).

## ۸) درس‌های LLM provider

- **opencode به‌عنوان provider کار نمی‌کند.** `opencode serve` یک API خصوصی
  session-management است و 401 با Basic auth می‌دهد. `opencode.ai/zen/v1` واقعاً
  gateway سازگار OpenAI است ولی اشتراک TUI شامل API نیست
  (`CreditsError: No payment method`).
- **مدل‌های `:free` در OpenRouter مرتب 429 می‌دهند.** سقف: ۲۰ در دقیقه و
  **۵۰ در روز** تا وقتی ۱۰ دلار اعتبار نخری (بعدش ۱۰۰۰ در روز).
- **JSON mode را باید تست کرد، نه فرض.** `nvidia/nemotron-3-super-120b-a12b:free`
  جواب می‌دهد ولی به‌جای JSON متن استدلال برمی‌گرداند — و نود
  `Generate Caption` به structured output وابسته است. Provider Check همین را می‌سنجد.
- مدلی که در تست‌های نهایی خوب کار کرد: `claude-opus-5`.

## ۹) باگ‌هایی که خوردیم (تکرارشان نکن)

| علامت | علت واقعی |
|---|---|
| `A 'json' property isn't an object` | Code node در `runOnceForEachItem` نباید آرایه برگرداند. همه به `runOnceForAllItems` تغییر کردند. |
| `column "topics" is of type jsonb but expression is of type text[]` | باید `$12::jsonb` با ورودی JSON string باشد |
| `could not determine polymorphic type` | `to_jsonb($12)` روی ریپوی **بدون topic** می‌شکند. با ریپوی دارای topic پنهان می‌ماند. |
| `Invalid or unexpected token` در Code node | `\n` داخل رشته single-quote به newline واقعی تبدیل می‌شود. راه‌حل: آرایه + `join(String.fromCharCode(10))` |
| caption خالی | structured parser نتیجه را زیر `output` تو در تو می‌گذارد → `$json.output ?? $json` |
| caption جعلی و کلی | prompt فقط عدد می‌گرفت، بدون نام/description/README |
| `Query Parameters must be a string...` | پاسخ تلگرام `{ok, result:{...}}` است. `chat.id` زیر `result` است. |
| `No data found from main input` | نودهای `ai_languageModel` سب‌نود هستند و main output ندارند → `.params.model.value` |
| `Bad Request: chat not found` | بات ادمین کانال نبود. توکن سالم بود. |
| `127.0.0.1:5433` در credential ن8n | از داخل کانتینر باید `puregh-db:5432` باشد |
| `EAI_AGAIN` روی **هر** اسم خارجی (openrouter، github، telegram) — ولی `puregh-db` سالم | DNS خود کانتینر n8n upstream نداشت. §۳ «باگ DNS» را ببین. |
| `Bad Request: chat_id is empty` در `Probe 4 - Identify Bot` | خودِ Channel Check است، نه باگ: «چت کنترل» را پر نکرده‌ای و Probe 4 بی‌قید اجرا می‌شود. |
| `ExpressionError: access to env vars denied` (اجرا ۱۲۷ ربات) | `N8N_BLOCK_ENV_ACCESS_IN_NODE` در n8n جدید پیش‌فرض true است. رفع: کانتینر با `=false` بازساخت. |
| `Text buttons are not allowed in the inline keyboard` (اجرا ۱۳۲ ربات) | دکمه فقط `text` داشت؛ `callback_data` در `additionalFields` مانده بود و expression آن را نمی‌دید. رفع: Render خودش دکمه را با `callback_data` در سطح خود دکمه می‌سازد. |
| `cannot extract elements from an object` (اجرا ۱۳۰ ربات) | `jsonb_array_elements($1)` آرایه می‌خواهد ولی `repoJson` آبجکت تکی بود. رفع: wrap در queryReplacement. |
| UPDATE بی‌اثر بدون خطا (publish_at در اجرای manual ربات) | postId از static data خوانده می‌شد که در manual منتقل نمی‌شود → `sched:undefined`. رفع: paired item. |
| تاریخ معتبرنما برای مقدار NULL (اجرا ۱۳۲ ربات: «۱۱ دی» = epoch) | `new Date(null)` = epoch است نه Invalid Date؛ +3:30 تهران = ۱ ژانویه ۱۹۷۰ = «۱۱ دی ۱۳۴۸» جلالی. رفع: نال‌گارد قبل از `new Date`. |
| `Bad request - please check your parameters` در `Answer *` هنگام تست | queryId ساختگیِ pin در سرور تلگرام ثبت نیست (پاسخ best-effort). اگر زنجیره به آن وابسته بود، discovery شلیک نمی‌شد. رفع: `onError: 'continueRegularOutput'` روی همه‌ی ackها. |
| متن بلند Send Review به‌عنوان رشته‌ی چندخطی خراب می‌شد (اجرا ۴۲۳) | در telegram node متن چندخطی باید با `+ '...'` در هر خط ساخته شود، نه یک رشته‌ی چندخطی. الگو: `'={{ $json.caption\n' + "  + '\\n\\n'\n..." }` |
| `Query Parameters must be a string of comma-separated values...` در Save Bot Message (اجرا ۴۲۵) | `queryReplacement` باید آرایه باشد نه رشته‌ی CSV؛ و paired item را از `.first().item.json` بخوان، نه `.json`. راه‌حل درست: `$("Send Review").first().json.result.chat.id` |
| DNS دوباره مرد (اجرا ۴۲۴) بعد از بوت | همان §۳؛ بعد از هر بوت لپ‌تاپ اگر `EAI_AGAIN` دیدی، `docker exec n8n cat /etc/resolv.conf` را چک کن و با `recreate-n8n.sh` بازساخت. |
| pin روی Telegram Trigger با wrapper `{body: ...}` | تریگر خودِ update را می‌دهد نه `body` را — pin باید خود update (با `callback_query` مستقیم) باشد. |
| دکمه‌ی web_app با MINIAPP_URL کهنه | MINIAPP_URL در `backend/.env` و `puregh-review-bot.ts` و نود n8n `Send Review` مشترک است؛ عوض کردن فقط یکی، دکمه‌ی خراب می‌دهد. هر سه را همگام نگه دار. |
| «تانل خراب» (530) | اغلب tunnel سالم است و **بک‌اند مینیاپ (پورت 3001) پایین است**. اول `ss -ltnp | rg :3001` را چک کن؛ بالا آوردن بک‌اند کافی است (cloudflared خودش می‌ماند). |
| `Unexpected end of JSON input` در add-gen | مدل‌های free orca با `json_object` گاهی `content:""` (فقط reasoning_content) برمی‌گردانند → `JSON.parse('')`. رفع: `llm.js` content خالی را retryable می‌کند تا fallback تلاش کند. |
| `ERR: scalar field not found: Close Run Log.query` در بیلدر ops | regex `extractScalar` فقط «' + newline» را می‌بست. رفع: اسکنر `readJsString` (پارس literal + دیکد `\n`/`\'`/`\"`/`\\`). |
| هشدار `INVALID_PARAMETER` روی jsCode | در n8n زنده `parameters.jsCode` باید **رشته** باشد نه آرایه → `jsCode.join('\n')`. |
| `MISSING_EXPRESSION_PREFIX` | expression ها پیشوند `=` می‌خواهند (SDK خودش می‌گذارد؛ دستی باید گذاشت). |
| کلاینت MCP بین سشن‌ها ناپدید می‌شود | `/tmp/opencode` پاک می‌شود؛ MCP سرور n8n **stateless** است (notifications/initialized → 202 با بدنه‌ی خالی). کلاینت در شروع هر گام n8n بازسازی شود؛ پارس آرگومان سه‌تایی `[cmd, name, paramsArg]`. |
| رشته با متن فایل تطبیق نمی‌کرد | تفاوت **ZWNJ** (نیم‌فاصله) — دقیق همان متن فایل را کپی کن. |
| فرانت `query_id` می‌فرستاد، بک‌اند `queryId` می‌خواند | باگ همیشگی (نه فقط این سشن). رفع: helper `qid()` هر دو شکل را می‌پذیرد. |
| فیکسچر غلط ساخته می‌شد | `verdict` روی جدول `repositories` است نه `posts`؛ نام ستون‌ها `gh_created_at`/`gh_pushed_at`؛ `model` روی posts است. |
| `send-now` پست را نمی‌فرستاد | پست باید `approved` باشد (نه draft). قرارداد: غیر-approved → 404، درگیری همزمان → 409. |
| webhook تلگرام ناپدید می‌شد بعد از recreate کانتینر | quick tunnel به 5678 (برای n8n) **با `docker rm` کانتینر قطع می‌شود** نه فقط با ری‌استارت؛ URL قبلی مرده (530 دائمی حتی با origin سالم). رفع: تونل تازه `setsid cloudflared tunnel --url http://127.0.0.1:5678 ... > /tmp/cloudflared-n8n.log &` + آپدیت `N8N_WEBHOOK_URL` و کانتینر. |
| `N8N_WEBHOOK_URL` روی آرگومان `recreate-n8n.sh` اعمال نمی‌شد | اسکریپت `.env` را `set -a; . ./.env` می‌خواند و مقدار .env بر متغیر محیطی override می‌شود. رفع: **`.env` را عوض کن**، نه env آرگومانی. `.env` منبع حقیقت `N8N_WEBHOOK_URL` است. |
| `$'\E[1': command not found` روی `./.env` — `.env` خراب شد (`N8N_WEBHOOK_URL=` + پیام `ok` رنگی + URL) | `start_tunnel` پیام‌های موفقیت را به stdout می‌گفت؛ وقتی با `$(...)` captured می‌شود، «tunnel already running» وسط URL می‌نشیند. رفع: فقط URL در stdout، همه‌ی وضعیت‌ها در stderr `>&2` |
| `sed: unterminated 's' command` روی `set_env` با جداکننده‌ی `\|` | regex با `\|` روی مقدار (URL دارای `/`) می‌شکست. رفع: `set_env` فقط روی **کلید** regex می‌زند (`grep -vE '^KEY='` + append) — هیچ regex روی مقدار نمی‌رود |


## ۱۰) قالب Caption (نسخه فعلی — تأییدشده)

```
{ایموجی} <b>{نام} — {توضیح چندکلمه‌ای}</b>

{یک جمله معرفی}

{یک یا دو جمله: چه فرقی با بقیه دارد}

👥 {۲ تا ۳ مخاطب}

⭐ {ستاره}   💻 {زبان}   📜 {لایسنس}

{URL خام}
@{سازنده}
```

قواعدی که کاربر صریحاً خواست:
- بخش «چه کاری انجام می‌ده» **حذف شد**. زیرعنوان‌های bold هم حذف شدند.
- لحن: **مثل صحبت دو دوست صمیمی**. در prompt فهرست صریح داده شده —
  بله: «رو می‌گیره»، «می‌تونی»، «خودت» / نه: «می‌باشد»، «جهت استفاده»، «راهکاری جامع»
- **ایموجی آغازین رندوم** از ۱۲ گزینه، با هش نام ریپو (deterministic —
  اگر پیش‌نویس بازتولید شود همان ایموجی می‌آید و مقایسه ممکن است).
- سقف طول در سطح فیلد: title ۶۰، hook ۱۴۰، why_interesting ۲۲۰، جمع زیر ۴۲۰.
  (قبل از این، پست‌ها ۱۷۰۰ کاراکتر می‌شدند.)
- زبان/لایسنس اگر نبود، کل آن بخش حذف می‌شود (نه چاپ خط تیره).
- شعار انگلیسی README هرگز کلمه‌به‌کلمه ترجمه نشود.

طول‌های واقعی: قبل ۱۷۰۶ و ۱۳۵۲ → بعد ۴۲۴ و ۴۶۰ کاراکتر.

## ۱۱) فرم بازبینی

Caption **رندرشده** نشان داده می‌شود، نه داخل `<pre>`. تمپلیت ن8n
(`form-trigger.handlebars` خط ۴۸۶) با `{{{formDescription}}}` بدون escape رندر
می‌کند و sanitizer آن `b/i/a/br/...` را مجاز می‌داند. پس همان HTML تلگرام
مستقیم پاس داده می‌شود. فیلد `caption_preview` علاوه بر متن، URL را قابل‌کلیک
می‌کند و یک خط جداکننده + verdict مدل با فونت کوچک ایتالیک اضافه می‌کند.
`customCss` هم RTL و ظاهر کارت‌مانند می‌دهد.

## ۱۲) روش کار با n8n (مهم)

- **همیشه از MCP استفاده کن**، نه ویرایش دستی sqlite.
- ترتیب اجباری: `get_workflow_sdk_reference` → `get_node_types` →
  `validate_node_config` → `validate_workflow` → `create/update`.
- برای تغییر نود موجود: `updateNodeParameters`. **هرگز** `removeNode` + `addNode`
  (سب‌نودهای AI قطع می‌شوند و خودکار وصل نمی‌شوند).
- `execute_workflow` با `{ type: 'form', formData: {...} }` — `formData` آبجکت است نه آرایه.
- خروجی `get_workflow_execution` با `includeData: true` معمولاً حجیم است:
  از `nodeNames` و `truncateData` استفاده کن.
- فایل‌های `workflows/*.ts` را همگام نگه دار. n8n منبع حقیقت اجراست ولی
  کد قابل بازسازی و review است.

### ⚠️ فایل `puregh-manual-publish.ts` با n8n drift دارد
اگر از فایل بازسازی شود **می‌شکند**:
- خط ۱۴۱ به `topics` ارجاع می‌دهد که در فایل تعریف نشده (در n8n تعریف شده).
- مدل: فایل `z-ai/glm-5.2:free` / n8n `claude-opus-5`.
- نام credential: فایل `PureGitHub DB` و `GitHub` / n8n `Postgres account` و
  `GitHub account`.

هنوز اصلاح نشده. اگر خواستی از فایل deploy کنی، اول اینها را درست کن.

## ۱۳) الگوریتم Discovery (قدم ۲ — هسته سیستم)

کد: `discovery/rules.js` (اعداد) + `discovery/algorithm.js` (منطق) +
`discovery/queries.js` (ساختن کوئری).
**هیچ عددی در `algorithm.js` و `queries.js` نیست** — همه از `rules.js` خوانده
می‌شوند. `validateRules()` در import سازگاری وزن‌ها را چک می‌کند و اگر جمعشان
غلط باشد throw می‌کند.

### سقف ستاره حذف شد — با اندازه‌گیری، نه با نظر
نسخه‌ی اول سقف ۴۰۰۰ ستاره داشت. تست روی ۶۰ ابزار دور زدن فیلترینگ:
**۶۰ از ۶۰ رد شدند** — شامل sing-box (37k)، hiddify-app (32k)، v2rayA (15k).
یعنی آن قاعده مفیدترین دسته برای مخاطب را کامل حذف می‌کرد.

### شش خط (Lane) — ریپو کافی است در یکی جا بگیرد
| خط | کف ستاره | سقف ستاره | سن | حداکثر بی‌کاری | سهمیه |
|---|---|---|---|---|---|
| `iran_relevant` | ۲۰ | **ندارد** | ≥۱۴ روز | ۴۰۰ روز | ۳ |
| `ai_agents` | ۸۰ | ندارد | ≥۱۴ روز | **۱۲۰ روز** | ۳ |
| `trending` | ۲۰۰ | ندارد | ۷ تا **۹۰ روز** | ۳۰ روز | ۲ |
| `hidden_gem` | ۵۰ | **۴۰۰۰** | ≥۲۱ روز | ۳۶۵ روز | ۳ |
| `established` | ۱۵۰۰ | ندارد | ≥۱۸۰ روز | ۲۴۰ روز | ۲ |
| `curated_list` | ۳۰۰ (ایرانی ۱۰۰) | ندارد | ≥۹۰ روز | ۳۰۰ روز | ۱ |

- `LANE_PRIORITY` تعیین می‌کند ریپوی چندخطی به کدام سهمیه شمرده شود.
- سهمیه‌ها **سقف‌اند نه تعهد**: جمعشان ۱۴ ولی `finalSelectionSize` هشت است، تا
  خشک شدن یک خط باعث کم شدن کل اجرا نشود.
- `ai_agents` سخت‌گیرترین حد بی‌کاری را دارد چون آن حوزه تند حرکت می‌کند.
- کف `ai_agents` بالاست (۸۰) چون `topic:mcp` را تست کردم: از ۴۰ ریپوی فعال،
  ۳۴ تا زیر ۵۰ ستاره بودند.

### سقف سن ۹۰ روز برای `trending` — یک حفره‌ی واقعی بسته شد
کامنت قبلی می‌گفت «در این خط، سرعت میانگین عمر دقیق است چون ریپوی ترند ذاتاً
جوان است». این استدلال دوری بود: **هیچ قاعده‌ای آن را جوان نمی‌کرد.**
اندازه‌گیری روی کورپوس: از ۷۶ عضو این خط، ۱۰ تا بالای ۶۰ روز سن داشتند، از جمله
`golang/go` (۴۴۰۱ روز، سرعت میانگین ۳۱ ستاره در روز، ۱۳۷k★) و
`Homebrew/brew` (۳۸۳۵ روز). هیچ‌کدام ترند نیستند — پروژه‌های عظیم قدیمی‌اند که
**میانگین عمرشان** تصادفاً بالای ۱۲ است. همان نقصی که `MOMENTUM_NOTE` هشدار
می‌داد، در تنها خطی که فرض شده بود مصون است.

۹۰ روز نه ۶۰: کوئری ترند `created:<60d` می‌خواهد، پس سقف ۶۰ روی مرز خودِ کوئری
می‌افتاد. تست شد: با سقف ۶۰، دو ریپو به **هیچ خطی** نمی‌رسیدند (۷k ستاره در ۶۰
روز، بالاتر از سقف `hidden_gem` و پایین‌تر از کف سنی `established` — همان
`LANE_COVERAGE_NOTE`). با ۹۰، هر ۸ ریپوی جابه‌جاشده در `established` می‌نشینند
که جای درستشان است.

### دو لایه‌ی امتیاز، با دو آستانه‌ی جدا (اصل مهم)
```
کیفیت (۰..۱۰۰)   craft 45 · attention 20 · aliveness 20 · adoption 15
تناسب (۰..+۵۰)   ایران +25 · AI +15 · سازنده ایرانی +10
```
دو آستانه جداست: `minQualityForLlm=55` روی **کیفیت تنها** و
`minTotalForLlm=70` روی جمع. **بوست ایران هرگز نمی‌تواند ریپوی بدساخت را نجات
دهد.** اگر یک عدد بودند، به‌تدریج پروژه‌های بی‌کیفیت ایرانی وارد کانال می‌شدند.

`craft` بزرگ‌ترین سهم است چون قوی‌ترین جداکننده‌ی قطعی است. تست نشان داد بین
۱۲ کاندیدای برتر، **همه** سیگنال‌های رایگان (description/topics/license) را
کامل داشتند — یعنی فقط README تفکیک می‌کند. برای همین دو مرحله‌ای است:
`scoreStageA` (فقط متادیتا، روی ~۱۰۰۰ ریپو) و `scoreStageB` (با README، روی ۱۲۰).

### آستانه‌ها کالیبره شده‌اند، حدس نیستند
۱۰۷۵ ریپوی واقعی جمع شد، **با چهار کوئری عمداً آشغال** (کانفیگ VPN، کرک،
tutorial، انبار پرامپت). تراکم آشغال در هر باند:
```
<۴۰: ۳۳٪    ۵۰-۶۰: ۲۴٪    ۷۰-۸۰: ۱۰٪ ← ریزش
۴۰-۵۰: ۳۸٪  ۶۰-۷۰: ۲۷٪    ۹۰-۱۰۰: ۳.۵٪
```
زانوی نمودار بین ۶۰-۷۰ و ۷۰-۸۰ است → `minTotalForLlm = 70`.

`minQualityForLlm = 55` با بررسی چشمی: در آستانه ۷۰، یازده ریپو با کیفیت زیر ۶۰
فقط با بوست ایران عبور کردند. مخلوط بود — ابزار فارسی واقعی (Vajehdan،
laravel-persian-string) کنار چیزهای نامناسب (جزوه، لیست رنگ برند). ۵۵ اولی را
نگه می‌دارد.
**بالاتر بردنش غلط است:** آن ابزارهای فارسی ۲۰-۷۴ ستاره دارند و ابزار niche
کوچک ذاتاً امتیاز adoption بالا نمی‌گیرد. امتیاز کیفیت ساختاراً همان ریپوهایی
را کم‌ارزش می‌شمارد که هدف کانال‌اند.

### انبار کانفیگ: جریمه، نه رد کامل
کاربر خواست «خیلی جریمه کن». اول رد کامل گذاشتم، ولی تست نشان داد
**hiddify-app و v2rayA و Sub-Store را اشتباهی رد می‌کرد** — چون توضیح یک کلاینت
واقعی («supporting VLESS, Trojan...») از توضیح یک انبار قابل تفکیک نیست.

راه‌حل: `PENALTIES.configDumpPerPoint = 35` به ازای هر واحد اطمینان.
نتیجه روی داده‌ی واقعی: `clashfree` −۱۷۵، `Free-servers` −۱۴۰،
`clash-rules` −۱۰۵، `Iran-v2ray-rules` −۱۴۰. عملاً هرگز منتشر نمی‌شوند.
`validateRules()` تضمین می‌کند حداکثر جریمه از حداکثر امتیاز ممکن بیشتر باشد.

**تفکیک انبار کانفیگ از فهرست منتخب:** امتیاز `CONFIG_DUMP_SIGNALS` —
بی‌زبان **۱** + الگوی نام ۲ + الگوی موضوع ۱ + **الگوی توضیح ۲**، آستانه ۲.
الگوی توضیح لازم شد چون انبارهایی که زبان واقعی دارند (اسکریپت جمع‌کننده کد
واقعی است) از سه سیگنال دیگر فرار می‌کردند.

### «بی‌زبان» از ۲ به ۱ آمد — با اندازه‌گیری
با ۲ امتیاز، «GitHub زبانی تشخیص نداد» **به‌تنهایی** به آستانه می‌رسید. یعنی هر
ریپوی بدون کد انبار کانفیگ شمرده می‌شد: از ۱۸۷ ریپوی علامت‌خورده در کورپوس،
**۱۳۱ تا فقط با همین یک سیگنال** علامت خورده بودند — و آن گروه دقیقاً برعکس
انبار است:
`barnamenevisi/free-resources` (۱۲۶۶★، آرشیو منابع آموزش فارسی)،
`Hameds/APIs-made-in-Iran` (۲۱۳۸★)، `VahidN/nuget-net-melli-mirrors`
(آینه‌ی NuGet برای توسعه‌دهنده‌ی ایرانی). چهارتایشان با جریمه‌ی ناحق −۳۵ به
دروازه‌ی LLM رسیده بودند.

بی‌زبان بودن **شاهد است، ولی شاهد ضعیف**: فهرست منتخب، مستندات، دیتاست و انبار
کانفیگ همه بی‌زبان‌اند. با ۱ امتیاز فقط تأیید می‌کند، تصمیم نمی‌گیرد. هر ۹
انبار شناخته‌شده همچنان رد می‌شوند (چون همه‌شان حداقل دو سیگنال دیگر دارند) و
علامت‌گذاری کورپوس از ۱۸۷ به ۵۶ رسید. `validateRules()` حالا صریح چک می‌کند
که این سیگنال تنها به آستانه نرسد.

### انبار پرامپت — بزرگ‌ترین نشتی که پیدا شد
کورپوس یک کوئری عمداً آشغال `chatgpt prompts` دارد. از ۸۸ ریپویش،
**۲۷ تا (۳۱٪) به دروازه‌ی LLM رسیدند** — در مقابل ۰٪ برای انبار کانفیگ و ۵٪ برای
tutorial. `AI_BOOST.slopPatterns` فقط روی ۳ تا از آن ۲۷ فعال شد.

چرا نباید منتشر شوند: نرم‌افزار نیستند (چیزی برای نصب و اجرا وجود ندارد)،
با عوض شدن مدل‌ها می‌پوسند، و چند مورد مجموعه‌ی jailbreak اند
(`0xk1h0/ChatGPT_DAN`، `BlackTechX011/HacxGPT-Jailbreak-prompts`) که معرفی‌شان
یعنی تأییدشان. امتیاز خوب می‌گیرند **چون ارائه‌شان راحت است**: README بزرگ،
ستاره‌ی زیاد، موضوع‌های واقعی.

`PROMPT_DUMP_SIGNALS` جداست، به همان دلیلی که `CONFIG_DUMP_SIGNALS` جداست:
مسئله تفکیک از **ابزار واقعی در همان فضا** است. `kardolus/chatgpt-cli`،
`czhou578/llm-god` و `win4r/AISuperDomain` ابزار واقعی‌اند و توضیحشان پر از
«chatgpt» و «prompt» است. تطبیق یک کلمه آنها را نابود می‌کند؛ امتیاز چندسیگنالی
نه. نام ۲ + توضیح ۲ + بی‌زبان ۱، آستانه ۳ (پس بی‌زبان هرگز به‌تنهایی کافی نیست).
جریمه `promptDumpPerPoint = 30`.

روی ۱۸ انبار و ۹ ابزار برچسب‌خورده‌ی دستی: **۱۶ از ۱۸ تشخیص، صفر خطای مثبت.**
دو مورد باقی‌مانده گالری تصویر پرامپت‌اند که توضیحشان مثل فهرست منتخب معمولی
است — گرفتنشان الگوی آنقدر فراخ می‌خواهد که به فهرست‌های واقعی هم بخورد، و
فهرست منتخب یک خط مجاز است. امتیاز ۲ می‌گیرند، پس جریمه‌ی نسبی می‌خورند.
نشتی این کوئری از ۳۱٪ به ۱۲.۵٪ رسید و باقی‌مانده‌اش تقریباً همه ابزار واقعی‌اند.

### باگ جمع (`s?`) — ششمین مورد از همان خانواده
`compile()` با `(?![a-z0-9])` مرز می‌گذارد و «s» جزء `[a-z]` است، پس هر جمعی از
الگو فرار می‌کند: `tutorial` می‌گرفت ولی `tutorials` نه. هزینه‌ی همین یک حرف:
از ۹ ریپوی tutorial که به دروازه رسیدند، **۴ تا دقیقاً به این شکل نام‌گذاری شده
بودند** (`luuquangvu/tutorials`، `deepset-ai/haystack-tutorials`،
`triton-inference-server/tutorials`، `ChristianLempa/boilerplates`) و هیچ
جریمه‌ای نخوردند. جمع نوشتن نام مخزن tutorial قاعده است نه استثنا. حالا همه‌ی
اسم‌ها در `LEARNING_PROJECT_PATTERNS` صریح `s?` دارند؛ نشتی از ۹٪ به ۵٪ رسید.

### تشخیص سازنده‌ی ایرانی تقریباً کار نمی‌کند — و راه‌حلش
ده مِینتینر ایرانی شناخته‌شده را از GitHub API چک کردم. **فقط یکی**
(`majidh1` = "Tehran") فیلد `location` قابل استفاده داشت. `rastikerdar`،
`roshan-research`، `hezarai`، `sajaddp`، `shahabyazdi`، `talkhabi` همه `null`.
`1995parham` = "Barcelona" و `mohebifar` = "Sunnyvale, CA" (دیاسپورا).

تشخیص فارسی در README هم ضعیف است: `hiddify-app` در ۱۱.۵KB فقط **۵ حرف فارسی**
دارد، `s-ui` صفر. اکثر ایرانی‌ها README را انگلیسی می‌نویسند.

**پس اهرم اصلی سمت کوئری است، نه تشخیص.** `QUERY_CLASSES.iran` مستقیم
موضوع‌های ایرانی را جست‌وجو می‌کند (`topic:iran` = ۸۸۲ ریپو،
`topic:persian` = ۱۶۷۷). به‌علاوه لیست دستی ۲۵ مِینتینر در
`IRANIAN_CREATOR.knownOwners` — **وقتی ایرانی جدیدی دیدی به آن اضافه کن.**

### مشکل ۱۰۰۰ نتیجه‌ی GitHub (چرا کوئری‌ها اینطوری‌اند)
GitHub search **حداکثر ۱۰۰۰ نتیجه** برمی‌گرداند. پس یک کوئری فراخ مرتب بر ستاره
هر بار همان سرِ معروف را می‌دهد — عکس discovery. راه‌حل: sharding باند ستاره ×
زبان/موضوع + چرخش sort + dedup با DB.

**کوئری‌ها کنترل واقعی‌اند، نه فیلترها.** اندازه‌گیری: فیلترهای قطعی ۸۷٪ از
آنچه کوئری برمی‌گرداند را عبور می‌دهند، چون خود کوئری باند ستاره و تاریخ را
اعمال کرده. تخصیص: ایران ۴، AI ۳، ندیده‌شده ۳، ترند ۲، قدیمی ۱، فهرست ۱.

### ⚠️ `topic:a OR topic:b` کار نمی‌کند — ۴۲۲ می‌دهد
پیام دقیق GitHub:
> The search contains only logical operators (AND / OR / NOT) without any search
> terms. Logical operators only apply to text, not to qualifiers.

شکل درست **کاما** است: `topic:a,b` و واقعاً **اجتماع** است. عددی تأیید شد:
`topic:jalali` = ۵۲، `topic:persian-calendar` = ۴۷، کاما = ۹۰، و اشتراک (فاصله،
یعنی AND) = ۹. دقیقاً ۵۲ + ۴۷ − ۹ = ۹۰.

**این سلیقه‌ی نگارشی نیست:** پنج کوئری از هجده کوئری `collect.mjs` در
کالیبراسیون اول **بی‌صدا هیچ نتیجه‌ای نداده بودند** (`iran_circumv`،
`iran_censor`، `ai_mcp`، `ai_agents`، `ai_llm` — همه با OR). یعنی هر ریپویی که
در آن کورپوس به خط `ai_agents` نسبت داده شده بود، از راه یک کوئری دیگر تصادفاً
آمده بود. `verify-queries.mjs` برای همین نوشته شد: هر ۱۴ کوئری را واقعاً می‌زند
و کوئری مرده را نشان می‌دهد.

### چرخش (`ROTATION`) — چرا کوئری ثابت بی‌فایده است
هر کوئری حداکثر ۱۰۰۰ نتیجه دارد و اجرا فقط ۱۰۰ تای اول را می‌خواند. پس مجموعه‌ی
کوئری ثابت **هر روز همان ۱۰۰ ریپو** را می‌خواند و بعد از اجرای اول، هر اجرای
بعدی دور ریختن وقت است.

seed **شماره‌ی روز** است، نه تصادفی و نه شمارنده‌ی ذخیره‌شده: قابل بازتولید
(اجرای خراب دقیقاً تکرار می‌شود)، بی‌حالت (چیزی ذخیره نمی‌شود)، یکنوا (دو روز
پشت‌سرهم هرگز یکی نمی‌شوند).

دو باگ که `rotationCoverage()` پیدا کرد:
1. **۲۷ موضوع از ۵۴ ابدی دست‌نیافتنی بودند.** ایندکس shard از `step` می‌آمد، ولی
   موضوع فقط وقتی انتخاب می‌شد که `step % 2 === 1` باشد؛ با اندازه‌ی زوج (۵۴)
   ضریب فرد فقط روی خانه‌های فرد می‌افتد. راه‌حل: `Math.floor(step / kinds.length)`
   تا هر نوع شمارنده‌ی متراکم خودش را داشته باشد.
2. **دو سوم بودجه‌ی `hidden_gem` هدر می‌رفت.** با `seed + i` و count=3، روز N
   گام‌های N,N+1,N+2 و روز N+1 گام‌های N+1,N+2,N+3 را می‌گرفت — دو تا از سه
   کوئری بایت‌به‌بایت تکرار دیروز. راه‌حل: گام بلوکی `seed * count + i`.

نتیجه‌ی نهایی: **۰ از ۱۴ کوئری در دو روز متوالی تکرار می‌شود**، و در ۱۲۰ اجرا
هر ۲۳ زبان و هر ۵۴ موضوع دیده می‌شوند.

### کوئری ترند: بازه‌ی جدا، نه زیرمجموعه
اول `created:>60d` و `created:>20d` نوشتم — دومی زیرمجموعه‌ی اولی است. اندازه‌گیری:
۱۶۳۵ و ۲۷۱ نتیجه، با ۱۲ ریپوی مشترک در ۱۰۰ تای اول. با `created:A..B` بازه‌ها
اصلاً هم‌پوشانی ندارند. تقسیم هندسی است نه خطی (۶۰-۲۰ و ۲۰-۰) چون بیشتر چیزی که
ارزش گرفتن دارد تازه است.

### `topic:rtl` را از کوئری ایران برداشتم — ۶۲٪ سخت‌افزار بود
در سخت‌افزار، RTL یعنی Register Transfer Level. روی ۱۰۰ نتیجه‌ی اول
`topic:rtl stars:20..*`: **۶۲ پروژه‌ی سخت‌افزاری** (Chisel، Verilator،
rocket-chip، OpenROAD) و فقط ۳۸ مورد راست‌به‌چپ. یعنی ۶۲٪ صفحه‌ی ۱۰۰نتیجه‌ای
خرج طراحی چیپ می‌شد.

ولی به‌عنوان **موضوع امتیازدهی** بی‌خطر است و در `IRAN_RELEVANCE.tier2Topics`
ماند: یک ریپوی سخت‌افزاری که +۱۵ می‌گیرد باز باید خودش از دروازه‌ی کیفیت رد شود.
جایگزین‌ها همه با جمعیت واقعی سنجیده شدند: `persian-language` ۴۸، `hijri` ۳۵،
`right-to-left` ۲۵، `shamsi` ۱۹، `bidi` ۱۲. و `rtl-layout` (۰)،
`farsi-language` (۱)، `iran-tech` (۰) خالی بودند و حذف شدند.

### استثنای «تمام‌شده نه رهاشده» (`idleForgiveness`)
`rastikerdar/vazirmatn` (فونت استاندارد فارسی، ۳۱۸۸★) ۱۱۷۹ روز دست‌نخورده بود و
رد می‌شد. ولی یک فونت **تمام‌شده** است. همین پروژه در فرم بازبینی خودش از آن
استفاده می‌کند. پس دو خط (`iran_relevant` و `curated_list`) استثنا دارند: بالای
یک کف ستاره، بی‌کاری طولانی‌تر تحمل می‌شود. امتیاز `aliveness` همچنان جریمه
می‌کند، پس با ضرر رقابت می‌کند نه اینکه حذف شود.

### ⚠️ بودجه باید per-lane باشد — وگرنه چهار خط از شش خط گرسنه می‌مانند
مهم‌ترین چیزی که `dryrun.mjs` پیدا کرد. مرتب‌سازی سراسری بر اساس `total` غلط است،
چون بوست تناسب جزو total است و فقط دو خط می‌توانند بگیرندش. میانگین روی ۸۰۱
ریپوی eligible:
```
iran_relevant  کیفیت ۵۳.۶  تناسب +۲۵.۱
ai_agents      کیفیت ۴۸.۸  تناسب +۱۵.۰
curated_list   کیفیت ۵۹.۱  تناسب  +۷.۸
established    کیفیت ۶۳.۱  تناسب  +۰.۵   ← بالاترین کیفیت، و باز می‌بازد
trending       کیفیت ۵۰.۵  تناسب  +۰.۲
hidden_gem     کیفیت ۴۳.۷  تناسب  +۰.۴
```
اثر واقعی: ۱۲۰ تای برتر سراسری شد ایران ۹۹ / AI ۱۶ / فهرست ۵ و **صفر** برای
ترند و hidden_gem و established. بهترین ریپوی ترند رتبه‌ی ۱۸۲ و بهترین
established (`gunicorn`) رتبه‌ی ۲۰۶ بود — README شان هرگز گرفته نمی‌شد و بودجه‌ی
کوئری و `LANE_QUOTA` شان تزئینی بود.

این باگ امتیازدهی نیست: `established` **بالاترین** میانگین کیفیت را دارد و باز
می‌بازد، چون ساختاراً نمی‌تواند بوست بگیرد. خطا این است که total بوست‌دار را با
total بی‌بوست در دو خط مختلف مقایسه کنیم. lane ها وجود دارند چون «ندیده‌شده» و
«ترند» روی یک محور قابل مقایسه نیستند — همان استدلال باید به بودجه هم تعمیم پیدا
کند، نه فقط به منحنی attention.

**و یک‌بار کافی نبود.** بعد از درست کردن بودجه‌ی README، خود `select()` هنوز
استخر per-lane را با حرص سراسری می‌خورد: از ۳۲ عضو استخر، ۱۶ اسلات از بالا پر
شد (ردیف ۱-۱۰ ایران، ۱۱-۱۸ فهرست و AI، ۱۹-۲۰ established) و اولین ردیف ترند
رتبه‌ی ۲۷ بود → دوباره صفر. پس **پیمایش** هم باید per-lane باشد. حالا سه پاس
دارد: هر خط سهم خودش را از رتبه‌بندی خودش پر می‌کند، بعد اسلات‌های بی‌صاحب
سراسری رقابت می‌شوند، بعد اگر باز جا خالی بود سقف‌های تنوع نادیده گرفته می‌شوند
(اسلات خالی از یازدهمین ابزار Python بدتر است).

### COOLDOWN — تنها چیزی که اجرای تکرارشونده بدون آن کار نمی‌کند
امتیازها روزبه‌روز تقریباً ثابت‌اند: ریپویی که امروز ۱۱۸ گرفته، فردا هم ~۱۱۸
می‌گیرد. پس اجرای روزانه‌ی بی‌قید **همان هشت ریپوی بالا را ابدی انتخاب می‌کند** و
تمام بودجه‌ی LLM را خرج قضاوت دوباره‌ی دیروز می‌کند. ذخیره‌ی رد شده‌ها در
`schema.sql` فقط جلوی INSERT دوباره را می‌گیرد، نه جلوی خرج شدن سهمیه.

پس cooldown به تفکیک نتیجه است، چون اطلاعات هر نتیجه فرق دارد:
| نتیجه | cooldown | دلیل |
|---|---|---|
| `humanRejected` | **هرگز** | قوی‌ترین سیگنال سیستم؛ آدم دیده و نه گفته |
| `published` | هرگز | ایندکس یکتا هم جلویش را می‌گیرد |
| `llmRejected` | ۳۶۵ روز | نظر مدل با گذشت هفته عوض نمی‌شود، ولی ریپو می‌تواند بازنویسی شود |
| `nearMiss` | ۳۰ روز | **گروهی که باید برگردد** — در حال رشد به سمت آستانه است |
| `notSelected` | ۳ روز | اشکالی نداشت، فقط هشتم در میدان هشت‌نفره بود |
| `softReject` | ۴۵ روز | حالت است نه حکم: بی‌کاری، README نداشتن، ستاره‌ی کم |
| `permanentReject` | هرگز | آرشیو، فورک، قالب، دزدی، انبار — فقط حافظه‌ی dedup |

`REJECT_PERMANENCE` صریح می‌گوید کدام دلیلِ رد دائمی است و کدام موقت، تا اضافه
شدن یک دلیل جدید مجبور به تصمیم‌گیری آگاهانه باشد.

**تست شد:** پنج اجرای پشت‌سرهم با شبیه‌سازی نتیجه‌ی هر روز →
**۰ کاندیدای تکراری بین اجراهای متوالی** و ۴۰ پست شبیه‌سازی‌شده. بدون
شبیه‌سازی نتیجه، تست چندروزه بی‌معنی است چون دنیای اجرا عوض نمی‌شود.

### ⚠️ `nearMiss` فقط برای امتیازی که README را دیده (۲۰۲۶-۰۹-۰۶)
نسخه‌ی اول `outcomeOf()` هر ریپوی زیر ۷۰ را nearMiss می‌شمرد و ۳۰ روز قفل
می‌کرد. غلط بود: امتیاز **مرحله A** بدون README حساب می‌شود، پس ساختاراً
پایین‌تر است و با آستانه‌ای که برای امتیاز دارای README کالیبره شده قابل
مقایسه نیست.

اندازه‌گیری روی ۷۷۸ ریپوی کورپوس که هر دو مرحله را گرفتند:
```
میانگین (B − A) = +۲۱.۷ امتیاز    صدک ۱۰/۵۰/۹۰ = +۱۲.۳ / +۲۴.۰ / +۳۳.۰
فقط ۴ ریپو از ۷۷۸ با README امتیاز کمتر گرفت
از ریپوهای زیر ۷۰ در مرحله A: ۲۴۹ تا با README از ۷۰ عبور کردند، ۳۴۳ تا نه → ۴۲٪
```
در هر اجرا ~۸۰۱ ریپو مرحله A را رد می‌کنند ولی فقط ۱۲۰ تا README می‌گیرند، پس
~۶۸۱ ریپو فقط با متادیتا امتیاز خورده‌اند. با قاعده‌ی قبلی **۵۵۱ تای‌شان ۳۰ روز
قفل می‌شدند** و ~۴۲٪ آنها واقعاً واجد شرط بودند. الگوریتم بهترین کاندیداهای
خودش را یک ماه دفن می‌کرد.

اثرش در تست ۵ روزه‌ی `--offline --days 5` کاملاً دیده می‌شود:
```
              اجرا ۴            اجرا ۵
قبل:  ۲۳۴ eligible (۲۲٪)   ۱۱۴ eligible (۱۱٪)   ← ۵۵۱ ریپو قفلِ nearMiss
بعد:  ۷۸۳ eligible (۷۳٪)   ۶۶۴ eligible (۶۲٪)   ← صفر nearMiss ناحق
```
هر دو حالت ۲۴ پست دادند (چون سقف ۱۶ کاندیدا است)، ولی در حالت قبل استخر انتخاب
به یک‌پنجم آب رفته بود — یعنی کیفیت هشت پست، نه تعدادشان، قربانی می‌شد.

راه‌حل: `COMPARABLE_SCORE_STAGES = ['b','llm','selected']` در `rules.js`.
`outcomeOf()` فقط وقتی nearMiss می‌دهد که `last_stage` در آن فهرست باشد؛
بقیه `notSelected` با ۳ روز می‌مانند. امتیاز همچنان ذخیره می‌شود (تنها سابقه‌ی
روند ریپو است) ولی قفل طولانی را فعال نمی‌کند.

سه جا همگام شدند و هر سه تست شدند:
- `algorithm.outcomeOf()` — ۹ حالت دستی چک شد (`b/60` → nearMiss،
  `a/60` → notSelected، `null/60` → notSelected).
- کوئری ۱ در `db/discovery-queries.sql` — همان ۹ حالت با فیکسچر روی DB واقعی:
  `cooldown-near-miss` فقط برای `b`/`llm`/`selected`.
- `validateRules()` — اگر کسی `'a'` را به فهرست اضافه کند یا خالی‌اش کند throw
  می‌کند (هر دو تست شدند).

`dryrun.mjs` هم حالا `last_stage` را شبیه‌سازی می‌کند، وگرنه تست چندروزه
بی‌معنی می‌شد: بدون ستون stage همه‌ی امتیازهای پایین nearMiss به نظر می‌رسند و
اجرا **بهتر** از واقعیت گزارش می‌شود.

### تشخیص تکرار هدف: دو سیگنال، چون تک‌سیگنال شکست خورد
اول فقط `similarity()` روی description با آستانه ۰.۴۵ بود. روی همان جفت‌هایی که
این قاعده برایشان نوشته شده:
```
v2rayA ~ v2rayN         ۰.۳۲
hiddify-app ~ v2rayN    ۰.۲۲
hazm ~ shekar           ۰.۱۷   (دو کتابخانه‌ی NLP فارسی)
s-ui ~ Hiddify-Manager  ۰.۰۴   (دو پنل sing-box)
```
**هیچ‌کدام به ۰.۴۵ نرسید.** دو ابزار می‌توانند کار یکسان کنند و با کلمات کامل
متفاوت توصیفش کنند. پایین آوردن آستانه هم حلش نمی‌کند: روی ۷۶۲ ریپو، ۰.۴۵ تعداد
۵۶ جفت و ۰.۲۵ تعداد ۶۲۴ جفت علامت می‌زند، و آنهایی که می‌گیرد **متن قالبی** اند —
«Free V2ray Configs, Updating Every 15 minutes» عیناً در دو انبار مختلف، یا یک
tutorial ترجمه‌شده به پنج زبان. این کپی‌بودن متن را می‌سنجد، نه یکی بودن هدف.

اشتراک موضوع (Jaccard) همان جفت‌ها را خیلی بهتر می‌سنجد:
```
Hiddify-Manager ~ hiddify-app  ۰.۶۵
Hiddify-Manager ~ s-ui         ۰.۴۳
hiddify-app ~ s-ui             ۰.۴۰
hazm ~ vazirmatn               ۰.۱۳   (بی‌ربط، درست هم پایین)
هر چیزی ~ JalaliDatePicker     ۰.۰۰
```
توزیع روی ۷۷۶ ریپوی دارای ≥۲ موضوع: ۰.۳۰ تعداد ۲۱۶ جفت، ۰.۴۰ تعداد ۷۶،
۰.۵۰ تعداد ۳۵. بررسی چشمی فهرست ۰.۳۰+ نشان داد جفت‌ها واقعاً هم‌هدف‌اند (دو
افزونه‌ی تقویم فارسی گنوم ۰.۷۱، دو مجموعه قاعده‌ی مسیریابی ایران ۰.۶۲).

پس **هر دو** می‌مانند و هر کدام تنها کافی است، چون در دو جهت مخالف خطا می‌کنند:
موضوع روی ۲۸٪ ریپوها خالی یا کم است (آنجا فقط description داریم)، و description
وقتی دو نویسنده یک چیز را با کلمات مختلف بنویسند بی‌فایده است (آنجا موضوع کار
می‌کند). `purposeTopicJaccardThreshold = 0.35` و `purposeMinSharedTopics = 3`.

**هیچ‌کدام تصمیم نمی‌گیرند.** عبور از آستانه فقط یعنی ریپوی منتشرشده را کنار
کاندیدا به مدل نشان بده و بپرس «بهترش می‌کند یا تکرار است؟» — تمایز قضاوت است.

### پنج باگی که کالیبراسیون پیدا کرد (اگر regex نوشتی، اینها را ببین)
| باگ | اثر واقعی |
|---|---|
| مرز `(?:^\|[^a-z0-9])` روی camelCase کار نمی‌کند | `PyInstaCrack`، `hashCrack`، `NetCracker` عبور کردند. راه‌حل: `splitCamel()` قبل از تطبیق |
| `rial` بدون مرز داخل کلمه می‌افتد | `tutorial`/`material`/`serial` امتیاز ایران گرفتند: **۱۶۳ جعلی در برابر ۲۶ واقعی** |
| الگوی لنگردار (`^awesome-`) روی رشته‌ی «نام + موضوع» چسبیده | لنگر هرگز match نمی‌کند → `made-in-iran` هیچ خطی نگرفت. حالا نام و موضوع جدا تست می‌شوند |
| انبار با زبان واقعی از تشخیص فرار می‌کرد | `descPatterns` اضافه شد |
| الگوی «نام پروتکل‌های پشت‌سرهم» | سه کلاینت واقعی را اشتباه دسته‌بندی کرد. حذف شد — از متن غیرقابل‌تصمیم است |

### باندل ن8ن — چرا وجود دارد و چطور مطمئن می‌شویم درست است
Code node در n8n **هیچ سیستم ماژولی ندارد**؛ نه `import` نه `require`. پس سه
فایل `discovery/` مستقیم آنجا کار نمی‌کنند و راه دیگر (دستی تایپ کردن منطق داخل
نود) بلافاصله یک منبع حقیقت دوم می‌سازد — همان دردی که
`workflows/puregh-manual-publish.ts` الان دارد.

پس نود یک فایل **تولیدشده** می‌گیرد. هرگز دستی ویرایش نمی‌شود؛ بازساخته می‌شود.

هر ماژول داخل IIFE خودش پیچیده می‌شود، نه اینکه ساده به هم چسبانده شوند: هم
`algorithm.js` و هم `queries.js` در سطح بالا `const DAY = 86_400_000` دارند، پس
چسباندن ساده syntax error است.

**یک باگ TDZ که خوردیم:** اول همه‌ی IIFE ها را با
`(typeof R === "undefined" ? undefined : R)` صدا می‌زدم. برای `rules.js` این
`ReferenceError: Cannot access 'R' before initialization` داد — تنها حالتی که
`typeof` هم امن نیست، وقتی است که متغیر `const` در temporal dead zone خودش باشد.
`rules.js` هیچ import ندارد، پس آرگومان نمی‌گیرد.

**باندل خودش را تأیید می‌کند** و این مهم‌ترین بخش است: بعد از ساخت، اجرا می‌شود و
خروجی‌اش با ماژول‌های ESM مقایسه می‌شود — نقشه‌ی کوئری، ۲۴ ریپوی مرجع در ۳ تابع،
۲۱۵ ریپوی کورپوس، `select()`، `selectFinal()`، `shouldReconsider()` و
`allocateReadmeBudget()`. باندلری که کد قابل‌قبول ولی غلط بدهد از نبودنش بدتر
است. `--check` هم هست: اگر فایل تولیدشده کهنه باشد exit code ۱ می‌دهد.

`--lean` نسخه‌ی بی‌کامنت می‌سازد (۵۰KB جای ۱۱۳KB) و **آن را هم تأیید می‌کند**،
چون کامنت‌زدای خط‌محور می‌تواند فایل را بشکند.

### تست‌ها — بعد از هر تغییر در `rules.js` اجرا کن
```bash
node discovery/regression.mjs      # ۳۷ فیکسچر در ۴ گروه → ALL PASS
node discovery/bundle.mjs --lean   # باندل n8n را می‌سازد و با ماژول‌ها مقایسه می‌کند
node discovery/dryrun.mjs --offline        # کل فانل، بدون درخواست شبکه
node discovery/dryrun.mjs --offline --days 5   # چند روز پشت‌سرهم، تست cooldown
node discovery/calibrate.mjs       # توزیع امتیاز، تراکم آشغال، عرضه‌ی هر خط
node discovery/verify-queries.mjs  # ۱۴ کوئری واقعی به GitHub (سهمیه می‌سوزاند)
node discovery/collect.mjs         # بازتولید کورپوس (~۲ دقیقه)
```
`regression.mjs` مهم‌ترین است: اگر یک کلاینت واقعی به‌عنوان انبار کانفیگ
دسته‌بندی شود، ارزشمندترین خط سیستم خراب شده. چهار گروهش:
۱۵ نرم‌افزار واقعی باید عبور کند · ۹ انبار کانفیگ باید رد شود ·
۹ انبار پرامپت باید رد شود · ۴ ابزار AI واقعی نباید انبار پرامپت شمرده شود.

**ترفند مفید:** README از `raw.githubusercontent.com` گرفته می‌شود که سهمیه‌ی
API نمی‌سوزاند. تست‌شده: ۱۰ درخواست raw و `core` دست‌نخورده ماند. بدون توکن
هم می‌شود ۱۰۷۵ ریپو README گرفت.

### آنچه الگوریتم نمی‌تواند و LLM باید تصمیم بگیرد
- **تمایز از رقیب** — خواسته‌ی صریح کاربر، ولی قضاوت است نه معیار. یک کلاینت
  v2ray با README خوب از دید متادیتا شبیه است، چه پیشرفت واقعی باشد چه چهلمین
  پوسته. سیستم فقط **شباهت را رو می‌کند** و از مدل می‌پرسد بهترش می‌کند یا
  تکرار است (دو سیگنال، پایین‌تر توضیح داده شده).
- کاربردی بودن واقعی در برابر شکیل بودن.
- نوآوری و واو فاکتور (§۱۶ و §۱۷ سند).

یک نشتی شناخته‌شده که با متادیتا حل نمی‌شود: `win4r/AISuperDomain` (۱۹۹۵★)
امتیاز ۱۱۰ گرفت. README کامل با دمو دارد و از دید متادیتا ابزار خوبی است —
احتمالاً هم هست. اینکه wrapper بی‌ارزش است یا نه، کار LLM است.

### فاصله‌ی سند با پیاده‌سازی (برای وقتی سند را می‌خوانی)
- سند **سقف ستاره ندارد** (بررسی شد: صفر مورد). تنها عملگر روی ستاره
  `Stars > minimum` است — یعنی کف.
- سند امتیاز ۰-۱۰۰ با آستانه‌ی `score >= 80` می‌گوید (§۱۹). `verdict` سه‌حالته
  **در کل سند صفر بار** آمده — از `db/schema.sql` می‌آید.
- سند وزن‌های §۱۶ را می‌گوید (Novelty 25، Usefulness 25، ...) که همه قضاوت
  LLM اند. امتیاز قطعی ما چیز دیگری می‌سنجد: «نشانه‌های زحمت نسبت به سطح توجه».
- §۱۳ فقط شش فیلتر با کلمه‌ی «مثال:» دارد و سه‌تایشان عدد ندارند.
- §۳۱ فانل ۱۰۰۰→۱۰۰→۲۰→۳-۵ را می‌گوید. ما ~۱۲۰۰→۱۲۰→۱۶→۸ داریم.
- سند **قاعده‌ی تنوع ندارد** و §۲۵ برعکسش را می‌گوید (هر دسته بازخورد بهتر
  گرفت تقویت شود = monoculture). `DIVERSITY` وزنه‌ی تعادل است: هر زبان ۲،
  هر دسته ۲، هر سازنده ۱.

### بوست AI تاریخ انقضا دارد
`AI_BOOST.reviewAfter = '2027-03-01'`. دلیل کاربر صریحاً درباره‌ی **حالا** بود
(«الان این حوزه هر روز ابزار مفید بیرون می‌دهد»). قانون ابدی نیست — آن تاریخ
دوباره تصمیم بگیر. جریمه‌ی `aiSlop = 18` هم بوست ۱۵ را خنثی می‌کند تا wrapper
خالص منفی شود.

## ۱۴) امنیت

- کلید رمز credential های n8n داخل volume `n8n_data` فایل `config` است
  (در ریشه‌ی volume، **نه** `.n8n/config` — چون volume خودش روی
  `/home/node/.n8n` مانت شده). **اگر آن volume برود همه credential ها می‌روند.**
  `scripts/backup.sh` آن را هم می‌گیرد و حالا **تأیید می‌کند** که واقعاً گرفته.
  قبلاً مسیر را غلط داده بود و خطا را با `2>/dev/null || true` می‌خورد، پس دو
  بکاپ **کاملاً خالی** ساخته بود که موفق اعلام شدند (tar خالی ۱۰۲۴ بایت است و
  بی‌خطا باز می‌شود، پس حجم فایل هیچ چیزی ثابت نمی‌کند). بکاپ
  `n8n-config-20260905-121624.tar` به همین دلیل بی‌ارزش است.
- پورت DB فقط روی `127.0.0.1` bind شده.
- **پورت ۵۶۷۸ کانتینر n8n روی همه‌ی اینترفیس‌ها منتشر است** (همان‌طور که از قبل
  بود). یعنی هر کسی در همان شبکه‌ی وای‌فای می‌تواند رابط n8n را باز کند. برای
  محدود کردن به همین دستگاه: `N8N_BIND=127.0.0.1 ./scripts/recreate-n8n.sh`.
- `.env` با perm 600 و در `.gitignore`.
- workflow ها `active: false` هستند؛ فرم‌های ن8n به‌صورت عمومی expose نمی‌شوند
  چون publish نشده‌اند.

## ۱۵) ریسک‌های شناخته‌شده (به کاربر گفته شده، هنوز حل نشده)

1. **دسترس‌پذیری:** این یک لپ‌تاپ است نه VPS. Schedule Trigger اجرای
   از‌دست‌رفته را جبران نمی‌کند — لپ‌تاپ خواب باشد، پست آن روز نمی‌رود.
   **مسیر حل پیدا شد (§۱۸):** مهاجرت به VM رایگان Freestyle که با ترافیک ورودی
   (دکمه‌ی تلگرام) بیدار می‌شود و موقع خواب هزینه ندارد — آزمایش قطعی شد
   (۲۰۲۶-۰۹-۱۲). مهاجرت هنوز انجام نشده.
2. **KPI «کلیک روی لینک» (§۳۸ سند) بدون redirector غیرممکن است.** نیاز به
   URL عمومی دارد.
3. **فرض یادگیری از کانال‌های مرجع ضعیف است:** اکثرشان از Trending پست
   می‌گذارند، پس یاد گرفتن سلیقه‌شان برعکس هدف Hidden Gems است.
   پیشنهاد دادم Selection Profile را کاربر دستی بنویسد و کانال‌های مرجع فقط
   **لیست منفی/dedup** باشند. کاربر موافقت کرد.
4. **بازبینی محلی است** (فرم ن8n روی localhost). برای دکمه‌های inline تلگرام
   یا شمارش کلیک، cloudflared tunnel لازم است.

## ۱۶) سبک تعامل با این کاربر

- فارسی می‌نویسد و جواب فارسی می‌خواهد.
- گزارش **کوتاه و مرحله‌به‌مرحله** می‌خواهد، نه یک دیوار متن آخر کار.
- صریح گفت: «هر جا نیاز به تغییر اطلاعات قدیمی یا تغییر فرض مسئله داشتی قبلش
  به من بگو که بررسی کنم». پس هر تغییر در قاعده‌ها یا فرض‌ها **قبل** از اعمال
  توضیح داده شود.
- **فارسی روان و ساده بنویس.** یک‌بار تذکر داد که ساختار جمله‌هایم نامفهوم
  است. جمله‌ی کوتاه، فعل سر جایش، بدون ترجمه‌ی تحت‌اللفظی از انگلیسی.
- خطاهای واقعی n8n را کامل paste می‌کند و انتظار **تشخیص علت ریشه‌ای** دارد،
  نه حدس. رویکردی که جواب داده: ساختن workflow تشخیصی مجزا (مثل دو Check
  موجود) که علت را از هم جدا کند.
- بازخورد صریح می‌دهد («امتیاز ۶۰ از ۱۰۰») و انتظار دارد اعمال شود.
- **قبل از پیاده‌سازی توضیح می‌خواهد.** دو بار گفت «اول برای من توضیح بده تا
  بررسی کنم». طرح را بگو، تأیید بگیر، بعد کد بنویس.
- **حدس را قبول نمی‌کند.** صریح خواست: «چند مورد درخواست و تست انجام بده و
  بهترین مقادیر را به دست بیاور». عدد باید از اندازه‌گیری بیاید.
- خودش تنظیمات UI را انجام می‌دهد؛ credential و chat id را خودش می‌سازد.
- قدم‌به‌قدم پیش می‌رود و تأیید می‌خواهد. اول تشخیص، بعد اصلاح.

## ۱۷) پیش‌نیازهای فنی workflow سوم — اندازه‌گیری‌شده (۲۰۲۶-۰۹-۰۶)

طرح تأیید شده، ساخت شروع نشده. هر عدد این بخش از یک تست واقعی آمده، نه حدس.

### ⚠️ `new Function` داخل Code node ن8ن کار می‌کند — این کل معماری را عوض می‌کند
یک workflow موقت ساختم (`Pure GitHub — Sandbox Probe`، id `ZlM6MqsJEJFhkmHU`،
الان آرشیو شده) و واقعاً اجرا کردم. نتیجه‌ی اجرا ۷۳:

```
new Function(src + '; return PUREGH;')()   → ۴۲   ✓
((()=>{}).constructor)(...)                → ۴۲   ✓
(0, eval)(src + '; PUREGH.ping(21)')       → ۴۲   ✓
typeof fetch                               → undefined
```

دو نتیجه‌ی مهم:
1. **باندل فقط در یک نود می‌نشیند** («Load Engine») و بقیه‌ی نودها با
   `new Function` تزریقش می‌کنند. اگر این کار نمی‌کرد باید باندل ۵۰KB را در
   چهار نود کپی می‌کردم = ۲۰۰KB و چهار منبع حقیقت. اندازه‌ها:
   باندل lean ۵۰,۹۷۰ بایت، به‌صورت JSON string literal ۵۲,۴۲۲ بایت،
   کل `jsCode` نود ۵۲,۵۰۶ بایت. round-trip تست شد: رشته برمی‌گردد و
   `buildQueries` همان ۱۴ کوئری را می‌دهد.
2. **در Code node شبکه نیست** (`fetch` = undefined). پس هر درخواست HTTP باید
   نود `httpRequest` باشد. این فرض قبلی بود، ولی حالا تأیید شده.

### زمان اجرا روی همین سخت‌افزار ضعیف (AMD A6، ۲ هسته)
```
compile باندل با new Function   ۴۷ ms
scoreStageA روی ۱۰۷۵ ریپو       ۲۰۹۴ ms   ← گران‌ترین قطعه
allocateReadmeBudget            ۱۳ ms
scoreStageB روی ۱۲۰ ریپو        ۱۴۶ ms
select()                        ۹ ms
```
یعنی کل CPU الگوریتم زیر ۲.۵ ثانیه است. گلوگاه شبکه است نه پردازش.

### upsert انبوه با `jsonb_to_recordset` — ۱۰۷۵ ریپو در ۷۲۷ms
روی DB واقعی تست شد. یک `INSERT ... SELECT FROM jsonb_to_recordset($1::jsonb)`
کل ریپوهای یک اجرا را در **یک** کوئری می‌نویسد.
حجم payload: ۱۰۵۶KB برای ۱۰۷۵ ریپو، ۹۹KB برای ۱۲۰ ریپوی مرحله B.
**پس نود Postgres هزار بار صدا زده نمی‌شود.** برای یک بار هم `INSERT 0 1075` داد
و `times_seen` روی conflict درست بالا رفت.

### آرایه‌ی id ها به SQL: literal یک‌پارامتری
`queryReplacement` در ن8ن فقط اسکالر پاس می‌دهد، پس `bigint[]` را باید به شکل
رشته‌ی `'{101,202,303}'::bigint[]` فرستاد. تست شد و `unnest` درست ۳ ردیف داد.
کوئری gate روی ۱۰۷۵ ریپو **۱۱۳ms** طول کشید.

### README از raw: ۹۷٪ با یک تلاش
۶۰ ریپوی نمونه از کورپوس (همه README دارند) با
`raw.githubusercontent.com/{full_name}/{default_branch}/README.md`:
**۵۸ از ۶۰ موفق.** دو خرابی (`wowmodelviewer`، `avian_pickup`) هر دو
`readme.md` با حرف کوچک بودند — API هم همین را گفت. پس یک نود دوم برای
fallback کافی است، نه حلقه‌ی چهار حالتی.

توزیع برنچ در کورپوس: `main` ۸۱۲، `master` ۲۱۷، `develop` ۱۰، `dev` ۹.
پس `default_branch` را باید از خود پاسخ search خواند (که می‌آید)، نه حدس زد.

### نود HTTP Request: batching یعنی فاصله بین آیتم‌ها
کد نود را خواندم (`HttpRequestV3.node.js` خط ۱۹۴-۲۰۰): همه‌ی درخواست‌ها با
`Promise.allSettled` **موازی** ساخته می‌شوند، و `batchInterval` فقط قبل از
ساختن هر `batchSize`-امین آیتم `sleep` می‌کند. پس برای ۱۴ کوئری search با
فاصله‌ی `QUERY.searchSpacingMs`، باید `batchSize: 1` و
`batchInterval: 2500` گذاشت. `retryOnFail` هم لازم است (`maxTries >= 3`):
VPN روی `tun0` سوکت TLS طولانی را می‌اندازد و `dryrun.mjs` برای همین
`fetchRetry` دارد.

### فرم بازبینی: یک فرم برای کل اجرا
Schedule Trigger با نود `n8n-nodes-base.form` کار **نمی‌کند** — کد نود صریح
throw می‌کند: `Form Trigger node must be set before this node`
(`Form.node.js`، تابع `execute`). همین شرط برای نود Wait با `resume: 'form'`
هم هست ولی **فقط برای redirect**: اگر Form Trigger نباشد، Wait باز هم فرم را
نشان می‌دهد و اجرا را نگه می‌دارد (`Wait.node.js` خط ۴۴۸-۴۶۸،
`hasFormTrigger` فقط تصمیم می‌گیرد پاسخ 307 بدهد یا نه).

**پس بازبینی با نود Wait (`resume: 'form'`) ساخته می‌شود، نه نود Form.**
و یک فرم برای کل اجرا (چک‌باکس چندانتخابی + پیش‌نمایش هر caption)، نه ۸ فرم
پشت‌سرهم. کادنس هم دست کاربر می‌ماند: امروز ۱ تیک، در پروداکشن ۳-۴ تیک.

### زنجیره‌ی تأییدشده
```
Schedule Trigger (روزانه)
  → Load Engine            باندل به‌صورت رشته، تنها نسخه
  → Build Query Plan       ۱۴ کوئری از buildQueries
  → Open Run Log           INSERT در discovery_runs
  → GitHub Search          ۱۴ درخواست، batchSize 1 + interval 2500
  → Dedup + Collect
  → Cooldown Gate (SQL)    کوئری ۱ discovery-queries.sql
  → Score Stage A
  → Allocate README Budget per-lane، ۱۲۰ تا
  → Fetch READMEs          raw، بدون credential
  → Score Stage B → Select ۱۶ کاندیدا
  → Purpose Similarity (SQL)
→ Loop 16: Generate Caption (LLM) → Assemble
   → Select Final           selectFinal، سهمیه + دسته
   → Upsert همه (SQL انبوه) + Save Drafts
   → Wait (resume: form)    یک فرم بازبینی برای کل اجرا
   → Publish منتخب‌ها → Mark Published / Mark Rejected
   → Close Run Log
```

## ۱۸) آزمایش Freestyle — بیدار شدن VM خوابیده با ترافیک ورودی (۲۰۲۶-۰۹-۱۲)

به‌خاطر ریسک §۱۵ (لپ‌تاپ خواب = پست نمی‌رود) و نیاز به URL عمومی برای دکمه‌های
ربات، پلتفرم **Freestyle** (VM رایگان با pause خودکار) آزمایش شد. کاربر VM
شخصی‌اش (`nimux`، `itsnimux.style.dev` — opencode/openchamber روی پورت ۳۰۰۰) را
دارد؛ آزمایش‌ها روی VM جداگانه‌ی `puregh-wake-test` انجام شد و **با آن VM شخصی
هیچ تماسی گرفته نشد.**

هر سه سؤال حیاتی جواب قطعی گرفت:

| # | سؤال | نتیجه | روش |
|---|---|---|---|
| ۱ | درخواست ورودی (HTTPS از دامنه‌ی style.dev) ماشینِ pause شده را بیدار می‌کند؟ | ✅ بله — درخواست **نگه داشته می‌شود** (502/timeout نمی‌خورد) و در **~۱.۴ ثانیه** جواب 200 می‌گیرد | state=paused → curl → HTTP 200 + state=running |
| ۲ | ترافیک فقط-خروجی (مثل discovery که GitHub/LLM صدا می‌زند) تایمر idle را ریست می‌کند؟ | ✅ بله — ماشین با لوپ curl خروجیِ هر ۲۰ ثانیه، تا ۲ دقیقه بعد از آخرین ترافیک ورودی هم بیدار ماند و کل لوپ اجرا شد | لوپ systemd + مشاهده‌ی مستقیم dashboard توسط کاربر |
| ۳ | پروسه‌ها از pause زنده بیرون می‌آیند؟ | ✅ بله — سرویس logger بعد از چند چرخه‌ی pause/wake همچنان فعال بود | systemd لاگر |

**معنی برای طرح ما:** مدل «دکمه در ربات → discovery اجرا شود → ماشین موقع
بی‌کاری بخوابد» عملاً جواب می‌دهد. keep-alive اثبات‌شده لازم نیست، ولی چون
آزمایش ۲ فقط یک بار تکرار شد، در طرح مهاجرت یک نود ارزان «خود-پینگ» در discovery
گذاشته می‌شود تا ریسک بیدارماندن وسط اجرا صفر شود.

**مصرف سهمیه‌ی Free در آزمایش‌ها:** VM آزمایشی ناخواسته با snapshot پیش‌فرض
(4vCPU/8GB) ساخته شد (~۴۵ دقیقه running جمعاً). درس: `vms.create` فیلد
`cpu/memory/storage` **ندارد** — منابع از snapshot می‌آیند؛ برای VM کوچک باید
`snapshotId` سبک‌تر داد (این در طرح مهاجرت حتماً رعایت شود).

#### درس‌های روش‌شناسی Freestyle SDK/CLI (۲۰۲۶-۰۹-۱۲)
| علامت | علت ریشه‌ای | رفع |
|---|---|---|
| `/bin/sh: 1: <دستور کامل>: not found` | CLI `vm exec` کل رشته‌ی داخل quotes را نام فایل می‌گیرد | دستور باید بعد از `--` بیاید: `freestyle vm exec <slug> -- <cmd> <args>` |
| `systemctl ... Access denied` با فلگ درست | `vm.exec` پیش‌فرض با uid 1000 اجرا می‌شود؛ فلگ `linuxUser` داخل options **نادیده گرفته می‌شود** (باگ‌مانند) | SDK: فقط `vm.linuxUser("root").exec(...)` کار می‌کند؛ CLI: `--linux-user root` |
| `VM_NON_RESPONSIVE ... exec produced no exit within 35s` | `nohup ... &` داخل exec — exec تا بسته‌شدن همه‌ی پروسه‌ها منتظر می‌ماند و تایم‌اوت می‌خورد | هر سرویس بلندمدت باید **systemd** باشد (همان توصیه‌ی راهنمای رسمی ربات تلگرام) |
| `code 143` در خروجی exec | `pkill -f` خانواده‌ی پروسه‌ی خودِ دستور را می‌کُشد = سیگنال 15؛ بی‌خطر است | نادیده بگیر؛ فقط exit code خروجی خواستی را چک کن |
| لاگ‌ها «جلوتر از زمان شروع» به نظر می‌رسند | `date -u` UTC می‌نویسد = ۳.۵ ساعت عقب‌تر از تهران؛ مقایسه با ساعت محلی گمراه‌کننده است | همیشه UTC را با UTC مقایسه کن؛ `T0` اسکریپت با `toISOString()` خودش UTC است |
| سکوت ۵ دقیقه‌ای «کار نکرد» و VM بیدار ماند | هر `vm list`/`exec`/`curl` تایمر idle را ریست می‌کند — حتی خواندن state | در پنجره‌ی سکوت **هیچ** تماسی نگیر؛ state را فقط یک‌بار در پایان بخوان |
| `502 the mapped VM is not reachable` از دامنه | backend داخل VM بالا نیامده بود (نه مشکل edge) — به‌خاطر همان Access denied پنهان systemd | اول با curl لوکال داخل VM چک کن، بعد دامنه را متهم کن |

**آزمایش‌های باقی‌مانده:** Docker بعد از pause (کانتینر n8n/Postgres از pause زنده
بیرون بیایند — به‌احتمال زیاد بله چون pause حافظه-preserving است و logger همین را
اثبات کرد)، و تست واقعی webhook تلگرام روی VM. VM آزمایشی باید پاک شود:
`npx -y freestyle@latest vm delete puregh-wake-test`.

#### محاسبه‌ی سهمیه‌ی Free برای طرح نهایی
سهمیه: ۲۰۰ vCPU-ساعت + ۴۰۰ GiB-ساعت RAM + ۶۰,۰۰۰ GiB-ساعت دیسک + ۵۰GB transfer در ماه.
با VM کوچک ۱-۲ vCPU (snapshot سبک، نه پیش‌فرض 4vCPU/8GB): discovery هر ۲ روز
(~۱ ساعت) + بیداری‌های کوتاه ربات + پینگ publisher ≈ **۹۵-۱۲۰ vCPU-ساعت/ماه →
می‌گنجد**. با snapshot پیش‌فرض 4vCPU: یک روز کامل running = ۹۶ vCPU-ساعت = نصف
سهمیه — پس منابع VM اصلی باید از snapshot سبک انتخاب شود یا resize پایین.

### ✅ §۱۹) استقرار تست روی VM Freestyle — VM `puregh` (۲۰۲۶-۰۹-۱۳)
هدف: تست زنده‌ی دکمه‌های اینلاین ربات (نیاز به URL عمومی داشت). VM: `puregh`
(vm-50c1bc4f400d40898d9de1bdbad80068)، `freestyle/ubuntu-sm` (2vCPU/4GB)،
idleTimeout=300s. **این VM محیط تست مستقل است — n8n لپ‌تاپ دست نمی‌خورد.**

| قطعه | وضعیت |
|---|---|
| دامنه | `https://puregh-n8n.style.dev` → پورت 5678 (TLS rule `tls-3e73cbd1bffa4c68a71936bb3413c44b`) |
| کانتینر puregh-db | pgvector/pg16 روی شبکه‌ی `puregh-net`، **دیتابیس تازه** (بدون بکاپ از لپ‌تاپ — تصمیم کاربر: سریع‌تر) + ۱۰ رکورد فیک (۵ ریپو github_id 900001-900005 + ۵ پست draft؛ پخش publish_at عمدی: ۳ آینده، ۱ گذشته، ۱ NULL برای تست «بدون زمان») |
| کانتینر n8n | v2.34.6، volume `n8n_data` **کپی‌شده از لپ‌تاپ** (بعد از تمیزکاری: execution_data/history dumps حذف، 310MB→2.1MB) |
| env کانتینر n8n | `TELEGRAM_BOT_TOKEN` (بات جدید)، `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`، `N8N_MCP_ACCESS_ENABLED=true`، `N8N_MCP_MANAGED_BY_ENV=true`، `N8N_WEBHOOK_URL=https://puregh-n8n.style.dev/`، TZ=Asia/Tehran |
| بات | **جدید:** `@puregithubbot` («دستیار Pure Github») توکن `8932467023:AAFJ...` — بات قدیمی `@HermesNimux_robot` با یک «Hermes Agent» خارجی polling می‌شد و پیام‌ها را می‌خورد؛ کنار گذاشته شد |

**نتیجه‌ی تست زنده (اجرا ۱۳۶):** «لیست انتظار» و «افزودن به لیست» و دکمه‌های
✅/❌/🔄 **کار می‌کنند** روی VM — اولین تست واقعی webhook این پروژه از اینترنت.
باقی‌مانده: تغییرات UX که کاربر خواست (پایین).

#### باگ‌ها و درس‌های استقرار VM (۲۰۲۶-۰۹-۱۳)
| علامت | علت ریشه‌ای | رفع |
|---|---|---|
| `Mismatching encryption keys` در استارت n8n | فایل `config` خودش کلید را دارد؛ ست‌کردن `N8N_ENCRYPTION_KEY` با همان مقدار هم mismatch می‌دهد | env را نده — فایل config ملاک است |
| publish در UI: `Workflow could not be published — Version not found` | جدول `workflow_history` = **نسخه‌های ذخیره‌شده‌ی ورک‌فلو در n8n نسل جدید** است نه لاگ اجرا — حذفش موقع تمیزکاری publish را شکست | `workflow_history` را هرگز پاک نکن؛ در این استقرار از volume لپ‌تاپ dump گرفته و در VM ریستور شد |
| API key دست‌ساز در sqlite → `unauthorized` | فرمت/امضای API key ساختار دارد؛ ساخت دستی ردیف کار نمی‌کند | API key را از UI بساز (Settings → n8n API). MCP JWT فقط برای endpoint MCP است نه REST |
| `scp` فایل 68MB قطع می‌شد | حجم + احتمالاً ناپایداری تونل | sqlite را قبل از انتقال تمیز کن (execution_data حذف + VACUUM): 310MB→2.1MB→164KB gzip |
| Webhook تلگرام `url: ""` بعد از active | ۱) توکن قدیمی به agent خارجی وصل بود ۲) بعد از تعویض credential، activate قبلی webhook را به بات قدیمی زده بود | بعد از هر تغییر credential باید deactivate→activate دوباره |
| بات قدیمی جواب‌های AI می‌داد | بات `@HermesNimux_robot` به سرویس «Hermes Agent» خارجی وصل بود که با getUpdates پیام‌ها را می‌خورد | بات جدید ساخته شد: `@puregithubbot` |
| ترتیب ثبت webhook | `webhook_entity` فقط بعد از publish/activate پر می‌شود | اول publish، بعد activate؛ برای re-register: deactivate→activate |

#### ✅ تغییرات UX اعمال شد — روی لپ‌تاپ، n8n اصلی (۲۰۲۶-۰۹-۱۴)
هر ۴ خواسته روی workflow ربات لپ‌تاپ اعمال و تست شد (اجراهای ۱۴۴-۱۴۸). ربات
الان **۷۳ نود** دارد (۷۱ عملکردی + ۳ استیکی):
1. **تغییر زمان:** `sched:<id>` → `Load Sched Post` → `Ask Sched Time` (پیام
   جدید با دکمه‌ی انصراف) → متن بعدی = زمان جدید.
2. **کپشن دستی:** `manual:<id>` → `Ask Manual Caption` (پیام جدید + انصراف)
   → `Save Manual Caption` → `Edit Message Manual`.
3. **باگ regen:** `Edit Message Regen` نال‌گارد `publish_at` گرفت — regen فقط
   کپشن و attempt را دست می‌زند، نه زمان انتشار.
4. **مسیر add دوگانه:** لینک ریپو → `Send Add Choice` (دو دکمه) →
   `addgen:owner/repo` (زنجیره‌ی LLM) یا `addmanual` → `Set Pending Add Manual`
   → متن بعدی کاربر = کپشن → `Build Add Manual From Text` → زنجیره‌ی مجزای
   **بدون LLM**: `Fetch Add Manual Metadata` → `Build Add Manual Save` →
   `Upsert Add Manual Repo` → `Save Add Manual Post` → `Send Add Manual Preview`
   (۴ دکمه‌ی کامل) → `Save Add Manual Bot Message`.
- **Timeout:** همه‌ی حالت‌های pending پنجره‌ی ۶۰ ثانیه‌ای دارند — `Route Text`
  تازگی را چک می‌کند و `Check Pending Timeout` → `Send Timed Out` پاک می‌کند.
- نودهای `Answer Manual`/`Answer Sched` حذف شدند؛ `Clear Pending` سه‌گانه شد
  (`Clear Pending` / `Clear Pending Cancel` / `Clear Pending Sched`).
- ترتیب خروجی‌های `Parse Callback`: ok/rej/regen/manual/sched/**addgen/addmanual/cancel**/fallback.

#### درس‌های اعمال UX (۲۰۲۶-۰۹-۱۴)
| علامت | علت ریشه‌ای | رفع |
|---|---|---|
| JSON اعتبارسنجی وسط کد می‌شکست | متن فارسی/ایموجی داخل jsCode در JSON دستور | متن پیام‌ها را انگلیسی/اسکیپ‌شده در کد بده؛ جداسازی با چند عملیات کوچک‌تر |
| `setNodeParameter` کلید `parameters` **تو‌در‌تو** ساخت به‌جای merge (خرابی شناخته‌شده) | به‌جای merge عمیق، کلید جدید می‌سازد | فیکس نهایی فقط با `updateNodeParameters` + `replace: true` |
| ویرایش دستی UI بخشی از تغییرات MCP را بازنویسی کرد (قواعد ۵/۶/۷ `Parse Callback` هر سه `cancel` شدند؛ قانون ۰ `Route Manual Or Cancel` تکراری شد؛ `Send Add Manual Preview` خراب) | UI روی نسخه‌ی قدیمی ذخیره شد و تغییرات موازی را لغو کرد | بعد از هر ویرایش دستی UI، قبل از ادامه کل وضعیت را دوباره fetch کن |
| مسیر دستی add به زنجیره‌ی LLM چسبیده بود (کپشن کاربر نادیده گرفته می‌شد) | `Build Add Manual From Text → Fetch Repo Metadata` (نود مشترک مسیر LLM) | نود HTTP مجزای `Fetch Add Manual Metadata` + زنجیره‌ی کاملاً مستقل |
| 404 آنی در مسیر addgen | یال قدیمی `Send Add Choice → Fetch Repo Metadata`: پاسخ تلگرام `{ok,result}` اصلاً `full_name` ندارد | یال حذف شد؛ `Fetch Add Readme` از `$json.full_name` می‌خواند (از `Fetch Repo Metadata`) نه `$('Parse Add URL')` |
| URL تونل عوض شد بعد از ری‌استارت cloudflared | quick tunnel هر بار URL جدید می‌دهد؛ `N8N_WEBHOOK_URL` کهنه می‌ماند | `recreate-n8n.sh` حالا `${N8N_WEBHOOK_URL:+...}` را می‌پذیرد؛ بعد از هر recreate باید webhook تلگرام deactivate→activate و Publisher دوباره publish شود |
## ۲۲) مهاجرت کامل به VM شخصی `nimux` (۲۰۲۶-۰۹-۱۵)

**موفق شد — کل پروداکشن از لپ‌تاپ به VM `nimux` (فری‌استایل) منتقل و تست زنده شد.**
لپ‌تاپ فقط کارخانه‌ی توسعه است؛ تولید (ن8ن + DB + ربات + زمان‌بند) روی `nimux`
اجرا می‌شود. این بخش روش‌شناسی و وضعیت نهایی را ثبت می‌کند.

### نقشه‌ی نهایی
| چیز | مقدار |
|---|---|
| VM | `nimux` (2vCPU/4GB، id `vm-80ca4e8605a04ccf9c6c0cb740130337`) |
| دامنه public | `n8n.style.dev` → VM `nimux:5678` (TLS rule `tls-945061770b4848a585df8334828b2d28`) |
| کانتینر n8n | `docker.n8n.io/n8nio/n8n` **2.38.7**، volume `n8n_data`، شبکه `puregh-net`، DNS ثابت 1.1.1.1/8.8.8.8 |
| کانتینر DB | `pgvector/pgvector:pg16` (پورت host 127.0.0.1:5433)، volume `puregh_pgdata` |
| بات تلگرام | `@puregithubbot` (توکن `8932467023:AAFJpV...`) |
| MCP opencode | `https://n8n.style.dev/mcp-server/http` + همان JWT (کلید رمز volume مشترک است) |
| پروژه روی VM | `~/project/PureGithub` (کپی کار - git کار می‌کند) |

### چه چیزهایی منتقل شد و چطور
1. **bن8n volume** (`n8n_data`): کانتینر لپ‌تاپ متوقف شد، sqlite **تمیزکاری شد**
   (حذف `execution_data`/`execution_entity`/`execution_metadata`/`agent_execution*`/
   `test_case_execution` + VACUUM) → از ۳۲۹MB به **6.9MB** رسید. workflow ها (10)،
   history (74) و credential ها (8) سالم ماندند. نکته‌ی کلیدی: **فایل WAL جدا کپی
   و کنار دیتابیس گذاشته شد** (سگ: `-wal` را با هم بفرست، وگرنه داده‌ی commit نشده
   می‌پرد). volume مقصد از قبل پاک شد (به جز config).
2. **config (کلید رمز)** از لپ‌تاپ کپی شد — credential ها در VM با همان کلید
   رمزگشایی شدند. **هرگز `N8N_ENCRYPTION_KEY` env نده** (mismatch می‌دهد؛ فایل
   config ملاک است — درس §19).
3. **DB**: `pg_dump -Fc` روی لپ‌تاپ → `pg_restore --clean --if-exists` روی
   `puregh-db` VM. دو extension (vector, pg_trgm) و اسکیما (2 تریگر، 3 ویو، 19
   ایندکس) سالم بودند. شمارنده سیکوئنس هم درست برگشت (repositories_id_seq=10).

### تفاوت‌های env کانتینر n8n (در VM)
```
-e N8N_WEBHOOK_URL=https://n8n.style.dev
-e N8N_EDITOR_BASE_URL=https://n8n.style.dev
-e N8N_PROXY_HOPS=1
```
`N8N_PROXY_HOPS=1` **ضروری است** — بدونش، n8n پشت TLS proxy خطای
`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` می‌دهد (express-rate-limit).

### فعال‌سازی workflow ها
CLI داخل کانتینر، پس از قرار دادن volume:
```
docker exec n8n n8n publish:workflow --id=<UUID>
docker restart n8n   # publish فقط بعد از restart اثرمی‌کند
```
هر سه فعال شدند: Discovery (`hHSwbbOBKRIWStRU`)، ربات (`Zro6k6d8JcAOOpfn`)،
Publisher (`1tVlx8NwE7Qe4WWa`).

### تست‌های زنده‌ی بعد از مهاجرت (همه موفق)
- `GET https://n8n.style.dev/healthz` → 200.
- `getWebhookInfo`: url=`https://n8n.style.dev/webhook/266e24e0-.../webhook`,
  `pending_update_count=0`.
- پیام «لیست انتظار» به ربات → اجرای 238 webhook موفق، `Send Waiting List`
  آخرین نود اجراشده، مسیر waitlist کامل. **ربات واقعاً روی VM جواب می‌دهد.**
- MCP روی دامنه public با همان JWT کار می‌کند (tools/list و get execution).

### نگهداری بعدی
- **MCP در opencode.json لپ‌تاپ** به `https://n8n.style.dev/mcp-server/http` تغییر
  کرد — بعد از ری‌استارت opencode اعمال می‌شود.
- Docker run کانتینر n8n این بار دستی زده شد (نه `recreate-n8n.sh`). برای
  تکرار/مستندسازی یک نسخه VM-مخصوص از `recreate-n8n.sh` سودمند است (env های بالا
  + N8N_PROXY_HOPS). هرگز volume را دستی با encription key جابه‌جا نکن.
- لپ‌تاپ: کانتینرهای n8n متوقف شد؛ DB لپ‌تاپ باز دست‌نخورده است (بکاپ‌های
  `/tmp/puregh-backup.dump` و `/tmp/n8n-data-original.tar.gz` — موقتی‌اند).
  برای پاک‌کردن لپ‌تاپ بعداً تصمیم بگیر.

## ۲۳) مینیاپ تلگرام — جایگزین فرم بازبینی n8n (در حال ساخت، ۲۰۲۶-۰۹-۱۶)

کاربر تصمیم گرفت بازبینی (لیست انتظار + تایید/رد/زمان‌بندی/کپشن) از محلول فعلی
(workflow ربات تلگرام + دکمه‌های inline) به یک **Telegram Mini App** منتقل شود.
جای فرم n8n هم که قبلاً حذف شد، همین اپ می‌شود. **این مرحله روی لپ‌تاپ توسعه
می‌شود**؛ n8n/DB پروداکشن روی VM `nimux` دست نمی‌خورد. کد: `puregh-miniapp/`
(فرانت React/Vite + بک‌اند Express + کد shared خالی). کامیت کامل نخست:
`56fbf01`.

### معماری و نقشه‌ی نهایی
```
ربات @puregithubbot → (WebAppMenu/direct URL) → مینیاپ
        └─ دکمه‌ی اینلاین «پنل بازبینی» → https://MINIAPP_URL/post/:id
مینیاپ (Express، 127.0.0.1:3001) → Postgres puregh (لپ‌تاپ: کانتینر محلی یا SSH forward)
        └─ استاتیک = frontend/dist (همان origin، پس /api در dev فقط proxy است)
فرانت = SPA (React + react-router، صفحات: / ، /post/:id ، /add)
```

| قطعه | فایل | نقش |
|---|---|---|
| ورودی اصلی | `backend/src/server.js` | Express؛ middleware `requireOwner` روی همه‌ی `/api`؛ سرو استاتیک dist |
| مسیرها | `backend/src/routes.js` | ۸ endpoint (پایین) |
| DB | `backend/src/db.js` | pg Pool روی تنظیمات `.env` |
| تأیید Telegram | `backend/src/security/initdata.js` | HMAC initData (پایین) |
| متادیتا/README | `backend/src/github.js` | `/repos/{full}` + **raw.githubusercontent** (سهمیه نمی‌سوزاند) |
| LLM | `backend/src/llm.js` | chat/completions، primary→fallback، JSON، فنس ```` ```json ```` بردار |
| کپشن | `backend/src/caption.js` + `caption-system-prompt.txt` | assemble + پرامپت (پایین) |
| تلگرام | `backend/src/telegram.js` | answerCallback، editReviewMessage، reviewKeyboard (web_app) |
| تنظیمات | `backend/.env` ≠ `.env.example` | توکن‌ها/LLM/MINIAPP_URL؛ `.env` committed نیست |

فرانت: `main.jsx` (react-router، ۳ مسیر) / `App.jsx` (topbar + تلگرام `ready()` +
شمارنده‌ی لیست) / `api.js` (هر دو fetch + هدر initData) / `format.js`
(faDateTime/faShort/toLocalInput/stripHtml/**escapeHtml**) / صفحات:
`pages/WaitingList.jsx` (کارت‌ها + pill زمان/بدون‌زمان + count) ·
`pages/PostDetail.jsx` (۴ دکمه + ویرایش کپشن + تقویم + مودال تأیید رد) ·
`pages/AddRepo.jsx` (manual/AI) · `components/ShamsiPicker.jsx` (تقویم شمسی+ساعت).

### API (همه با هدر `x-telegram-init-data`، فقط owner)
| مسیر | کار |
|---|---|---|
| `GET /api/posts` | لیست انتظار: drafts، مرتب `publish_at ASC NULLS LAST`، با full_name/model/attempt |
| `GET /api/posts/final` | **لیست نهایی** (فقط approved) با verdict/reason از JOIN ریپو، شامل پست‌های بدون زمان |
| `GET /api/posts/:id` | جزئیات پست (`loadPost(id, statuses)` — published/rejected دیده نمی‌شود؛ verdict/verdict_reason و model/attempt هم) |
| `POST /api/posts/:id/approve` | **دیگر ack-only نیست**: `draft→approved` + اسلات انتشار (`nextPublishSlot()`: آخرین اسلات approved/published +۲ ساعت، نه قبل از now+2h، نه قبل از فردا ۰۹ تهران) + ویرایش پیام ربات |
| `POST /api/posts/:id/send-now` | **(طرح دو لیست) فقط approved**: تراکنش claim اتمیک `approved→publishing` → sendToChannel → published؛ شکست تلگرام → ROLLBACK (به approved برمی‌گردد). قرارداد: غیر-approved → **404**، درگیری همزمان → **409**، خروجی `{ok, message_id}` |
| `POST /api/posts/:id/reject` | `status='rejected', reject_reason='mini-app-reject'` → تریگر DB ریپو را ابدی قفل می‌کند + ویرایش پیام ربات. **فقط روی draft** |
| `POST /api/posts/:id/regen` | ساخت دوباره با LLM (facts از ردیف ریپو + README raw) + `attempt+1` + ویرایش پیام ربات (برای approved هم باز است) |
| `POST /api/posts/:id/caption` | کپشن دستی (متنی — فرانت escape می‌کند) |
| `POST /api/posts/:id/schedule` | `publish_at` از ISO پذیرفته؛ هر دو (بدون/با زمان موجود) را برمی‌گرداند |
| `POST /api/posts/:id/delete` | **حذف از لیست**: DELETE پستِ draft **و** approved — ریپو دست نمی‌خورد (می‌تواند در کشف بعدی دوباره بیاید). ack + ویرایش پیام ربات |
| `POST /api/add/gen` | متادیتا+README→facts→LLM→assemble→upsert ریپو(`source='submission'`)→پست draft |
| `POST /api/add/manual` | بدون LLM؛ فقط متادیتا + کپشن داده‌شده |

upsert ریپو مثل n8n است: `jsonb_array_elements($1::jsonb)` روی آرایه‌ی تک‌عضو
(wrap در کد)، `ON CONFLICT (github_id) DO UPDATE` — پس افزودن دوباره‌ی یک ریپو
دیتای تازه را آپدیت می‌کند نه اینکه مشتری باشد.

### امنیت — `initdata.js` (با initData واقعی تأیید شد)
مستندات می‌گوید `secret_key = HMAC(bot_token, "WebAppData")` ولی **تلگرام واقعی
برعکس امضا می‌کند** (مستند راست‌بخشی است):
```
secret_key  = HMAC_SHA256("WebAppData", bot_token)          // باینری
computed    = HMAC_SHA256(secret_key, data_check_string)    // hex
dcs         = همه‌ی فیلدها به‌جز hash، مقادیر URL-decoded، مرتب، joined با \n
```
به‌علاوه: انقضا (auth_date، `maxAgeMs=86400_000`)، پارس `user`، و `is_owner =
String(user.id) === OWNER_CHAT` (تنها 5622960785). فرانت initData را در کلاینت
تلگرام از `window.Telegram.WebApp.initData` می‌گیرد؛ برای dev خارج از تلگرام
`?initData=` در URL (api.js). `DEBUG_AUTH=1` در env برای دیباگ.

### کپشن — پرامپت و assemble «همان» workflow ربات
- `caption-system-prompt.txt` از پرامپت نود LLM ربات (نیومن جدا) **عیناً** منتقل
  شده: لحن دوستانه، طول‌ها (title ۶۰ / hook ۱۴۰ / why ۲۲۰، جمع ۴۲۰)، verdict
  سه‌حالته، category، «هیچ عددی ننویس» (از §۱۰).
- `assembleCaption()` پرت verbatim از Assemble Regen/Add ربات: opener ایموجی
  **deterministic روی full_name** (پیش‌نویسِ بازتولیدشده همان ایموجی دارد)،
  `- @owner` در انتها، escape-HTML امن. فیلدهای غایب → throw (تستوشده).
- قانون **«تکرار با پست‌های مشابه → verdict=reject»** در prompt هست ولی
  `similarPostsText` فعلاً در مینیاپ پر نمی‌شود (در n8n از Purpose Similarity
  می‌آمد) — نقص شناخته‌شده، در Model B باید وصل شود.
- `llm.js`: شکست 402/429 → try مدل fallback؛ خطای JSON فقط fallback را رد می‌کند؛
  خروجی چه زیر `output` باشد چه تخت، tolerate می‌کند (درس §۹ caption خالی).

### دکمه‌ی «باز کردن پنل» در پیام ربات
`telegram.js` حالا ۴ دکمه‌ی inline قدیمی (ok/rej/regen/manual) را **یک دکمه‌ی
web_app** کرده: `«📋 باز کردن پنل بازبینی»` با `url = ${MINIAPP_URL}/post/${postId}`.
تمام ویرایش‌های پیام (approve/reject/regen/caption/schedule) همان دکمه را
نگه می‌دارند. `answerCallback` و `editReviewMessage` هر دو best-effort نوشته
شده‌اند: خطای تلگرام نباید عمل DB را خراب کند (query_id ممکن است کهنه/غایب
باشد).

### تقویم شمسی و پلاگین ساعت (۲۰۲۶-۰۹-۱۶)
روی `react-multi-date-picker@4.5.2` (نویسنده‌ی ایرانی shahabyazdi) + calendar
persian + locale persian_fa. **دو درس که ریشه‌ی صفحه‌ی سفید بودند:**
1. **پلاگین `time_picker` تابعِ کامپوننت است؛ «call» نمی‌شود.** `timePicker({...})`
   بدنه‌ی کامپوننت را با پراپس ناقص اجرا می‌کند و روی
   `calendarProps.formattingIgnoreList` کرش می‌دهد (صفحه‌ی سفید). باید element
   داده شود: `plugins={[<TimePicker hideSeconds />]}`.
2. **JSX با حرف کوچک = تگ HTML.** `<timePicker />` به `jsx("timePicker", ...)`
   کامپایل می‌شود و پلاگین رندر نمی‌شود (فقط تاریخ، ساعت نه). فیکس:
   `import timePicker …; const TimePicker = timePicker;` و
   `<TimePicker position="bottom" hideSeconds />`.
- فرمت `YYYY/MM/DD HH:mm`، `digits` فارسی، پیش‌فرض = حالا + ۳۰ دقیقه، خروجی
  `date.toDate().toISOString()` (UTC ISO — قرارداد publish_at؛ تهران UTC+3:30
  بدون DST، پس اگر در تلگرام ساعت غلط دیدی، تبدیل نکن). الساعت
  `position="bottom"` پایین تقویم. CSS تیره در `styles.css` (کلاس‌های `.rmdp-*`
  زیر `.shamsi-picker`، ورودی ساعت خط ۳۱۹).
- **نکته‌ی جمله‌سازی نشد:** در همین picker، چیدن timePicker به شکل `<timePicker/>`
  بی‌خطا کامپایل ولی بی‌اثر بود؛ فقط با تغییر به متغیر بزرگ (پشت پلاگین جدا از
  تاریخ) ساعت ظاهر شد.

### ستاپ توسعه (لپ‌تاپ)
```
node backend/src/server.js                 # بک‌اند :3001  (DB از طریق SSH forward)
npm run dev (در frontend/)                 # :5173 + proxy /api → 3001
cloudflared tunnel --url http://127.0.0.1:3001   # MINIAPP_URL را برابر tunnel کن
```
همین origin بودن یعنی دکمه‌ی web_app هم به tunnel اشاره می‌کند (`backend/.env`:
`MINIAPP_URL`). بعد از
هر build فرانت، `dist` نو همان origin سرو می‌شود — پورت بک‌اند را عوض نمی‌کند.
**نکته‌ی سروگیری:** اگر فایل `dist` موجود نباشد صفحه خالی می‌شود؛ توسعه معمولاً
با `npm run dev` است ولی باندل نهایی فقط از `dist` سرو می‌شود.

### وضعیت فعلی و تست‌ها (۲۰۲۶-۰۹-۲۰؛ دو لیست ۲۰۲۶-۰۹-۲۲ — بالا را ببین)
تست‌شده و کار می‌کند: لیست انتظار (خالی/پر)، جزئیات پست با ۴ دکمه، تقویم
شمسی+ساعت با `<TimePicker/>`، Schedule → `publish_at` ISO، ویرایش کپشن متنی و
ذخیره‌ی HTML-escaped، reject با مودال (بجای window.confirm که در تلگرام خراب
است)، upsert ریپو با `ON CONFLICT`، دکمه‌ی web_app در پیام ربات.
تست‌شده‌ی جدید (طرح دو لیست، ۲۰۲۶-۰۹-۲۲): approve واقعی (draft→approved+اسلات)،
لیست نهایی `/posts/final`، send-now (پیام واقعی message 159)، delete دودرجه.
فرم افزودن حالا **لینک کامل GitHub را هم می‌پذیرد** (`parseFullName` در
`AddRepo.jsx`: https://…، github.com/…، یا owner/repo — کامیت `f5c8ca3`).
بررسی نهایی: `dist` از باندل نهایی (index-DMObiDI3.js) فیکس لینک کامل را دارد.
ربات/بک‌اند **روی دیسک فعال‌اند** (سرور 3001 بالا، cloudflared پید 76680).

#### وضعیت LLM مینیاپ (۲۰۲۶-۰۹-۲۰، کامیت `f5c8ca3`)
`backend/.env` الان پر است: `LLM_BASE_URL=https://api.orcarouter.ai/v1/` با کلید
arka، `LLM_MODEL=orcarouter/free`، `LLM_FALLBACK_MODEL=deepseek/deepseek-v4-flash-free`،
`GITHUB_TOKEN` هم ست شد (از credential ن8ن رمزگشایی شد — /tmp پاک شد).

**تست مدل‌های free (نتیجه‌ی قطعی — کدام را امتحان کردیم):**
| منبع | نتیجه |
|---|---|
| `orcarouter/free` | ✅ یک‌بار 3/3 JSON داد — ولی **429 سخت** در ساعات مصرف‌شده (سهمیهی روز) |
| `deepseek/deepseek-v4-flash-free` (orca) | 429 مشابه |
| `z-ai/glm-5.3-flash-free` و siblings (orca) | content خالی با `json_object` — همان خطای «Unexpected end of JSON input» |
| `nvidia/nemotron-3.5-lightning:free` (OpenRouter) | prose نه JSON |
| `apinex free/*` | 402 «فقط با subscription» — عملاً رایگان نیست |
| `kira glm-5.3-flash-free` | 404 |
| `freemodel` | پایگاه نامعتبر |
| `opencode serve` (پورت 45585) | 401 — gateway نیست، فقط session-management (تأیید §۸) |
| `tabi claude-opus-5` | 403 Cloudflare |

نکته‌ی مهم: `llm.js` قبل از json.parse حالا content خالی را **retryable** می‌خواند
تا fallback تلاش کند — یعنی دیگر خطای «Unexpected end of JSON input» از سمت
فرانت نمی‌آید؛ فقط پیام `LLM failed: llm X: 429…` رخ می‌دهد وقتی هر دو free در
rate-limit باشند. نتیجه‌ی عملی: در ساعت‌های مصرف‌شده یا با سهمیه‌ی تمام‌شده،
add-gen صادقانه شکست می‌خورد تا اینکه خروجی خراب بسازد.

⚠️ اگر یک مدل free بالاخره پاسخ دهد، مدل‌های پایدارِ **غیرfree** orca
(`qwen/qwen3.6-flash`, `deepseek/deepseek-v4-flash`, `gemini-3.1-flash-lite`)
تست‌شده‌اند که 2/2 JSON_OK می‌دهند — برای وقتی کاربر بخواهد به paid برود.
کلیدهای دیگر opencode (`apinex`, `kira`, `tabi`) در `~/.local/share/opencode/auth.json`
هستند ولی free هایشان اینجا کار نمی‌کنند (جدول بالا).

### مراحل بعدی — به ترتیب پیشنهادی (کاربر قبلاً چهار مورد را دیده)
1. **فهم نهایی UX (Model B)**: هر پست جدید به‌جای پیام ربات با ۴ دکمه، به اپ
   برود؛ «تایید/رد/زمان/کپشن» از داخل اپ؛ ربات فقط منو/اطلاع باشد.
   ✅ **انجام شد (۲۰۲۶-۰۹-۲۰):** ربات Review Bot با دکمه‌ی web_app + دکمه‌ی del ساخت
   شد و کاربر حذف از لیست را در مینیاپ واقعاً کلیک کرد.
   ✅ **کامل‌تر شد (طرح دو لیست، ۲۰۲۶-۰۹-۲۲):** همه‌ی ۱۶ کاندیدا → draft +
   کارت ربات با نظر مدل → approve در مینیاپ → لیست نهایی با send-now/delete.
   (مسیرهای تلگرامی قدیمی بازبینی هنوز در workflow ربات مازادند — مورد ۴.)
2. ~~**دکمه‌ی باز کردن اپ از پیام‌های ربات** (همان reviewKeyboard که الان هست) —
   وقتی MINIAPP_URL روی دامنه‌ی عمومی بود، پیام تست بفرست و کلیک واقعی را چک کن.~~
   ✅ در Review Bot انجام شد (از discovery، پیام با دکمه‌ی web_app به MINIAPP_URL
   فرستاده می‌شود).
3. **deploy به VM `nimux`/`puregh`** (دامنه‌ی دوم مثل `puregh-app.style.dev`): بک‌اند +
   dist روی VM، اتصال DB مستقیم/local (الان SSH forward است)، LLM/GitHub env ها
   از n8n-معادل، webhook تلگرام (setWebhook) مثل §۱۹/§۲۲.
   ⚠️ **بعد از گام ۷ طرح دو لیست**: انتقال سه workflow لپ‌تاپ (Discovery ۳۰ نود،
   Review Bot، Publisher) + بک‌اند/فرانت جدید به VM و publish/active — الان فقط روی
   لپ‌تاپ است و VM نسخه‌ی قدیمی Discovery را اجرا می‌کند.
   ⚠️ قبل از deploy، تصمیم مدل LLM: مدل‌های free تست‌شده عملاً
   کار نمی‌کنند (429/402/404 — جدول بالا). اگر کاربر «فقط free» بخواهد، تنها
   گزینه‌ی واقعی `orcarouter/free` است که با سهمیه‌ی روزانه سخت 429 می‌دهد.
   برای پروداکشن احتمالاً باید به مدل پایدار orca (`qwen/qwen3.6-flash` یا
   `deepseek/deepseek-v4-flash`) برود.
4. **تصمیم درباره‌ی workflow ربات n8n**: مسیرهای بازبینی/افزودن/زمان ربات مازاد
   می‌شوند؛ نگه‌داشتن فقط برای لیست/منو یا غیرفعال‌کردن کامل (تصمیم کاربر).
5. **وصل‌کردن شباهت هدف مینیاپ** (`similarPostsText` در llm.js/رoutes.js از
   query شباهت هدف discovery) تا verdic نهایی حداقلِ گیرنده بودن را حفظ کند.
6. **NEW.md** (Discovery Engine دوم برای اخبار AI Agent) — خارج از مینیاپ، در
   صف است.

### درس‌های فنی مینیاپ (تکرار نشود)
| علامت | علت/رفع |
|---|---|
| صفحه‌ی سفید PostDetail | `timePicker({...})` به‌صورت call → crash روی `formattingIgnoreList` |
| تقویم هست، ساعت نیست | `<timePicker/>` حرف کوچک = تگ HTML؛ `const TimePicker = timePicker` |
| `window.confirm` در تلگرام | مودال خودساخته (`modal-overlay`) — از confirm استفاده نشود |
| run `regen` روی پست بدون publish_at | نال‌گارد در editReviewMessage (best-effort)؛ زمان دست نمی‌خورد |
| initData نامعتبر | مستندات جهت HMAC را برعکس می‌نویسند؛ see `initdata.js` |
| `?initData=` در URL برای تست خارج تلگرام | فقط dev — در prod فقط `window.Telegram.WebApp.initData` |
| facts/README برای regen | از ردیف خودِ ریپو + raw.githubusercontent (سهمیه‌ی API نمی‌سوزاند) |
| upsert تکراری | `ON CONFLICT (github_id)` آپدیت می‌کند — ریپو دوباره draft نمی‌گیرد مگر پستش حذف باشد |
| دکمه‌ی web_app لینک کهنه می‌داد | `MINIAPP_URL` در `backend/.env` و ثابت فایل `puregh-review-bot.ts` **دو جا جدا** است؛ عوض کردن یکی دکمه‌ی خراب می‌دهد. هر دو را همگام کن |

### فایل‌های کلیدی (برای توسعه‌ی بعدی)
- `backend/src/security/initdata.js` — اعتبارسنجی initData (جهت HMAC معکوس)
- `backend/src/routes.js` — همه‌ی endpoint ها + upsert/verify
- `backend/src/telegram.js` — reviewKeyboard (web_app) + best-effort ویرایش
- `frontend/src/components/ShamsiPicker.jsx` — تقویم شمسی+ساعت
- `frontend/src/format.js` — escapeHtml/stripHtml/faDateTime
- `frontend/src/pages/PostDetail.jsx` — عملیات/مودال/ویرایش
- `backend/.env.example` — قرارداد همه‌ی env ها