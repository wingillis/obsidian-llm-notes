import ollama from 'ollama';
import type { TFile, Vault } from 'obsidian';
import type { AiNotesSettings } from 'views/settings';
import type { AiNoteSections, ChatMessage } from 'main';
import { knnSearch, getFileEntryByPath, type KnnSearchResult } from 'lib/db/search';
import type { AiFileEntry } from 'lib/db/redis-interface';
import { embed } from './llm/process';


export async function findSimilarFileChunks(vault: Vault, settings: AiNotesSettings, file: TFile): Promise<AiNoteSections[]> {
    let similar_sections: AiNoteSections[] = [];

    const file_res: AiFileEntry | null = await getFileEntryByPath(file.path, settings);

    if (settings.debug) console.log("File query results:", file_res);

    // if not in db, send console log
    if (file_res === null) {
        if (settings.debug) console.log("File not in db, wait until all files are indexed");
        return similar_sections;
    }

    let file_embedding: number[] = file_res.embedding;
    // get similar embeddings from db
    const results: KnnSearchResult[] = await knnSearch(file.path, file_embedding, settings.similar_notes_search_limit, settings.similarity_threshold);
    if (settings.debug) console.log("Similar chunk results:", results);

    // process entries from db, include TFile from obsidian
    for (const result of results) {
        if (settings.debug) console.log("Result:", result);
        const { file_path, contents, timestamp } = result;
        const file: TFile | null = vault.getFileByPath(file_path);

        if (file) {
            similar_sections.push({
                file: file,
                file_path: file_path,
                contents: contents,
                timestamp: timestamp,
            });
        }
    }

    return similar_sections;
}

export async function findSimilarChunksFromQuery(vault: Vault, settings: AiNotesSettings, query: string): Promise<AiNoteSections[]> {

    const embedding = await embed(query, settings);
    if (settings.debug) console.log("Search query embedding:", embedding);
    const similar_chunks: KnnSearchResult[] = await knnSearch("", embedding, 150, settings.similarity_threshold);

    if (settings.debug) console.log("Search query:", query, "similar chunk results:", similar_chunks);

    // re-rank search results using TF-IDF
    const ranked_results = rerankResults(query, similar_chunks, settings);

    if (settings.debug) console.log("Search query: similar chunk results after ranking and slicing:", ranked_results);

    let similar_sections: AiNoteSections[] = [];
    // process entries from db, include TFile from obsidian
    for (let result of ranked_results) {
        const file: TFile | null = vault.getFileByPath(result.file_path);

        if (file) {
            similar_sections.push({
                file: file,
                file_path: result.file_path,
                contents: result.contents,
                timestamp: result.timestamp,
            });
        }
    }

    return similar_sections;
}

function getReferencedFiles(vault: Vault, message: string): TFile[] | null {
    // check for [[ ]] using regex in prompt
    const has_refs = message.match(/\[\[(.*?)\]\]/g);
    if (has_refs) {
        const refs = has_refs.map((ref) => {
            return ref.replace("[[", "").replace("]]", "");
        });
        const files: TFile[] = refs.map((ref) => {
            return vault.getAbstractFileByPath(ref) as TFile;
        });
        return files;
    }

    return null;

}

async function processForReferencedFiles(vault: Vault, last_msg: string) {

    const referenced_files = getReferencedFiles(vault, last_msg);

    // use regex to replace [[ or ]] with empty string
    const cleaned_last_msg = last_msg.replace(/\[\[(.*?)(\.md)?\]\]/g, "$1");

    // if there are referenced files, make new prompt with referenced files at the beginning
    if (referenced_files && referenced_files.length > 0) {

        let file_string_arr = await Promise.all(referenced_files.map(async (file) => {
            const contents = await vault.cachedRead(file);

            const out: string = `\
<document>
File name:
${file.path.replace(".md", "")}

Contents:
${contents}
</document>\
`;
            return out;
        }));

        const file_string: string = file_string_arr.join("\n");

        const prompt: string = `\
${file_string}

Using the documents above, answer the following query below to the best of your ability.

<query>
${cleaned_last_msg}
</query>\
        `;

        return {
            status: true,
            prompt: prompt,
        };
    } else {
        return {
            status: false,
            prompt: last_msg,
        };
    }
}

const ACCEPTED_KEYWORDS = ["@workspace"];
const STOP_WORDS = new Set(['the', 'is', 'and', 'a', 'to', 'in', 'of', 'for', 'at', 'an', 'on']);

function removeStopWords(text: string): string[] {
    return text.toLocaleLowerCase().split(/\s+/).filter((word) => {
        return !STOP_WORDS.has(word);
    });
}

function calculateIDF(term: string, results: KnnSearchResult[]): number {
    if (results.length === 0) return 0;

    const num_docs_with_term = results.filter(result => {
        return result.contents.toLocaleLowerCase().includes(term);
    }).length;
    return Math.log(results.length / (1 + num_docs_with_term)) + 1;
}

function calculateTF(term: string, document: string): number {
    const words = document.toLocaleLowerCase().split(/\s+/);
    const term_count = words.filter((word) => word === term).length;
    return Math.log(1 + term_count);
}

