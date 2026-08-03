// ===== 献立提案アプリ ロジック =====
// ユーザーは「ユーザーさん」と呼ぶ。デフォルト15人分。
// データ = 手検証レシピ(recipes.js の RECIPES / mode:full・材料手順つき)
//        + クロール収集(recipes.json / mode:link・カード＋本家リンク)

const state = {
  step: "welcome",
  type: null,
  picked: [],
  servings: 15,
  currentId: null,
};

let POOL = [];          // 統合レシピ
let LOADED = false;
const app = document.getElementById("app");

const SRC_COLOR = { "リュウジ": "#e8532b", "だれウマ": "#3f9d5a", "Nadia": "#c0489b", "クラシル": "#e0a020" };

// ---------- データ読み込み ----------
async function loadData() {
  // 手検証（詳細つき）
  const curated = (typeof RECIPES !== "undefined" ? RECIPES : []).map((r) => ({
    ...r, source: r.source || "リュウジ", mode: "full", tags: r.ingredientTags || [],
  }));
  let crawled = [];
  try {
    const res = await fetch("./recipes.json", { cache: "no-store" });
    const data = await res.json();
    crawled = (data.recipes || []).map((r) => ({ ...r, mode: r.mode || "link" }));
  } catch (e) {
    // オフライン初回など。手検証分だけで動かす
  }
  // 手検証を優先し、同一URLのクロール重複は除く
  const curatedUrls = new Set(curated.map((r) => r.url));
  crawled = crawled.filter((r) => !curatedUrls.has(r.url));
  POOL = [...curated, ...crawled];
  LOADED = true;
}

// ---------- 分量スケール（full用） ----------
function roundNice(n, unit) {
  if (unit === "g") return Math.max(5, Math.round(n / 5) * 5);
  if (["個", "缶", "枚", "片", "かけ", "本"].includes(unit)) return Math.max(1, Math.round(n));
  return Math.round(n * 2) / 2;
}
function scaleIng(ing, servings, base) {
  const factor = servings / base;
  const val = roundNice(ing.qty * factor, ing.unit);
  const unitFirst = ["大さじ", "小さじ"].includes(ing.unit);
  return { name: ing.name, amount: unitFirst ? `${ing.unit}${val}` : `${val}${ing.unit}` };
}

// ---------- ランダム表示（毎回違う） ----------
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function getShown() {
  try { return new Set(JSON.parse(localStorage.getItem("shownIds") || "[]")); }
  catch (e) { return new Set(); }
}
function markShown(ids) {
  const cur = [...getShown(), ...ids];
  const trimmed = cur.slice(-60); // 直近60件だけ記憶
  localStorage.setItem("shownIds", JSON.stringify(trimmed));
}

// 素材語がレシピに合うか（タグ一致・部分一致・タイトル部分一致）
function matchTerm(r, term) {
  const tags = r.tags || [];
  if (tags.includes(term)) return true;
  if (tags.some((t) => t.includes(term) || term.includes(t))) return true;
  return (r.title || "").includes(term);
}
function recipeMatches(r, picked) {
  return picked.some((term) => matchTerm(r, term));
}

function getSuggestions() {
  const f = state.filters || {};
  const pool = POOL.filter((r) =>
    r.type === state.type &&
    passesExclude(r) &&
    (!f.genre || r.genre === f.genre) &&
    (!f.method || matchMethod(r, f.method))
  );
  let matched = state.picked.length
    ? pool.filter((r) => recipeMatches(r, state.picked))
    : pool;
  const shown = getShown();
  // 直近に出していないものを優先
  const fresh = matched.filter((r) => !shown.has(r.id));
  let base = fresh.length >= 3 ? fresh : matched.slice();
  shuffle(base);
  let list = base.slice(0, 3);
  // 2品未満なら同カテゴリで補完
  if (list.length < 2) {
    const ids = new Set(list.map((r) => r.id));
    const extra = shuffle(pool.filter((r) => !ids.has(r.id))).slice(0, 3 - list.length);
    list = list.concat(extra);
  }
  markShown(list.map((r) => r.id));
  return { list, matchedCount: matched.length };
}

