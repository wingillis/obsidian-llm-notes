import type { AiNotesSettings } from "views/settings";
import { getNodeRedisClient, AI_NOTES_INDEX_KEY, AI_NOTES_FILES_INDEX_KEY } from "lib/db/redis-interface";
import type { AiFileEntry } from "lib/db/redis-interface";
import { embed } from "lib/llm/process";
import type { SearchReply } from "redis";

export interface KnnSearchResult {
    score: number,
    file_path: string,
    contents: string,
    id: number,
    timestamp: number
}

export async function knnSearch(file_path: string, embedding: number[], k_neighbors: number, score_threshold: number): Promise<KnnSearchResult[]> {
    const client = await getNodeRedisClient();

    let searchQuery: string;
    if (file_path === "") {
        searchQuery = `(@chunk_length:[1 +inf])=>[KNN ${k_neighbors} @embedding $searchBlob AS score]`;
    } else {
        searchQuery = `(@file_path:(-"${file_path}") @chunk_length:[1 +inf])=>[KNN ${k_neighbors} @embedding $searchBlob AS score]`;
    }

    const results: SearchReply = await client.ft.search(AI_NOTES_INDEX_KEY, searchQuery, {
        PARAMS: {
            searchBlob: Buffer.from(new Float32Array(embedding).buffer),
        },
        RETURN: ['score', 'file_path', 'contents', 'id', 'timestamp'],
        SORTBY: {
            BY: 'score',
            DIRECTION: 'ASC',
        },
        DIALECT: 2,
        LIMIT: { from: 0, size: k_neighbors },
    });

    // process search results into an array of KnnSearchResult objects
    const processed_results: KnnSearchResult[] = results.documents.filter((result: any) => {
        return result.value.score <= score_threshold;
    }).map((result: any) => {
        return {
            score: 1 - result.value.score,  // convert cosine distance to similarity score
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
        // Perform a search using the file path
        const search_result = await client.ft.search(
            AI_NOTES_FILES_INDEX_KEY,
            `@file_path:"${file_path}"`,
            {
                DIALECT: 2,
            }
        );

        if (search_result.total > 0) {
            if (settings.debug) console.log('Found file entry:', search_result);
            return search_result.documents[0].value as unknown as AiFileEntry;
        } else {
            if (settings.debug) console.log('No file entry found for path:', file_path);
            return null;
        }
    } catch (error) {
        console.error('Error retrieving file entry:', error);
        return null;
    }
}
