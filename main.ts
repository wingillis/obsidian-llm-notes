import { Plugin, type TFile, WorkspaceLeaf } from 'obsidian';
import store from 'lib/store';
import AiNotesSettingsTab from 'views/settings';
import { type AiNotesSettings, DEFAULT_SETTINGS } from 'views/settings';
import { SimilarityView, AiChatView, AiNotesSearchModal, VIEW_TYPE_AI_CHAT, VIEW_TYPE_AI_NOTES } from 'views/item_views';
import { chatWithFiles, findSimilarChunksFromQuery, findSimilarFileChunks } from 'lib/actions';
import { registerFiles } from 'lib/db/records';
import { closeConnection, initializeRedis } from 'lib/db/redis-interface';
import ollama from 'ollama';

export interface AiNoteSections {
	file: TFile;
	file_path: string;
	contents: any;
	timestamp: number;
}

export interface ChatMessage {
	id: number;
	message: string;
	role: string;
	hidden_message?: string;
}

export default class AiNotes extends Plugin {
	// @ts-ignore
	settings: AiNotesSettings;
	// @ts-ignore
	status_bar_item: HTMLElement;

	chat_messages: ChatMessage[] = [];
	registering_files: boolean = false;
	first_run: boolean = true;

	async onload() {
		if (this.first_run) {
			await this.loadSettings();
			this.setupStatusBar();
			this.addSettingTab(new AiNotesSettingsTab(this));
			this.first_run = false;
		}

		// try connecting to ollama and redis before proceeding
		try {
			const _resp = await ollama.list();
			initializeRedis(this.settings);
		} catch (e) {
			this.settings.start_application = false;
			if (this.settings.debug) console.log("Cannot connect to ollama or redis. Check if they are running");

			await this.saveSettings();
			this.status_bar_item.setText('LLM(❌)');
		}

		if (this.settings.start_application) {
			this.status_bar_item.setText('LLM(🔄)');

			this.setupViews();

			this.addRibbonIcon('sticker', 'LLM notes: similar notes view', (evt: MouseEvent) => {
				this.openSimilarityView();
			});

			this.addRibbonIcon('messages-square', 'LLM notes: chat view', (evt: MouseEvent) => {
				this.openChatView();
			});

			this.setupCommands();

			// register event to find similar notes when file is opened
			this.registerEvent(this.app.workspace.on('file-open', this.fileOpened.bind(this)));

			this.app.workspace.onLayoutReady(async () => {
				this.registering_files = true;
				await registerFiles(this.app.vault, this.settings, this.status_bar_item);
				this.registering_files = false;
			});

			// periodically check for modified files every 45 seconds
			this.registerInterval(window.setInterval(async () => {
				if (!this.registering_files) {
					this.registering_files = true;
					const has_updates: boolean = await registerFiles(this.app.vault, this.settings, this.status_bar_item);
					if (has_updates) {
						this.fileOpened(this.app.workspace.getActiveFile());
					}
					this.registering_files = false;
				} else {
					if (this.settings.debug) console.log("Already registering files");
					this.fileOpened(this.app.workspace.getActiveFile());
				}
			}, 45000));
		}
	}

	onunload() {
		closeConnection();
	}

	private setupViews() {
		this.registerView(VIEW_TYPE_AI_NOTES, (leaf) => new SimilarityView(leaf, this));
		this.registerView(VIEW_TYPE_AI_CHAT, (leaf) => new AiChatView(leaf, this));
	}

	private setupStatusBar() {
		// Does not work on mobile apps.
		this.status_bar_item = this.addStatusBarItem();
		this.status_bar_item.setText('LLM(❌)');
	}

