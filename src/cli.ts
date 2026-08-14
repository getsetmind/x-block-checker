#!/usr/bin/env node

import type { FileHandle } from "node:fs/promises";
import { mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "./args.js";
import { authenticate, checkUsers } from "./browser.js";
import { resolveConfig } from "./config.js";
import { saveResults, withRunLock } from "./storage.js";
import { type CheckResult, statusLabels } from "./types.js";

const configTemplate = {
	users: [],
	outputDir: "./data",
	timeoutSeconds: 20,
	headless: true,
};

async function initialize(path: string): Promise<void> {
	const absolutePath = resolve(path);
	let handle: FileHandle;
	try {
		handle = await open(absolutePath, "wx");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new Error(`設定ファイルは既に存在します: ${absolutePath}`);
		throw error;
	}
	try {
		await handle.writeFile(`${JSON.stringify(configTemplate, null, 2)}\n`);
	} finally {
		await handle.close();
	}
	process.stdout.write(`設定ファイルを作成しました: ${absolutePath}\n`);
}

function printHelp(): void {
	process.stdout.write(`X Block Checker

専用ブラウザプロファイルを使い、Xのブロック関係を確認・記録します。

使い方:
  x-block-checker init [--config <path>]
  x-block-checker auth [--config <path>]
  x-block-checker check [@user ...] [options]

コマンド:
  init                    設定ファイルの雛形を作成
  auth                    専用プロファイルを開いてXへログイン
  check                   設定または引数のユーザーを確認

オプション:
  -c, --config <path>     設定ファイル (既定: x-block-checker.config.json)
  -i, --input <path>      改行・空白・カンマ区切りのユーザー一覧
      --output-dir <path> latest.json、history.json、blocked.mdの保存先
      --profile-dir <path> ブラウザプロファイル保存先
      --browser <path>    Chrome、Brave、Edge、Chromiumの実行ファイル
      --timeout <秒>      1件あたりの待機上限 (5〜120)
      --headed            checkでもブラウザを表示
      --headless          checkをヘッドレス実行
      --json              結果をJSONで標準出力
  -h, --help              ヘルプを表示

終了コード:
  0  全件を判定
  1  設定・認証・ブラウザなどの実行エラー
  2  判定不能のユーザーが1件以上存在
`);
}

function printTable(results: CheckResult[]): void {
	console.table(
		results.map((result) => ({
			ユーザー: `@${result.username}`,
			結果: statusLabels[result.status],
			確認日時: new Date(result.checkedAt).toLocaleString("ja-JP"),
		})),
	);
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	if (options.command === "help") {
		printHelp();
		return;
	}
	if (options.command === "init") {
		await initialize(options.configPath);
		return;
	}
	const config = await resolveConfig(options);
	if (options.command === "auth") {
		await authenticate(config);
		process.stdout.write(`Xの認証を保存しました: ${config.profileDir}\n`);
		return;
	}
	if (config.users.length === 0)
		throw new Error(
			"確認するユーザーを設定、引数、または --input で指定してください",
		);
	await mkdir(config.outputDir, { recursive: true });
	const results = await withRunLock(config.outputDir, async () => {
		const checked = await checkUsers(config, (index, total, result) => {
			if (!options.json)
				process.stderr.write(
					`[${index}/${total}] @${result.username}: ${statusLabels[result.status]}\n`,
				);
		});
		await saveResults(config.outputDir, checked);
		return checked;
	});
	if (options.json)
		process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
	else {
		printTable(results);
		process.stderr.write(`出力: ${config.outputDir}\n`);
	}
	if (results.some((result) => result.status === "unknown"))
		process.exitCode = 2;
}

try {
	await main();
} catch (error) {
	process.stderr.write(
		`エラー: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
