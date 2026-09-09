const assert = require('node:assert/strict');
const test = require('node:test');

const {
    UPSTREAM_SIG_TOPIC_PREFIX,
    resolveSigSlugFromTopics,
    normalizeUpstreamRepositories,
    fetchUpstreamOrgRepositories,
    applyUpstreamOrgRepositories,
} = require('../upstream_repository_sync');
const { SIG_DEFINITIONS } = require('../repository_sig_sync');

function repoRow(name, id, { topics = [] } = {}) {
    return { name, id, topics };
}

test('osd-sig topics resolve to supported SIG slugs', () => {
    assert.equal(resolveSigSlugFromTopics('rustsbi', ['riscv', 'osd-sig-r2']), 'r2');
    assert.equal(resolveSigSlugFromTopics('linux-kernel-dev', ['osd-sig-linux-kernel']), 'linux-kernel');
    // No declaration means the repository is not tracked.
    assert.equal(resolveSigSlugFromTopics('sbi-spec', ['riscv', 'rust']), null);
    assert.equal(resolveSigSlugFromTopics('empty', []), null);
});

test('osd-sig topic resolution fails closed on invalid declarations', () => {
    assert.throws(
        () => resolveSigSlugFromTopics('rustsbi', ['osd-sig-does-not-exist']),
        /declares unsupported SIG topic osd-sig-does-not-exist/
    );
    assert.throws(
        () => resolveSigSlugFromTopics('rustsbi', ['osd-sig-r2', 'osd-sig-hctt']),
        /declares multiple SIG topics/
    );
    assert.throws(
        () => resolveSigSlugFromTopics('rustsbi', undefined),
        /without a topics list/
    );
    assert.throws(
        () => resolveSigSlugFromTopics('rustsbi', 'r2'),
        /invalid topics list/
    );
});

test('upstream reader only keeps repositories declaring an osd-sig topic', () => {
    const assignments = normalizeUpstreamRepositories([
        repoRow('rustsbi', 501, { topics: ['riscv', 'osd-sig-r2'] }),
        repoRow('silent-repo', 502, { topics: ['rust'] }),
        repoRow('sbi-spec', 503, { topics: [] }),
        repoRow('slides', 504, { topics: ['osd-sig-hctt'] }),
    ]);

    assert.deepEqual(assignments, [
        { repositoryId: '501', repositoryName: 'rustsbi', sigSlug: 'r2' },
        { repositoryId: '504', repositoryName: 'slides', sigSlug: 'hctt' },
    ]);
});

test('upstream reader rejects duplicate names and ids', () => {
    assert.throws(
        () => normalizeUpstreamRepositories([repoRow('Example', 701), repoRow('example', 702)]),
        /duplicate upstream repositories named example/
    );
    assert.throws(
        () => normalizeUpstreamRepositories([repoRow('first', 703), repoRow('second', 703)]),
        /duplicate upstream repository id 703/
    );
});

