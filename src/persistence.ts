import { rename, rm, writeFile } from "node:fs/promises";

/**
 * @param value - 保存するJSON値
 * @returns 改行で終わるJSON文字列
 */
export function serializeJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * @param path - 保存先のファイルパス
 * @param contents - 保存する内容
 */
export async function writeAtomic(
	path: string,
	contents: string,
): Promise<void> {
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		await writeFile(temporary, contents, "utf8");
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
