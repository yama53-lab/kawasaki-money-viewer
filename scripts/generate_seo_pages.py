#!/usr/bin/env python3
"""Generate crawlable year pages, robots.txt and sitemap.xml for Pages."""

from __future__ import annotations

import base64
import hashlib
import html
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "https://yama53-lab.github.io/kawasaki-money-viewer/"


def escape(value: object) -> str:
    return html.escape(str(value), quote=True)


def compact_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def script_hash(content: str) -> str:
    digest = hashlib.sha256(content.encode("utf-8")).digest()
    return base64.b64encode(digest).decode("ascii")


def readable_amount(thousands: int) -> str:
    absolute = abs(thousands)
    sign = "−" if thousands < 0 else ""
    if absolute >= 100_000:
        amount = f"{absolute / 100_000:,.1f}".removesuffix(".0")
        return f"{sign}約{amount}億円"
    if absolute >= 10:
        amount = f"{absolute / 10:,.1f}".removesuffix(".0")
        return f"{sign}{amount}万円"
    return f"{sign}{absolute * 1_000:,}円"


def page_shell(*, title: str, description: str, canonical: str, body: str,
               depth: int, json_ld: dict | None = None) -> str:
    prefix = "../" * depth
    structured_data = compact_json(json_ld) if json_ld else ""
    scripts = "'none'"
    structured_tag = ""
    if structured_data:
        scripts = f"'sha256-{script_hash(structured_data)}'"
        structured_tag = f'\n    <script type="application/ld+json">{structured_data}</script>'
    return f"""<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src {scripts}; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'" />
    <meta name="referrer" content="no-referrer" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="{escape(description)}" />
    <meta name="theme-color" content="#063b4c" />
    <meta property="og:locale" content="ja_JP" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="{escape(title)}" />
    <meta property="og:description" content="{escape(description)}" />
    <meta property="og:url" content="{escape(canonical)}" />
    <link rel="canonical" href="{escape(canonical)}" />
    <title>{escape(title)}</title>
    <link rel="icon" type="image/svg+xml" href="{prefix}assets/brand-coin.svg" />
    <link rel="stylesheet" href="{prefix}css/style.css" />{structured_tag}
  </head>
  <body>
    <a class="skip-link" href="#content">本文へ移動</a>
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="{prefix}" aria-label="かわさき Money Viewer トップ">
          <img class="brand-mark" src="{prefix}assets/brand-coin.svg" alt="" aria-hidden="true" />
          <span><strong>かわさき Money Viewer</strong><small>川崎市のお金を見つける</small></span>
        </a>
        <a class="source-link source-link--header" href="{prefix}">検索ページへ <span aria-hidden="true">↗</span></a>
      </div>
    </header>
    {body}
    <footer class="site-footer">
      <div><p>かわさき Money Viewer</p><small>川崎市とは無関係の非公式サイト</small></div>
      <nav class="footer-nav" aria-label="サイト案内">
        <a href="{prefix}">補助・助成金</a>
        <a href="{prefix}general-account.html">一般会計</a>
        <a href="{prefix}years/">年度別一覧</a>
        <a href="{prefix}about.html">このサイト・データについて</a>
        <a href="{prefix}help.html">使い方・よくある質問</a>
        <a href="{prefix}policy.html">利用上の注意・プライバシー</a>
      </nav>
    </footer>
  </body>
</html>
"""


