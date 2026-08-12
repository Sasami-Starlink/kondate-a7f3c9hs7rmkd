// ===== 主菜に合う副菜を提案（味のバランス＋彩り） =====
// 主菜詳細で 5品の副菜を提案：
//   ・2品 = 味のバランス（こってり主菜→さっぱり副菜／さっぱり主菜→濃いめ副菜）
//   ・1品 = おまかせ（ランダム）
//   ・1品 = 彩り野菜（緑黄色野菜・なす系）
//   ・1品 = いも・大根系
// 開くたびに候補が変わる。

// ---- 主菜のこってり/さっぱり判定 ----
const SAPPARI_MAIN = ["レモン", "塩", "ポン酢", "梅", "大葉", "しそ", "さっぱり", "おろし",
  "ゆず", "ハーブ", "ナゲット", "冷し", "冷製", "蒸し", "サラダチキン"];
const KOTTERI_MAIN = ["マヨ", "グラタン", "うまタレ", "うま辛", "照り", "甘辛", "チーズ", "バター",
  "クリーム", "揚げ", "フライ", "唐揚", "から揚", "竜田", "ガーリック", "にんにく", "カレー",
  "こってり", "味噌", "南蛮", "スタミナ", "ハンバーグ", "角煮", "こく", "濃厚"];

function classifyMainRichness(main) {
  const hay = (main.title || "") + " " + (main.tags || []).join(" ") + " " + (main.genre || "");
  if (SAPPARI_MAIN.some((k) => hay.includes(k))) return "sappari";
  if (KOTTERI_MAIN.some((k) => hay.includes(k))) return "kotteri";
  return "neutral";
}

// ---- 副菜のさっぱり/濃いめ判定 ----
const SAPPARI_SIDE = ["浅漬", "サラダ", "マリネ", "酢", "ポン酢", "レモン", "おひたし", "お浸し",
  "ピクルス", "梅", "ゆず", "冷や", "さっぱり", "浅づけ", "塩もみ"];
const KOI_SIDE = ["ナムル", "醤油漬", "しょうゆ漬", "甘辛", "味噌", "キムチ", "うまタレ", "うま辛",
  "ラー油", "コチュジャン", "ザーサイ", "ピリ辛", "にんにく", "バター", "無限", "やみつき", "おかか"];

function sideRichness(side) {
  const hay = (side.title || "") + " " + (side.tags || []).join(" ");
  if (SAPPARI_SIDE.some((k) => hay.includes(k))) return "sappari";
  if (KOI_SIDE.some((k) => hay.includes(k))) return "koi";
  return "neutral";
}

// ---- 副菜の野菜カテゴリ ----
const GREEN_VEG = ["なす", "ナス", "茄子", "ピーマン", "パプリカ", "トマト", "にんじん", "人参",
  "ブロッコリー", "ほうれん草", "小松菜", "かぼちゃ", "南瓜", "オクラ", "いんげん", "アスパラ",
  "ズッキーニ", "ゴーヤ", "ニラ", "春菊", "チンゲン"]; // ※チンゲンは元々除外
const ROOT_VEG = ["じゃがいも", "ジャガ", "ポテト", "大根", "だいこん", "里芋", "さつまいも",
  "かぶ", "ごぼう", "れんこん", "蓮根", "長芋", "山芋", "セロリ"];

function sideVeg(side) {
  const hay = (side.title || "") + " " + (side.tags || []).join(" ");
  if (GREEN_VEG.some((k) => hay.includes(k))) return "green";
  if (ROOT_VEG.some((k) => hay.includes(k))) return "root";
  return "other";
}

// お菓子・パン・主食は副菜として扱わない（分類ミス除去）
const NON_SIDE = ["クッキー", "ケーキ", "スイーツ", "プリン", "ゼリー", "タルト", "マフィン",
  "ドーナツ", "スコーン", "チョコ", "アイス", "パフェ", "ヨーグルト", "デザート", "ジャム",
  "コンポート", "茶巾", "レーズン", "焼き菓子", "カステラ", "蒸しパン", "マドレーヌ", "ビスケット",
  "ラスク", "ホットケーキ", "パンケーキ", "フレンチトースト", "クレープ", "どら焼き", "大福",
  "食パン", "菓子パン", "トースト", "サンドイッチ", "バゲット", "バケット",
  "丼", "チャーハン", "ピラフ", "リゾット", "パスタ", "スパゲ", "うどん", "そば", "そうめん",
  "ラーメン", "焼きそば", "おにぎり", "カレーライス", "ライス", "オムライス", "ドリア",
  "炊き込み", "雑炊", "おこわ", "混ぜご飯", "混ぜごはん", "ガパオ", "そぼろ丼"];
function isRealSide(r) {
  const h = (r.title || "") + " " + (r.tags || []).join(" ");
  return !NON_SIDE.some((k) => h.includes(k));
}

// ---- 5品を選ぶ ----
function suggestSides(main) {
  const pool = POOL.filter((r) => r.type === "side" && r.id !== main.id && isRealSide(r) &&
    (typeof passesExclude === "function" ? passesExclude(r) : true));
  const mainR = classifyMainRichness(main);
  const wantSide = mainR === "kotteri" ? "sappari" : (mainR === "sappari" ? "koi" : "sappari");
  const used = new Set();
  const chosen = [];
  const take = (cands, reason, rkey) => {
    for (const c of shuffle(cands.slice())) {
      if (!used.has(c.id)) { used.add(c.id); chosen.push({ id: c.id, source: c.source, title: c.title, reason, rkey }); return true; }
    }
    return false;
  };
  const rlabel = wantSide === "sappari" ? "さっぱり" : "濃いめ";
  // ①② 味のバランス（2品）
  const ruleCands = pool.filter((s) => sideRichness(s) === wantSide);
  take(ruleCands, rlabel, "rule");
  take(ruleCands, rlabel, "rule");
  // ③ おまかせ
  take(pool, "おまかせ", "omakase");
  // ④ 彩り野菜（緑黄色・なす）
  take(pool.filter((s) => sideVeg(s) === "green"), "彩り野菜", "green");
  // ⑤ いも・大根系
  take(pool.filter((s) => sideVeg(s) === "root"), "いも・大根", "root");
  // 足りなければ補完
  while (chosen.length < 5) { if (!take(pool, "おまかせ", "omakase")) break; }
  return { sides: chosen.slice(0, 5), mainR, wantSide };
}

function renderPairedSides(main) {
  const { sides, mainR } = suggestSides(main);
  if (!sides.length) return "";
  const head = mainR === "kotteri"
    ? "こってり主菜なので、さっぱり副菜を中心に"
    : mainR === "sappari"
      ? "さっぱり主菜なので、濃いめ副菜を中心に"
      : "この主菜に合いそうな副菜";
  const rows = sides.map((s) => {
    const t = s.title.length > 24 ? s.title.slice(0, 24) + "…" : s.title;
    return `<div class="pair-row" onclick="openDetail('${s.id}')">
      <span class="pair-reason r-${s.rkey}">${s.reason}</span>
      <span class="pair-main">${badge(s.source)}<b>${escapeHtml(t)}</b></span>
      <span class="pair-arrow">→</span>
    </div>`;
  }).join("");
  return `<div class="card pair-card">
    <h3 class="sec">🥗 合う副菜 5品</h3>
    <p class="mini" style="margin-top:-4px">${head}</p>
    ${rows}
    <p class="mini">タップで副菜レシピへ。開くたびに候補が変わります。</p>
  </div>`;
}
