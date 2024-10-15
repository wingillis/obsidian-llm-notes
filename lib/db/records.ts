import type { AiNotesSettings } from "views/settings";
import type { TFile, Vault } from "obsidian";
import crypto from "crypto";
import { getContext, embed } from "lib/llm/process";
import type { AiNoteEntry, AiFileEntry } from "lib/db/redis-interface";
import { bulkInsert, findNewOrUpdatedFiles } from "lib/db/redis-interface";

export interface FileRecord {
    contents: string;
    path: string;
    hash: string;
    modified_time: number;
}

async function addChunksToDB(file: FileRecord, settings: AiNotesSettings): Promise<Array<any>> {

    let records: AiNoteEntry[] = [];

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
            context_chunk = `File: ${file.path}\nContext: ${context}\nDocument: ${chunk}`;
        } else {
            context_chunk = `File: ${file.path}\nDocument: ${chunk}`;
        }

        const chunk_hash: string = crypto.createHash("md5").update(context_chunk).digest("hex");

        if (settings.debug) console.log("Chunk hash:", chunk_hash);

        // call ollama to generate embeddings
        const embedding: Array<number> = await embed(context_chunk, settings);

        const record: AiNoteEntry = {
            id: Date.now(),
            embedding: embedding,
            timestamp: Date.now(),
            file_path: file.path,
            file_hash: file.hash,
            chunk_length: chunk.trim().length,
            chunk_hash: chunk_hash,
            contents: chunk,
            context: context,
            embed_model: settings.selected_embedding,
            modified_time: file.modified_time,
        };
        // store embeddings
        records.push(record);
    }
    await bulkInsert(records, settings, "ai_notes");

    return records;
}

async function addFileToDB(file: FileRecord, settings: AiNotesSettings): Promise<any> {

    if (settings.debug) {
        console.log("File hash:", file.hash);
        console.log("Content length:", file.contents.length);
    }

    // call ollama to generate embeddings
    const embedding: Array<number> = await embed(file.contents.length == 0 ? " " : file.contents, settings);

    const record: AiFileEntry = {
        id: Date.now(),
        embedding: embedding,
        file_hash: file.hash,
        file_path: file.path,
        file_length: file.contents.trim().length,
        modified_time: file.modified_time,
    };

    // store embeddings
    await bulkInsert([record], settings, "ai_notes_files");
    return record;
}

export async function processFile(file: TFile, vault: Vault, settings: AiNotesSettings) {

    const contents = await vault.cachedRead(file);

    // file content
    const file_record: FileRecord = {
        path: file.path,
        modified_time: file.stat.mtime,
        hash: crypto.createHash("md5").update(`${file.path}\n${contents}`).digest("hex"),
        contents: contents,
    };

    // add file to db
    let file_output = await addFileToDB(file_record, settings);

    // add chunks to db
    let chunk_outputs = await addChunksToDB(file_record, settings);

    return {
        file_output,
        chunk_outputs,
    }

}

export async function registerFiles(vault: Vault, settings: AiNotesSettings, status_bar_item: HTMLElement): Promise<boolean> {
    const all_files: TFile[] = vault.getMarkdownFiles().filter((file) => {
        return !file.path.contains(`${settings.llm_folder}/`);
    });

    const files: TFile[] = await findNewOrUpdatedFiles(all_files, settings);

    let i = all_files.length - files.length;
    status_bar_item.setText(`LLM(🔄${i}/${all_files.length})`);

    for (let file of files) {
        await processFile(file, vault, settings);
        i += 1;
        status_bar_item.setText(`LLM(🔄${i}/${all_files.length})`)
    }

    status_bar_item.setText("LLM(✅)");

    return files.length > 0;
}