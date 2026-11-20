#!/usr/bin/env python3
"""把小银 Markdown 的构建产物发布到官网，并生成升级清单。

用法：
    python3 tools/release/publish.py --notes "更新说明……"           # 用当前 tauri.conf.json 的版本
    python3 tools/release/publish.py --notes "……" --dry-run

做的事：
  1. 从 src-tauri/.../bundle/nsis/ 找安装包和 .sig 签名
  2. 拷安装包到站点 download/（顺便拷一份免安装 exe）
  3. 写 site/update/latest.json —— 客户端 updater 就拉这个
  4. 打印最终 URL 与校验值

客户端地址：https://md.wangjinding.com/update/latest.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "src-tauri" / "target" / "x86_64-pc-windows-gnu" / "release"
NSIS_DIR = TARGET / "bundle" / "nsis"
SITE = ROOT / "site"
SITE_DOWNLOAD = Path("/opt/1panel/www/sites/md.wangjinding.com/index/download")
SITE_UPDATE = Path("/opt/1panel/www/sites/md.wangjinding.com/index/update")
BASE_URL = "https://md.wangjinding.com"


def conf_version() -> str:
    d = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
    return d["version"]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--notes", default="", help="更新说明（会显示在客户的升级弹窗里）")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    version = conf_version()
    setup = NSIS_DIR / f"XiaoyinMarkdown_{version}_x64-setup.exe"
    sig_file = Path(str(setup) + ".sig")

    if not setup.exists():
        print(f"❌ 找不到安装包：{setup}", file=sys.stderr)
        return 1
    if not sig_file.exists():
        print(f"❌ 找不到签名：{sig_file}\n   构建时是否漏了 TAURI_SIGNING_PRIVATE_KEY？", file=sys.stderr)
        return 1

    signature = sig_file.read_text(encoding="utf-8").strip()
    size = setup.stat().st_size
    digest = sha256(setup)
    url = f"{BASE_URL}/download/{setup.name}"

    manifest = {
        "version": version,
        "notes": args.notes or f"小银 Markdown v{version}",
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {
            "windows-x86_64": {
                "signature": signature,
                "url": url,
                "size": size,
                "sha256": digest,
            }
        },
    }

    print(f"  版本      : {version}")
    print(f"  安装包    : {setup.name}  {size/1048576:.2f} MB")
    print(f"  sha256    : {digest[:32]}…")
    print(f"  签名      : {signature[:40]}…")
    print(f"  下载地址  : {url}")

    if args.dry_run:
        print("  [dry-run] 不写入任何文件")
        return 0

    SITE_UPDATE.mkdir(parents=True, exist_ok=True)
    SITE_DOWNLOAD.mkdir(parents=True, exist_ok=True)

    # ① 安装包（客户下载 + updater 拉取的是同一个）
    shutil.copy2(setup, SITE_DOWNLOAD / setup.name)
    (SITE_DOWNLOAD / setup.name).chmod(0o644)

    # ② 免安装版
    portable = TARGET / "xiaoyin-markdown.exe"
    if portable.exists():
        shutil.copy2(portable, SITE_DOWNLOAD / "XiaoyinMarkdown-portable.exe")
        (SITE_DOWNLOAD / "XiaoyinMarkdown-portable.exe").chmod(0o644)

    # ③ 升级清单（站点 + 仓库各存一份，方便回滚）
    body = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (SITE_UPDATE / "latest.json").write_text(body, encoding="utf-8")
    (SITE / "update").mkdir(parents=True, exist_ok=True)
    (SITE / "update" / "latest.json").write_text(body, encoding="utf-8")

    # ④ 稳定别名：官网页固定链到 latest-setup.exe，发版不用改 HTML
    for alias, real in (("latest-setup.exe", setup.name), ("latest-portable.exe", "XiaoyinMarkdown-portable.exe")):
        link = SITE_DOWNLOAD / alias
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(real)

    print(f"\n  ✅ 已发布：{BASE_URL}/update/latest.json")
    print(f"  ✅ 稳定别名：{BASE_URL}/download/latest-setup.exe")
    print(f"  ✅ 安装包：{url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
