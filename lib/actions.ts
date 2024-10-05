import ollama from 'ollama';
import type { TFile, Vault } from 'obsidian';
import type { MilvusClient, QueryResults, SearchResultData, SearchResults } from '@zilliz/milvus2-sdk-node';
import type { AiNotesSettings } from 'views/settings';
import { processFile } from 'lib/db/records';
import type { AiNoteSections, ChatMessage } from 'main';

export async function findSimilarFileChunks(vault: Vault, settings: AiNotesSettings, client: MilvusClient, file: TFile): Promise<AiNoteSections[]> {

    let file_embedding: number[];

    const file_res: QueryResults = await client.query({
        collection_name: "ai_notes_files",
        filter: `file_path == '${file.path}'`,
        output_fields: ["embedding"],
    });

    if (settings.debug) console.log("File query results:", file_res);

    // if not in db, add to db
    if (file_res.data.length === 0) {
        const output = await processFile(file, vault, settings, client);
        file_embedding = output?.file_output.embedding;
    } else {
        file_embedding = file_res.data[0].embedding;
    }

    // get similar embeddings from db
    const similar_chunks: SearchResults = await client.search({
        collection_name: "ai_notes",
        data: [file_embedding],
        limit: settings.similar_notes_search_limit,
        filter: `(file_path != '${file.path}') and chunk_length > 0`,
        params: {
            radius: settings.similarity_threshold,
            range: 1,
        },
        output_fields: ["file_path", "chunk", "embedding", "file_hash", "timestamp", "id"],
    });

    if (settings.debug) console.log("Similar chunk results:", similar_chunks);

    let similar_sections: AiNoteSections[] = [];
    // process entries from db, include TFile from obsidian
    for (let result of similar_chunks.results) {
        const { file_path, chunk } = result;
        const file: TFile | null = vault.getFileByPath(file_path);

        if (file) {
            similar_sections.push({
                file: file,
                file_hash: result.file_hash,
                file_path: file_path,
                embedding: result.embedding,
                chunk: chunk,
                chunk_hash: result.chunk_hash,
                timestamp: result.timestamp,
                id: result.id,
            });
        }
    }

    return similar_sections;
}

export async function findSimilarChunksFromQuery(vault: Vault, settings: AiNotesSettings, client: MilvusClient, query: string): Promise<AiNoteSections[]> {

    const response = await ollama.embed({
        model: settings.selected_embedding,
        input: query,
        options: {
            num_ctx: settings.context_window,
        }
    });
    const embedding: Array<number> = response.embeddings[0];

    const similar_chunks: SearchResults = await client.search({
        collection_name: "ai_notes",
        data: [embedding],
        limit: 100,
        filter: "chunk_length > 0",
        params: {
            radius: settings.similarity_threshold,
            range: 1,
        },
        output_fields: ["file_path", "chunk", "embedding", "file_hash", "timestamp", "id"],
    });

    if (settings.debug) console.log("Search query: similar chunk results:", similar_chunks);

    // re-rank search results using TF-IDF
    const ranked_results = rerankResults(query, similar_chunks.results, settings);

    if (settings.debug) console.log("Search query: similar chunk results after ranking and slicing:", ranked_results);

    let similar_sections: AiNoteSections[] = [];
    // process entries from db, include TFile from obsidian
    for (let result of ranked_results) {
        const file: TFile | null = vault.getFileByPath(result.file_path);

        if (file) {
            similar_sections.push({
                file: file,
                file_hash: result.file_hash,
                file_path: result.file_path,
                embedding: result.embedding,
                chunk: result.chunk,
                chunk_hash: result.chunk_hash,
                timestamp: result.timestamp,
                id: result.id,
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

function calculateIDF(term: string, results: SearchResultData[]): number {
    if (results.length === 0) return 0;

    const num_docs_with_term = results.filter((result: SearchResultData) => {
        return result.chunk.contents.toLocaleLowerCase().includes(term);
    }).length;
    return Math.log(results.length / (1 + num_docs_with_term)) + 1;
}

function calculateTF(term: string, document: string): number {
    const words = document.toLocaleLowerCase().split(/\s+/);
    const term_count = words.filter((word) => word === term).length;
    return Math.log(1 + term_count);
}

function TF_IDFRank(query: string, results: SearchResultData[], settings: AiNotesSettings) {
    // remove punctuation from query
    query = query.replace(/[.,\/#!$%\^&\*;:{}=\_`~()]/g, "").replace("-", " ");
    const terms = removeStopWords(query);

    if (settings.debug) console.log("Query terms:", terms);

    const tf_idf = terms.map(term => {
        const idf: number = calculateIDF(term, results);
        const tf: number[] = results.map(result => calculateTF(term, result.chunk.contents.toLocaleLowerCase()));
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

function rerankResults(query: string, results: SearchResultData[], settings: AiNotesSettings) {
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

async function workspaceRAG(query: string, settings: AiNotesSettings, client: MilvusClient) {
    // remove workspace keyword with optional space after from query using regex
    query = query.replace(/@workspace\s?/g, "");

    const response = await ollama.embed({
        model: settings.selected_embedding,
        input: query,
        options: {
            num_ctx: settings.context_window,
        }
    });

    const embedding: Array<number> = response.embeddings[0];

    const similar_chunks: SearchResults = await client.search({
        collection_name: "ai_notes",
        data: [embedding],
        limit: 50,
        params: {
            // expand search radius to include more results for this step
            radius: settings.similarity_threshold / 2,
            range: 1,
        },
        output_fields: ["file_path", "chunk"],
    });

    if (settings.debug) console.log("Workspace RAG search results:", similar_chunks);

    // reverse order so most relevant docs are near the query at bottom
    const ranked_results = rerankResults(query, similar_chunks.results, settings).reverse();

    // format and combine documents into a single string
    const document_string = ranked_results.map((result) => {
        return `\
<document>
File name:
${result.file_path.replace(".md", "")}

Contents:
${result.chunk.contents}
</document>\
`;
    }).join("\n\n");

    // create prompt with documents and query
    const prompt: string = `\
Below are documents that are relevant to the query provided; use these documents to generate a response.

${document_string}

When answering questions, ensure you cite the source document by providing the file name in wikilink format.
For example, to cite the document "example.md", use [[example]] in your response.
If the answer involves multiple documents, cite each source clearly.
For example, [[example1]] states that "..." and [[example2]] states that "...".
When pertinent, provide a direct quote from the source document.

<query>
${query}
</query>\
`;

    return prompt;

}

export async function chatWithFiles(vault: Vault, settings: AiNotesSettings, client: MilvusClient, messages: ChatMessage[]) {
    const sys_msg: string = "You are an expert at responding to queries about the given text.";

    const current_msg: string = messages[messages.length - 1].message;

    // step 1: parse message - check for referenced files
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
                let prompt = await workspaceRAG(current_msg, settings, client);
                messages[messages.length - 1].hidden_message = prompt;
            }
        }
    }

    // step 2: pre-process commands and modify message to add relevant context
    // do another search in the database for relevant context

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

    // step 3: send message to ollama
    let res = await ollama.chat({
        model: settings.selected_llm,
        messages: [
            { role: "system", content: sys_msg },
            ...chat_msgs,
        ],
        stream: true,
        options: {
            num_ctx: settings.context_window < context_len ? settings.context_window : context_len,
            temperature: 0.5,
            // seed: 0,
        }
    });

    return res;
}