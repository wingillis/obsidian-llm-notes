<script lang="ts">
	import { onMount } from "svelte";
	import { MarkdownRenderer, type App } from "obsidian";

	export let markdownContent: string = "";
	export let app: App;
	export let selfref: any;

    let cleaned_content: string = "";

	let containerEl: HTMLElement;

	// render markdown when component mounts
	onMount(() => {
		renderMarkdownContent();
	});

	// re-render markdown when the content changes
	$: if (markdownContent) {
        // remove ".md" if exists in double brackets
        cleaned_content = markdownContent.replace(/\[\[(.*?)(\.md)?\]\]/g, "[[$1]]");
		renderMarkdownContent();
	}

	function renderMarkdownContent() {
		if (containerEl && markdownContent) {
			MarkdownRenderer.render(
				app,
				cleaned_content,
				containerEl,
				"Chat View.md",
				selfref,
			);
		}
	}

	function openLink(e: MouseEvent) {
		const target = e.target as HTMLElement;
		const closestAnchor =
			target.tagName === "A" ? target : target.closest("a");

		if (!closestAnchor) return;
		// Open an internal link in a new pane
		if (closestAnchor.hasClass("internal-link")) {
			e.preventDefault();
			const destination = closestAnchor.getAttr("href");
			const inNewLeaf = e.button === 1 || e.ctrlKey || e.metaKey;

			if (destination)
				app.workspace.openLinkText(
					destination,
					"Chat view.md",
					inNewLeaf,
				);
		}
	}
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
<div bind:this={containerEl} on:click={openLink} role="article"></div>
