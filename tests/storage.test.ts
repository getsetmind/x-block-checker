import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearAccountListCheckpoint,
	readAccountListCheckpoint,
	saveAccountList,
	saveAccountListCheckpoint,
} from "../src/account-lists/storage";
import type {
	AccountListCheckpoint,
	AccountListSnapshot,
} from "../src/account-lists/types";
import { withRunLock } from "../src/run-lock";
import { saveResults } from "../src/storage";

const progress: AccountListCheckpoint = {
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
	test("一覧の種類ごとに保存結果と再開情報を分離する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-list-kinds-test-"));
		const cases = [
			{
				kind: "blocking",
				title: "自分がブロックしているユーザー",
				username: "Blocked",
			},
			{
				kind: "following",
				title: "自分がフォローしているユーザー",
				username: "Followed",
			},
			{
				kind: "followers",
				title: "自分をフォローしているユーザー",
				username: "Follower",
			},
		] as const;
		try {
			for (const { kind, username } of cases) {
				const snapshot = {
					...progress,
					accounts: [{ id: "1", username, url: `https://x.com/${username}` }],
				};
				await saveAccountList(dir, snapshot, kind);
				await saveAccountListCheckpoint(dir, snapshot, kind);
			}
			await clearAccountListCheckpoint(dir, "following");
			for (const { kind, title, username } of cases) {
				expect(
					JSON.parse(await readFile(join(dir, `${kind}.json`), "utf8"))
						.accounts[0].username,
				).toBe(username);
				expect(await readFile(join(dir, `${kind}.md`), "utf8")).toContain(
					`# Xで${title}`,
				);
				expect(
					await readFile(join(dir, `${kind}.partial.md`), "utf8"),
				).toContain(`# Xで${title}`);
				const checkpoint = await readAccountListCheckpoint(dir, kind);
				if (kind === "following") {
					expect(checkpoint).toBeUndefined();
				} else {
					expect(checkpoint?.accounts[0]?.username).toBe(username);
				}
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
	test.each(["blocking", "following", "followers"] as const)(
		"%sの取得途中を再開用と公開一覧に分離し完全一覧を維持する",
		async (kind) => {
			const dir = await mkdtemp(join(tmpdir(), "xbc-checkpoint-test-"));
			try {
				expect(await readAccountListCheckpoint(dir, kind)).toBeUndefined();
				const complete = {
					version: 1 as const,
					checkedAt: progress.checkedAt,
					accounts: [],
				};
				await saveAccountList(dir, complete, kind);
				await saveAccountListCheckpoint(
					dir,
					{
						...progress,
						stopReason: "rateLimit",
						retryAt: "2026-08-15T00:15:00.000Z",
					},
					kind,
				);
				expect(await readAccountListCheckpoint(dir, kind)).toEqual({
					...progress,
					stopReason: "rateLimit",
					retryAt: "2026-08-15T00:15:00.000Z",
				});
				const partial = await readFile(
					join(dir, `${kind}.partial.json`),
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
					await readFile(join(dir, `${kind}.partial.md`), "utf8"),
				).toContain("全件取得済みの一覧ではありません");
				expect(
					JSON.parse(await readFile(join(dir, `${kind}.json`), "utf8")),
				).toEqual(complete);
				const finished: AccountListCheckpoint = {
					...progress,
					complete: true,
					nextCursor: null,
					pages: 2,
				};
				await saveAccountListCheckpoint(dir, finished, kind);
				expect(await readAccountListCheckpoint(dir, kind)).toEqual(finished);
				await saveAccountList(dir, finished, kind);
				expect(
					JSON.parse(await readFile(join(dir, `${kind}.json`), "utf8")),
				).toEqual({
					version: 1,
					checkedAt: progress.checkedAt,
					accounts: progress.accounts,
				});
				await clearAccountListCheckpoint(dir, kind);
				expect(await readAccountListCheckpoint(dir, kind)).toBeUndefined();
				expect(existsSync(join(dir, `${kind}.partial.json`))).toBeTrue();
				expect(existsSync(join(dir, "run.lock"))).toBeFalse();
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
	);

	test("初回429の0ページ進捗も再開情報として保持する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-checkpoint-test-"));
		try {
			const empty: AccountListCheckpoint = {
				...progress,
				pages: 0,
				accounts: [],
				nextCursor: null,
				stopReason: "rateLimit",
				retryAt: "2026-08-15T00:15:00.000Z",
			};
			await saveAccountListCheckpoint(dir, empty, "blocking");
			expect(await readAccountListCheckpoint(dir, "blocking")).toEqual(empty);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test.each(
		(["blocking", "following", "followers"] as const).flatMap((kind) =>
			(["futureRetry", "complete"] as const).map((state) => ({ kind, state })),
		),
	)(
		"$kindの$state再開時は本人確認し、通信せず保存済み結果を返す",
		async ({ kind, state }) => {
			const dir = await mkdtemp(join(tmpdir(), "xbc-checkpoint-cli-test-"));
			try {
				const browser = join(dir, "browser.exe");
				const config = join(dir, "config.json");
				const harness = join(dir, "harness.ts");
				const receipt = join(dir, "browser-events.json");
				await writeFile(browser, "");
				await writeFile(
					config,
					JSON.stringify({
						browserExecutable: browser,
						outputDir: dir,
						profileDir: join(dir, "profile"),
					}),
				);
				await writeFile(
					harness,
					[
						`const { default: puppeteer } = await import(${JSON.stringify(import.meta.resolve("puppeteer-core"))});`,
						'const { writeFile } = await import("node:fs/promises");',
						"const events = [];",
						"const ownerId = process.argv[3];",
						'const network = async () => { events.push("network"); throw new Error("unexpected network request"); };',
						"globalThis.fetch = network;",
						"const page = { goto: network, evaluate: network, waitForResponse: network };",
						`puppeteer.launch = async () => { events.push("launch"); return { pages: async () => [page], defaultBrowserContext: () => ({ cookies: async () => { events.push("cookies"); return [{ name: "auth_token", value: "synthetic-auth", domain: ".x.com" }, { name: "twid", value: "u%3D" + ownerId, domain: ".x.com" }]; } }), close: async () => { events.push("close"); await writeFile(${JSON.stringify(receipt)}, JSON.stringify(events)); } }; };`,
						`process.argv = [process.execPath, ${JSON.stringify(join(import.meta.dir, "../src/cli.ts"))}, process.argv[2], "--config", ${JSON.stringify(config)}, "--json"];`,
						`await import(${JSON.stringify(join(import.meta.dir, "../src/cli.ts"))});`,
					].join("\n"),
				);
				const checkpoint: AccountListCheckpoint =
					state === "complete"
						? { ...progress, complete: true, nextCursor: null }
						: {
								...progress,
								stopReason: "rateLimit",
								retryAt: new Date(Date.now() + 60000).toISOString(),
							};
				await saveAccountListCheckpoint(dir, checkpoint, kind);
				const mismatched = Bun.spawnSync(
					[process.execPath, harness, kind, "100"],
					{ timeout: 5000 },
				);
				expect(mismatched.exitCode, mismatched.stderr.toString()).toBe(1);
				expect(mismatched.stderr.toString()).toContain(
					"ログインアカウントが異なります",
				);
				expect(mismatched.stdout.toString()).toBe("");
				expect(await readAccountListCheckpoint(dir, kind)).toEqual(checkpoint);
				expect(existsSync(join(dir, `${kind}.json`))).toBeFalse();
				expect(existsSync(join(dir, `${kind}.md`))).toBeFalse();
				const rejectedEvents: string[] = JSON.parse(
					await readFile(receipt, "utf8"),
				);
				expect(rejectedEvents).toContain("close");
				expect(rejectedEvents).not.toContain("network");
				const command = Bun.spawnSync([process.execPath, harness, kind, "99"], {
					timeout: 5000,
				});
				expect(command.exitCode, command.stderr.toString()).toBe(
					state === "complete" ? 0 : 2,
				);
				const output = command.stdout.toString();
				if (state === "complete") {
					const snapshot = {
						version: checkpoint.version,
						checkedAt: checkpoint.checkedAt,
						accounts: checkpoint.accounts,
					};
					expect(JSON.parse(output)).toEqual(snapshot);
					expect(
						JSON.parse(await readFile(join(dir, `${kind}.json`), "utf8")),
					).toEqual(snapshot);
					expect(await readFile(join(dir, `${kind}.md`), "utf8")).toContain(
						"[@Foo](https://x.com/Foo)",
					);
					expect(await readAccountListCheckpoint(dir, kind)).toBeUndefined();
				} else {
					expect(JSON.parse(output)).toMatchObject({
						complete: false,
						pages: 1,
						stopReason: "rateLimit",
						retryAt: checkpoint.retryAt,
						accounts: progress.accounts,
					});
				}
				expect(output).not.toContain("ownerId");
				expect(output).not.toContain("nextCursor");
				expect(output).not.toContain("opaque-private-cursor");
				const events: string[] = JSON.parse(await readFile(receipt, "utf8"));
				expect(events).toContain("launch");
				expect(events).toContain("cookies");
				expect(events).toContain("close");
				expect(events).not.toContain("network");
				expect(existsSync(join(dir, "run.lock"))).toBeFalse();
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
	);

	test("壊れたJSONの内容をエラーへ含めない", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-checkpoint-test-"));
		try {
			await writeFile(
				join(dir, "blocking-progress.json"),
				'{ "opaque-private-cursor": ',
			);
			await expect(readAccountListCheckpoint(dir, "blocking")).rejects.toThrow(
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
			await expect(readAccountListCheckpoint(dir, "blocking")).rejects.toThrow(
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
		const snapshot: AccountListSnapshot = {
			version: 1,
			checkedAt: "2026-08-15T00:00:00.000Z",
			accounts: [
				{ id: "1", username: "Foo", url: "https://x.com/Foo" },
				{ id: "2", username: "Bar", url: "https://x.com/Bar" },
			],
		};
		try {
			await saveAccountList(dir, snapshot, "blocking");
			expect(
				JSON.parse(await readFile(join(dir, "blocking.json"), "utf8")),
			).toEqual(snapshot);
			expect(existsSync(join(dir, "latest.json"))).toBeFalse();
			expect(existsSync(join(dir, "history.json"))).toBeFalse();
			expect(existsSync(join(dir, "blocked.md"))).toBeFalse();
			const replacement: AccountListSnapshot = {
				...snapshot,
				accounts: snapshot.accounts.slice(1),
			};
			await saveAccountList(dir, replacement, "blocking");
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
			const empty: AccountListSnapshot = { ...snapshot, accounts: [] };
			await saveAccountList(dir, empty, "blocking");
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
