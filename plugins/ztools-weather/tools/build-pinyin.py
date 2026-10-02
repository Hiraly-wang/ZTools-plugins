# -*- coding: utf-8 -*-
"""生成 cities-pinyin.json：全国城市拼音索引（供插件本地模糊检索，不依赖任何网络接口）。

数据源：https://github.com/88250/city-geo  (data.json，中国城市县区经纬度)
拼音转换：pypinyin

用法：
    python3 tools/build-pinyin.py                 # 从 data.json 生成
    python3 tools/build-pinyin.py src.json out.json

产物（提交进仓库，插件离线可用）：
    cities-pinyin.json  形如
        {"n":"成都","p":"chengdu","i":"cd","l":"四川","a":30.65,"o":104.08,"r":90}
      n=城市名  p=全拼  i=拼音首字母  l=省份  a=lat  o=lng  r=知名度排名

    r（rank）为什么必须有：拼音首字母有天然歧义——「cd」同时命中
    成都(chengdu) / 承德(chengdu) / 常德(changde) / 昌都(changdou) 四个城市。
    光看字母分不出用户要找哪个，只能靠「知名度」把大概率的那个排到前面。
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.normpath(os.path.join(HERE, ".."))
DEFAULT_SRC = os.path.join(HERE, "city-geo-data.json")
DEFAULT_OUT = os.path.join(PLUGIN, "cities-pinyin.json")

# 「市辖区」「省直辖县级行政区划」这类不是城市，剔除
JUNK = {"市辖区", "省直辖县级行政区划", "县", "市", "区"}

# 知名度分档：直辖市 100 > 省会/首府 90 > 其他地级市 50（按拼音长度微调，纯 tie-break）
MUNICIPALITY = {"北京", "上海", "天津", "重庆"}
CAPITALS = {
    "石家庄", "太原", "呼和浩特", "沈阳", "长春", "哈尔滨", "南京", "杭州", "合肥",
    "福州", "南昌", "济南", "郑州", "武汉", "长沙", "广州", "南宁", "海口", "成都",
    "贵阳", "昆明", "拉萨", "西安", "兰州", "西宁", "银川", "乌鲁木齐", "台北",
}


def rank_of(name, pinyin):
    if name in MUNICIPALITY:
        return 100
    if name in CAPITALS:
        return 90
    # 同分时用拼音短的略靠前（纯 tie-break，不影响主要排序）
    return 50 - len(pinyin or "") * 0.1


def norm_name(raw):
    """成都市 → 成都；重庆市 → 重庆；保持少数民族自治州的全称（带州不加后缀）。"""
    n = (raw or "").strip()
    if not n or n in JUNK:
        return ""
    # 已经有后缀的（自治州/地区/盟/自治县）保留
    if n.endswith(("自治州", "地区", "盟", "自治县")):
        return n
    return re.sub(r"(市|地区|盟)$", "", n)


def norm_province(raw):
    p = (raw or "").strip()
    return re.sub(r"(省|市|自治区|特别行政区)$", "", p) or p


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    out = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    if not os.path.exists(src):
        raise SystemExit("找不到源数据: " + src)

    from pypinyin import pinyin, Style

    with open(src, encoding="utf-8") as f:
        raw = json.load(f)

    seen = {}
    for r in raw:
        # 直辖市（北京/上海/天津/重庆）在源数据里 city 叫「市辖区」，真正的名字在 province。
        # 漏了这一步，四个直辖市 + 所有直辖区的条目会全部丢失（拼音搜「bj」就没反应）。
        city_raw = (r.get("city") or "").strip()
        prov_raw = (r.get("province") or "").strip()
        if city_raw in ("市辖区", "县"):
            if prov_raw.endswith("市"):
                name = norm_name(prov_raw)          # 北京市 → 北京
            else:
                continue
        else:
            name = norm_name(city_raw)
        if not name:
            continue
        try:
            lat = float(r.get("lat"))
            lng = float(r.get("lng"))
        except (TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        # 同一个城市名可能多条（不同 area），取第一条有效坐标
        if name in seen:
            continue
        full = "".join(x[0] for x in pinyin(name, style=Style.NORMAL))
        init = "".join(x[0] for x in pinyin(name, style=Style.FIRST_LETTER))
        seen[name] = {
            "n": name,
            "p": full,
            "i": init,
            "l": norm_province(r.get("province")),
            "a": round(lat, 4),
            "o": round(lng, 4),
            "r": rank_of(name, full),
        }

    cities = sorted(seen.values(), key=lambda x: x["n"])
    with open(out, "w", encoding="utf-8") as f:
        json.dump(cities, f, ensure_ascii=False, separators=(",", ":"))
    print("cities written:", out, len(cities), "cities,", os.path.getsize(out), "bytes")

    print("  歧义检查（2 字母首字母撞车的城市，插件靠 rank 排序）：")
    by_init = {}
    for c in cities:
        by_init.setdefault(c["i"], []).append(c)
    for k, v in sorted(by_init.items()):
        if len(v) > 1 and len(k) <= 2:
            v = sorted(v, key=lambda c: -c["r"])
            print("   ", k, "→", " / ".join(c["n"] + "(" + str(c["r"]) + ")" for c in v))
    print()
    for probe in ("成都", "北京", "上海", "重庆", "西安", "哈尔滨", "呼和浩特", "南阳"):
        hit = [c for c in cities if c["n"] == probe]
        print("  ", probe, "→", json.dumps(hit[0], ensure_ascii=False) if hit else "MISSING")


if __name__ == "__main__":
    main()
