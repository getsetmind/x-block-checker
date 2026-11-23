# X Block Checker

Xで自分をブロックしているユーザーを定期的に確認し、判定結果をJSONで記録するCLIツール
あわせて、自分のブロック一覧・フォロー一覧・フォロワー一覧を取得できる

公式X APIやCookieの手動書き出しは使わない
通常起動したChromiumの専用プロファイルへ一度ログインしておけば、以後はPuppeteer Coreが同じプロファイルを使い、プロフィール画面とブラウザ自身の通信（`UserByScreenName`レスポンス）から関係を判定する

## 必要環境

- Bun 1.3以降（ソースから実行・ビルドする場合）
- Chrome、Brave、Edge、Chromiumのいずれか

コンパイル済みの実行ファイルは、Node.js、Bun、npmを必要としない
タグ付きReleaseには、macOS Apple Silicon、Linux x64、Windows x64向けの単一実行ファイルと`SHA256SUMS`を添付している
実行ファイルとチェックサムは同じReleaseから取得し、照合してから使う

## セットアップ

ソースから実行ファイルを生成して配置する

```powershell
cd C:\Dev\Repos\Tools\x-block-checker
bun install
bun run install-local
Copy-Item x-block-checker.config.example.json x-block-checker.config.json
```

`install-local`は単一実行ファイルを生成し、Windowsでは`C:\Users\yuu21\bin\tools\x-block-checker.exe`、Linuxでは`~/.local/bin/x-block-checker`へ置く
配置せずプロジェクト内の生成物（`dist/`）を使う場合は、`bun run compile`を実行する

設定ファイルの`users`に、確認したいユーザー名を書く

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

### ログイン

初回だけ、専用ブラウザを表示してXへログインする

```powershell
x-block-checker auth
```

`auth`は、Puppeteerやリモートデバッグを使わず、専用プロファイルを指定した通常のブラウザを起動する
ログインを終えたらブラウザを終了する（macOSではウィンドウを閉じるだけでは終了しないため、`Command+Q`で完全に終了する）
終了後、通常起動と同じmacOS Keychainで認証Cookieを検証し、ログインできていなければエラーを返す
認証が切れたときも、同じコマンドを再実行する

### 診断

`doctor`は、ブラウザの検出、専用プロファイル、認証Cookieを診断する
外部プログラムから呼ぶ場合は`--json`を付ける
終了コード`0`は利用可能、`1`は未準備を表す

```powershell
x-block-checker doctor --json
```

## ブロック関係の確認

設定ファイルのユーザーを確認する

```powershell
x-block-checker check
```

引数やテキストファイルで、一時的に対象を追加することもできる

```powershell
x-block-checker check @user3 https://x.com/user4
x-block-checker check --input .\users.txt
x-block-checker check --json
```

プロジェクト内の実行ファイルを直接呼ぶ場合は、次のとおり

```powershell
.\dist\x-block-checker.exe check
```

### 判定結果

判定状態は`blocked`、`mutual`、`blocking`、`clear`、`notFound`、`suspended`、`unknown`の7種類
公開範囲は`public`、`protected`、`unknown`で、判定状態とは別に出力する
「未ブロックかつ鍵アカウント」のように、両方の情報を残せる

終了コードは次のとおり

| 終了コード | 意味                                      |
| ---------- | ----------------------------------------- |
| `0`        | 全件を判定できた                          |
| `1`        | 設定・認証・ブラウザなどの実行エラー      |
| `2`        | 判定できない（`unknown`の）ユーザーがいる |

### 判定方式

`relationshipMode`（`--relationship-mode`）で選ぶ

| モード    | 動作                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `auto`    | 内部GraphQLの直接取得を優先し、取得できなければ通常のプロフィール表示とDOM判定へ切り替える           |
| `dom`     | プロフィール画面のDOMだけで判定する                                                                  |
| `passive` | 通常のプロフィール表示で発生した内部GraphQLレスポンスとDOMを使う                                     |
| `direct`  | 最初の通常表示で内部GraphQLリクエストを捕捉し、以後は直接取得を優先する（取得できなければ`unknown`） |

