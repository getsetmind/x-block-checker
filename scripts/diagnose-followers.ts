import puppeteer, { type EvaluateFunc } from "puppeteer-core";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReplayResponse(
	value: unknown,
): value is { status: number; text: string } {
	return (
		isRecord(value) &&
		typeof value.status === "number" &&
		typeof value.text === "string"
	);
}

function reportErrorCodes(text: string): void {
	try {
		const parsed: unknown = JSON.parse(text);
		if (isRecord(parsed) && Array.isArray(parsed.errors)) {
			const codes = parsed.errors.filter(isRecord).map((error) => error.code);
			process.stderr.write(`Error codes=${JSON.stringify(codes)}\n`);
		}
	} catch {
		process.stderr.write("Replay error response is not valid JSON\n");
	}
}

const launch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = async (options) => {
	const browser = await launch(options);
	for (const page of await browser.pages()) {
		let captured: Record<string, string> = {};
		let capturedUrl = "";
		const wait = page.waitForResponse.bind(page);
		page.waitForResponse = async (...args) => {
			const response = await wait(...args);
			captured = response.request().headers();
			capturedUrl = response.url();
			process.stderr.write(
				`Initial fromCache=${response.fromCache()}, fromServiceWorker=${response.fromServiceWorker()}\n`,
			);
			process.stderr.write(
				`Captured status=${response.status()}, headerNames=${Object.keys(captured).sort().join(",")}\n`,
			);
			return response;
		};
		const evaluate = page.evaluate.bind(page);
		page.evaluate = async <
			Params extends unknown[],
			Func extends EvaluateFunc<Params> = EvaluateFunc<Params>,
		>(
			fn: Func | string,
			...args: Params
		): Promise<Awaited<ReturnType<Func>>> => {
			const result = await evaluate<Params, Func>(fn, ...args);
			const request = args[0];
			if (
				!isRecord(request) ||
				!request.headers ||
				!isReplayResponse(result) ||
				result.status !== 404
			) {
				return result;
			}
			const replayArgs = args;
			replayArgs[0] = { ...request, url: capturedUrl };
			const original = await evaluate<Params, Func>(fn, ...replayArgs);
			if (!isReplayResponse(original)) {
				return result;
			}
			process.stderr.write(
				`Unchanged initial URL replay status=${original.status}\n`,
			);
			const headers = Object.fromEntries(
				Object.entries(captured).filter(([name]) =>
					/^(accept|authorization|content-type|referer|x-client-transaction-id|x-csrf-token|x-twitter-.+)$/i.test(
						name,
					),
				),
			);
			replayArgs[0] = { ...request, headers };
			const retry = await evaluate<Params, Func>(fn, ...replayArgs);
			if (!isReplayResponse(retry)) {
				return result;
			}
			process.stderr.write(
				`Captured allowed headers replay status=${retry.status}\n`,
			);
			if (retry.status !== 200) {
				reportErrorCodes(retry.text);
			}
			return retry;
		};
	}
	return browser;
};
process.argv = [
	process.execPath,
	"src/cli.ts",
	"followers",
	"--page-limit",
	"1",
	"--json",
];
await import("../src/cli");
