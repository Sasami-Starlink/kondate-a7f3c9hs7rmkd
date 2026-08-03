// ===== 材料キャプチャ → 人数分に換算するツール =====
// 画像(撮影/選択) → 日本語OCR(Tesseract.js・端末内) → 材料行をパース → 人数でスケール。
// OCRは誤読があるため結果テキストは編集可能。貼り付け入力にも対応。

const scalerState = {
  base: 2,        // 元レシピの人数
  target: 15,     // 作りたい人数
  text: "",       // OCR/貼り付けの材料テキスト
  results: [],    // 換算結果
  busy: false,
  progress: 0,
  msg: "",
};

// ---- 数値ユーティリティ ----
function z2h(s) {
  return String(s)
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
    .replace(/／/g, "/").replace(/．/g, ".").replace(/　/g, " ")
    .replace(/[〜～]/g, "〜").replace(/[–—―]/g, "-"); // 「ー」(長音)は名前に残す
}
function toNum(s) {
  if (s == null) return null;
  let t = z2h(s).replace(/\s/g, "");
  let m = t.match(/^(\d+)と(\d+)\/(\d+)$/);      // 1と1/2
  if (m) return (+m[1]) + (+m[2]) / (+m[3]);
  m = t.match(/^(\d+)\/(\d+)$/);                  // 1/2
  if (m) return (+m[1]) / (+m[2]);
  m = t.match(/^(\d+(?:\.\d+)?)$/);               // 3 / 3.5
  if (m) return +m[1];
  return null;
}
function fmtScaled(v, unit) {
  if (v == null || isNaN(v)) return null;
  if (["g", "ml", "cc", "kg"].includes(unit)) {
    if (v >= 100) return Math.round(v / 10) * 10;
    return Math.max(1, Math.round(v / 5) * 5);
  }
  if (["個", "本", "枚", "片", "かけ", "玉", "束", "袋", "缶", "パック", "杯", "尾", "丁", "株", "房", "切れ"].includes(unit))
    return Math.max(1, Math.round(v));
  if (["大さじ", "小さじ", "カップ"].includes(unit)) return Math.round(v * 2) / 2;
  return Math.round(v * 10) / 10;
}

const PRE_UNITS = ["大さじ", "小さじ", "カップ"];
const POST_UNITS = ["kg", "g", "ｇ", "ml", "cc", "個", "本", "枚", "片", "かけ", "玉",
  "束", "袋", "缶", "パック", "合", "杯", "株", "房", "尾", "切れ", "丁", "つまみ", "振り", "ふり"];
const FIXED_WORDS = ["適量", "少々", "お好み", "適宜", "ひとつまみ"];

const NUM = "\\d+(?:\\.\\d+)?(?:と\\d+/\\d+)?(?:/\\d+)?";
const RANGE = `${NUM}(?:\\s*[〜~\\-−]\\s*${NUM})?`;
const RE_PRE = new RegExp(`(${PRE_UNITS.join("|")})\\s*(${RANGE})`);
const RE_POST = new RegExp(`(${RANGE})\\s*(${POST_UNITS.join("|")})`);
const RE_BARE = new RegExp(`(${RANGE})\\s*$`);

function scaleNumStr(numStr, unit, order, factor) {
  const parts = z2h(numStr).split(/\s*[〜~\-−]\s*/);
  const scaled = parts.map((p) => fmtScaled(toNum(p) * factor, unit)).filter((x) => x != null);
  if (!scaled.length) return null;
  const txt = scaled.join("〜");
  return order === "pre" ? `${unit}${txt}` : `${txt}${unit}`;
}

// 1行を解析
function cleanName(n) {
  return n.replace(/[：:・…\.\s]+$/g, "").replace(/^[：:・…\.\s]+/g, "").trim();
}
function parseIngredientLine(line) {
  const original = (line || "").trim();
  if (!original) return null;
  // OCRは文字間にスペースを入れがち→解析前に空白を全て詰める（例「大 さじ 3」→「大さじ3」）
  const s = z2h(original).replace(/\s+/g, "");
  let unit = null, numStr = null, matchStr = null, order = null;
  let m;
  if ((m = s.match(RE_PRE))) { unit = m[1]; numStr = m[2]; matchStr = m[0]; order = "pre"; }
  else if ((m = s.match(RE_POST))) {
    numStr = m[1]; unit = m[2] === "ｇ" ? "g" : m[2]; matchStr = m[0]; order = "post";
  } else if ((m = s.match(RE_BARE))) { numStr = m[1]; unit = ""; matchStr = m[1]; order = "post"; }

  const fixedHit = FIXED_WORDS.find((f) => s.includes(f));
  if (!numStr) {
    if (fixedHit) return { name: cleanName(s.replace(fixedHit, "")) || "（材料）", kind: "fixed", disp: fixedHit, original };
    return { name: original, kind: "asis", disp: "", original }; // 数量なし行
  }
  let name = cleanName(s.replace(matchStr, "")) || "（材料）";
  return { name, kind: "num", numStr, unit, order, original };
}

