import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CheckResult, type History, statusLabels } from "./types.js";

const emptyHistory = (): History => ({
	version: 1,
	updatedAt: new Date(0).toISOString(),
	results: {},
});

async function writeAtomic(path: string, contents: string): Promise<void> {
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, contents, "utf8");
	await rename(temporary, path);
}

async function readHistory(path: string): Promise<History> {
	try {
		const value = JSON.parse(await readFile(path, "utf8")) as History;
		if (value.version !== 1 || !value.results)
			throw new Error("未対応の履歴形式です");
		return value;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return emptyHistory();
		throw new Error(`履歴を読み込めません: ${path}`, { cause: error });
	}
}

function blockedMarkdown(results: CheckResult[]): string {
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
	current: CheckResult[],
): Promise<void> {
	await mkdir(outputDir, { recursive: true });
	const historyPath = join(outputDir, "history.json");
	const history = await readHistory(historyPath);
	for (const result of current)
		history.results[result.username.toLowerCase()] = result;
	history.updatedAt = new Date().toISOString();
	await writeAtomic(
		join(outputDir, "latest.json"),
		`${JSON.stringify(current, null, 2)}\n`,
	);
	await writeAtomic(historyPath, `${JSON.stringify(history, null, 2)}\n`);
	await writeAtomic(
		join(outputDir, "blocked.md"),
		blockedMarkdown(Object.values(history.results)),
	);
}

export async function withRunLock<T>(
	outputDir: string,
	action: () => Promise<T>,
): Promise<T> {
	await mkdir(outputDir, { recursive: true });
	const lockPath = join(outputDir, "run.lock");
	let handle: FileHandle | undefined;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			handle = await open(lockPath, "wx");
			await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const pid = Number((await readFile(lockPath, "utf8")).split(/\s+/)[0]);
			let running = Number.isInteger(pid) && pid > 0;
			if (running) {
				try {
					process.kill(pid, 0);
				} catch (processError) {
					running = (processError as NodeJS.ErrnoException).code === "EPERM";
				}
			}
			if (running || attempt > 0)
				throw new Error(`別の実行が進行中です: ${lockPath}`);
			await rm(lockPath, { force: true });
		}
	}
	if (!handle) throw new Error(`実行ロックを取得できません: ${lockPath}`);
	try {
		return await action();
	} finally {
		await handle.close();
		await rm(lockPath, { force: true });
	}
}
