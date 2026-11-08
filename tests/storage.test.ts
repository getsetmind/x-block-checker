import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearBlockingCheckpoint,
	readBlockingCheckpoint,
	saveBlockingCheckpoint,
	saveBlockingList,
	saveResults,
	withRunLock,
} from "../src/storage";
import type { BlockingCheckpoint, BlockingList } from "../src/types";

const progress: BlockingCheckpoint = {
	version: 1,
	ownerId: "99",
	checkedAt: "2026-08-15T00:00:00.000Z",
	startedAt: "2026-08-14T23:59:00.000Z",
	accounts: [{ id: "1", username: "Foo", url: "https://x.com/Foo" }],
	source: "graphql",
	nextCursor: "opaque-private-cursor",
	pages: 1,
	complete: false,
};

describe("storage", () => {
	test("取得途中を再開用と公開一覧に分離し完全一覧を維持する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-checkpoint-test-"));
		try {
			expect(await readBlockingCheckpoint(dir)).toBeUndefined();
			const complete = {
				version: 1 as const,
				checkedAt: progress.checkedAt,
				accounts: [],
			};
			await saveBlockingList(dir, complete);
			await saveBlockingCheckpoint(dir, {
				...progress,
				stopReason: "rateLimit",
				retryAt: "2026-08-15T00:15:00.000Z",
			});
			expect(await readBlockingCheckpoint(dir)).toEqual({
				...progress,
				stopReason: "rateLimit",
				retryAt: "2026-08-15T00:15:00.000Z",
			});
			const partial = await readFile(
				join(dir, "blocking.partial.json"),
				"utf8",
			);
			expect(JSON.parse(partial)).toMatchObject({
				complete: false,
				pages: 1,
				accounts: progress.accounts,
			});
			expect(partial).not.toContain("ownerId");
			expect(partial).not.toContain("nextCursor");
			expect(partial).not.toContain("opaque-private-cursor");
			expect(
				await readFile(join(dir, "blocking.partial.md"), "utf8"),
			).toContain("全件取得済みの一覧ではありません");
			expect(
				JSON.parse(await readFile(join(dir, "blocking.json"), "utf8")),
			).toEqual(complete);
			const finished: BlockingCheckpoint = {
				...progress,
				complete: true,
				nextCursor: null,
				pages: 2,
			};
			await saveBlockingCheckpoint(dir, finished);
			expect(await readBlockingCheckpoint(dir)).toEqual(finished);
			await saveBlockingList(dir, finished);
			expect(
				JSON.parse(await readFile(join(dir, "blocking.json"), "utf8")),
			).toEqual({
				version: 1,
				checkedAt: progress.checkedAt,
				accounts: progress.accounts,
			});
			await clearBlockingCheckpoint(dir);
			expect(await readBlockingCheckpoint(dir)).toBeUndefined();
			expect(existsSync(join(dir, "blocking.partial.json"))).toBeTrue();
			expect(existsSync(join(dir, "run.lock"))).toBeFalse();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("初回429の0ページ進捗も再開情報として保持する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-checkpoint-test-"));
		try {
			const empty: BlockingCheckpoint = {
				...progress,
				pages: 0,
				accounts: [],
				nextCursor: null,
				stopReason: "rateLimit",
				retryAt: "2026-08-15T00:15:00.000Z",
			};
			await saveBlockingCheckpoint(dir, empty);
			expect(await readBlockingCheckpoint(dir)).toEqual(empty);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("未来の再試行時刻ではCLIはブラウザを起動せず途中結果だけを返す", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-checkpoint-cli-test-"));
		try {
			const browser = join(dir, "not-a-real-browser.exe");
			await writeFile(browser, "not executable");
			const config = join(dir, "config.json");
			await writeFile(
				config,
				JSON.stringify({
					browserExecutable: browser,
					outputDir: dir,
					profileDir: join(dir, "profile"),
				}),
			);
			const delayed: BlockingCheckpoint = {
				...progress,
				stopReason: "rateLimit",
				retryAt: new Date(Date.now() + 60000).toISOString(),
			};
			await saveBlockingCheckpoint(dir, delayed);
			const command = Bun.spawnSync([
				process.execPath,
				"run",
				join(import.meta.dir, "../src/cli.ts"),
				"blocking",
				"--config",
				config,
				"--json",
			]);
			expect(command.exitCode).toBe(2);
			const output = command.stdout.toString();
			expect(JSON.parse(output)).toMatchObject({
				complete: false,
				pages: 1,
				stopReason: "rateLimit",
				retryAt: delayed.retryAt,
				accounts: progress.accounts,
			});
			expect(output).not.toContain("ownerId");
			expect(output).not.toContain("nextCursor");
			expect(output).not.toContain("opaque-private-cursor");
			expect(existsSync(join(dir, "profile"))).toBeFalse();
			expect(existsSync(join(dir, "run.lock"))).toBeFalse();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("壊れたJSONの内容をエラーへ含めない", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-checkpoint-test-"));
		try {
			await writeFile(
				join(dir, "blocking-progress.json"),
				'{ "opaque-private-cursor": ',
			);
			await expect(readBlockingCheckpoint(dir)).rejects.toThrow(
				"再開情報が不正",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test.each([
		{ change: { ownerId: "other" } },
		{ change: { source: "unknown" } },
		{ change: { pages: -1 } },
		{ change: { pages: 0 } },
		{ change: { pages: 0, accounts: [], nextCursor: null, complete: true } },
		{ change: { source: "rest", nextCursor: "0" } },
		{ change: { checkedAt: "not-a-date" } },
		{ change: { complete: "false" } },
		{ change: { nextCursor: "https://x.com/internal" } },
		{ change: { nextCursor: null } },
		{ change: { complete: true } },
		{ change: { stopReason: "rateLimit" } },
		{ change: { retryAt: "2026-08-15T00:15:00.000Z" } },
		{ change: { headers: { authorization: "secret" } } },
		{
			change: {
				accounts: [{ id: "1", username: "bad/name", url: "https://x.com/Foo" }],
			},
		},
		{
			change: {
				accounts: [
					{ id: "1", username: "Foo", url: "https://evil.example/Foo" },
				],
			},
		},
		{ change: { accounts: [progress.accounts[0], progress.accounts[0]] } },
	])("不正な再開情報を拒否する: %j", async ({ change }) => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-checkpoint-test-"));
		try {
			await writeFile(
				join(dir, "blocking-progress.json"),
				JSON.stringify({ ...progress, ...change }),
			);
			await expect(readBlockingCheckpoint(dir)).rejects.toThrow(
				"再開情報が不正",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

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
