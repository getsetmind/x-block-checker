import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
	test("コマンドとオプションを解析する", () => {
		expect(parseArgs(["check", "@Foo", "--timeout", "30", "--json"])).toEqual({
			command: "check",
			configPath: "x-block-checker.config.json",
			usernames: ["@Foo"],
			timeoutSeconds: 30,
			json: true,
		});
	});

	test("範囲外のタイムアウトを拒否する", () => {
		expect(() => parseArgs(["--timeout", "4"])).toThrow(
			"--timeout は5〜120秒で指定してください",
		);
	});
});
