# X Block Checker

Xで指定したユーザーとのブロック関係を確認し、履歴をJSONとMarkdownへ保存するCLIツール。通常起動したChromiumの専用プロファイルへ一度ログインすれば、以後はPuppeteer Coreから同じプロファイルを使って定期実行できる。

## 必要環境

- Bun 1.3以降
- Chrome、Brave、Edge、Chromiumのいずれか

コンパイル済み実行ファイルの利用時はNode.js、Bun、npmを必要としない。

タグ付きReleaseにはmacOS Apple Silicon、Linux x64、Windows x64向けの単一実行ファイルと`SHA256SUMS`を添付する。導入側では成果物とチェックサムを同じReleaseから取得して照合する。

## セットアップ

```powershell
cd C:\Dev\Repos\Tools\x-block-checker
bun install
bun run install-local
Copy-Item x-block-checker.config.example.json x-block-checker.config.json
```

`install-local` は単一実行ファイルを生成し、WindowsではPATH登録済みの `C:\Users\yuu21\bin\tools\x-block-checker.exe`、Linuxでは `~/.local/bin/x-block-checker` へ配置する。npmのグローバルリンクは使用しない。プロジェクト内の生成物を直接使う場合は `bun run compile` を実行する。

`x-block-checker.config.json` の `users` を確認対象へ変更する。

```json
{
  "users": ["user1", "user2"],
  "outputDir": "./data",
  "timeoutSeconds": 20,
  "headless": true,
  "relationshipMode": "auto"
}
```

初回だけ専用ブラウザを表示してXへログインする。

```powershell
x-block-checker auth
```

`auth`のログイン操作ではPuppeteerやリモートデバッグを使わず、専用プロファイルを指定して通常のブラウザを起動する。Xへのログインを完了したらブラウザを終了する。macOSではウィンドウを閉じるだけでなく、`Command+Q`でブラウザを完全に終了する。終了後にPuppeteerで保存された認証Cookieを検証し、ログインできていなければエラーを返す。認証が切れた場合も同じコマンドを再実行する。

ブラウザの検出、専用プロファイル、認証Cookieを診断する場合は`doctor`を使う。外部プログラムから判定する場合は`--json`を付け、終了コード`0`を利用可能、`1`を未準備として扱う。

```powershell
x-block-checker doctor --json
```

## 実行

設定ファイルのユーザーを確認する。

```powershell
x-block-checker check
```

引数やテキストファイルから一時的に対象を追加することもできる。

```powershell
x-block-checker check @user3 https://x.com/user4
x-block-checker check --input .\users.txt
x-block-checker check --json
```

プロジェクト内の実行ファイルを直接呼ぶこともできる。

```powershell
.\dist\x-block-checker.exe check
```

## 出力

`outputDir` へ次のファイルを原子的に更新する。

| ファイル | 内容 |
|---|---|
| `latest.json` | 今回の実行結果 |
| `history.json` | ユーザー名単位の最新判定履歴 |
| `blocked.md` | `blocked` と `mutual` のMarkdown一覧 |
| `run.lock` | 実行中だけ存在する重複起動防止ロック |

判定状態は `blocked`、`mutual`、`blocking`、`clear`、`notFound`、`suspended`、`unknown`。これとは別に公開範囲を `public`、`protected`、`unknown` で出力するため、「未ブロックかつ鍵アカウント」のように両方の情報を保持できる。`unknown` が1件以上ある場合は終了コード`2`、設定・認証・ブラウザのエラーは`1`、全件判定時は`0`を返す。

## 定期実行

### Windowsタスクスケジューラ

PowerShellで毎日6時のタスクを登録する例。

```powershell
$project = 'C:\Dev\Repos\Tools\x-block-checker'
$executable = 'C:\Users\yuu21\bin\tools\x-block-checker.exe'
$action = New-ScheduledTaskAction `
  -Execute $executable `
  -Argument 'check --config x-block-checker.config.json' `
  -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Daily -At '06:00'
Register-ScheduledTask `
  -TaskName 'X Block Checker' `
  -Action $action `
  -Trigger $trigger `
  -Description 'Xのブロック関係を確認する'
```

タスクは専用ブラウザプロファイルへアクセスするため、`auth`を実行したWindowsユーザーで動かす。

### cron

Linuxで毎日6時に実行する例。

```cron
0 6 * * * cd /opt/x-block-checker && /home/user/.local/bin/x-block-checker check --config x-block-checker.config.json >> data/run.log 2>&1
```

cronから実行する場合も、同じOSユーザーで事前に`x-block-checker auth`を実行する。認証プロファイルや`data/`をGitへ追加しない。

## 設定

| キー | 既定値 | 内容 |
|---|---|---|
| `users` | `[]` | 確認対象のユーザー名またはプロフィールURL |
| `input` | なし | ユーザー一覧ファイル。設定ファイルからの相対パス可 |
| `outputDir` | OSのユーザーデータ領域 | 結果保存先 |
| `profileDir` | OSのユーザーデータ領域内 `profile` | 専用ブラウザプロファイル |
| `browserExecutable` | 自動検出 | Chromium系ブラウザの実行ファイル |
| `timeoutSeconds` | `20` | 1件あたりの待機上限（5〜120秒） |
| `headless` | `true` | `check`でブラウザを非表示にする |
| `relationshipMode` | `auto` | `auto`、`dom`、`passive`、`direct`から選ぶ判定方式 |

CLIオプションは設定ファイルより優先される。全オプションは`x-block-checker --help`で確認できる。

### 判定方式

| モード | 動作 |
|---|---|
| `auto` | 内部GraphQLの直接取得を優先し、取得不能時は通常のプロフィール表示とDOM判定へフォールバック |
| `dom` | プロフィール画面のDOMだけで判定 |
| `passive` | 通常のプロフィール表示で発生した内部GraphQLレスポンスとDOMを使用 |
| `direct` | 最初の通常表示で内部GraphQLリクエストを捕捉し、以後は直接取得を優先。取得不能時は`unknown` |

内部GraphQLのURL、query ID、feature flags、認証headerは設定や履歴へ保存しない。実行中にブラウザの通常通信から捕捉し、メモリ内だけで再利用する。401、403、ログイン画面、判定材料の欠落時は安全側へ倒す。

## 開発

```powershell
bun run format
bun run typecheck
bun test
bun run build
bun run compile
bun run install-local
```

XのWeb UIと内部GraphQLは予告なく変更される可能性がある。確定できない状態を未ブロックとして扱わず、`unknown`として定期実行を異常終了させる設計にしている。過度な実行頻度を避け、通常は1日1回程度にする。
