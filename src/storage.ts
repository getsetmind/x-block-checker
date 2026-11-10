import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "./errors";
import { serializeJson, writeAtomic } from "./persistence";
import { type CheckResult, type History, statusLabels } from "./types";

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
