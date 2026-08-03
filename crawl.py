#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
献立アプリ用クローラー
------------------------------------------------------------
規定サイトを定期的に収集して recipes.json を生成/更新します。
- リュウジ(bazurecipe.com)  : WordPress REST API (wp-json)
- だれウマ(yassu-cooking.com): はてなブログ フィード
- Nadia(oceans-nadia.com)    : sitemap + ページのJSON-LD
- クラシル(kurashiru.com)     : sitemap + ページのJSON-LD

方針（著作権・規約に配慮）:
- どのサイトも「タイトル＋本家URL＋マッチング用の材料タグ」だけを保存し、
  手順本文はアプリに保存しません（本家リンクへ誘導）。
- robots.txt で禁止されたパス(/search, /api 等)は取得しません。
- 1件ごとに待機(レート制限)。個人利用を表明したUser-Agent。
- 実行するたびに既存 recipes.json とマージ(URLで重複排除)して蓄積します。
  → レシピが増え、毎回同じ提案になりません。

使い方:
    python3 crawl.py                # 既定件数で収集しマージ
    python3 crawl.py --fresh        # 既存を無視して作り直し
標準ライブラリのみで動作します。
"""

import urllib.request, urllib.error
import socket, re, json, html, time, gzip, io, random, sys, os

socket.setdefaulttimeout(15)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "recipes.json")
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 kondate-personal-use (non-commercial)"}
SLEEP = 0.5  # 秒。サイトに負荷をかけないための待機

# ---- 収集件数（お好みで調整）----
LIMITS = {
    "リュウジ": 150,   # wp-json から新着順
    "だれウマ": 80,    # sitemap経由（過去記事まで）
    "Nadia": 100,      # sitemapからランダム抽出
    "クラシル": 100,   # sitemapからランダム抽出
}

# ========== フィルタ設定（自由に編集可） ==========
# 絶対に除外（嫌いな人がいる素材）
EXCLUDE_HARD = [
    "ほたて", "帆立", "ホタテ",
    "いか", "イカ", "烏賊", "するめ",
    "チンゲン", "青梗菜",
    "きのこ", "キノコ", "茸", "しめじ", "シメジ", "えのき", "エノキ",
    "舞茸", "まいたけ", "マイタケ", "エリンギ", "しいたけ", "椎茸",
    "マッシュルーム", "なめこ", "ヒラタケ",
]
# コスト/用途で除外（牛肉・魚介）。※15人分想定のため。個人で許容するなら空にしてOK
EXCLUDE_COST = [
    "牛", "ビーフ",
    "鮭", "さけ", "サーモン", "さば", "サバ", "鯖", "ぶり", "ブリ", "鰤",
    "まぐろ", "マグロ", "鮪", "あじ", "アジ", "いわし", "イワシ", "たら", "タラ", "鱈",
    "えび", "エビ", "海老", "かに", "カニ", "蟹", "たこ", "タコ", "蛸",
    "あさり", "しじみ", "貝", "白身魚", "刺身", "切り身",
]
# 手間がかかる調理（包む・巻く・成形）で除外
EXCLUDE_EFFORT = [
    "餃子", "ぎょうざ", "ギョーザ", "焼売", "シュウマイ", "しゅうまい",
    "春巻", "生春巻", "ロールキャベツ", "肉巻き", "ロールカツ", "つくね",
    "包み", "包む", "成形",
]
# お菓子・デザート・パンは献立(おかず)ではないので除外
EXCLUDE_SWEETS = [
    "クッキー", "ケーキ", "スイーツ", "プリン", "ゼリー", "タルト", "マフィン",
    "ドーナツ", "スコーン", "チョコ", "アイス", "パフェ", "デザート", "ジャム",
    "コンポート", "焼き菓子", "カステラ", "蒸しパン", "マドレーヌ", "ビスケット",
    "ラスク", "ホットケーキ", "パンケーキ", "フレンチトースト", "クレープ",
    "どら焼き", "大福", "ムース", "ティラミス", "スムージー",
]

# ========== 素材タグ（マッチング用） ==========
# (タグ表示名, [その素材とみなすキーワード])
TAGS = [
    ("豚こま",  ["豚こま", "豚コマ", "豚小間"]),
    ("豚肉",    ["豚バラ", "豚ロース", "豚肉", "豚ひき", "豚ミンチ"]),
    ("鶏むね",  ["鶏むね", "鶏胸", "むね肉", "ムネ肉"]),
    ("鶏もも",  ["鶏もも", "鶏モモ", "もも肉", "モモ肉"]),
    ("鶏肉",    ["鶏肉", "とり肉", "手羽", "ささみ", "ササミ"]),
    ("ひき肉",  ["ひき肉", "挽き肉", "ミンチ", "合いびき", "合挽"]),
    ("ベーコン", ["ベーコン"]),
    ("ウインナー", ["ウインナー", "ソーセージ"]),
    ("卵",      ["卵", "たまご", "玉子"]),
    ("豆腐",    ["豆腐", "厚揚げ", "油揚げ"]),
    ("ピーマン", ["ピーマン", "パプリカ"]),
    ("もやし",  ["もやし", "モヤシ"]),
    ("キャベツ", ["キャベツ"]),
    ("なす",    ["なす", "ナス", "茄子"]),
    ("じゃがいも", ["じゃがいも", "ジャガイモ", "馬鈴薯", "ポテト"]),
    ("玉ねぎ",  ["玉ねぎ", "玉葱", "たまねぎ", "タマネギ"]),
    ("にんじん", ["にんじん", "人参"]),
    ("大根",    ["大根", "だいこん"]),
    ("トマト",  ["トマト"]),
    ("きゅうり", ["きゅうり", "胡瓜"]),
    ("白菜",    ["白菜", "はくさい"]),
    ("ブロッコリー", ["ブロッコリー"]),
    ("パスタ",  ["パスタ", "スパゲ", "スパゲッティ", "マカロニ"]),
    ("うどん",  ["うどん"]),
    ("ごはん",  ["ごはん", "ご飯", "米", "ライス"]),
]

# 副菜寄りのキーワード
SIDE_HINT = ["サラダ", "ナムル", "和え", "あえ", "漬け", "浅漬", "無限", "おつまみ",
             "副菜", "きんぴら", "マリネ", "酢の物", "ピクルス", "おひたし", "浸し"]
# 主菜寄り（たんぱく質）
MAIN_HINT = ["豚", "鶏", "とり", "ひき肉", "挽き", "ミンチ", "ベーコン", "ソーセージ",
             "ウインナー", "厚揚げ", "豆腐", "卵", "ステーキ", "唐揚げ", "から揚げ",
             "生姜焼き", "炒め", "カレー", "タコライス", "ハンバーグ", "チキン", "ポーク"]

GENRE = [
    ("洋", ["チーズ", "バター", "コンソメ", "ケチャップ", "オリーブ", "ベーコン",
            "トマト缶", "ホールトマト", "パスタ", "グラタン", "ガーリック", "マヨ"]),
    ("中", ["豆板醤", "オイスター", "鶏がら", "中華", "麻婆", "ラー油", "甜麺醤", "花椒"]),
    ("韓", ["コチュジャン", "ナムル", "キムチ", "チゲ", "プルコギ", "ヤンニョム"]),
]


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        if url.endswith(".gz"):
            raw = gzip.decompress(raw)
        return raw if binary else raw.decode("utf-8", "replace")


def strip_html(s):
    s = re.sub(r"<script.*?</script>", " ", s, flags=re.S)
    s = re.sub(r"<style.*?</style>", " ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    return html.unescape(s)


def jsonld_recipe(page_html):
    """ページHTMLから schema.org Recipe の name と recipeIngredient を返す"""
    blocks = re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>',
                        page_html, re.S)
    for b in blocks:
        try:
            data = json.loads(b.strip())
        except Exception:
            continue
        objs = data if isinstance(data, list) else [data]
        for o in list(objs):
            if isinstance(o, dict) and "@graph" in o:
                objs += o["@graph"]
        for o in objs:
            if isinstance(o, dict) and "Recipe" in str(o.get("@type", "")):
                name = o.get("name")
                ings = o.get("recipeIngredient") or o.get("ingredients") or []
                if isinstance(ings, str):
                    ings = [ings]
                total = o.get("totalTime") or o.get("cookTime")
                return name, ings, iso_minutes(total)
    return None, [], None


def iso_minutes(v):
    if not v or not isinstance(v, str):
        return None
    m = re.search(r'PT(?:(\d+)H)?(?:(\d+)M)?', v)
    if not m:
        return None
    h = int(m.group(1) or 0); mi = int(m.group(2) or 0)
    total = h * 60 + mi
    return total or None


def excluded(text):
    for kw in EXCLUDE_HARD + EXCLUDE_COST + EXCLUDE_EFFORT + EXCLUDE_SWEETS:
        if kw in text:
            return kw
    return None


def make_tags(text):
    found = []
    for tag, kws in TAGS:
        if any(k in text for k in kws):
            found.append(tag)
    return found


def classify_type(title, text):
    for h in SIDE_HINT:
        if h in title:
            return "side"
    has_main = any(h in text for h in MAIN_HINT)
    for h in SIDE_HINT:
        if h in text and not has_main:
            return "side"
    return "main" if has_main else "side"


def guess_genre(text):
    for g, kws in GENRE:
        if any(k in text for k in kws):
            return g
    return "和"


def build_entry(source, title, url, date, text, minutes=None, exclude_text=None):
    """共通の正規化。除外に該当すれば None を返す。
    exclude_text を渡すとその文字列だけで除外判定する（例: だれウマはタイトルのみ）。"""
    title = (title or "").strip()
    if not title or not url:
        return None
    et = exclude_text if exclude_text is not None else (title + " " + text)
    hit = excluded(et)
    if hit:
        return None
    tags = make_tags(title + " " + text)
    entry = {
        "id": source[:2] + "-" + re.sub(r'\W+', '', url)[-16:],
        "source": source,
        "title": title,
        "url": url,
        "date": (date or "")[:10],
        "type": classify_type(title, title + " " + text),
        "genre": guess_genre(title + " " + text),
        "tags": tags,
        "time": (f"約{minutes}分" if minutes else None),
        "mode": "link",
    }
    return entry


# ---------------- 各サイト ----------------
def crawl_ryuji(limit):
    print("[リュウジ] wp-json 収集中...")
    out = []
    per = 100
    page = 1
    while len(out) < limit:
        url = ("https://bazurecipe.com/wp-json/wp/v2/posts"
               f"?per_page={per}&page={page}&_fields=title,link,date,content")
        try:
            data = json.loads(fetch(url))
        except Exception as e:
            print("  停止:", e); break
        if not data:
            break
        for p in data:
            title = html.unescape(strip_html(p.get("title", {}).get("rendered", "")))
            link = p.get("link", "")
            date = p.get("date", "")
            body = strip_html(p.get("content", {}).get("rendered", ""))[:1500]
            e = build_entry("リュウジ", title, link, date, body)
            if e:
                out.append(e)
            if len(out) >= limit:
                break
        page += 1
        time.sleep(SLEEP)
    print(f"  取得 {len(out)} 件")
    return out


def locs_of(xml):
    return [html.unescape(u) for u in
            re.findall(r"<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</loc>", xml)]


def sitemap_urls(index_url, recipe_pat, sub_pat="sitemap|recipes"):
    idx = fetch(index_url)
    subs = [u for u in locs_of(idx) if re.search(sub_pat, u)]
    urls = []
    for s in subs:
        try:
            body = fetch(s)
        except Exception:
            continue
        urls += [u for u in locs_of(body) if re.search(recipe_pat, u)]
        if len(urls) > 60000:
            break
    return urls


def crawl_dareuma(limit):
    """だれウマ（はてなブログ）: sitemapで過去記事まで辿り、各ページから取得。
    サイドバーの無関係な語での誤除外を避けるため、除外判定はタイトルのみで行う。"""
    print("[だれウマ] sitemap収集中...")
    out = []
    try:
        idx = fetch("https://www.yassu-cooking.com/sitemap_index.xml")
    except Exception as e:
        print("  sitemap失敗:", e); return out
    entry_urls = []
    for s in locs_of(idx):
        if "sitemap" not in s:
            continue
        try:
            entry_urls += [u for u in locs_of(fetch(s)) if "/entry/" in u]
        except Exception:
            continue
    seen = set()
    entry_urls = [u for u in entry_urls if not (u in seen or seen.add(u))]
    tried = 0
    for u in entry_urls:
        if len(out) >= limit or tried >= limit * 4:
            break
        tried += 1
        try:
            page = fetch(u)
        except Exception:
            continue
        m = re.search(r'property=["\']og:title["\']\s+content=["\'](.*?)["\']', page)
        title = html.unescape(m.group(1)) if m else ""
        title = re.sub(r"\s*[-|]\s*だれウマ.*$", "", title).strip()
        d = re.search(r"/entry/(\d{4})/(\d{2})/(\d{2})/", u)
        date = "-".join(d.groups()) if d else ""
        # 本文（entry-content）だけをタグ抽出に使う。なければページ全体の先頭。
        mc = re.search(r'entry-content[^>]*>(.*)', page, re.S)
        text = strip_html(mc.group(1)[:8000] if mc else page[:8000])[:3000]
        e = build_entry("だれウマ", title, u, date, text, exclude_text=title)
        if e:
            out.append(e)
        time.sleep(SLEEP)
    print(f"  取得 {len(out)} 件（試行 {tried}）")
    return out


def crawl_jsonld_site(source, index_url, recipe_pat, limit):
    print(f"[{source}] sitemap収集中...")
    out = []
    try:
        urls = sitemap_urls(index_url, recipe_pat)
    except Exception as e:
        print("  sitemap失敗:", e); return out
    if not urls:
        print("  URLなし"); return out
    random.shuffle(urls)  # 毎回違うレシピを拾う
    tried = 0
    for u in urls:
        if len(out) >= limit or tried >= limit * 4:
            break
        tried += 1
        try:
            page = fetch(u)
        except Exception:
            continue
        name, ings, minutes = jsonld_recipe(page)
        if not name:
            continue
        text = name + " " + " ".join(ings)
        e = build_entry(source, name, u, None, text, minutes)
        if e:
            out.append(e)
        time.sleep(SLEEP)
    print(f"  取得 {len(out)} 件（試行 {tried}）")
    return out


def main():
    fresh = "--fresh" in sys.argv
    collected = []
    collected += crawl_ryuji(LIMITS["リュウジ"])
    collected += crawl_dareuma(LIMITS["だれウマ"])
    collected += crawl_jsonld_site(
        "Nadia", "https://oceans-nadia.com/sitemap/sitemapindex.xml",
        r"/user/\d+/recipe/\d+$", LIMITS["Nadia"])
    collected += crawl_jsonld_site(
        "クラシル", "https://www.kurashiru.com/sitemap.xml",
        r"/recipes/[0-9a-f-]{16,}$", LIMITS["クラシル"])

    # 既存とマージ（URLで重複排除）
    existing = []
    if os.path.exists(OUT) and not fresh:
        try:
            existing = json.load(open(OUT, encoding="utf-8")).get("recipes", [])
        except Exception:
            existing = []
    by_url = {r["url"]: r for r in existing}
    added = 0
    for r in collected:
        if r["url"] not in by_url:
            added += 1
        by_url[r["url"]] = r
    recipes = list(by_url.values())

    payload = {
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(recipes),
        "bySource": {s: sum(1 for r in recipes if r["source"] == s)
                     for s in LIMITS},
        "recipes": recipes,
    }
    json.dump(payload, open(OUT, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"\n✅ recipes.json 書き出し: 合計 {len(recipes)} 件（今回追加 {added} 件）")
    print("   内訳:", payload["bySource"])


if __name__ == "__main__":
    main()