内部GraphQLのURL、query ID、feature flags、認証headerは、設定にも履歴にも保存しない
実行中にブラウザの通常通信から捕捉し、メモリ内だけで再利用する
401、403、ログイン画面、判定材料の欠落では、確定できないものとして`unknown`を返す

## 自分のブロック・フォロー・フォロワー一覧

次の3コマンドで、`auth`でログインした本人の一覧を取得する
他人のユーザー名は指定できない

| コマンド    | 取得する一覧                                    |
| ----------- | ----------------------------------------------- |
| `blocking`  | Xの設定画面「ブロックしているアカウント」の一覧 |
| `following` | 自分がフォローしているアカウント                |
| `followers` | 自分をフォローしているアカウント                |

```powershell
x-block-checker blocking
x-block-checker blocking --json
x-block-checker blocking --wait
x-block-checker blocking --page-limit 50
x-block-checker blocking --restart
x-block-checker following --json
x-block-checker followers --wait --page-limit 50
```

3コマンドとも、`--json`、`--markdown`、`--wait`、`--page-limit`、`--restart`を使える
設定の`users`と`input`は使わず、ユーザー引数や`--input`を指定するとエラーになる

通常の出力は、ユーザー名・表示名・プロフィールURLの表と件数
`--json`では、`version`、`checkedAt`、`accounts`を持つ一覧を返す
各アカウントには、ユーザー名、数値ID、表示名（`displayName`）、プロフィールURLが入る

### 分割取得と再開

一覧は、1回の実行で25ページまで取得する（`--page-limit`で1〜100に変更できる）
ページごとに途中の一覧と再開情報を保存するので、同じコマンドをもう一度実行すると、種類ごとに保存済みの続きから取得する
中断した場合も、保存済みのページから再開できる

取得が途中で止まったときの終了コードは`2`で、JSONには`complete: false`、`pages`、`startedAt`を含める
アクセス頻度制限などで止まった場合は、`retryAt`と`stopReason`も含める
内部カーソルと所有アカウントIDは、標準出力にも途中の一覧にも含めない
全件の取得に成功したときだけ、完全な一覧を置き換え、再開情報と途中の一覧を削除する

`--wait`を付けると、取得を止めずに待機して続ける
ページ数の上限に達したときは60秒、アクセス頻度制限のときはXが示す再試行時刻まで待つ（時刻を取得できなければ15分待つ）
待機中も、実行ロックを保持する

起動した時点で再試行時刻が未来にある場合、`--wait`なしでは、ブラウザでログインアカウントだけを確認し、一覧を取得する通信は行わずに途中結果を返す
`--restart`は、指定した種類の再開情報だけを破棄し、最初から取得し直す

### 取得結果の性質

走査中にブロックやフォローの関係が変わることがあるため、取得結果は単一時点の厳密なスナップショットではない
設定・認証・未対応の応答形式などのエラーは、終了コード`1`を返す

## 出力

`outputDir`の下に、用途ごとのディレクトリを作り、原子的に更新する
既定ではJSONだけを保存し、Markdownは`--markdown`（設定では`"markdown": true`）を付けたときだけ追加で保存する

| パス                              | 内容                                                             | 存在する期間             |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------ |
| `check/latest.json`               | `check`の今回の実行結果                                          | 常に                     |
| `check/history.json`              | ユーザー名単位の最新判定履歴                                     | 常に                     |
| `check/blocked.md`                | 自分をブロックしているユーザー（`blocked`と`mutual`）の一覧      | `--markdown`指定時       |
| `lists/<種類>.json`               | 全件取得済みの最新一覧（`blocking`・`following`・`followers`）   | 常に                     |
| `lists/<種類>.md`                 | `lists/<種類>.json`と同じ一覧のMarkdown                          | `--markdown`指定時       |
| `progress/<種類>.checkpoint.json` | 所有アカウントIDと次ページのカーソルを含む再開情報               | 取得途中だけ             |
| `progress/<種類>.partial.json`    | 取得済みの途中一覧と進捗（カーソル・所有アカウントIDは含めない） | 取得途中だけ             |
| `progress/<種類>.partial.md`      | 取得途中と明記したMarkdown一覧                                   | 取得途中かつ`--markdown` |
| `run.lock`                        | 重複起動を防ぐロック                                             | 実行中・待機中だけ       |