// 素材チップ（プールに実在するタグを頻度順で）
function tagsForType(type) {
  const freq = {};
  POOL.filter((r) => r.type === type).forEach((r) =>
    (r.tags || []).forEach((t) => (freq[t] = (freq[t] || 0) + 1))
  );
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 14);
}

// ---------- レンダリング ----------
function render() {
  if (!LOADED) return renderLoading();
  if (state.step === "welcome") return renderWelcome();
  if (state.step === "type") return renderType();
  if (state.step === "ingredient") return renderIngredient();
  if (state.step === "suggest") return renderSuggest();
  if (state.step === "detail") return renderDetail();
  if (state.step === "scaler") return renderScaler(app);
  if (state.step === "clips") return renderClips(app);
  if (state.step === "clipsum") return renderClipSummary(app);
  if (state.step === "import") return renderImport(app);
  if (state.step === "prefs") return renderPrefs(app);
}
function bubble(t) { return `<div class="bubble bot">${t}</div>`; }
function badge(src) {
  return `<span class="src-badge" style="background:${SRC_COLOR[src] || "#666"}">${src}</span>`;
}

function renderLoading() {
  app.innerHTML = `${bubble("レシピを読み込んでいます、ユーザーさん…")}`;
}

function renderWelcome() {
  const total = POOL.length;
  app.innerHTML = `
    ${bubble(`こんにちは、ユーザーさん！🍚<br>「15人の男子高校生」向けの献立を、複数のレシピサイトからご提案します。`)}
    <div class="card info">
      <p><b>この条件で提案します</b></p>
      <ul>
        <li>安く手に入りやすい素材（牛肉・魚は不使用）</li>
        <li>包む・巻くなどの手間が少ないもの</li>
        <li>洋食・中華中心の濃い味／漬け込みもOK</li>
        <li>ほたて・いか・チンゲンサイ・きのこ は不使用</li>
      </ul>
      <p class="mini">現在 <b>${total}件</b> のレシピから提案。毎回ランダムに出すので同じ献立が続きません。</p>
    </div>
    <div class="src-legend">
      ${Object.keys(SRC_COLOR).map((s) => badge(s)).join("")}
      <span class="mini">の実在レシピにリンクします</span>
    </div>
    ${renderServing()}
    <button class="btn primary" onclick="go('type')">献立を提案してもらう →</button>
    <div class="choices">
      <button class="btn ghost" onclick="openClips()">📎 クリップ一覧（${clipCount()}）</button>
      <button class="btn ghost" onclick="openScaler()">📷 材料を換算</button>
      <button class="btn ghost" onclick="openPrefs()">⚙️ 苦手素材・履歴</button>
    </div>
  `;
}

function renderServing() {
  return `
    <div class="serving">
      <span>用意する人数</span>
      <div class="stepper">
        <button onclick="changeServing(-1)">−</button>
        <b>${state.servings}人分</b>
        <button onclick="changeServing(1)">＋</button>
      </div>
    </div>`;
}

function renderType() {
  app.innerHTML = `
    ${bubble(`ユーザーさん、まず教えてください。<br><b>「主菜」と「副菜」どちらを提案しましょうか？</b>`)}
    <div class="choices">
      <button class="btn choice" onclick="chooseType('main')">🍖 主菜（メインのおかず）</button>
      <button class="btn choice" onclick="chooseType('side')">🥬 副菜（もう一品）</button>
    </div>
    <button class="btn ghost" onclick="go('welcome')">← 戻る</button>`;
}

