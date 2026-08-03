// ===== クリップ献立 ＆ 材料まとめ / 苦手素材設定 / 履歴 / フィルタ =====
// 主菜・副菜をクリップ保存 → 一覧でチェック → 材料を人数分でまとめる。
// 収集レシピ(分量なし)は「材料を取り込む(貼付/OCR)」で合算対象にできる。

function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

// ---------- クリップ ----------
function getClips() { return lsGet("clips", []); }
function isClipped(id) { return getClips().some((c) => c.id === id); }
function clipSnapshot(r) {
  return {
    id: r.id, source: r.source, title: r.title, url: r.url, type: r.type,
    genre: r.genre, tags: r.tags || [], time: r.time || null, mode: r.mode,
    ing: r.ing || null, fixed: r.fixed || null, baseServings: r.baseServings || null,
    note: r.note || null,
    savedText: null, savedBase: 2, // 収集レシピ用に取り込んだ材料
  };
}
function toggleClip(id, ev) {
  if (ev) ev.stopPropagation();
  const clips = getClips();
  const i = clips.findIndex((c) => c.id === id);
  if (i >= 0) { clips.splice(i, 1); }
  else {
    const r = POOL.find((x) => x.id === id) || getClips().find((c) => c.id === id);
    if (r) clips.push(clipSnapshot(r));
  }
  lsSet("clips", clips);
  render();
}
function removeClip(id) { const c = getClips().filter((x) => x.id !== id); lsSet("clips", c); render(); }
function clipCount() { return getClips().length; }

// クリップの選択状態（まとめ対象）
function getSelected() { return lsGet("clipSel", {}); }
function toggleSelected(id) { const s = getSelected(); s[id] = !s[id]; lsSet("clipSel", s); render(); }