function runScale() {
  const base = Math.max(1, scalerState.base | 0);
  const target = Math.max(1, scalerState.target | 0);
  const factor = target / base;
  const lines = (scalerState.text || "").split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const p = parseIngredientLine(line);
    if (!p) continue;
    if (p.kind === "num") {
      out.push({ name: p.name, before: scaleNumStr(p.numStr, p.unit, p.order, 1),
                 after: scaleNumStr(p.numStr, p.unit, p.order, factor) });
    } else if (p.kind === "fixed") {
      out.push({ name: p.name, before: p.disp, after: p.disp });
    } // asis(数量なし)は結果から除外
  }
  scalerState.results = out;
  renderScaler(document.getElementById("app"));
}

// ---- OCR ----
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    sc.onload = res; sc.onerror = () => rej(new Error("OCRライブラリの読み込みに失敗しました（通信環境をご確認ください）"));
    document.head.appendChild(sc);
  });
}
async function scalerOnImage(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  scalerState.busy = true; scalerState.progress = 0; scalerState.msg = "OCRの準備中…";
  renderScaler(document.getElementById("app"));
  try {
    await loadTesseract();
    const { data } = await Tesseract.recognize(file, "jpn", {
      logger: (mm) => {
        if (mm.status === "recognizing text") { scalerState.progress = Math.round(mm.progress * 100); scalerState.msg = `読み取り中… ${scalerState.progress}%`; }
        else { scalerState.msg = mm.status; }
        const el = document.getElementById("ocr-msg"); if (el) el.textContent = scalerState.msg;
      },
    });
    const text = (data.text || "").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
    scalerState.text = text;
    scalerState.busy = false;
    runScale();
  } catch (e) {
    scalerState.busy = false; scalerState.msg = String(e.message || e);
    renderScaler(document.getElementById("app"));
  }
}

// ---- 画面 ----
function openScaler() { state.step = "scaler"; render(); }

function renderScaler(container) {
  const rows = scalerState.results.map((r) =>
    `<tr><td>${escapeHtml(r.name)}</td><td class="amt-b">${r.before ?? "-"}</td><td class="arrow">→</td><td class="amt">${r.after ?? "-"}</td></tr>`
  ).join("");
  const table = scalerState.results.length ? `
    <div class="card">
      <h3 class="sec">換算結果（${scalerState.base}人分 → ${scalerState.target}人分）</h3>
      <table class="scale-tbl"><thead><tr><th>材料</th><th>元</th><th></th><th>換算後</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="mini">※ 目安です。「適量・少々」はそのまま、塩など味の調整はお好みで。</p>
    </div>` : "";
  const busy = scalerState.busy ? `<div class="card"><p id="ocr-msg">${scalerState.msg || "処理中…"}</p><div class="bar"><i style="width:${scalerState.progress}%"></i></div></div>` : "";

  container.innerHTML = `
    ${bubble(`材料を人数分に換算します、ユーザーさん。<br>本家サイトの<b>材料欄を撮影/スクショ</b>して読み込むか、テキストを貼り付けてください。`)}
    <div class="card">
      <div class="serv-row">
        <label>元のレシピ<input type="number" min="1" value="${scalerState.base}" onchange="scalerState.base=+this.value"></label>
        <span>人分 →</span>
        <label>作りたい<input type="number" min="1" value="${scalerState.target}" onchange="scalerState.target=+this.value"></label>
        <span>人分</span>
      </div>
      <label class="filebtn">📷 材料の写真を撮る / 選ぶ
        <input type="file" accept="image/*" capture="environment" style="display:none" onchange="scalerOnImage(this)">
      </label>
      <p class="mini">写真を選ぶと自動で文字起こし→下の欄に入ります（誤読は直せます）。</p>
    </div>
    ${busy}
    <div class="card">
      <h3 class="sec">材料テキスト（編集OK・貼り付けOK）</h3>
      <textarea id="scaler-ta" class="scale-ta" rows="7" placeholder="例：\n豚こま肉 320g\n醤油 大さじ3\n砂糖 大さじ1と1/2\n卵 2個\n塩 少々"
        oninput="scalerState.text=this.value">${escapeHtml(scalerState.text)}</textarea>
      <button class="btn primary" onclick="runScale()">この内容で換算する →</button>
    </div>
    ${table}
    <button class="btn ghost" onclick="go('welcome')">← ホームに戻る</button>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
