# Copyright 2026 Ahmet Hakan Besel. SPDX-License-Identifier: Apache-2.0
# Source: ahmethakanbesel/okur-tts @ 0889eda23a3eaeda33f8c0af3af729261907bcab
# VoiceBridge change: package-relative imports only.
"""The model's alphabet: Turkish letters with â, î and û kept, plus a few punctuation marks.

Turkish spelling is close to phonemic, so the model reads letters directly. The circumflex is kept because it changes
pronunciation: it softens k, g and l and lengthens the vowel (kâr, alâka, hâlâ).
"""

import re
import unicodedata

PAD, UNK = "<pad>", "<unk>"
PUNCTUATION = " !\"%&'(),-./:;?"
LETTERS = "abcdefghijklmnopqrstuvwxyzçğıöşüâîû"
SYMBOLS: tuple[str, ...] = (PAD, UNK, *PUNCTUATION, *LETTERS)
STOI: dict[str, int] = {s: i for i, s in enumerate(SYMBOLS)}
PAD_ID, UNK_ID = STOI[PAD], STOI[UNK]

_KEEP_ACCENT = frozenset("çğıöşüâîûÇĞİÖŞÜÂÎÛ")
_TYPOGRAPHY = str.maketrans({"’": "'", "‘": "'", "ʼ": "'", "´": "'", "`": "'", "“": '"', "”": '"', "„": '"',
                             "«": '"', "»": '"', "–": "-", "—": "-", "−": "-", "…": "..."})
_UNSAFE = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]")
_SPACES = re.compile(r"\s+")


def turkish_lower(text: str) -> str:
    return text.replace("İ", "i").replace("I", "ı").lower()


def clean(text: str) -> str:
    """Compose (NFC: a + combining circumflex → â), drop control and bidirectional characters and invalid UTF-8."""
    return _UNSAFE.sub(" ", unicodedata.normalize("NFC", text.encode("utf-8", "ignore").decode("utf-8")))


def to_alphabet(text: str) -> str:
    """Lowercase the Turkish way, strip accents the alphabet lacks (é → e), drop anything else unreadable."""
    out: list[str] = []
    for ch in turkish_lower(text.translate(_TYPOGRAPHY)):
        plain = ch if ch in _KEEP_ACCENT else "".join(
            c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c))
        out.append(plain if plain and all(c in STOI for c in plain) else " ")
    return _SPACES.sub(" ", "".join(out)).strip()


def encode(letters: str) -> list[int]:
    return [STOI.get(ch, UNK_ID) for ch in letters]
