import { Modal, ItemView, WorkspaceLeaf, type IconName } from "obsidian";
import type AiNotes from "main";
import SortItem from "views/SortItem.svelte";
import ChatView from "views/ChatView.svelte";
import SearchView from 'views/SearchView.svelte';
import store from "lib/store";

export const VIEW_TYPE_AI_NOTES: string = "llm-notes-similarity-view";
export const VIEW_TYPE_AI_CHAT: string = "llm-notes-chat-view";


export class SimilarityView extends ItemView {
	component?: SortItem;
	plugin: AiNotes;

	constructor(leaf: WorkspaceLeaf, plugin: AiNotes) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_AI_NOTES;
	}

	getDisplayText(): string {
		return "Similarity View";
	}

	getIcon(): IconName {
		return "sticker";
	}

	async onOpen(): Promise<void> {
		store.plugin.set(this.plugin);
		this.component = new SortItem({
			target: this.contentEl,
		});
	}

	async onClose(): Promise<void> {
		this.component?.$destroy();
	}

}

export class AiChatView extends ItemView {
	component?: ChatView;
	plugin: AiNotes;

	constructor(leaf: WorkspaceLeaf, plugin: AiNotes) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_AI_CHAT;
	}

	getDisplayText(): string {
		return "Chat View";
	}

	getIcon(): IconName {
		return "messages-square";
	}

	async onOpen(): Promise<void> {
		store.plugin.set(this.plugin);
		this.component = new ChatView({
			target: this.contentEl,
			props: {
				self_item_view: this,
			},
		});
	}

	async onClose(): Promise<void> {
		this.component?.$destroy();

		// save chat history to file
		if (this.plugin.chat_messages.length > 0) this.plugin.saveChatHistory(this.plugin.chat_messages);
	}

}

export class AiNotesSearchModal extends Modal {
	component?: SearchView;
	plugin: AiNotes;

	constructor(plugin: AiNotes) {
		super(plugin.app);
		this.plugin = plugin;
		this.setTitle("Search similar notes with LLM");
	}

	onOpen() {
		const { contentEl, plugin } = this;

		store.plugin.set(plugin);

		this.component = new SearchView({
			target: contentEl,
			props: {
				modal: this,
			},
		});
	}

	onClose() {
		this.component?.$destroy();
	}
}