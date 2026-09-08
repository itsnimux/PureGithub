# متن‌هایی که باید در رابط n8n جایگزین کنی (بخش ۴)

## ۱. نود «Send to Bot» — لیبل دکمه‌های اینلاین

نود **Send to Bot** را باز کن. در بخش **Inline Keyboard** چهار دکمه می‌بینی با متن‌های موقت.
متن هر دکمه را با این‌ها جایگزین کن (callback_data ها را **دست نزن**، درست‌اند):

| دکمه | متن فعلی (موقت) | متن جدید |
|---|---|---|
| ردیف ۱، دکمه ۱ | `APPROVE` | `✅ تایید` |
| ردیف ۲، دکمه ۱ | `REJECT` | `❌ رد` |
| ردیف ۲، دکمه ۲ | `REGEN` | `🔄 ساخت دوباره کپشن` |
| ردیف ۲، دکمه ۳ | `MANUAL` | `✍️ نوشتن دستی کپشن` |

بعد از جایگزینی، ذخیره کن.

## ۲. یادآوری — نود «Generate Caption»

اگر هنوز پرامپت سیستم را نگذاشتی: فایل `workflows/caption-system-prompt.txt`
را باز کن، کل متن را در فیلد **Message** (پیام System) نود Generate Caption پیست کن.

## ۳. نودهای مدل LLM

- **AI Model - Primary** → credential و Model ID خودت
- **AI Model - Fallback** → credential و Model ID خودت
- `Use Responses API` در هر دو **off** بماند
