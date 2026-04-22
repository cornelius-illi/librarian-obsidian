import { Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	LibrarianSettings,
	LibrarianSettingTab,
} from "./src/settings";

export default class LibrarianPlugin extends Plugin {
	settings!: LibrarianSettings;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new LibrarianSettingTab(this.app, this));

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

	private requireApiKey(): boolean {
		if (!this.settings.apiKey) {
			new Notice("Librarian: Kein Anthropic API-Key gesetzt — Einstellungen oeffnen.");
			return false;
		}
		return true;
	}
}
