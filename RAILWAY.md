# Railway'ga joylashtirish

## 0-qadam. AVVAL GitHub'ni tekshiring ⚠️

Tokeningiz yoki Google kalitingiz repozitoriyga tushib qolmaganini tekshirish shart:

```bash
git log --all --oneline -- .env service_account.json credentials.json token.json
```

Agar bu buyruq **hech narsa chiqarmasa** — hammasi joyida, davom eting.

Agar biror satr chiqsa, fayl git tarixiga tushgan. Repozitoriya ochiq (public)
bo'lsa, uni darhol **private** qiling, so'ng:

```bash
git rm --cached .env service_account.json credentials.json token.json
git commit -m "Sirli fayllarni olib tashlash"
git push
```

Bu faqat yangi commit'dan olib tashlaydi — **eski tarixda qolib ketadi**.
Shuning uchun tarixga tushgan har qanday token va kalitni bekor qilib,
yangisini olish kerak:
- Bot tokeni: @BotFather → `/mybots` → **Revoke current token**
- Google kaliti: Cloud Console → Service account → **Keys** → eskisini
  o'chirib, yangisini yarating

`.gitignore` faylida bu fayllar allaqachon ro'yxatga olingan, ya'ni bundan
keyin tasodifan yuklanmaydi.

---

## 1-qadam. Narxi haqida

Railway'da yangi foydalanuvchi **30 kunlik bepul sinov** oladi: bir martalik
$5 kredit, karta talab qilinmaydi. Sinovdan keyin **Hobby** tarifi oyiga $5
turadi va shu $5 ichida resurs sarfi ham hisoblanadi.

Bizning bot juda kichik (RAM ~80 MB, protsessor deyarli bo'sh turadi), shuning
uchun sarf oyiga $2–3 atrofida bo'ladi — Hobby tarifining $5 krediti ichiga
sig'adi, ya'ni ustiga qo'shimcha to'lamaysiz.

---

## 2-qadam. Loyihani yaratish

1. [railway.com](https://railway.com) → GitHub bilan kiring.
2. **New Project → Deploy from GitHub repo** → repozitoriyangizni tanlang.
3. Railway `Dockerfile` ni o'zi topib, qurishni boshlaydi. Kutib turing.

Birinchi qurish muvaffaqiyatli bo'ladi, lekin bot hali ishlamaydi — sozlamalar
qo'yilmagan. Buni keyingi qadamda qilamiz.

---

## 3-qadam. Sozlamalarni kiritish

Service → **Variables** bo'limiga o'ting va quyidagilarni qo'shing:

| Nomi | Qiymati |
|---|---|
| `BOT_TOKEN` | @BotFather dan olingan yangi token |
| `OWNER_IDS` | `206004279` (otangizning ID sini ham qo'shsangiz vergul bilan) |
| `NOTIFY_ID` | bo'sh, yoki eslatma boradigan ID |
| `CALENDAR_ID` | otangizning pochtasi, masalan `otam@gmail.com` |
| `DB_PATH` | `/app/data/rejalar.db` |
| `TZ` | `Asia/Tashkent` |
| `GOOGLE_SERVICE_JSON` | `service_account.json` faylining **butun mazmuni** |

`GOOGLE_SERVICE_JSON` ni to'ldirish: `service_account.json` faylini matn
muharririda ochib, `{` dan `}` gacha hammasini ko'chirib, qiymat maydoniga
qo'ying. Bir necha qatorli bo'lishi normal — Railway buni qabul qiladi.

> Bu fayl GitHub'ga **tushmaydi**, faqat Railway'ning ichida saqlanadi.

---

## 4-qadam. Volume ulash (juda muhim)

Bu qadam o'tkazib yuborilsa, kodni har yangilaganingizda kutilayotgan
eslatmalar o'chib ketadi.

1. Service ustiga bosing → **Settings** → **Volumes** → **New Volume**.
2. **Mount path** maydoniga: `/app/data`
3. Saqlang. Railway xizmatni qayta yuklaydi.

Endi baza fayli Volume ichida yashaydi va yangilanishlarda saqlanib qoladi.

---

## 5-qadam. Ishlayotganini tekshirish

Service → **Deployments** → oxirgi deploy → **View Logs**.

Ko'rinishi kerak:

```
INFO:root:Bot ishga tushdi.
INFO:aiogram.dispatcher:Start polling
```

So'ng Telegramda botga `/start` yuboring.

**To'liq sinov:**
1. **➕ Yangi reja** → nomi: `Sinov` → `bugun` + hozirdan 17 daqiqa keyingi
   soat → `30` → sababi: `tekshirish` → **🟡 O'rta**
2. Otangizning Google Calendar'ini ochib ko'ring — reja sariq rangda turishi kerak.
3. 2 daqiqa kutib turing — Telegramga eslatma xabari kelishi kerak.

---

## Muhim ogohlantirish: faqat bitta nusxa ishlashi kerak

Telegram bir bot tokenini bir vaqtda ikki joydan `polling` qilishga ruxsat
bermaydi. Agar bot kompyuteringizda ham ishlab turgan bo'lsa, uni to'xtatib
qo'ying — aks holda log'da `TelegramConflictError` xatosi chiqadi va
xabarlar yo'qoladi.

Shuningdek Railway'da **Replicas** sonini `1` da qoldiring.

---

## Kodni yangilash

GitHub'ga `git push` qilsangiz, Railway o'zi yangi versiyani quradi va
ishga tushiradi. Alohida hech narsa qilish kerak emas.

---

## Xatolar

| Log'dagi xato | Sababi |
|---|---|
| `Unauthorized` | `BOT_TOKEN` xato yoki bekor qilingan |
| `TelegramConflictError` | Bot boshqa joyda ham ishlab turgan |
| `MalformedError` / `JSONDecodeError` | `GOOGLE_SERVICE_JSON` to'liq ko'chirilmagan |
| `404` (Calendar) | `CALENDAR_ID` xato yozilgan |
| `403 insufficientPermissions` | Kalendar xizmat akkauntiga "Make changes to events" ruxsati bilan share qilinmagan |
| Eslatma kelmaydi, lekin bot javob beradi | `TZ` qo'yilmagan yoki Volume ulanmagan |
