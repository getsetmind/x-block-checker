#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type CliOptions, parseArgs } from "./config/args";
import { resolveConfig } from "./config/resolve";
import { hasErrorCode } from "./errors";
import {
	clearBlockingCheckpoint,
	readBlockingCheckpoint,
	saveBlockingCheckpoint,
	saveBlockingList,
	saveResults,
	withRunLock,
} from "./storage";
import {
	type BlockingCheckpoint,
	type CheckResult,
	type DoctorResult,
	type RuntimeConfig,
	statusLabels,
	visibilityLabels,
} from "./types";
import { authenticate, checkUsers, diagnose, listBlocking } from "./x/browser";

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
		if (hasErrorCode(error, "EEXIST")) {
			throw new Error(`設定ファイルは既に存在します: ${absolutePath}`, {
				cause: error,
			});
		}
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
  x-block-checker doctor [--config <path>] [--json]
  x-block-checker check [@user ...] [options]
  x-block-checker blocking [options]

コマンド:
  init                    設定ファイルの雛形を作成
  auth                    専用プロファイルを開いてXへログイン
  doctor                  ブラウザと認証状態を診断
  check                   設定または引数のユーザーを確認
  blocking                X設定のブロックしているアカウント一覧を取得
                          users/input設定は無視し、ユーザー引数・--inputは不可

オプション:
  -c, --config <path>     設定ファイル (既定: x-block-checker.config.json)
  -i, --input <path>      改行・空白・カンマ区切りのユーザー一覧
      --output-dir <path> checkの結果・履歴、blockingの一覧の保存先
      --profile-dir <path> ブラウザプロファイル保存先
      --browser <path>    Chrome、Brave、Edge、Chromiumの実行ファイル
      --timeout <秒>      1件あたりの待機上限 (5〜120)
      --relationship-mode <mode>
                          判定方式 (auto、dom、passive、direct)
      --headed            check/blockingでもブラウザを表示
      --headless          check/blockingをヘッドレス実行
      --wait              blockingの制限解除・次バッチを待って継続
      --page-limit <N>    blockingの1バッチのページ数 (1〜100、既定25)
      --restart           blockingの再開情報を破棄して最初から取得
      --json              結果をJSONで標準出力
  -h, --help              ヘルプを表示

終了コード:
  0  全件を判定、または一覧取得完了
  1  設定・認証・ブラウザなどの実行エラー
  2  判定不能のユーザーが存在、またはブロック一覧の取得途中
