# Obsidian LLM notes

LLM notes is an Obsidian plugin that integrates **private** and **local** large language models (LLMs) to enhance:

- Search via text embeddings
- Synthesis via chat-like interactions
- Note similarity via semantic similarity 
- Summarization via retrieval-based methods

There are already several plugins that exist for Obsidian that integrate with LLMs, such as [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections)
and [Smart Second Brain](https://github.com/your-papa/obsidian-Smart2Brain).
I'm not attempting to compete or replace these plugins, although we all offer similar features.
However, there are a few key differences between LLM notes and these plugins:

- **Privacy**: LLM notes is designed to work **only** offline with local LLMs and does not support any cloud-based LLMs.
- **Clear organization**: LLM notes is designed to be simple and focused, with few installation dependencies. If there is a feature you want implemented, I hope that you can easily fork this repository and add it yourself.
- **Exposed LLM pipeline**: The search and chat features are not hidden behind `langchain` or API calls. The pipeline used is clearly defined in the code, and can be easily modified to experiment with more sophisticated approaches.

## Installation

### Requirements

### Limitations

## Features

### Search

### Chat

Using the Chat view, you can interact with your notes in a few supported ways:

1. using the `@workspace` command to select the most relevant notes in your Obsidian vault to respond to your query.
2. by inserting links to individual files from your Obsidian vault using the wikilinks syntax, i.e. [[folder/note_path]].

**Note**: you can use only one of these methods at a time.

#### The `@workspace` command

When you type `@` in the chat view, a window will pop up, giving you the currently supported keyword commands (which is only `@workspace` at the moment).
Typing `@workspace` will enable the chat to integrate the most relevant notes from your Obsidian vault into the prompt sent to the LLM, and enhance the quality of model's response.

### Similar notes

## Usage

### First-time setup

The first time you use the plugin, it will create a `milvus` database to store note embeddings.
The embedding generation process can take a long time, because I implemented a version of [Anthropic's contextual retrieval technique](https://www.anthropic.com/news/contextual-retrieval) to improve RAG output.

If you don't want to use this feature, you can disable it in the settings.

### Command palette

LLM chat adds a few commands to the command palette:
