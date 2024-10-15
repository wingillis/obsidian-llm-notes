import {
    createClient,
    SchemaFieldTypes,
    VectorAlgorithms,
    type RediSearchSchema,
    type RedisClientType,
} from 'redis';
import type { AiNotesSettings } from "views/settings";
import { getEmbeddingDim } from "lib/llm/process";
import type { TFile } from 'obsidian';

const AI_NOTES_KEY_PREFIX: string = 'ai_notes:';
export const AI_NOTES_INDEX_KEY: string = 'idx:ai_notes';
export const AI_NOTES_FILES_KEY_PREFIX: string = 'ai_notes_files:';
export const AI_NOTES_FILES_INDEX_KEY: string = 'idx:ai_notes_files';
const REDIS_URI = 'redis://:wingillis@localhost:6379';

export interface AiNoteEntry {
    id: number;
    embedding: number[];
    timestamp: number;
    file_path: string;
    file_hash: string;
    chunk_length: number;
    chunk_hash: string;
    contents: string;
    context: string;
    embed_model: string;
    modified_time: number;
}

export interface AiFileEntry {
    id: number;
    embedding: number[];
    file_hash: string;
    file_path: string;
    file_length: number;
    modified_time: number;
}

let nodeRedisClient: RedisClientType | null = null;

export const getNodeRedisClient = async () => {
    if (!nodeRedisClient) {
        nodeRedisClient = createClient({ url: REDIS_URI });
        await nodeRedisClient.connect();
    }
    return nodeRedisClient;
};

async function indexExists(indexKey: string, settings: AiNotesSettings): Promise<boolean> {
    const client = await getNodeRedisClient();
    let exists = false;
    try {
        const info = await client.ft.info(indexKey);
        exists = true;
        if (settings.debug) console.log(`Index ${indexKey} exists`, info);
    } catch (error) {
        if (settings.debug) console.log(`Index ${indexKey} does not exist`);
    }
    return exists;
}

export async function initializeRedis(settings: AiNotesSettings, force: boolean = false) {
    const nodeRedisClient = await getNodeRedisClient();

    const aiNotesIndexExists = await indexExists(AI_NOTES_INDEX_KEY, settings);
    const aiNotesFilesIndexExists = await indexExists(AI_NOTES_FILES_INDEX_KEY, settings);

    if ((!aiNotesIndexExists || !aiNotesFilesIndexExists) || force) {
        if (settings.debug) console.log('Creating new indices');

        const embeddingDim = await getEmbeddingDim(settings);

        const aiNotesSchema: RediSearchSchema = {
            id: {
                type: SchemaFieldTypes.NUMERIC,
            },
            embedding: {
                type: SchemaFieldTypes.VECTOR,
                TYPE: 'FLOAT32',
                ALGORITHM: VectorAlgorithms.FLAT, // flat for dsets < 1M items (likely true for obsidian notes)
                DIM: embeddingDim,
                DISTANCE_METRIC: 'COSINE',
            },
            timestamp: {
                type: SchemaFieldTypes.NUMERIC,
                SORTABLE: true,
            },
            file_path: {
                type: SchemaFieldTypes.TEXT,
                SORTABLE: true,
            },
            file_hash: {
                type: SchemaFieldTypes.TAG,
            },
            chunk_length: {
                type: SchemaFieldTypes.NUMERIC,
            },
            chunk_hash: {
                type: SchemaFieldTypes.TAG,
            },
            contents: {
                type: SchemaFieldTypes.TEXT,
            },
            context: {
                type: SchemaFieldTypes.TEXT,
            },
            embed_model: {
                type: SchemaFieldTypes.TAG,
            },
            modified_time: {
                type: SchemaFieldTypes.NUMERIC,
                SORTABLE: true,
            },
        };

        const aiNotesFilesSchema: RediSearchSchema = {
            id: {
                type: SchemaFieldTypes.NUMERIC,
            },
            embedding: {
                type: SchemaFieldTypes.VECTOR,
                TYPE: 'FLOAT32',
                ALGORITHM: VectorAlgorithms.FLAT,
                DIM: embeddingDim,
                DISTANCE_METRIC: 'COSINE',
            },
            file_hash: {
                type: SchemaFieldTypes.TAG,
            },
            file_path: {
                type: SchemaFieldTypes.TEXT,
                SORTABLE: true,
            },
            file_length: {
                type: SchemaFieldTypes.NUMERIC,
            },
            modified_time: {
                type: SchemaFieldTypes.NUMERIC,
                SORTABLE: true,
            },
        };

        try {
            // Drop existing indices if they exist
            await nodeRedisClient.ft.dropIndex(AI_NOTES_INDEX_KEY);
            await nodeRedisClient.ft.dropIndex(AI_NOTES_FILES_INDEX_KEY);
            if (settings.debug) console.log('Dropped existing indices');
            // also delete all keys in database
            const result = await nodeRedisClient.del(await nodeRedisClient.keys('*'));
            if (settings.debug) console.log('Deleted all keys in database:', result);

        } catch (indexErr) {
            console.error('Error dropping indices:', indexErr);
        }

        // Create new indices
        await nodeRedisClient.ft.create(AI_NOTES_INDEX_KEY, aiNotesSchema, {
            // ON: 'JSON',
            ON: 'HASH',
            PREFIX: AI_NOTES_KEY_PREFIX,
        });
        if (settings.debug) console.log(`Index ${AI_NOTES_INDEX_KEY} created`);

        await nodeRedisClient.ft.create(AI_NOTES_FILES_INDEX_KEY, aiNotesFilesSchema, {
            // ON: 'JSON',
            ON: 'HASH',
            PREFIX: AI_NOTES_FILES_KEY_PREFIX,
        });
        if (settings.debug) console.log(`Index ${AI_NOTES_FILES_INDEX_KEY} created`);
    } else {
        if (settings.debug) console.log('Indices already exist. Connected to database.');
    }
}