test('upstream repository reader consumes every page and normalizes ids', async () => {
    const calls = [];
    const httpClient = {
        async get(url) {
            calls.push(url);
            if (url.endsWith('page=2')) {
                return { data: [repoRow('rustsbi', 501, { topics: ['osd-sig-r2'] })], headers: {} };
            }
            return {
                data: [repoRow('silent', 502)],
                headers: {
                    link: '<https://api.github.test/orgs/rustsbi/repos?per_page=100&page=2>; rel="next", <https://api.github.test/orgs/rustsbi/repos?per_page=100&page=2>; rel="last"',
                },
            };
        },
    };

    const assignments = await fetchUpstreamOrgRepositories({
        githubToken: 'test-token',
        ownerLogin: 'rustsbi',
        httpClient,
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(assignments, [
        { repositoryId: '501', repositoryName: 'rustsbi', sigSlug: 'r2' },
    ]);
});

test('upstream synchronization upserts declared repositories with owner, disables dropped declarations', async () => {
    const queries = [];
    const sigIds = new Map(Object.keys(SIG_DEFINITIONS).map((slug, index) => [slug, 100 + index]));
    const r2SigId = sigIds.get('r2');
    const client = {
        async query(sql, params = []) {
            queries.push({ sql, params });
            const compact = sql.replace(/\s+/g, ' ').trim();

            if (compact === 'BEGIN' || compact === 'COMMIT' || compact === 'ROLLBACK') {
                return { rows: [], rowCount: 0 };
            }
            if (compact.startsWith('INSERT INTO organizations')) {
                return { rows: [{ id: 1 }], rowCount: 1 };
            }
            if (compact.startsWith('INSERT INTO special_interest_groups')) {
                return { rows: [{ id: sigIds.get(params[1]) }], rowCount: 1 };
            }
            if (compact.startsWith('SELECT r.id, r.github_id')) {
                return {
                    rows: [
                        // Tracked before but the topic was removed upstream.
                        { id: 20, github_id: '900', name: 'rustsbi', sig_id: null, sig_slug: null },
                        // Still tracked, but no longer declares the topic.
                        { id: 21, github_id: '901', name: 'removed-topic', sig_id: r2SigId, sig_slug: 'r2' },
                        // Disappeared from the org listing entirely.
                        { id: 22, github_id: '902', name: 'deleted-upstream', sig_id: r2SigId, sig_slug: 'r2' },
                    ],
                    rowCount: 3,
                };
            }
            return { rows: [], rowCount: 1 };
        },
        release() {
            queries.push({ sql: 'RELEASE', params: [] });
        },
    };
    const pool = { async connect() { return client; } };

    const result = await applyUpstreamOrgRepositories({
        pool,
        ownerLogin: 'rustsbi',
        assignments: [
            // Previously untracked row (id 20) regains tracking via its topic.
            { repositoryId: '900', repositoryName: 'rustsbi', sigSlug: 'r2' },
            // Newly declared repository.
            { repositoryId: '903', repositoryName: 'sbi-spec', sigSlug: 'r2' },
        ],
    });

    assert.equal(result.repositories, 2);
    assert.equal(result.tracked, 2);
    assert.equal(result.created, 1);
    assert.equal(result.disabled, 2);

    // Newly created repositories carry the upstream owner login.
    const inserts = queries.filter((query) => query.sql.includes('INSERT INTO repositories'));
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].params, [1, r2SigId, '903', 'sbi-spec', 'rustsbi']);

    // The previously untracked row is re-enabled with its SIG restored.
    const updateExisting = queries.find((query) =>
        query.sql.includes('UPDATE repositories') && query.sql.includes('SET name = $1, sig_id = $2, github_id = $3')
    );
    assert.ok(updateExisting);
    assert.deepEqual(updateExisting.params, ['rustsbi', r2SigId, '900', 20]);

    // Repositories that dropped their osd-sig topic (21) or vanished from
    // the org listing (22) keep history but stop being tracked.
    const disables = queries.filter((query) =>
        query.sql === 'UPDATE repositories SET sig_id = NULL WHERE id = $1'
    );
    assert.deepEqual(disables.map((query) => query.params[0]), [21, 22]);

    assert.ok(queries.some((query) => query.sql === 'COMMIT'));
    assert.ok(!queries.some((query) => query.sql === 'ROLLBACK'));
    assert.equal(queries.at(-1).sql, 'RELEASE');
});

test('upstream synchronization supports distinct SIG declarations per repository', async () => {
    const queries = [];
    const sigIds = new Map(Object.keys(SIG_DEFINITIONS).map((slug, index) => [slug, 100 + index]));
    const client = {
        async query(sql, params = []) {
            queries.push({ sql, params });
            const compact = sql.replace(/\s+/g, ' ').trim();

            if (compact === 'BEGIN' || compact === 'COMMIT' || compact === 'ROLLBACK') {
                return { rows: [], rowCount: 0 };
            }
            if (compact.startsWith('INSERT INTO organizations')) {
                return { rows: [{ id: 1 }], rowCount: 1 };
            }
            if (compact.startsWith('INSERT INTO special_interest_groups')) {
                return { rows: [{ id: sigIds.get(params[1]) }], rowCount: 1 };
            }
            if (compact.startsWith('SELECT r.id, r.github_id')) {
                return { rows: [], rowCount: 0 };
            }
            return { rows: [], rowCount: 1 };
        },
        release() {
            queries.push({ sql: 'RELEASE', params: [] });
        },
    };
    const pool = { async connect() { return client; } };

    const result = await applyUpstreamOrgRepositories({
        pool,
        ownerLogin: 'rustsbi',
        assignments: [
            { repositoryId: '904', repositoryName: 'rustsbi', sigSlug: 'r2' },
            { repositoryId: '905', repositoryName: 'tutorial', sigSlug: 'hctt' },
        ],
    });

    assert.equal(result.tracked, 2);
    assert.equal(result.created, 2);

    const inserts = queries.filter((query) => query.sql.includes('INSERT INTO repositories'));
    assert.deepEqual(inserts.map((insert) => insert.params[3]), ['rustsbi', 'tutorial']);
    assert.deepEqual(inserts.map((insert) => insert.params[1]), [sigIds.get('r2'), sigIds.get('hctt')]);
    assert.deepEqual(inserts.map((insert) => insert.params[4]), ['rustsbi', 'rustsbi']);
});
