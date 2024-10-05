<script lang="ts">
	import type AiNotes from "main";
	import store from "lib/store";
	import type { ChatMessage } from "main";
	import { afterUpdate, onMount } from "svelte";
	import type { TFile, ItemView } from "obsidian";
	import { sequenceMatchingSearch } from "lib/search";
	import MarkdownView from "views/MarkdownView.svelte";

	export let self_item_view: ItemView;
	let textAreaRef: HTMLTextAreaElement;
	let chatAreaRef: HTMLDivElement;
	let chat_messages: ChatMessage[];
	let message: string = "";
	let plugin: AiNotes;
	let showFileDropdown: boolean = false;
	let showKeywordDropdown: boolean = false;
	let file_suggestions: TFile[] = [];
	let keyword_suggestions: string[] = [];
	let userHasScrolledUp: boolean = false;

	store.plugin.subscribe((value: AiNotes) => (plugin = value));

	store.chat_messages.subscribe((value: ChatMessage[]) => {
		chat_messages = value;
	});

	function sendMessage() {
		plugin.sendMessage(message);
		message = "";
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
			setTimeout(() => {
				autoResize();
			}, 10);
		}
		if ((e as KeyboardEvent).key === "Tab") {
			if (showFileDropdown && file_suggestions.length > 0) {
				e.preventDefault();
				insertFileLink(file_suggestions[0]);
			} else if (showKeywordDropdown && keyword_suggestions.length > 0) {
				e.preventDefault();
				insertKeyword(keyword_suggestions[0]);
			}
		}
	}

	function getNoteSuggestions(query: string) {
		// ignore folders from llm-chat
		const files = plugin.app.vault.getMarkdownFiles().filter((file) => {
			return !file.path.contains(`${plugin.settings.llm_folder}/`);
		});

		file_suggestions = sequenceMatchingSearch(query, files);
		showFileDropdown = file_suggestions.length > 0;
	}

	const KEYWORDS: string[] = ["workspace"];

	function getKeywordSuggsetions(query: string) {
		keyword_suggestions = KEYWORDS.filter((keyword) =>
			keyword.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
		);
		showKeywordDropdown = keyword_suggestions.length > 0;
	}

	function handleInput(e: Event) {

		let cursorPos = textAreaRef.selectionStart;

		// find the last occurrence of "[[" before the cursor
		let lastOpenBracket = message.lastIndexOf("[[", cursorPos - 1);
		let lastCloseBracket = message.lastIndexOf("]]", cursorPos - 1);

		// find position of @ symbol
		let lastAtSymbol = message.lastIndexOf("@", cursorPos - 1);
		
		if (
			lastOpenBracket !== -1 &&
			cursorPos > lastOpenBracket &&
			lastCloseBracket < lastOpenBracket
		) {
			const incomplete_fname = message.substring(
				lastOpenBracket + 2,
				cursorPos,
			);
			getNoteSuggestions(incomplete_fname);
		} else if (lastAtSymbol !== -1) {
			const incomplete_keyword = message.substring(
				lastAtSymbol + 1,
				cursorPos,
			);
			getKeywordSuggsetions(incomplete_keyword);
		} else {
			showFileDropdown = false;
		}

		autoResize();
	}

	function autoResize() {
		textAreaRef.style.height = "auto";
		textAreaRef.style.height = textAreaRef.scrollHeight + "px";
	}

	function scrollBottom() {
		if (chatAreaRef && !userHasScrolledUp) chatAreaRef.scrollTop = chatAreaRef.scrollHeight;
	}

	function handleScroll(e: Event) {
		if (chatAreaRef) {
			const isScrolledToBottom = chatAreaRef.scrollHeight - chatAreaRef.clientHeight <= chatAreaRef.scrollTop + 1;
			userHasScrolledUp = !isScrolledToBottom;
		}
	}

	function insertFileLink(file: TFile) {
		const cursorPos = textAreaRef.selectionStart;
		const lastOpenBracket = message.lastIndexOf("[[", cursorPos - 1);
		const before = message.substring(0, lastOpenBracket);
		const after = message.substring(cursorPos);

		message = `${before}[[${file.path}]]${after}`;

		setTimeout(() => {
			autoResize();
		}, 10);

		textAreaRef.focus();

		showFileDropdown = false;
		file_suggestions = [];
	}

	function insertKeyword(keyword: string) {
		const cursorPos = textAreaRef.selectionStart;
		const lastAtSymbol = message.lastIndexOf("@", cursorPos - 1);
		const before = message.substring(0, lastAtSymbol);
		const after = message.substring(cursorPos);

		message = `${before}@${keyword}${after}`;

		setTimeout(() => {
			autoResize();
		}, 10);

		textAreaRef.focus();

		showKeywordDropdown = false;
		keyword_suggestions = [];
	}

	onMount(() => {
		setTimeout(() => {
			autoResize();
		}, 10);
		if (chatAreaRef) scrollBottom();

		setTimeout(() => {
			textAreaRef.focus();
		}, 50);
	});

	afterUpdate(() => {
		if (chatAreaRef) scrollBottom();
	});
