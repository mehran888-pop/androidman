# ساخت و نصب اپ اندروید

اپ اندروید با [Capacitor](https://capacitorjs.com) ساخته شده است: پوشه‌ی `web/` داخل یک WebView بسته‌بندی می‌شود و از طریق API با سرور Node.js صحبت می‌کند.

## گزینه‌ی ۱: دانلود از GitHub Actions (بدون نصب ابزار)

1. کد را روی یک ریپازیتوری GitHub push کنید.
2. تب **Actions** ← گردش‌کار «تست و ساخت APK» ← آخرین اجرا.
3. از بخش **Artifacts** فایل `hoghooghyar-debug-apk.zip` را دانلود کنید.
4. فایل `app-debug.apk` را روی گوشی کپی و نصب کنید (اجازه‌ی نصب از منابع ناشناس لازم است).

مزیت: نیازی به JDK و Android SDK ندارید. عیب: APK دیباگ است و برای انتشار در بازار/گوگل‌پلی باید نسخه‌ی امضاشده بسازید.

## گزینه‌ی ۲: ساخت محلی

پیش‌نیازها:

- Node.js 20+
- JDK 21 (مثلاً Temurin)
- Android SDK با `compileSdk 35` (راحت‌ترین راه: نصب Android Studio)

```bash
npm install
npx cap sync android
cd android
./gradlew assembleDebug
```

خروجی: `android/app/build/outputs/apk/debug/app-debug.apk`

اگر `ANDROID_HOME` تنظیم نیست، فایل `android/local.properties` را بسازید:

```properties
sdk.dir=/home/USER/Android/Sdk
```

### نسخه‌ی امضاشده (release)

1. کلید بسازید:

```bash
keytool -genkey -v -keystore hoghooghyar.jks -alias hoghooghyar \
  -keyalg RSA -keysize 2048 -validity 10000
```

2. فایل `android/keystore.properties` (کامیت نشود):

```properties
storeFile=../hoghooghyar.jks
storePassword=***
keyAlias=hoghooghyar
keyPassword=***
```

3. در `android/app/build.gradle` بلوک `signingConfigs` و `buildTypes.release` را اضافه کنید (الگوی استاندارد اندروید)، سپس:

```bash
./gradlew assembleRelease
```

خروجی در `android/app/build/outputs/apk/release/`.

## بعد از هر تغییر ظاهری/وبی

```bash
npx cap sync android    # کپی مجدد web/ به assets اندروید
```

## اتصال اپ به سرور

اپ به‌تنهایی محاسبه نمی‌کند؛ محاسبات و داده روی سرور Node.js است. دو حالت:

### الف) آدرس را کاربر داخل اپ وارد کند (پیش‌فرض)

در اولین اجرا صفحه‌ی «اتصال به سرور» نمایش داده می‌شود. آدرس را وارد کنید:

- اینترنت: `https://payroll.example.com`
- شبکه‌ی محلی: `http://192.168.1.10:3000`

آدرس در `localStorage` گوشی ذخیره می‌شود و در تنظیمات ← «سرور» قابل تغییر است.

**الزامات:** سرور با `HOST=0.0.0.0` اجرا شود و فایروال پورت ۳۰۰۰ را باز بگذارد. برای HTTP (بدون TLS) در شبکه‌ی داخلی، در `AndroidManifest.xml` مقدار `usesCleartextTraffic` و `network_security_config` مجاز شده است.

### ب) آدرس ثابت داخل بیلد

در `capacitor.config.json`:

```json
{
  "appId": "ir.hoghooghyar.payroll",
  "appName": "حقوق‌یار",
  "webDir": "web",
  "server": { "androidScheme": "https", "url": "https://payroll.example.com" }
}
```

سپس `npx cap sync android` و ساخت دوباره. در این حالت اپ مستقیماً نسخه‌ی وبِ روی سرور را نمایش می‌دهد (به‌روزرسانی‌ها بدون نصب مجدد اعمال می‌شوند).

## آیکون‌ها و اسپلش

```bash
./scripts/make-android-icons.sh    # نیازمند ImageMagick
```

این اسکریپت از `web/icons/icon-1024.png` همه‌ی چگالی‌های `mipmap-*`، آیکون تطبیقی (foreground)، آیکون گرد و تصاویر اسپلش را می‌سازد.

## عیب‌یابی

| مشکل | راه‌حل |
| --- | --- |
| صفحه‌ی سفید | `npx cap sync android` را اجرا و دوباره بیلد کنید |
| «اتصال به سرور» خطا می‌دهد | `HOST` سرور، فایروال، و درست‌بودن پورت را بررسی کنید |
| خطای CORS | پیش‌فرض `CORS_ORIGIN=*` است؛ اگر محدود کرده‌اید، `https://localhost` (منشأ WebView) را اضافه کنید |
| `SDK location not found` | `android/local.properties` را بسازید |
| بیلد Gradle بی‌دلیل شکست می‌خورد | JDK 21 و `compileSdk 35` را نصب و `./gradlew --refresh-dependencies` را امتحان کنید |
| اپ بعد از تغییر وب قدیمی است | `npx cap sync android` + بیلد مجدد |
