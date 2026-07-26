"""
Ota uchun reja-yordamchi bot.

Ishlashi:
  1. /reja  — bot ketma-ket so'raydi: nomi, kun va soat, davomiyligi, sababi, muhimligi.
  2. Reja Google Calendar'ga yoziladi (rangi muhimlikka qarab).
  3. Boshlanishiga 15 daqiqa qolganda bot Telegramga xabar yuboradi.
  4. "Bugungi rejalar", "Ertaga", "Hafta" — istalgan payt so'rasa, bot aytib beradi.

Ishga tushirish:
  pip install -r requirements.txt
  export BOT_TOKEN="yangi_tokeningiz"
  export OWNER_ID="123456789"        # ixtiyoriy: faqat shu odam ishlata oladi
  python bot.py
"""

import asyncio
import logging
import os
import re
import sqlite3
from datetime import datetime, timedelta

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
)

import gcal
from gcal import TZ, EMOJI_BY_PRIORITY, LABEL_BY_PRIORITY

TOKEN = os.getenv("BOT_TOKEN")
# Vergul bilan bir nechta ID yozish mumkin: "206004279,123456789"
# Bo'sh qoldirilsa — istalgan odam ishlatishi mumkin (tavsiya etilmaydi).
OWNER_IDS = {
    part.strip() for part in (os.getenv("OWNER_IDS") or "").split(",") if part.strip()
}

# Eslatmalar shu ID ga yuboriladi. Bo'sh bo'lsa — rejani kim qo'shsa, o'shanga.
NOTIFY_ID = os.getenv("NOTIFY_ID", "").strip()
# Railway/Docker'da bu yo'l Volume'ga ko'rsatilishi kerak, masalan /app/data/rejalar.db
DB_PATH = os.getenv("DB_PATH", "rejalar.db")
NOTIFY_BEFORE_MIN = 15

logging.basicConfig(level=logging.INFO)
dp = Dispatcher(storage=MemoryStorage())

WEEKDAYS = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba",
            "Juma", "Shanba", "Yakshanba"]


# ---------------------------------------------------------------- baza

