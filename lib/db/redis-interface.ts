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
const REDIS_URI = 'redis://:obsidian@localhost:6379';

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
            '$.id': {
                type: SchemaFieldTypes.NUMERIC,
                AS: 'id'
            },
            '$.embedding': {
                type: SchemaFieldTypes.VECTOR,
                TYPE: 'FLOAT32',
                ALGORITHM: VectorAlgorithms.FLAT, // flat for dsets < 1M items (likely true for obsidian notes)
                DIM: embeddingDim,
                DISTANCE_METRIC: 'COSINE',
                AS: 'embedding'
            },
            '$.timestamp': {
                type: SchemaFieldTypes.NUMERIC,
                SORTABLE: true,
                AS: 'timestamp'
            },
            '$.file_path': {
                type: SchemaFieldTypes.TEXT,
                SORTABLE: true,
                AS: 'file_path'
            },
            '$.file_hash': {
                type: SchemaFieldTypes.TAG,
                AS: 'file_hash'
            },
            '$.chunk_length': {
                type: SchemaFieldTypes.NUMERIC,
                SORTABLE: true,
                AS: 'chunk_length'
            },
            '$.chunk_hash': {
                type: SchemaFieldTypes.TAG,
                AS: 'chunk_hash'
            },
            '$.contents': {
                type: SchemaFieldTypes.TEXT,
                AS: 'contents'
            },
            '$.context': {
                type: SchemaFieldTypes.TEXT,
                AS: 'context'
            },
            '$.embed_model': {
                type: SchemaFieldTypes.TAG,
                AS: 'embed_model'
            },
            '$.modified_time': {
                type: SchemaFieldTypes.NUMERIC,
                SORTABLE: true,
                AS: 'modified_time'
            },
        };

        const aiNotesFilesSchema: RediSearchSchema = {
            '$.id': {
                type: SchemaFieldTypes.NUMERIC,
                AS: 'id'
            },
            '$.embedding': {
                type: SchemaFieldTypes.VECTOR,
                TYPE: 'FLOAT32',
                ALGORITHM: VectorAlgorithms.FLAT,
                DIM: embeddingDim,
                DISTANCE_METRIC: 'COSINE',
                AS: 'embedding'
            },
            '$.file_hash': {
                type: SchemaFieldTypes.TAG,
                AS: 'file_hash'
            },
            '$.file_path': {
                type: SchemaFieldTypes.TEXT,
                SORTABLE: true,
                AS: 'file_path'
            },
            '$.file_length': {
                type: SchemaFieldTypes.NUMERIC,
                AS: 'file_length'
            },
            '$.modified_time': {
                type: SchemaFieldTypes.NUMERIC,
                SORTABLE: true,
                AS: 'modified_time'
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
            ON: 'JSON',
            PREFIX: AI_NOTES_KEY_PREFIX,
        });
        if (settings.debug) console.log(`Index ${AI_NOTES_INDEX_KEY} created`);

        await nodeRedisClient.ft.create(AI_NOTES_FILES_INDEX_KEY, aiNotesFilesSchema, {
            ON: 'JSON',
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
        pipeline.json.set(key, '$', entry as any);
    }

    try {
        const result = await pipeline.exec();
        if (settings.debug) console.log(`Bulk insert ${entries.length} entries for ${collection_name} successful`);
        if (settings.debug) console.log("Result:\n", result);
    } catch (err) {
        console.error(`Bulk insert error for ${collection_name}:`, err);
    }
}

interface SlimDbRecord {
    id: string;
    modified_time: number;
    file_path: string;
}

export async function findNewOrUpdatedFiles(files: TFile[], settings: AiNotesSettings): Promise<TFile[]> {
    const client = await getNodeRedisClient();

    const existing_files = await client.keys(`${AI_NOTES_FILES_KEY_PREFIX}*`);
    if (settings.debug) console.log('Total files in db:', existing_files.length);
    if (settings.debug) console.log('Existing files:', existing_files);

    if (existing_files.length > 0) {
        const response = await client.json.mGet(existing_files, '$["file_path", "modified_time"]') as [string, number][];
        // combine keys with response
        const db_map: SlimDbRecord[] = existing_files.map((key, idx) => {
            return {
                id: key,
                file_path: response[idx][0],
                modified_time: response[idx][1],
            } as SlimDbRecord;
        });

        if (settings.debug) console.log('Retrieved files from db:', response);
        const file_paths = response.map(([file_path, _]) => file_path);

        const new_files: TFile[] = files.filter((file) => !file_paths.includes(file.path));
        if (settings.debug) console.log('New files:', new_files);

        let updated_files: TFile[] = [];
        let updated_db_files: SlimDbRecord[] = [];
        for (const file of db_map) {
            const matched_file = files.find(f => f.path === file.file_path);
            const flag = matched_file && matched_file.stat.mtime > file.modified_time;
            if (flag) {
                updated_files.push(matched_file);
                updated_db_files.push(file);
            }
        }
        if (settings.debug) console.log('Updated files:', updated_db_files);

        if (updated_files.length > 0) {
            // delete file entries
            const updated_keys = updated_db_files.map(file => file.id);
            const response = await client.del(updated_keys);
            if (settings.debug) console.log('Delete response', response);

            // delete chunk entries
            const updated_file_paths = updated_db_files.map(file => file.file_path);
            const query = `@file_path:(${updated_file_paths.map(path => `"${path}"`).join(' | ')})`;
            if (settings.debug) console.log('Query:', query);

            const chunks_to_delete = await client.ft.search(
                AI_NOTES_INDEX_KEY,
                query,
                {
                    RETURN: ['$.id'],
                    DIALECT: 2,
                    LIMIT: { from: 0, size: 10000 },
                }
            );
            if (settings.debug) console.log('Chunks to delete:', chunks_to_delete);

            if (chunks_to_delete.total > 0) {
                const chunk_keys = chunks_to_delete.documents.map(doc => doc.id);
                const response = await client.del(chunk_keys);
                if (settings.debug) console.log('Deleted updated chunks from db:', response);
            }
            // for updated files, make sure there aren't duplicate entries, by looking at the file path
            updated_files = updated_files.filter((file, idx) => updated_files.findIndex(f => f.path === file.path) === idx);
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