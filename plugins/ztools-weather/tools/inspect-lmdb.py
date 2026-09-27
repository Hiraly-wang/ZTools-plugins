# -*- coding: utf-8 -*-
"""从 ZTools 的 LMDB 文件里读出开发插件注册表，诊断插件为何被当成「无界面插件」。

用法：python3 tools/inspect-lmdb.py
"""
import json
import os
import re
import sys

MDB = os.path.expanduser("~/.ztools/lmdb/device/data.mdb")


def find_value(raw, doc_id):
    """LMDB 里是 {_id, data} 结构，data 后面紧跟 JSON。"""
    key = ('"_id":"%s"' % doc_id).encode("utf-8")
    i = raw.find(key)
    if i < 0:
        return None
    seg = raw[i:i + 40000]
    j = seg.find(b'"data":')
    if j < 0:
        return None
    s = seg[j + 7:].decode("utf-8", "replace")
    depth = 0
    end = None
    instr = False
    esc = False
    for k, ch in enumerate(s):
        if instr:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                instr = False
            continue
        if ch == '"':
            instr = True
        elif ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
            if depth == 0:
                end = k + 1
                break
    if end is None:
        return None
    try:
        return json.loads(s[:end])
    except Exception as e:
        print("  [warn] 解析失败:", e)
        return s[:end]


def main():
    if not os.path.exists(MDB):
        print("找不到", MDB)
        return
    raw = open(MDB, "rb").read()
    data = find_value(raw, "ZTOOLS/dev-plugin-registry")
    if data is None:
        print("没找到 dev-plugin-registry")
        return
    if isinstance(data, str):
        print("原始片段:", data[:2000])
        return
    if isinstance(data, dict):
        # 注册表可能是 {项目名: 配置} 的映射，也可能是数组
        items = [dict(v, _key=k) if isinstance(v, dict) else {"_key": k, "_raw": v}
                 for k, v in data.items()]
    elif isinstance(data, list):
        items = data
    else:
        print("未知结构:", str(data)[:500])
        return
    print("注册了 %d 个开发项目" % len(items))
    for p in items:
        if not isinstance(p, dict):
            continue
        if "weather" not in json.dumps(p, ensure_ascii=False).lower():
            continue
        print("=" * 60)
        print(json.dumps(p, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
