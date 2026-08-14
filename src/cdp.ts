interface Pending {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

type EventListener = (params: unknown, sessionId?: string) => void;

interface CdpMessage {
	id?: number;
	result?: unknown;
	error?: unknown;
	method?: string;
	params?: unknown;
	sessionId?: string;
}

type JsonRecord = Record<string, unknown>;

function connectionError(): Error {
	return new Error("CDP WebSocketへの接続に失敗しました");
}

function protocolError(error: unknown): Error {
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string") return new Error(message);
	}
	return new Error(JSON.stringify(error));
}

async function waitForOpen(socket: WebSocket): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const cleanup = (): void => {
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("error", onError);
		};
		const onOpen = (): void => {
			cleanup();
			resolve();
		};
		const onError = (): void => {
			cleanup();
			reject(connectionError());
		};
		socket.addEventListener("open", onOpen);
		socket.addEventListener("error", onError);
	});
}

export class CdpClient {
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();
	private readonly listeners = new Map<string, EventListener[]>();

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", (event) =>
			this.onMessage(String(event.data)),
		);
		socket.addEventListener("close", () => this.rejectPending());
	}

	static async connect(url: string): Promise<CdpClient> {
		const socket = new WebSocket(url);
		try {
			await waitForOpen(socket);
		} catch (error) {
			socket.close();
			throw error;
		}
		return new CdpClient(socket);
	}

	private rejectPending(): void {
		const error = new Error("CDP接続が閉じられました");
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}

	private onMessage(raw: string): void {
		const message = JSON.parse(raw) as CdpMessage;
		if (typeof message.id === "number") {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			if (message.error) pending.reject(protocolError(message.error));
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
		const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
			});
			try {
				this.socket.send(JSON.stringify(payload));
			} catch (error) {
				this.pending.delete(id);
				reject(error);
			}
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
