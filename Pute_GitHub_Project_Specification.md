# Pute GitHub — Project Specification

## 1. ایده اصلی

**Pute GitHub** یک سیستم هوشمند برای کشف، ارزیابی و معرفی پروژه‌های جذاب، کاربردی، عجیب و کمترشناخته‌شده‌ی Open Source است.

هدف فقط ساخت یک کانال تلگرام نیست؛ هدف ساخت یک **Open Source Discovery Engine** است که بتواند:

1. از کانال‌های مشابه به‌عنوان Reference یاد بگیرد.
2. الگو و سلیقه‌ی انتخاب پروژه را استخراج کند.
3. این دانش را در Knowledge Base نگه دارد.
4. پروژه‌های جدید GitHub را پیدا کند.
5. آن‌ها را با استفاده از Knowledge Base و RAG ارزیابی کند.
6. بهترین پروژه‌ها را رتبه‌بندی کند.
7. برای آن‌ها Caption فارسی تولید کند.
8. در ابتدا با Human Review و بعداً به‌صورت خودکار در Telegram منتشر کند.
9. از عملکرد پست‌های خودش برای بهبود Selection Profile استفاده کند.

---

## 2. مسئله

هر روز تعداد زیادی Repository جدید در GitHub ساخته یا به‌روزرسانی می‌شوند. پیدا کردن پروژه‌های واقعاً ارزشمند از میان آن‌ها زمان‌بر است.

مشکلات:

- حجم زیاد Repositoryها
- وجود Fork، Spam و پروژه‌های کم‌کیفیت
- پنهان ماندن پروژه‌های خوب با Star کم
- زمان‌بر بودن بررسی README و وضعیت پروژه
- نیاز به تولید محتوای قابل‌فهم برای معرفی

ارزش Pute GitHub در خود لینک GitHub نیست؛ در **Discovery + Filtering + Curation** است.

> «از بین حجم عظیم پروژه‌های Open Source، چیزهایی را پیدا کن که احتمالاً خود کاربر هیچ‌وقت پیدا نمی‌کرد.»

---

## 3. مخاطب هدف

- برنامه‌نویس‌ها
- دانشجویان Computer Science / Software Engineering
- Open Source enthusiasts
- Linux users
- Security Researchers
- AI enthusiasts
- Backend / Frontend developers
- DevOps engineers
- علاقه‌مندان پروژه‌های عجیب و خلاقانه

سه نوع محتوای اصلی:

```text
Useful
Interesting
Weird
```

---

## 4. Value Proposition

پیام محصول نباید این باشد:

> «ما با AI پروژه‌های GitHub پیدا می‌کنیم.»

این فقط تکنولوژی است.

Value Proposition:

> **هر روز چند پروژه Open Source که واقعاً ارزش دیدن دارند، بدون اینکه مجبور باشی GitHub را زیر و رو کنی.**

---

# 5. معماری کلی

سیستم سه Loop اصلی دارد:

```text
Reference Channels
        ↓
Learning Pipeline
        ↓
Knowledge Base
        ↓
GitHub Discovery
        ↓
Candidate Repositories
        ↓
RAG + AI Evaluation
        ↓
Ranking
        ↓
Caption Generation
        ↓
Telegram
        ↓
Analytics / Feedback
        ↓
Knowledge Base
```

نکته مهم:

**Learning و Discovery دو فرآیند جدا هستند.**

Learning می‌پرسد:

> «چه چیزی را دوست داریم؟»

Discovery می‌پرسد:

> «الان چه پروژه‌ای با این سلیقه مطابقت دارد؟»

---

# 6. Reference Channels

چند کانال تلگرامی مشابه به‌عنوان **Reference Sources** انتخاب می‌شوند.

هدف کپی کردن محتوای آن‌ها نیست.

هدف:

> استخراج معیارها و الگوهای انتخاب پروژه از Curatorهای موفق.

مثلاً اگر در هزاران پست متوجه شویم پروژه‌های کوچک، کاربردی، عجیب و دارای Demo زیاد انتخاب شده‌اند، این به Selection Profile منتقل می‌شود.

---

