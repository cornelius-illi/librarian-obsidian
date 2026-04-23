import { App, Modal, Setting, ToggleComponent } from "obsidian";

export class IngestConfirmModal extends Modal {
	private readonly files: string[];
	private selected: Set<string>;
	private readonly resolve: (files: string[]) => void;
	private readonly toggles = new Map<string, ToggleComponent>();
	private counterEl: HTMLSpanElement | null = null;

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

		const controls = contentEl.createDiv({ cls: "librarian-ingest-controls" });
		this.counterEl = controls.createSpan({ cls: "librarian-ingest-counter" });

		const allBtn = controls.createEl("button", { text: "Alle" });
		allBtn.addEventListener("click", () => {
			this.selected = new Set(this.files);
			this.refreshToggles();
			this.updateCounter();
		});

		const noneBtn = controls.createEl("button", { text: "Keine" });
		noneBtn.addEventListener("click", () => {
			this.selected.clear();
			this.refreshToggles();
			this.updateCounter();
		});

		const invertBtn = controls.createEl("button", { text: "Invertieren" });
		invertBtn.addEventListener("click", () => {
			this.selected = new Set(this.files.filter((f) => !this.selected.has(f)));
			this.refreshToggles();
			this.updateCounter();
		});

		const listEl = contentEl.createDiv();
		listEl.style.maxHeight = "360px";
		listEl.style.overflowY = "auto";
		listEl.style.marginBottom = "1em";

		for (const file of this.files) {
			new Setting(listEl).setName(file).addToggle((toggle) => {
				toggle.setValue(this.selected.has(file)).onChange((value) => {
					if (value) this.selected.add(file);
					else this.selected.delete(file);
					this.updateCounter();
				});
				this.toggles.set(file, toggle);
			});
		}

		this.updateCounter();

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Abbrechen").onClick(() => {
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
		this.toggles.clear();
	}

	private refreshToggles(): void {
		for (const [file, toggle] of this.toggles) {
			toggle.setValue(this.selected.has(file));
		}
	}

	private updateCounter(): void {
		if (!this.counterEl) return;
		this.counterEl.setText(`${this.selected.size} von ${this.files.length} ausgewaehlt`);
	}
}
