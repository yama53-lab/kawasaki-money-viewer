#!/usr/bin/env python3
"""Download every published Kawasaki subsidy PDF and rebuild yearly JSON files."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import unicodedata
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

import pdfplumber


LATEST_PAGE = "https://www.city.kawasaki.jp/230/page/0000075957.html"
ARCHIVE_PAGE = "https://www.city.kawasaki.jp/230/page/0000148865.html"
PAGES = (LATEST_PAGE, ARCHIVE_PAGE)
MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_PDF_BYTES = 32 * 1024 * 1024
MAX_PDF_PAGES = 200
MAX_ITEMS = 10000


def validate_source_url(url: str, *, pdf_only: bool = False) -> str:
    if not isinstance(url, str) or len(url) > 2048 or re.search(r"[\x00-\x20\x7f]", url):
        raise ValueError("Invalid source URL")
    parsed = urlparse(url)
    if (parsed.scheme != "https" or parsed.hostname != "www.city.kawasaki.jp"
            or parsed.port not in (None, 443) or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise ValueError("Only official HTTPS sources are allowed")
    is_pdf = bool(re.fullmatch(r"/230/cmsfiles/contents/[A-Za-z0-9_/-]+\.pdf", parsed.path, re.IGNORECASE))
    if not is_pdf and (pdf_only or url not in PAGES):
        raise ValueError("Source path is not allowed")
    return url


class PdfLinkParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.urls: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href") or ""
        lowered = href.lower()
        if ".pdf" in lowered and ("yosan" in lowered or "kessan" in lowered):
            self.urls.append(validate_source_url(urljoin(self.base_url, href), pdf_only=True))


def fetch(url: str) -> bytes:
    current = validate_source_url(url)
    for _ in range(4):
        limit = MAX_PDF_BYTES if urlparse(current).path.lower().endswith(".pdf") else MAX_HTML_BYTES
        # Redirects are processed individually so validation cannot be bypassed.
        with tempfile.TemporaryDirectory(prefix="kawasaki-download-") as directory:
            body_path = Path(directory) / "body"
            headers_path = Path(directory) / "headers"
            subprocess.run(
                ["curl", "--disable", "--proto", "=https", "--proto-redir", "=https", "--fail",
                 "--silent", "--show-error", "--connect-timeout", "10", "--max-time", "45",
                 "--max-filesize", str(limit), "--dump-header", str(headers_path),
                 "--output", str(body_path), "--url", current],
                check=True, capture_output=True, timeout=50,
            )
            blocks = [block for block in headers_path.read_text(encoding="latin-1").split("\n\n") if block.startswith("HTTP/")]
            if not blocks:
                raise ValueError("Missing HTTP status")
            lines = blocks[-1].splitlines()
            status = int(lines[0].split()[1])
            if status in (301, 302, 303, 307, 308):
                locations = [line.split(":", 1)[1].strip() for line in lines[1:] if line.lower().startswith("location:")]
                if len(locations) != 1:
                    raise ValueError("Invalid redirect")
                current = validate_source_url(urljoin(current, locations[0]), pdf_only=urlparse(url).path.lower().endswith(".pdf"))
                continue
            if status != 200 or not body_path.is_file() or body_path.stat().st_size > limit:
                raise ValueError("Unexpected response or oversized source")
            body = body_path.read_bytes()
            if urlparse(current).path.lower().endswith(".pdf") and b"%PDF-" not in body[:1024]:
                raise ValueError("Source is not a PDF")
            return body
    raise ValueError("Too many redirects")


def discover_urls() -> list[str]:
    urls: list[str] = []
    for page_url in PAGES:
        parser = PdfLinkParser(page_url)
        parser.feed(fetch(page_url).decode("utf-8"))
        urls.extend(parser.urls)
    return list(dict.fromkeys(urls))


def clean(value: str | None) -> str:
    if not value:
        return ""
    replacements = {
        "(cid:1)": "①",
        "(cid:2)": "②",
        "(cid:3)": "③",
        "(cid:4)": "④",
        "(cid:5)": "⑤",
        "（": "(",
        "）": ")",
    }
    value = re.sub(r"\s+", "", value)
    for source, target in replacements.items():
        value = value.replace(source, target)
    return value.strip()


def number(value: str | None) -> int:
    digits = re.sub(r"[^0-9-]", "", value or "")
    return int(digits) if digits and digits != "-" else 0


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower()
    value = re.sub(r"[\s\u3000・･]", "", value)
    return re.sub(r"[‐‑‒–—―－]", "-", value)


def era_info(filename: str) -> tuple[str, str, int]:
    match = re.match(r"([RH])(\d+)", filename, re.IGNORECASE)
    if not match:
        raise ValueError(f"Cannot determine fiscal year from {filename}")
    era, year_text = match.groups()
    year = int(year_text)
    if era.upper() == "R":
        label = f"令和{year}年度" if year != 1 else "令和元年度"
        sort_year = 2018 + year
        key = f"R{year}"
    else:
        label = f"平成{year}年度"
        sort_year = 1988 + year
        key = f"H{year}"
    return key, label, sort_year


def previous_label(key: str) -> str:
    era, year = key[0], int(key[1:])
    if era == "R" and year == 1:
        return "平成30年度"
    if era == "R":
        return f"令和{year - 1}年度" if year > 2 else "令和元年度"
    return f"平成{year - 1}年度"


def h29_budget_table(page) -> list[list[str | None]] | None:
    verticals = [57, 73, 155, 210.7, 266.4, 370.8, 408.6, 440.9, 473.2, 503.5, 534]
    horizontals = sorted(
        {
            round(rect["top"], 1)
            for rect in page.rects
            if rect["width"] > 400 and rect["height"] < 3
        }
    )
    if len(horizontals) < 2:
        return None
    return page.extract_table(
        {
            "vertical_strategy": "explicit",
            "explicit_vertical_lines": verticals,
            "horizontal_strategy": "explicit",
            "explicit_horizontal_lines": horizontals,
            "snap_tolerance": 2,
            "join_tolerance": 2,
        }
    )


def extract_pdf(pdf_path: Path) -> tuple[list[dict], tuple[int, int | None] | None]:
    items: list[dict] = []
    declared_total: tuple[int, int | None] | None = None
    is_h29_budget = pdf_path.name.lower().startswith("h29yosan")

    with pdfplumber.open(pdf_path) as pdf:
        if len(pdf.pages) > MAX_PDF_PAGES:
            raise ValueError("PDF has too many pages")
        for page_index, page in enumerate(pdf.pages):
            if len(page.chars) > 200000 or len(page.rects) > 100000:
                raise ValueError("PDF page is too complex")
            if is_h29_budget and page_index >= 4:
                special_table = h29_budget_table(page)
                tables = [special_table] if special_table else []
            else:
                tables = page.extract_tables()

            for table in tables:
                if not table or len(table[0]) not in (5, 10):
                    continue
                header_text = clean("".join(cell or "" for cell in table[0]))
                if "補助金の名称" not in header_text:
                    continue

                modern = len(table[0]) == 10
                for row in table[1:]:
                    if not row or len(row) != len(table[0]):
                        continue
                    raw_number = clean(row[0])
                    name = clean(row[1])
                    if raw_number in ("計", "合計") or name in ("計", "合計"):
                        declared_total = (number(row[2]), number(row[3]) if modern else None)
                        continue

                    if not name and re.search(r"[一-龠ぁ-んァ-ヶ]", raw_number):
                        match = re.search(r"\d+", raw_number)
                        if match:
                            name = clean(raw_number[: match.start()] + raw_number[match.end() :])
                            raw_number = match.group()

                    if not name:
                        continue
                    if len(items) >= MAX_ITEMS or any(len(cell or "") > 8192 for cell in row):
                        raise ValueError("PDF has too many records or oversized fields")

                    current = number(row[2])
                    previous = number(row[3]) if modern else None
                    order = len(items) + 1
                    items.append(
                        {
                            "order": order,
                            "number": raw_number or "—",
                            "name": name,
                            "current": current,
                            "previous": previous,
                            "recipient": clean(row[4] if modern else row[3]),
                            "bureau": clean(row[5] if modern else row[4]),
                            "years": number(row[6]) if modern and clean(row[6]).isdigit() else None,
                            "category1": clean(row[7]) if modern else "",
                            "category2": clean(row[8]) if modern else "",
                            "category3": clean(row[9]) if modern else "",
                        }
                    )

    current_total = sum(item["current"] for item in items)
    previous_total = (
        sum(item["previous"] or 0 for item in items)
        if items and items[0]["previous"] is not None
        else None
    )
    if declared_total and (current_total, previous_total) != declared_total:
        raise ValueError(
            f"{pdf_path.name}: extracted totals {(current_total, previous_total)} "
            f"do not match PDF totals {declared_total}"
        )
    return items, declared_total


def extract_with_limits(pdf_path: Path) -> tuple[list[dict], tuple[int, int | None] | None]:
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--extract-one", str(pdf_path.resolve())],
        check=True, capture_output=True, timeout=180,
    )
    if len(result.stdout) > 8 * 1024 * 1024:
        raise ValueError("Extracted JSON is oversized")
    result_data = json.loads(result.stdout)
    total = result_data["declared_total"]
    return result_data["items"], tuple(total) if total is not None else None


def write_json(path: Path, value: dict, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, separators=(",", ":") if compact else None,
                         indent=None if compact else 2) + "\n"
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        temporary.write(content)
        temporary_path = Path(temporary.name)
    temporary_path.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-dir", type=Path, default=Path("tmp/pdfs"))
    parser.add_argument("--output", type=Path, default=Path("data"))
    parser.add_argument("--updated-at", default=date.today().isoformat())
    parser.add_argument("--extract-one", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.extract_one:
        if args.extract_one.is_symlink() or args.extract_one.stat().st_size > MAX_PDF_BYTES:
            raise ValueError("Invalid or oversized cached PDF")
        if sys.platform == "linux":
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
        items, total = extract_pdf(args.extract_one)
        print(json.dumps({"items": items, "declared_total": total}, ensure_ascii=False))
        return

    date.fromisoformat(args.updated_at)

    args.pdf_dir.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    urls = discover_urls()
    datasets: list[dict] = []
    payloads: list[tuple[str, dict]] = []
    trend_series: dict[str, dict] = {}

    for url in urls:
        validate_source_url(url, pdf_only=True)
        filename = Path(urlparse(url).path).name
        lowered = filename.lower()
        data_type = "budget" if "yosan" in lowered else "settlement"
        type_label = "予算" if data_type == "budget" else "決算"
        key, year_label, sort_year = era_info(filename)
        pdf_path = args.pdf_dir / filename
        if pdf_path.is_symlink():
            raise ValueError("Cached PDF must not be a symbolic link")
        if not pdf_path.exists():
            pdf_path.write_bytes(fetch(url))

        items, _ = extract_with_limits(pdf_path)
        current_total = sum(item["current"] for item in items)
        previous_available = bool(items and items[0]["previous"] is not None)
        previous_total = sum(item["previous"] or 0 for item in items) if previous_available else None
        relative_path = f"{data_type}/{key}.json"
        payload = {
            "type": data_type,
            "typeLabel": type_label,
            "year": key,
            "yearLabel": year_label,
            "previousYearLabel": previous_label(key) if previous_available else None,
            "unit": "千円",
            "sourceUrl": url,
            "updatedAt": args.updated_at,
            "recordCount": len(items),
            "activeCount": sum(item["current"] > 0 for item in items),
            "currentTotal": current_total,
            "previousTotal": previous_total,
            "items": items,
        }
        payloads.append((relative_path, payload))
        datasets.append(
            {
                "type": data_type,
                "typeLabel": type_label,
                "year": key,
                "yearLabel": year_label,
                "sortYear": sort_year,
                "file": relative_path,
                "sourceUrl": url,
                "recordCount": len(items),
                "activeCount": payload["activeCount"],
                "currentTotal": current_total,
                "previousTotal": previous_total,
            }
        )
        for item in items:
            trend_key = normalize_name(item["name"])
            series = trend_series.setdefault(
                trend_key,
                {"name": item["name"], "points": {}},
            )
            point = series["points"].setdefault(
                str(sort_year),
                {
                    "sortYear": sort_year,
                    "budgetYearLabel": None,
                    "settlementYearLabel": None,
                    "budget": None,
                    "settlement": None,
                },
            )
            point[data_type] = item["current"]
            point[f"{data_type}YearLabel"] = year_label
        print(f"{type_label} {year_label}: {len(items)} records")

    datasets.sort(key=lambda item: (item["type"], -item["sortYear"]))
    index = {
        "updatedAt": args.updated_at,
        "sourcePages": {"latest": LATEST_PAGE, "archive": ARCHIVE_PAGE},
        "datasets": datasets,
    }
    trends = {
        "updatedAt": args.updated_at,
        "series": {
            key: {
                "name": series["name"],
                "points": sorted(
                    series["points"].values(),
                    key=lambda point: point["sortYear"],
                ),
            }
            for key, series in trend_series.items()
        },
    }
    if not datasets:
        raise ValueError("No PDF sources found; existing data was not replaced")
    for relative_path, payload in payloads:
        write_json(args.output / relative_path, payload)
    write_json(args.output / "trends.json", trends, compact=True)
    write_json(args.output / "index.json", index)
    print(f"Wrote {len(datasets)} datasets to {args.output}")


if __name__ == "__main__":
    main()