`);
}

function printDoctorResult(result: DoctorResult, json: boolean): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	process.stdout.write(`${result.message}\n`);
	process.stdout.write(`ブラウザ: ${result.browserExecutable}\n`);
	process.stdout.write(`プロファイル: ${result.profileDir}\n`);
	process.stdout.write(`設定済みユーザー: ${result.configuredUsers}\n`);
}

function printTable(results: readonly CheckResult[]): void {
	console.table(
		results.map((result) => ({
			ユーザー: `@${result.username}`,
			結果: statusLabels[result.status],
			公開範囲: visibilityLabels[result.visibility],
			確認日時: new Date(result.checkedAt).toLocaleString("ja-JP"),
		})),
	);
}

async function runCheck(
	options: CliOptions,
	config: RuntimeConfig,
): Promise<CheckResult[]> {
	if (config.users.length === 0) {
		throw new Error(
			"確認するユーザーを設定、引数、または --input で指定してください",
		);
	}

	return withRunLock(config.outputDir, async () => {
		const checked = await checkUsers(config, (index, total, result) => {
			if (!options.json) {
				process.stderr.write(
					`[${index}/${total}] @${result.username}: ${statusLabels[result.status]} / ${visibilityLabels[result.visibility]}\n`,
				);
			}
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
	if (json) {
		process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
	} else {
		printTable(results);
		process.stderr.write(`出力: ${outputDir}\n`);
	}
}

function printBlockingList(snapshot: BlockingCheckpoint, json: boolean): void {
	if (json) {
		const publicResult = snapshot.complete
			? {
					version: snapshot.version,
					checkedAt: snapshot.checkedAt,
					accounts: snapshot.accounts,
				}
			: {
					version: snapshot.version,
					checkedAt: snapshot.checkedAt,
					accounts: snapshot.accounts,
					complete: false,
					source: snapshot.source,
					pages: snapshot.pages,
					startedAt: snapshot.startedAt,
					...(snapshot.retryAt ? { retryAt: snapshot.retryAt } : {}),
					...(snapshot.stopReason ? { stopReason: snapshot.stopReason } : {}),
				};
		process.stdout.write(`${JSON.stringify(publicResult, null, 2)}\n`);
		return;
	}
	console.table(
		snapshot.accounts.map((account) => ({
			ユーザー: `@${account.username}`,
			URL: account.url,
		})),
	);
	process.stdout.write(
		`ブロックしているアカウント: ${snapshot.accounts.length}件${snapshot.complete ? "" : "（取得途中）"}\n`,
	);
}

async function waitUntil(instant: number): Promise<void> {
	const remaining = instant - Date.now();
	if (remaining <= 0) {
		return;
	}
	process.stderr.write(
		`次の取得まで待機します: ${new Date(instant).toISOString()}\n`,
	);
	await new Promise<void>((resolve) =>
		setTimeout(resolve, Math.min(remaining, 2147483647)),
	);
	if (Date.now() < instant) {
		await waitUntil(instant);
	}
}

async function finishBlocking(
	config: RuntimeConfig,
	checkpoint: BlockingCheckpoint,
): Promise<BlockingCheckpoint> {
	await saveBlockingList(config.outputDir, checkpoint);
	await clearBlockingCheckpoint(config.outputDir);
	return checkpoint;
}

async function resumeBlockingBatch(
	options: CliOptions,
	config: RuntimeConfig,
	checkpoint: BlockingCheckpoint | undefined,
): Promise<BlockingCheckpoint> {
	const retryAt = checkpoint?.retryAt ? Date.parse(checkpoint.retryAt) : 0;
	if (retryAt > Date.now()) {
		if (!options.wait && checkpoint) {
			return checkpoint;
		}
		await waitUntil(retryAt);
	}
	return listBlocking(config, {
		...(checkpoint ? { checkpoint } : {}),
		pageLimit: options.pageLimit ?? 25,
		onProgress: (progress) =>
			saveBlockingCheckpoint(config.outputDir, progress),
	});
}

function nextBlockingRun(checkpoint: BlockingCheckpoint): number {
	if (checkpoint.stopReason === "rateLimit" && checkpoint.retryAt) {
		return Date.parse(checkpoint.retryAt);
	}
	return Date.now() + 60000;
}

async function collectBlocking(
	options: CliOptions,
	config: RuntimeConfig,
): Promise<BlockingCheckpoint> {
	if (options.restart) {
		await clearBlockingCheckpoint(config.outputDir);
	}
	let checkpoint = await readBlockingCheckpoint(config.outputDir);
	if (checkpoint?.complete) {
		return finishBlocking(config, await listBlocking(config, { checkpoint }));
	}
	while (true) {
		checkpoint = await resumeBlockingBatch(options, config, checkpoint);
		await saveBlockingCheckpoint(config.outputDir, checkpoint);
		if (checkpoint.complete) {
			return finishBlocking(config, checkpoint);
		}
		if (!options.wait) {
			return checkpoint;
		}
		await waitUntil(nextBlockingRun(checkpoint));
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
		case "doctor": {
			const config = await resolveConfig(options);
			const result = await diagnose(config);
			printDoctorResult(result, options.json);
			return result.ready ? 0 : 1;
		}
		case "blocking": {
			const config = await resolveConfig(options);
			const snapshot = await withRunLock(config.outputDir, () =>
				collectBlocking(options, config),
			);
			printBlockingList(snapshot, options.json);
			if (!options.json) {
				process.stderr.write(`出力: ${config.outputDir}\n`);
			}
			return snapshot.complete ? 0 : 2;
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
