import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveBlockingList, saveResults, withRunLock } from "../src/storage";
import type { BlockingList } from "../src/types";

describe("storage", () => {
	test("履歴をマージして最新結果とMarkdownを保存する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-storage-test-"));
		try {
			await saveResults(dir, [
				{
					username: "Foo",
					status: "blocked",
					visibility: "public",
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

	test("ブロック一覧は全件置換され、checkの履歴と混在しない", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-storage-test-"));
		const snapshot: BlockingList = {
			version: 1,
			checkedAt: "2026-08-15T00:00:00.000Z",
			accounts: [
				{ id: "1", username: "Foo", url: "https://x.com/Foo" },
				{ id: "2", username: "Bar", url: "https://x.com/Bar" },
			],
		};
		try {
			await saveBlockingList(dir, snapshot);
			expect(
				JSON.parse(await readFile(join(dir, "blocking.json"), "utf8")),
			).toEqual(snapshot);
			expect(existsSync(join(dir, "latest.json"))).toBeFalse();
			expect(existsSync(join(dir, "history.json"))).toBeFalse();
			expect(existsSync(join(dir, "blocked.md"))).toBeFalse();
			const replacement: BlockingList = {
				...snapshot,
				accounts: snapshot.accounts.slice(1),
			};
			await saveBlockingList(dir, replacement);
			expect(
				JSON.parse(await readFile(join(dir, "blocking.json"), "utf8")),
			).toEqual(replacement);
			const markdown = await readFile(join(dir, "blocking.md"), "utf8");
			expect(markdown).toContain("[@Bar](https://x.com/Bar)");
			expect(markdown).not.toContain("[@Foo]");
			await saveResults(dir, [
				{
					username: "Incoming",
					status: "blocked",
					visibility: "public",
					checkedAt: snapshot.checkedAt,
					url: "https://x.com/Incoming",
				},
			]);
			const latest = await readFile(join(dir, "latest.json"), "utf8");
			const history = await readFile(join(dir, "history.json"), "utf8");
			expect(latest).not.toContain("Bar");
			expect(history).not.toContain("Bar");
			expect(await readFile(join(dir, "blocking.md"), "utf8")).toBe(markdown);
			expect(
				JSON.parse(await readFile(join(dir, "blocking.json"), "utf8")),
			).toEqual(replacement);
			const empty: BlockingList = { ...snapshot, accounts: [] };
			await saveBlockingList(dir, empty);
			expect(
				JSON.parse(await readFile(join(dir, "blocking.json"), "utf8")),
			).toEqual(empty);
			expect(await readFile(join(dir, "blocking.md"), "utf8")).not.toContain(
				"[@",
			);
			expect(await readFile(join(dir, "latest.json"), "utf8")).toBe(latest);
			expect(await readFile(join(dir, "history.json"), "utf8")).toBe(history);
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
					visibility: "protected",
					checkedAt: "2026-08-15T00:00:00.000Z",
					url: "https://x.com/__proto__",
				},
			]);
			const history: unknown = JSON.parse(
				await readFile(join(dir, "history.json"), "utf8"),
			);
			if (
				typeof history !== "object" ||
				history === null ||
				!("results" in history) ||
				typeof history.results !== "object" ||
				history.results === null
			) {
				throw new Error("保存した履歴の形式が不正です");
			}
			const saved = Object.getOwnPropertyDescriptor(
				history.results,
				"__proto__",
			)?.value;
			expect(saved).toMatchObject({ username: "__proto__" });
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
