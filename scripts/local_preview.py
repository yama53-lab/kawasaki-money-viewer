#!/usr/bin/env python3
"""Serve the public site over loopback for local browser verification."""

from __future__ import annotations

import argparse
import errno
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
import threading
from urllib.parse import unquote, urlsplit
import webbrowser


ROOT = Path(__file__).resolve().parent.parent
PAGES = {
    "general-account": "general-account.html",
    "subsidies": "index.html",
}
PUBLIC_FILES = {"index.html", "general-account.html", "about.html", "help.html", "policy.html"}
PUBLIC_DIRECTORIES = {"assets", "css", "data", "js"}


class PreviewHandler(SimpleHTTPRequestHandler):
    """Only expose files that form part of the static website."""

    def is_public_path(self) -> bool:
        path = PurePosixPath(unquote(urlsplit(self.path).path))
        parts = tuple(part for part in path.parts if part != "/")
        if not parts:
            return True
        if any(part in {".", ".."} or part.startswith(".") for part in parts):
            return False
        return (len(parts) == 1 and parts[0] in PUBLIC_FILES) or parts[0] in PUBLIC_DIRECTORIES

    def reject_private_path(self) -> None:
        self.send_error(404, "Not found")

    def do_GET(self) -> None:  # noqa: N802 - inherited HTTP method name
        if not self.is_public_path():
            self.reject_private_path()
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802 - inherited HTTP method name
        if not self.is_public_path():
            self.reject_private_path()
            return
        super().do_HEAD()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="かわさき Money Viewerをローカルで表示します。")
    parser.add_argument("--port", type=int, default=8765, help="使用するポート番号（初期値: 8765）")
    parser.add_argument("--page", choices=PAGES, default="general-account", help="最初に開くページ")
    parser.add_argument("--no-open", action="store_true", help="ブラウザを自動的に開かない")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("ポート番号は1024〜65535で指定してください。")
    return args


def main() -> int:
    args = parse_args()
    handler = partial(PreviewHandler, directory=str(ROOT))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            print(f"ポート{args.port}は使用中です。例: python3 scripts/local_preview.py --port {args.port + 1}")
            return 1
        raise

    url = f"http://127.0.0.1:{args.port}/{PAGES[args.page]}"
    print("かわさき Money Viewerのローカル確認を開始しました。")
    print(f"表示URL: {url}")
    print("終了するときは Control + C を押してください。")

    if not args.no_open:
        threading.Timer(0.25, webbrowser.open, args=(url,)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nローカル確認を終了しました。")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

