const axios = require('axios');
const {
    DEFAULT_ORG_NAME,
    SIG_DEFINITIONS,
    getNextPageUrl,
    reaggregateAffectedHistoricalSnapshots,
    reaggregateContributorDailyActivities,
} = require('./repository_sig_sync');

/**
 * Upstream (related) organization tracking.
 *
 * GitHub Custom Properties only exist inside the dashboard's own organization
 * (hust-open-atom-club), so repositories of related upstream organizations
 * (e.g. rustsbi) declare their SIG membership with a GitHub topic instead:
 * a repository carrying the topic `osd-sig-<sig-slug>` (e.g. osd-sig-r2)
 * is tracked under that SIG. Repositories without such a topic are not
 * tracked; if a tracked repository drops its topic, it keeps its history
 * but stops being counted. Commit statistics always come from the default
 * branch, exactly like every other tracked repository.
 */

// GitHub topics cannot contain underscores, so the osd_sig Custom Property
// name maps to the `osd-sig-` topic prefix upstream.
const UPSTREAM_SIG_TOPIC_PREFIX = 'osd-sig-';

function githubHeaders(githubToken) {
    if (!githubToken) {
        throw new Error('GITHUB_TOKEN is not set in environment variables.');
    }

    return {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
}

/**
 * Extract the SIG slug a repository declares through its osd-sig-* topic.
 * Returns null when the repository declares nothing.
 */
function resolveSigSlugFromTopics(repositoryName, topics) {
    if (topics === undefined || topics === null) {
        throw new Error(`GitHub returned upstream repository ${repositoryName} without a topics list.`);
    }
    if (!Array.isArray(topics)) {
        throw new Error(`GitHub returned an invalid topics list for upstream repository ${repositoryName}.`);
    }

    const supportedValues = new Set(Object.keys(SIG_DEFINITIONS));
    const declaredSlugs = [];
    for (const topic of topics) {
        if (typeof topic !== 'string') {
            throw new Error(`GitHub returned an invalid topic for upstream repository ${repositoryName}.`);
        }
        if (!topic.startsWith(UPSTREAM_SIG_TOPIC_PREFIX)) {
            continue;
        }
        declaredSlugs.push(topic.slice(UPSTREAM_SIG_TOPIC_PREFIX.length));
    }

    if (declaredSlugs.length === 0) {
        return null;
    }
    if (declaredSlugs.length > 1) {
        throw new Error(
            `Upstream repository ${repositoryName} declares multiple SIG topics: ${declaredSlugs.map((slug) => `${UPSTREAM_SIG_TOPIC_PREFIX}${slug}`).join(', ')}.`
        );
    }

    const slug = declaredSlugs[0];
    if (!supportedValues.has(slug)) {
        throw new Error(`Upstream repository ${repositoryName} declares unsupported SIG topic ${UPSTREAM_SIG_TOPIC_PREFIX}${slug}.`);
    }
    return slug;
}

/**
 * Normalize an upstream org repository listing: keep only repositories that
 * declare an osd-sig-* topic, together with the declared SIG slug.
 */
function normalizeUpstreamRepositories(rows) {
    const seenNames = new Set();
    const seenRepositoryIds = new Set();
    const assignments = [];

    for (const repository of rows) {
        const repositoryName = repository?.name;
        if (typeof repositoryName !== 'string' || repositoryName.trim() === '') {
            throw new Error('GitHub returned an upstream repository without a name.');
        }

        const normalizedName = repositoryName.toLowerCase();
        if (seenNames.has(normalizedName)) {
            throw new Error(`GitHub returned duplicate upstream repositories named ${repositoryName}.`);
        }
        seenNames.add(normalizedName);

        const rawRepositoryId = repository?.id;
        const repositoryIdIsValid =
            (typeof rawRepositoryId === 'number' && Number.isSafeInteger(rawRepositoryId) && rawRepositoryId > 0)
            || (typeof rawRepositoryId === 'string' && /^[1-9]\d*$/.test(rawRepositoryId));
        if (!repositoryIdIsValid) {
            throw new Error(`GitHub returned an invalid repository id for upstream repository ${repositoryName}.`);
        }
        const repositoryId = BigInt(rawRepositoryId).toString();
        if (seenRepositoryIds.has(repositoryId)) {
            throw new Error(`GitHub returned duplicate upstream repository id ${repositoryId}.`);
        }
        seenRepositoryIds.add(repositoryId);

        const sigSlug = resolveSigSlugFromTopics(repositoryName, repository.topics);
        if (sigSlug === null) {
            continue;
        }

        assignments.push({ repositoryId, repositoryName, sigSlug });
    }

    assignments.sort((left, right) => left.repositoryName.localeCompare(right.repositoryName));
    return assignments;
}

async function fetchUpstreamOrgRepositories({
    githubToken,
    ownerLogin,
    httpClient = axios,
}) {
    const headers = githubHeaders(githubToken);
    const encodedOwner = encodeURIComponent(ownerLogin);

    const rows = [];
    const visitedPages = new Set();
    let nextUrl = `https://api.github.com/orgs/${encodedOwner}/repos?per_page=100`;

    while (nextUrl) {
        if (visitedPages.has(nextUrl)) {
            throw new Error(`Upstream repository pagination repeated ${nextUrl}.`);
        }
        visitedPages.add(nextUrl);

        let response;
        try {
            response = await httpClient.get(nextUrl, { headers, timeout: 30000 });
        } catch (error) {
            throw new Error(`Failed to fetch repositories for upstream org ${ownerLogin}: ${error.message}`, { cause: error });
        }
        if (!Array.isArray(response.data)) {
            throw new Error(`Upstream org ${ownerLogin} repositories response must be an array.`);
        }

        rows.push(...response.data);
        nextUrl = getNextPageUrl(response.headers?.link);
    }

    return normalizeUpstreamRepositories(rows);
}

async function applyUpstreamOrgRepositories({
    pool,
    assignments,
    ownerLogin,
    orgName = DEFAULT_ORG_NAME,
}) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const orgResult = await client.query(
            `INSERT INTO organizations (name)
             VALUES ($1)
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [orgName]
        );
        const orgId = orgResult.rows[0].id;

        // SIG rows are maintained by seed.sql and the club-org sync; upsert the
        // ones referenced by this organization's assignments so the upstream
        // sync also works standalone.
        const sigIdsBySlug = new Map();
        for (const sigSlug of new Set(assignments.map((assignment) => assignment.sigSlug))) {
            const sigResult = await client.query(
                `INSERT INTO special_interest_groups (org_id, slug, name)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (org_id, slug) DO UPDATE SET name = EXCLUDED.name
                 RETURNING id`,
                [orgId, sigSlug, SIG_DEFINITIONS[sigSlug]]
            );
            sigIdsBySlug.set(sigSlug, sigResult.rows[0].id);
        }

        const existingResult = await client.query(
            `SELECT r.id, r.github_id, r.name, r.sig_id, sig.slug AS sig_slug
             FROM repositories r
             LEFT JOIN special_interest_groups sig ON sig.id = r.sig_id
             WHERE r.org_id = $1 AND r.owner_login = $2`,
            [orgId, ownerLogin]
        );

        const existingByGithubId = new Map();
        for (const repository of existingResult.rows) {
            if (repository.github_id !== null) {
                const githubId = String(repository.github_id);
                if (existingByGithubId.has(githubId)) {
                    throw new Error(`Database contains duplicate upstream repository ID ${githubId} for ${ownerLogin}.`);
                }
                existingByGithubId.set(githubId, repository);
            }
        }

        const affectedSigIds = new Set();
        const matchedRepositoryIds = new Set();
        const changes = [];
        let created = 0;
        let disabled = 0;
        let trackingChanged = false;

        for (const assignment of assignments) {
            const targetSigId = sigIdsBySlug.get(assignment.sigSlug);
            const existing = existingByGithubId.get(assignment.repositoryId);
            if (existing) {
                matchedRepositoryIds.add(existing.id);

                const mappingChanged = existing.sig_id !== targetSigId;
                const nameChanged = existing.name !== assignment.repositoryName;
                if (mappingChanged || nameChanged) {
                    await client.query(
                        `UPDATE repositories
                         SET name = $1, sig_id = $2, github_id = $3
                         WHERE id = $4`,
                        [assignment.repositoryName, targetSigId, assignment.repositoryId, existing.id]
                    );
                }
                if (mappingChanged) {
                    if ((existing.sig_id === null) !== (targetSigId === null)) {
                        trackingChanged = true;
                    }
                    if (existing.sig_id !== null) {
                        affectedSigIds.add(existing.sig_id);
                    }
                    affectedSigIds.add(targetSigId);
                    changes.push({ repository: assignment.repositoryName, from: existing.sig_slug, to: assignment.sigSlug });
                }
                continue;
            }

            await client.query(
                `INSERT INTO repositories (org_id, sig_id, github_id, name, owner_login, is_in_organization)
                 VALUES ($1, $2, $3, $4, $5, FALSE)`,
                [orgId, targetSigId, assignment.repositoryId, assignment.repositoryName, ownerLogin]
            );
            affectedSigIds.add(targetSigId);
            trackingChanged = true;
            created += 1;
            changes.push({ repository: assignment.repositoryName, from: null, to: assignment.sigSlug });
        }

        // Repositories that disappeared from the upstream org listing, or that
        // dropped their osd-sig topic, keep their history but stop being
        // tracked, mirroring the club-org policy.
        for (const repository of existingResult.rows) {
            if (matchedRepositoryIds.has(repository.id) || repository.sig_id === null) {
                continue;
            }

            affectedSigIds.add(repository.sig_id);
            trackingChanged = true;
            await client.query(
                'UPDATE repositories SET sig_id = NULL WHERE id = $1',
                [repository.id]
            );
            changes.push({ repository: repository.name, from: repository.sig_slug, to: null, isInOrganization: false });
            disabled += 1;
        }

        const reaggregation = await reaggregateAffectedHistoricalSnapshots(
            client,
            orgId,
            [...affectedSigIds]
        );
        reaggregation.contributorDailyActivities = trackingChanged
            ? await reaggregateContributorDailyActivities(client, orgId)
            : 0;

        await client.query('COMMIT');

        return {
            ownerLogin,
            repositories: assignments.length,
            tracked: assignments.length,
            created,
            disabled,
            changes,
            affectedSigIds: [...affectedSigIds],
            reaggregation,
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function loadUpstreamOrgTrackings(pool) {
    const result = await pool.query(
        `SELECT owner_login
         FROM upstream_org_trackings
         WHERE enabled
         ORDER BY owner_login`
    );
    return result.rows;
}

/**
 * Synchronize every enabled related organization configured in
 * upstream_org_trackings: repositories declaring an osd-sig-* topic are
 * tracked under that SIG. Called alongside the club-org osd_sig sync.
 */
async function syncUpstreamOrgRepositories({
    pool,
    githubToken,
    orgName = DEFAULT_ORG_NAME,
    httpClient = axios,
}) {
    const configurations = await loadUpstreamOrgTrackings(pool);

    const results = [];
    for (const configuration of configurations) {
        const assignments = await fetchUpstreamOrgRepositories({
            githubToken,
            ownerLogin: configuration.owner_login,
            httpClient,
        });

        results.push(await applyUpstreamOrgRepositories({
            pool,
            assignments,
            ownerLogin: configuration.owner_login,
            orgName,
        }));
    }

    return {
        configurations: results.length,
        repositories: results.reduce((total, result) => total + result.repositories, 0),
        created: results.reduce((total, result) => total + result.created, 0),
        disabled: results.reduce((total, result) => total + result.disabled, 0),
        changes: results.flatMap((result) => result.changes),
        perOwner: results,
    };
}

module.exports = {
    UPSTREAM_SIG_TOPIC_PREFIX,
    resolveSigSlugFromTopics,
    normalizeUpstreamRepositories,
    fetchUpstreamOrgRepositories,
    applyUpstreamOrgRepositories,
    syncUpstreamOrgRepositories,
};
