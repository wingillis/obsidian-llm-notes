import type { MilvusClient } from "@zilliz/milvus2-sdk-node";
import type { AiNotesSettings } from "views/settings";
import type { TFile, Vault } from "obsidian";
import crypto from "crypto";
import ollama from "ollama";
import { findNewOrUpdatedFiles, insert } from "lib/db/collection";
import { getContext } from "lib/llm/process";

export interface FileRecord {
    contents: string;
    path: string;
    hash: string;
    modified_time: number;
}

async function addChunksToDB(file: FileRecord, settings: AiNotesSettings, client: MilvusClient): Promise<Array<any>> {

    let records: Array<any> = [];

    const { chunk_size, chunk_overlap } = settings;
    const offset: number = chunk_size - chunk_overlap;

    // compute total number of chunks
    let num_chunks = Math.ceil(file.contents.length / offset);

    if (Math.ceil(file.contents.length / chunk_size) <= 1) {
        num_chunks = 1;
    }

    let context: string = "";
    if (num_chunks > 1) {
        context = await getContext(file.contents, settings.selected_llm, settings.context_window);
        if (settings.debug) console.log("Summary:", context);
    } else {
        if (settings.debug) console.log("No context needed");
    }

    for (let i = 0; i < num_chunks; i++) {
        const chunk_idx: number = i * offset;
        let chunk: string = file.contents.slice(chunk_idx, chunk_idx + chunk_size);

        let context_chunk: string;
        if (context.length > 0) {
            context_chunk = `File: ${file.path}\nConext: ${context}\nDocument: ${chunk}`;
        } else {
            context_chunk = `File: ${file.path}\nDocument: ${chunk}`;
        }

        const chunk_hash: string = crypto.createHash("md5").update(context_chunk).digest("hex");

        if (settings.debug) console.log("Chunk hash:", chunk_hash);

        const json_obj = {
            contents: chunk,
            context: context,
            embed_model: settings.selected_embedding,
        };
        // call ollama to generate embeddings
        const full_length: number = Math.ceil(context_chunk.length / 4);
        const response = await ollama.embed({
            model: settings.selected_embedding,
            input: context_chunk,
            options: {
                num_ctx: settings.context_window < full_length ? full_length : settings.context_window,
            }
        });
        const embedding: Array<number> = response.embeddings[0];

        const record = {
            chunk: json_obj,
            chunk_length: chunk.length,
            timestamp: Date.now(),
            file_path: file.path,
            chunk_hash: chunk_hash,
            file_hash: file.hash,
            embedding: embedding,
            modified_time: file.modified_time,
            id: Date.now(),
        };
        // store embeddings
        records.push(record);
    }
    await insert(client, settings, records);

    return records;
}

async function addFileToDB(file: FileRecord, settings: AiNotesSettings, client: MilvusClient): Promise<any> {

    if (settings.debug) {
        console.log("File hash:", file.hash);
        console.log("Content length:", file.contents.length);
    }

    const ctx_size: number = Math.ceil(file.contents.length / 4);

    // call ollama to generate embeddings
    const response = await ollama.embed({
        model: settings.selected_embedding,
        input: file.contents.length == 0 ? " " : file.contents,
        options: {
            num_ctx: settings.context_window > ctx_size ? settings.context_window : ctx_size,
        }
    });

    const embedding: Array<number> = response.embeddings[0];

    const record = {
        file_path: file.path,
        file_hash: file.hash,
        file_length: file.contents.length,
        embedding: embedding,
        modified_time: file.modified_time,
        id: Date.now(),
    };

    // store embeddings
    await insert(client, settings, record, "ai_notes_files");
    return record;
}

export async function processFile(file: TFile, vault: Vault, settings: AiNotesSettings, client: MilvusClient) {

    const contents = await vault.cachedRead(file);

    // file content
    const file_record: FileRecord = {
        path: file.path,
        modified_time: file.stat.mtime,
        hash: crypto.createHash("md5").update(`${file.path}\n${contents}`).digest("hex"),
        contents: contents,
    };

    // add file to db
    let file_output = await addFileToDB(file_record, settings, client);

    // add chunks to db
    let chunk_outputs = await addChunksToDB(file_record, settings, client);

    return {
        file_output,
        chunk_outputs,
    }

}

export async function registerFiles(vault: Vault, settings: AiNotesSettings, status_bar_item: HTMLElement, client: MilvusClient): Promise<boolean> {
    const all_files: TFile[] = vault.getMarkdownFiles().filter((file) => {
        return !file.path.contains(`${settings.llm_folder}/`);
    });

    const files: TFile[] = await findNewOrUpdatedFiles(client, settings, all_files);

    let i = all_files.length - files.length;
    status_bar_item.setText(`LLM(🔄${i}/${all_files.length})`);

    for (let file of files) {
        await processFile(file, vault, settings, client);
        i += 1;
        status_bar_item.setText(`LLM(🔄${i}/${all_files.length})`)
    }

    status_bar_item.setText("LLM(✅)");

    return files.length > 0;
}