`check`は、`check/`の`latest.json`と`history.json`を更新する
`blocked.md`は、履歴全体の最新判定から作るので、今回確認しなかったユーザーも残る
一覧取得は、全件を取得できたときだけ`lists/`の一覧を置き換える（0件なら空の一覧になる）
完了後に残るのは`lists/`の一覧だけで、`progress/`のファイルはすべて削除される

一覧の種類と`check`の結果は、互いに上書きしない
再開情報には、認証Cookie、内部URL、query ID、認証headerを保存しない
所有アカウントが異なる再開情報は使えないため、ログインするアカウントを変えたときは`--restart`で取り直す

## 定期実行

過度な実行頻度は避け、通常は1日1回程度にする
定期実行するタスクは、`auth`を実行したOSユーザーで動かす
専用ブラウザプロファイルは、そのユーザーしかアクセスできないためである

### Windowsタスクスケジューラ

PowerShellで、毎日6時に実行するタスクを登録する例

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

### cron

Linuxで、毎日6時に実行する例

```cron
0 6 * * * cd /opt/x-block-checker && /home/user/.local/bin/x-block-checker check --config x-block-checker.config.json >> data/run.log 2>&1
```

## 設定

| キー                | 既定値                              | 内容                                                 |
| ------------------- | ----------------------------------- | ---------------------------------------------------- |
| `users`             | `[]`                                | 確認対象のユーザー名またはプロフィールURL            |
| `input`             | なし                                | ユーザー一覧ファイル（設定ファイルからの相対パス可） |
| `outputDir`         | OSのユーザーデータ領域              | 結果の保存先                                         |
| `profileDir`        | OSのユーザーデータ領域内の`profile` | 専用ブラウザプロファイル                             |
| `browserExecutable` | 自動検出                            | Chromium系ブラウザの実行ファイル                     |
| `timeoutSeconds`    | `20`                                | 1件あたりの待機上限（5〜120秒）                      |
| `headless`          | `true`                              | `check`と一覧取得でブラウザを表示しない              |
| `relationshipMode`  | `auto`                              | 判定方式（`auto`、`dom`、`passive`、`direct`）       |
| `markdown`          | `false`                             | Markdownも保存する                                   |

CLIオプションは設定ファイルより優先される
全オプションは`x-block-checker --help`で確認できる

## 開発

```powershell
bun run format
bun run typecheck
bun test
bun run build
bun run compile
bun run install-local
bun run check:quality
```

### 構成

一覧取得の型・待機・再開・保存・CLI出力は、`src/account-lists/`に共通化している
ページの収集、重複の除外、HTTPエラーの処理は、一覧の種類を知らない`src/x/account-list.ts`が担当する
種類ごとの画面遷移と応答の解析は、`src/x/`のブロック用・フォロー用アダプターが担当する
一覧の種類を増やすときも、共通のエンジンから各アダプターを呼び出す構成にし、ブロック固有の処理には依存させない

`src/storage.ts`は`check`の結果と履歴の保存を担当し、一覧の保存とは分けてある
`check`と一覧取得は、`src/run-lock.ts`の実行ロックと`src/persistence.ts`の原子的なファイル保存を共用する
出力先のパスは`src/output-paths.ts`にまとめている

### 注意

XのWeb UIと内部GraphQLは、予告なく変更される可能性がある
判定を確定できないときは、未ブロックとして扱わず`unknown`を返し、終了コード`2`で定期実行を異常終了させる
