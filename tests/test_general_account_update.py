import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "update_general_account", ROOT / "scripts/update_general_account.py"
)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class GeneralAccountUpdateTests(unittest.TestCase):
    def test_rebuilds_manifest_from_normalized_year_files(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            shutil.copyfile(ROOT / "data/general-account/R8.json", target / "R8.json")
            shutil.copyfile(ROOT / "data/general-account/H25.json", target / "H25.json")
            index = updater.rebuild(target)
            self.assertEqual([item["year"] for item in index["datasets"]], ["R8", "H25"])
            self.assertEqual(index["updatedAt"], "2026-10-13")
            self.assertEqual(index, json.loads((target / "index.json").read_text()))

    def test_rejects_filename_and_dataset_year_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            shutil.copyfile(ROOT / "data/general-account/R8.json", target / "R7.json")
            with self.assertRaises(ValueError):
                updater.rebuild(target)

    def test_rejects_non_official_sources(self):
        with self.assertRaises(ValueError):
            updater.validate_official_url("https://example.invalid/source.pdf", pdf=True)
        with self.assertRaises(ValueError):
            updater.validate_official_url("https://www.city.kawasaki.jp/230/page/../secret.html", pdf=False)


if __name__ == "__main__":
    unittest.main()
