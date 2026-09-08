const DATA_FRESHNESS_THRESHOLD_MS = 12 * 60 * 60 * 1000;

const RECORD_SUCCESSFUL_INGESTION_SQL = `UPDATE organizations
SET last_ingestion_completed_at = NOW()
WHERE id = $1
RETURNING last_ingestion_completed_at`;

function normalizeTimestamp(value) {
    if (!value) {
        return null;
    }

    const timestamp = value instanceof Date ? value : new Date(value);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function buildDataFreshness(lastUpdatedAt, now = new Date()) {
    const normalizedTimestamp = normalizeTimestamp(lastUpdatedAt);
    if (!normalizedTimestamp) {
        return {
            last_updated_at: null,
            data_status: 'missing',
        };
    }

    const ageMs = now.getTime() - new Date(normalizedTimestamp).getTime();
    return {
        last_updated_at: normalizedTimestamp,
        data_status: ageMs > DATA_FRESHNESS_THRESHOLD_MS ? 'stale' : 'fresh',
    };
}

function withDataFreshness(summaryData, now = new Date()) {
    return {
        ...summaryData,
        ...buildDataFreshness(summaryData.last_updated_at, now),
    };
}

async function recordSuccessfulIngestion(queryable, orgId) {
    const result = await queryable.query(RECORD_SUCCESSFUL_INGESTION_SQL, [orgId]);
    return normalizeTimestamp(result.rows[0]?.last_ingestion_completed_at);
}

async function invalidateOrganizationSummaryCache(redisClient, organizationName) {
    const cacheKeys = [];
    for await (const key of redisClient.scanIterator({
        MATCH: `org:${organizationName}:summary:*`,
        COUNT: 100,
    })) {
        cacheKeys.push(key);
    }

    if (cacheKeys.length > 0) {
        await redisClient.del(cacheKeys);
    }

    return cacheKeys.length;
}

module.exports = {
    DATA_FRESHNESS_THRESHOLD_MS,
    RECORD_SUCCESSFUL_INGESTION_SQL,
    buildDataFreshness,
    invalidateOrganizationSummaryCache,
    normalizeTimestamp,
    recordSuccessfulIngestion,
    withDataFreshness,
};
