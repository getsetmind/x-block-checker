import { describe, expect, test } from "bun:test";
import { hasErrorCode } from "../src/errors";

describe("hasErrorCode", () => {
	test("構造を確認してエラーコードを比較する", () => {
		expect(hasErrorCode({ code: "ENOENT" }, "ENOENT")).toBeTrue();
		expect(hasErrorCode({ code: "EEXIST" }, "ENOENT")).toBeFalse();
		expect(hasErrorCode(null, "ENOENT")).toBeFalse();
		expect(hasErrorCode("ENOENT", "ENOENT")).toBeFalse();
	});
});