function TF_IDFRank(query: string, results: KnnSearchResult[], settings: AiNotesSettings) {
    // remove punctuation from query
    query = query.replace(/[.,\/#!$%\^&\*;:{}=\_`~()]/g, "").replace("-", " ");
    const terms = removeStopWords(query);

    if (settings.debug) console.log("Query terms:", terms);

    const tf_idf = terms.map(term => {
        const idf: number = calculateIDF(term, results);
        const tf: number[] = results.map(result => calculateTF(term, result.contents.toLocaleLowerCase()));
        return { term, idf, tf };
    });

    if (settings.debug) console.log("Term scores:", tf_idf);
    // remove terms with 0 tf
    const tf_idf_filtered = tf_idf.filter((term) => term.tf.reduce((a, b) => a + b, 0) > 0);

    if (settings.debug) console.log("Filtered term scores:", tf_idf_filtered);

    // compute tf-idf scores for each document and term
    const tf_idf_scores = tf_idf_filtered.map((term) => {
        return {
            term: term.term,
            scores: term.tf.map(tf => tf * term.idf),
        }
    });

    if (settings.debug) console.log("TF-IDF scores:", tf_idf_scores);

    // create average tf-idf score for each document from all terms
    const avg_scores = [];
    for (let i = 0; i < results.length; i++) {
        let sum = 0;
        for (let j = 0; j < tf_idf_scores.length; j++) {
            sum += tf_idf_scores[j].scores[i];
        }
        const doc_len = tf_idf_scores.length > 0 ? tf_idf_scores.length : 1;
        avg_scores.push({ score: sum / doc_len, index: i });
    }
    if (settings.debug) console.log("Average scores:", avg_scores);

    return avg_scores;
}

function rerankResults(query: string, results: KnnSearchResult[], settings: AiNotesSettings) {
    const tfidf_weight: number = 0.25;

    // re-rank search results using TF-IDF
    const ranking = TF_IDFRank(query, results, settings);

    // use ranking to re-order search results
    const ranked_results = ranking.sort((a, b) => {
        return (
            (tfidf_weight * b.score + (1 - tfidf_weight) * results[b.index].score) -
            (tfidf_weight * a.score + (1 - tfidf_weight) * results[a.index].score)
        );
    }).map((result) => results[result.index]);

    return ranked_results.slice(0, settings.similar_notes_search_limit);
}

async function workspaceRAG(query: string, settings: AiNotesSettings) {
    // remove workspace keyword with optional space after from query using regex
    query = query.replace(/@workspace\s?/g, "");

    const embedding: number[] = await embed(query, settings);
    const similar_chunks: KnnSearchResult[] = await knnSearch("", embedding, 150, settings.similarity_threshold);

    if (settings.debug) console.log("Workspace RAG search results:", similar_chunks);

    // reverse order so most relevant docs are near the query at bottom
    const ranked_results = rerankResults(query, similar_chunks, settings).reverse();

    // format and combine documents into a single string
    const document_string = ranked_results.map((result) => {
        return `\
<document>
File name:
${result.file_path.replace(".md", "")}

Contents:
${result.contents}
</document>\
`;
    }).join("\n\n");

    // create prompt with documents and query
    const prompt: string = `\
Below are documents that are relevant to the query provided; use these documents to generate a response.

${document_string}

When answering questions, ensure you cite the source document by providing the file name in wikilink format.
For example, to cite the document "source", use [[source]] in your response.
If the answer involves multiple documents, cite each source clearly.
For example, [[source1]] states that "..." and [[source2]] states that "...".

<query>
${query}
</query>\
`;

    return prompt;

}

export async function chatWithFiles(vault: Vault, settings: AiNotesSettings, messages: ChatMessage[]) {
    const sys_msg: string = "You are an expert at responding to queries about the given text.";

    const current_msg: string = messages[messages.length - 1].message;

    // step 1: parse and process message - check for referenced files and add relevant context
    const ref_file_resp = await processForReferencedFiles(vault, current_msg);
    if (ref_file_resp.status) {
        messages[messages.length - 1].hidden_message = ref_file_resp.prompt;
    } else {
        // look for keywords that start with @
        let keywords = ACCEPTED_KEYWORDS.filter((keyword) => {
            return current_msg.includes(keyword);
        });
        if (keywords.length > 0) {
            // get the first keyword in the message
            if (keywords.length > 1) {
                keywords = keywords.sort((a, b) => {
                    return current_msg.indexOf(a) - current_msg.indexOf(b);
                });
            }
            const keyword = keywords[0];

            if (keyword === "@workspace") {
                // use RAG on the whole workspace to generate a response
                let prompt = await workspaceRAG(current_msg, settings);
                messages[messages.length - 1].hidden_message = prompt;
            }
        }
    }

    if (settings.debug) console.log("Messages:\n", messages);

    const chat_msgs = messages.map((msg) => {
        return {
            role: msg.role,
            content: msg.hidden_message ? msg.hidden_message : msg.message,
        }
    });

    if (settings.debug) console.log("Chat messages:\n", chat_msgs);

    // compute context window for full message
    const context_len = Math.min(chat_msgs.map((msg) => msg.content.length).reduce((a, b) => a + b, 0) / 4, 128000);

    // step 2: send message to ollama
    let res = await ollama.chat({
        model: settings.selected_llm,
        messages: [
            { role: "system", content: sys_msg },
            ...chat_msgs,
        ],
        stream: true,
        options: {
            num_ctx: Math.max(settings.context_window, context_len),
            temperature: 0.5,
            // seed: 0,
        }
    });

    return res;
}