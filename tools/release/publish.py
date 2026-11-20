#!/usr/bin/env python3
"""把三端构建产物发布到官网，并生成/合并升级清单。

用法：
    python3 tools/release/publish.py --notes-file notes.txt          # 自动扫描全部产物
    python3 tools/release/publish.py --notes "一句话" --dry-run

自动识别（存在哪些就发哪些，都按平台归位）：
  Windows  target/x86_64-pc-windows-gnu/release/bundle/nsis/*x64-setup.exe
  Linux    target/release/bundle/{appimage/*.AppImage, deb/*.deb}
  macOS    target/<triple>/release/bundle/{macos/*.app.tar.gz, dmg/*.dmg}

升级清单是**合并**的：只更新这次扫到的平台，其它平台的条目原样保留
（这样在 Windows 上发版不会把 macOS 的那条冲掉）。

客户端拉取：https://xymd.wangjinding.com/update/latest.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform as _py_platform
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
SITE_ROOT = Path("/opt/1panel/www/sites/<域名>/index")
SITE_DOWNLOAD = SITE_ROOT / "download"
SITE_UPDATE = SITE_ROOT / "update"
BASE_URL = "https://xymd.wangjinding.com"
TARGETS = ROOT / "src-tauri" / "target"


def conf_version() -> str:
    d = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))
    return d["version"]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_one(patterns: list[str]) -> Path | None:
    for pat in patterns:
        hits = sorted(TARGETS.glob(pat), key=lambda p: p.stat().st_mtime, reverse=True)
        if hits:
            return hits[0]
    return None



def artifact_version(path: Path) -> str | None:
    """从文件名里抠出构建版本，如 XiaoyinMarkdown_2.6.6_x64-setup.exe → 2.6.6"""
    m = re.search(r"_(\d+\.\d+\.\d+)", path.name)
    return m.group(1) if m else None


def collect():
    """返回 [{platform, artifact, sig, dl_name}]，只包含本机实际构建出来的。

    只收**版本号对得上**的产物 —— 否则上一版留在 target/ 里的旧包会被
    改名成新版本发出去（清单写新版本、二进制还是旧版，升级会静默失败）。
    """
    found = []
    want = conf_version()

    # ── Windows ──
    exe = find_one([
        "x86_64-pc-windows-gnu/release/bundle/nsis/*_x64-setup.exe",
        "release/bundle/nsis/*_x64-setup.exe",
    ])
    if exe:
        found.append({"platform": "windows-x86_64", "artifact": exe, "sig": Path(str(exe) + ".sig"), "ext": ".exe"})

    # ── Linux（updater 只认 AppImage，deb 额外给人手装）──
    appimg = find_one(["release/bundle/appimage/*.AppImage", "*/release/bundle/appimage/*.AppImage"])
    if appimg:
        found.append({"platform": "linux-x86_64", "artifact": appimg, "sig": Path(str(appimg) + ".sig"), "ext": ".AppImage"})
    deb = find_one(["release/bundle/deb/*.deb", "*/release/bundle/deb/*.deb"])
    if deb:
        found.append({"platform": "linux-deb", "artifact": deb, "sig": None, "ext": ".deb"})

    # ── macOS（Intel / Apple Silicon 各一份）──
    for triple, key in (("aarch64-apple-darwin", "darwin-aarch64"), ("x86_64-apple-darwin", "darwin-x86_64")):
        tar = find_one([f"{triple}/release/bundle/macos/*.app.tar.gz",
                        f"*/{triple}/release/bundle/macos/*.app.tar.gz"])
        if tar:
            found.append({"platform": key, "artifact": tar, "sig": Path(str(tar) + ".sig"), "ext": ".app.tar.gz"})
        dmg = find_one([f"{triple}/release/bundle/dmg/*.dmg", f"*/{triple}/release/bundle/dmg/*.dmg"])
        if dmg:
            arch = "aarch64" if "aarch64" in triple else "x64"
            found.append({"platform": f"{key}-dmg", "artifact": dmg, "sig": None, "ext": f"_{arch}.dmg"})

    # 过滤掉版本对不上的旧产物
    kept = []
    for it in found:
        v = artifact_version(it["artifact"])
        if v and v != want:
            print(f"  ⏭  跳过 {it['artifact'].name}（版本 {v} ≠ 当前 {want}）")
            continue
        kept.append(it)
    return kept


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--notes", default="")
    ap.add_argument("--notes-file", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if args.notes_file:
        args.notes = Path(args.notes_file).read_text(encoding="utf-8").strip()

    version = conf_version()
    items = collect()
    if not items:
        print("❌ 没找到任何构建产物（先跑 `npx tauri build`）", file=sys.stderr)
        return 1

    # 现有清单（合并用）
    manifest_path = SITE_UPDATE / "latest.json"
    manifest = {"version": version, "notes": args.notes or f"小银 Markdown v{version}",
                "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "platforms": {}}
    if manifest_path.exists():
        try:
            old = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["platforms"] = old.get("platforms", {})
        except Exception:
            pass

    print(f"  版本: {version}\n")
    for it in items:
        art: Path = it["artifact"]
        size = art.stat().st_size
        digest = sha256(art)

        # 落地文件名：xymd_<版本>[_arch].<ext>
        if it["platform"] == "windows-x86_64":
            dl = f"xymd_{version}{it['ext']}"
        elif it["platform"] == "linux-x86_64":
            dl = f"xymd_{version}_amd64{it['ext']}"
        elif it["platform"] == "linux-deb":
            dl = f"xymd_{version}_amd64{it['ext']}"
        else:
            dl = f"xymd_{version}{it['ext']}"

        url = f"{BASE_URL}/download/{dl}"
        has_updater = it["sig"] is not None and it["sig"].exists()

        if has_updater:
            entry = {
                "signature": it["sig"].read_text(encoding="utf-8").strip(),
                "url": url,
                "size": size,
                "sha256": digest,
            }
            key = it["platform"]
            manifest["platforms"][key] = entry
            print(f"  ✔ {key:18} {art.name}  {size/1048576:.2f} MB → /download/{dl}")
        else:
            print(f"  · {it['platform']:18} {art.name}  {size/1048576:.2f} MB → /download/{dl}（不上升级清单）")

        if not args.dry_run:
            SITE_DOWNLOAD.mkdir(parents=True, exist_ok=True)
            shutil.copy2(art, SITE_DOWNLOAD / dl)
            (SITE_DOWNLOAD / dl).chmod(0o644)

    if args.dry_run:
        print("\n  [dry-run] 不写入任何文件")
        return 0

    # 写清单：站点 + 仓库各一份
    body = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    SITE_UPDATE.mkdir(parents=True, exist_ok=True)
    (SITE_UPDATE / "latest.json").write_text(body, encoding="utf-8")
    (SITE / "update").mkdir(parents=True, exist_ok=True)
    (SITE / "update" / "latest.json").write_text(body, encoding="utf-8")

    # 稳定别名（官网页 JS 会按版本改名，这些是 JS 被禁时的兜底）
    alias_src = None
    for it in items:
        if it["platform"] == "windows-x86_64":
            alias_src = f"xymd_{version}.exe"
    if alias_src and (SITE_DOWNLOAD / alias_src).exists():
        for alias in ("latest-setup.exe",):
            link = SITE_DOWNLOAD / alias
            if link.is_symlink() or link.exists():
                link.unlink()
            link.symlink_to(alias_src)

    # 官网静态兜底版本号
    idx = SITE / "index.html"
    if idx.exists():
        html = idx.read_text(encoding="utf-8")
        html2 = re.sub(r"(data-ver>)\d+\.\d+\.\d+", lambda m: m.group(1) + version, html)
        if html2 != html:
            idx.write_text(html2, encoding="utf-8")
            if SITE_ROOT.exists():
                shutil.copy2(idx, SITE_ROOT / "index.html")

    print(f"\n  ✅ 清单已更新：{BASE_URL}/update/latest.json（{len(manifest['platforms'])} 个平台）")
    for k in manifest["platforms"]:
        print(f"     · {k}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
