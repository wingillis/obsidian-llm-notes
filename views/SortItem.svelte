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

	function handleResultClick(e: MouseEvent, file: TFile) {
        // if control/command was pressed, open the file in a new pane
        const inNewLeaf = e.button === 1 || e.ctrlKey || e.metaKey;
		plugin.app.workspace.openLinkText(file.path, "Sort Item", inNewLeaf);
        e.preventDefault();
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
    {#each note_sections as result (result.timestamp)}
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
        <div
            class="tree-item-self is-clickable nav-file-title"
            on:click={(e) => handleResultClick(e, result.file)}
            role="contentinfo"
        >
            <div class="llm-notes-flex">
                <div>{result.file_path.replace(".md", "")}</div>
                <small class="llm-notes-summary">{result.contents}</small>
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