// ---------- 苦手素材（動的除外） ----------
function getExcludeTerms() { return lsGet("prefs", { excludeTerms: [] }).excludeTerms || []; }
function addExclude(v) {
  v = (v || "").trim().replace(/['"\\<>]/g, "");
  if (!v) return;
  const p = lsGet("prefs", { excludeTerms: [] });
  p.excludeTerms = p.excludeTerms || [];
  if (!p.excludeTerms.includes(v)) p.excludeTerms.push(v);
  lsSet("prefs", p); render();
}
function removeExclude(v) {
  const p = lsGet("prefs", { excludeTerms: [] });
  p.excludeTerms = (p.excludeTerms || []).filter((x) => x !== v);
  lsSet("prefs", p); render();
}
function passesExclude(r) {
  const terms = getExcludeTerms();
  if (!terms.length) return true;
  const hay = (r.title || "") + " " + (r.tags || []).join(" ");
  return !terms.some((t) => hay.includes(t));
}

// ---------- 作った履歴 ----------
function getHistory() { return lsGet("history", []); }
function addHistory(id, title) {
  if (!title) {
    const r = (typeof POOL !== "undefined" && POOL.find((x) => x.id === id)) || getClips().find((c) => c.id === id);
    title = r ? r.title : "（レシピ）";
  }
  const h = getHistory().filter((x) => !(x.id === id && x.date === new Date().toISOString().slice(0, 10)));
  h.unshift({ id, title, date: new Date().toISOString().slice(0, 10) });
  lsSet("history", h.slice(0, 50));
  const btn = document.querySelector(`[onclick="addHistory('${id}')"]`);
  if (btn) { btn.textContent = "✅ 記録しました"; } else { render(); }
}
function cookedRecently(id) {
  return getHistory().slice(0, 12).some((x) => x.id === id);
}

// ---------- 調理法フィルタ ----------
const METHODS = [
  ["焼く", ["焼", "ロースト", "グリル", "ステーキ", "ソテー"]],
  ["炒める", ["炒", "チャーハン"]],
  ["煮る", ["煮", "スープ", "シチュー", "カレー", "鍋"]],
  ["漬ける", ["漬", "マリネ", "ナムル", "和え", "あえ"]],
  ["揚げる", ["揚", "フライ", "唐揚", "から揚", "竜田", "ナゲット"]],
  ["レンジ", ["レンジ", "チン", "電子レンジ"]],
];
function matchMethod(r, method) {
  const kw = (METHODS.find((m) => m[0] === method) || [null, []])[1];
  const hay = (r.title || "") + " " + (r.tags || []).join(" ");
  return kw.some((k) => hay.includes(k));
}

// ========== 材料まとめの計算 ==========
function clipItems(clip, servings) {
  const items = [];
  if (clip.mode === "full" && clip.ing) {
    const f = servings / (clip.baseServings || 2);
    clip.ing.forEach((i) => {
      const order = ["大さじ", "小さじ", "カップ"].includes(i.unit) ? "pre" : "post";
      items.push({ name: i.name, value: (typeof i.qty === "number" ? i.qty * f : null), unit: i.unit, order });
    });
    (clip.fixed || []).forEach((x) => items.push({ name: x.name, fixed: x.text }));
  } else if (clip.savedText) {
    const f = servings / (clip.savedBase || 2);
    clip.savedText.split(/\r?\n/).forEach((line) => {
      const p = parseIngredientLine(line);
      if (!p) return;
      if (p.kind === "num") {
        const v = toNum(z2h(p.numStr).split(/[〜~\-−]/)[0]);
        items.push({ name: p.name, value: (v != null ? v * f : null), unit: p.unit, order: p.order });
      } else if (p.kind === "fixed") items.push({ name: p.name, fixed: p.disp });
    });
  }
  return items;
}
function aggregate(clips, servings) {
  const map = new Map();
  clips.forEach((c) => clipItems(c, servings).forEach((it) => {
    if (it.fixed) { const k = it.name + "|fx"; if (!map.has(k)) map.set(k, { name: it.name, fixed: it.fixed }); return; }
    if (it.value == null) { const k = it.name + "|?"; if (!map.has(k)) map.set(k, { name: it.name, unknown: true }); return; }
    const k = it.name + "|" + it.unit;
    const cur = map.get(k) || { name: it.name, unit: it.unit, order: it.order, value: 0 };
    cur.value += it.value; map.set(k, cur);
  }));
  return [...map.values()];
}
function fmtItem(it) {
  if (it.fixed) return it.fixed;
  if (it.unknown) return "本家で確認";
  const v = fmtScaled(it.value, it.unit);
  return it.order === "pre" ? `${it.unit}${v}` : `${v}${it.unit}`;
}

// ========== 画面 ==========
function openClips() { state.step = "clips"; render(); }
function openPrefs() { state.step = "prefs"; render(); }

function renderClips(container) {
  const clips = getClips();
  const sel = getSelected();
  if (!clips.length) {
    container.innerHTML = `${bubble("まだクリップがありません、ユーザーさん。<br>提案画面や詳細で 📎 を押すと、ここに主菜・副菜を保存できます。")}
      <button class="btn primary" onclick="go('type')">献立を提案してもらう →</button>
      <button class="btn ghost" onclick="go('welcome')">← ホーム</button>`;
    return;
  }
  const group = (t, label) => {
    const list = clips.filter((c) => c.type === t);
    if (!list.length) return "";
    const rows = list.map((c) => {
      const on = sel[c.id] ? "checked" : "";
      const cooked = cookedRecently(c.id) ? `<span class="cooked">先週作った</span>` : "";
      return `<label class="clip-row">
        <input type="checkbox" ${on} onchange="toggleSelected('${c.id}')">
        <span class="clip-main">
          <span class="card-top">${badge(c.source)}<span class="tag">${c.genre}</span>${cooked}</span>
          <b>${escapeHtml(c.title)}</b>
        </span>
        <button class="xbtn" onclick="removeClip('${c.id}')">✕</button>
      </label>`;
    }).join("");
    return `<h3 class="sec2">${label}（${list.length}）</h3>${rows}`;
  };
  const selCount = clips.filter((c) => sel[c.id]).length;
  container.innerHTML = `
    ${bubble(`クリップした献立です、ユーザーさん。<br>作るものにチェックを入れて、材料をまとめられます。`)}
    <div class="card">
      ${group("main", "🍖 主菜")}
      ${group("side", "🥬 副菜")}
    </div>
    <button class="btn primary" onclick="openClipSummary()">🧺 選んだ${selCount}品の材料を${lsGet("prefs", {}).servings || 15}人分でまとめる →</button>
    <button class="btn ghost" onclick="go('welcome')">← ホーム</button>
  `;
}

function openClipSummary() { state.step = "clipsum"; render(); }

function renderClipSummary(container) {
  const servings = lsGet("prefs", {}).servings || state.servings || 15;
  const sel = getSelected();
  const chosen = getClips().filter((c) => sel[c.id]);
  if (!chosen.length) {
    container.innerHTML = `${bubble("まとめる料理が選ばれていません。クリップ一覧でチェックを入れてください。")}
      <button class="btn primary" onclick="openClips()">← クリップ一覧へ</button>`;
    return;
  }
  // 材料未取得の収集レシピ
  const needImport = chosen.filter((c) => c.mode !== "full" && !c.savedText);
  const agg = aggregate(chosen, servings).sort((a, b) => (a.unknown ? 1 : 0) - (b.unknown ? 1 : 0));
  const rows = agg.map((it) =>
    `<tr><td>${escapeHtml(it.name)}</td><td class="amt">${fmtItem(it)}</td></tr>`).join("");

  const dishList = chosen.map((c) => {
    const canImport = c.mode !== "full";
    const st = c.savedText ? `<span class="ok">材料取り込み済み</span>` : (canImport ? `<span class="warn2">材料未取得</span>` : `<span class="ok">分量あり</span>`);
    const imp = canImport ? `<button class="btn add sm" onclick="openImport('${c.id}')">材料を取り込む</button>` : "";
    return `<div class="dish-row"><span>${badge(c.source)} ${escapeHtml(c.title)} ${st}</span>${imp}</div>`;
  }).join("");

  container.innerHTML = `
    ${bubble(`選んだ${chosen.length}品の材料を<b>${servings}人分</b>でまとめました。買い物リストにどうぞ、ユーザーさん。`)}
    <div class="serving">
      <span>まとめる人数</span>
      <div class="stepper">
        <button onclick="setSummaryServings(-1)">−</button><b>${servings}人分</b><button onclick="setSummaryServings(1)">＋</button>
      </div>
    </div>
    ${needImport.length ? `<div class="card warn">💡 ${needImport.length}品は分量データが無い収集レシピです。下の「材料を取り込む」で貼付/撮影すると合算されます。</div>` : ""}
    <div class="card">
      <h3 class="sec">🧺 買い物リスト（${servings}人分）</h3>
      <table class="ing"><tbody>${rows}</tbody></table>
      <button class="btn add" style="width:100%;margin-top:10px" onclick="copyShopping()">📋 リストをコピー</button>
    </div>
    <div class="card">
      <h3 class="sec">内訳（${chosen.length}品）</h3>
      ${dishList}
    </div>
    <button class="btn ghost" onclick="openClips()">← クリップ一覧へ</button>
  `;
}
function setSummaryServings(d) {
  const p = lsGet("prefs", {}); p.servings = Math.min(60, Math.max(1, (p.servings || 15) + d)); lsSet("prefs", p); render();
}
function copyShopping() {
  const servings = lsGet("prefs", {}).servings || 15;
  const chosen = getClips().filter((c) => getSelected()[c.id]);
  const lines = aggregate(chosen, servings).map((it) => `・${it.name} ${fmtItem(it)}`);
  const text = `買い物リスト（${servings}人分）\n` + lines.join("\n");
  navigator.clipboard && navigator.clipboard.writeText(text);
  const b = document.querySelector('[onclick="copyShopping()"]'); if (b) b.textContent = "✅ コピーしました";
}

// 収集レシピの材料取り込み（貼付/OCR）
function openImport(id) { state.importId = id; state.step = "import"; render(); }
function renderImport(container) {
  const clip = getClips().find((c) => c.id === state.importId);
  if (!clip) { openClips(); return; }
  container.innerHTML = `
    ${bubble(`「${escapeHtml(clip.title)}」の材料を取り込みます。<br>本家サイトの材料欄を撮影/スクショ、または貼り付けてください。`)}
    <div class="card">
      <a class="ref big" href="${clip.url}" target="_blank" rel="noopener">🔗 ${clip.source} で材料を見る</a>
      <div class="serv-row" style="margin-top:12px"><label>元のレシピ<input type="number" min="1" value="${clip.savedBase || 2}" onchange="setImportBase(+this.value)"></label><span>人分</span></div>
      <label class="filebtn">📷 材料の写真を撮る / 選ぶ
        <input type="file" accept="image/*" capture="environment" style="display:none" onchange="importOnImage(this)">
      </label>
      <p class="mini" id="imp-msg">写真を選ぶと文字起こしされます（誤読は直せます）。</p>
      <textarea id="imp-ta" class="scale-ta" rows="6" placeholder="例：\n鶏むね肉 300g\n醤油 大さじ2\n…">${escapeHtml(clip.savedText || "")}</textarea>
      <button class="btn primary" onclick="saveImport()">この材料を保存して合算する →</button>
    </div>
    <button class="btn ghost" onclick="openClipSummary()">← 材料まとめへ</button>
  `;
}
function setImportBase(v) { const clips = getClips(); const c = clips.find((x) => x.id === state.importId); if (c) { c.savedBase = Math.max(1, v | 0); lsSet("clips", clips); } }
async function importOnImage(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const msg = document.getElementById("imp-msg"); if (msg) msg.textContent = "OCR準備中…";
  try {
    await loadTesseract();
    const { data } = await Tesseract.recognize(file, "jpn", { logger: (m) => { if (msg && m.status === "recognizing text") msg.textContent = `読み取り中… ${Math.round(m.progress * 100)}%`; } });
    const ta = document.getElementById("imp-ta");
    const text = (data.text || "").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
    if (ta) ta.value = text;
    if (msg) msg.textContent = "読み取り完了。内容を確認して保存してください。";
  } catch (e) { if (msg) msg.textContent = String(e.message || e); }
}
function saveImport() {
  const ta = document.getElementById("imp-ta");
  const clips = getClips(); const c = clips.find((x) => x.id === state.importId);
  if (c && ta) { c.savedText = ta.value; lsSet("clips", clips); }
  openClipSummary();
}

// 苦手素材ページ
function renderPrefs(container) {
  const terms = getExcludeTerms();
  const chips = terms.map((t) => `<button class="chip on free" onclick="removeExclude('${t}')">${escapeHtml(t)} ✕</button>`).join("") || `<span class="mini">まだ設定はありません</span>`;
  const hist = getHistory().slice(0, 10).map((h) => `<div class="dish-row"><span>${escapeHtml(h.title)}</span><span class="mini">${h.date}</span></div>`).join("") || `<span class="mini">まだ記録がありません</span>`;
  container.innerHTML = `
    ${bubble("苦手な素材や、今回入れたくない素材を設定できます、ユーザーさん。提案から自動で除きます。")}
    <div class="card">
      <h3 class="sec">除外する素材</h3>
      <div class="chips">${chips}</div>
      <div class="freeadd">
        <input id="ex-in" class="freeinput" type="text" placeholder="例：ピーマン、なす、パクチー" onkeydown="if(event.key==='Enter'){event.preventDefault();addExclude(document.getElementById('ex-in').value);}">
        <button class="btn add" onclick="addExclude(document.getElementById('ex-in').value)">追加</button>
      </div>
      <p class="mini">レシピ名や素材に含まれると除外します。※ほたて・いか・チンゲンサイ・きのこ等は元から除外済み。</p>
    </div>
    <div class="card">
      <h3 class="sec">作った履歴</h3>
      ${hist}
    </div>
    <button class="btn ghost" onclick="go('welcome')">← ホーム</button>
  `;
}
