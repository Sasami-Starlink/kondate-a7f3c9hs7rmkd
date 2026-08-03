# 自動更新つきで公開する手順（GitHub Pages）

GitHub に置くと、**毎週自動で `crawl.py` が動いてレシピが増え、そのまま自動公開**されます（あなたは以後なにもしなくてOK）。Netlify は使いません。

初回だけ、下の①〜④をやってください。

## ① GitHub アカウントを用意
- https://github.com で無料登録（すでに持っていればログイン）

## ② このフォルダを GitHub に上げる（GitHub Desktop が簡単）
1. **GitHub Desktop** をインストール → https://desktop.github.com/
2. 起動して GitHub アカウントでサインイン
3. メニュー **File → Add Local Repository** → このフォルダ `kondate-app` を選ぶ
   - （すでに git 初期化済みなので、そのまま認識されます）
4. 右上 **Publish repository** を押す
   - リポジトリ名は分かりにくい名前を推奨（例：`kondate-7f3a9c2b`）
   - **「Keep this code private」のチェックは外す（＝Public）** ← 無料でPagesと自動更新を使うため。中身はレシピアプリのコードだけで、秘密情報はありません
   - Publish

> コマンドで上げたい場合（上級者）:
> ```bash
> cd /Users/asu/Claude/kondate-app
> git remote add origin https://github.com/<あなたのユーザー名>/<リポジトリ名>.git
> git push -u origin main
> ```

## ③ GitHub 側の設定（2か所だけ）
リポジトリのページ（github.com/あなた/リポジトリ名）で:

1. **Settings → Pages**
   - 「Build and deployment」→ **Source を「GitHub Actions」** に変更
2. **Settings → Actions → General**
   - 下の「Workflow permissions」→ **「Read and write permissions」** を選んで Save
   - （毎週の自動更新で recipes.json を保存するために必要）

## ④ 動かす
- **Actions** タブを開く → 「レシピ更新＆自動公開」ワークフローが動きます
  - 最初は Settings→Pages の設定後に **Actions タブ → Run workflow（手動実行）** を押すと確実です
- 完了すると **Settings → Pages に公開URL** が出ます（`https://あなた.github.io/リポジトリ名/`）
- このURLを母親に送ればOK。スマホで開いて「ホーム画面に追加」

## 自動更新について
- 既定で **毎週月曜6:00（日本時間）** に自動収集＆公開
- 「今すぐ増やしたい」ときは Actions タブ → **Run workflow** を手動で押すだけ
- 頻度を変えるには `.github/workflows/update.yml` の `cron:` を編集

## プライバシー
- `robots.txt` と `noindex` で **検索には出ません**
- URLは分かりにくい名前にすればリンクを知る人以外は辿り着けません
- （ログインで完全に限定したい場合は、別途パスワード追加も可能）
