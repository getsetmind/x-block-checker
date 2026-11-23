import { join } from "node:path";
import type { AccountListKind } from "./account-lists/types";

/**
 * 保存形式の指定
 */
export interface OutputOptions {
	markdown?: boolean;
}

/**
 * @param outputDir - 出力先のルート
 * @returns checkコマンドの結果ファイル
 */
export function checkPaths(outputDir: string): {
	latest: string;
	history: string;
	blocked: string;
} {
	const dir = join(outputDir, "check");
	return {
		latest: join(dir, "latest.json"),
		history: join(dir, "history.json"),
		blocked: join(dir, "blocked.md"),
	};
}

/**
 * @param outputDir - 出力先のルート
 * @param kind - 一覧種別
 * @returns 全件取得済みの一覧ファイル
 */
export function listPaths(
	outputDir: string,
	kind: AccountListKind,
): { json: string; markdown: string } {
	const dir = join(outputDir, "lists");
	return {
		json: join(dir, `${kind}.json`),
		markdown: join(dir, `${kind}.md`),
	};
}

/**
 * @param outputDir - 出力先のルート
 * @param kind - 一覧種別
 * @returns 取得途中だけに存在するファイル
 */
export function progressPaths(
	outputDir: string,
	kind: AccountListKind,
): { checkpoint: string; partialJson: string; partialMarkdown: string } {
	const dir = join(outputDir, "progress");
	return {
		checkpoint: join(dir, `${kind}.checkpoint.json`),
		partialJson: join(dir, `${kind}.partial.json`),
		partialMarkdown: join(dir, `${kind}.partial.md`),
	};
}
