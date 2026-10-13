#!/usr/bin/env python3
"""Create a fresh, allowlisted Pages artifact without publishing anything."""
import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from generate_seo_pages import generate_seo_pages

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_FILES = (
    "index.html", "general-account.html", "about.html", "help.html", "policy.html", ".nojekyll",
    "css/style.css", "js/data-validation.js", "js/app.js", "js/general-account.js", "assets/brand-coin.svg",
    "data/index.json", "data/trends.json", "data/general-account/index.json",
)


def prepare(output: Path | None = None) -> Path:
    subprocess.run(["node", str(ROOT / "scripts/check_data.cjs")], check=True, timeout=60)
    manifest = json.loads((ROOT / "data/index.json").read_text(encoding="utf-8"))
    files = list(PUBLIC_FILES)
    for dataset in manifest["datasets"]:
        if not re.fullmatch(r"(budget|settlement)/[RH][1-9]\d{0,2}\.json", dataset["file"]):
            raise ValueError("Invalid dataset filename")
        files.append("data/" + dataset["file"])
    general_account_manifest = json.loads((ROOT / "data/general-account/index.json").read_text(encoding="utf-8"))
    for dataset in general_account_manifest["datasets"]:
        if not re.fullmatch(r"[RH][1-9]\d{0,2}\.json", dataset["file"]):
            raise ValueError("Invalid general account dataset filename")
        files.append("data/general-account/" + dataset["file"])
    for relative in files:
        source = ROOT / relative
        if source.resolve() != source or not source.is_file():
            raise ValueError("Public files must be regular files, not symbolic links")
    temporary_root = ROOT / "tmp"
    if temporary_root.is_symlink():
        raise ValueError("Build directory must not be a symbolic link")
    temporary_root.mkdir(exist_ok=True)
    if output is None:
        output = Path(tempfile.mkdtemp(prefix="pages-", dir=temporary_root))
    else:
        output = output.absolute()
        if output.parent.resolve() != temporary_root or output.exists() or output.is_symlink():
            raise ValueError("Output must be a new, direct child of tmp/")
        output.mkdir()
    for relative in files:
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, destination)
    generate_seo_pages(output)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = prepare(args.output)
    print(f"Prepared Pages files: {output}")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            stream.write(f"directory={output}\n")


if __name__ == "__main__":
    main()