</script>

<div class="llm-notes-chat-container">
	<div class="llm-notes-chat-header">
		<h4>Chat</h4>
	</div>
	<div class="llm-notes-chat-body" bind:this={chatAreaRef} on:scroll={handleScroll}>
		{#each chat_messages as msg (msg.id)}
			<div class="llm-notes-chat-message llm-notes-chat-{msg.role}">
				<b>{msg.role}</b>
				<MarkdownView markdownContent={msg.message} app={plugin.app} item_view={self_item_view} />
			</div>
		{/each}
		{#if chat_messages.length > 0 && chat_messages[chat_messages.length - 1].role === "user"}
			<div class="llm-notes-chat-message llm-notes-chat-assistant">
				<b>assistant</b>
				<div class="spinner"></div>
			</div>
		{/if}
	</div>
	<div class="llm-notes-chat-form">
		{#if showFileDropdown}
			<div class="llm-notes-suggestion-dropdown">
				{#each file_suggestions as file}
					<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
					<div
						class="llm-notes-suggestion-item"
						on:click={() => insertFileLink(file)}
					>
						{file.path}
					</div>
				{/each}
			</div>
		{/if}

		{#if showKeywordDropdown}
			<div class="llm-notes-suggestion-dropdown">
				{#each keyword_suggestions as keyword}
					<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
					<div
						class="llm-notes-suggestion-item"
						on:click={() => insertKeyword(keyword)}
					>
						{keyword}
					</div>
				{/each}
			</div>
		{/if}

		<textarea
			class="llm-notes-chat-input"
			placeholder="Chat examples: &quot;@workspace list tasks&quot, &quot;Summarize [[note]]&quot"
			bind:value={message}
			bind:this={textAreaRef}
			on:input={handleInput}
			on:keydown={(e) => handleKeyDown(e)}
		></textarea>
	</div>
</div>

<style>
	.spinner {
		width: 20px;
		height: 20px;
		border: 4px solid var(--color-base-30); /* Light border */
		border-top-color: var(--color-base-100); /* Blue color */
		border-radius: 50%;
		animation: spin 1s ease infinite;
		margin: 7px;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	.llm-notes-suggestion-dropdown {
		/* position: absolute; */
		background: var(--background-secondary-alt);
		border: 1px solid var(--background-modifier-border);
		z-index: 100;
		width: 100%;
		max-height: 150px;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0.5rem;
	}

	.llm-notes-suggestion-item {
		padding: 5px;
		cursor: pointer;
	}

	.llm-notes-suggestion-item:hover {
		background-color: var(--background-modifier-active-hover);
	}

	.llm-notes-chat-user {
		align-self: flex-end;
	}

	.llm-notes-chat-body {
		flex-grow: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		padding-bottom: 8px;
		padding-right: 5px;
	}

	.llm-notes-chat-container {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
	}

	.llm-notes-chat-input {
		width: 100%;
		padding: 0.5rem;
		overflow: hidden;
		resize: none;
		/* min-height: 70px; */
		max-height: 300px;
	}

	.llm-notes-chat-message {
		max-width: 75%;
		background-color: var(--code-background);
		margin-top: 4px;
		padding: 8px;
	}
</style>
