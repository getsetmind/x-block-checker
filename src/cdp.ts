interface Pending {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

interface CdpMessage {
	id?: number;
	result?: unknown;
	error?: unknown;
	method?: string;
	params?: unknown;
	sessionId?: string;
}

type JsonRecord = Record<string, unknown>;

export class CdpClient {
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();
	private readonly listeners = new Map<
		string,
		((params: unknown, sessionId?: string) => void)[]
	>();

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", (event) =>
			this.onMessage(String(event.data)),
		);
		socket.addEventListener("close", () => {
			for (const pending of this.pending.values())
				pending.reject(new Error("CDP接続が閉じられました"));
			this.pending.clear();
		});
	}

	static async connect(url: string): Promise<CdpClient> {
		const socket = new WebSocket(url);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve(), { once: true });
			socket.addEventListener(
				"error",
				() => reject(new Error("CDP WebSocketへの接続に失敗しました")),
				{ once: true },
			);
		});
		return new CdpClient(socket);
	}

	private onMessage(raw: string): void {
		const message = JSON.parse(raw) as CdpMessage;
		if (typeof message.id === "number") {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			if (message.error)
				pending.reject(new Error(JSON.stringify(message.error)));
			else pending.resolve(message.result);
			return;
		}
		if (typeof message.method !== "string") return;
		for (const listener of this.listeners.get(message.method) ?? [])
			listener(message.params, message.sessionId);
	}

	send<T = unknown>(
		method: string,
		params: JsonRecord = {},
		sessionId?: string,
	): Promise<T> {
		const id = this.nextId++;
		const payload: JsonRecord = { id, method, params };
		if (sessionId) payload.sessionId = sessionId;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
			});
			this.socket.send(JSON.stringify(payload));
		});
	}

	on<T>(
		method: string,
		listener: (params: T, sessionId?: string) => void,
	): void {
		const listeners = this.listeners.get(method) ?? [];
		listeners.push((params, sessionId) => listener(params as T, sessionId));
		this.listeners.set(method, listeners);
	}

	close(): void {
		this.socket.close();
	}
}
