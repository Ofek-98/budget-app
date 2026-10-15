"""Fetch the Bank of Israel interest rate and the Israeli CPI into data/rates.json.

Runs daily from .github/workflows/rates.yml. The app reads the JSON from its own site because
the Bank of Israel API does not allow requests straight from a browser.
"""
import csv
import io
import json
import os
import urllib.request

BOI_SERIES = ("https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BR/1.0/"
              "MNT_RIB_BOI_D?startperiod=2015-01-01&format=csv")
BOI_CURRENT = "https://www.boi.org.il/PublicApi/GetInterest"
CBS_CPI = "https://api.cbs.gov.il/index/data/price?id=120010&format=json&download=false&last=60"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "rates.json")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (budget-app rates updater)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8-sig")


def boi():
    rows = sorted(csv.DictReader(io.StringIO(get(BOI_SERIES))), key=lambda r: r["TIME_PERIOD"])
    changes, last = [], None
    for r in rows:
        rate = float(r["OBS_VALUE"])
        if rate != last:
            changes.append({"date": r["TIME_PERIOD"], "rate": rate})
            last = rate
    out = {"changes": changes, "current": last, "asOf": rows[-1]["TIME_PERIOD"][:7]}
    try:
        cur = json.loads(get(BOI_CURRENT))
        out["current"] = cur.get("currentInterest", last)
        if cur.get("nextInterestDate"):
            out["nextDecision"] = cur["nextInterestDate"][:10]
    except Exception as e:  # the history alone is enough
        print("current-rate endpoint failed:", e)
    return out


def cpi():
    data = json.loads(get(CBS_CPI))
    dates = data["month"][0]["date"]
    return sorted(({"month": f"{d['year']}-{d['month']:02d}", "pct": d["percent"]} for d in dates), key=lambda x: x["month"])


def main():
    try:
        with open(OUT, encoding="utf-8") as f:
            result = json.load(f)
    except FileNotFoundError:
        result = {}
    for key, fn in (("boi", boi), ("cpi", cpi)):
        try:
            result[key] = fn()
        except Exception as e:  # keep the previous value if a source is down
            print(f"{key} failed:", e)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
