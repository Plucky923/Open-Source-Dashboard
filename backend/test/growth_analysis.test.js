const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildComparisonPeriods,
    calculateGrowthMetrics,
    formatGrowthMetrics,
    getRangeDays,
    hasCompletePeriodDates,
} = require('../growth_analysis');

function buildDateRange(start, end) {
    const dates = [];
    const current = new Date(`${start}T00:00:00.000Z`);
    const last = new Date(`${end}T00:00:00.000Z`);

    while (current <= last) {
        dates.push(current.toISOString().slice(0, 10));
        current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
}

test('builds adjacent, equal seven-day comparison windows from the latest snapshot', () => {
    assert.deepEqual(
        buildComparisonPeriods('7d', '2024-09-05', '2026-09-08'),
        {
            comparison_available: true,
            reason: null,
            current: { start: '2026-09-02', end: '2026-09-08' },
            previous: { start: '2026-08-26', end: '2026-09-01' },
        },
    );
});

test('builds adjacent, equal thirty-day comparison windows across month boundaries', () => {
    const periods = buildComparisonPeriods('30d', '2024-09-05', '2026-09-08');

    assert.deepEqual(periods.current, { start: '2026-08-10', end: '2026-09-08' });
    assert.deepEqual(periods.previous, { start: '2026-07-11', end: '2026-08-09' });
});

test('uses the complete data bounds and disables comparison for all time', () => {
    assert.deepEqual(
        buildComparisonPeriods('all', '2024-09-05', '2026-09-08'),
        {
            comparison_available: false,
            reason: 'unbounded_range',
            current: { start: '2024-09-05', end: '2026-09-08' },
            previous: null,
        },
    );
});

test('returns a no-data window when no snapshots exist', () => {
    const periods = buildComparisonPeriods('30d', null, null);

    assert.deepEqual(
        periods,
        {
            comparison_available: false,
            reason: 'no_data',
            current: { start: null, end: null },
            previous: null,
        },
    );
    assert.equal(hasCompletePeriodDates(periods.current), false);
});

test('recognizes periods with both export dates', () => {
    assert.equal(
        hasCompletePeriodDates({ start: '2026-08-10', end: '2026-09-08' }),
        true,
    );
});

test('disables comparison when the previous window is not fully retained', () => {
    assert.deepEqual(
        buildComparisonPeriods('30d', '2026-08-10', '2026-09-08'),
        {
            comparison_available: false,
            reason: 'insufficient_history',
            current: { start: '2026-08-10', end: '2026-09-08' },
            previous: null,
        },
    );
});

test('shows only the actually retained portion of an incomplete current window', () => {
    assert.deepEqual(
        buildComparisonPeriods('30d', '2026-08-20', '2026-09-08').current,
        { start: '2026-08-20', end: '2026-09-08' },
    );
});

test('allows comparison when history begins on the previous window boundary', () => {
    const snapshotDates = buildDateRange('2026-07-11', '2026-09-08');

    assert.equal(
        buildComparisonPeriods('30d', '2026-07-11', '2026-09-08', snapshotDates).comparison_available,
        true,
    );
});

test('omits current metrics when the current window contains an internal gap', () => {
    const snapshotDates = buildDateRange('2026-07-11', '2026-09-08')
        .filter(date => date !== '2026-08-15');

    assert.deepEqual(
        buildComparisonPeriods('30d', '2026-07-11', '2026-09-08', snapshotDates),
        {
            comparison_available: false,
            reason: 'incomplete_current_period',
            current: { start: null, end: null },
            previous: null,
        },
    );
});

test('keeps a complete current window when only the previous window has a gap', () => {
    const snapshotDates = buildDateRange('2026-07-11', '2026-09-08')
        .filter(date => date !== '2026-08-01');

    assert.deepEqual(
        buildComparisonPeriods('30d', '2026-07-11', '2026-09-08', snapshotDates),
        {
            comparison_available: false,
            reason: 'insufficient_history',
            current: { start: '2026-08-10', end: '2026-09-08' },
            previous: null,
        },
    );
});

test('returns no data when an anchored SIG has no snapshots', () => {
    assert.equal(
        buildComparisonPeriods('30d', null, '2026-09-08', []).reason,
        'no_data',
    );
});

test('supports leap-day date arithmetic and defaults unknown ranges to thirty days', () => {
    assert.equal(getRangeDays('unknown'), 30);
    assert.deepEqual(
        buildComparisonPeriods('7d', '2024-01-01', '2024-03-01').current,
        { start: '2024-02-24', end: '2024-03-01' },
    );
});

test('normalizes database metrics and calculates growth', () => {
    const current = formatGrowthMetrics({ new_prs: '20', new_issues: '5', new_commits: '0' });
    const previous = formatGrowthMetrics({ new_prs: '10', new_issues: '0', new_commits: '0' });

    assert.deepEqual(calculateGrowthMetrics(current, previous), {
        prs: 100,
        issues: 100,
        commits: 0,
        lines_added: 0,
        lines_deleted: 0,
    });
});
