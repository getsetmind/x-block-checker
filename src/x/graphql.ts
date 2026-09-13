import type { HTTPRequest } from "puppeteer-core";

/**
 * 通常通信から捕捉したGraphQLリクエストの雛形
 */
export interface GraphqlTemplate {
	url: string;
	method: string;
	headers: Record<string, string>;
	postData?: string;
}

/**
 * 捕捉した雛形へ対象ユーザーを差し替えた再送用リクエスト
 */
export interface ReplayRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

/**
 * URLがユーザー情報を取得するGraphQLかを判定する
 *
 * @param url - 判定するURL
 */
export function isUserByScreenName(url: string): boolean {
	return url.includes("/graphql/") && url.includes("UserByScreenName");
}

/**
 * 捕捉したリクエストから再送に必要な雛形を取り出す
 *
 * @param request - 捕捉したリクエスト
 */
export function captureGraphqlTemplate(
	request: HTTPRequest,
): GraphqlTemplate | null {
	if (!isUserByScreenName(request.url())) return null;
	const postData = request.postData();
	return {
		url: request.url(),
		method: request.method(),
		headers: Object.fromEntries(
			Object.entries(request.headers()).filter(([name]) => {
				const normalized = name.toLowerCase();
				return (
					normalized === "accept" ||
					normalized === "authorization" ||
					normalized === "content-type" ||
					normalized === "x-csrf-token" ||
					(normalized.startsWith("x-twitter-") &&
						normalized !== "x-client-transaction-id")
				);
			}),
		),
		...(postData ? { postData } : {}),
	};
}

function replaceScreenName(value: unknown, username: string): boolean {
	if (typeof value !== "object" || value === null) return false;
	let replaced = false;
	for (const [key, child] of Object.entries(value)) {
		if (key.replaceAll("_", "").toLowerCase() === "screenname") {
			Reflect.set(value, key, username);
			replaced = true;
		} else if (replaceScreenName(child, username)) replaced = true;
	}
	return replaced;
}

/**
 * 雛形のscreen_nameを対象ユーザーへ差し替える
 *
 * @param template - 再送に使う雛形
 * @param username - 差し替える対象ユーザー
 */
export function createReplayRequest(
	template: GraphqlTemplate,
	username: string,
): ReplayRequest | null {
	const url = new URL(template.url);
	let replaced = false;
	const variables = url.searchParams.get("variables");
	if (variables) {
		const value: unknown = JSON.parse(variables);
		if (replaceScreenName(value, username)) {
			url.searchParams.set("variables", JSON.stringify(value));
			replaced = true;
		}
	}

	let body = template.postData;
	if (body) {
		const value: unknown = JSON.parse(body);
		if (replaceScreenName(value, username)) {
			body = JSON.stringify(value);
			replaced = true;
		}
	}
	if (!replaced) return null;
	return {
		url: url.toString(),
		method: template.method,
		headers: template.headers,
		...(body ? { body } : {}),
	};
}
