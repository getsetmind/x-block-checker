import { describe, expect, test } from "bun:test";
import { ignoredDefaultBrowserArgs } from "../src/x/browser";

describe("browser", () => {
	test("macOSでは通常起動と同じKeychainを使う", () => {
		expect(ignoredDefaultBrowserArgs("darwin")).toEqual([
			"--use-mock-keychain",
		]);
	});

	test("macOS以外ではPuppeteerの既定引数を維持する", () => {
		expect(ignoredDefaultBrowserArgs("win32")).toBeUndefined();
		expect(ignoredDefaultBrowserArgs("linux")).toBeUndefined();
	});
});
