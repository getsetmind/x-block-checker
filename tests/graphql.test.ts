import { describe, expect, test } from "bun:test";
import { createReplayRequest, isUserByScreenName } from "../src/x/graphql";

describe("graphql", () => {
	test("UserByScreenNameリクエストを識別する", () => {
		expect(
			isUserByScreenName(
				"https://x.com/i/api/graphql/query/UserByScreenName?variables={}",
			),
		).toBeTrue();
	});

	test("捕捉したvariablesのユーザー名だけを置換する", () => {
		const request = createReplayRequest(
			{
				url: `https://x.com/i/api/graphql/query/UserByScreenName?variables=${encodeURIComponent(
					JSON.stringify({
						screen_name: "Foo",
						withSafetyModeUserFields: true,
					}),
				)}`,
				method: "GET",
				headers: { authorization: "Bearer test" },
			},
			"Bar",
		);
		expect(request).not.toBeNull();
		const variables = JSON.parse(
			new URL(request?.url ?? "").searchParams.get("variables") ?? "{}",
		);
		expect(variables).toEqual({
			screen_name: "Bar",
			withSafetyModeUserFields: true,
		});
	});
});
