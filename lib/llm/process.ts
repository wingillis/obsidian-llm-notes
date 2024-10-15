import ollama, { type ChatResponse, type Message } from 'ollama';
import type { AiNotesSettings } from "views/settings";


export async function getEmbeddingDim(settings: AiNotesSettings): Promise<number> {
    return (await embed("test", settings)).length;
}

export async function embed(text: string, settings: AiNotesSettings): Promise<Array<number>> {
    const full_length: number = Math.ceil(text.length / 4);
    const response = await ollama.embed({
        model: settings.selected_embedding,
        input: text,
        options: {
            num_ctx: Math.max(settings.context_window, full_length),
        }
    });

    return response.embeddings[0];
}

export async function getContext(contents: string, model: string, context_window: number): Promise<string> {

    const prompt: string = `\
<document>
${contents}
</document>

The above document contains notes written by me.
Using the document above, provide a short succinct summary that adds useful context.`

    const ctx_len: number = Math.ceil(prompt.length / 4);

    let sys_msg: Message = {
        role: "system",
        content: "You are an expert of adding context to succinctly summarize the given documents. Only respond with a few sentences to summarize the text. Do not add an explanation for your decisions. Do not give examples.",
    }

    let res: ChatResponse = await ollama.chat({
        model: model,
        messages: [
            sys_msg,
            {
                role: "user",
                content: prompt,
            },
        ],
        stream: false,
        options: {
            num_ctx: Math.max(context_window, ctx_len),
            temperature: 0.7,
            seed: 0,
        }
    });

    return res.message.content;
}