def render_year_page(manifest: dict, dataset: dict) -> str:
    data_type = manifest["type"]
    type_label = manifest["typeLabel"]
    year = manifest["year"]
    year_label = manifest["yearLabel"]
    slug = year.lower()
    canonical = f"{BASE_URL}years/{data_type}/{slug}.html"
    title = f"川崎市 {year_label}の補助金・助成金｜{type_label}一覧"
    description = (
        f"川崎市の{year_label}{type_label}に掲載された補助金・助成金"
        f"{manifest['recordCount']:,}件を、名称・所管局・交付先・金額とともに一覧で確認できます。"
    )
    query = f"../../?type={data_type}&amp;year={year}"
    list_items = []
    for item in dataset["items"]:
        current = item["current"]
        recipient = item.get("recipient") or "原資料に記載なし"
        bureau = item.get("bureau") or "原資料に記載なし"
        categories = " / ".join(filter(None, [item.get("category1"), item.get("category2")]))
        category_html = f'<span class="dataset-category">{escape(categories)}</span>' if categories else ""
        list_items.append(
            f"""<li id="item-{item['order']}">
              <div class="dataset-item-heading"><span>{escape(item.get('number') or item['order'])}</span><h3>{escape(item['name'])}</h3></div>
              <dl>
                <div><dt>{escape(type_label)}額</dt><dd>{escape(readable_amount(current))}<small>{current:,}千円</small></dd></div>
                <div><dt>所管局</dt><dd>{escape(bureau)}</dd></div>
                <div><dt>交付先</dt><dd>{escape(recipient)}</dd></div>
              </dl>
              {category_html}
            </li>"""
        )
    body = f"""<main class="dataset-page" id="content">
      <nav class="breadcrumbs" aria-label="パンくずリスト"><a href="../../">トップ</a><span>›</span><a href="../">年度別一覧</a><span>›</span><span>{escape(year_label)}{escape(type_label)}</span></nav>
      <section class="dataset-hero">
        <p class="eyebrow">{escape(year_label)} / {escape(data_type.upper())}</p>
        <h1>川崎市 {escape(year_label)}の<br />補助金・助成金 {escape(type_label)}一覧</h1>
        <p>{escape(description)}</p>
        <div class="dataset-actions">
          <a class="secondary-button" href="{query}">検索・絞り込みを使う</a>
          <a class="source-link" href="{escape(manifest['sourceUrl'])}" target="_blank" rel="noopener noreferrer">川崎市の元PDFを確認する <span aria-hidden="true">↗</span></a>
        </div>
      </section>
      <section class="dataset-overview" aria-label="データ概要">
        <div><span>掲載件数</span><strong>{manifest['recordCount']:,}件</strong></div>
        <div><span>{escape(type_label)}額合計</span><strong>{escape(readable_amount(manifest['currentTotal']))}</strong><small>{manifest['currentTotal']:,}千円</small></div>
        <div><span>データ更新</span><strong>{escape(dataset['updatedAt'].replace('-', '/'))}</strong></div>
      </section>
      <section class="dataset-content" aria-labelledby="dataset-list-title">
        <div class="dataset-content-heading">
          <div><p class="section-number">ALL ITEMS</p><h2 id="dataset-list-title">掲載項目一覧</h2></div>
          <p>金額は原資料の千円単位を併記しています。</p>
        </div>
        <ol class="dataset-list">{''.join(list_items)}</ol>
      </section>
      <aside class="dataset-caution">
        <strong>ご利用前にご確認ください</strong>
        <p>このページは川崎市とは無関係の非公式ページです。正確性・最新性は川崎市の原資料で確認し、申請条件や募集状況は各所管局へお問い合わせください。</p>
      </aside>
    </main>"""
    json_ld = {
        "@context": "https://schema.org",
        "@type": "Dataset",
        "name": f"川崎市 {year_label} 補助・助成金 {type_label}一覧",
        "description": description,
        "url": canonical,
        "inLanguage": "ja",
        "isAccessibleForFree": True,
        "dateModified": dataset["updatedAt"],
        "temporalCoverage": str(manifest["sortYear"]),
        "sameAs": manifest["sourceUrl"],
        "distribution": {
            "@type": "DataDownload",
            "encodingFormat": "application/json",
            "contentUrl": f"{BASE_URL}data/{manifest['file']}",
        },
    }
    return page_shell(title=title, description=description, canonical=canonical, body=body, depth=2, json_ld=json_ld)