	private setupCommands() {
		this.addCommand({
			id: 'open-search-modal',
			name: 'Embedding-based file search',
			callback: () => {
				store.search_results.set([]);
				new AiNotesSearchModal(this).open();
			}
		});

		this.addCommand({
			id: 'open-chat-view',
			name: 'Chat with LLM',
			callback: () => {
				if (this.app.workspace.getLeavesOfType(VIEW_TYPE_AI_CHAT).length === 0) {
					this.openChatView();
				}
			}
		});

		this.addCommand({
			id: 'open-similarity-view',
			name: 'View similar notes to current note',
			callback: () => {
				this.openSimilarityView();
			}
		});

		this.addCommand({
			id: "new-chat",
			name: "Open new chat with LLM",
			callback: () => {
				this.openChatView();
			}
		});

		this.addCommand({
			id: "summarize-current-note",
			name: "Summarize current note",
			callback: async () => {
				await this.openChatView();
				this.sendMessage(`Summarize [[${this.app.workspace.getActiveFile()?.path}]]`);
			}
		});
	}

	async resetDatabase() {
		// force reset
		initializeRedis(this.settings, true);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async openView(view_type: string) {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(view_type);
		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({
				type: view_type,
				active: true,
			});
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async openSimilarityView() {
		this.openView(VIEW_TYPE_AI_NOTES);
	}

	async openChatView() {
		this.chat_messages = [];
		store.chat_messages.set(this.chat_messages);
		await this.openView(VIEW_TYPE_AI_CHAT);
	}

	async fileOpened(file: TFile | null) {
		// get file embedding
		if (!file) {
			if (this.settings.debug) console.log("No file opened");
			return;
		}

		// only run if similar notes view is open
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AI_NOTES);
		if (leaves.length === 0) {
			if (this.settings.debug) console.log("Similar notes view not open");
			return;
		}

		store.note_sections.set([]);

		// if note from chat history, don't run
		if (file.path.contains(`${this.settings.llm_folder}/`)) {
			if (this.settings.debug) console.log("File from chat history");
			return;
		}

		const similar_sections: AiNoteSections[] = await findSimilarFileChunks(this.app.vault, this.settings, file);

		// set similar_sections in svelte store
		store.note_sections.set(similar_sections);
	}

	async sendMessage(message: string) {

		this.chat_messages.push({
			id: Date.now(),
			message: message,
			hidden_message: message,
			role: "user",
		});

		store.chat_messages.set(this.chat_messages);

		let response = await chatWithFiles(this.app.vault, this.settings, this.chat_messages);

		this.chat_messages.push({
			id: Date.now(),
			message: "",
			role: "assistant",
		});

		for await (const part of response) {
			this.chat_messages[this.chat_messages.length - 1].message += part.message.content;
			this.chat_messages[this.chat_messages.length - 1].id = Date.now();
			store.chat_messages.set(this.chat_messages);
		}

		store.chat_messages.set(this.chat_messages);

		this.saveChatHistory(this.chat_messages);
	}

	async saveChatHistory(chat_history: ChatMessage[]) {
		const folder_name = this.settings.llm_folder;

		// combine chat history into single string
		const chat_history_str = chat_history.map((message) => {
			// remove .md extension from wikilinks
			return `## ${message.role}\n${message.message.replace(/\[\[(.*?)(\.md)?\]\]/g, "[[$1]]")}`;
		}).join("\n\n");

		// replace : with - in timestamp to avoid issues with file names and remove milliseconds
		const timestamp = new Date(chat_history[0].id).toISOString().replace(/:/g, "-").split(".")[0];
		const file_name = `${folder_name}/${timestamp}.md`;

		if (this.settings.debug) console.log(`Saving chat history to ${file_name}`);

		// create folder if it doesn't exist
		if (!this.app.vault.getFolderByPath(folder_name)) {
			await this.app.vault.createFolder(folder_name);
		}

		// save chat history to file
		await this.app.vault.adapter.write(file_name, chat_history_str);
	}

	async searchFiles(query: string) {
		const similar_sections: AiNoteSections[] = await findSimilarChunksFromQuery(this.app.vault, this.settings, query);

		store.search_results.set(similar_sections);
	}
}