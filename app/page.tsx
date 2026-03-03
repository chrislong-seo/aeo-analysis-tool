'use client';

import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

interface ResultDetail {
  title: string;
  link: string;
  snippet: string;
  brandMentioned: boolean;
  competitorsMentioned: string[];
}

interface MentionData {
  brand: number;
  competitors: { [key: string]: number };
  topCompetitor: string;
  totalCompetitorMentions: number;
  sources: Array<{ title: string; link: string; snippet: string }>;
  totalResults: number;
  detailedResults: ResultDetail[];
}

interface EcosystemResults {
  ownSite: MentionData;
  topArticles: MentionData;
  reddit: MentionData;
  youtube: MentionData;
}

interface SentimentResult {
  ecosystem: string;
  sentiment: string;
}

interface AnalysisResults {
  data: EcosystemResults;
  sentiment: SentimentResult[];
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

export default function Home() {
  const [topic, setTopic] = useState('');
  const [brand, setBrand] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [userDomain, setUserDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResults(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic,
          brand,
          competitors: competitors.split(',').map((c) => c.trim()),
          userDomain: userDomain || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze brand coverage');
      }

      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const prepareBarChartData = () => {
    if (!results) return [];

    // Get all unique competitor names
    const allCompetitors = new Set<string>();
    Object.values(results.data).forEach((ecosystem) => {
      Object.keys(ecosystem.competitors).forEach((comp) => allCompetitors.add(comp));
    });

    return [
      {
        name: 'Own Site',
        [brand]: results.data.ownSite.brand,
        ...results.data.ownSite.competitors,
      },
      {
        name: 'Top Articles',
        [brand]: results.data.topArticles.brand,
        ...results.data.topArticles.competitors,
      },
      {
        name: 'Reddit',
        [brand]: results.data.reddit.brand,
        ...results.data.reddit.competitors,
      },
      {
        name: 'YouTube',
        [brand]: results.data.youtube.brand,
        ...results.data.youtube.competitors,
      },
    ];
  };

  const preparePieChartData = (ecosystem: keyof EcosystemResults) => {
    if (!results) return [];

    const data = results.data[ecosystem];
    const pieData = [
      { name: brand, value: data.brand },
      ...Object.entries(data.competitors).map(([name, value]) => ({
        name,
        value,
      })),
    ];

    return pieData.filter((item) => item.value > 0);
  };

  const prepareColumnChartData = (ecosystem: keyof EcosystemResults) => {
    if (!results) return [];

    const data = results.data[ecosystem];
    return [
      { name: brand, mentions: data.brand, fill: '#0088FE' },
      ...Object.entries(data.competitors).map(([name, value], index) => ({
        name,
        mentions: value,
        fill: COLORS[(index + 1) % COLORS.length],
      })),
    ];
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-8 text-center">
          AEO Strategy Analysis
        </h1>

        {/* Input Form */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Topic / Search Query *
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., project management software"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your Brand Name *
              </label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Asana"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Competitors (comma-separated) *
              </label>
              <input
                type="text"
                value={competitors}
                onChange={(e) => setCompetitors(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Monday.com, Trello, ClickUp"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your Domain (optional)
              </label>
              <input
                type="text"
                value={userDomain}
                onChange={(e) => setUserDomain(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., asana.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 px-6 rounded-md font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Analyzing...' : 'Analyze AEO Strategy'}
            </button>
          </form>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {results && (
          <div className="space-y-12">
            {/* Overview Bar Chart */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Mentions Overview
              </h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={prepareBarChartData()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey={brand} fill="#0088FE" />
                  {competitors.split(',').map((comp, index) => (
                    <Bar
                      key={comp.trim()}
                      dataKey={comp.trim()}
                      fill={COLORS[(index + 1) % COLORS.length]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>

              {/* Analysis Section */}
              <div className="mt-6 bg-gray-50 rounded-lg p-5 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Competitive Analysis
                </h3>
                <ul className="space-y-2">
                  {(['ownSite', 'topArticles', 'reddit', 'youtube'] as const).map((ecosystem) => {
                    const data = results.data[ecosystem];
                    const ecosystemName = {
                      ownSite: 'Owned Content',
                      topArticles: 'Top Articles',
                      reddit: 'Reddit',
                      youtube: 'YouTube',
                    }[ecosystem];

                    const brandMentions = data.brand;
                    const competitorMentions = data.totalCompetitorMentions;

                    // Calculate average competitor mentions
                    const competitorValues = Object.values(data.competitors);
                    const numCompetitors = competitorValues.length;
                    const avgCompetitorMentions = numCompetitors > 0
                      ? competitorMentions / numCompetitors
                      : 0;

                    // Get top 2 competitors for this ecosystem
                    const topCompetitors = Object.entries(data.competitors)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 2)
                      .filter(([, mentions]) => mentions > 0);

                    const topCompetitorsText = topCompetitors.length > 0
                      ? ` Top competitors: ${topCompetitors.map(([name, mentions]) => `${name} (${mentions})`).join(', ')}.`
                      : '';

                    let strength: 'strong' | 'moderate' | 'weak' | 'absent';
                    let icon: string;
                    let colorClass: string;
                    let message: string;

                    if (brandMentions === 0 && competitorMentions === 0) {
                      strength = 'absent';
                      icon = '○';
                      colorClass = 'text-gray-600';
                      message = `${ecosystemName}: No brand mentions found.`;
                    } else if (brandMentions === 0) {
                      strength = 'absent';
                      icon = '✕';
                      colorClass = 'text-red-600';
                      message = `${ecosystemName}: ${brand} has no presence while competitors average ${avgCompetitorMentions.toFixed(1)} mentions each.${topCompetitorsText}`;
                    } else if (avgCompetitorMentions === 0) {
                      strength = 'strong';
                      icon = '✓';
                      colorClass = 'text-green-600';
                      message = `${ecosystemName}: ${brand} leads with ${brandMentions} mentions while competitors have no presence.`;
                    } else {
                      // Compare brand to average competitor
                      const ratio = brandMentions / avgCompetitorMentions;

                      if (ratio >= 1.5) {
                        strength = 'strong';
                        icon = '✓';
                        colorClass = 'text-green-600';
                        message = `${ecosystemName}: ${brand} outperforms with ${brandMentions} mentions (${ratio.toFixed(1)}x the average competitor's ${avgCompetitorMentions.toFixed(1)} mentions).${topCompetitorsText}`;
                      } else if (ratio >= 0.75) {
                        strength = 'moderate';
                        icon = '◐';
                        colorClass = 'text-yellow-600';
                        message = `${ecosystemName}: ${brand} has comparable presence with ${brandMentions} mentions (${ratio.toFixed(1)}x the average competitor's ${avgCompetitorMentions.toFixed(1)} mentions).${topCompetitorsText}`;
                      } else {
                        strength = 'weak';
                        icon = '◔';
                        colorClass = 'text-orange-600';
                        message = `${ecosystemName}: ${brand} underperforms with ${brandMentions} mentions (${ratio.toFixed(1)}x the average competitor's ${avgCompetitorMentions.toFixed(1)} mentions).${topCompetitorsText}`;
                      }
                    }

                    return (
                      <li key={ecosystem} className="flex items-start">
                        <span className={`font-bold mr-2 ${colorClass}`}>{icon}</span>
                        <span className="text-sm text-gray-700">{message}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* Detailed Ecosystem Sections */}
            {(['ownSite', 'topArticles', 'reddit', 'youtube'] as const).map(
              (ecosystem) => {
                const ecosystemData = results.data[ecosystem];
                const ecosystemName = {
                  ownSite: 'Owned Content',
                  topArticles: 'Top Articles',
                  reddit: 'Reddit',
                  youtube: 'YouTube',
                }[ecosystem];

                const sentimentItem = results.sentiment.find(
                  (s) => s.ecosystem === ecosystem
                );

                return (
                  <div key={ecosystem} className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">
                      {ecosystemName}
                    </h2>
                    <p className="text-sm text-gray-500 mb-2">
                      Analyzed {ecosystemData.totalResults} results
                    </p>

                    {/* Topical Relevance Display (Owned Content only) */}
                    {ecosystem === 'ownSite' && ecosystemData.topicalRelevance && (
                      <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-1">
                              Topical Relevance Analysis
                            </h4>
                            <p className="text-sm text-gray-600">
                              Content alignment with topic: <span className="font-mono">{topic}</span>
                            </p>
                          </div>
                          <div className="text-right">
                            <div className="text-3xl font-bold text-indigo-600">
                              {ecosystemData.topicalRelevance.highlyRelevant}
                            </div>
                            <div className="text-xs text-gray-500">
                              of {ecosystemData.topicalRelevance.totalAnalyzed} pages
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center">
                          <div className="flex-1 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-indigo-600 h-2 rounded-full"
                              style={{
                                width: `${(ecosystemData.topicalRelevance.highlyRelevant / ecosystemData.topicalRelevance.totalAnalyzed * 100)}%`
                              }}
                            />
                          </div>
                          <span className="ml-3 text-sm font-medium text-gray-700">
                            {Math.round((ecosystemData.topicalRelevance.highlyRelevant / ecosystemData.topicalRelevance.totalAnalyzed) * 100)}%
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          Pages with cosine similarity ≥ {ecosystemData.topicalRelevance.threshold}
                        </p>
                      </div>
                    )}

                    {/* Column Chart */}
                    <div className="mb-8">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">
                        Brand Mentions
                      </h3>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={prepareColumnChartData(ecosystem)}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="mentions" fill="#8884d8">
                            {prepareColumnChartData(ecosystem).map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Sentiment/Positioning Analysis */}
                    {sentimentItem && (
                      <div className="mb-8 p-6 bg-blue-50 rounded-lg border border-blue-200">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">
                          {ecosystem === 'topArticles' || ecosystem === 'youtube' ? 'Positioning Analysis' : 'Sentiment Analysis'}
                        </h3>
                        {(() => {
                          const text = sentimentItem.sentiment;
                          const isPositioningAnalysis = ecosystem === 'topArticles' || ecosystem === 'youtube';

                          if (isPositioningAnalysis) {
                            // Parse positioning format
                            const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?=BEST FOR|$)/i);
                            const brandBestForMatch = text.match(/BEST FOR - [^:]+:\s*([\s\S]*?)(?=BEST FOR - Competitors:|$)/i);
                            const competitorsBestForMatch = text.match(/BEST FOR - Competitors:\s*([\s\S]*?)$/i);

                            const summary = summaryMatch?.[1]?.trim() || text;
                            const brandBestFor = brandBestForMatch?.[1]?.trim().split('\n').filter(line => line.trim().startsWith('-')).map(line => line.trim().substring(1).trim()) || [];
                            const competitorsBestFor = competitorsBestForMatch?.[1]?.trim().split('\n').filter(line => line.trim().startsWith('-')).map(line => line.trim().substring(1).trim()) || [];

                            return (
                              <div className="space-y-4">
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Summary</h4>
                                  <p className="text-gray-700 text-sm leading-relaxed">{summary}</p>
                                </div>

                                {(brandBestFor.length > 0 || competitorsBestFor.length > 0) && (
                                  <div className="grid md:grid-cols-2 gap-4 mt-4">
                                    {brandBestFor.length > 0 && (
                                      <div className="bg-blue-50 p-4 rounded-lg border border-blue-300">
                                        <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center">
                                          <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                          </svg>
                                          {brand} - Best For
                                        </h4>
                                        <ul className="space-y-2">
                                          {brandBestFor.map((item, idx) => (
                                            <li key={idx} className="text-sm text-gray-700 flex items-start">
                                              <span className="text-blue-600 mr-2">→</span>
                                              <span>{item}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {competitorsBestFor.length > 0 && (
                                      <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                                        <h4 className="text-sm font-semibold text-purple-800 mb-3 flex items-center">
                                          <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                                          </svg>
                                          Competitors - Best For
                                        </h4>
                                        <ul className="space-y-2">
                                          {competitorsBestFor.map((item, idx) => (
                                            <li key={idx} className="text-sm text-gray-700 flex items-start">
                                              <span className="text-purple-600 mr-2">→</span>
                                              <span>{item}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          } else {
                            // Parse pros/cons format or competitor insights format
                            const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?=PROS:|COMPETITOR INSIGHTS|$)/i);
                            const prosMatch = text.match(/PROS:\s*([\s\S]*?)(?=CONS:|$)/i);
                            const consMatch = text.match(/CONS:\s*([\s\S]*?)(?=COMPETITOR INSIGHTS|$)/i);
                            const competitorInsightsMatch = text.match(/COMPETITOR INSIGHTS - Top 2:\s*([\s\S]*?)$/i);

                            const summary = summaryMatch?.[1]?.trim() || text;
                            const pros = prosMatch?.[1]?.trim().split('\n').filter(line => line.trim().startsWith('-')).map(line => line.trim().substring(1).trim()) || [];
                            const cons = consMatch?.[1]?.trim().split('\n').filter(line => line.trim().startsWith('-')).map(line => line.trim().substring(1).trim()) || [];
                            const competitorInsights = competitorInsightsMatch?.[1]?.trim().split('\n').filter(line => line.trim().startsWith('-')).map(line => line.trim().substring(1).trim()) || [];

                            const hasCompetitorInsights = competitorInsights.length > 0;

                            return (
                              <div className="space-y-4">
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Summary</h4>
                                  <p className="text-gray-700 text-sm leading-relaxed">{summary}</p>
                                </div>

                                {hasCompetitorInsights ? (
                                  <div className="mt-4">
                                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                                      <h4 className="text-sm font-semibold text-purple-800 mb-3 flex items-center">
                                        <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                          <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                                        </svg>
                                        Competitor Insights - Top 2
                                      </h4>
                                      <ul className="space-y-3">
                                        {competitorInsights.map((insight, idx) => (
                                          <li key={idx} className="text-sm text-gray-700 flex items-start">
                                            <span className="text-purple-600 mr-2">→</span>
                                            <span>{insight}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </div>
                                ) : (
                                  (pros.length > 0 || cons.length > 0) && (
                                    <div className="grid md:grid-cols-2 gap-4 mt-4">
                                      {pros.length > 0 && (
                                        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                                          <h4 className="text-sm font-semibold text-green-800 mb-3 flex items-center">
                                            <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                            Pros
                                          </h4>
                                          <ul className="space-y-2">
                                            {pros.map((pro, idx) => (
                                              <li key={idx} className="text-sm text-gray-700 flex items-start">
                                                <span className="text-green-600 mr-2">•</span>
                                                <span>{pro}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}

                                      {cons.length > 0 && (
                                        <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                                          <h4 className="text-sm font-semibold text-red-800 mb-3 flex items-center">
                                            <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                            </svg>
                                            Cons
                                          </h4>
                                          <ul className="space-y-2">
                                            {cons.map((con, idx) => (
                                              <li key={idx} className="text-sm text-gray-700 flex items-start">
                                                <span className="text-red-600 mr-2">•</span>
                                                <span>{con}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                    </div>
                                  )
                                )}
                              </div>
                            );
                          }
                        })()}
                      </div>
                    )}

                    {/* Results Table */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">
                        Top 10 Results
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Link
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                {brand} Mentioned
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Competitors Mentioned
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {ecosystemData.detailedResults.slice(0, 10).map((result, index) => (
                              <tr key={index} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                  <a
                                    href={result.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline text-sm"
                                  >
                                    {result.title}
                                  </a>
                                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                    {result.snippet}
                                  </p>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {result.brandMentioned ? (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                      Yes
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                      No
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {result.competitorsMentioned.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {result.competitorsMentioned.map((comp, i) => (
                                        <span
                                          key={i}
                                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800"
                                        >
                                          {comp}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-sm text-gray-400">None</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        )}
      </div>
    </div>
  );
}
