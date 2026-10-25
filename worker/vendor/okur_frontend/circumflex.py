# Copyright 2026 Ahmet Hakan Besel. SPDX-License-Identifier: Apache-2.0
# Source: ahmethakanbesel/okur-tts @ 0889eda23a3eaeda33f8c0af3af729261907bcab
# VoiceBridge change: package-relative imports only.
"""Put back circumflexes that everyday Turkish leaves out, so pronunciation is decided before the model reads.

Runs on lowercase text, after normalization, identically on training transcripts and on input text, so the model
always sees the marked form. Two kinds of words:

- Unambiguous: the plain spelling has no other meaning (alakalı is always alâkalı). Restored by stem.
- Homographs: kar (snow) / kâr (profit), hala (aunt) / hâlâ (still). Decided by nearby words. When the context gives
  no evidence the word is left as written; a learned classifier will replace these rules later.

A word typed with any circumflex is kept exactly as typed.
"""

import re
from collections.abc import Iterable

# plain stem -> marked stem. A stem matches at the start of a word, so suffixed forms follow (dükkanlar → dükkânlar).
STEMS: dict[str, str] = {
    "alaka": "alâka",
    "dükkan": "dükkân",
    "hikaye": "hikâye",
    "kağıt": "kâğıt",
    "kağıd": "kâğıd",  # kâğıdı: t softens to d before a vowel
    "rüzgar": "rüzgâr",
    "imkan": "imkân",
    "kase": "kâse",
    "katip": "kâtip",
    "kafi": "kâfi",
    "kainat": "kâinat",
    "kabus": "kâbus",
    "kahya": "kâhya",
    "tezgah": "tezgâh",
    "dergah": "dergâh",
    "nikah": "nikâh",
    "yegane": "yegâne",
    "mekan": "mekân",
}
# Words that start with a stem but are different words (mekanik, kaset, kafile, kafiye).
EXCEPTION_PREFIXES: tuple[str, ...] = ("mekani", "kaset", "kafile", "kafiye")

_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)
_CIRCUMFLEX = frozenset("âîû")

# kar / kâr: evidence for "profit" and for "snow" within a few words either side.
_KAR_FORMS = re.compile(r"kar(ı|ın|ını|ına|ında|ından|lı|lılık|lılığı|sız|dan|da|a|lar|ları|ların)?")
_PROFIT = re.compile(r"(şirket|net|brüt|zarar|marj|pay|satış|ciro|gelir|vergi|hisse|yatırım|milyon|milyar|lira|"
                     r"dolar|avro|euro|yüzde|faaliyet|bilanço|elde|amaç|ticar|ekonomi|banka|kazanç|çeyrek|dönem)")
_SNOW = re.compile(r"(yağ|beyaz|soğuk|kış|buz|tipi|dağ|kalınlı|santim|fırtına|lapa|erim|erid|kayak|örtü)")
_WINDOW = 4

# hala / hâlâ: "hala" with a suffix (halam, halası) or next to a kinship word is the aunt; bare "hala" is "still".
_KIN = frozenset({"kızı", "oğlu", "teyze", "amca", "dayı", "yenge", "enişte", "kuzen", "anneanne", "babaanne"})


def _has_circumflex(word: str) -> bool:
    return any(c in _CIRCUMFLEX for c in word)


def _restore_stem(word: str) -> str:
    if word.startswith(EXCEPTION_PREFIXES):
        return word
    for plain, marked in STEMS.items():
        if word.startswith(plain):
            return marked + word[len(plain):]
    return word


def _context(words: list[str], i: int) -> Iterable[str]:
    return words[max(0, i - _WINDOW):i] + words[i + 1:i + 1 + _WINDOW]


def _restore_kar(words: list[str], i: int) -> str:
    word = words[i]
    if not _KAR_FORMS.fullmatch(word):
        return word
    profit = sum(bool(_PROFIT.match(w)) for w in _context(words, i))
    snow = sum(bool(_SNOW.match(w)) for w in _context(words, i))
    return "kâ" + word[2:] if profit > snow else word


def _restore_hala(words: list[str], i: int) -> str:
    if words[i] != "hala":
        return words[i]
    neighbours = {words[j] for j in (i - 2, i - 1, i + 1) if 0 <= j < len(words)}
    return "hala" if neighbours & _KIN else "hâlâ"


def restore(text: str) -> str:
    """Return lowercase `text` with circumflexes restored where pronunciation needs them."""
    matches = list(_WORD.finditer(text))
    words = [m.group() for m in matches]
    out: list[str] = []
    last = 0
    for i, m in enumerate(matches):
        word = words[i]
        if not _has_circumflex(word):
            word = _restore_hala(words, i)
            word = _restore_kar(words, i) if word == words[i] else word
            word = _restore_stem(word) if word == words[i] else word
        out.append(text[last:m.start()])
        out.append(word)
        last = m.end()
    out.append(text[last:])
    return "".join(out)
