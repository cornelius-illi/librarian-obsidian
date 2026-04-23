import { Events } from "obsidian";

export type RunKind = "ingest" | "repair";
export type FileStatus = "pending" | "running" | "ok" | "error" | "cancelled";

export interface FileProgress {
	name: string;
	status: FileStatus;
	message?: string;
	attempts?: number;
	error?: string;
	tokensIn?: number;
	tokensOut?: number;
	costUsd?: number;
}

export interface RunState {
	kind: RunKind;
	label: string;
	startedAt: number;
	finishedAt?: number;
	files: FileProgress[];
	currentIndex: number;
	cancelRequested: boolean;
	abortController: AbortController;
}

const CHANGE_EVENT = "change";

interface ModelPricing {
	inputPerMillion: number;
	outputPerMillion: number;
}

const PRICING: Array<[string, ModelPricing]> = [
	["claude-opus-4-7", { inputPerMillion: 15, outputPerMillion: 75 }],
	["claude-opus-4-6", { inputPerMillion: 15, outputPerMillion: 75 }],
	["claude-opus-4", { inputPerMillion: 15, outputPerMillion: 75 }],
	["claude-sonnet-4-6", { inputPerMillion: 3, outputPerMillion: 15 }],
	["claude-sonnet-4-5", { inputPerMillion: 3, outputPerMillion: 15 }],
	["claude-sonnet-4", { inputPerMillion: 3, outputPerMillion: 15 }],
	["claude-haiku-4-5", { inputPerMillion: 1, outputPerMillion: 5 }],
	["claude-haiku-4", { inputPerMillion: 1, outputPerMillion: 5 }],
];

export function estimateCost(model: string, usage: { inputTokens: number; outputTokens: number }): number {
	const price = PRICING.find(([prefix]) => model.startsWith(prefix))?.[1];
	if (!price) return 0;
	return (
		(usage.inputTokens / 1_000_000) * price.inputPerMillion +
		(usage.outputTokens / 1_000_000) * price.outputPerMillion
	);
}

export class ProgressStore extends Events {
	current: RunState | null = null;

	startRun(kind: RunKind, label: string, fileNames: string[]): AbortSignal {
		const abortController = new AbortController();
		this.current = {
			kind,
			label,
			startedAt: Date.now(),
			files: fileNames.map((name) => ({ name, status: "pending" })),
			currentIndex: -1,
			cancelRequested: false,
			abortController,
		};
		this.emit();
		return abortController.signal;
	}

	setCurrentIndex(index: number): void {
		if (!this.current) return;
		this.current.currentIndex = index;
		this.emit();
	}

	appendFiles(fileNames: string[]): number {
		if (!this.current) return -1;
		const firstIndex = this.current.files.length;
		for (const name of fileNames) {
			this.current.files.push({ name, status: "pending" });
		}
		this.emit();
		return firstIndex;
	}

	updateFile(index: number, patch: Partial<FileProgress>): void {
		if (!this.current) return;
		const existing = this.current.files[index];
		if (!existing) return;
		this.current.files[index] = { ...existing, ...patch };
		this.emit();
	}

	setMessage(index: number, message: string): void {
		this.updateFile(index, { message });
	}

	finishRun(): void {
		if (!this.current) return;
		this.current.finishedAt = Date.now();
		this.emit();
	}

	requestCancel(): boolean {
		if (!this.current || this.current.finishedAt) return false;
		if (this.current.cancelRequested) return false;
		this.current.cancelRequested = true;
		this.current.abortController.abort();
		this.emit();
		return true;
	}

	isRunning(): boolean {
		return !!this.current && !this.current.finishedAt;
	}

	on(name: typeof CHANGE_EVENT, callback: () => void): ReturnType<Events["on"]> {
		return super.on(name, callback);
	}

	private emit(): void {
		this.trigger(CHANGE_EVENT);
	}
}
