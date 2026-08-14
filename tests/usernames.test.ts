import { describe, expect, test } from "bun:test";
import { parseUsernames } from "../src/usernames";

describe("parseUsernames", () => {
	test("ユーザー名とURLを正規化し最初の表記で重複を除く", () => {
		expect(
			parseUsernames(["@Foo, https://x.com/bar/status/1 foo invalid-name"]),
		).toEqual(["Foo", "bar"]);
	});
});
