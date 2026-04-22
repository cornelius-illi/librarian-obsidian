import { App, Modal, Setting } from "obsidian";

export class IngestConfirmModal extends Modal {
	private readonly files: string[];
	private readonly selected: Set<string>;
	private readonly resolve: (files: string[]) => void;

	constructor(app: App, files: string[], resolve: (files: string[]) => void) {
		super(app);
		this.files = files;
		this.selected = new Set(files);
		this.resolve = resolve;
	}

	static choose(app: App, files: string[]): Promise<string[]> {
		return new Promise((resolve) => {
			new IngestConfirmModal(app, files, resolve).open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: `Ingest — ${this.files.length} unverarbeitete Quelle(n)` });
		contentEl.createEl("p", {
			text: "Alle Dateien werden ueber Claude eingelesen. Deaktiviere, was du nicht ingestieren willst.",
			cls: "setting-item-description",
		});

		const listEl = contentEl.createDiv();
		listEl.style.maxHeight = "360px";
		listEl.style.overflowY = "auto";
		listEl.style.marginBottom = "1em";

		for (const file of this.files) {
			new Setting(listEl)
				.setName(file)
				.addToggle((toggle) =>
					toggle
						.setValue(this.selected.has(file))
						.onChange((value) => {
							if (value) this.selected.add(file);
							else this.selected.delete(file);
						}),
				);
		}

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Abbrechen")
					.onClick(() => {
						this.resolve([]);
						this.close();
					}),
			)
			.addButton((btn) =>
				btn
					.setCta()
					.setButtonText("Ingest starten")
					.onClick(() => {
						this.resolve([...this.selected]);
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
