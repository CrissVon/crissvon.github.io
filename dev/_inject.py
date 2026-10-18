"""Тимчасовий скрипт: додає посилання викладачів і робочі суботи у schedule_data.json від бота."""
import json
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "schedule_data.json"

LINKS = {
    "Савіна Л.П.": "https://us04web.zoom.us/j/4424345889?pwd=yPqeiASgYJmdadhgqgEBbkVmhS4b2i.1&omn=79018831484",
    "Базильчук Т.Г.": "https://meet.google.com/zsf-ymkv-bkh",
    "Майдан А.В.": "https://us04web.zoom.us/j/9725123788?pwd=R001Z3BpcFNhZ0tKL2xvNHJSWFdoQT09&omn=77180326621",
    "Бардишев М.М.": "https://meet.google.com/ymz-mjtt-duq",
    "Портна М.Г.": "https://us04web.zoom.us/j/7930619599?pwd=WWhUUGVwS0RkK08yUjRFY0kxU1JHdz09",
    "Ганненко Л.В.": "https://us05web.zoom.us/j/6185246444?pwd=Zy9zYXBNZU1JSEE4UGY3b0FxSnVlZz09",
    "Якобчук О.М.": "https://meet.google.com/crp-stbg-sxa",
    "Чуйков А.С.": "https://meet.google.com/ncm-rtnn-eiw",
    "Гусак І.В.": "https://meet.google.com/uha-xsnj-rjw",
    "Ціпоренко Я.І.": "https://meet.google.com/awz-sprz-gbi",
    "Крещанова С.Л.": "https://us04web.zoom.us/j/73679983993?pwd=T1ZVTy9kMVk5cnZjTDJDVDQ3TzVsUT09",
    "Чепур О.О.": "https://us04web.zoom.us/j/75877759435?pwd=Us9bNlRgXZbLwrRUzkaRZDyFbUB5Dk.1",
}

# Окремі посилання на конкретний предмет: (викладач, предмет) -> посилання
SUBJECT_LINKS = {
    ("Бардишев М.М.", "Історія України (факультатив)"): "https://meet.google.com/fhn-empk-wuu",
    ("Чуйков А.С.", "Математичний аналіз"): "https://meet.google.com/ewb-wxmt-vfr",
    ("Гусак І.В.", "Українська література"): "https://meet.google.com/egu-ruxm-prk",
}

SPECIAL_DAYS = {
    "2026-10-17": {"day": "monday", "week": 2},
    "2026-10-24": {"day": "tuesday", "week": 2},
    "2026-10-31": {"day": "wednesday", "week": 2},
    "2026-11-07": {"day": "thursday", "week": 2},
    "2026-11-14": {"day": "friday", "week": 2},
    "2026-11-21": {"day": "monday", "week": 1},
}

data = json.loads(PATH.read_text(encoding="utf-8"))

missing = []
for tid, teacher in data["teachers"].items():
    link = LINKS.get(teacher["name"])
    if link:
        teacher["link"] = link
    else:
        missing.append(teacher["name"])

for week in data["base_schedule"].values():
    for lessons in week.values():
        for entry in lessons:
            ids = entry.get("teacher_ids") or ([entry["teacher_id"]] if entry.get("teacher_id") else [])
            if len(ids) != 1:
                continue
            name = data["teachers"].get(ids[0], {}).get("name")
            link = SUBJECT_LINKS.get((name, entry["subject"]))
            if link:
                entry["link"] = link

if not data.get("special_days"):
    data["special_days"] = SPECIAL_DAYS

PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
print("викладачів:", len(data["teachers"]), "| без посилання:", missing or "немає")
print("робочих субот:", len(data["special_days"]))
