const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DATA_FRESHNESS_THRESHOLD_MS,
    buildDataFreshness,
    normalizeTimestamp,
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
