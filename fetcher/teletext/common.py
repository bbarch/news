"""Shared paths, config loading, text clean-up and atomic JSON helpers."""
import json
import os
import re
import tempfile
import tomllib
import unicodedata
from html import unescape
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("TELETEXT_DATA", APP_DIR / "data"))
FONT_PATH = APP_DIR / "fonts" / "VT323-Regular.ttf"
LOGO_PATH = APP_DIR / "assets" / "bbarch-logo.png"

NEWS_FILE = DATA_DIR / "news.json"
STATUS_FILE = DATA_DIR / "status.json"
PREVIEW_FILE = DATA_DIR / "preview.png"


def hls_dir() -> Path:
    """HLS segments live in RAM (systemd RuntimeDirectory) to spare the SD card."""
    return Path(os.environ.get("TELETEXT_HLS_DIR", "/run/teletext/hls"))


def config_path() -> Path:
    env = os.environ.get("TELETEXT_CONFIG")
    if env:
        return Path(env)
    etc = Path("/etc/teletext/config.toml")
    return etc if etc.exists() else APP_DIR / "config.toml"


def load_config() -> dict:
    with open(config_path(), "rb") as f:
        return tomllib.load(f)


def read_json(path: Path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path: Path, obj) -> None:
    """Write via temp file + rename so readers never see half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


# --- text ------------------------------------------------------------------

_PUNCT = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"',
    "–": "-", "—": " - ", "−": "-",
    "…": "...", " ": " ", "₹": "Rs ",
    "°": "°", "•": "*", "×": "x",
}
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def clean_text(s: str) -> str:
    """Strip HTML, fold to the character set the pixel font can draw."""
    if not s:
        return ""
    s = unescape(_TAG.sub(" ", s))
    s = "".join(_PUNCT.get(ch, ch) for ch in s)
    out = []
    for ch in unicodedata.normalize("NFKD", s):
        if ch == "°" or 32 <= ord(ch) < 127:
            out.append(ch)
        elif ch in "\n\t":
            out.append(" ")
    return _WS.sub(" ", "".join(out)).strip()


def trim_summary(s: str, limit: int) -> str:
    """Cut at a sentence end inside the limit, else at a word, with '...'."""
    if len(s) <= limit:
        return s
    cut = s[:limit]
    end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
    if end > limit * 0.5:
        return cut[: end + 1]
    return cut.rsplit(" ", 1)[0].rstrip(",;:-") + "..."