# 7. Learning Pipeline

Learning Pipeline مثلاً هفته‌ای یک بار اجرا می‌شود و فقط داده‌های جدید را بررسی می‌کند.

```text
Reference Channels
        ↓
Collect New Posts
        ↓
Extract GitHub URLs
        ↓
Fetch Repository Data
        ↓
Analyze Post + Repository
        ↓
Extract Patterns
        ↓
Update Selection Profile
        ↓
Update Knowledge Base
```

لازم نیست هر بار Discovery از صفر هزاران پست را بخواند.

---

# 8. Selection Profile

AI باید از پست‌های Reference یک Selection Profile بسازد.

مثال:

```text
Highly Preferred
-----------------
- unusual technical ideas
- practical developer tools
- strong visual demos
- recently active repositories
- clear README
- small/medium repositories
- high wow factor

Moderately Preferred
--------------------
- AI tools
- Linux utilities
- security tools
- productivity tools

Avoid
-----
- generic CRUD
- boilerplates
- tutorial repositories
- abandoned repositories
- obvious forks
- simple wrappers
- low-effort AI wrappers
```

این Profile باید قابل به‌روزرسانی باشد.

---

# 9. Knowledge Base

Knowledge Base فقط متن خام پست‌ها نیست.

دو نوع Knowledge اصلی داریم.

## A. Examples

نمونه‌های واقعی:

```text
Repository
Telegram Post
Why selected
Category
Repository metadata
```

## B. Patterns / Rules

دانش استخراج‌شده:

```text
Preferred characteristics
Avoided characteristics
Strong signals
Weak signals
Category preferences
Common repository types
```

نمونه ساختار:

```json
{
  "selection_profile": {
    "preferred": [
      "unusual ideas",
      "practical tools",
      "strong visual demo"
    ],
    "avoid": [
      "boilerplates",
      "generic CRUD",
      "abandoned repositories"
    ]
  },
  "patterns": [
    {
      "pattern": "small but practical tools",
      "strength": 0.91
    }
  ]
}
```

---

# 10. RAG

هنگام بررسی یک Repository جدید، Agent نباید کل Knowledge Base را وارد Context کند.

فرآیند:

```text
Candidate Repository
        ↓
Generate Query
        ↓
Retrieve Relevant Examples / Patterns
        ↓
AI Agent
        ↓
Evaluate Candidate
```

مثلاً Agent برای یک ابزار امنیتی، نمونه‌های مشابه امنیتی و معیارهای مرتبط را Retrieve می‌کند.

---

# 11. چرا Fine-Tuning در ابتدا انجام نمی‌دهیم؟

چیزی که پروژه نیاز دارد بیشتر **Dynamic Knowledge** است تا تغییر دائمی پارامترهای مدل.

مثلاً:

```text
Old preference:
AI wrappers acceptable

New preference:
Low-effort AI wrappers rejected
```

با Knowledge Base فقط Rule به‌روزرسانی می‌شود.

نیازی به Training مجدد نیست.

Fine-Tuning را می‌توان بعداً، پس از جمع شدن Dataset باکیفیت، آزمایش کرد.

---

# 12. GitHub Discovery Engine

در MVP منبع اصلی GitHub API است.

اطلاعات:

```text
Repository name
Description
URL
Stars
Forks
Language
Topics
Created date
Updated date
License
Open issues
Contributors
README
Repository status
```

Discovery نباید فقط بر GitHub Trending متکی باشد.

منابع/Queryهای آینده:

- Recently created repositories
- Recently growing repositories
- Category-based searches
- Unusual topics
- High recent activity
- Strong documentation

---

# 13. Candidate Filtering

قبل از LLM، فیلترهای ارزان و deterministic اجرا می‌شوند.

مثال:

```text
Repository is not archived
AND
Has README
AND
Not obvious spam
AND
Not only a fork
AND
Recently active
AND
Stars > minimum threshold
```

Thresholdها بعداً با داده واقعی تنظیم می‌شوند.

---

# 14. Star Count

Star فقط یک Signal است.

نباید معیار اصلی باشد.

مثلاً:

