# Project Overview

x-block-checkerは、通常起動したChromiumで認証した専用プロファイルをPuppeteer Coreから使い、Xのブロック関係を定期確認するTypeScript CLI
公式X APIやCookieの手動書き出しは使わず、プロフィール画面とブラウザが使用する`UserByScreenName`レスポンスを判定する

## Commands

```bash
bun install
bun run format
bun run typecheck
bun test
bun run build
bun run compile
bun run install-local
bun run check
bun run check:quality
dist/x-block-checker.exe --help
```

## Architecture

- `src/cli.ts`: コマンド、終了コード、出力
- `src/types.ts`: 判定状態と共通の型定義
- `src/storage.ts`: ブロック判定履歴の保存
- `src/run-lock.ts`: 共通の実行ロック管理
- `src/persistence.ts`: JSON整形と原子的なファイル保存
- `src/account-lists/`: 一覧の中立的な型定義、保存、待機・再開・CLI出力
- `src/config/`: CLI引数、設定解決、ユーザー名の検証、OS別パス探索
- `src/x/`: ブラウザ認証、プロフィール巡回、GraphQL捕捉、関係抽出、状態判定
- `src/x/account-list.ts`: 一覧種別を知らない取得エンジン
- `src/x/blocking.ts`・`src/x/follows.ts`: 一覧種別ごとの通信・応答解析アダプター
- `src/x/account-list-browser.ts`: 認証済みブラウザと一覧アダプターの接続
- `tests/`: ブラウザを使わない単体テスト

## Conventions

- 品質検査は`quality.json`の方針に従い`bun run check:quality`で実行する
- 整形と自動修正は`bun run format`でまとめて行う
- CookieやブラウザプロファイルをGit管理しない
- 普段使いのChromiumプロファイルを受け入れず、専用markerの検証を維持する
- 内部GraphQLのURL、query ID、認証headerは永続化やログ出力をせず、通常通信から実行中だけ捕捉する
- Xのレスポンス構造変更時もDOMだけで安全側に判定し、確定できなければ`unknown`を返す
- 定期実行で重複起動しないよう`run.lock`を維持する