export async function bulkInsert(entries: AiNoteEntry[] | AiFileEntry[], settings: AiNotesSettings, collection_name: string = "ai_notes") {
    const client = await getNodeRedisClient();

    const pipeline = client.multi();

    const prefix = collection_name === "ai_notes" ? AI_NOTES_KEY_PREFIX : AI_NOTES_FILES_KEY_PREFIX;

    for (const entry of entries) {
        const key = `${prefix}${entry.id}`;

        if (collection_name === "ai_notes") {
            const doc = entry as AiNoteEntry;
            pipeline.hSet(key, {
                id: entry.id,
                embedding: Buffer.from(new Float32Array(doc.embedding).buffer),
                timestamp: doc.timestamp,
                file_path: doc.file_path,
                file_hash: doc.file_hash,
                chunk_length: doc.chunk_length,
                chunk_hash: doc.chunk_hash,
                contents: doc.contents,
                context: doc.context,
                embed_model: doc.embed_model,
                modified_time: doc.modified_time,
            });
        } else {
            const doc = entry as AiFileEntry;
            pipeline.hSet(key, {
                id: entry.id,
                embedding: Buffer.from(new Float32Array(doc.embedding).buffer),
                file_hash: doc.file_hash,
                file_path: doc.file_path,
                file_length: doc.file_length,
                modified_time: doc.modified_time,
            });
        }
    }

    try {
        const result = await pipeline.exec();
        if (settings.debug) console.log(`Bulk insert ${entries.length} entries for ${collection_name} successful`);
        if (settings.debug) console.log("Result:\n", result);
    } catch (err) {
        console.error(`Bulk insert error for ${collection_name}:`, err);
    }
}

export async function findNewOrUpdatedFiles(files: TFile[], settings: AiNotesSettings): Promise<TFile[]> {
    const client = await getNodeRedisClient();

    const existing_files = await client.keys(`${AI_NOTES_FILES_KEY_PREFIX}*`);
    if (settings.debug) console.log('Total files in db:', existing_files.length);

    if (existing_files.length > 0) {
        const response = await client.mGet(existing_files);
        const file_data = response.filter(file => file !== null).map(file => JSON.parse(file as string));
        const file_paths = file_data.map((file) => file.file_path);

        const new_files: TFile[] = files.filter((file) => !file_paths.includes(file.path));

        let updated_files: TFile[] = [];
        let updated_db_files: AiFileEntry[] = [];
        for (const file of file_data) {
            const matched_file = files.find(f => f.path === file.file_path);
            const flag = matched_file && matched_file.stat.mtime > file.modified_time;
            if (flag) {
                updated_files.push(matched_file);
                updated_db_files.push(file);
            }
        }

        if (updated_files.length > 0) {
            // delete file entries
            const updated_keys = updated_db_files.map((file) => `${AI_NOTES_FILES_KEY_PREFIX}${file.id}`);
            await client.del(updated_keys);
            if (settings.debug) console.log('Deleted updated files from db:', updated_keys.length);

            // delete chunk entries
            const updated_file_paths = updated_db_files.map(file => file.file_path);
            const chunks_to_delete = await client.ft.search(
                'idx:ai_notes',
                `@file_path:(${updated_file_paths.join(' | ')})`,
                { LIMIT: { from: 0, size: 1000000 } }
            );

            if (chunks_to_delete.total > 0) {
                const chunk_keys = chunks_to_delete.documents.map(doc => doc.id);
                await client.del(chunk_keys);
                if (settings.debug) console.log('Deleted updated chunks from db:', chunk_keys.length);
            }
        }

        return [...new_files, ...updated_files];
    }

    return files;
}

export async function closeConnection() {
    if (nodeRedisClient) {
        await nodeRedisClient.quit();
        nodeRedisClient = null;
    }
}