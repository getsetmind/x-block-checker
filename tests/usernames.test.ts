import { describe, expect, test } from "bun:test";
import { parseUsernames } from "../src/usernames";

describe("parseUsernames", () => {
	test("ユーザー名とURLを正規化し最初の表記で重複を除く", () => {
		expect(parseUsernames(["@Foo, https://x.com/bar/status/1 foo"])).toEqual([
			"Foo",
			"bar",
		]);
	});

	test.each([
		"invalid-name",
		"https://example.com/user",
		"user/../../login",
		"user?redirect=https://example.com",
		"$(whoami)",
		"ユーザー",
	])("不正な外部入力を拒否する: %s", (value) => {
		expect(() => parseUsernames([value])).toThrow("ユーザー名は");
	});

	test("過大な入力を拒否する", () => {
		expect(() => parseUsernames(["a".repeat(65537)])).toThrow(
			"ユーザー名入力が長すぎます",
		);
	});
});
