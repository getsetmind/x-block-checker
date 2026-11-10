# X Block Checker

Xで指定したユーザーとのブロック関係を確認し、履歴をJSONとMarkdownへ保存するCLIツール
通常起動したChromiumの専用プロファイルへ一度ログインすれば、以後はPuppeteer Coreから同じプロファイルを使って定期実行できる

## 必要環境

- Bun 1.3以降
- Chrome、Brave、Edge、Chromiumのいずれか

コンパイル済み実行ファイルの利用時はNode.js、Bun、npmを必要としない

タグ付きReleaseにはmacOS Apple Silicon、Linux x64、Windows x64向けの単一実行ファイルと`SHA256SUMS`を添付する
導入側では成果物とチェックサムを同じReleaseから取得して照合する

## セットアップ

```powershell
cd C:\Dev\Repos\Tools\x-block-checker
bun install
bun run install-local
Copy-Item x-block-checker.config.example.json x-block-checker.config.json
```

`install-local` は単一実行ファイルを生成し、WindowsではPATH登録済みの `C:\Users\yuu21\bin\tools\x-block-checker.exe`、Linuxでは `~/.local/bin/x-block-checker` へ配置する
npmのグローバルリンクは使用しない
プロジェクト内の生成物を直接使う場合は `bun run compile` を実行する

`x-block-checker.config.json` の `users` を確認対象へ変更する

```json
{
	"users": [
		"user1",
		"user2"
	],
	"outputDir": "./data",
	"timeoutSeconds": 20,
	"headless": true,
	"relationshipMode": "auto"
}
```

初回だけ専用ブラウザを表示してXへログインする

```powershell
x-block-checker auth
```

`auth`のログイン操作ではPuppeteerやリモートデバッグを使わず、専用プロファイルを指定して通常のブラウザを起動する
Xへのログインを完了したらブラウザを終了する
macOSではウィンドウを閉じるだけでなく、`Command+Q`でブラウザを完全に終了する
終了後に通常起動と同じmacOS Keychainを使って認証Cookieを検証し、ログインできていなければエラーを返す
認証が切れた場合も同じコマンドを再実行する

ブラウザの検出、専用プロファイル、認証Cookieを診断する場合は`doctor`を使う
外部プログラムから判定する場合は`--json`を付け、終了コード`0`を利用可能、`1`を未準備として扱う

```powershell
x-block-checker doctor --json
```

## 実行

設定ファイルのユーザーを確認する

```powershell
x-block-checker check
```

引数やテキストファイルから一時的に対象を追加することもできる

```powershell
x-block-checker check @user3 https://x.com/user4
x-block-checker check --input .\users.txt
x-block-checker check --json
```

プロジェクト内の実行ファイルを直接呼ぶこともできる

```powershell
.\dist\x-block-checker.exe check
```

### 自分のブロック・フォロー・フォロワー一覧

Xの設定画面「ブロックしているアカウント」から一覧全体を取得するには`blocking`を使う
`following`は自分がフォローしているアカウント、`followers`は自分をフォローしているアカウントを取得する
対象は`auth`でログインした本人のみで、他人のユーザー名は指定できない

```powershell
x-block-checker blocking
x-block-checker blocking --json
x-block-checker blocking --wait
x-block-checker blocking --page-limit 50
x-block-checker blocking --restart
x-block-checker following --json
x-block-checker followers --wait --page-limit 50
```

3コマンドとも`--json`・`--wait`・`--page-limit`・`--restart`を使用できる
設定の`users`と`input`は使用せず、ユーザー引数や`--input`の指定はエラーにする
通常出力はユーザー名・プロフィールURLの表と件数、`--json`は`version`・`checkedAt`・`accounts`を持つ一覧を返す
既定では1回25ページまで取得し、ページごとに途中一覧と再開情報を保存する
もう一度同じコマンドを実行すると、種類ごとに保存済みの続きから取得する
`--page-limit`で1回のページ数を1〜100に変更できる

`--wait`を付けると、ページ数の上限では60秒、アクセス頻度制限ではXが示す再試行時刻まで待って取得を続ける（時刻を取得できない場合は15分待つ）
起動時に再試行時刻が未来の場合、`--wait`なしではブラウザでログインアカウントを確認し、一覧の取得通信は行わず途中結果を返す
待機中も実行ロックを保持する
中断しても保存済みのページから再開でき、`--restart`を付けると再開情報だけを破棄して最初から取得する

取得途中は終了コード`2`を返し、JSONに`complete: false`・`pages`・`startedAt`と、必要に応じて`retryAt`・`stopReason`を含める
内部カーソルや所有アカウントIDは標準出力と途中一覧には含めない
全件取得に成功した場合だけ完全一覧を置き換えて再開情報を削除する
設定・認証・未対応の応答形式などのエラーは終了コード`1`を返す
走査中にブロック・フォロー関係が変わる可能性があるため、取得結果は単一時点の厳密なスナップショットではない

## 出力

`outputDir` へ次のファイルを原子的に更新する

