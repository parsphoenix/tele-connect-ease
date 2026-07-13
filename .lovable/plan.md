# پلن اجرا (چند فاز)

با توجه به حجم زیاد درخواست‌ها، کار را در ۴ فاز انجام می‌دهم. هر فاز مستقل قابل تست است.

---

## فاز ۱ — رفع اشکال‌های بحرانی

۱. **ROOM_NOT_FOUND هنگام ساخت اتاق** — بررسی می‌کنم که `createRoom` بعد از insert خروجی `code` را برگرداند و در dashboard مسیر ناوبری درست بشه (احتمالاً refetch لیست قبل از navigation باعث cleanup می‌شود).  
۲. **PASSWORD_REQUIRED در ورود** — منطق ورود به اتاق رمزدار: اگر کاربر رمز وارد کرد، پیام modal رمز نمایش داده شود؛ فعلاً بلافاصله error می‌دهد.  
۳. **Kick درست کار نمی‌کند** — پیام control به peer هدف ارسال شود و peer باید خودش leave را صدا بزند.  
۴. **حذف اتاق خالی بعد از 3 دقیقه** (نه ۲ دقیقه فعلی) — تغییر interval در `cleanupEmptyRooms`.  
۵. **کپچا ساده هنگام ساخت اتاق** — همانند صفحه ورود.

---

## فاز ۲ — بهبود UI/UX اتاق

۶. **آیکون Wi-Fi پویا** — بر اساس ping (سبز <100ms، زرد <300ms، قرمز >300ms).  
۷. **افزایش سقف چت به ۵۰۰ کاراکتر** — `CHAT_MAX_CHARS = 500`.  
۸. **کادر سبز برای speaker در چت** (VAD-broadcast) — پخش وضعیت VAD روی DataChannel و رنگ نام کاربر.  
۹. **نمایش اسکرین شیر برای خود اشتراک‌گذار** — attach کردن screen stream به یک preview video محلی.  
۱۰. **ویدیوی اشتراکی** — پشتیبانی از YouTube / Aparat / embed code (iframe adapter + پیام sync محدود).  
۱۱. **نمایش ویدیوی اشتراکی به‌عنوان یک کارت در گرید کاربران**.  
۱۲. **کوچک/بازکردن پنجرهٔ چت** با انیمیشن و state.  
۱۳. **حذف پیام‌های خودِ کاربر از تاریخچهٔ چت** (فقط سمت خودش، چون تاریخچه local است).  
اصلاح کردن حالت و درست کردن  picture in picture  تا به درستی کار کند . 

---

## فاز ۳ — پنل ادمین: زیرساخت

۱۴. **جدول‌های DB:**

- `admin_users` (email, password_hash, provider)
- `banned_emails`
- `banned_ips`
- `user_bans` (user_id, until, reason)
- `app_settings` (key/value JSON برای تنظیمات عمومی)
- `announcements`
- `emojis` (custom pack)
- ثبت `ip_address` روی sessions

۱۵. **مسیر** `/admin/login` — ورود ایمیل/پسورد + گزینهٔ Google (به‌عنوان placeholder با راهنمای secret).  
۱۶. **middleware** `requireAdmin` برای همه server functionهای admin.

---

## فاز ۴ — پنل ادمین: صفحات

۱۷. `/admin` — داشبورد آمار (کاربران آنلاین، اتاق‌ها ) با refresh هر ۲۰ دقیقه.  
۱۸. `/admin/users` — CRUD کاربران، مسدود/رفع مسدود دائمی/موقت، مشاهدهٔ فعالیت + IP.  
۱۹. `/admin/rooms` — لیست، ویرایش نام/سقف کاربر، حذف اتاق.  
۲۰. `/admin/bans` — مدیریت IP‌های مسدود و ایمیل‌های غیرمجاز.  
۲۱. `/admin/settings` — تنظیمات کلی:

- کیفیت پیش‌فرض ویدیو
- سرور TURN
- فعال/غیرفعال ویژگی‌ها
- زبان پیش‌فرض
- سقف کاراکتر چت
- نوع کپچا (ساده/Google reCAPTCHA/Cloudflare Turnstile)
- روش ورود ادمین و کاربران (email / Google / username&password)
- فونت پیش‌فرض  
۲۲. `/admin/announcements` — بنر خبری بالای سایت با WYSIWYG ساده.  
۲۳. `/admin/emojis` — آپلود ایموجی سفارشی / پک.  
۲۴. `/admin/security` — تنظیمات امنیتی (rate limits، طول session، …).

---

## نکات فنی

- ورود Google واقعی نیاز به OAuth دارد؛ در فاز ۴ به‌صورت ایمیل/پسورد ادمین راه‌اندازی می‌شود و Google به‌عنوان قابلیت اختیاری با راهنمای دریافت Client ID افزوده می‌شود.
- reCAPTCHA/Turnstile به کلید publishable نیاز دارد؛ بدون کلید، به کپچای ساده fallback می‌کند.
- تنظیمات عمومی از `app_settings` بارگذاری و در client cache می‌شوند.
- خطای Preview («This page didn't load») همچنان به دلیل ناسازگاری `mysql2` با Cloudflare Workers است و در cPanel هدف رفع می‌شود.

---

## ترتیب پیشنهادی تحویل

**تیک ۱:** فاز ۱ + فاز ۲ (رفع باگ‌ها + بهبود اتاق) — سریع، بدون DB migration بزرگ.  
**تیک ۲:** فاز ۳ (migration + auth ادمین).  
**تیک ۳:** فاز ۴ (تک‌تک صفحات پنل).

آیا با این ترتیب موافقی یا بخشی اولویت بیشتری دارد؟