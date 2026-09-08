const RANGE_DAYS = new Map([
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
    ['180d', 180],
    ['365d', 365],
]);

function normalizeDateString(value) {
    if (!value) {
        return null;
    }

    const dateString = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(dateString) ? dateString : null;
}

function addDays(dateString, days) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function getRangeDays(range) {
    if (range === 'all') {
        return null;
    }

    return RANGE_DAYS.get(range) || RANGE_DAYS.get('30d');
}

function buildComparisonPeriods(range, firstSnapshotDate, latestSnapshotDate) {
    const firstDate = normalizeDateString(firstSnapshotDate);
    const latestDate = normalizeDateString(latestSnapshotDate);

    if (!latestDate) {
        return {
            comparison_available: false,
            reason: 'no_data',
            current: { start: null, end: null },
            previous: null,
        };
    }

    const days = getRangeDays(range);
    if (days === null) {
        return {
            comparison_available: false,
            reason: 'unbounded_range',
            current: { start: firstDate || latestDate, end: latestDate },
            previous: null,
        };
    }

    const currentStart = addDays(latestDate, -(days - 1));
    const previousEnd = addDays(currentStart, -1);
    const previousStart = addDays(previousEnd, -(days - 1));

    return {
        comparison_available: true,
        reason: null,
        current: { start: currentStart, end: latestDate },
        previous: { start: previousStart, end: previousEnd },
    };
}

function formatGrowthMetrics(data = {}) {
    return {
        new_prs: Number.parseInt(data.new_prs, 10) || 0,
        closed_merged_prs: Number.parseInt(data.closed_merged_prs, 10) || 0,
        new_issues: Number.parseInt(data.new_issues, 10) || 0,
        closed_issues: Number.parseInt(data.closed_issues, 10) || 0,
        new_commits: Number.parseInt(data.new_commits, 10) || 0,
        lines_added: Number.parseInt(data.lines_added, 10) || 0,
        lines_deleted: Number.parseInt(data.lines_deleted, 10) || 0,
    };
}

function calculateGrowth(current, previous) {
    if (previous === 0) {
        return current > 0 ? 100 : 0;
    }

    return Number((((current - previous) / previous) * 100).toFixed(2));
}

function calculateGrowthMetrics(current, previous) {
    return {
        prs: calculateGrowth(current.new_prs, previous.new_prs),
        issues: calculateGrowth(current.new_issues, previous.new_issues),
        commits: calculateGrowth(current.new_commits, previous.new_commits),
        lines_added: calculateGrowth(current.lines_added, previous.lines_added),
        lines_deleted: calculateGrowth(current.lines_deleted, previous.lines_deleted),
    };
}

module.exports = {
    buildComparisonPeriods,
    calculateGrowthMetrics,
    formatGrowthMetrics,
    getRangeDays,
};
