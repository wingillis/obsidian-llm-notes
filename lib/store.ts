import { writable } from "svelte/store";
import type AiNotes  from "main";
import type { AiNoteSections, ChatMessage } from "main";

const plugin = writable<AiNotes>();
const note_sections = writable<Array<AiNoteSections>>([]);
const chat_messages = writable<Array<ChatMessage>>([]);
const search_results = writable<Array<AiNoteSections>>([]);
export default { plugin, note_sections, chat_messages, search_results };