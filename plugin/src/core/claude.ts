import Anthropic, { APIError, APIUserAbortError } from "@anthropic-ai/sdk";

export interface AskResult {
	text: string;
	usage: { inputTokens: number; outputTokens: number };
	truncated: boolean;
}

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "EAI_AGAIN"]);

export interface RetryLogEntry {
	attempt: number;
	status?: number;
	waitMs: number;
	reason: string;
}

function isRetryableError(err: unknown): boolean {
	if (err instanceof APIError && typeof err.status === "number" && RETRYABLE_STATUSES.has(err.status)) {
		return true;
	}
	if (err && typeof err === "object") {
		const code = (err as { code?: unknown }).code;
		if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
		const cause = (err as { cause?: unknown }).cause;
		if (cause && typeof cause === "object") {
			const causeCode = (cause as { code?: unknown }).code;
			if (typeof causeCode === "string" && RETRYABLE_CODES.has(causeCode)) return true;
		}
	}
	return false;
}

function retryAfterSeconds(err: unknown): number | null {
	if (!(err instanceof APIError)) return null;
	const headers = (err as unknown as { headers?: Record<string, string> }).headers;
	if (!headers) return null;
	const raw = headers["retry-after"] ?? headers["Retry-After"];
	if (!raw) return null;
	const parsed = Number(raw);
	if (Number.isFinite(parsed) && parsed >= 0) return parsed;
	const date = Date.parse(raw);
	if (Number.isFinite(date)) {
		const delta = (date - Date.now()) / 1000;
		return delta > 0 ? delta : 0;
	}
	return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new DOMException("Aborted", "AbortError"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function withRetry<T>(
	op: () => Promise<T>,
	opts: {
		signal?: AbortSignal;
		maxAttempts?: number;
		onRetry?: (entry: RetryLogEntry) => void;
	} = {},
): Promise<T> {
	const maxAttempts = opts.maxAttempts ?? 4;
	let attempt = 0;
	while (true) {
		if (opts.signal?.aborted) {
			throw new DOMException("Aborted", "AbortError");
		}
		attempt++;
		try {
			return await op();
		} catch (err) {
			if (err instanceof APIUserAbortError || (err instanceof DOMException && err.name === "AbortError")) {
				throw err;
			}
			if (attempt >= maxAttempts || !isRetryableError(err)) {
				throw err;
			}
			const retryAfter = retryAfterSeconds(err);
			const backoff = Math.min(32_000, 1_000 * 2 ** (attempt - 1));
			const jitter = Math.floor(Math.random() * 500);
			const waitMs = retryAfter !== null ? Math.ceil(retryAfter * 1_000) : backoff + jitter;
			const status = err instanceof APIError ? err.status : undefined;
			const reason = err instanceof Error ? err.message : String(err);
			opts.onRetry?.({ attempt, status, waitMs, reason });
			console.warn(`[claude] retry ${attempt}/${maxAttempts - 1} in ${waitMs}ms — ${reason}`);
			await sleep(waitMs, opts.signal);
		}
	}
}

export interface ImageBlock {
	data: string;
	mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

export interface ClaudeClient {
	apiKey: string;
	defaultModel?: string;
}

const MODEL_MAX_OUTPUT_TOKENS: Array<[string, number]> = [
	["claude-opus-4-7", 32000],
	["claude-opus-4-6", 32000],
	["claude-sonnet-4-6", 64000],
	["claude-sonnet-4-5", 64000],
	["claude-haiku-4-5", 64000],
	["claude-opus-4", 32000],
	["claude-sonnet-4", 64000],
	["claude-haiku-4", 64000],
];

function maxOutputTokensFor(model?: string): number {
	if (!model) return 8192;
	for (const [prefix, val] of MODEL_MAX_OUTPUT_TOKENS) {
		if (model.startsWith(prefix)) return val;
	}
	return 8192;
}

function clampMaxTokens(requested: number | undefined, model: string | undefined): number {
	const cap = maxOutputTokensFor(model);
	if (!requested) return Math.min(8192, cap);
	return Math.min(requested, cap);
}

function buildAnthropic(client: ClaudeClient): Anthropic {
	if (!client.apiKey) {
		throw new Error(
			"ANTHROPIC_API_KEY nicht konfiguriert. Bitte in den Plugin-Einstellungen setzen.",
		);
	}
	return new Anthropic({ apiKey: client.apiKey, dangerouslyAllowBrowser: true });
}

export interface AskOpts {
	system: string;
	prompt: string;
	images?: ImageBlock[];
	model?: string;
	maxTokens?: number;
	signal?: AbortSignal;
	onRetry?: (entry: RetryLogEntry) => void;
}

export async function ask(client: ClaudeClient, opts: AskOpts): Promise<AskResult> {
	const anthropic = buildAnthropic(client);
	const model = opts.model || client.defaultModel || "claude-sonnet-4-6";

	const userContent: Anthropic.MessageCreateParams["messages"][0]["content"] =
		opts.images && opts.images.length > 0
			? [
				...opts.images.map((img) => ({
					type: "image" as const,
					source: {
						type: "base64" as const,
						media_type: img.mediaType,
						data: img.data,
					},
				})),
				{ type: "text" as const, text: opts.prompt },
			]
			: opts.prompt;

	const response = await withRetry(
		() => {
			const stream = anthropic.messages.stream(
				{
					model,
					max_tokens: clampMaxTokens(opts.maxTokens, model),
					system: [
						{
							type: "text",
							text: opts.system,
							cache_control: { type: "ephemeral" },
						},
					],
					messages: [{ role: "user", content: userContent }],
				},
				opts.signal ? { signal: opts.signal } : undefined,
			);
			return stream.finalMessage();
		},
		{ signal: opts.signal, onRetry: opts.onRetry },
	);

	const textBlock = response.content.find((b) => b.type === "text");
	if (!textBlock || textBlock.type !== "text") {
		throw new Error("Keine Textantwort von Claude erhalten");
	}
	return {
		text: textBlock.text,
		usage: {
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
		},
		truncated: response.stop_reason === "max_tokens",
	};
}

export interface AskJsonResult<T> {
	result: T | null;
	response: AskResult;
	attempts: number;
	lastDiag?: string;
}

export async function askForJson<T>(
	client: ClaudeClient,
	opts: AskOpts & { maxRetries?: number },
): Promise<AskJsonResult<T>> {
	const maxRetries = opts.maxRetries ?? 1;

	let response = await ask(client, opts);
	let result = parseClaudeJson<T>(response.text);
	if (result) return { result, response, attempts: 1 };

	let lastDiag = diagnoseJsonParse(response.text);
	for (let i = 0; i < maxRetries; i++) {
		const retryPrompt = `${opts.prompt}

---

WICHTIG: Deine vorherige Antwort war kein gueltiges JSON. Fehler-Diagnose:
${lastDiag}

Antworte EXAKT im gewuenschten JSON-Format — keinen Text davor oder dahinter, nur der reine JSON-Block in \`\`\`json ... \`\`\`.`;

		response = await ask(client, { ...opts, prompt: retryPrompt });
		result = parseClaudeJson<T>(response.text);
		if (result) return { result, response, attempts: i + 2 };
		lastDiag = diagnoseJsonParse(response.text);
	}

	return { result: null, response, attempts: maxRetries + 1, lastDiag };
}

function repairTruncatedJson(json: string): string {
	let inString = false;
	let escaped = false;
	const openBrackets: string[] = [];

	for (let i = 0; i < json.length; i++) {
		const ch = json[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\" && inString) {
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (ch === "{" || ch === "[") openBrackets.push(ch);
		if (ch === "}" || ch === "]") openBrackets.pop();
	}

	let repaired = json;
	if (inString) repaired += '"';
	repaired = repaired.replace(/,\s*$/, "");
	while (openBrackets.length > 0) {
		const bracket = openBrackets.pop()!;
		const closer = bracket === "{" ? "}" : "]";
		repaired = repaired.replace(/,\s*$/, "");
		repaired += closer;
	}

	return repaired;
}

function extractJsonBody(response: string): string {
	const firstBrace = response.indexOf("{");
	if (firstBrace === -1) return response;
	return response.slice(firstBrace);
}

function parseJsonError(err: unknown): { msg: string; position: number | null } {
	const msg = err instanceof Error ? err.message : String(err);
	const match = msg.match(/position\s+(\d+)/i);
	return { msg, position: match ? parseInt(match[1], 10) : null };
}

function fixJsonIssues(json: string, maxAttempts = 60): string {
	let attempt = json;
	for (let i = 0; i < maxAttempts; i++) {
		try {
			JSON.parse(attempt);
			return attempt;
		} catch (err) {
			const { msg, position: pos } = parseJsonError(err);
			if (pos === null) return attempt;
			if (pos >= attempt.length) return attempt;

			const code = attempt.charCodeAt(pos);

			if (code < 0x20) {
				let replacement: string;
				if (code === 0x0a) replacement = "\\n";
				else if (code === 0x0d) replacement = "\\r";
				else if (code === 0x09) replacement = "\\t";
				else replacement = `\\u${code.toString(16).padStart(4, "0")}`;
				attempt = attempt.slice(0, pos) + replacement + attempt.slice(pos + 1);
				continue;
			}

			if (
				msg.includes("after property value") ||
				msg.includes("after array element") ||
				msg.includes("property name")
			) {
				let quotePos = pos - 1;
				while (quotePos >= 0 && attempt[quotePos] !== '"') quotePos--;
				if (quotePos > 0) {
					attempt = attempt.slice(0, quotePos) + '\\"' + attempt.slice(quotePos + 1);
					continue;
				}
			}

			return attempt;
		}
	}
	return attempt;
}

function describeJsonError(err: unknown, json: string): string {
	const { msg, position: pos } = parseJsonError(err);
	if (pos === null) return msg;

	const start = Math.max(0, pos - 60);
	const end = Math.min(json.length, pos + 60);
	const before = json
		.slice(start, pos)
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");
	const after = json
		.slice(pos, end)
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");
	const charAtPos = pos < json.length ? json[pos] : "EOF";
	const hexCode = pos < json.length ? `0x${json.charCodeAt(pos).toString(16).padStart(2, "0")}` : "EOF";

	return `${msg} | Zeichen: '${charAtPos}' (${hexCode}) | Kontext: …${before}>>>[HIER]<<<${after}…`;
}

export function parseClaudeJson<T>(response: string): T | null {
	const raw = extractJsonBody(response);
	const errors: string[] = [];

	try {
		return JSON.parse(raw) as T;
	} catch (err) {
		errors.push(`[S1 direkt] ${describeJsonError(err, raw)}`);

		const { msg, position: cutoff } = parseJsonError(err);
		if (cutoff !== null && /after JSON/i.test(msg)) {
			const head = raw.slice(0, cutoff);
			try {
				return JSON.parse(head) as T;
			} catch (err2) {
				errors.push(`[S1b first-of-many] ${describeJsonError(err2, head)}`);
			}
		}
	}

	const lastBrace = raw.lastIndexOf("}");
	if (lastBrace > 0) {
		const trimmed = raw.slice(0, lastBrace + 1);
		try {
			return JSON.parse(trimmed) as T;
		} catch (err) {
			errors.push(`[S2 trimmed] ${describeJsonError(err, trimmed)}`);
		}

		const fixed = fixJsonIssues(trimmed);
		if (fixed !== trimmed) {
			try {
				return JSON.parse(fixed) as T;
			} catch (err) {
				errors.push(`[S3 fixed] ${describeJsonError(err, fixed)}`);
			}
		}
	} else {
		errors.push(`[S2] Kein schliessendes } gefunden`);
	}

	const fixedRaw = fixJsonIssues(raw);
	const repaired = repairTruncatedJson(fixedRaw);
	try {
		return JSON.parse(repaired) as T;
	} catch (err) {
		errors.push(`[S4 repariert] ${describeJsonError(err, repaired)}`);
	}

	const diag = [
		`Antwort: ${response.length} Zeichen, JSON-Body: ${raw.length} Zeichen`,
		`Erste 80 Zeichen: ${raw.slice(0, 80).replace(/\n/g, "\\n")}`,
		`Letzte 80 Zeichen: ${raw.slice(-80).replace(/\n/g, "\\n")}`,
		...errors,
	].join("\n");
	console.error(`[parseClaudeJson] Alle Strategien fehlgeschlagen:\n${diag}`);
	return null;
}

export function diagnoseJsonParse(response: string): string {
	const raw = extractJsonBody(response);
	const lines: string[] = [];
	lines.push(`Antwort: ${response.length} Zeichen, JSON-Body: ${raw.length} Zeichen`);

	try {
		JSON.parse(raw);
		lines.push("Parse: OK (unerwartet)");
	} catch (err) {
		lines.push(`Original: ${describeJsonError(err, raw)}`);
	}

	const fixed = fixJsonIssues(raw);
	if (fixed !== raw) {
		try {
			JSON.parse(fixed);
			lines.push("Nach ctrl-fix: OK (unerwartet)");
		} catch (err) {
			lines.push(`Nach ctrl-fix: ${describeJsonError(err, fixed)}`);
		}
	}

	lines.push(`Anfang: ${raw.slice(0, 120).replace(/\n/g, "\\n")}`);
	lines.push(`Ende: ${raw.slice(-120).replace(/\n/g, "\\n")}`);
	return lines.join(" | ");
}
