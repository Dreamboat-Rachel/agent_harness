"""Demo tools.

Payloads are deterministic fixtures, not live data: this box has no network, so
pretending otherwise would be a second layer of fiction. What matters is that
each tool keeps the shape a real one would have - typed args, JSON out, an
explicit miss path, and an opt-in approval gate for side effects.
"""

from __future__ import annotations

import json
from typing import Any

from core import Tool

_RAIL = {
    "hangzhou_east->shanghai_hongqiao": {
        "trains": [
            {"no": "G7501", "depart": "07:12", "arrive": "08:04", "minutes": 52, "seat_left": 12},
            {"no": "G7305", "depart": "08:05", "arrive": "09:14", "minutes": 69, "seat_left": 0},
            {"no": "G1321", "depart": "09:30", "arrive": "10:21", "minutes": 51, "seat_left": 3},
        ],
        "note": "车次/余票为演示用假数据，非实时",
    }
}

_WEATHER = {
    "hangzhou": {"city": "杭州", "day": "小雨", "night": "阴", "low": 19, "high": 24, "wind": "东北风1-3级"},
    "shanghai": {"city": "上海", "day": "阴", "night": "阴", "low": 21, "high": 25, "wind": "东南风1-3级"},
    "changsha": {"city": "长沙", "day": "多云", "night": "多云", "low": 18, "high": 26, "wind": "北风1-3级"},
}

_COURTS = [
    {"name": "李宁篮球馆(徐汇店)", "area": "徐汇区", "indoor": True, "price": "60元/人/2h", "open": "09:00-22:00"},
    {"name": "杨浦体育中心篮球馆", "area": "杨浦区", "indoor": True, "price": "40元/人/2h", "open": "08:00-21:30"},
    {"name": "徐汇室外灯光球场", "area": "徐汇区", "indoor": False, "price": "免费", "open": "全天"},
]

_NOTEBOOK: list[str] = []


def _rail(origin: str, destination: str, date: str) -> dict[str, Any]:
    key = f"{origin}->{destination}"
    if key not in _RAIL:
        return {"matches": [], "queried": key, "message": "no schedule fixture for this station pair"}
    return {"queried": key, "date": date, **_RAIL[key]}


def _weather(city: str) -> dict[str, Any]:
    data = _WEATHER.get(city.lower())
    if data is None:
        return {"error": f"unknown city '{city}'", "known": sorted(_WEATHER)}
    return {"city_key": city.lower(), **data}


def _courts(city: str, indoor_only: bool) -> dict[str, Any]:
    picks = [c for c in _COURTS if (c["indoor"] or not indoor_only)]
    return {"city": city, "count": len(picks), "venues": picks}


def _save_note(text: str) -> str:
    _NOTEBOOK.append(text)
    return json.dumps({"saved": True, "total": len(_NOTEBOOK)}, ensure_ascii=False)


rail_tool = Tool(
    name="query_high_speed_rail",
    description="Look up high-speed rail departures between two stations.",
    parameters={
        "type": "object",
        "properties": {
            "origin": {"type": "string", "description": "station slug, e.g. hangzhou_east"},
            "destination": {"type": "string", "description": "station slug, e.g. shanghai_hongqiao"},
            "date": {"type": "string", "description": "YYYY-MM-DD"},
        },
        "required": ["origin", "destination", "date"],
    },
    fn=_rail,
)

weather_tool = Tool(
    name="query_weather",
    description="One-day forecast for a city. Known keys: hangzhou, shanghai, changsha.",
    parameters={"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]},
    fn=_weather,
)

court_tool = Tool(
    name="find_basketball_courts",
    description="Nearby basketball venues, optionally restricted to indoor courts.",
    parameters={
        "type": "object",
        "properties": {
            "city": {"type": "string"},
            "indoor_only": {"type": "boolean"},
        },
        "required": ["city", "indoor_only"],
    },
    fn=_courts,
)

note_tool = Tool(
    name="save_memory_note",
    description="Persist a note to long-term memory. Has a side effect.",
    parameters={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
    fn=_save_note,
    requires_approval=True,
)

ALL_TOOLS = [rail_tool, weather_tool, court_tool, note_tool]
