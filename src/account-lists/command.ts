import type { CliOptions } from "../config/args";
import { withRunLock } from "../run-lock";
import type { RuntimeConfig } from "../types";
import { collectAccountList } from "../x/account-list-browser";
import {
	clearAccountListCheckpoint,
	readAccountListCheckpoint,
	saveAccountList,
	saveAccountListCheckpoint,
} from "./storage";
import type { AccountListCheckpoint, AccountListKind } from "./types";

function printAccountList(
	snapshot: AccountListCheckpoint,
	json: boolean,
	kind: AccountListKind,
): void {
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
		`${{ blocking: "ブロックしているアカウント", following: "フォローしているアカウント", followers: "フォロワー" }[kind]}: ${snapshot.accounts.length}件${snapshot.complete ? "" : "（取得途中）"}\n`,
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

async function finishAccountList(
	config: RuntimeConfig,
	checkpoint: AccountListCheckpoint,
	kind: AccountListKind,
): Promise<AccountListCheckpoint> {
	await saveAccountList(config.outputDir, checkpoint, kind);
	await clearAccountListCheckpoint(config.outputDir, kind);
	return checkpoint;
}

async function resumeAccountListBatch(
	options: CliOptions & { command: AccountListKind },
	config: RuntimeConfig,
	checkpoint: AccountListCheckpoint | undefined,
): Promise<AccountListCheckpoint> {
	const retryAt = checkpoint?.retryAt ? Date.parse(checkpoint.retryAt) : 0;
	if (retryAt > Date.now() && options.wait) {
		await waitUntil(retryAt);
	}
	return collectAccountList(config, {
		kind: options.command,
		...(checkpoint ? { checkpoint } : {}),
		pageLimit: options.pageLimit ?? 25,
		onProgress: (progress) =>
			saveAccountListCheckpoint(config.outputDir, progress, options.command),
	});
}

function nextAccountListRun(checkpoint: AccountListCheckpoint): number {
	if (checkpoint.stopReason === "rateLimit" && checkpoint.retryAt) {
		return Date.parse(checkpoint.retryAt);
	}
	return Date.now() + 60000;
}

async function collectList(
	options: CliOptions & { command: AccountListKind },
	config: RuntimeConfig,
): Promise<AccountListCheckpoint> {
	if (options.restart) {
		await clearAccountListCheckpoint(config.outputDir, options.command);
	}
	let checkpoint = await readAccountListCheckpoint(
		config.outputDir,
		options.command,
	);
	if (checkpoint?.complete) {
		return finishAccountList(
			config,
			await collectAccountList(config, { checkpoint, kind: options.command }),
			options.command,
		);
	}
	while (true) {
		checkpoint = await resumeAccountListBatch(options, config, checkpoint);
		await saveAccountListCheckpoint(
			config.outputDir,
			checkpoint,
			options.command,
		);
		if (checkpoint.complete) {
			return finishAccountList(config, checkpoint, options.command);
		}
		if (!options.wait) {
			return checkpoint;
		}
		await waitUntil(nextAccountListRun(checkpoint));
	}
}

/**
 * @param options - 一覧取得コマンドの引数
 * @param config - 解決済みの実行設定
 * @returns 全件取得済みなら終了コード0、取得途中なら2
 */
export async function runAccountListCommand(
	options: CliOptions & { command: AccountListKind },
	config: RuntimeConfig,
): Promise<number> {
	const snapshot = await withRunLock(config.outputDir, () =>
		collectList(options, config),
	);
	printAccountList(snapshot, options.json, options.command);
	if (!options.json) {
		process.stderr.write(`出力: ${config.outputDir}\n`);
	}
	return snapshot.complete ? 0 : 2;
}
