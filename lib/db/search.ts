import type { AiNotesSettings } from "views/settings";
import { getNodeRedisClient, AI_NOTES_INDEX_KEY, AI_NOTES_FILES_INDEX_KEY } from "lib/db/redis-interface";
import type { AiFileEntry } from "lib/db/redis-interface";
import { embed } from "lib/llm/process";
import type { SearchReply } from "redis";

function float32Buffer(arr: number[]): Buffer {
    const floatArray = new Float32Array(arr);
    const float32Buffer = Buffer.from(floatArray.buffer);
    return float32Buffer;
}

export async function semanticSearchFromQuery(query: string, settings: AiNotesSettings): Promise<KnnSearchResult[]> {
    const embedding = await embed(query, settings);
    return await knnSearch(embedding, settings.similar_notes_search_limit, settings.similarity_threshold);
}

export interface KnnSearchResult {
    score: number,
    file_path: string,
    contents: string,
    id: number,
    timestamp: number
}

export async function knnSearch(embedding: number[], k_neighbors: number, score_threshold: number): Promise<KnnSearchResult[]> {
    const client = await getNodeRedisClient();

    const searchQuery: string = `*=>[KNN ${k_neighbors} @embedding $searchBlob AS score]`;

    const results: SearchReply = await client.ft.search(AI_NOTES_INDEX_KEY, searchQuery, {
        PARAMS: {
            searchBlob: Buffer.from(new Float32Array(embedding).buffer),
        },
        RETURN: ['score', 'file_path', 'contents', 'id', 'timestamp'],
        SORTBY: {
            BY: 'score',
        },
        DIALECT: 2,
    });

    // process search results into an array of KnnSearchResult objects
    const processed_results: KnnSearchResult[] = results.documents.filter((result: any) => {
        return result.value.score >= score_threshold;
    }).map((result: any) => {
        return {
            score: result.value.score,
            file_path: result.value.file_path,
            contents: result.value.contents,
            id: result.value.id,
            timestamp: result.value.timestamp,
        };
    });

    return processed_results;
}

export async function getFileEntryByPath(file_path: string, settings: AiNotesSettings): Promise<AiFileEntry | null> {
    const client = await getNodeRedisClient();

    try {
        // Escape special characters in the file path
        // const escapedFilePath = file_path.replace(/[^a-zA-Z0-9]/g, '\\$&');

        // Perform a search using the file path
        const search_result = await client.ft.search(
            AI_NOTES_FILES_INDEX_KEY,
            // `@file_path:"${escapedFilePath}"`,
            `@file_path:"${file_path}"`,
            {
                LIMIT: {
                    from: 0,
                    size: 1
                }
            }
        );

        if (search_result.total > 0) {
            const entry = JSON.parse(search_result.documents[0].value as unknown as string);
            if (settings.debug) console.log('Found file entry:', entry);
            return entry as AiFileEntry;
        } else {
            if (settings.debug) console.log('No file entry found for path:', file_path);
            return null;
        }
    } catch (error) {
        console.error('Error retrieving file entry:', error);
        return null;
    }
}