```text
Project A
100,000 stars

Project B
850 stars
+ unusual idea
+ active development
+ excellent README
+ real usefulness
```

ممکن است Project B ارزش بیشتری برای Pute GitHub داشته باشد.

هدف اصلی کشف **Hidden Gems** است.

---

# 15. AI Evaluation Agent

Agent اطلاعات زیر را دریافت می‌کند:

```text
Repository metadata
README
Topics
Recent activity
Selection Profile
Relevant Knowledge Base examples
```

وظیفه:

> تعیین کند آیا Repository با سلیقه Pute GitHub سازگار است یا نه.

نمونه خروجی:

```json
{
  "interesting": true,
  "score": 87,
  "novelty": 91,
  "usefulness": 82,
  "growth": 76,
  "activity": 88,
  "wow_factor": 94,
  "category": "developer-tools",
  "target_audience": [
    "developers",
    "security researchers"
  ],
  "reason": "..."
}
```

---

# 16. Scoring Model

مدل اولیه:

```text
Interesting Score
│
├── Novelty       25%
├── Usefulness    25%
├── Growth        20%
├── Activity      10%
├── Simplicity    10%
└── Wow Factor    10%
```

این Weightها ثابت نیستند و باید با داده واقعی Calibration شوند.

---

# 17. Wow Factor

Wow Factor یکی از مهم‌ترین Signals است.

ویژگی‌های مثبت:

- ایده غیرمعمول
- استفاده خلاقانه از تکنولوژی
- ابزار سرگرم‌کننده
- حل یک مسئله سخت به شکل ساده
- Demo جذاب
- قابلیت قابل توضیح در چند جمله
- چیزی که کاربر احتمالاً قبلاً ندیده است

---

# 18. Categories

دسته‌بندی اولیه:

```text
🤖 AI
🛠 Developer Tools
🔐 Security
🐧 Linux
🌐 Web
📱 Mobile
🎨 Creative
😂 Fun
🧪 Experimental
⚡ Productivity
🗄 Backend
🎮 Gaming
📊 Data
```

یک Repository می‌تواند چند Category داشته باشد.

---

# 19. Ranking

پس از AI Evaluation:

```text
Repository A → 92
Repository B → 88
Repository C → 84
Repository D → 73
Repository E → 61
```

فقط پروژه‌هایی که از Quality Threshold عبور می‌کنند وارد تولید محتوا می‌شوند.

مثلاً:

```text
score >= 80
```

---

# 20. Caption Generator

Caption Generator یک Agent/مرحله جدا است.

وظیفه:

> تبدیل اطلاعات واقعی Repository به یک معرفی کوتاه، طبیعی و جذاب فارسی.

ورودی:

```text
Repository metadata
AI evaluation
Why selected
Category
Audience
```

---

# 21. اصول Caption

Caption باید:

- فارسی باشد.
- طبیعی باشد.
- کوتاه و قابل اسکن باشد.
- دلیل جالب بودن پروژه را مشخص کند.
- اطلاعات factual را از داده واقعی GitHub بگیرد.
- ادعای بدون منبع نداشته باشد.
- شبیه متن‌های Generic و AI-generated نباشد.

---

# 22. قالب پیشنهادی Post

```text
🤯 [عنوان]

[معرفی کوتاه و جذاب]

🔥 چرا جالبه؟
[دلیل اصلی]

🛠 چه کاری انجام میده؟
[توضیح ساده]

👨‍💻 مناسب برای:
[مخاطبان]

⭐ [Stars]
💻 [Language]
📜 [License]

🔗 GitHub:
[URL]
```

قالب بعداً قابل تغییر است.

---

# 23. Telegram Publishing

در MVP بهتر است Human Review داشته باشیم:

```text
AI
 ↓
Private Admin Chat
 ↓
[Publish]
[Reject]
[Regenerate]
 ↓
Channel
```

پس از Calibration:

```text
AI
 ↓
Quality Gate
 ↓
Auto Publish
```

---

# 24. Human Review

در شروع ممکن است AI:

