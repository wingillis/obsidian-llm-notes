<script lang="ts">
    import type AiNotes from "main";
    import type { AiNoteSections } from "main";
    import type { AiNotesSearchModal } from "views/item_views";
    import store from "lib/store";
	import type { TFile } from "obsidian";

    export let modal: AiNotesSearchModal;

    const debounceDelay: number = 300;  // milliseconds
    let debounceTimeout: NodeJS.Timeout;
    let searchQuery: string = "";

    let search_results: AiNoteSections[];
    let plugin: AiNotes;

    store.plugin.subscribe((value: AiNotes) => (plugin = value));

    store.search_results.subscribe((value: AiNoteSections[]) => {
        search_results = value;
    });

    // Debounced search function
    function handleSearch() {
        // Clear the previous timeout to reset the delay
        clearTimeout(debounceTimeout);

        // Set a new timeout to call the search after the delay
        debounceTimeout = setTimeout(() => {
            plugin.searchFiles(searchQuery);
        }, debounceDelay);
    }

    function openFileCloseModal(e: MouseEvent, file: TFile) {

        const inNewLeaf = e.button === 1 || e.ctrlKey || e.metaKey;
		plugin.app.workspace.openLinkText(file.path, "Sort Item", inNewLeaf);

        modal.close();
    }
</script>

<div class="llm-notes-search-modal">
    <input class="llm-notes-search-input" type="text" bind:value={searchQuery} on:input={handleSearch} placeholder="Search notes..." />

    <div class="llm-notes-search-results">
        {#each search_results as result (result.timestamp)}
            <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
            <div
                class="tree-item-self is-clickable nav-file-title"
                on:click={(e) => openFileCloseModal(e, result.file)}
                role="contentinfo"
            >
                <div class="llm-notes-flex">
                    <div>{result.file_path.replace(".md", "")}</div>
                    <small class="llm-notes-summary">
                        {#if result.chunk.contents.length > 0}
                            {result.chunk.contents}
                        {:else}
                            <i>File empty</i>
                        {/if}
                    </small>
                </div>
            </div>
        {/each}
    </div>
</div>

<style>
.llm-notes-search-input {
    margin-top: 5px;
    margin-bottom: 5px;
}
.llm-notes-flex {
    display: flex;
    flex-direction: column;
    width: 100%;
}

.llm-notes-search-modal {
    display: flex;
    flex-direction: column;
    /* height: 80%; */
}

.llm-notes-search-results {
    overflow-y: auto;
    flex-grow: 1;
}

small.llm-notes-summary {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    max-width: 100%;
}
</style>
