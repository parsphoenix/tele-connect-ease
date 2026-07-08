# نصب پارس‌تاک روی cPanel

## پیش‌نیازها
- سی‌پنل با پشتیبانی از **Node.js Selector** (نسخه 18 یا بالاتر)
- یک دیتابیس **MySQL** (روی همان cPanel یا Aiven)
- (اختیاری) سرور **TURN** داخلی برای عبور از NAT در شبکه ملی

## گام‌های نصب

### ۱. ساخت دیتابیس MySQL در cPanel
- وارد **MySQL Databases** شوید
- یک دیتابیس بسازید (مثلاً `myuser_parstalk`)
- یک کاربر بسازید و به دیتابیس دسترسی کامل بدهید
- نام دیتابیس، نام کاربر و رمز را یادداشت کنید

### ۲. آپلود فایل‌ها
- فایل‌های پوشه `server/` را در یک دایرکتوری آپلود کنید (مثلاً `~/parstalk/`)
- پس از اجرای `bun run build` روی سیستم خود، پوشه `dist/` تولید شده را کنار پوشه server در همان مسیر آپلود کنید:
```
~/parstalk/
├── server/
│   ├── index.js
│   ├── migrate.js
│   ├── package.json
│   └── .env
└── dist/            ← خروجی build فرانت‌اند
```

### ۳. ساخت اپلیکیشن Node.js در cPanel
- وارد **Setup Node.js App** شوید
- **Create Application**:
  - Node.js Version: 18.x یا بالاتر
  - Application Mode: Production
  - Application Root: `parstalk/server`
  - Application URL: دامنه یا زیردامنه شما
  - Application Startup File: `index.js`

### ۴. تنظیم متغیرهای محیطی
در همان صفحه Node.js App، بخش **Environment Variables**:
| نام | مقدار |
|---|---|
| `MYSQL_HOST` | آدرس MySQL |
| `MYSQL_PORT` | معمولاً 3306 |
| `MYSQL_USER` | کاربر دیتابیس |
| `MYSQL_PASSWORD` | رمز دیتابیس |
| `MYSQL_DATABASE` | نام دیتابیس |
| `MYSQL_SSL` | `true` برای Aiven، `false` برای cPanel |
| `SESSION_SECRET` | رشته تصادفی طولانی |
| `TURN_URL` | (اختیاری) `turn:your-turn.ir:3478` |
| `TURN_USERNAME` | (اختیاری) |
| `TURN_CREDENTIAL` | (اختیاری) |

یا فایل `.env.example` را به `.env` کپی کرده و مقادیر را ویرایش کنید.

### ۵. نصب پکیج‌ها
در **Setup Node.js App** روی **Run NPM Install** کلیک کنید. یا از ترمینال:
```bash
cd ~/parstalk/server
npm install
```

### ۶. اجرای مایگریشن دیتابیس
از ترمینال cPanel:
```bash
cd ~/parstalk/server
source /home/USER/nodevenv/parstalk/server/18/bin/activate  # مسیر واقعی خود را جایگزین کنید
node migrate.js
```

### ۷. راه‌اندازی
از صفحه Node.js App، روی **Start App** کلیک کنید.
دامنه‌ی شما اکنون سایت را نمایش می‌دهد.

## راه‌اندازی TURN داخلی (اختیاری اما توصیه‌شده)
برای عبور از NAT روی شبکه ملی، **coturn** روی یک سرور VPS داخل ایران نصب کنید:
```bash
sudo apt install coturn
# ویرایش /etc/turnserver.conf:
#   listening-port=3478
#   fingerprint
#   lt-cred-mech
#   user=parstalk:YOUR_SECRET
#   realm=your-domain.ir
sudo systemctl enable --now coturn
```
سپس `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` را در `.env` تنظیم کنید.

## عیب‌یابی
- **دیتابیس متصل نمی‌شود:** مقدار `MYSQL_HOST`, `MYSQL_PORT` و `MYSQL_SSL` را بازبینی کنید.
- **صفحه سفید:** پوشه `dist/` را بازبینی کنید که آپلود شده باشد.
- **تماس تصویری کار نمی‌کند اما چت کار می‌کند:** یعنی WebRTC media نمی‌تواند از NAT عبور کند — سرور TURN راه‌اندازی کنید.
- **صدا/تصویر مجاز نیست:** سایت باید روی **HTTPS** باشد (cPanel معمولاً SSL رایگان AutoSSL دارد).
