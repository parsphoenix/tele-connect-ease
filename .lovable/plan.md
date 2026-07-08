## هدف

یک پلتفرم ارتباطی سبک برای شبکه ملی/اینترنت داخلی ایران: چت متنی، تماس صوتی و تصویری دو نفره و گروهی تا ۱۶ نفر، با پردازش کامل سمت کاربر (P2P Mesh) و حداقل بار سرور. UI الهام‌گرفته از داشبورد FACEIT (تیره، کارت‌محور، آبی نئون).

## معماری کلی

```text
┌─────────────┐         WebSocket (Signaling)         ┌──────────────┐
│  Browser A  │◄─────────────────────────────────────►│  Node.js     │
└─────┬───────┘                                       │  Server      │
      │                                               │  (cPanel)    │
      │  WebRTC DataChannel + Media (P2P Mesh)        │              │
      │◄──────────────────────────────────────────────┤  MySQL       │
┌─────┴───────┐                                       │  (users,     │
│  Browser B  │◄─────────────────────────────────────►│   rooms,     │
└─────────────┘                                       │   friends)   │
                                                      └──────────────┘
```

- **سرور فقط برای:** signaling (تبادل SDP/ICE)، احراز هویت، لیست اتاق‌ها/دوستان، وضعیت آنلاین. هیچ پردازش رسانه‌ای.
- **کاربر:** رمزنگاری، انکود/دیکود ویدیو، DataChannel برای چت و فایل.
- **TURN :** فیلد پیکربندی در `.env` برای افزودن سرور TURN داخلی جهت عبور از NAT.

## استک فنی

- **Backend:** Node.js + Express + `ws` (WebSocket signaling) — سازگار با Node.js cPanel
- **Database:** MySQL (کتابخانه `mysql2`) — ساختار اسکیمای خودکار در اولین اجرا
- **Frontend:** همین پروژه TanStack Start (SPA build خروجی به `dist/`)، سرو استاتیک توسط همان Node.js
- **WebRTC:** API خام مرورگر (بدون کتابخانه سنگین) + `simple-peer` برای مدیریت Mesh
- **UI:** Tailwind v4 + shadcn (موجود در پروژه)، تم تیره شبیه FACEIT

## قابلیت‌ها  
  
دوزبان فارسی و انگلیسی قابل انتخاب  که زبان فارسی پیش فرض

### احراز هویت

- فرم ورود ساده: نام کاربری + رمز عبور + کپچای ریاضی (`3 + 5 = ?`)
- اگر نام کاربری موجود نباشد → ثبت خودکار (bcrypt برای رمز)
- Session با HttpOnly Secure Cookie
  • ورود با Username + Password + Captcha
  • پس از احراز هویت، سرور یک Session Token تولید می‌کند.
  • Session Token داخل Cookie از نوع HttpOnly ذخیره می‌شود.
  • Cookie دارای ویژگی‌های:
      - HttpOnly
      - Secure
      - SameSite=Lax
  • اعتبار Session قابل تمدید (Sliding Session)
  • خروج از حساب باعث ابطال Session در سرور می‌شود.
  • تمام درخواست‌های API به‌صورت خودکار Cookie را ارسال می‌کنند.
  • بدون نیاز به ذخیره Token در localStorage یا sessionStorage.
- خروج

### داشبورد اصلی (سبک FACEIT)

- سایدبار: پروفایل، دوستان، اتاق‌ها، تنظیمات
- محتوای اصلی: کارت‌های اتاق فعال، دکمه «ایجاد اتاق»، لیست دوستان آنلاین
- بج وضعیت آنلاین/در تماس

### چت

- چت متنی درون اتاق (روی WebRTC DataChannel، بدون ذخیره در MySQL)
- ارسال فایل و تصویر P2P (chunk-based روی DataChannel)
- تاریخچه فقط در حافظه مرورگر (پاک با رفرش)
- ایموجی پیکر ساده

### تماس صوتی/تصویری

- دو نفره و گروهی تا **۱۶ نفر** (Mesh)
- کنترل میکروفون/دوربین/اشتراک صفحه پیشرفته
- نمایش grid تطبیقی (۱، ۲، ۴، ۹، ۱۶)
- نشانگر گوینده فعال

