import type { HTTPRequest } from "puppeteer-core";

export interface GraphqlTemplate {
	url: string;
	method: string;
	headers: Record<string, string>;
	postData?: string;
}

export interface ReplayRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

export function isUserByScreenName(url: string): boolean {
	return url.includes("/graphql/") && url.includes("UserByScreenName");
}

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
			(value as Record<string, unknown>)[key] = username;
			replaced = true;
		} else if (replaceScreenName(child, username)) replaced = true;
	}
	return replaced;
}

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
