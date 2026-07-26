"""Google Calendar bilan ishlash moduli."""

import json
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/calendar"]
TZ_NAME = "Asia/Tashkent"
TZ = ZoneInfo(TZ_NAME)
# Xizmat akkaunti bilan ishlaganda bu yerga otangizning kalendar manzili yoziladi
# (masalan: ota@gmail.com). OAuth bilan ishlaganda "primary" qoladi.
CALENDAR_ID = os.getenv("CALENDAR_ID", "primary")

# Muhimlik darajasi -> Google Calendar rangi
COLOR_BY_PRIORITY = {
    "shoshilinch": "11",  # qizil
    "orta": "5",          # sariq
    "past": "10",         # yashil
}

EMOJI_BY_PRIORITY = {
    "shoshilinch": "🔴",
    "orta": "🟡",
    "past": "🟢",
}

LABEL_BY_PRIORITY = {
    "shoshilinch": "Shoshilinch",
    "orta": "O'rta",
    "past": "Past",
}


SERVICE_FILE = os.getenv("GOOGLE_SERVICE_FILE", "service_account.json")


def get_service():
    """Google Calendar xizmatini qaytaradi.

    Ikki usulni qo'llaydi:
      1. service_account.json bor bo'lsa — brauzer kerak emas (server uchun).
      2. Bo'lmasa — credentials.json orqali brauzerda ruxsat so'raydi.
    """
    from google.oauth2 import service_account

    # 1-usul: JSON to'g'ridan-to'g'ri muhit o'zgaruvchisida (Railway uchun)
    raw = os.getenv("GOOGLE_SERVICE_JSON", "").strip()
    if raw:
        info = json.loads(raw)
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=SCOPES
        )
        return build("calendar", "v3", credentials=creds, cache_discovery=False)

    # 2-usul: fayl ko'rinishida (o'z serveringizda)
    if os.path.exists(SERVICE_FILE):
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_FILE, scopes=SCOPES
        )
        return build("calendar", "v3", credentials=creds, cache_discovery=False)

    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=0)
        with open("token.json", "w", encoding="utf-8") as f:
            f.write(creds.to_json())
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def create_event(title: str, start: datetime, duration_min: int,
                 reason: str, priority: str) -> dict:
    """Google Calendar'ga yangi reja yozadi va event ma'lumotini qaytaradi."""
    service = get_service()
    end = start + timedelta(minutes=duration_min)

    body = {
        "summary": f"{EMOJI_BY_PRIORITY.get(priority, '')} {title}".strip(),
        "description": (
            f"Sababi: {reason}\n"
            f"Muhimligi: {LABEL_BY_PRIORITY.get(priority, priority)}\n"
            f"(Telegram yordamchi bot orqali qo'shildi)"
        ),
        "start": {"dateTime": start.isoformat(), "timeZone": TZ_NAME},
        "end": {"dateTime": end.isoformat(), "timeZone": TZ_NAME},
        "colorId": COLOR_BY_PRIORITY.get(priority, "5"),
        "reminders": {
            "useDefault": False,
            "overrides": [{"method": "popup", "minutes": 15}],
        },
    }
    return service.events().insert(calendarId=CALENDAR_ID, body=body).execute()


def list_events(time_min: datetime, time_max: datetime) -> list[dict]:
    """Berilgan oraliqdagi rejalarni vaqt bo'yicha tartiblab qaytaradi."""
    service = get_service()
    result = service.events().list(
        calendarId=CALENDAR_ID,
        timeMin=time_min.isoformat(),
        timeMax=time_max.isoformat(),
        singleEvents=True,
        orderBy="startTime",
        maxResults=50,
    ).execute()
    return result.get("items", [])


def event_start(event: dict) -> datetime | None:
    """Event boshlanish vaqtini datetime ko'rinishida qaytaradi."""
    raw = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
    if not raw:
        return None
    if len(raw) == 10:  # butun kunlik reja
        return datetime.fromisoformat(raw).replace(tzinfo=TZ)
    return datetime.fromisoformat(raw).astimezone(TZ)


def extract_reason(event: dict) -> str:
    """Tavsifdan 'Sababi:' qatorini ajratib oladi."""
    for line in (event.get("description") or "").splitlines():
        if line.lower().startswith("sababi:"):
            return line.split(":", 1)[1].strip()
    return ""
