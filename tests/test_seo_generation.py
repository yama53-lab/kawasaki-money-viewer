import base64
import hashlib
import importlib.util
import json
import re
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("generate_seo_pages", ROOT / "scripts/generate_seo_pages.py")
GENERATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GENERATOR)


class SeoGenerationTests(unittest.TestCase):
    def test_generates_every_dataset_and_discovery_file(self):
        manifest = json.loads((ROOT / "data/index.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            GENERATOR.generate_seo_pages(output)

            pages = list((output / "years").glob("*/*.html"))
            self.assertEqual(len(pages), len(manifest["datasets"]))
            self.assertTrue((output / "years/index.html").is_file())
            self.assertIn("Sitemap: https://yama53-lab.github.io/kawasaki-money-viewer/sitemap.xml", (output / "robots.txt").read_text())

            root = ET.parse(output / "sitemap.xml").getroot()
            urls = root.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url")
            self.assertEqual(len(urls), len(manifest["datasets"]) + 6)

    def test_year_page_has_static_items_canonical_and_valid_csp_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            GENERATOR.generate_seo_pages(output)
            page = (output / "years/budget/r8.html").read_text(encoding="utf-8")

            self.assertIn("川崎市 令和8年度の", page)
            self.assertIn("川崎市自主防災組織活動助成金", page)
            self.assertIn('rel="canonical" href="https://yama53-lab.github.io/kawasaki-money-viewer/years/budget/r8.html"', page)
            structured = re.search(r'<script type="application/ld\+json">(.*?)</script>', page).group(1)
            digest = base64.b64encode(hashlib.sha256(structured.encode("utf-8")).digest()).decode("ascii")
            self.assertIn(f"'sha256-{digest}'", page)


if __name__ == "__main__":
    unittest.main()
