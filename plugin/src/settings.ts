import { App, PluginSettingTab, Setting } from "obsidian";
import type LibrarianPlugin from "../main";

export interface LibrarianSettings {
	apiKey: string;
	modelIngest: string;
	modelLint: string;
	modelQuery: string;
	rawDir: string;
	wikiDir: string;
	maxContextChars: number;
	relevantPageLimit: number;
	maxPageAllowList: number;
}

export const DEFAULT_SETTINGS: LibrarianSettings = {
	apiKey: "",
	modelIngest: "claude-sonnet-4-6",
	modelLint: "claude-sonnet-4-6",
	modelQuery: "claude-sonnet-4-6",
	rawDir: "raw",
	wikiDir: "wiki",
	maxContextChars: 80_000,
	relevantPageLimit: 12,
	maxPageAllowList: 800,
};

export class LibrarianSettingTab extends PluginSettingTab {
	plugin: LibrarianPlugin;

	constructor(app: App, plugin: LibrarianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Librarian" });

		const warn = containerEl.createDiv({ cls: "callout" });
		warn.createEl("strong", { text: "Hinweis zum API-Key: " });
		warn.appendText(
			"Dieser wird in .obsidian/plugins/librarian/data.json gespeichert. Verschluesselung kommt in einer spaeteren Version. Synchronisiere diese Datei nicht mit einem oeffentlichen Repo.",
		);

		new Setting(containerEl)
			.setName("Anthropic API Key")
			.setDesc("Dein Claude API-Key (https://console.anthropic.com/).")
			.addText((text) =>
				text
					.setPlaceholder("sk-ant-...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "Modelle" });

		new Setting(containerEl)
			.setName("Ingest-Modell")
			.setDesc("Fuer das Einlesen und Zerlegen neuer Quellen. Opus bei kritischen Themen, Sonnet fuer Volume.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.modelIngest)
					.onChange(async (value) => {
						this.plugin.settings.modelIngest = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Lint-Modell")
			.setDesc("Fuer das Reparieren fehlender Seiten.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.modelLint)
					.onChange(async (value) => {
						this.plugin.settings.modelLint = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Query-Modell")
			.setDesc("Fuer Fragen ans Wiki (falls du die Query-Funktion nutzt).")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.modelQuery)
					.onChange(async (value) => {
						this.plugin.settings.modelQuery = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "Pfade" });

		new Setting(containerEl)
			.setName("raw/ Verzeichnis")
			.setDesc("Wo Rohquellen liegen (relativ zum Vault).")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.rawDir)
					.onChange(async (value) => {
						this.plugin.settings.rawDir = value.trim() || "raw";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("wiki/ Verzeichnis")
			.setDesc("Wo die Wiki-Seiten landen (relativ zum Vault).")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.wikiDir)
					.onChange(async (value) => {
						this.plugin.settings.wikiDir = value.trim() || "wiki";
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "Limits" });

		new Setting(containerEl)
			.setName("Max Kontext-Zeichen")
			.setDesc("Maximale Zeichenzahl bestehender Wiki-Seiten die pro Claude-Call uebergeben werden.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.maxContextChars))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n > 0) {
							this.plugin.settings.maxContextChars = n;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Top-N relevante Seiten pro Ingest")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.relevantPageLimit))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n > 0) {
							this.plugin.settings.relevantPageLimit = n;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Maximale Allow-List-Groesse")
			.setDesc("Obergrenze fuer die Wikilink-Allow-List die an Claude uebergeben wird (Rest wird abgeschnitten).")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.maxPageAllowList))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n > 0) {
							this.plugin.settings.maxPageAllowList = n;
							await this.plugin.saveSettings();
						}
					}),
			);
	}
}
