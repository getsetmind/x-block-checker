import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/config/args";

describe("parseArgs", () => {
	test("doctorコマンドをJSON出力付きで解析する", () => {
		expect(parseArgs(["doctor", "--json"])).toEqual({
			command: "doctor",
			configPath: "x-block-checker.config.json",
			usernames: [],
			json: true,
		});
	});

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