def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    folder = os.path.dirname(DB_PATH)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS plans (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id  INTEGER NOT NULL,
                event_id TEXT,
                title    TEXT    NOT NULL,
                reason   TEXT,
                priority TEXT,
                start_at TEXT    NOT NULL,
                notified INTEGER NOT NULL DEFAULT 0
            )
        """)


# ---------------------------------------------------------------- klaviaturalar

main_kb = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="➕ Yangi reja")],
        [KeyboardButton(text="📅 Bugungi rejalar"), KeyboardButton(text="🌅 Ertaga")],
        [KeyboardButton(text="🗓 Bu hafta"), KeyboardButton(text="ℹ️ Yordam")],
    ],
    resize_keyboard=True,
)

priority_kb = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="🔴 Shoshilinch")],
        [KeyboardButton(text="🟡 O'rta")],
        [KeyboardButton(text="🟢 Past")],
    ],
    resize_keyboard=True,
)

skip_kb = ReplyKeyboardMarkup(
    keyboard=[[KeyboardButton(text="⏭ O'tkazib yuborish")]],
    resize_keyboard=True,
)

HELP = (
    "<b>Qanday ishlataman:</b>\n\n"
    "1️⃣ <b>➕ Yangi reja</b> tugmasini bosing (yoki /reja deb yozing). "
    "Men ketma-ket so'rayman: reja nomi → kun va soat → davomiyligi → "
    "nima uchun kerakligi → muhimlik darajasi.\n\n"
    "2️⃣ Reja <b>Google Calendar</b>ga o'zi yozilib qoladi. Rangi muhimlikka qarab: "
    "qizil — shoshilinch, sariq — o'rta, yashil — past.\n\n"
    "3️⃣ Reja boshlanishiga <b>15 daqiqa</b> qolganda men sizga yozaman.\n\n"
    "4️⃣ Istalgan payt <b>📅 Bugungi rejalar</b>, <b>🌅 Ertaga</b> yoki "
    "<b>🗓 Bu hafta</b> tugmasini bossangiz, rejalarni aytib beraman.\n\n"
    "Bekor qilish uchun: /bekor"
)


# ---------------------------------------------------------------- FSM holatlari

class NewPlan(StatesGroup):
    title = State()
    when = State()
    duration = State()
    reason = State()
    priority = State()


def allowed(message: Message) -> bool:
    return not OWNER_IDS or str(message.from_user.id) in OWNER_IDS


# ---------------------------------------------------------------- boshlanish

@dp.message(CommandStart())
async def start(message: Message, state: FSMContext):
    await state.clear()
    if not allowed(message):
        await message.answer("Kechirasiz, bu bot shaxsiy foydalanish uchun.")
        return
    name = message.from_user.first_name or "aka"
    await message.answer(
        f"Assalomu alaykum, {name}! 👋\n\n"
        "Men sizning reja yordamchingizman. Rejalaringizni menga aytsangiz, "
        "Google Calendar'ga yozib qo'yaman va vaqti kelganda eslatib turaman.\n\n" + HELP,
        reply_markup=main_kb,
        parse_mode="HTML",
    )


@dp.message(Command("yordam"))
@dp.message(F.text == "ℹ️ Yordam")
async def help_handler(message: Message):
    await message.answer(HELP, reply_markup=main_kb, parse_mode="HTML")


@dp.message(Command("bekor"))
async def cancel(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("Bekor qilindi.", reply_markup=main_kb)


# ---------------------------------------------------------------- yangi reja: 5 qadam

@dp.message(Command("reja"))
@dp.message(F.text == "➕ Yangi reja")
async def plan_step1(message: Message, state: FSMContext):
    if not allowed(message):
        return
    await state.set_state(NewPlan.title)
    await message.answer(
        "1/5 — Reja <b>nomi</b> nima?\nMasalan: <i>Shifokorga borish</i>",
        parse_mode="HTML",
        reply_markup=ReplyKeyboardRemove(),
    )


@dp.message(NewPlan.title, F.text)
async def plan_step2(message: Message, state: FSMContext):
    await state.update_data(title=message.text.strip())
    await state.set_state(NewPlan.when)
    await message.answer(
        "2/5 — <b>Qachon</b>? Kun va soatni yozing:\n\n"
        "• <code>bugun 15:00</code>\n"
        "• <code>ertaga 09:30</code>\n"
        "• <code>25.12 14:00</code>",
        parse_mode="HTML",
    )


@dp.message(NewPlan.when, F.text)
async def plan_step3(message: Message, state: FSMContext):
    start_at = parse_when(message.text)
    if not start_at:
        await message.answer(
            "Vaqtni tushunmadim. Iltimos, shu ko'rinishda yozing: "
            "<code>ertaga 09:30</code>",
            parse_mode="HTML",
        )
        return
    if start_at < datetime.now(TZ):
        await message.answer(
            f"⚠️ <b>{start_at:%d.%m %H:%M}</b> — bu vaqt allaqachon o'tib ketgan. "
            "Eslatma yubora olmayman. Boshqa vaqt yozing yoki /bekor deng.",
            parse_mode="HTML",
        )
        return

    await state.update_data(start_at=start_at.isoformat())
    await state.set_state(NewPlan.duration)
    await message.answer(
        "3/5 — <b>Qancha davom etadi</b>? Daqiqada yozing (masalan <code>60</code>).\n"
        "Bilmasangiz shunchaki <code>60</code> deb qo'ying.",
        parse_mode="HTML",
    )


@dp.message(NewPlan.duration, F.text)
async def plan_step4(message: Message, state: FSMContext):
    digits = re.sub(r"\D", "", message.text)
    duration = int(digits) if digits else 60
    duration = max(5, min(duration, 12 * 60))
    await state.update_data(duration=duration)
    await state.set_state(NewPlan.reason)
    await message.answer(
        "4/5 — Bu reja <b>nima uchun</b> kerak? Qisqacha sababini yozing.",
        parse_mode="HTML",
        reply_markup=skip_kb,
    )


@dp.message(NewPlan.reason, F.text)
async def plan_step5(message: Message, state: FSMContext):
    reason = "" if message.text.startswith("⏭") else message.text.strip()
    await state.update_data(reason=reason)
    await state.set_state(NewPlan.priority)
    await message.answer(
        "5/5 — <b>Muhimlik darajasi</b>ni tanlang:",
        parse_mode="HTML",
        reply_markup=priority_kb,
    )


@dp.message(NewPlan.priority, F.text)
async def plan_save(message: Message, state: FSMContext):
    text = message.text.lower()
    if "shosh" in text:
        priority = "shoshilinch"
    elif "rta" in text or "o'rta" in text:
        priority = "orta"
    elif "past" in text:
        priority = "past"
    else:
        await message.answer("Iltimos, tugmalardan birini bosing.",
                             reply_markup=priority_kb)
        return

    data = await state.get_data()
    await state.clear()

    start_at = datetime.fromisoformat(data["start_at"])
    title = data["title"]
    reason = data.get("reason", "")
    duration = data.get("duration", 60)

    # Google Calendar'ga yozamiz (sinxron kutubxona — alohida ipda chaqiramiz)
    event_id = None
    try:
        event = await asyncio.to_thread(
            gcal.create_event, title, start_at, duration, reason or "—", priority
        )
        event_id = event.get("id")
        cal_note = "✅ Google Calendar'ga yozildi."
    except Exception as e:
        logging.exception("Calendar xatosi: %s", e)
        cal_note = ("⚠️ Google Calendar'ga yozilmadi, lekin men o'zim eslatib turaman.\n"
                    "(Ulanishni tekshirish kerak.)")

    with connect() as conn:
        conn.execute(
            "INSERT INTO plans (user_id, event_id, title, reason, priority, start_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (message.from_user.id, event_id, title, reason, priority,
             start_at.isoformat()),
        )

    await message.answer(
        f"{EMOJI_BY_PRIORITY[priority]} <b>{title}</b>\n"
        f"🗓 {WEEKDAYS[start_at.weekday()]}, {start_at:%d.%m.%Y}\n"
        f"🕐 {start_at:%H:%M} — {(start_at + timedelta(minutes=duration)):%H:%M}\n"
        f"📌 Sababi: {reason or '—'}\n"
        f"⚡️ Muhimligi: {LABEL_BY_PRIORITY[priority]}\n\n"
        f"{cal_note}\n"
        f"⏰ Boshlanishiga {NOTIFY_BEFORE_MIN} daqiqa qolganda eslataman.",
        parse_mode="HTML",
        reply_markup=main_kb,
    )


WEEKDAY_WORDS = [
    ("chorshanba", 2), ("payshanba", 3), ("yakshanba", 6), ("dushanba", 0),
    ("seshanba", 1), ("juma", 4), ("shanba", 5),
]


def parse_when(raw: str) -> datetime | None:
    """Kun va soatni matndan ajratib oladi.

    Tushunadigan ko'rinishlar:
        bugun 15:00 / ertaga 09:30 / indinga 8:00 / payshanba 14:00
        25.12 14:00 / 25.12.2027 14:00 / 18:30 / ertaga 9
    """
    text = raw.strip().lower()
    now = datetime.now(TZ)

    # 1) Boshida sana bormi? (25.12 yoki 25.12.2027)
    day = month = year = None
    rest = text
    date_match = re.match(r"^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\s*", text)
    if date_match:
        day, month, year = date_match.groups()
        rest = text[date_match.end():]

    # 2) Soatni topamiz: avval 14:00 ko'rinishi, bo'lmasa yakka son (soat 9)
    minute = 0
    time_match = re.search(r"(\d{1,2})[:.](\d{2})", rest)
    if time_match:
        hour, minute = int(time_match.group(1)), int(time_match.group(2))
    else:
        bare = re.search(r"(?<!\d)(\d{1,2})(?!\d)", rest)
        if not bare:
            return None
        hour = int(bare.group(1))
    if hour > 23 or minute > 59:
        return None

    # 3) Aniq sana berilgan bo'lsa
    if day:
        if year:
            y = int(year)
            y += 2000 if y < 100 else 0
        else:
            y = now.year
        try:
            when = now.replace(year=y, month=int(month), day=int(day),
                               hour=hour, minute=minute, second=0, microsecond=0)
        except ValueError:
            return None
        if when < now and not year:
            try:
                when = when.replace(year=y + 1)
            except ValueError:
                return None
        return when

    # 4) Hafta kuni aytilgan bo'lsa (payshanba 14:00)
    for word, index in WEEKDAY_WORDS:
        if word in text:
            ahead = (index - now.weekday()) % 7
            base = now + timedelta(days=ahead)
            when = base.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if when <= now:
                when += timedelta(days=7)
            return when

    # 5) bugun / ertaga / indinga
    if "indin" in text:
        base = now + timedelta(days=2)
    elif "ertaga" in text:
        base = now + timedelta(days=1)
    else:
        base = now

    when = base.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if when <= now and base.date() == now.date() and "bugun" not in text:
        when += timedelta(days=1)
    return when


# ---------------------------------------------------------------- rejalarni so'rash

@dp.message(F.text == "📅 Bugungi rejalar")
async def today(message: Message):
    now = datetime.now(TZ)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    await send_plans(message, start, start + timedelta(days=1), "Bugungi rejalar")


@dp.message(F.text == "🌅 Ertaga")
async def tomorrow(message: Message):
    now = datetime.now(TZ) + timedelta(days=1)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    await send_plans(message, start, start + timedelta(days=1), "Ertangi rejalar")


@dp.message(F.text == "🗓 Bu hafta")
async def this_week(message: Message):
    now = datetime.now(TZ)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    await send_plans(message, start, start + timedelta(days=7), "Yaqin 7 kunlik rejalar")


@dp.message(F.text)
async def free_text(message: Message):
    """Tugma bosilmasa ham 'rejalarim', 'maqsadlarim' kabi so'zlarni tushunadi."""
    text = (message.text or "").lower()
    if any(w in text for w in ("reja", "maqsad", "ish", "vazifa")):
        if "ertaga" in text:
            return await tomorrow(message)
        if "hafta" in text:
            return await this_week(message)
        return await today(message)
    await message.answer(
        "Tushunmadim. Yangi reja qo'shish uchun <b>➕ Yangi reja</b> tugmasini bosing, "
        "yoki <b>ℹ️ Yordam</b> ni ko'ring.",
        parse_mode="HTML",
        reply_markup=main_kb,
    )


