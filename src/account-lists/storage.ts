import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { isUsername } from "../config/usernames";
import { hasErrorCode } from "../errors";
import { serializeJson, writeAtomic } from "../persistence";
import type {
	Account,
	AccountListCheckpoint,
	AccountListKind,
	AccountListSnapshot,
} from "./types";

/**
 * @param outputDir - 保存先ディレクトリ
 * @param snapshot - 全件取得済みの一覧
 * @param kind - 保存対象の一覧種別
 */
export async function saveAccountList(
	outputDir: string,
	snapshot: AccountListSnapshot,
	kind: AccountListKind,
): Promise<void> {
	await mkdir(outputDir, { recursive: true });
	const markdown = [
		`# Xで${accountListTitles[kind]}`,
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
		join(outputDir, `${kind}.json`),
		serializeJson({
			version: snapshot.version,
			checkedAt: snapshot.checkedAt,
			accounts: snapshot.accounts,
		}),
	);
	await writeAtomic(join(outputDir, `${kind}.md`), markdown);
}

const accountListTitles: Record<AccountListKind, string> = {
	blocking: "自分がブロックしているユーザー",
	following: "自分がフォローしているユーザー",
	followers: "自分をフォローしているユーザー",
};

const accountListLabels: Record<AccountListKind, string> = {
	blocking: "ブロック一覧",
	following: "フォロー一覧",
	followers: "フォロワー一覧",
};

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

function isAccount(value: unknown): value is Account {
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

function isCheckpoint(value: unknown): value is AccountListCheckpoint {
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
 * @param kind - 保存対象の一覧種別
 * @returns 検証済みの再開情報、保存ファイルがなければundefined
 */
export async function readAccountListCheckpoint(
	outputDir: string,
	kind: AccountListKind,
): Promise<AccountListCheckpoint | undefined> {
	let contents: string;
	try {
		contents = await readFile(join(outputDir, `${kind}-progress.json`), "utf8");
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
			`${accountListLabels[kind]}の再開情報が不正です。--restartで最初から取得してください`,
		);
	}
	if (!isCheckpoint(value)) {
		throw new Error(
			`${accountListLabels[kind]}の再開情報が不正です。--restartで最初から取得してください`,
		);
	}
	return value;
}

/**
 * @param outputDir - 保存先ディレクトリ
 * @param progress - 再開可能な取得進捗
 * @param kind - 保存対象の一覧種別
 */
export async function saveAccountListCheckpoint(
	outputDir: string,
	progress: AccountListCheckpoint,
	kind: AccountListKind,
): Promise<void> {
	if (!isCheckpoint(progress)) {
		throw new Error(`${accountListLabels[kind]}の再開情報が不正です`);
	}
	await mkdir(outputDir, { recursive: true });
	await writeAtomic(
		join(outputDir, `${kind}-progress.json`),
		serializeJson(progress),
	);
	const { ownerId: _ownerId, nextCursor: _nextCursor, ...partial } = progress;
	await writeAtomic(
		join(outputDir, `${kind}.partial.json`),
		serializeJson(partial),
	);
	const markdown = [
		progress.complete
			? `# Xで${accountListTitles[kind]}（全件取得済み）`
			: `# Xで${accountListTitles[kind]}（取得途中）`,
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
	await writeAtomic(join(outputDir, `${kind}.partial.md`), markdown);
}

/**
 * @param outputDir - 保存先ディレクトリ
 * @param kind - 保存対象の一覧種別
 */
export async function clearAccountListCheckpoint(
	outputDir: string,
	kind: AccountListKind,
): Promise<void> {
	await rm(join(outputDir, `${kind}-progress.json`), { force: true });
}
