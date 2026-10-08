"""生成站点字典 stations.json

拉取 12306 station_name.js，解析为：
  { "source": ..., "count": N, "stations": [{name, code, pinyin, abbr, city}] }

用法：
  python scripts/gen_stations.py            # 输出到 frontend/public/stations.json
  python scripts/gen_stations.py out.json   # 输出到指定路径

站数 < 2000 视为异常，脚本报错退出（防止上游返回异常数据污染字典）。
"""
import json
import re
import sys
import urllib.request

SOURCE_URL = "https://kyfw.12306.cn/otn/resources/js/framework/station_name.js"
MIN_STATIONS = 2000


def fetch_station_js() -> str:
    req = urllib.request.Request(
        SOURCE_URL,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0",
            "Referer": "https://kyfw.12306.cn/otn/leftTicket/init",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def parse(station_js: str):
    """station_name.js 格式：@bjb|北京北|VAP|beijingbei|bjb|0|0357|北京|||...

    字段：[1]站名 [2]电报码 [3]全拼 [4]拼音缩写 [7]城市
    """
    stations = []
    for m in re.finditer(r"@([^@]+)", station_js):
        fields = m.group(1).split("|")
        if len(fields) < 8:
            continue
        stations.append(
            {
                "name": fields[1],
                "code": fields[2],
                "pinyin": fields[3],
                "abbr": fields[4],
                "city": fields[7],
            }
        )
    return stations


def main() -> None:
    out_path = sys.argv[1] if len(sys.argv) > 1 else "frontend/public/stations.json"

    print("拉取", SOURCE_URL)
    stations = parse(fetch_station_js())

    if len(stations) < MIN_STATIONS:
        print(f"异常：仅解析到 {len(stations)} 站（<{MIN_STATIONS}），中止写入")
        sys.exit(1)

    data = {
        "source": SOURCE_URL,
        "count": len(stations),
        "stations": stations,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    cities = len({s["city"] for s in stations})
    print(f"完成：{len(stations)} 站 / {cities} 城市 -> {out_path}")


if __name__ == "__main__":
    main()
