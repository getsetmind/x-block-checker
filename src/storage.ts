import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isUsername } from "./config/usernames";
import { hasErrorCode } from "./errors";
import {
	type BlockingAccount,
	type BlockingCheckpoint,
	type BlockingList,
	type CheckResult,
	type History,
	statusLabels,
} from "./types";

function emptyHistory(): History {
	return {
		version: 1,
		updatedAt: new Date(0).toISOString(),
		results: {},
	};
}

function isHistory(value: unknown): value is History {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Partial<History>;
	return (
		candidate.version === 1 &&
		typeof candidate.updatedAt === "string" &&
		typeof candidate.results === "object" &&
		candidate.results !== null &&
		!Array.isArray(candidate.results)
	);
}

function serializeJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeAtomic(path: string, contents: string): Promise<void> {
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		await writeFile(temporary, contents, "utf8");
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

async function readHistory(path: string): Promise<History> {
	try {
		const value: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!isHistory(value)) {
			throw new Error("未対応の履歴形式です");
		}
		return value;
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) {
			return emptyHistory();
		}
		throw new Error(`履歴を読み込めません: ${path}`, { cause: error });
	}
}

function mergeHistory(
	history: History,
	current: readonly CheckResult[],
): History {
	const results: History["results"] = Object.assign(
		Object.create(null) as History["results"],
		history.results,
	);
	for (const result of current) {
		results[result.username.toLowerCase()] = result;
	}
	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		results,
	};
}

function blockedMarkdown(results: readonly CheckResult[]): string {
	const blocked = results
		.filter(
			(result) => result.status === "blocked" || result.status === "mutual",
		)
		.sort((left, right) => left.username.localeCompare(right.username));
	return [
		"# Xで自分をブロックしているユーザー",
		"",
		...blocked.map(
			(result) =>
				`- [@${result.username}](${result.url}) - ${statusLabels[result.status]} / 確認: ${result.checkedAt.slice(0, 10)}`,
		),
		"",
	].join("\n");
}

/**
 * 判定結果をlatest.json、history.json、blocked.mdへ原子的に保存する
 *
 * @param outputDir - 保存先ディレクトリ
 * @param current - 今回の判定結果
 */
export async function saveResults(
	outputDir: string,
	current: readonly CheckResult[],
): Promise<void> {
	await mkdir(outputDir, { recursive: true });
	const historyPath = join(outputDir, "history.json");
	const history = mergeHistory(await readHistory(historyPath), current);
	await writeAtomic(join(outputDir, "latest.json"), serializeJson(current));
	await writeAtomic(historyPath, serializeJson(history));
	await writeAtomic(
		join(outputDir, "blocked.md"),
		blockedMarkdown(Object.values(history.results)),
	);
}

/**
 * X設定から取得したブロック一覧で保存済みの一覧を置き換える
 *
 * @param outputDir - 保存先ディレクトリ
 * @param snapshot - 全件取得済みの一覧
 */
export async function saveBlockingList(
	outputDir: string,
	snapshot: BlockingList,
): Promise<void> {
	await mkdir(outputDir, { recursive: true });
	const markdown = [
		"# Xで自分がブロックしているユーザー",
		"",
		`確認日時: ${snapshot.checkedAt}`,
		`件数: ${snapshot.accounts.length}`,
		"",
		...snapshot.accounts.map(
			(account) => `- [@${account.username}](${account.url})`,
		),
		"",
	].join("\n");
	await writeAtomic(
		join(outputDir, "blocking.json"),
		serializeJson({
			version: snapshot.version,
			checkedAt: snapshot.checkedAt,
			accounts: snapshot.accounts,
		}),
	);
	await writeAtomic(join(outputDir, "blocking.md"), markdown);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}

function isDate(value: unknown): value is string {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
		return false;
	}
	return new Date(value).toISOString() === value;
}

function isAccount(value: unknown): value is BlockingAccount {
	if (!isRecord(value) || !hasOnlyKeys(value, ["id", "username", "url"])) {
		return false;
	}
	return (
		typeof value.id === "string" &&
		/^[1-9]\d*$/.test(value.id) &&
		typeof value.username === "string" &&
		isUsername(value.username) &&
		value.url === `https://x.com/${value.username}`
	);
}

function hasValidPosition(value: Record<string, unknown>): boolean {
	if (value.pages === 0) {
		return (
			value.complete === false &&
			value.nextCursor === null &&
			Array.isArray(value.accounts) &&
			value.accounts.length === 0
		);
	}
	if (value.complete === true) {
		return value.nextCursor === null;
	}
	if (value.nextCursor === null) {
		return false;
	}
	return value.source !== "rest" || value.nextCursor !== "0";
}

function hasValidProgressState(value: Record<string, unknown>): boolean {
	if (!hasValidPosition(value)) {
		return false;
	}
	if (value.complete === true) {
		return (
			value.nextCursor === null &&
			value.stopReason === undefined &&
			value.retryAt === undefined
		);
	}

	if (
		value.retryAt !== undefined &&
		(!isDate(value.retryAt) || value.stopReason !== "rateLimit")
	) {
		return false;
	}
	if (value.stopReason === "rateLimit" && value.retryAt === undefined) {
		return false;
	}
	return (
		value.stopReason === undefined ||
		value.stopReason === "rateLimit" ||
		value.stopReason === "pageLimit"
	);
}

function isCursor(value: unknown): boolean {
	if (value === null) {
		return true;
	}
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 8192 &&
		!/\s|https?:\/\//i.test(value) &&
		!Array.from(value).some((character) => character.charCodeAt(0) < 32)
	);
}

