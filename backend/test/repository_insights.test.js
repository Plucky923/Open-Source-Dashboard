const test = require('node:test');
const assert = require('node:assert/strict');

const {
    REPOSITORY_INSIGHTS_SQL,
    mapRepositoryInsightRow,
} = require('../repository_insights');

test('repository insight query keeps inactive tracked repositories and counts unique contributors', () => {
    assert.match(REPOSITORY_INSIGHTS_SQL, /JOIN eligible_repositories er ON er\.id = rs\.repo_id/);
    assert.match(REPOSITORY_INSIGHTS_SQL, /LEFT JOIN snapshot_totals/);
    assert.match(REPOSITORY_INSIGHTS_SQL, /COUNT\(DISTINCT cra\.contributor_id\)/);
    assert.match(REPOSITORY_INSIGHTS_SQL, /r\.is_in_organization = TRUE/);
    assert.match(REPOSITORY_INSIGHTS_SQL, /r\.sig_id IS NOT NULL/);
});

test('maps database values to a repository insight response', () => {
    const result = mapRepositoryInsightRow({
        id: '7',
        name: 'demo repo',
        sig_id: '2',
        sig_name: '基础设施 SIG',
        new_prs: '3',
        closed_merged_prs: '2',
        new_issues: '4',
        closed_issues: '1',
        new_commits: '9',
        active_contributors: '5',
        lines_added: '120',
        lines_deleted: '30',
        last_active_date: new Date('2026-09-05T00:00:00.000Z'),
    }, 'example-org');

    assert.deepEqual(result, {
        id: 7,
        name: 'demo repo',
        url: 'https://github.com/example-org/demo%20repo',
        sig: { id: 2, name: '基础设施 SIG' },
        new_prs: 3,
        closed_merged_prs: 2,
        new_issues: 4,
        closed_issues: 1,
        new_commits: 9,
        active_contributors: 5,
        lines_added: 120,
        lines_deleted: 30,
        is_active: true,
        last_active_date: '2026-09-05',
    });
});

test('marks a repository without activity in the selected range as inactive', () => {
    const result = mapRepositoryInsightRow({
        id: 8,
        name: 'quiet',
        sig_id: 3,
        sig_name: '文档 SIG',
    }, 'example-org');

    assert.equal(result.is_active, false);
    assert.equal(result.last_active_date, null);
    assert.equal(result.active_contributors, 0);
});

test('does not classify code-line totals without a PR, issue, or commit as repository activity', () => {
    const result = mapRepositoryInsightRow({
        id: 9,
        name: 'line-only',
        sig_id: 3,
        sig_name: '文档 SIG',
        lines_added: 12,
    }, 'example-org');

    assert.equal(result.is_active, false);
});
