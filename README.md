# Obsidian LLM notes

<div style="text-align: center">

![logo](assets/obsidian-llm-notes-logo.webp)

</div>

LLM notes is an Obsidian plugin that integrates **private** and **local** large language models (LLMs) to enhance:

- Search via text embeddings
- Synthesis via chat-like interactions
- Note similarity via semantic similarity
- Summarization via retrieval-based methods

## Limitations

- Currently, this plugin must be installed manually. There are a few issues with dependencies that I need to resolve before I can publish it to the Obsidian community plugins service.
- **Only ollama will be supported** for LLM interactions. This greatly reduces the complexity of this plugin.
- Milvus is required - without it, the plugin will not work.
- There aren't sophisticated error handling procedures in place yet. You need to make sure you install and set up all the requirements before trying to use the plugin.

## Installation and requirements

### Plugin

1. Download this plugin and extract it to your Obsidian vault's `.obsidian/plugins` directory.
2. Make sure node is installed on your system.
3. Run `npm install` in the plugin's directory to install the dependencies.
4. Run `npm run build` to build the plugin, creating the necessary `main.js` file.

**Don't enable the plugin in Obsidian yet - we need to set up `ollama` and `milvus` first.**

### Milvus/Docker

Milvus is a performant vector database that LLM notes uses to store note embeddings.

1. Install Docker on your system.
2. Follow the installation instructions for `milvus` [here](https://milvus.io/docs/install_standalone-docker.md).

Start the `milvus` container with the following command (also found in the installation instructions):

```bash
curl -sfL https://raw.githubusercontent.com/milvus-io/milvus/master/scripts/standalone_embed.sh -o standalone_embed.sh

bash standalone_embed.sh start
```

If you feel uncomfortable running this script, I encourage you to read it first, and/or analyze the contents with your favorite LLM.

### ollama

1. Follow the installation instructions for `ollama` [here](https://ollama.com/download).
If on a Mac, you can also install `ollama` with [Homebrew](https://formulae.brew.sh/formula/ollama) `brew install ollama`.
2. Run the server if it's not already running: `ollama serve`. I prefer to set a few environment variables before running the server:

```bash
OLLAMA_FLASH_ATTENTION=true OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_NUM_PARALLEL=2 ollama serve
```

3. Download a language and embedding model of your choice.
I recommend `llama3.2` and `all-minilm`.

```bash
# in a new terminal window while "ollama serve" is running
ollama pull all-minilm
ollama pull llama3.2
```

## Features

### Search

Input a keyword, phrase, or question to search for the most relevant notes in your Obsidian vault.

The search feature opens a modal that allows you to use keywords, phrases, or questions to search for the most relevant notes in your Obsidian vault.
Open the modal from the command palette.

### Chat

Chat with an LLM that has access to your Obsidian vault.

Using the Chat view, you can interact with your notes in a few supported ways:

1. using the `@workspace` command to select the most relevant notes in your Obsidian vault to respond to your query.
2. by inserting links to individual files from your Obsidian vault using the wikilinks syntax, i.e. [[folder/note_path]].

**Note**: you can use only one of these methods at a time.

All chats are stored in the `llm-chat` folder in your Obsidian vault.
You can change this folder in the settings.
Saved chats are ignored by LLM notes.

#### The `@workspace` command

When you type `@` in the chat view, a window will pop up, showing the currently supported keyword commands (which is only `@workspace` at the moment).
Clicking on the keyword will insert it into the chat.
Alternatively, pressing `tab` will insert the top-most keyword from the window into the chat.
Typing `@workspace` will enable the chat to integrate the most relevant notes from your Obsidian vault into the prompt sent to the LLM, and enhance the quality of model's response.

#### Linking to files

When you type `[[` in the chat view, a window will pop up, showing a list of all notes that contain the characters you've typed so far.
Clicking on a note will insert a link to that note in the chat.
Alternatively, pressing `tab` will insert the top-most note from the window into the chat.
Linking to notes will add the entire contents of the linked note to the prompt sent to the LLM, allowing you to interact with the note's contents.

### Similar notes

View the most similar notes to the current note based on semantic similarity.

This feature opens a view that shows the most similar notes to the current note.

### First-time setup

The first time you use the plugin, it will create a `milvus` database to store note embeddings.
The embedding generation process can take a long time, because I implemented a version of [Anthropic's contextual retrieval technique](https://www.anthropic.com/news/contextual-retrieval) to improve RAG output.

If you don't want to use this feature, you can disable it in the settings.

### Command palette

LLM chat adds a few commands to the command palette:

- **Embedding-based file search**: opens a modal to allow the user to use keywords, phrases, or questions to search for the most relevant notes in their Obsidian vault.
- **Chat with LLM**: opens a chat view to interact with the LLM.
- **Similar notes**: opens a a view to show the most similar notes to the current note.
- **New chat**: begins a new chat session with the LLM.
- **Summarize note**: begins a new chat session where the first response from the LLM summarizes the current note.

## Future directions

Some ideas I have for future development:

- Add generation capabilities to the editor
- Better error handling
- PDF support

I may not have time to implement these features. If you're interested in contributing, feel free to fork this repository and add them yourself.

## Comparison to other plugins

There are already several plugins that exist for Obsidian that integrate with LLMs, such as [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections)
and [Smart Second Brain](https://github.com/your-papa/obsidian-Smart2Brain).
I'm not attempting to compete or replace these plugins, although we all offer similar features.
However, there are a few key differences between LLM notes and these plugins:

- **Privacy**: LLM notes is designed to work **only** offline with local LLMs and does not support any cloud-based LLMs.
- **Clear organization**: LLM notes is designed to be simple and focused, with few installation dependencies. If there is a feature you want implemented, I hope that you can easily fork this repository and add it yourself.
- **Exposed LLM pipeline**: The search and chat features are not hidden behind `langchain` or API calls. The pipeline used is clearly defined in the code, and can be easily modified to experiment with more sophisticated approaches.
