import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CheckResult, type History, statusLabels } from "./types.js";

const HISTORY_VERSION = 1;
const LOCK_ATTEMPTS = 2;

function emptyHistory(): History {
	return {
		version: 1,
		updatedAt: new Date(0).toISOString(),
		results: {},
	};
}

function hasErrorCode(error: unknown, code: string): boolean {
	return (error as NodeJS.ErrnoException).code === code;
}

function isHistory(value: unknown): value is History {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<History>;
	return (
		candidate.version === HISTORY_VERSION &&
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
		if (!isHistory(value)) throw new Error("未対応の履歴形式です");
		return value;
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return emptyHistory();
		throw new Error(`履歴を読み込めません: ${path}`, { cause: error });
	}
}

function mergeHistory(
	history: History,
	current: readonly CheckResult[],
): History {
	const results = { ...history.results };
	for (const result of current) results[result.username.toLowerCase()] = result;
	return {
		version: HISTORY_VERSION,
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

function parseLockPid(contents: string): number | null {
	const pid = Number(contents.split(/\s+/, 1)[0]);
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isProcessRunning(pid: number | null): boolean {
	if (pid === null) return false;
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

async function acquireLock(lockPath: string): Promise<FileHandle> {
	for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
		try {
			return await createLock(lockPath);
		} catch (error) {
			if (!hasErrorCode(error, "EEXIST")) throw error;

			let contents: string;
			try {
				contents = await readFile(lockPath, "utf8");
			} catch (readError) {
				if (hasErrorCode(readError, "ENOENT")) continue;
				throw readError;
			}

			if (isProcessRunning(parseLockPid(contents)) || attempt > 0)
				throw new Error(`別の実行が進行中です: ${lockPath}`);
			await rm(lockPath, { force: true });
		}
	}
	throw new Error(`実行ロックを取得できません: ${lockPath}`);
}

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
