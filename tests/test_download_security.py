import importlib.util
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
# Download tests do not parse PDFs or install optional dependencies.
with patch.dict(sys.modules, {"pdfplumber": types.ModuleType("pdfplumber")}):
    spec = importlib.util.spec_from_file_location("update_data_security", ROOT / "scripts/update_data.py")
    updater = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(updater)

PDF_URL = "https://www.city.kawasaki.jp/230/cmsfiles/contents/0000075/75957/R6kessanhojyokin.pdf"


class DownloadSecurityTests(unittest.TestCase):
    def test_current_official_sources(self):
        import json
        manifest = json.loads((ROOT / "data/index.json").read_text())
        for entry in manifest["datasets"]:
            self.assertEqual(updater.validate_source_url(entry["sourceUrl"], pdf_only=True), entry["sourceUrl"])
        for url in updater.PAGES:
            updater.validate_source_url(url)

    def test_unsafe_sources_rejected(self):
        for url in ["file:///private/tmp/R6yosan.pdf", "http://127.0.0.1/R6yosan.pdf",
                    "https://example.invalid/R6yosan.pdf", PDF_URL + "?x=y", PDF_URL + "#x",
                    PDF_URL.replace("www.city.kawasaki.jp", "user:secret@www.city.kawasaki.jp"),
                    PDF_URL.replace("www.city.kawasaki.jp", "www.city.kawasaki.jp.evil.invalid"),
                    PDF_URL + "\n"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                updater.validate_source_url(url, pdf_only=True)

    def test_parser_blocks_foreign_candidate(self):
        parser = updater.PdfLinkParser(updater.LATEST_PAGE)
        with self.assertRaises(ValueError):
            parser.feed('<a href="https://example.invalid/R6yosan.pdf">fake</a>')

    def mock_response(self, status, body=b"%PDF-AUDIT", location=None):
        def run(args, **options):
            self.assertNotIn("-L", args)
            self.assertIn("--max-time", args)
            self.assertIn("--max-filesize", args)
            self.assertEqual(options["timeout"], 50)
            self.assertFalse(options.get("shell", False))
            headers = f"HTTP/1.1 {status} AUDIT\r\n"
            if location:
                headers += f"Location: {location}\r\n"
            headers += "\r\n"
            Path(args[args.index("--dump-header") + 1]).write_bytes(headers.encode())
            Path(args[args.index("--output") + 1]).write_bytes(body)
            return subprocess.CompletedProcess(args, 0)
        return run

    def test_success_and_proxy_header_block(self):
        def run(args, **options):
            result = self.mock_response(200)(args, **options)
            headers = Path(args[args.index("--dump-header") + 1])
            headers.write_bytes(b"HTTP/1.1 200 Connection established\r\n\r\n" + headers.read_bytes())
            return result
        with patch.object(updater.subprocess, "run", side_effect=run):
            self.assertEqual(updater.fetch(PDF_URL), b"%PDF-AUDIT")

    def test_foreign_redirect_never_requested(self):
        with patch.object(updater.subprocess, "run", side_effect=self.mock_response(302, location="https://example.invalid/R6yosan.pdf")) as request:
            with self.assertRaises(ValueError): updater.fetch(PDF_URL)
            self.assertEqual(request.call_count, 1)

    def test_redirect_limit(self):
        with patch.object(updater.subprocess, "run", side_effect=self.mock_response(302, location=PDF_URL)) as request:
            with self.assertRaises(ValueError): updater.fetch(PDF_URL)
            self.assertEqual(request.call_count, 4)

    def test_non_pdf_and_oversized_body(self):
        with patch.object(updater.subprocess, "run", side_effect=self.mock_response(200, b"<html>fake</html>")):
            with self.assertRaises(ValueError): updater.fetch(PDF_URL)
        with patch.object(updater, "MAX_PDF_BYTES", 4), patch.object(updater.subprocess, "run", side_effect=self.mock_response(200)):
            with self.assertRaises(ValueError): updater.fetch(PDF_URL)

    def test_extraction_runs_in_bounded_child(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf = Path(directory) / "R6yosan.pdf"
            pdf.write_bytes(b"%PDF-AUDIT")
            response = subprocess.CompletedProcess([], 0, stdout=b'{"items":[],"declared_total":null}')
            with patch.object(updater.subprocess, "run", return_value=response) as run:
                self.assertEqual(updater.extract_with_limits(pdf), ([], None))
                self.assertEqual(run.call_args.kwargs["timeout"], 180)
                self.assertIn("--extract-one", run.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
