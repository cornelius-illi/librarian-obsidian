import { App, Modal, Setting } from "obsidian";

export class ForgetSelectModal extends Modal {
	private readonly files: string[];
	private readonly resolve: (file: string | null) => void;
	private selected = "";

	constructor(app: App, files: string[], resolve: (file: string | null) => void) {
		super(app);
		this.files = files;
		this.resolve = resolve;
	}

	static choose(app: App, files: string[]): Promise<string | null> {
		return new Promise((resolve) => {
			new ForgetSelectModal(app, files, resolve).open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Forget — Quelle vergessen" });
		contentEl.createEl("p", {
			text: "Die gewaehlte Rohdatei wird aus dem Wiki entfernt — inklusive der ausschliesslich von ihr gestuetzten Fakten. Diese Aktion ist ueber Git reversibel. Die Rohdatei selbst bleibt erhalten und muss manuell geloescht werden.",
			cls: "setting-item-description",
		});

		new Setting(contentEl)
			.setName("Quelle")
			.addDropdown((dd) => {
				dd.addOption("", "— waehle eine Datei —");
				for (const file of this.files) {
					dd.addOption(file, file);
				}
				dd.onChange((value) => {
					this.selected = value;
				});
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Abbrechen")
					.onClick(() => {
						this.resolve(null);
						this.close();
					}),
			)
			.addButton((btn) =>
				btn
					.setCta()
					.setWarning()
					.setButtonText("Vergessen")
					.onClick(() => {
						if (!this.selected) return;
						this.resolve(this.selected);
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