- پروژه ضعیف انتخاب کند.
- پروژه تکراری انتخاب کند.
- README را اشتباه تفسیر کند.
- اطلاعات نادرست تولید کند.
- پروژه نامناسب برای مخاطب انتخاب کند.

Human Review علاوه بر کنترل کیفیت، منبع مهمی برای **Feedback Learning** است.

---

# 25. Feedback Loop

بعد از انتشار:

```text
Post
 ↓
Views
Clicks
Shares
Forwards
Reactions
 ↓
Performance Analysis
 ↓
Update Selection Profile
```

مثلاً اگر ابزارهای عجیب Linux دائماً Engagement بالایی بگیرند، این Signal در Ranking آینده اثر می‌گذارد.

---

# 26. Self-Improvement

دانش سیستم از سه منبع می‌آید:

```text
Reference Channels
        +
Pute GitHub Performance
        +
Human Feedback
        ↓
Updated Knowledge Base
```

پس سیستم به مرور Calibration می‌شود.

---

# 27. Database

برای MVP می‌توان SQLite داشت؛ برای نسخه دائمی PostgreSQL بهتر است.

## repositories

```text
id
github_id
name
url
description
stars
forks
language
score
category
first_seen
last_checked
published
```

## posts

```text
id
repository_id
caption
status
created_at
published_at
telegram_message_id
```

## reference_posts

```text
id
channel
telegram_message_id
github_url
raw_text
created_at
processed
```

## patterns

```text
id
type
description
strength
source
updated_at
```

---

# 28. Knowledge Storage

دو لایه:

### Structured

در PostgreSQL:

```text
Rules
Patterns
Scores
Metadata
Examples
```

### Semantic

در Vector Store:

```text
Reference Posts
README snippets
Reference examples
Pattern explanations
```

اما Vector DB از روز اول الزام نیست.

MVP می‌تواند با PostgreSQL و جست‌وجوی ساده شروع شود.

---

# 29. n8n Workflows

## Workflow 1 — Reference Collector

```text
Schedule
 ↓
Reference Channel
 ↓
Collect Posts
 ↓
Extract GitHub URLs
 ↓
Save
```

## Workflow 2 — Pattern Learning

```text
New Reference Posts
 ↓
Fetch Repository
 ↓
AI Analysis
 ↓
Extract Patterns
 ↓
Update Knowledge Base
```

## Workflow 3 — GitHub Discovery

```text
Schedule
 ↓
GitHub API
 ↓
Candidate Filtering
 ↓
Dedup
 ↓
RAG
 ↓
AI Evaluation
 ↓
Ranking
```

## Workflow 4 — Content Generation

```text
Top Candidate
 ↓
Caption Generator
 ↓
Fact Check
 ↓
Admin Review
 ↓
Telegram
```

## Workflow 5 — Feedback

```text
Published Posts
 ↓
Collect Metrics
 ↓
Analyze Performance
 ↓
Update Knowledge
```

---

# 30. تکنولوژی‌های پیشنهادی

| بخش | تکنولوژی |
|---|---|
| Automation | n8n |
| Discovery | GitHub API |
| Reference Data | Telegram |
| AI | OpenAI / Gemini / Claude |
| Database | PostgreSQL |
| Semantic Search | Vector Store در صورت نیاز |
| Messaging | Telegram Bot API |
| Deployment | Docker Compose |
| Server | VPS |
| Processing | JavaScript / n8n Code Nodes |

---

# 31. کنترل هزینه LLM

نباید هر Repository مستقیماً به مدل قوی ارسال شود.

Pipeline:

```text
1000 repositories
        ↓
Cheap deterministic filters
        ↓
100 repositories
        ↓
Cheap AI classification
        ↓
20 repositories
        ↓
Strong AI analysis
        ↓
3–5 candidates
        ↓
Caption generation
```

این کار هزینه را کاهش می‌دهد.

---

# 32. Fact Checking

اطلاعات factual مستقیماً از GitHub گرفته شوند:

```text
Stars
Language
License
URL
Fork status
Updated date
```

LLM نباید این موارد را از خودش حدس بزند.

---

# 33. Duplicate Prevention

برای هر Repository یک شناسه یکتا نگه داشته شود:

