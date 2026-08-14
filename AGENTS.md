# Project Overview

x-block-checkerは、通常起動したChromiumで認証した専用プロファイルをPuppeteer Coreから使い、Xのブロック関係を定期確認するTypeScript CLI。公式X APIやCookieの手動書き出しは使わず、プロフィール画面とブラウザが使用する`UserByScreenName`レスポンスを判定する。

# Commands

```bash
bun install
bun run format
bun run typecheck
bun test
bun run build
bun run compile
bun run install-local
bun run check
dist/x-block-checker.exe --help
```

# Architecture

- `src/cli.ts`: コマンド、終了コード、出力
- `src/types.ts`: 判定状態と共通の型定義
- `src/storage.ts`: ロック、履歴、Markdownの原子的保存
- `src/config/`: CLI引数、設定解決、ユーザー名の検証、OS別パス探索
- `src/x/`: ブラウザ認証、プロフィール巡回、GraphQL捕捉、関係抽出、状態判定
- `tests/`: ブラウザを使わない単体テスト

# Conventions

- コード内コメントは日本語で書き、文末に句点を付けない
- 整形と自動修正は`bun run format`でまとめて行う
- CookieやブラウザプロファイルをGit管理しない
- 普段使いのChromiumプロファイルを受け入れず、専用markerの検証を維持する
- 内部GraphQLのURL、query ID、認証headerは永続化やログ出力をせず、通常通信から実行中だけ捕捉する
- Xのレスポンス構造変更時もDOMだけで安全側に判定し、確定できなければ`unknown`を返す
- 定期実行で重複起動しないよう`run.lock`を維持する
