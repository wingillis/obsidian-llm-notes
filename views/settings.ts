import type AiNotes from "main";
import { PluginSettingTab, Setting } from "obsidian";
import type { ListResponse } from "ollama";
import ollama from "ollama";


export interface AiNotesSettings {
	selected_llm: string;
	selected_embedding: string;
	chunk_size: number;
	chunk_overlap: number;
	use_context: boolean;
	context_window: number;
	similar_notes_search_limit: number;
	similarity_threshold: number;
	llm_folder: string;
	start_application: boolean;
	debug: boolean;
}

export const DEFAULT_SETTINGS: Partial<AiNotesSettings> = {
	selected_llm: 'llama3.2',
	selected_embedding: 'nomic-embed-text',
	chunk_size: 1024,
	chunk_overlap: 256,
	use_context: true,
	context_window: 8192,
	similar_notes_search_limit: 15,
	similarity_threshold: 0.25,
	llm_folder: 'llm-chats',
	start_application: false,
	debug: false,
}


export default class AiNotesSettingsTab extends PluginSettingTab {
	plugin: AiNotes;

	constructor(plugin: AiNotes) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Default LLM")
			.setDesc("Set the default LLM model from Ollama to use")
			.addDropdown(async (dropdown) => {
				let response: ListResponse;
				try {
					response = await ollama.list();
				} catch (e) {
					response = { models: [] };
				}
				// @ts-ignore
				dropdown.addOptions(response.models.map((model) => {
					return model.name;
				}))
					.setValue(response.models.findIndex((model) => model.name === this.plugin.settings.selected_llm).toString())
					.onChange(async (value: string) => {
						this.plugin.settings.selected_llm = response.models[parseInt(value)].name;
						await this.plugin.saveSettings();
					})
			});

		new Setting(containerEl)
			.setName("Default embedding model")
			.setDesc("Set the default embedding model from Ollama to use. Download one if you haven't already.")
			.addDropdown(async (dropdown) => {
				let response: ListResponse;
				try {
					response = await ollama.list();
				} catch (e) {
					response = { models: [] };
				}
				// @ts-ignore
				dropdown.addOptions(response.models.map((model) => {
					return model.name;
				}))
					.setValue(response.models.findIndex((model) => model.name === this.plugin.settings.selected_embedding).toString())
					.onChange(async (value: string) => {
						this.plugin.settings.selected_embedding = response.models[parseInt(value)].name;
						await this.plugin.saveSettings();
					})
				});

		new Setting(containerEl)
			.setName('Embedding chunk size (characters)')
			.setDesc('Set the number of characters to use for each embedding chunk. Token embeddings are typically about 4 characters.')
			.addText(text => text
				.setPlaceholder('Enter chunk size')
				.setValue(`${this.plugin.settings.chunk_size}`)
				.onChange(async (value) => {
					this.plugin.settings.chunk_size = parseInt(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Embedding chunk overlap (characters)')
			.setDesc('Set the number of characters for overlapping subsequent embedding chunks')
			.addText(text => text
				.setPlaceholder('Enter chunk overlap size')
				.setValue(`${this.plugin.settings.chunk_overlap}`)
				.onChange(async (value) => {
					this.plugin.settings.chunk_overlap = parseInt(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Use context for embeddings')
			.setDesc('Include document context for chunk-level embeddings. WARNING: document embedding is significantly slower when enabled.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.use_context)
				.onChange(async (value) => {
					this.plugin.settings.use_context = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Context window size (tokens)')
			.setDesc('Set the number of tokens to use for context window. Smaller values use less memory. If a document is larger' +
				'than the context window, the context size will be automatically increased for that document.')
			.addText(text => text
				.setPlaceholder('Enter context window size')
				.setValue(`${this.plugin.settings.context_window}`)
				.onChange(async (value) => {
					this.plugin.settings.context_window = parseInt(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Similar notes search limit')
			.setDesc('Set the number of similar notes to search for')
			.addText(text => text
				.setPlaceholder('Enter search limit')
				.setValue(`${this.plugin.settings.similar_notes_search_limit}`)
				.onChange(async (value) => {
					this.plugin.settings.similar_notes_search_limit = parseInt(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Similarity threshold')
			.setDesc('Set the similarity threshold for filtering useful search results')
			.addText(text => text
				.setPlaceholder('Enter similarity threshold')
				.setValue(`${this.plugin.settings.similarity_threshold}`)
				.onChange(async (value) => {
					this.plugin.settings.similarity_threshold = parseFloat(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('LLM chat folder')
			.setDesc('Set the folder to store LLM chat files as markdown notes')
			.addText(text => text
				.setPlaceholder('Enter LLM folder')
				.setValue(this.plugin.settings.llm_folder)
				.onChange(async (value) => {
					this.plugin.settings.llm_folder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Reset database')
			.setDesc('Resets the database. All data will be lost. Mostly used for development.')
			// make a button that raises an alert to confirm reset
			.addButton(button => button
				.setButtonText('Reset database')
				.onClick(async () => {
					if (confirm('Are you sure you want to reset the database? All data will be lost.')) {
						this.plugin.resetDatabase();
					}
				}));

		if (!this.plugin.settings.start_application) {
			new Setting(containerEl)
				.setName('Start plugin')
				.setDesc('Start the plugin once Ollama and Milvus are running')
				.addButton(button => button
					.setButtonText('Start plugin')
					.onClick(async () => {
						this.plugin.settings.start_application = true;
						await this.plugin.saveSettings();
						await this.plugin.onload();
					}));
		}

		new Setting(containerEl)
			.setName('Debug')
			.setDesc('Enable debug mode. Logs will be printed to dev console')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debug)
				.onChange(async (value) => {
					this.plugin.settings.debug = value;
					await this.plugin.saveSettings();
				}));
	}
}

