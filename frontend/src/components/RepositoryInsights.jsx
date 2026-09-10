import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { getRepositoryInsights } from '../services/api';

const METRICS = [
    { key: 'pr_activity', label: 'PR', color: '#8b5cf6' },
    { key: 'issue_activity', label: 'Issue', color: '#f59e0b' },
    { key: 'new_commits', label: 'Commit', color: '#10b981' },
    { key: 'active_contributors', label: '活跃贡献者', color: '#ec4899' },
];

const TABLE_COLUMNS = [
    { key: 'name', label: '仓库' },
    { key: 'sig_name', label: '所属 SIG' },
    { key: 'pr_activity', label: 'PR（新建/关闭）' },
    { key: 'issue_activity', label: 'Issue（新建/关闭）' },
    { key: 'new_commits', label: 'Commit' },
    { key: 'active_contributors', label: '贡献者' },
    { key: 'last_active_date', label: '最近活跃' },
];

const formatNumber = (value) => Number(value || 0).toLocaleString();

const getRepositoryValue = (repository, key) => {
    if (key === 'sig_name') return repository.sig.name;
    if (key === 'pr_activity') return repository.new_prs + repository.closed_merged_prs;
    if (key === 'issue_activity') return repository.new_issues + repository.closed_issues;
    return repository[key];
};

