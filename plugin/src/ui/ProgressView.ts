import { ItemView, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import type LibrarianPlugin from "../../main";
import type { FileProgress, FileStatus, RunState } from "../core/progress";

export const VIEW_TYPE_LIBRARIAN_PROGRESS = "librarian-progress";

const STATUS_ICONS: Record<FileStatus, string> = {
	pending: "circle",
	running: "loader",
	ok: "check",
	error: "alert-triangle",
	cancelled: "ban",
};

const STATUS_LABELS: Record<FileStatus, string> = {
	pending: "Wartend",
	running: "Laeuft",
	ok: "OK",
	error: "Fehler",
	cancelled: "Abgebrochen",
};

function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (n: number) => n.toString().padStart(2, "0");
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function formatCost(usd: number): string {
	if (usd < 0.01) return `<$0.01`;
	return `$${usd.toFixed(2)}`;
}

export class ProgressView extends ItemView {
	private readonly plugin: LibrarianPlugin;
	private tickHandle: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LibrarianPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_LIBRARIAN_PROGRESS;
	}

	getDisplayText(): string {
		return "Librarian";
	}

	getIcon(): string {
		return "book-open";
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass("librarian-progress-view");
		this.render();
		this.registerEvent(this.plugin.progress.on("change", () => this.render()));
		this.tickHandle = window.setInterval(() => {
			if (this.plugin.progress.isRunning()) this.render();
		}, 1000);
	}

	async onClose(): Promise<void> {
		if (this.tickHandle !== null) {
			window.clearInterval(this.tickHandle);
			this.tickHandle = null;
		}
	}

	private render(): void {
		const container = this.contentEl;
		const prevList = container.querySelector<HTMLElement>(".librarian-progress-list");
		const savedScroll = prevList ? prevList.scrollTop : 0;
		container.empty();

		const state = this.plugin.progress.current;
		if (!state) {
			container.createEl("p", {
				text: "Kein Lauf aktiv. Starte einen Ingest oder Repair ueber die Command-Palette.",
				cls: "librarian-progress-empty",
			});
			return;
		}

		this.renderHeader(container, state);
		this.renderProgressBar(container, state);
		this.renderActions(container, state);
		this.renderFileList(container, state);

		const newList = container.querySelector<HTMLElement>(".librarian-progress-list");
		if (newList && savedScroll > 0) newList.scrollTop = savedScroll;
	}

	private renderHeader(container: HTMLElement, state: RunState): void {
		const header = container.createDiv({ cls: "librarian-progress-header" });

		const titleRow = header.createDiv({ cls: "librarian-progress-title" });
		titleRow.createEl("strong", { text: state.label });
		const statusSpan = titleRow.createSpan({ cls: "librarian-progress-status" });
		if (state.cancelRequested && state.finishedAt) statusSpan.setText("abgebrochen");
		else if (state.cancelRequested) statusSpan.setText("wird abgebrochen …");
		else if (state.finishedAt) statusSpan.setText("fertig");
		else statusSpan.setText("laeuft");

		const totals = this.summarize(state);
		const stats = header.createDiv({ cls: "librarian-progress-stats" });
		stats.createSpan({
			text: `${totals.done} / ${state.files.length}`,
			cls: "librarian-progress-count",
		});
		if (totals.errors > 0) {
			stats.createSpan({
				text: `${totals.errors} Fehler`,
				cls: "librarian-progress-errors",
			});
		}
		if (totals.cancelled > 0) {
			stats.createSpan({
				text: `${totals.cancelled} abgebrochen`,
				cls: "librarian-progress-cancelled",
			});
		}
		stats.createSpan({ text: `~${formatCost(totals.costUsd)}` });
		const elapsedMs = (state.finishedAt ?? Date.now()) - state.startedAt;
		stats.createSpan({ text: formatDuration(elapsedMs) });
	}

	private renderProgressBar(container: HTMLElement, state: RunState): void {
		const totals = this.summarize(state);
		const pct = state.files.length === 0 ? 0 : Math.round((totals.done / state.files.length) * 100);
		const wrap = container.createDiv({ cls: "librarian-progress-bar" });
		const fill = wrap.createDiv({ cls: "librarian-progress-bar-fill" });
		fill.style.width = `${pct}%`;
		if (totals.errors > 0) fill.addClass("has-errors");
	}

	private renderActions(container: HTMLElement, state: RunState): void {
		if (state.finishedAt) return;
		const actions = container.createDiv({ cls: "librarian-progress-actions" });
		const cancelBtn = actions.createEl("button", {
			text: state.cancelRequested ? "Abbruch laeuft …" : "Abbrechen",
			cls: "mod-warning",
		});
		cancelBtn.disabled = state.cancelRequested;
		cancelBtn.addEventListener("click", () => {
			this.plugin.progress.requestCancel();
		});
	}

	private renderFileList(container: HTMLElement, state: RunState): void {
		const listWrap = container.createDiv({ cls: "librarian-progress-list" });
		for (const file of state.files) {
			this.renderFileRow(listWrap, file);
		}
	}

	private renderFileRow(parent: HTMLElement, file: FileProgress): void {
		const row = parent.createDiv({ cls: `librarian-progress-row status-${file.status}` });

		const iconEl = row.createSpan({ cls: "librarian-progress-icon" });
		setIcon(iconEl, STATUS_ICONS[file.status]);
		setTooltip(iconEl, STATUS_LABELS[file.status]);

		const main = row.createDiv({ cls: "librarian-progress-row-main" });
		const nameEl = main.createEl("a", {
			text: file.name,
			cls: "librarian-progress-name",
			href: "#",
		});
		nameEl.addEventListener("click", (ev) => {
			ev.preventDefault();
			const rawDir = this.plugin.settings.rawDir;
			const path = `${rawDir}/${file.name}`;
			this.plugin.app.workspace.openLinkText(path, "", false);
		});

		const detailBits: string[] = [];
		if (file.message && file.status === "running") detailBits.push(file.message);
		if (file.tokensIn !== undefined && file.tokensOut !== undefined) {
			detailBits.push(
				`${file.tokensIn.toLocaleString("de")} in / ${file.tokensOut.toLocaleString("de")} out`,
			);
		}
		if (file.costUsd !== undefined && file.costUsd > 0) {
			detailBits.push(formatCost(file.costUsd));
		}
		if (file.attempts && file.attempts > 1) detailBits.push(`${file.attempts} Versuche`);
		if (file.status === "error" && file.error) detailBits.push(file.error);

		if (detailBits.length > 0) {
			main.createDiv({ text: detailBits.join(" · "), cls: "librarian-progress-detail" });
		}
	}

	private summarize(state: RunState): {
		done: number;
		errors: number;
		cancelled: number;
		costUsd: number;
	} {
		let done = 0;
		let errors = 0;
		let cancelled = 0;
		let costUsd = 0;
		for (const f of state.files) {
			if (f.status === "ok" || f.status === "error" || f.status === "cancelled") done++;
			if (f.status === "error") errors++;
			if (f.status === "cancelled") cancelled++;
			if (f.costUsd) costUsd += f.costUsd;
		}
		return { done, errors, cancelled, costUsd };
	}
}