function renderIngredient() {
  const base = tagsForType(state.type);
  const extra = state.picked.filter((t) => !base.includes(t)); // 自由入力ぶん
  const chips = [...base, ...extra]
    .map((t) => {
      const on = state.picked.includes(t) ? "on" : "";
      const free = !base.includes(t) ? "free" : "";
      const mark = state.picked.includes(t) && !base.includes(t) ? " ✕" : "";
      return `<button class="chip ${on} ${free}" onclick="toggleIng('${t}')">${t}${mark}</button>`;
    })
    .join("");
  const label = state.type === "main" ? "主菜" : "副菜";
  app.innerHTML = `
    ${bubble(`${label}ですね！<br>使いたい素材はありますか？（複数OK・なければ「おまかせ」）`)}
    <div class="chips">${chips}</div>
    <div class="freeadd">
      <input id="freeing" class="freeinput" type="text" inputmode="text"
        placeholder="他の素材を入力（例：なす、厚揚げ、ちくわ）"
        onkeydown="if(event.key==='Enter'){event.preventDefault();addFreeIng();}" />
      <button class="btn add" onclick="addFreeIng()">追加</button>
    </div>
    <p class="mini">入力した素材は、レシピ名や材料に含まれるものを探します。</p>
    <div class="choices">
      <button class="btn primary" onclick="go('suggest')">
        ${state.picked.length ? "この素材で提案 →" : "おまかせで提案 →"}
      </button>
    </div>
    <button class="btn ghost" onclick="go('type')">← 主菜/副菜を選び直す</button>`;
}

