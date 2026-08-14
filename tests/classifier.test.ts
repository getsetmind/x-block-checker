import { describe, expect, test } from "bun:test";
import { classify, MIN_CLEAR_WAIT_MS } from "../src/x/classifier";

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

	test("GraphQLの明示的な関係は描画待機前でも判定する", () => {
		expect(
			classify(
				{ text: "", profileLoaded: false },
				{ username: "foo", blockedBy: false, blocking: false },
				0,
			),
		).toBe("clear");
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

	test("GraphQLから鍵アカウントを判定する", () => {
		expect(
			classify(
				{ text: "", profileLoaded: false },
				{
					username: "private",
					blockedBy: false,
					blocking: false,
					protected: true,
				},
				0,
			),
		).toBe("protected");
	});

	test("DOMから鍵アカウントを判定する", () => {
		expect(
			classify(
				{ text: "These posts are protected", profileLoaded: true },
				undefined,
				MIN_CLEAR_WAIT_MS,
			),
		).toBe("protected");
	});

	test("鍵アカウントでもブロック関係を優先する", () => {
		expect(
			classify(
				{ text: "", profileLoaded: false },
				{
					username: "private",
					blockedBy: true,
					blocking: false,
					protected: true,
				},
				0,
			),
		).toBe("blocked");
	});
});
