# -*- coding: utf-8 -*-
"""生成 tests/ui-harness.html：把 index.html 复制一份，在 app.js 之前注入 fixture.js。

用法：python3 tools/build-harness.py
然后用浏览器打开 tests/ui-harness.html 跑 tests/test-ui.js（浏览器控制台）。
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))          # .../tools
PLUGIN = os.path.normpath(os.path.join(HERE, ".."))        # 插件根
TESTS = os.path.join(PLUGIN, "tests")                      # tests/ 目录
SRC = os.path.join(PLUGIN, "index.html")
OUT = os.path.join(TESTS, "ui-harness.html")

with open(SRC, encoding="utf-8") as f:
    html = f.read()

# 夹具必须在 app.js 之前加载（app.js 启动时就要能拿到 window.services）
needle = '<script src="app.js"></script>'
if needle not in html:
    raise SystemExit("index.html 里找不到 " + needle)
html = html.replace(needle, '<script src="fixture.js"></script>\n  ' + needle, 1)

# harness 落在 tests/ 下。直接把 fixture/app/test-ui 三个 js 内联进 HTML，
# 理由有二：
#   1. file:// 下外链脚本的加载/执行在这个浏览器里时好时坏，症状是「app.js 跑了、fixture.js 没跑」，
#      window.services 是 undefined，boot() 在 DOMContentLoaded 时抛错，控制台 message 是空的——查不动。
#   2. 内联还能在最前面装 window.onerror 收集器，把真实异常文本抓出来。
# 所以：资源路径改成 ../，脚本全部内联，外面包 try/catch 记 __errs。
html = html.replace('href="style.css"', 'href="../style.css"')
html = html.replace('src="logo.png"', 'src="../logo.png"')

import re
html = re.sub(r'\s*<script src="(?:app|fixture|test-ui)\.js"></script>', '', html)

parts = ['<script>',
         'window.__errs = [];',
         'window.addEventListener("error", function (e) {',
         '  window.__errs.push((e.message || "?") + " @ " + String(e.filename || "?").split("/").pop() + ":" + (e.lineno || 0));',
         '}, true);',
         '</script>']
app_src = ""
for name in ('fixture.js', 'app.js', 'test-ui.js'):
    src_path = os.path.join(TESTS, name) if name in ('test-ui.js', 'fixture.js') else os.path.join(PLUGIN, name)
    with open(src_path, encoding='utf-8') as f:
        src = f.read()
    if '</script' in src:
        raise SystemExit(name + ' 含有 </script>，内联会被截断')
    if name == 'app.js':
        # test-ui.js 要读 app.js 源码做静态检查（同名函数重复定义护栏）。
        # file:// 下 fetch 拿不到外链，所以直接把源码以 JSON 字符串塞进全局。
        app_src = json.dumps(src, ensure_ascii=False)
    parts.append('<script>/* ---- ' + name + ' ---- */\ntry {\n' + src + '\n} catch (err) {\n'
                 '  window.__errs.push("[' + name + '] " + (err && err.message ? err.message : String(err)));'
                 '\n  if (err && err.stack) window.__errs.push(String(err.stack).split("\\n").slice(0,4).join(" | "));'
                 '\n}\n</script>')
# app.js 源码要在 test-ui.js 运行前就绪（file:// 下 fetch 拿不到外链，只能内联）
parts.append('<script>window.__appSrc = ' + app_src + ';</script>')
html = html.replace("</body>", "\n  ".join(parts) + "\n</body>", 1)

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)

print("harness written:", OUT, os.path.getsize(OUT), "bytes")
