#!/usr/bin/env python3
"""
育成モードを「2ファイル構成」（自分のブラウザで直接開く用）として出力する。

career_core.js は ikusei_mode.html に直接埋め込む（別ファイルの<script src>
読み込みが、ブラウザによってはfile://環境で制限されることがあるため）。
js.html（レースエンジン、約2MB）だけは、iframeでの画面遷移という
別の仕組みで読み込むため、サイズの都合上も分けたままにする。

必要なファイルは2つだけ：
  - ikusei_mode.html （育成モード本体。career_core.jsを内包）
  - js.html            （レースエンジン本体）
同じフォルダに置いて ikusei_mode.html を開けば動く。

Claudeのプレビュー枠など iframe が制限される環境では表示できないため、
その場合は career/build_single.py で作る単一ファイル版を使うこと。

使い方: python3 career/build_2files.py [出力先ディレクトリ]
"""
import os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, 'dist_2files')
os.makedirs(out_dir, exist_ok=True)

career_html = open(os.path.join(BASE, 'career/stable_home.html'), encoding='utf-8').read()
core_js     = open(os.path.join(BASE, 'career/career_core.js'),  encoding='utf-8').read()

merged = career_html.replace(
    '<script src="career_core.js"></script>',
    '<script>\n' + core_js + '\n</script>'
)
assert '<script src="career_core.js">' not in merged, "career_core.js の埋め込みに失敗しました"

out_html = os.path.join(out_dir, 'ikusei_mode.html')
open(out_html, 'w', encoding='utf-8').write(merged)

import shutil
out_engine = os.path.join(out_dir, 'js.html')
shutil.copy(os.path.join(BASE, 'js.html'), out_engine)

print(f"built 2-file version in: {out_dir}")
for f in ['ikusei_mode.html', 'js.html']:
    p = os.path.join(out_dir, f)
    print(f"  {f}: {round(os.path.getsize(p)/1024, 1)} KB")
