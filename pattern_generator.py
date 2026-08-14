#!/usr/bin/env python3
"""Generate offline candidates that follow the observed code shapes.

This tool only creates strings locally. It does not contact a service,
validate candidates, or attempt redemption.
"""

from __future__ import annotations

import argparse
import random
import re
import string
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parent
DEFAULT_CORPUS = ROOT / "codes_only.txt"


@dataclass(frozen=True)
class Run:
    kind: str
    length: int


FAMILY_LABELS = {
    "letters": "letters only",
    "one": "one numeric block (1 digit)",
    "two": "one numeric block (2 digits)",
    "three": "one numeric block (3 digits)",
    "multi": "multiple numeric blocks",
}


def code_runs(code: str) -> tuple[Run, ...]:
    """Return consecutive letter/digit runs for a code."""
    code = code.strip().upper()
    runs: list[Run] = []
    for char in code:
        kind = "D" if char.isdigit() else "L"
        if runs and runs[-1].kind == kind:
            runs[-1] = Run(kind, runs[-1].length + 1)
        else:
            runs.append(Run(kind, 1))
    return tuple(runs)


def family_for(code: str) -> str:
    numeric_blocks = re.findall(r"\d+", code)
    if not numeric_blocks:
        return "letters"
    if len(numeric_blocks) == 1:
        width = len(numeric_blocks[0])
        return {1: "one", 2: "two", 3: "three"}.get(width, "multi")
    return "multi"


def load_corpus(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(f"corpus not found: {path}")

    codes = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        code = raw.strip().upper()
        if re.fullmatch(r"[A-Z0-9]+", code):
            codes.append(code)
    if not codes:
        raise ValueError(f"corpus is empty: {path}")
    return list(dict.fromkeys(codes))


def build_templates(codes: Iterable[str]) -> dict[str, list[tuple[Run, ...]]]:
    templates: dict[str, list[tuple[Run, ...]]] = defaultdict(list)
    for code in codes:
        family = family_for(code)
        runs = code_runs(code)
        if runs not in templates[family]:
            templates[family].append(runs)
    return dict(templates)


def build_letter_bank(codes: Iterable[str]) -> dict[int, list[str]]:
    bank: dict[int, list[str]] = defaultdict(list)
    for code in codes:
        for match in re.finditer(r"[A-Z]+", code.upper()):
            fragment = match.group(0)
            if fragment not in bank[len(fragment)]:
                bank[len(fragment)].append(fragment)
    return dict(bank)


def random_letters(rng: random.Random, length: int, bank: dict[int, list[str]]) -> str:
    options = bank.get(length)
    if options:
        return rng.choice(options)
    return "".join(rng.choice(string.ascii_uppercase) for _ in range(length))


def random_digits(rng: random.Random, length: int) -> str:
    # Formatting preserves observed leading-zero forms such as 01 and 02.
    return f"{rng.randrange(10 ** length):0{length}d}"


def render(
    rng: random.Random,
    template: tuple[Run, ...],
    letter_bank: dict[int, list[str]],
    use_letter_bank: bool = True,
) -> str:
    parts = []
    for run in template:
        if run.kind == "L":
            bank = letter_bank if use_letter_bank else {}
            parts.append(random_letters(rng, run.length, bank))
        else:
            parts.append(random_digits(rng, run.length))
    return "".join(parts)


def generate(
    corpus: list[str],
    family: str,
    count: int,
    seed: int | None,
) -> list[str]:
    if count < 1:
        raise ValueError("count must be at least 1")

    rng = random.Random(seed) if seed is not None else random.SystemRandom()
    templates = build_templates(corpus)
    letter_bank = build_letter_bank(corpus)
    existing = set(corpus)

    families = [family] if family != "all" else list(FAMILY_LABELS)
    missing = [name for name in families if not templates.get(name)]
    if missing:
        raise ValueError(
            "no templates for: " + ", ".join(missing) +
            "; use a corpus containing those pattern families"
        )

    output: list[str] = []
    seen = set(existing)
    attempts = 0
    max_attempts = max(1000, count * 1000)
    while len(output) < count and attempts < max_attempts:
        attempts += 1
        selected_family = rng.choice(families)
        template = rng.choice(templates[selected_family])
        candidate = render(
            rng,
            template,
            letter_bank,
            use_letter_bank=selected_family != "letters",
        )
        if candidate not in seen:
            seen.add(candidate)
            output.append(candidate)

    if len(output) < count:
        raise RuntimeError(
            f"generated {len(output)} unique candidates after {attempts} attempts; "
            "increase pattern variety or lower --count"
        )
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate offline random candidates from observed code patterns."
    )
    parser.add_argument(
        "--pattern",
        choices=["all", *FAMILY_LABELS],
        default="all",
        help="pattern family to generate (default: all)",
    )
    parser.add_argument(
        "--count", type=int, default=20, help="number of unique candidates"
    )
    parser.add_argument("--seed", type=int, help="reproducible random seed")
    parser.add_argument(
        "--corpus",
        type=Path,
        default=DEFAULT_CORPUS,
        help=f"source corpus (default: {DEFAULT_CORPUS})",
    )
    parser.add_argument("--output", type=Path, help="write candidates to a file")
    parser.add_argument(
        "--show-patterns",
        action="store_true",
        help="show the available template counts and exit",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    corpus = load_corpus(args.corpus)
    templates = build_templates(corpus)

    if args.show_patterns:
        for family in FAMILY_LABELS:
            print(f"{family:7} {FAMILY_LABELS[family]}: {len(templates.get(family, []))} templates")
        return 0

    candidates = generate(corpus, args.pattern, args.count, args.seed)
    text = "\n".join(candidates) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