async def send_plans(message: Message, start: datetime, end: datetime, header: str):
    try:
        events = await asyncio.to_thread(gcal.list_events, start, end)
    except Exception as e:
        logging.exception("Calendar o'qishda xato: %s", e)
        events = None

    if events is None:
        rows = local_plans(message.from_user.id, start, end)
        if not rows:
            await message.answer(f"<b>{header}</b>\n\nHozircha reja yo'q. 🙂",
                                 parse_mode="HTML", reply_markup=main_kb)
            return
        lines = [
            f"{EMOJI_BY_PRIORITY.get(r['priority'], '•')} "
            f"<b>{datetime.fromisoformat(r['start_at']):%d.%m %H:%M}</b> — {r['title']}"
            for r in rows
        ]
        await message.answer(f"<b>{header}</b>\n\n" + "\n".join(lines),
                             parse_mode="HTML", reply_markup=main_kb)
        return

    if not events:
        await message.answer(f"<b>{header}</b>\n\nHozircha reja yo'q. Dam oling! 🙂",
                             parse_mode="HTML", reply_markup=main_kb)
        return

    lines = []
    for ev in events:
        when = gcal.event_start(ev)
        title = ev.get("summary", "(nomsiz)")
        reason = gcal.extract_reason(ev)
        line = f"🕐 <b>{when:%d.%m %H:%M}</b> — {title}"
        if reason and reason != "—":
            line += f"\n     <i>{reason}</i>"
        lines.append(line)

    await message.answer(f"<b>{header}</b>\n\n" + "\n".join(lines),
                         parse_mode="HTML", reply_markup=main_kb)


