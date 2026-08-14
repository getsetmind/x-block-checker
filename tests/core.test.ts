import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, MIN_CLEAR_WAIT_MS } from "../src/classifier.js";
import { extractRelationships } from "../src/relationship.js";
import { saveResults, withRunLock } from "../src/storage.js";
import { parseUsernames } from "../src/usernames.js";

describe("parseUsernames", () => {
	test("ユーザー名とURLを正規化し最初の表記で重複を除く", () => {
		expect(
			parseUsernames(["@Foo, https://x.com/bar/status/1 foo invalid-name"]),
		).toEqual(["Foo", "bar"]);
	});
});

describe("extractRelationships", () => {
	test("legacy形式を抽出する", () => {
		expect(
			extractRelationships({
				legacy: { screen_name: "Foo", blocked_by: true, blocking: false },
			}),
		).toEqual([{ username: "Foo", blockedBy: true, blocking: false }]);
	});

	test("relationship_perspectives形式を抽出する", () => {
		expect(
			extractRelationships({
				username: "Bar",
				relationship_perspectives: { blocked_by: false, blocking: true },
			}),
		).toEqual([{ username: "Bar", blockedBy: false, blocking: true }]);
	});

	test("配列内にネストされた関係を抽出する", () => {
		expect(
			extractRelationships({
				users: [
					{
						core: { screen_name: "Baz" },
						relationshipPerspective: { blockedBy: true },
					},
				],
			}),
		).toEqual([{ username: "Baz", blockedBy: true }]);
	});
});

describe("classify", () => {
	test("相互ブロックを判定する", () => {
		expect(
			classify(
				{ text: "You’re blocked", profileLoaded: false },
				{ username: "foo", blockedBy: true, blocking: true },
				0,
			),
		).toBe("mutual");
	});

	test("描画待機前に未ブロックと判定しない", () => {
		expect(
			classify(
				{ text: "", profileLoaded: true },
				undefined,
				MIN_CLEAR_WAIT_MS - 1,
			),
		).toBeNull();
	});

	test("存在しないアカウントを判定する", () => {
		expect(
			classify(
				{ text: "This account doesn’t exist", profileLoaded: false },
				undefined,
				0,
			),
		).toBe("notFound");
	});
});

describe("storage", () => {
	test("履歴をマージして最新結果とMarkdownを保存する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-test-"));
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

	test("終了済みPIDのロックを回収する", async () => {
		const dir = await mkdtemp(join(tmpdir(), "xbc-test-"));
		try {
			await writeFile(join(dir, "run.lock"), "99999999\n");
			await expect(withRunLock(dir, async () => "ok")).resolves.toBe("ok");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
