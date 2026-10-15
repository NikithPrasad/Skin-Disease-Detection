"""Second opinion from Google Gemini, for every photo that passes the photo check.

The photo is sent to Google's Gemini API (over HTTPS, from this computer); the page tells people this
before they upload. Nothing is stored on this computer either way.

The API key is read from the GEMINI_API_KEY environment variable or from app/data/gemini_api_key.txt
(app/data/ is excluded from git, so the key is never published). Without a key the feature is off.

Gemini is asked independently (it is NOT told what the local model said, so it cannot simply agree)
and must answer in a fixed JSON shape: one of the same 24 groups, or "other" when the photo shows a
condition outside all of them (the local model was never trained on those, so Gemini's answer is shown
instead), plus its own description.
"""
import base64
import io
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

from conditions import CONDITIONS

APP = Path(__file__).resolve().parent
KEY_FILE = APP / "data" / "gemini_api_key.txt"
MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")  # free tier: far higher daily limit than full Flash
URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT_S = 40
RETRY_WAITS_S = [2, 5]

HARM_LEVELS = ["harmless", "mild", "moderate", "serious"]

PROMPT = """You are helping a student skin-screening tool. Look at this photo of skin, hair, nails or scalp.

1. Pick the ONE group from this list that the photo most closely resembles (use the key):
{groups}
   If the condition clearly belongs to none of these groups (for example a callus, corn, burn, wound,
   insect sting or a condition not listed), use "other". Prefer a listed group whenever one fits.

2. Name the single most likely specific condition (for example "tinea corporis" or "nodular leprosy").
3. Write a short, calm, plain-language description (2-3 sentences) of what you see and what the
   condition is, for a worried non-medical person. Do not name medicines. Do not claim certainty.
4. Rate how harmful the condition usually is, using exactly one of: harmless, mild, moderate, serious.
   harmless = cosmetic, no treatment needed; mild = uncomfortable but not dangerous, often self-care;
   moderate = should be treated by a doctor, can spread or worsen; serious = can be dangerous to
   health or life if not treated (for example cancers, leprosy, severe drug reactions).
5. Explain the harmfulness in one sentence.
6. Give your confidence from 0 to 1.
If the photo does not show skin, hair or nails at all, set group to "not_skin"."""

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "group": {"type": "STRING", "enum": list(CONDITIONS) + ["other", "not_skin"]},
        "condition": {"type": "STRING"},
        "description": {"type": "STRING"},
        "harm": {"type": "STRING", "enum": HARM_LEVELS},
        "harm_reason": {"type": "STRING"},
        "confidence": {"type": "NUMBER"},
    },
    "required": ["group", "condition", "description", "harm", "harm_reason", "confidence"],
}


class GeminiError(Exception):
    pass


def api_key():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text(encoding="utf-8").strip()
    return key or None


def available():
    return api_key() is not None


def ask(jpeg_bytes, key=None, model=MODEL):
    """Send one JPEG to Gemini and return its parsed answer (dict). Raises GeminiError."""
    key = key or api_key()
    if not key:
        raise GeminiError("Gemini is not set up on this computer.")
    groups = "\n".join(f"- {k}: {c['name']} (e.g. {c['examples'] or 'normal skin'})" for k, c in CONDITIONS.items())
    body = {
        "contents": [{"role": "user", "parts": [
            {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(jpeg_bytes).decode()}},
            {"text": PROMPT.format(groups=groups)},
        ]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "responseSchema": SCHEMA},
    }
    req = urllib.request.Request(URL.format(model=model), data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    for attempt, wait in enumerate(RETRY_WAITS_S + [None]):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
                data = json.loads(res.read())
            break
        except urllib.error.HTTPError as e:
            if e.code in (500, 503) and wait is not None:  # Google's servers briefly overloaded: retry
                time.sleep(wait)
                continue
            if e.code in (429, 503):
                raise GeminiError("Gemini is busy right now. Please try again in a minute.") from None
            raise GeminiError(f"Gemini could not answer (error {e.code}).") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise GeminiError("Gemini could not be reached. Is this computer connected to the internet?") from None
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        answer = json.loads(text)
        assert answer["group"] in CONDITIONS or answer["group"] in ("other", "not_skin")
        answer["confidence"] = min(1.0, max(0.0, float(answer["confidence"])))
        assert answer["harm"] in HARM_LEVELS
    except (KeyError, IndexError, ValueError, AssertionError, TypeError):
        raise GeminiError("Gemini gave an answer we couldn't read.") from None
    answer["model"] = model
    return answer


def to_jpeg(image_bytes, max_side=768):
    """The uploaded photo, upright and at most 768 px, as JPEG bytes in memory (never on disk)."""
    with Image.open(io.BytesIO(image_bytes)) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=90)  # also drops EXIF metadata such as GPS location
        return buf.getvalue()


def combine(probs, answer, weight):
    """Combined answer: model probabilities plus weight x Gemini's confidence on Gemini's group
    (weight chosen on validation photos, see src/gemini_eval.py in the comparison project).
    probs: list of {"code", "p"}. Returns the combined ranking as the same kind of list, summing to 1."""
    score = {p["code"]: p["p"] for p in probs}
    if answer["group"] in score:
        score[answer["group"]] += weight * answer["confidence"]
    total = sum(score.values())
    return sorted(({"code": c, "p": round(v / total, 4)} for c, v in score.items()), key=lambda r: -r["p"])