def local_plans(user_id: int, start: datetime, end: datetime):
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM plans WHERE user_id = ? AND start_at BETWEEN ? AND ? "
            "ORDER BY start_at",
            (user_id, start.isoformat(), end.isoformat()),
        ).fetchall()


# ---------------------------------------------------------------- 15 daqiqalik eslatma

async def notifier(bot: Bot):
    """Har 30 sekundda tekshiradi: boshlanishiga 15 daqiqa qolgan reja bormi?"""
    while True:
        try:
            now = datetime.now(TZ)
            limit = (now + timedelta(minutes=NOTIFY_BEFORE_MIN)).isoformat()
            with connect() as conn:
                rows = conn.execute(
                    "SELECT * FROM plans WHERE notified = 0 AND start_at <= ? "
                    "AND start_at >= ?",
                    (limit, now.isoformat()),
                ).fetchall()
                for r in rows:
                    when = datetime.fromisoformat(r["start_at"])
                    left = max(1, int((when - now).total_seconds() // 60))
                    text = (
                        f"⏰ <b>Eslatma!</b>\n\n"
                        f"{EMOJI_BY_PRIORITY.get(r['priority'], '•')} "
                        f"<b>{r['title']}</b>\n"
                        f"🕐 {when:%H:%M} da boshlanadi — {left} daqiqa qoldi.\n"
                    )
                    if r["reason"]:
                        text += f"📌 Sababi: {r['reason']}"
                    target = int(NOTIFY_ID) if NOTIFY_ID else r["user_id"]
                    try:
                        await bot.send_message(target, text, parse_mode="HTML")
                    except Exception as e:
                        logging.warning("Xabar yuborilmadi: %s", e)
                    conn.execute("UPDATE plans SET notified = 1 WHERE id = ?",
                                 (r["id"],))
                # o'tib ketgan rejalarni belgilab qo'yamiz
                conn.execute("UPDATE plans SET notified = 1 WHERE start_at < ?",
                             (now.isoformat(),))
        except Exception as e:
            logging.exception("Eslatma tsiklida xato: %s", e)
        await asyncio.sleep(30)


async def main():
    if not TOKEN:
        raise SystemExit("BOT_TOKEN muhit o'zgaruvchisi berilmagan.")
    init_db()
    bot = Bot(TOKEN)
    asyncio.create_task(notifier(bot))
    logging.info("Bot ishga tushdi.")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
