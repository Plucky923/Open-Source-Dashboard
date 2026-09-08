const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildGitEnv,
    buildRepoUrl,
    redactSecrets,
} = require('../git_secure');

function withGitHubToken(token, callback) {
    const originalToken = process.env.GITHUB_TOKEN;

    try {
        if (token === undefined) {
            delete process.env.GITHUB_TOKEN;
        } else {
            process.env.GITHUB_TOKEN = token;
        }

        return callback();
    } finally {
        if (originalToken === undefined) {
            delete process.env.GITHUB_TOKEN;
        } else {
            process.env.GITHUB_TOKEN = originalToken;
        }
    }
}

test('redacts configured tokens and GitHub HTTPS credentials from error text', () => {
    const token = 'github_token.with+regex*characters';
    const username = 'test-user';
    const password = 'test-password';
    const errorText = [
        `request failed with token ${token}`,
        `fatal: unable to access https://${username}:${password}@github.com/example/repo.git`,
    ].join('\n');

    const sanitized = withGitHubToken(token, () => redactSecrets(errorText));

    assert.doesNotMatch(sanitized, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(sanitized, /test-user|test-password/);
    assert.match(sanitized, /\[REDACTED_GITHUB_TOKEN\]/);
    assert.match(sanitized, /https:\/\/\[REDACTED\]@github\.com/);
});

test('redacts Basic Authorization credentials regardless of header casing', () => {
    const credentials = [
        'dGVzdC11c2VyOnRlc3QtcGFzc3dvcmQ=',
        'YW5vdGhlci11c2VyOmFub3RoZXItcGFzc3dvcmQ=',
        'dGhpcmQtdXNlcjp0aGlyZC1wYXNzd29yZA==',
    ];
    const errorText = [
        `Authorization: Basic ${credentials[0]}`,
        `authorization: basic ${credentials[1]}`,
        `AUTHORIZATION: BASIC ${credentials[2]}`,
    ].join('\n');

    const sanitized = withGitHubToken(undefined, () => redactSecrets(errorText));

    for (const credential of credentials) {
        assert.doesNotMatch(sanitized, new RegExp(credential));
    }
    assert.equal((sanitized.match(/\[REDACTED\]/g) || []).length, credentials.length);
});

test('buildGitEnv requires GITHUB_TOKEN', () => {
    withGitHubToken(undefined, () => {
        assert.throws(
            () => buildGitEnv(),
            /GITHUB_TOKEN is not set in environment variables\./
        );
    });
});

test('buildGitEnv creates an isolated non-interactive Basic auth environment', () => {
    const token = 'test-token';

    const env = withGitHubToken(token, () => buildGitEnv());

    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(env.GIT_CONFIG_COUNT, '2');
    assert.equal(env.GIT_CONFIG_KEY_0, 'credential.helper');
    assert.equal(env.GIT_CONFIG_VALUE_0, '');
    assert.equal(env.GIT_CONFIG_KEY_1, 'http.https://github.com/.extraheader');
    assert.equal(
        env.GIT_CONFIG_VALUE_1,
        `Authorization: Basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')}`
    );
});

test('buildRepoUrl creates the expected GitHub HTTPS URL', () => {
    assert.equal(
        buildRepoUrl('example-org', 'example-repo'),
        'https://github.com/example-org/example-repo.git'
    );
});