def render_year_index(datasets: list[dict], updated_at: str) -> str:
    canonical = f"{BASE_URL}years/"
    title = "川崎市の補助金・助成金 年度別一覧｜予算・決算"
    description = "川崎市が公開する補助金・助成金一覧を、予算・決算それぞれ年度別に確認できます。"
    groups = []
    links_for_schema = []
    for data_type, heading in (("budget", "予算"), ("settlement", "決算")):
        entries = [item for item in datasets if item["type"] == data_type]
        links = []
        for item in entries:
            href = f"{data_type}/{item['year'].lower()}.html"
            links_for_schema.append({"@type": "ListItem", "position": len(links_for_schema) + 1, "url": canonical + href, "name": f"{item['yearLabel']}{heading}"})
            links.append(
                f'<li><a href="{href}"><strong>{escape(item["yearLabel"])}{heading}</strong>'
                f'<span>{item["recordCount"]:,}件・{escape(readable_amount(item["currentTotal"]))}</span></a></li>'
            )
        groups.append(f'<section><h2>{heading}</h2><ul class="year-link-list">{"".join(links)}</ul></section>')
    body = f"""<main class="dataset-page" id="content">
      <nav class="breadcrumbs" aria-label="パンくずリスト"><a href="../">トップ</a><span>›</span><span>年度別一覧</span></nav>
      <section class="dataset-hero">
        <p class="eyebrow">YEAR INDEX / {len(datasets)} DATASETS</p>
        <h1>川崎市の補助金・助成金<br />年度別一覧</h1>
        <p>{escape(description)} 各年度ページには、名称・所管局・交付先・金額を掲載しています。</p>
        <a class="secondary-button" href="../">検索・比較ツールを開く</a>
      </section>
      <div class="year-groups">{''.join(groups)}</div>
      <p class="dataset-updated">データ更新：{escape(updated_at.replace('-', '/'))}</p>
    </main>"""
    json_ld = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": title,
        "description": description,
        "url": canonical,
        "mainEntity": {"@type": "ItemList", "itemListElement": links_for_schema},
    }
    return page_shell(title=title, description=description, canonical=canonical, body=body, depth=1, json_ld=json_ld)


def generate_seo_pages(output: Path) -> None:
    manifest = json.loads((ROOT / "data/index.json").read_text(encoding="utf-8"))
    datasets = manifest["datasets"]
    generated_urls = [BASE_URL, f"{BASE_URL}general-account.html", f"{BASE_URL}about.html", f"{BASE_URL}help.html", f"{BASE_URL}policy.html", f"{BASE_URL}years/"]
    years_root = output / "years"
    years_root.mkdir(parents=True, exist_ok=True)
    (years_root / "index.html").write_text(render_year_index(datasets, manifest["updatedAt"]), encoding="utf-8")

    for item in datasets:
        if not re.fullmatch(r"(?:budget|settlement)/[RH][1-9]\d{0,2}\.json", item["file"]):
            raise ValueError("Invalid dataset filename while generating SEO pages")
        dataset = json.loads((ROOT / "data" / item["file"]).read_text(encoding="utf-8"))
        destination = years_root / item["type"] / f"{item['year'].lower()}.html"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(render_year_page(item, dataset), encoding="utf-8")
        generated_urls.append(f"{BASE_URL}years/{item['type']}/{item['year'].lower()}.html")

    sitemap_entries = "".join(
        f"  <url><loc>{escape(url)}</loc><lastmod>{escape(manifest['updatedAt'])}</lastmod></url>\n"
        for url in generated_urls
    )
    sitemap = f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{sitemap_entries}</urlset>\n'
    (output / "sitemap.xml").write_text(sitemap, encoding="utf-8")
    (output / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\n\nSitemap: {BASE_URL}sitemap.xml\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    generate_seo_pages(ROOT)
