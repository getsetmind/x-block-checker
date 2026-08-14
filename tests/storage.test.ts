import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveResults, withRunLock } from "../src/storage";

describe("storage", () => {
	test("履歴をマージして最新結果とMarkdownを保存する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-storage-test-"));
		try {
			await saveResults(dir, [
				{
					username: "Foo",
					status: "blocked",
					checkedAt: "2026-08-15T00:00:00.000Z",
					url: "https://x.com/Foo",
				},
			]);
			expect(
				JSON.parse(await readFile(join(dir, "latest.json"), "utf8")),
			).toHaveLength(1);
			expect(await readFile(join(dir, "blocked.md"), "utf8")).toContain(
				"[@Foo](https://x.com/Foo)",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("特殊なユーザー名を安全に履歴キーとして保存する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-storage-test-"));
		try {
			await saveResults(dir, [
				{
					username: "__proto__",
					status: "clear",
					checkedAt: "2026-08-15T00:00:00.000Z",
					url: "https://x.com/__proto__",
				},
			]);
			const history = JSON.parse(
				await readFile(join(dir, "history.json"), "utf8"),
			) as { results: Record<string, { username: string }> };
			const saved = Reflect.get(history.results, "__proto__") as
				| { username: string }
				| undefined;
			expect(saved?.username).toBe("__proto__");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("終了済みPIDのロックを回収する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-storage-test-"));
		try {
			await writeFile(join(dir, "run.lock"), "99999999\n");
			await expect(withRunLock(dir, async () => "ok")).resolves.toBe("ok");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("処理失敗時もロックを削除する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-storage-test-"));
		try {
			await expect(
				withRunLock(dir, async () => {
					throw new Error("failure");
				}),
			).rejects.toThrow("failure");
			expect(existsSync(join(dir, "run.lock"))).toBeFalse();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