| ファイル                 | 内容                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| `latest.json`            | 今回の実行結果                                                        |
| `history.json`           | ユーザー名単位の最新判定履歴                                          |
| `blocked.md`             | 自分をブロックしているユーザー（`blocked` と `mutual`）のMarkdown一覧 |
| `blocking.json`          | `blocking`で取得した自分がブロックしているアカウント全件の最新一覧    |
| `blocking.md`            | `blocking.json`と同じ一覧のMarkdown                                   |
| `blocking-progress.json` | 所有アカウントIDと次ページのカーソルを含む再開情報                    |
| `blocking.partial.json`  | 取得済みの途中一覧と進捗（カーソル・所有アカウントIDは含めない）      |
| `blocking.partial.md`    | 取得途中と明記したMarkdown一覧                                        |
| `run.lock`               | 実行中・待機中に存在する重複起動防止ロック                            |

`check`は指定ユーザーとの関係を確認し、`latest.json`・`history.json`・`blocked.md`を更新する
`blocked.md`は履歴全体の最新判定から作成し、今回確認しなかったユーザーも保持する
`blocking`はX設定の一覧を分割取得し、全件取得が完了した場合だけ`blocking.json`・`blocking.md`を置き換える（0件なら空一覧）
`following`・`followers`も同じ保存方式で、ファイル名の`blocking`部分をそれぞれ`following`・`followers`に置き換える（例: `following.json`、`followers-progress.json`）
一覧と再開情報は種類ごとに分離し、`--restart`は指定した種類の再開情報だけを削除する
途中一覧と再開情報は完全一覧とは別に保存する
再開情報には認証Cookie・内部URL・query ID・認証ヘッダーを保存しない
異なる所有アカウントでは再開できないため、アカウントを変更した場合は`--restart`で取得し直す
各コマンドの結果は混ぜず、`check`は一覧取得コマンドの保存済み一覧を上書きしない

判定状態は `blocked`、`mutual`、`blocking`、`clear`、`notFound`、`suspended`、`unknown`
これとは別に公開範囲を `public`、`protected`、`unknown` で出力するため、「未ブロックかつ鍵アカウント」のように両方の情報を保持できる
`unknown` が1件以上ある場合は終了コード`2`、設定・認証・ブラウザのエラーは`1`、全件判定時は`0`を返す

## 定期実行

### Windowsタスクスケジューラ

PowerShellで毎日6時のタスクを登録する例

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

タスクは専用ブラウザプロファイルへアクセスするため、`auth`を実行したWindowsユーザーで動かす

### cron

Linuxで毎日6時に実行する例

```cron
0 6 * * * cd /opt/x-block-checker && /home/user/.local/bin/x-block-checker check --config x-block-checker.config.json >> data/run.log 2>&1
```

cronから実行する場合も、同じOSユーザーで事前に`x-block-checker auth`を実行する
認証プロファイルや`data/`をGitへ追加しない

## 設定

| キー                | 既定値                             | 内容                                                 |
| ------------------- | ---------------------------------- | ---------------------------------------------------- |
| `users`             | `[]`                               | 確認対象のユーザー名またはプロフィールURL            |
| `input`             | なし                               | ユーザー一覧ファイル（設定ファイルからの相対パス可） |
| `outputDir`         | OSのユーザーデータ領域             | 結果保存先                                           |
| `profileDir`        | OSのユーザーデータ領域内 `profile` | 専用ブラウザプロファイル                             |
| `browserExecutable` | 自動検出                           | Chromium系ブラウザの実行ファイル                     |
| `timeoutSeconds`    | `20`                               | 1件あたりの待機上限（5〜120秒）                      |
| `headless`          | `true`                             | `check`でブラウザを非表示にする                      |
| `relationshipMode`  | `auto`                             | `auto`、`dom`、`passive`、`direct`から選ぶ判定方式   |

CLIオプションは設定ファイルより優先される
全オプションは`x-block-checker --help`で確認できる

### 判定方式

| モード    | 動作                                                                                         |
| --------- | -------------------------------------------------------------------------------------------- |
| `auto`    | 内部GraphQLの直接取得を優先し、取得不能時は通常のプロフィール表示とDOM判定へフォールバック   |
| `dom`     | プロフィール画面のDOMだけで判定                                                              |
| `passive` | 通常のプロフィール表示で発生した内部GraphQLレスポンスとDOMを使用                             |
| `direct`  | 最初の通常表示で内部GraphQLリクエストを捕捉して以後は直接取得を優先し、取得不能時は`unknown` |

内部GraphQLのURL、query ID、feature flags、認証headerは設定や履歴へ保存しない
実行中にブラウザの通常通信から捕捉し、メモリ内だけで再利用する
401、403、ログイン画面、判定材料の欠落時は安全側へ倒す

## 開発

一覧取得は`src/account-lists/`で型・ページ収集・再開処理・保存・CLI出力を共通化する
`src/x/`のブロック用・フォロー用アダプターが、種類ごとの画面遷移と応答解析を担当する
一覧の種類を増やす際も、共通エンジンから各機能のアダプターを呼び出し、ブロック固有の処理には依存させない
`src/storage.ts`は`check`の結果・履歴保存と実行ロックを担当し、一覧の保存は分離している

```powershell
bun run format
bun run typecheck
bun test
bun run build
bun run compile
bun run install-local
bun run check:quality
```

XのWeb UIと内部GraphQLは予告なく変更される可能性がある
確定できない状態を未ブロックとして扱わず、`unknown`として定期実行を異常終了させる設計にしている
過度な実行頻度を避け、通常は1日1回程度にする
