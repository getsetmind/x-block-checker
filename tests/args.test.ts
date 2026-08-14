import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/args";

describe("parseArgs", () => {
	test("コマンドとオプションを解析する", () => {
		expect(
			parseArgs([
				"check",
				"@Foo",
				"--timeout",
				"30",
				"--relationship-mode",
				"passive",
				"--json",
			]),
		).toEqual({
			command: "check",
			configPath: "x-block-checker.config.json",
			usernames: ["@Foo"],
			timeoutSeconds: 30,
			relationshipMode: "passive",
			json: true,
		});
	});

	test("範囲外のタイムアウトを拒否する", () => {
		expect(() => parseArgs(["--timeout", "4"])).toThrow(
			"--timeout は5〜120秒で指定してください",
		);
	});

	test("不明な判定方式を拒否する", () => {
		expect(() => parseArgs(["--relationship-mode", "invalid"])).toThrow(
			"--relationship-mode は auto、dom、passive、direct のいずれかで指定してください",
		);
	});
});
