# AGENTS.md — حافظه پروژه Pure GitHub (برای دستیار opencode)

> این فایل را در شروع هر جلسه بخوان. آخرین به‌روزرسانی: 2026-09-05

## ۱) پروژه چیست؟

**Pure GitHub** — یک Discovery Engine برای پروژه‌های منبع‌باز که در ظاهر یک کانال
تلگرام است. هدف: پیدا کردن «GitHub Gems» (پروژه‌های ارزشمند کم‌دیده‌شده)، تولید
Caption فارسی، و انتشار در کانال پس از تأیید انسانی.

- سند اصلی: `Pute_GitHub_Project_Specification.md` (۴۷ بخش، فقط طرح — نه پیاده‌سازی)
- **نام درست پروژه `Pure` است، نه `Pute`.** اسم فایل سند غلط تایپی است.
- زبان محتوا: فارسی. کادنس فعلی: **یک پست در روز**.
- مسیر پروژه: `/home/nimux/Documents/PureGithub-project`

## ۲) وضعیت فعلی: قدم ۱ کامل است

مسیر انتشار با ریپوی دستی کار می‌کند و end-to-end تست شده. دو پست واقعاً در
کانال منتشر شده‌اند.

فازهای بعدی (هنوز شروع نشده): Discovery خودکار، Reference Learning، RAG،
Feedback Loop.

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

## ۴) فایل‌های پروژه

```
docker-compose.yml          فقط DB. n8n داخلش نیست.
.env                        رمز DB (perm 600، در .gitignore)
db/schema.sql               اسکیما، idempotent، در initdb اجرا می‌شود
scripts/setup.sh            بالا آوردن DB + اتصال n8n به شبکه
scripts/backup.sh           بکاپ DB + کلید رمز credential های n8n
workflows/*.ts              کد SDK هر سه workflow (منبع حقیقت)
```

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

## ۶) سه workflow در n8n

| نام | id | کار |
|---|---|---|
| Pure GitHub — Manual Publish | `oSo3G6YhDd8603eu` | مسیر اصلی |
| Pure GitHub — Provider Check | `gpFQDxJSXQerF0VT` | تست هر provider سازگار OpenAI |
| Pure GitHub — Telegram Channel Check | `A3VMKNB4oVfkxHJx` | تشخیص خطای chat not found |

هر سه `active: false` هستند (اجرای دستی/تست).

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

## ۱۳) امنیت

- کلید رمز credential های n8n داخل volume `n8n_data` فایل `config` است.
  **اگر آن volume برود همه credential ها می‌روند.** `scripts/backup.sh` آن را هم می‌گیرد.
- پورت DB فقط روی `127.0.0.1` bind شده.
- `.env` با perm 600 و در `.gitignore`.
- workflow ها `active: false` هستند؛ فرم‌های ن8n به‌صورت عمومی expose نمی‌شوند
  چون publish نشده‌اند.

## ۱۴) ریسک‌های شناخته‌شده (به کاربر گفته شده، هنوز حل نشده)

1. **دسترس‌پذیری:** این یک لپ‌تاپ است نه VPS. Schedule Trigger اجرای
   از‌دست‌رفته را جبران نمی‌کند — لپ‌تاپ خواب باشد، پست آن روز نمی‌رود.
2. **KPI «کلیک روی لینک» (§۳۸ سند) بدون redirector غیرممکن است.** نیاز به
   URL عمومی دارد.
3. **فرض یادگیری از کانال‌های مرجع ضعیف است:** اکثرشان از Trending پست
   می‌گذارند، پس یاد گرفتن سلیقه‌شان برعکس هدف Hidden Gems است.
   پیشنهاد دادم Selection Profile را کاربر دستی بنویسد و کانال‌های مرجع فقط
   **لیست منفی/dedup** باشند. کاربر موافقت کرد.
4. **بازبینی محلی است** (فرم ن8n روی localhost). برای دکمه‌های inline تلگرام
   یا شمارش کلیک، cloudflared tunnel لازم است.

## ۱۵) سبک تعامل با این کاربر

- فارسی می‌نویسد و جواب فارسی می‌خواهد.
- خطاهای واقعی n8n را کامل paste می‌کند و انتظار **تشخیص علت ریشه‌ای** دارد،
  نه حدس. رویکردی که جواب داده: ساختن workflow تشخیصی مجزا (مثل دو Check
  موجود) که علت را از هم جدا کند.
- بازخورد صریح می‌دهد («امتیاز ۶۰ از ۱۰۰») و انتظار دارد اعمال شود.
- خودش تنظیمات UI را انجام می‌دهد؛ credential و chat id را خودش می‌سازد.
- قدم‌به‌قدم پیش می‌رود و تأیید می‌خواهد. اول تشخیص، بعد اصلاح.