function isCheckpoint(value: unknown): value is BlockingCheckpoint {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"version",
			"checkedAt",
			"accounts",
			"source",
			"nextCursor",
			"pages",
			"startedAt",
			"complete",
			"retryAt",
			"stopReason",
			"ownerId",
		])
	) {
		return false;
	}
	if (
		value.version !== 1 ||
		!isDate(value.checkedAt) ||
		!isDate(value.startedAt) ||
		value.startedAt > value.checkedAt
	) {
		return false;
	}
	if (!Array.isArray(value.accounts) || !value.accounts.every(isAccount)) {
		return false;
	}
	if (
		new Set(value.accounts.map((account) => account.id)).size !==
		value.accounts.length
	) {
		return false;
	}
	if (typeof value.ownerId !== "string" || !/^[1-9]\d*$/.test(value.ownerId)) {
		return false;
	}
	if (value.source !== "graphql" && value.source !== "rest") {
		return false;
	}
	if (!isCursor(value.nextCursor)) {
		return false;
	}
	if (
		typeof value.pages !== "number" ||
		!Number.isSafeInteger(value.pages) ||
		value.pages < 0 ||
		typeof value.complete !== "boolean"
	) {
		return false;
	}
	return hasValidProgressState(value);
}

/**
 * @param outputDir - 保存先ディレクトリ
 */
export async function readBlockingCheckpoint(
	outputDir: string,
): Promise<BlockingCheckpoint | undefined> {
	let contents: string;
	try {
		contents = await readFile(
			join(outputDir, "blocking-progress.json"),
			"utf8",
		);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) {
			return undefined;
		}
		throw error;
	}
	let value: unknown;
	try {
		value = JSON.parse(contents);
	} catch {
		// biome-ignore lint/style/useErrorCause: 再開ファイルの内容を例外経由で表示しない
		throw new Error(
			"ブロック一覧の再開情報が不正です。--restartで最初から取得してください",
		);
	}
	if (!isCheckpoint(value)) {
		throw new Error(
			"ブロック一覧の再開情報が不正です。--restartで最初から取得してください",
		);
	}
	return value;
}

/**
 * @param outputDir - 保存先ディレクトリ
 * @param progress - 再開可能な取得進捗
 */
export async function saveBlockingCheckpoint(
	outputDir: string,
	progress: BlockingCheckpoint,
): Promise<void> {
	if (!isCheckpoint(progress)) {
		throw new Error("ブロック一覧の再開情報が不正です");
	}
	await mkdir(outputDir, { recursive: true });
	await writeAtomic(
		join(outputDir, "blocking-progress.json"),
		serializeJson(progress),
	);
	const { ownerId: _ownerId, nextCursor: _nextCursor, ...partial } = progress;
	await writeAtomic(
		join(outputDir, "blocking.partial.json"),
		serializeJson(partial),
	);
	const markdown = [
		progress.complete
			? "# Xで自分がブロックしているユーザー（全件取得済み）"
			: "# Xで自分がブロックしているユーザー（取得途中）",
		"",
		progress.complete
			? "全件取得が完了しました"
			: "全件取得済みの一覧ではありません",
		"",
		`確認日時: ${progress.checkedAt}`,
		`件数: ${progress.accounts.length}`,
		`取得ページ数: ${progress.pages}`,
		"",
		...progress.accounts.map(
			(account) => `- [@${account.username}](${account.url})`,
		),
		"",
	].join("\n");
	await writeAtomic(join(outputDir, "blocking.partial.md"), markdown);
}

/**
 * @param outputDir - 保存先ディレクトリ
 */
export async function clearBlockingCheckpoint(
	outputDir: string,
): Promise<void> {
	await rm(join(outputDir, "blocking-progress.json"), { force: true });
}

function parseLockPid(contents: string): number | null {
	const pid = Number(contents.split(/\s+/, 1)[0]);
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isProcessRunning(pid: number | null): boolean {
	if (pid === null) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return hasErrorCode(error, "EPERM");
	}
}

async function createLock(lockPath: string): Promise<FileHandle> {
	const handle = await open(lockPath, "wx");
	try {
		await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
		return handle;
	} catch (error) {
		await handle.close();
		await rm(lockPath, { force: true });
		throw error;
	}
}

async function readLockContents(lockPath: string): Promise<string | undefined> {
	try {
		return await readFile(lockPath, "utf8");
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) {
			return undefined;
		}
		throw error;
	}
}

async function acquireLock(lockPath: string): Promise<FileHandle> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			return await createLock(lockPath);
		} catch (error) {
			if (!hasErrorCode(error, "EEXIST")) {
				throw error;
			}

			const contents = await readLockContents(lockPath);
			if (contents === undefined) {
				continue;
			}

			if (isProcessRunning(parseLockPid(contents)) || attempt > 0) {
				throw new Error(`別の実行が進行中です: ${lockPath}`, { cause: error });
			}
			await rm(lockPath, { force: true });
		}
	}
	throw new Error(`実行ロックを取得できません: ${lockPath}`);
}

/**
 * run.lockを取得してからactionを実行し、終了時に必ず解放する
 *
 * @typeParam T - actionが返す値の型
 * @param outputDir - ロックファイルを置く出力先
 * @param action - ロック保持中に実行する処理
 */
export async function withRunLock<T>(
	outputDir: string,
	action: () => Promise<T>,
): Promise<T> {
	await mkdir(outputDir, { recursive: true });
	const lockPath = join(outputDir, "run.lock");
	const handle = await acquireLock(lockPath);
	try {
		return await action();
	} finally {
		try {
			await handle.close();
		} finally {
			await rm(lockPath, { force: true });
		}
	}
}
