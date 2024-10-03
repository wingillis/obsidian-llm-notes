import { MilvusClient, DataType, type RowData } from "@zilliz/milvus2-sdk-node";
import type { TFile } from "obsidian";
import type { AiNotesSettings } from "views/settings";

async function initializeCollection(client: MilvusClient, collection_name: string = "ai_notes") {
    let fields, index_params;

    if (collection_name === "ai_notes") {
        fields = [
            { name: "id", data_type: DataType.Int64, is_primary_key: true },
            { name: "embedding", data_type: DataType.FloatVector, dim: 384 },
            { name: "timestamp", data_type: DataType.Int64 },
            { name: "file_path", data_type: DataType.VarChar, max_length: 1000 },
            { name: "file_hash", data_type: DataType.VarChar, max_length: 32 },
            { name: "chunk_hash", data_type: DataType.VarChar, max_length: 32 },
            { name: "chunk", data_type: DataType.JSON },
            { name: "modified_time", data_type: DataType.Int64 },
        ]

        index_params = [
            { field_name: "id", index_type: "STL_SORT" },
            { field_name: "modified_time", index_type: "STL_SORT" },
            { field_name: "chunk_hash", index_type: "Trie" },
            {
                field_name: "embedding", index_type: "HNSW", metric_type: "COSINE", params: {
                    M: 20,
                    efConstruction: 40,
                }
            },
        ]
    } else if (collection_name === "ai_notes_files") {
        fields = [
            { name: "id", data_type: DataType.Int64, is_primary_key: true },
            { name: "embedding", data_type: DataType.FloatVector, dim: 384 },
            { name: "file_hash", data_type: DataType.VarChar, max_length: 32 },
            { name: "file_path", data_type: DataType.VarChar, max_length: 1000 },
            { name: "modified_time", data_type: DataType.Int64 },
        ]

        index_params = [
            { field_name: "id", index_type: "STL_SORT" },
            { field_name: "modified_time", index_type: "STL_SORT" },
            { field_name: "file_path", index_type: "Trie" },
            {
                field_name: "embedding", index_type: "HNSW", metric_type: "COSINE", params: {
                    M: 20,
                    efConstruction: 40,
                }
            },
        ]
    } else {
        throw new Error("Invalid collection name");
    }

    let res = await client.createCollection({
        collection_name: collection_name,
        fields: fields,
        index_params: index_params,
    });
}

export async function setupDatabase(client: MilvusClient, settings: AiNotesSettings) {
    await loadCollection(client, settings, "ai_notes");
    await loadCollection(client, settings, "ai_notes_files");
}

export async function loadCollection(client: MilvusClient, settings: AiNotesSettings, collection_name: string = "ai_notes") {
    let res = await client.hasCollection({ collection_name: collection_name });
    if (!res.value) {
        await initializeCollection(client, collection_name);
    }
    let load_res = await client.loadCollection({ collection_name: collection_name });

    if (settings.debug) console.log("Collection loaded:", load_res);
}

export async function resetCollection(client: MilvusClient, collection_name: string = "ai_notes") {
    let res = await client.hasCollection({ collection_name: collection_name });
    if (res.value) {
        await client.dropCollection({ collection_name: collection_name });
        await initializeCollection(client, collection_name);
    }
}

export async function findNewOrUpdatedFiles(client: MilvusClient, settings: AiNotesSettings, files: TFile[]): Promise<TFile[]> {
    const count_res = await client.query({
        collection_name: "ai_notes_files",
        output_fields: ["count(*)"],
    });
    if (settings.debug) console.log("Count response:\n", count_res);

    // TODO: handle more than 16000 files
    let limit = 16384;
    if (count_res.data[0]['count(*)'] > limit) {
        // TODO: handle more than 16384 files
    }
    const query_res = await client.query({
        collection_name: "ai_notes_files",
        filter: "",
        limit: limit,
        output_fields: ["file_path", "modified_time", "id"],
    });
    if (settings.debug) console.log("Find all files query response:\n", query_res);

    if (query_res.data.length > 0) {
        const file_data = query_res.data;
        const file_paths = file_data.map((file) => file.file_path);
        const new_files = files.filter((file) => {
            return !file_paths.includes(file.path);
        });

        const modified_times = file_data.map((file) => file.modified_time);
        const updated_files = files.filter((file) => {
            const idx = file_paths.indexOf(file.path);
            return idx >= 0 && modified_times[idx] < file.stat.mtime;
        });
        const updated_db_files = file_data.filter((file) => {
            const idx = files.findIndex((f) => f.path === file.file_path);
            return idx >= 0 && files[idx].stat.mtime > file.modified_time;
        });

        const updated_file_ids = updated_db_files.map((file) => file.id);

        if (updated_db_files.length > 0) {
            // delete files from db that have been updated
            const delete_res = await client.delete({
                collection_name: "ai_notes_files",
                ids: updated_file_ids,
            });
            if (settings.debug) console.log("Delete updated files response:\n", delete_res);

            // turn a list of file paths into a comma separated string
            let file_paths_str: string = updated_db_files.map((file) => file.file_path).join("', '");
            file_paths_str = `['${file_paths_str}']`;

            // hopefully more efficient than deleting one by one
            const delete_chunks_res = await client.delete({
                collection_name: "ai_notes",
                filter: `file_path in ${file_paths_str}`,
            });
            if (settings.debug) console.log("Delete chunks response:\n", delete_chunks_res);
        }

        // combined updated and new files
        return [...new_files, ...updated_files];
    }
    return files;
}


export async function insert(client: MilvusClient, settings: AiNotesSettings, data: RowData | RowData[], collection_name: string = "ai_notes") {

    let res = await client.insert({
        collection_name: collection_name,
        data: Array.isArray(data) ? data : [data],
    });

    if (settings.debug) console.log(`Insert response for collection ${collection_name}:\n`, res);

    return res;
}