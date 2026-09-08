const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DATA_FRESHNESS_THRESHOLD_MS,
    RECORD_SUCCESSFUL_INGESTION_SQL,
    buildDataFreshness,
    normalizeTimestamp,
    recordSuccessfulIngestion,
} = require('../data_freshness');

test('normalizes a valid data update time to ISO 8601', () => {
    assert.equal(
        normalizeTimestamp('2026-09-08T03:30:00+08:00'),
        '2026-09-07T19:30:00.000Z',
    );
});

test('returns a missing state when no valid data update time exists', () => {
    assert.deepEqual(buildDataFreshness(null), {
        last_updated_at: null,
        data_status: 'missing',
    });
    assert.deepEqual(buildDataFreshness('not-a-date'), {
        last_updated_at: null,
        data_status: 'missing',
    });
});

test('marks data at the twelve-hour threshold as fresh', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    const updatedAt = new Date(now.getTime() - DATA_FRESHNESS_THRESHOLD_MS);

    assert.deepEqual(buildDataFreshness(updatedAt, now), {
        last_updated_at: updatedAt.toISOString(),
        data_status: 'fresh',
    });
});

test('marks data older than twelve hours as stale', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    const updatedAt = new Date(now.getTime() - DATA_FRESHNESS_THRESHOLD_MS - 1);

    assert.deepEqual(buildDataFreshness(updatedAt, now), {
        last_updated_at: updatedAt.toISOString(),
        data_status: 'stale',
    });
});

test('records freshness only through the successful ingestion marker', async () => {
    const calls = [];
    const queryable = {
        async query(sql, params) {
            calls.push({ sql, params });
            return { rows: [{ last_ingestion_completed_at: new Date('2026-09-08T06:00:00.000Z') }] };
        },
    };

    assert.equal(
        await recordSuccessfulIngestion(queryable, 42),
        '2026-09-08T06:00:00.000Z',
    );
    assert.deepEqual(calls, [{
        sql: RECORD_SUCCESSFUL_INGESTION_SQL,
        params: [42],
    }]);
});

test('propagates failures while recording successful ingestion', async () => {
    const expectedError = new Error('write failed');
    const queryable = {
        async query() {
            throw expectedError;
        },
    };

    await assert.rejects(recordSuccessfulIngestion(queryable, 42), expectedError);
});
