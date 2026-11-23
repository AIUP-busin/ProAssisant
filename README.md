# Kafe to'lovlari — sayt + Telegram bot

Bitta dastur uch ishni bajaradi:

1. **Sayt.** To'lov qo'shasiz (ijara, maosh, svet, gaz...), to'laysiz, tarix va qarzlarni ko'rasiz.
2. **Telegram bot.** Tugmalari: 📋 Shu oy to'lovlari · ⏰ Yaqin to'lovlar · ⚠️ Qarzlar · 📅 Ertangi reja · 🌐 Saytni ochish (Mini App yoki brauzerda).
3. **Kunlik xabar.** Har kuni soat **10:00** da (Toshkent vaqti) bot sizga quyidagilarni yuboradi:
   - muddati o'tgan to'lovlar;
   - bugun to'lanadigan to'lovlar;
   - **ertangi reja**;
   - **3 kundan keyin** keladigan to'lovlar.

   Har bir to'lov tagida "✅ To'landi" tugmasi bor. Bosilsa, bot "Ha, to'landi" deb tasdiqlashni so'raydi.

---

## Fayllar

| Fayl | Nima |
|---|---|
| `server.js` | Server, bot, eslatmalar (Node.js 18+, tashqi kutubxona yo'q) |
| `public/index.html` | Sayt |
| `.env` | Sozlamalar: bot tokeni, sizning ID, soat. **Tayyor to'ldirilgan** |
| `data/data.json` | Barcha ma'lumotlar (avtomatik yaratiladi) |
| `data/backup-YYYY-MM-DD.json` | Har kungi zaxira nusxa |

## 1. Kompyuterda sinab ko'rish

1. **Node.js** o'rnating (18 yoki undan yangi): https://nodejs.org
2. Papkani ochib, terminalda: `node server.js`
3. Terminalda chiqqan havolani oching: `http://localhost:3000/?key=...`
4. Telegram'da botingizga `/start` yozing. Tugmalar chiqadi.

> Kompyuterda ishlaganda bot ishlaydi, lekin **Mini App** va **"Saytni ochish"** tugmalari ishlamaydi. Ular uchun internetdagi `https://` manzil kerak (2-qadam). Kompyuter o'chsa, kunlik xabar ham kelmaydi.

Kunlik xabar matnini hozir ko'rish uchun: `node server.js --preview` yoki botga `/xabar` yozing.

## 2. Internetga joylash (bot doim ishlashi uchun)

Server kechayu kunduz yoniq bo'lishi kerak. Ikki oson yo'l bor:

### Variant A — Railway (oson, oyiga taxminan $5)

1. Papkani GitHub'ga yuklang (`.env` fayli yuklanmaydi, bu to'g'ri).
2. Railway.com → **New Project** → **Deploy from GitHub repo** → shu repo.
3. **Variables** bo'limiga `.env` dagi qatorlarni bittalab kiriting (`BOT_TOKEN`, `ADMIN_IDS`, `REMIND_HOUR`, `REMIND_DAYS`, `ACCESS_KEY`). `PORT` ni kiritmang, Railway o'zi beradi.
4. **Volume** qo'shing. Mount path: `/data`. Keyin Variables'ga `DATA_DIR=/data` kiriting. **Bu shart**, aks holda qayta ishga tushganda ma'lumotlar o'chib ketadi.
5. **Settings → Networking → Generate Domain**. Chiqqan manzilni (masalan `https://kafe-xxx.up.railway.app`) Variables'ga `PUBLIC_URL` qilib kiriting.
6. Botga `/start` yozing. "🌐 Saytni ochish" tugmasi endi Mini App va brauzer havolasini beradi.

### Variant B — o'z VPS serveringiz (Ubuntu)

```bash
# Node 20 o'rnatish
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
# papkani /opt/kafe ga ko'chiring, keyin:
cd /opt/kafe && sudo npm i -g pm2 && pm2 start server.js --name kafe && pm2 save && pm2 startup
```

Domen va HTTPS uchun Caddy eng oddiy yo'l: `kafe.sizningdomen.uz { reverse_proxy localhost:3000 }`. Keyin `.env` ga `PUBLIC_URL=https://kafe.sizningdomen.uz` yozib, `pm2 restart kafe` qiling.

## Xavfsizlik

- **Bot faqat `ADMIN_IDS` dagi odamlarga javob beradi.** Begona kishiga "Bu bot faqat kafe egasi uchun" deydi.
- **Mini App** Telegram imzosi orqali tekshiriladi. Faqat sizning ID bilan kirish mumkin.
- **Brauzerdagi havola** maxfiy kalit (`ACCESS_KEY`) bilan ishlaydi. Havolani hech kimga bermang. Kalitni o'zgartirsangiz, eski havolalar ishlamay qoladi.
- **Bot tokeni** chatda yozilgani uchun, xohlasangiz @BotFather → `/revoke` orqali yangisini olib, `.env` ga yozing.
- **`.env` faylini GitHub'ga yuklamang.** `.gitignore` buni o'zi to'sib turadi.
- **Boshqa odam qo'shish:** uning Telegram ID'sini `ADMIN_IDS` ga vergul bilan qo'shing. ID'ni bilish uchun u botga yozsin, bot unga ID'sini aytadi.

## To'lovlar yo'qolmasligi

- **Takroriy to'lov.** Har bir to'lovning o'z raqami bor. Bir xil to'lov ikki marta yuborilsa ham (internet uzilib qayta bosilsa), server faqat bittasini yozadi.
- **O'chirish yo'q.** To'lovlar o'chirilmaydi. Xato bo'lsa "Bekor qilish" bosiladi, minus (storno) yozuv qo'shiladi va ikkalasi ham tarixda qoladi. Bitta to'lovni ikki marta bekor qilib bo'lmaydi.
- **Eski oylar o'zgarmaydi.** Summa yoki $ kursi o'zgarsa, oldingi oylar o'zgarmaydi.
- **Zaxira.** Har kuni `data/` papkasida zaxira nusxa saqlanadi. To'liq zaxirani saytdan ham olsa bo'ladi: `https://manzil/api/backup` (kirgan holda).

## Sozlamalar (`.env`)

| Nomi | Ma'nosi | Hozirgi |
|---|---|---|
| `BOT_TOKEN` | BotFather bergan token | to'ldirilgan |
| `ADMIN_IDS` | Xabar oladiganlar | 6613741078 |
| `PUBLIC_URL` | Saytning https manzili | bo'sh — joylagandan keyin yozing |
| `REMIND_HOUR` | Kunlik xabar soati | 10 |
| `REMIND_DAYS` | Necha kun oldin ogohlantirish | 3 |
| `ACCESS_KEY` | Brauzer uchun maxfiy kalit | to'ldirilgan |
| `DATA_DIR` | Ma'lumot papkasi | `./data` |
