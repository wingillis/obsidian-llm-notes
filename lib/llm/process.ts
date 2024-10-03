import ollama, { type ChatResponse, type Message } from 'ollama';

export async function getContext(contents: string, model: string) {

    const prompt: string = `\
<document>
${contents}
</document>
From the document above, provide a short succinct summary of the document that adds useful context.`

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
            num_ctx: Math.min(ctx_len, 100000),
            temperature: 0.7,
            seed: 0,
        }
    });

    return res.message.content;
}
