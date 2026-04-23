import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import {
	DEFAULT_SETTINGS,
	LibrarianSettings,
	LibrarianSettingTab,
} from "./src/settings";
import { ProgressStore } from "./src/core/progress";
import { ProgressView, VIEW_TYPE_LIBRARIAN_PROGRESS } from "./src/ui/ProgressView";

export default class LibrarianPlugin extends Plugin {
	settings!: LibrarianSettings;
	progress!: ProgressStore;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.progress = new ProgressStore();
		this.addSettingTab(new LibrarianSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_LIBRARIAN_PROGRESS,
			(leaf) => new ProgressView(leaf, this),
		);

		this.addCommand({
			id: "ingest-source",
			name: "Ingest source",
			callback: async () => {
				if (!this.requireApiKey()) return;
				const { runIngestCommand } = await import("./src/commands/ingest");
				await runIngestCommand(this);
			},
		});

		this.addCommand({
			id: "repair-broken-links",
			name: "Repair broken links",
			callback: async () => {
				if (!this.requireApiKey()) return;
				const { runRepairLinksCommand } = await import("./src/commands/repairLinks");
				await runRepairLinksCommand(this);
			},
		});

		this.addCommand({
			id: "forget-source",
			name: "Forget source",
			callback: async () => {
				if (!this.requireApiKey()) return;
				const { runForgetCommand } = await import("./src/commands/forget");
				await runForgetCommand(this);
			},
		});

		this.addCommand({
			id: "open-progress",
			name: "Open Librarian progress",
			callback: () => this.activateProgressView(),
		});

		this.addCommand({
			id: "cancel-run",
			name: "Cancel running ingest/repair",
			checkCallback: (checking) => {
				if (!this.progress.isRunning()) return false;
				if (checking) return true;
				const cancelled = this.progress.requestCancel();
				if (cancelled) new Notice("Librarian: Abbruch angefordert — wartet auf aktuelle Datei.");
				return true;
			},
		});

		this.addRibbonIcon("book-open", "Librarian: Ingest source", async () => {
			if (!this.requireApiKey()) return;
			const { runIngestCommand } = await import("./src/commands/ingest");
			await runIngestCommand(this);
		});

		console.log("Librarian plugin loaded");
	}

	onunload(): void {
		console.log("Librarian plugin unloaded");
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	isProgressViewOpen(): boolean {
		return this.app.workspace.getLeavesOfType(VIEW_TYPE_LIBRARIAN_PROGRESS).length > 0;
	}

	async activateProgressView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_LIBRARIAN_PROGRESS);
		let leaf: WorkspaceLeaf | null;
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_LIBRARIAN_PROGRESS, active: true });
			}
		}
		if (leaf) workspace.revealLeaf(leaf);
	}

	private requireApiKey(): boolean {
		if (!this.settings.apiKey) {
			new Notice("Librarian: Kein Anthropic API-Key gesetzt — Einstellungen oeffnen.");
			return false;
		}
		return true;
	}
}
