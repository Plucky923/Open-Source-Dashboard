const DATA_FRESHNESS_THRESHOLD_MS = 12 * 60 * 60 * 1000;

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

module.exports = {
    DATA_FRESHNESS_THRESHOLD_MS,
    buildDataFreshness,
    normalizeTimestamp,
};
