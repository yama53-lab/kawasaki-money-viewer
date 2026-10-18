#!/usr/bin/env python3
"""Validate normalized general-account datasets and rebuild their manifest."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = ROOT / "data/general-account"
YEAR_PATTERN = re.compile(r"([RH])([1-9]\d{0,2})")
MAX_DATASET_BYTES = 512 * 1024


def year_info(key: str) -> tuple[str, int]:
    match = YEAR_PATTERN.fullmatch(key)
    if not match:
        raise ValueError(f"Invalid fiscal year: {key}")
    era, number_text = match.groups()
    number = int(number_text)
    if era == "R":
        return ("令和元年度" if number == 1 else f"令和{number}年度", 2018 + number)
    return (f"平成{number}年度", 1988 + number)


def validate_official_url(value: object, *, pdf: bool) -> str:
    if not isinstance(value, str) or len(value) > 2048 or re.search(r"[\x00-\x20\x7f]", value):
        raise ValueError("Invalid general-account source URL")
    parsed = urlparse(value)
    if (parsed.scheme != "https" or parsed.hostname != "www.city.kawasaki.jp"
            or parsed.port not in (None, 443) or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise ValueError("General-account sources must use official HTTPS URLs")
    if pdf:
        allowed = re.fullmatch(r"/230/cmsfiles/contents/[A-Za-z0-9_/%().-]+\.pdf", parsed.path, re.IGNORECASE)
    else:
        allowed = re.fullmatch(r"/230/page/\d+\.html", parsed.path)
    if not allowed:
        raise ValueError("General-account source path is not allowed")
    return value


def read_dataset(path: Path) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_DATASET_BYTES:
        raise ValueError(f"Invalid general-account dataset: {path.name}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("type") != "generalAccount":
        raise ValueError(f"Invalid general-account structure: {path.name}")
    key = path.stem
    label, _ = year_info(key)
    if value.get("year") != key or value.get("yearLabel") != label:
        raise ValueError(f"General-account year does not match filename: {path.name}")
    if value.get("budgetStage") != "initial" or value.get("budgetStageLabel") != "当初予算":
        raise ValueError(f"Unsupported general-account budget stage: {path.name}")
    updated_at = value.get("updatedAt")
    if not isinstance(updated_at, str):
        raise ValueError(f"Missing general-account update date: {path.name}")
    date.fromisoformat(updated_at)
    validate_official_url(value.get("sourcePageUrl"), pdf=False)
    validate_official_url(value.get("sourceUrl"), pdf=True)
    return value


def write_json(path: Path, value: dict) -> None:
    dataset_lines = []
    for index, dataset in enumerate(value["datasets"]):
        inner = json.dumps(dataset, ensure_ascii=False, separators=(", ", ": "))[1:-1]
        suffix = "," if index < len(value["datasets"]) - 1 else ""
        dataset_lines.append(f"    {{ {inner} }}{suffix}")
    content = "\n".join([
        "{",
        f'  "type": {json.dumps(value["type"], ensure_ascii=False)},',
        f'  "updatedAt": {json.dumps(value["updatedAt"], ensure_ascii=False)},',
        '  "datasets": [',
        *dataset_lines,
        "  ]",
        "}",
        "",
    ])
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        temporary.write(content)
        temporary_path = Path(temporary.name)
    temporary_path.replace(path)


def rebuild(data_root: Path = DATA_ROOT) -> dict:
    data_root = data_root.absolute()
    if data_root.is_symlink() or not data_root.is_dir():
        raise ValueError("General-account data directory must be a regular directory")
    datasets = []
    updated_dates = []
    for path in data_root.glob("*.json"):
        if path.name == "index.json":
            continue
        value = read_dataset(path)
        _, sort_year = year_info(value["year"])
        updated_dates.append(value["updatedAt"])
        datasets.append({
            "year": value["year"],
            "yearLabel": value["yearLabel"],
            "sortYear": sort_year,
            "file": path.name,
        })
    if not datasets:
        raise ValueError("No general-account datasets found")
    datasets.sort(key=lambda item: item["sortYear"], reverse=True)
    index = {
        "type": "generalAccountIndex",
        "updatedAt": max(updated_dates),
        "datasets": datasets,
    }
    write_json(data_root / "index.json", index)
    return index


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=DATA_ROOT)
    args = parser.parse_args()
    index = rebuild(args.data_root)
    print(f"Rebuilt general-account index for {len(index['datasets'])} years; latest normalized data {index['updatedAt']}")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            stream.write(f"years={len(index['datasets'])}\n")


if __name__ == "__main__":
    main()
