<script lang="ts">
	import type AiNotes from "main";
	import type { TFile } from "obsidian";
	import store from "lib/store";
	import type { AiNoteSections } from "main";
	import { onMount } from "svelte";

	let plugin: AiNotes;
	store.plugin.subscribe((value: AiNotes) => (plugin = value));

	let note_sections: AiNoteSections[];
	store.note_sections.subscribe(
		(value: AiNoteSections[]) => (note_sections = value),
	);

	function handleResultClick(file: TFile) {
		plugin.app.workspace.getLeaf().openFile(file);
	}

    onMount(async () => {
        // repeat trying up to 3 times until no error is thrown
        for (let i = 0; i < 3; i++) {
            try {
                await plugin.fileOpened(plugin.app.workspace.getActiveFile());
                break;
            } catch (e) {
                await sleep(300);
            }
        }
    });

</script>

<h4>Similar notes</h4>
<div class="llm-notes-search-results">
    {#each note_sections as result (result.chunk_hash)}
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
        <div
            class="tree-item-self is-clickable nav-file-title"
            on:click={() => handleResultClick(result.file)}
            role="contentinfo"
        >
            <div class="llm-notes-flex">
                <div>{result.file_path}</div>
                <small class="llm-notes-summary">{result.chunk.contents}</small>
            </div>
        </div>
    {/each}
</div>

<style>
    .llm-notes-flex {
        display: flex;
        flex-direction: column;
        width: 100%;
    }

    small.llm-notes-summary {
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
        max-width: 100%;
    }
</style>