```text
GitHub repository ID
```

یا:

```text
owner/repository
```

اگر قبلاً منتشر شده:

```text
SKIP
```

---

# 34. ریسک‌ها

## AI Slop

راه‌حل:

- Prompt دقیق
- Reference Examples
- Human Review
- Fact Checking
- Style Guide

## پروژه‌های ضعیف

راه‌حل:

- Filtering
- RAG
- Scoring
- Quality Threshold

## تکرار

راه‌حل:

- Database
- Deduplication

## هزینه LLM

راه‌حل:

- Pre-filtering
- Model routing
- Caching
- محدود کردن Context

## وابستگی به Reference Channels

Knowledge باید ترکیبی باشد:

```text
Reference Channels
+
Actual Repository Data
+
Pute GitHub Feedback
```

---

# 35. کپی‌برداری ممنوع

Reference Channels فقط برای یادگیری هستند.

هدف:

```text
Learn what they like
```

نه:

```text
Copy what they posted
```

سیستم باید بتواند پروژه‌هایی را پیدا کند که Reference Channels اصلاً معرفی نکرده‌اند.

---

# 36. مزیت رقابتی بالقوه

```text
Reference Channels
        ↓
Learn Selection Patterns
        ↓
GitHub Universe
        ↓
Find Similar-but-undiscovered Projects
        ↓
Pute GitHub
```

هدف:

> پیدا کردن پروژه‌هایی که هنوز به اندازه کافی دیده نشده‌اند.

---

# 37. Metrics

## Content

- Views
- View / Subscriber ratio
- Reactions
- Shares
- Forwards
- Link clicks

## Discovery

- GitHub clicks
- Repository stars after publication
- User submissions
- Repeat engagement

## AI

- False Positive Rate
- Duplicate Rate
- Hallucination Rate
- Human rejection rate
- Regeneration rate

---

# 38. KPI مهم

تعداد Subscribers به‌تنهایی کافی نیست.

یکی از Metrics مهم:

```text
Average GitHub Clicks / Post
```

چون هدف این است که کاربر واقعاً پروژه را باز کند.

---

# 39. فازهای توسعه

## Phase 0 — Research

- انتخاب ۵ تا ۱۰ Reference Channel
- جمع‌آوری نمونه پست‌ها
- استخراج اولیه معیارها
- تعریف مخاطب
- بررسی تفاوت کانال‌ها

## Phase 1 — Basic MVP

- راه‌اندازی n8n
- ساخت Telegram Bot
- اتصال GitHub API
- دریافت Repository
- Filtering
- AI Analysis
- Caption Generation
- Telegram Publishing

## Phase 2 — Learning System

- جمع‌آوری Reference Posts
- استخراج GitHub URLs
- تحلیل Repositoryها
- Pattern Extraction
- Selection Profile
- Knowledge Base

## Phase 3 — RAG

- ذخیره Examples
- Embedding
- Retrieval
- تزریق Context به Agent
- ارزیابی Candidate بر اساس Knowledge

## Phase 4 — Quality

- Scoring
- Deduplication
- Fact checking
- Human Review
- Negative examples
- Quality Gate

## Phase 5 — Feedback

- Telegram analytics
- GitHub clicks
- User reactions
- Human decisions
- Update Selection Profile

## Phase 6 — Full Automation

- Auto ranking
- Auto caption
- Auto fact check
- Auto publish
- Automated learning

---

# 40. MVP Definition of Done

- [ ] n8n اجرا شود.
- [ ] Telegram Bot ساخته شود.
- [ ] Bot در Channel Admin باشد.
- [ ] GitHub API متصل شود.
- [ ] Repository دریافت شود.
- [ ] Filtering انجام شود.
- [ ] AI Repository را تحلیل کند.
- [ ] Score تولید شود.
- [ ] Caption فارسی تولید شود.
- [ ] Telegram پیام را دریافت کند.
- [ ] پیام در Channel منتشر شود.
- [ ] کل Workflow با Trigger اجرا شود.

---

# 41. Learning System Definition of Done

