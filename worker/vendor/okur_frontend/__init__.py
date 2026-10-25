# Copyright 2026 Ahmet Hakan Besel. SPDX-License-Identifier: Apache-2.0
# Source: ahmethakanbesel/okur-tts @ 0889eda23a3eaeda33f8c0af3af729261907bcab
# VoiceBridge change: package-relative imports only.
"""Text frontend: any written Turkish in, the model's letters out. Identical for training transcripts and inference.

clean → ordinals → normalize (numbers, dates, money, abbreviations) → lowercase → restore circumflexes → alphabet.
Nothing here raises on text.
"""

import re

from normalizer_tr import Hint, Normalizer

from .alphabet import SYMBOLS, clean, encode, to_alphabet, turkish_lower
from .circumflex import restore

__all__ = ["SYMBOLS", "Frontend", "encode"]

# "3. kat", "1. Dünya Savaşı", "2. 3. ve 4.": a number and a period, then a word or another ordinal on the same line.
# Numbers inside dates and amounts (15.10.2026, 1.250.000) and numbers ending a line ("Toplam 3.") are left alone.
_ORDINAL = re.compile(r"(?<![\d.,:])\d+\.(?=[ \t]+(?:[^\W\d_]|\d+\.))")
_POLICY = "fallback"


class Frontend:
    def __init__(self) -> None:
        self._normalizer = Normalizer()

    def __call__(self, text: str) -> str:
        text = clean(text)
        if not text.strip():
            return ""
        text = _ORDINAL.sub(self._ordinal, text)
        return to_alphabet(restore(turkish_lower(self._normalize(text))))

    def _ordinal(self, m: re.Match[str]) -> str:
        number = m.group()
        try:
            return self._normalizer.normalize(number, ambiguity_policy=_POLICY,
                                              hints=[Hint(0, len(number), "ordinal")]).normalized_text
        except Exception:
            return number

    def _normalize(self, text: str) -> str:
        try:
            return self._normalizer.normalize(text, ambiguity_policy=_POLICY).normalized_text
        except Exception:  # invalid input or a resource limit: keep the words rather than lose the sentence
            return text