const RepositoryInsights = ({ range, sigs, refreshToken = 0 }) => {
    const [repositories, setRepositories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedSigId, setSelectedSigId] = useState('all');
    const [metric, setMetric] = useState('new_commits');
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState({ key: 'new_commits', direction: 'desc' });

    useEffect(() => {
        let cancelled = false;

        const loadRepositories = async () => {
            setLoading(true);
            setError('');
            try {
                const data = await getRepositoryInsights(range);
                if (!cancelled) {
                    setRepositories(data.repositories || []);
                }
            } catch (requestError) {
                if (!cancelled) {
                    setError(requestError.response?.data?.error || '仓库数据加载失败');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        loadRepositories();
        return () => {
            cancelled = true;
        };
    }, [range, refreshToken]);

    const sigFilteredRepositories = useMemo(() => {
        if (selectedSigId === 'all') {
            return repositories;
        }
        return repositories.filter((repository) => String(repository.sig.id) === selectedSigId);
    }, [repositories, selectedSigId]);

    const activeRepositories = useMemo(
        () => sigFilteredRepositories.filter((repository) => repository.is_active),
        [sigFilteredRepositories],
    );

    const tableRepositories = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const filtered = normalizedQuery
            ? activeRepositories.filter((repository) =>
                repository.name.toLocaleLowerCase().includes(normalizedQuery)
                || repository.sig.name.toLocaleLowerCase().includes(normalizedQuery))
            : activeRepositories;

        return [...filtered].sort((left, right) => {
            const leftValue = getRepositoryValue(left, sort.key);
            const rightValue = getRepositoryValue(right, sort.key);

            const leftIsMissing = leftValue === null || leftValue === undefined;
            const rightIsMissing = rightValue === null || rightValue === undefined;
            if (leftIsMissing && rightIsMissing) return 0;
            if (leftIsMissing) return 1;
            if (rightIsMissing) return -1;

            const comparison = typeof leftValue === 'number'
                ? leftValue - rightValue
                : String(leftValue).localeCompare(String(rightValue), 'zh-CN');
            return sort.direction === 'asc' ? comparison : -comparison;
        });
    }, [activeRepositories, query, sort]);

    const metricDefinition = METRICS.find((item) => item.key === metric);
    const topRepositories = useMemo(
        () => [...activeRepositories]
            .sort((left, right) => getRepositoryValue(right, metric) - getRepositoryValue(left, metric))
            .slice(0, 10),
        [activeRepositories, metric],
    );
    const activeCount = activeRepositories.length;
    const inactiveCount = sigFilteredRepositories.length - activeCount;

    const barOption = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            backgroundColor: 'rgba(17, 24, 39, 0.95)',
            borderColor: '#374151',
            textStyle: { color: '#f3f4f6' },
        },
        grid: { left: 12, right: 28, top: 16, bottom: 8, containLabel: true },
        xAxis: {
            type: 'value',
            minInterval: 1,
            splitLine: { lineStyle: { color: '#374151', type: 'dashed' } },
            axisLabel: { color: '#9ca3af' },
        },
        yAxis: {
            type: 'category',
            inverse: true,
            data: topRepositories.map((repository) => repository.name),
            axisLabel: { color: '#d1d5db', width: 130, overflow: 'truncate' },
            axisLine: { lineStyle: { color: '#4b5563' } },
        },
        series: [{
            name: metricDefinition.label,
            type: 'bar',
            data: topRepositories.map((repository) => getRepositoryValue(repository, metric)),
            barMaxWidth: 22,
            label: { show: true, position: 'right', color: '#e5e7eb' },
            itemStyle: {
                borderRadius: [0, 5, 5, 0],
                color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                    { offset: 0, color: metricDefinition.color },
                    { offset: 1, color: '#60a5fa' },
                ]),
            },
        }],
    };

    const pieOption = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'item',
            formatter: '{b}: {c} 个 ({d}%)',
            backgroundColor: 'rgba(17, 24, 39, 0.95)',
            borderColor: '#374151',
            textStyle: { color: '#f3f4f6' },
        },
        legend: {
            bottom: 0,
            textStyle: { color: '#d1d5db' },
        },
        graphic: sigFilteredRepositories.length > 0 ? [{
            type: 'text',
            left: 'center',
            top: '42%',
            style: {
                text: `${activeCount}/${sigFilteredRepositories.length}`,
                fill: '#f9fafb',
                fontSize: 24,
                fontWeight: 700,
                textAlign: 'center',
            },
        }, {
            type: 'text',
            left: 'center',
            top: '51%',
            style: {
                text: '活跃仓库',
                fill: '#9ca3af',
                fontSize: 12,
                textAlign: 'center',
            },
        }] : [],
        series: [{
            type: 'pie',
            radius: ['52%', '72%'],
            center: ['50%', '45%'],
            avoidLabelOverlap: true,
            label: { color: '#d1d5db', formatter: '{b}\n{c} 个' },
            itemStyle: { borderColor: '#1f2937', borderWidth: 3 },
            data: [
                { value: activeCount, name: '有活动', itemStyle: { color: '#10b981' } },
                { value: inactiveCount, name: '无活动', itemStyle: { color: '#4b5563' } },
            ],
        }],
    };

    const changeSort = (key) => {
        setSort((current) => ({
            key,
            direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
        }));
    };

    if (loading) {
        return (
            <section className="mb-8" aria-busy="true">
                <div className="mb-6 h-8 w-40 animate-pulse rounded bg-gray-700" />
                <div className="grid gap-8 lg:grid-cols-3">
                    <div className="h-96 animate-pulse rounded-xl bg-gray-800 lg:col-span-2" />
                    <div className="h-96 animate-pulse rounded-xl bg-gray-800" />
                </div>
            </section>
        );
    }

    return (
        <section className="mb-8" aria-labelledby="repository-insights-title">
            <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                    <h2 id="repository-insights-title" className="text-2xl font-bold text-white">仓库洞察</h2>
                    <p className="mt-1 text-sm text-gray-400">从 SIG 下钻到具体项目，数据范围与页面顶部选择保持一致。</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                    <span>筛选 SIG</span>
                    <select
                        value={selectedSigId}
                        onChange={(event) => setSelectedSigId(event.target.value)}
                        className="rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-white outline-none focus:border-blue-500"
                    >
                        <option value="all">全部 SIG</option>
                        {sigs.map((sig) => <option key={sig.id} value={String(sig.id)}>{sig.name}</option>)}
                    </select>
                </label>
            </div>

            {error ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-200">{error}</div>
            ) : (
                <>
                    <div className="mb-8 grid gap-8 lg:grid-cols-3">
                        <div className="flex h-[28rem] flex-col rounded-xl border border-gray-700 bg-gray-800 p-6 shadow-xl lg:col-span-2">
                            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h3 className="font-semibold text-white">活跃仓库 Top 10</h3>
                                    <p className="mt-1 text-xs text-gray-400">按所选指标统计当前时间范围内的活跃仓库</p>
                                </div>
                                <div className="flex flex-wrap gap-2" aria-label="仓库排行指标">
                                    {METRICS.map((item) => (
                                        <button
                                            key={item.key}
                                            type="button"
                                            onClick={() => {
                                                setMetric(item.key);
                                                setSort({ key: item.key, direction: 'desc' });
                                            }}
                                            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${metric === item.key
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="min-h-0 flex-1">
                                {topRepositories.length > 0
                                    ? <ReactECharts option={barOption} style={{ height: '100%', width: '100%' }} />
                                    : <EmptyState />}
                            </div>
                        </div>

                        <div className="flex h-[28rem] flex-col rounded-xl border border-gray-700 bg-gray-800 p-6 shadow-xl">
                            <div>
                                <h3 className="font-semibold text-white">活跃仓库占比</h3>
                                <p className="mt-1 text-xs text-gray-400">有 PR、Issue 或 Commit 的仓库视为活跃</p>
                            </div>
                            <div className="min-h-0 flex-1">
                                {sigFilteredRepositories.length > 0
                                    ? <ReactECharts option={pieOption} style={{ height: '100%', width: '100%' }} />
                                    : <EmptyState />}
                            </div>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800 shadow-xl">
                        <div className="flex flex-col gap-3 border-b border-gray-700 p-5 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h3 className="font-semibold text-white">仓库明细</h3>
                                <p className="mt-1 text-xs text-gray-400">
                                    当前时间范围内共 {activeRepositories.length} 个活跃仓库
                                    {query.trim() && `，其中 ${tableRepositories.length} 个匹配搜索`}
                                    ，可点击表头排序
                                </p>
                            </div>
                            <label className="relative">
                                <span className="sr-only">搜索仓库或 SIG</span>
                                <input
                                    type="search"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="搜索仓库或 SIG"
                                    className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-500 focus:border-blue-500 sm:w-64"
                                />
                            </label>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-700 text-sm">
                                <thead className="bg-gray-900/50">
                                    <tr>
                                        {TABLE_COLUMNS.map((column) => (
                                            <th key={column.key} scope="col" className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-400">
                                                <button type="button" onClick={() => changeSort(column.key)} className="inline-flex items-center gap-1 hover:text-white">
                                                    {column.label}
                                                    {sort.key === column.key && <span aria-hidden="true">{sort.direction === 'desc' ? '↓' : '↑'}</span>}
                                                </button>
                                            </th>
                                        ))}
                                        <th scope="col" className="px-4 py-3 text-left font-medium text-gray-400">状态</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700/70">
                                    {tableRepositories.map((repository) => (
                                        <tr key={repository.id} className="hover:bg-gray-700/30">
                                            <td className="whitespace-nowrap px-4 py-3 font-medium">
                                                <a href={repository.url} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200 hover:underline">
                                                    {repository.name} ↗
                                                </a>
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-gray-300">{repository.sig.name}</td>
                                            <td className="whitespace-nowrap px-4 py-3 text-gray-200">{formatNumber(repository.new_prs)} / {formatNumber(repository.closed_merged_prs)}</td>
                                            <td className="whitespace-nowrap px-4 py-3 text-gray-200">{formatNumber(repository.new_issues)} / {formatNumber(repository.closed_issues)}</td>
                                            <td className="px-4 py-3 text-gray-200">{formatNumber(repository.new_commits)}</td>
                                            <td className="px-4 py-3 text-gray-200">{formatNumber(repository.active_contributors)}</td>
                                            <td className="whitespace-nowrap px-4 py-3 text-gray-400">{repository.last_active_date || '—'}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${repository.is_active
                                                    ? 'bg-emerald-400/10 text-emerald-300'
                                                    : 'bg-gray-600/30 text-gray-400'}`}
                                                >
                                                    {repository.is_active ? '活跃' : '无活动'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {tableRepositories.length === 0 && (
                                        <tr><td colSpan={8}><EmptyState /></td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </section>
    );
};

const EmptyState = () => (
    <div className="flex h-full min-h-32 items-center justify-center p-6 text-sm text-gray-500">当前条件下暂无仓库数据</div>
);

export default RepositoryInsights;