function addFreeIng() {
  const el = document.getElementById("freeing");
  if (!el) return;
  let v = (el.value || "").trim().replace(/['"\\<>]/g, "");
  if (v && !state.picked.includes(v)) state.picked.push(v);
  render();
  const f = document.getElementById("freeing");
  if (f) f.focus();
}

function renderSuggest() {
  const { list, matchedCount } = getSuggestions();
  const pickedLabel = state.picked.length ? state.picked.join("・") : "おまかせ";
  const head =
    matchedCount === 0 && state.picked.length
      ? `「${pickedLabel}」にぴったりは少なかったので、近いおかずも合わせて出しますね。`
      : `「${pickedLabel}」ならこの${list.length}品はどうでしょう？（毎回変わります）`;
  const cards = list.map((r) => {
    const time = r.time ? `⏱ ${r.time}` : `⏱ 目安はリンク先`;
    const tags = (r.tags || []).slice(0, 4).join("・");
    const detail = r.mode === "full" ? "レシピを見る →" : "本家レシピへ →";
    const clipped = isClipped(r.id);
    return `
      <div class="card recipe" onclick="openDetail('${r.id}')">
        <div class="card-top">${badge(r.source)}<span class="tag">${r.type === "main" ? "主菜" : "副菜"}・${r.genre}</span>
          <button class="clipbtn ${clipped ? "on" : ""}" onclick="toggleClip('${r.id}', event)">${clipped ? "📎 クリップ済み" : "📎 クリップ"}</button>
        </div>
        <h3>${r.title}</h3>
        <p class="time">${time}${tags ? `　｜　${tags}` : ""}</p>
        ${r.blurb ? `<p class="blurb">${r.blurb}</p>` : ""}
        <span class="link-arrow">${detail}</span>
      </div>`;
  }).join("");
  app.innerHTML = `
    ${bubble(`ユーザーさん、${head}`)}
    ${renderFilters()}
    ${cards}
    <button class="btn primary" onclick="go('suggest')">🔁 別の候補を見る</button>
    <div class="choices">
      <button class="btn ghost" onclick="go('ingredient')">← 素材を選び直す</button>
      <button class="btn ghost" onclick="openClips()">📎 クリップ一覧（${clipCount()}）</button>
    </div>`;
}

// ジャンル/調理法フィルタ
function renderFilters() {
  const f = state.filters || {};
  const genres = ["洋", "中", "韓", "和"];
  const methods = ["焼く", "炒める", "煮る", "漬ける", "揚げる", "レンジ"];
  const g = genres.map((x) => `<button class="fchip ${f.genre === x ? "on" : ""}" onclick="setFilter('genre','${x}')">${x}</button>`).join("");
  const m = methods.map((x) => `<button class="fchip ${f.method === x ? "on" : ""}" onclick="setFilter('method','${x}')">${x}</button>`).join("");
  return `<div class="filters">
    <div class="frow"><span class="flabel">ジャンル</span>${g}</div>
    <div class="frow"><span class="flabel">調理法</span>${m}</div>
  </div>`;
}
function setFilter(kind, val) {
  state.filters = state.filters || {};
  state.filters[kind] = state.filters[kind] === val ? null : val;
  go("suggest");
}

function renderDetail() {
  const r = POOL.find((x) => x.id === state.currentId);
  if (!r) { go("suggest"); return; }
  if (r.mode === "full") return renderFullDetail(r);
  return renderLinkDetail(r);
}

function renderFullDetail(r) {
  const ingRows = r.ing.map((i) => {
    const s = scaleIng(i, state.servings, r.baseServings);
    return `<tr><td>${s.name}</td><td class="amt">${s.amount}</td></tr>`;
  }).join("");
  const fixedRows = (r.fixed || []).map((f) => `<tr><td>${f.name}</td><td class="amt">${f.text}</td></tr>`).join("");
  const steps = r.steps.map((s) => `<li>${s}</li>`).join("");
  const note = r.note ? `<div class="card warn">💡 ${r.note}</div>` : "";
  app.innerHTML = `
    <div class="detail-head">
      <div class="card-top">${badge(r.source)}<span class="tag">${r.type === "main" ? "主菜" : "副菜"}・${r.genre}</span></div>
      <h2>${r.title}</h2>
      <p class="time">⏱ 調理所要時間：${r.time}</p>
      <a class="ref" href="${r.url}" target="_blank" rel="noopener">🔗 参考レシピを開く</a>
    </div>
    ${note}
    ${renderServing()}
    <div class="card">
      <h3 class="sec">材料（${state.servings}人分・目安）</h3>
      <table class="ing"><tbody>${ingRows}${fixedRows}</tbody></table>
      <p class="mini">※ ${r.baseServings}人前レシピからの自動計算です。</p>
    </div>
    <div class="card">
      <h3 class="sec">作り方</h3>
      <ol class="steps">${steps}</ol>
    </div>
    <div class="choices">
      <button class="btn add" onclick="toggleClip('${r.id}')">${isClipped(r.id) ? "📎 クリップ済み（外す）" : "📎 この料理をクリップ"}</button>
      <button class="btn add" onclick="addHistory('${r.id}')">🍳 作ったことにする</button>
      <button class="btn primary" onclick="go('suggest')">← 他の候補を見る</button>
      <button class="btn ghost" onclick="restart()">最初からやり直す</button>
    </div>`;
  window.scrollTo(0, 0);
}

function renderLinkDetail(r) {
  const tags = (r.tags || []).join("・") || "―";
  app.innerHTML = `
    <div class="detail-head">
      <div class="card-top">${badge(r.source)}<span class="tag">${r.type === "main" ? "主菜" : "副菜"}・${r.genre}</span></div>
      <h2>${r.title}</h2>
      ${r.time ? `<p class="time">⏱ ${r.time}</p>` : ""}
    </div>
    <div class="card">
      <p>主な素材：<b>${tags}</b></p>
      <p class="mini">このレシピは <b>${r.source}</b> の記事です。材料・分量・作り方は本家のページでご覧ください（人数に合わせて調整してください）。</p>
      <a class="ref big" href="${r.url}" target="_blank" rel="noopener">🔗 ${r.source} でレシピを見る</a>
      <button class="btn add" style="width:100%;margin-top:10px" onclick="openScaler()">📷 材料欄を撮って人数分に換算</button>
    </div>
    <div class="choices">
      <button class="btn add" onclick="toggleClip('${r.id}')">${isClipped(r.id) ? "📎 クリップ済み（外す）" : "📎 この料理をクリップ"}</button>
      <button class="btn add" onclick="addHistory('${r.id}')">🍳 作ったことにする</button>
      <button class="btn primary" onclick="go('suggest')">← 他の候補を見る</button>
      <button class="btn ghost" onclick="restart()">最初からやり直す</button>
    </div>`;
  window.scrollTo(0, 0);
}

// ---------- 操作 ----------
function go(step) { state.step = step; render(); }
function chooseType(t) { state.type = t; state.picked = []; state.step = "ingredient"; render(); }
function toggleIng(key) {
  const i = state.picked.indexOf(key);
  if (i >= 0) state.picked.splice(i, 1); else state.picked.push(key);
  render();
}
function openDetail(id) { state.currentId = id; state.step = "detail"; render(); }
function changeServing(d) { state.servings = Math.min(60, Math.max(1, state.servings + d)); render(); }
function restart() { state.step = "welcome"; state.type = null; state.picked = []; state.servings = 15; render(); }

// 起動
loadData().then(render);

// PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
