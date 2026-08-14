import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appDataDir, findBrowserExecutable } from "../src/config/paths";

describe("paths", () => {
	test("アプリデータ保存先にアプリ名を付ける", () => {
		expect(appDataDir().endsWith("x-block-checker")).toBeTrue();
	});

	test("明示されたブラウザ実行ファイルを優先する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-paths-test-"));
		try {
			const browserPath = join(dir, "browser.exe");
			await writeFile(browserPath, "");
			expect(findBrowserExecutable(browserPath)).toBe(browserPath);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
