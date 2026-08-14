#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type CliOptions, parseArgs } from "./args.js";
import { authenticate, checkUsers } from "./browser.js";
import { resolveConfig } from "./config.js";
import { saveResults, withRunLock } from "./storage.js";
import { type CheckResult, type RuntimeConfig, statusLabels } from "./types.js";

function hasErrorCode(error: unknown, code: string): boolean {
	return (error as NodeJS.ErrnoException).code === code;
}

async function initialize(path: string): Promise<void> {
	const absolutePath = resolve(path);
	try {
		await writeFile(
			absolutePath,
			`${JSON.stringify(
				{
					users: [],
					outputDir: "./data",
					timeoutSeconds: 20,
					headless: true,
					relationshipMode: "auto",
				},
				null,
				2,
			)}\n`,
			{ encoding: "utf8", flag: "wx" },
		);
	} catch (error) {
		if (hasErrorCode(error, "EEXIST"))
			throw new Error(`設定ファイルは既に存在します: ${absolutePath}`);
		throw error;
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
      --relationship-mode <mode>
                          判定方式 (auto、dom、passive、direct)
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

function printTable(results: readonly CheckResult[]): void {
	console.table(
		results.map((result) => ({
			ユーザー: `@${result.username}`,
			結果: statusLabels[result.status],
			確認日時: new Date(result.checkedAt).toLocaleString("ja-JP"),
		})),
	);
}

async function runCheck(
	options: CliOptions,
	config: RuntimeConfig,
): Promise<CheckResult[]> {
	if (config.users.length === 0)
		throw new Error(
			"確認するユーザーを設定、引数、または --input で指定してください",
		);

	return withRunLock(config.outputDir, async () => {
		const checked = await checkUsers(config, (index, total, result) => {
			if (!options.json)
				process.stderr.write(
					`[${index}/${total}] @${result.username}: ${statusLabels[result.status]}\n`,
				);
		});
		await saveResults(config.outputDir, checked);
		return checked;
	});
}

function printResults(
	results: readonly CheckResult[],
	json: boolean,
	outputDir: string,
): void {
	if (json) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
	else {
		printTable(results);
		process.stderr.write(`出力: ${outputDir}\n`);
	}
}

async function main(): Promise<number> {
	const options = parseArgs(process.argv.slice(2));
	switch (options.command) {
		case "help":
			printHelp();
			return 0;
		case "init":
			await initialize(options.configPath);
			return 0;
		case "auth": {
			const config = await resolveConfig(options);
			await authenticate(config);
			process.stdout.write(`Xの認証を保存しました: ${config.profileDir}\n`);
			return 0;
		}
		case "check": {
			const config = await resolveConfig(options);
			const results = await runCheck(options, config);
			printResults(results, options.json, config.outputDir);
			return results.some((result) => result.status === "unknown") ? 2 : 0;
		}
	}
}

try {
	process.exitCode = await main();
} catch (error) {
	process.stderr.write(
		`エラー: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
