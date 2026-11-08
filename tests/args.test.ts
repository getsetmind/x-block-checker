import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/config/args";

describe("parseArgs", () => {
	test("blockingの長時間取得と再開制御を解析する", () => {
		expect(
			parseArgs([
				"blocking",
				"--wait",
				"--restart",
				"--page-limit",
				"50",
				"--json",
			]),
		).toMatchObject({
			command: "blocking",
			wait: true,
			restart: true,
			pageLimit: 50,
			json: true,
		});
	});
	test.each([
		{ flag: "--wait" },
		{ flag: "--restart" },
		{ flag: "--page-limit" },
	])("blocking以外への$flagを拒否する", ({ flag }) => {
		expect(() =>
			parseArgs(["check", flag, ...(flag === "--page-limit" ? ["2"] : [])]),
		).toThrow("blocking専用");
	});
	test.each([
		{ value: "0" },
		{ value: "101" },
		{ value: "1.5" },
		{ value: "NaN" },
	])("ページ数$valueを拒否する", ({ value }) => {
		expect(() => parseArgs(["blocking", "--page-limit", value])).toThrow(
			"1〜100の整数",
		);
	});

	test("blockingをJSON出力付きで解析する", () => {
		expect(parseArgs(["blocking", "--json"])).toEqual({
			command: "blocking",
			configPath: "x-block-checker.config.json",
			usernames: [],
			json: true,
		});
	});

	test.each([
		{ arguments: ["@Foo"] },
		{ arguments: ["--input", "users.txt"] },
		{ arguments: ["-i", "users.txt"] },
	])("blockingへの対象指定 %j を拒否する", ({ arguments: arguments_ }) => {
		expect(() => parseArgs(["blocking", ...arguments_])).toThrow(
			"blocking はユーザー引数と --input を指定できません",
		);
	});

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