- [ ] Reference Channels مشخص شوند.
- [ ] Posts جمع‌آوری شوند.
- [ ] GitHub URLs استخراج شوند.
- [ ] Repositoryها Fetch شوند.
- [ ] Post + Repository تحلیل شوند.
- [ ] Good Patterns استخراج شوند.
- [ ] Negative Patterns استخراج شوند.
- [ ] Selection Profile ساخته شود.
- [ ] Examples ذخیره شوند.
- [ ] Knowledge Base قابل Query باشد.
- [ ] Agent بتواند Knowledge مرتبط را Retrieve کند.

---

# 42. معماری نهایی مطلوب

```text
                   Reference Channels
                           │
                           ▼
                    Learning Engine
                           │
                           ▼
                    Knowledge Base
                           │
                           │
GitHub ───────────→ Discovery Engine
                           │
                           ▼
                     Candidate Pool
                           │
                           ▼
                       RAG Search
                           │
                           ▼
                        AI Agent
                           │
                           ▼
                         Ranking
                           │
                           ▼
                    Quality Threshold
                           │
                           ▼
                   Caption Generator
                           │
                           ▼
                     Fact Checking
                           │
                           ▼
                    Telegram Channel
                           │
                           ▼
                       Analytics
                           │
                           ▼
                    Feedback Learning
                           │
                           └──────────→ Knowledge Base
```

---

# 43. اصل معماری

**Learning و Discovery جدا هستند.**

Learning:

```text
«چه نوع پروژه‌ای ارزش معرفی دارد؟»
```

Discovery:

```text
«کدام Repositoryهای جدید با این سلیقه مطابقت دارند؟»
```

Feedback:

```text
«آیا انتخاب ما واقعاً خوب بوده؟»
```

این سه حلقه با هم سیستم را بهبود می‌دهند.

---

# 44. Fine-Tuning در آینده

در مرحله اول Fine-Tuning انجام نمی‌شود.

بعد از جمع شدن Dataset واقعی:

```text
Repository
+
Reference Context
+
AI Decision
+
Human Decision
+
Reason
+
Performance
```

می‌توان Fine-Tuning را آزمایش کرد.

معماری آینده ممکن است:

```text
Fine-Tuned Model
+
RAG
+
Knowledge Base
```

باشد.

Knowledge Base همچنان لازم است، چون سلیقه و داده‌های بیرونی دائماً تغییر می‌کنند.

---

# 45. تعریف محصول نهایی

Pute GitHub در ظاهر یک Telegram Channel است، اما در واقع یک Discovery Engine است.

```text
Reference Learning
        +
Knowledge Base
        +
RAG
        +
GitHub Discovery
        +
AI Evaluation
        +
Ranking
        +
Content Generation
        +
Feedback Learning
```

هدف نهایی:

> **Pute GitHub باید به مرور زمان در پیدا کردن GitHub Gems بهتر شود؛ پروژه‌هایی که کاربر احتمالاً بدون این سیستم هیچ‌وقت به آن‌ها نمی‌رسید.**

چرخه اصلی:

```text
1. Learn
   ↓
2. Discover
   ↓
3. Publish
   ↓
4. Measure
   ↓
5. Learn from Results
   ↓
6. Discover Better
   ↓
7. Repeat
```

---

# 46. Future Product

اگر کانال موفق شود، Pute GitHub می‌تواند به محصول مستقل تبدیل شود:

### Website

```text
Pute GitHub

🔥 Today's Picks
🆕 New Gems
🤖 AI
🔐 Security
🐧 Linux
🛠 Developer Tools
😂 Weird Projects
```

### Personalized Discovery

```text
Find me unusual cybersecurity projects.
```

### Telegram Bot

```text
/ai
/security
/linux
/mobile
```

### Newsletter

Daily / Weekly Open Source Digest

### Community

User submissions + voting

---

# 47. خلاصه یک‌خطی

> **Pute GitHub یک سیستم هوشمند Curated Discovery است که از رفتار Curatorهای واقعی یاد می‌گیرد، آن دانش را در Knowledge Base نگه می‌دارد و با استفاده از RAG و AI، GitHub Gems جدید را پیدا و معرفی می‌کند.**
