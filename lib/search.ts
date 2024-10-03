import type { TFile } from "obsidian";

export function sequenceMatchingSearch(query: string, items: TFile[]): TFile[] {
    query = query.toLocaleLowerCase();

    return items
        .filter((item) => {
            const itemLower = item.basename.toLocaleLowerCase();
            let itemIndex = itemLower.indexOf(query[0]);

            if (itemIndex === -1) {
                return false;
            }

            // let itemIndex = 0;
            let queryIndex = 0;
            while (
                queryIndex < query.length &&
                itemIndex < itemLower.length
            ) {
                if (query[queryIndex] === itemLower[itemIndex]) {
                    queryIndex++;
                }
                itemIndex++;
            }
            return queryIndex === query.length;
        })
        // first, sort by most recently modified
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .map((item) => ({
            item,
            score: findBestSubsequence(query, item.basename).score,
        }))
        // then sort by subsequence alignment
        .sort((a, b) => b.score - a.score)
        .map((item) => item.item);
}

function findBestSubsequence(query: string, item: string) {
    let bestScore = 0;
    let bestSequence: number[] = [];

    for (let start = 0; start < item.length; start++) {
        let queryIndex = 0;
        let sequence = [];
        let totalDistance = 0;

        for (let i = start; i < item.length; i++) {
            if (item[i] === query[queryIndex]) {
                if (sequence.length > 0) {
                    totalDistance += i - sequence[sequence.length - 1] - 1;
                }
                sequence.push(i);
                queryIndex++;

                if (queryIndex === query.length) {
                    break;
                }
            }
        }

        if (sequence.length === query.length) {
            const averageDistance =
                totalDistance / (sequence.length - 1) || 0;
            const score = 1 / (1 + averageDistance);
            if (score > bestScore) {
                bestScore = score;
                bestSequence = sequence;
            }
        }
    }

    return { score: bestScore, sequence: bestSequence };
}