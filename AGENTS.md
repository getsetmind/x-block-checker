# Project Overview

x-block-checkerは、専用Chromiumプロファイルを使ってXのブロック関係を定期確認するTypeScript CLI。公式X APIキーやCookieの手動書き出しは使わず、Chromiumを一時CDPポートで起動してプロフィール画面と`UserByScreenName`レスポンスを判定する。

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

- `src/types.ts`: 判定状態と共通の型定義
- `src/args.ts`: CLI引数のパースとコマンド判定
- `src/cli.ts`: コマンド、終了コード、出力
- `src/browser.ts`: Chromiumプロセスの起動、専用プロファイルの認証、ブラウザ巡回
- `src/cdp.ts`: Chrome DevTools Protocolの最小WebSocketクライアント
- `src/classifier.ts`: DOMとブロック関係からの純粋な状態判定
- `src/relationship.ts`: GraphQLレスポンスの構造ゆれを吸収
- `src/usernames.ts`: ユーザー名・URLの正規化と重複除去
- `src/config.ts`: 設定ファイルとCLIオプションの統合
- `src/paths.ts`: OS別アプリデータ領域とブラウザ実行ファイルの探索
- `src/storage.ts`: ロック、履歴、Markdownの原子的保存
- `tests/`: ブラウザを使わない単体テスト

# Conventions

- コード内コメントは日本語で書き、文末に句点を付けない
- 整形と自動修正は`bun run format`でまとめて行う
- CookieやブラウザプロファイルをGit管理しない
- Xのレスポンス構造変更時もDOMだけで安全側に判定し、確定できなければ`unknown`を返す
- 定期実行で重複起動しないよう`run.lock`を維持する