### کنترل کیفیت تماس (ویژه)

تنظیم کیفیت جداگانه میکروفون و دوربین و اشتراک صفحه به دو روش:

1. **پیش‌فرض‌های استاندارد:** `Low (240p/32kbps)`, `Medium (480p/64kbps)`, `High (720p/128kbps)`, `HD (1080p/256kbps)`
2. **دستی:** ورود عدد رزولوشن ویدیو، بیت‌ریت ویدیو، بیت‌ریت صدا، فریم‌ریت — اعمال بلادرنگ روی `RTCRtpSender.setParameters()`
3. حالت auto براساس کیفیت اینترنت  
  
اتاق‌ها

- اتاق عمومی (قابل مشاهده در لیست) و خصوصی (با کد دعوت ۶ کاراکتری)
- سازنده = ادمین (kick/mute)
- حداکثر ظرفیت ۱۶ نفر

### لیست دوستان

- افزودن با نام کاربری
- وضعیت آنلاین/آفلاین/در تماس (real-time روی WebSocket)
- دعوت مستقیم به تماس

### واکنش‌گرا

- موبایل: سایدبار کشویی، grid تماس یک ستون قابل اسکرول
- تبلت: دو ستون
- دسکتاپ: layout کامل FACEIT

## نصب آسان روی cPanel

- فایل `install.html` تک‌مرحله‌ای: کاربر host/user/pass/dbname مای‌اسکیوال را وارد می‌کند
- تولید خودکار `.env` و اجرای مایگریشن جداول
- فایل `README-INSTALL.md` فارسی با گام‌های Node.js Selector در cPanel  
  


# جداول پایگاه داده (MVP)

## 1) users

اطلاعات کاربران

```
id
username (UNIQUE)
password_hash
created_at
last_seen
```

---

## 2) user_settings

تنظیمات شخصی هر کاربر

```
user_id (PK, FK -> users.id)

display_name
avatar

language
theme

default_video_quality

camera_device
microphone_device
speaker_device

created_at
updated_at
```

---

## 3) friendships

ارتباط بین کاربران

```
id

requester_id
addressee_id

status
(Pending / Accepted / Blocked)

created_at
updated_at
```

---

## 4) rooms

اطلاعات اتاق‌ها

```
id

code (UNIQUE)

name

owner_id

is_public

is_locked

password_hash (NULL)

max_users

created_at
updated_at
```

---

## 5) room_members

اعضای داخل اتاق

```
room_id

user_id

joined_at

PRIMARY KEY(room_id, user_id)
```

##  Aiven MCP

راه‌اندازی MySQL  روی Aiven با mcp متصل شده .  


**Service URI**

mysql://avnadmin:[AVNS_kXeAuY9tfsAOUwtTFRR@mypars-pars.i.aivencloud.com:25480](mailto:AVNS_kXeAuY9tfsAOUwtTFRR@mypars-pars.i.aivencloud.com:25480)/defaultdb?ssl-mode=REQUIRED

**Database name**

defaultdb

**Host**

[mypars-pars.i.aivencloud.com](http://mypars-pars.i.aivencloud.com)

**Port**

25480

**User**

avnadmin

**Password**

AVNS_kXeAuY9tfsAOUwtTFRR

**SSL mode**

REQUIRED

## ساختار فایل‌ها مناسب برای ارتقا در آینده و بخشی به شکل زیر ( به طور خلاصه) :

```text
src/routes/
  index.tsx              → صفحه ورود/ثبت‌نام
  _authenticated/
    route.tsx            → گیت احراز هویت
    dashboard.tsx        → داشبورد FACEIT-style
    room.$code.tsx       → صفحه اتاق تماس/چت
    friends.tsx
    settings.tsx
  api/
    auth.login.ts        → POST /api/auth/login
    auth.register.ts
    rooms.ts             → CRUD اتاق‌ها
    friends.ts
server/                  → Node.js standalone برای cPanel
  index.js               → Express + WS signaling + سرو dist/
  db.js                  → mysql2 pool + migration
  signaling.js
install.html
```

- **TURN داخلی:** الان راه‌اندازی کن و فایل پیکرندی هم بگذار