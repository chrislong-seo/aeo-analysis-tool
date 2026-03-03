import { NextRequest, NextResponse } from 'next/server';
import { getJson } from 'serpapi';
import Anthropic from '@anthropic-ai/sdk';
import { chromium, Browser } from 'playwright';

// Helper functions for TF-IDF and cosine similarity
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2); // Filter out very short words
}

function calculateTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  const totalTokens = tokens.length;

  tokens.forEach(token => {
    tf.set(token, (tf.get(token) || 0) + 1);
  });

  // Normalize by total tokens
  tf.forEach((count, token) => {
    tf.set(token, count / totalTokens);
  });

  return tf;
}

function calculateIDF(documents: string[][]): Map<string, number> {
  const idf = new Map<string, number>();
  const totalDocs = documents.length;

  // Count document frequency for each term
  const docFreq = new Map<string, number>();
  documents.forEach(doc => {
    const uniqueTokens = new Set(doc);
    uniqueTokens.forEach(token => {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    });
  });

  // Calculate IDF
  docFreq.forEach((freq, token) => {
    idf.set(token, Math.log(totalDocs / freq));
  });

  return idf;
}

function calculateTFIDF(tf: Map<string, number>, idf: Map<string, number>): Map<string, number> {
  const tfidf = new Map<string, number>();

  tf.forEach((tfValue, token) => {
    const idfValue = idf.get(token) || 0;
    tfidf.set(token, tfValue * idfValue);
  });

  return tfidf;
}

function cosineSimilarity(vec1: Map<string, number>, vec2: Map<string, number>): number {
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  // Get all unique terms
  const allTerms = new Set([...vec1.keys(), ...vec2.keys()]);

  allTerms.forEach(term => {
    const v1 = vec1.get(term) || 0;
    const v2 = vec2.get(term) || 0;

    dotProduct += v1 * v2;
    mag1 += v1 * v1;
    mag2 += v2 * v2;
  });

  if (mag1 === 0 || mag2 === 0) return 0;

  return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

interface AnalyzeRequest {
  topic: string;
  brand: string;
  competitors: string[];
  userDomain?: string;
}

interface ResultDetail {
  title: string;
  link: string;
  snippet: string;
  brandMentioned: boolean;
  competitorsMentioned: string[];
  fullContent?: string; // Store full extracted content
}

interface MentionData {
  brand: number;
  competitors: { [key: string]: number };
  topCompetitor: string;
  totalCompetitorMentions: number;
  sources: Array<{ title: string; link: string; snippet: string }>;
  totalResults: number;
  detailedResults: ResultDetail[];
  brandRelevantContent: string[]; // Full content from articles mentioning the brand
  topicalRelevance?: {
    totalAnalyzed: number;
    highlyRelevant: number; // Count of pages with similarity > threshold
    threshold: number;
  };
}

interface EcosystemResults {
  ownSite: MentionData;
  topArticles: MentionData;
  reddit: MentionData;
  youtube: MentionData;
}

// Helper function to fetch and extract text content from a URL using Playwright
async function fetchArticleContent(
  url: string,
  browser: Browser
): Promise<string> {
  let page;
  try {
    page = await browser.newPage();

    // Set user agent to look like a real browser
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    });

    // Convert Reddit URLs to old.reddit.com for better scraping
    let finalUrl = url;
    if (url.includes('reddit.com') && !url.includes('old.reddit.com')) {
      finalUrl = url.replace(/(?:www\.)?reddit\.com/g, 'old.reddit.com');
      console.log(`Converting Reddit URL: ${url} -> ${finalUrl}`);
    }

    // Navigate to the URL with a 15 second timeout
    await page.goto(finalUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // Wait a bit for dynamic content to load
    await page.waitForTimeout(2000);

    // Extract text content from the rendered page
    const text = await page.evaluate(() => {
      // Remove unwanted elements first
      const elementsToRemove = document.querySelectorAll(
        'script, style, nav, footer, header, aside, iframe, noscript, .navigation, .sidebar, .menu, .footer, .header, .ad, .advertisement, [role="navigation"], [role="complementary"]'
      );
      elementsToRemove.forEach((el) => el.remove());

      // Special handling for Reddit (old.reddit.com)
      const isReddit = window.location.hostname.includes('reddit.com');
      if (isReddit) {
        // Target only the main content container, ignoring everything else
        const mainContent = document.querySelector('.content[role="main"]');
        if (!mainContent) {
          return ''; // Couldn't find main content
        }

        // Within main content, get the post
        const postTitle = mainContent.querySelector('.thing .title a');
        const title = postTitle?.textContent?.trim() || '';

        // Get the post body if it exists (text posts have this)
        const postBody = mainContent.querySelector('.thing .usertext-body .md');
        const postContent = postBody?.textContent?.trim() || '';

        // Get comments - only from the comment area, not from sticky mod messages
        const commentArea = mainContent.querySelector('.commentarea');
        const comments = commentArea
          ? Array.from(commentArea.querySelectorAll('.entry .md'))
              .slice(0, 10)
              .map(el => el.textContent?.trim() || '')
              .filter(text => text.length > 30) // Filter out short/empty comments
              .join(' ')
          : '';

        const combined = `${title} ${postContent} ${comments}`;
        return combined.replace(/\s+/g, ' ').trim();
      }

      // Try multiple strategies to extract main content
      // Strategy 1: Look for article or main tag with most content
      const contentSelectors = [
        'article',
        'main',
        '[role="main"]',
        '.post-content',
        '.entry-content',
        '.article-content',
        '.content',
        '#content'
      ];

      let bestContent = '';
      let maxLength = 0;

      for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.innerText || '';
          if (text.length > maxLength) {
            maxLength = text.length;
            bestContent = text;
          }
        }
      }

      // Fallback to body if no better content found
      if (!bestContent || bestContent.length < 100) {
        bestContent = document.body.innerText || '';
      }

      // Clean up whitespace
      return bestContent.replace(/\s+/g, ' ').trim();
    });

    // Limit to 50k chars
    return text.slice(0, 50000);
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return '';
  } finally {
    if (page) {
      await page.close();
    }
  }
}

// Helper function to verify brand mentions using LLM
async function verifyBrandMentionsWithLLM(
  text: string,
  brand: string,
  competitors: string[],
  anthropic: Anthropic
): Promise<{ brandMentioned: boolean; competitorsMentioned: string[] }> {
  try {
    // Truncate text if too long (keep first 20k chars for better analysis)
    const textToAnalyze = text.slice(0, 20000);

    if (!textToAnalyze || textToAnalyze.length < 50) {
      throw new Error('Text too short for LLM analysis');
    }

    const allBrands = [brand, ...competitors];
    const prompt = `You are analyzing an article to identify which brands are mentioned.

Your task: Carefully read the article excerpt below and identify which of these brands are EXPLICITLY mentioned by name in the text:

${allBrands.map((b, i) => `${i + 1}. ${b}`).join('\n')}

IMPORTANT RULES:
- Only include brands that appear BY NAME in the text
- Check for exact matches and common variations (e.g., "Asana" or "Asana.com")
- Be case-insensitive
- If a brand is not mentioned, do NOT include it
- Return ONLY the brands that are actually present

Article excerpt:
${textToAnalyze}

Respond with ONLY valid JSON in this exact format (no markdown formatting, no code blocks):
{"mentioned": ["Brand1", "Brand2"]}

If no brands are mentioned, return:
{"mentioned": []}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    // Clean the response (remove markdown if present)
    let jsonText = content.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```\n?/g, '');
    }

    console.log('LLM response for brand detection:', jsonText);

    // Parse the JSON response
    const result = JSON.parse(jsonText);
    const mentionedBrands = result.mentioned || [];

    console.log(`LLM found brands: ${mentionedBrands.join(', ') || 'none'}`);

    return {
      brandMentioned: mentionedBrands.some(
        (m: string) => m.toLowerCase() === brand.toLowerCase()
      ),
      competitorsMentioned: competitors.filter((comp) =>
        mentionedBrands.some((m: string) => m.toLowerCase() === comp.toLowerCase())
      ),
    };
  } catch (error) {
    console.error('LLM verification error:', error);
    console.log('Falling back to regex detection');
    // Fallback to regex-based detection
    return {
      brandMentioned: isBrandMentioned(text, brand),
      competitorsMentioned: competitors.filter((comp) =>
        isBrandMentioned(text, comp)
      ),
    };
  }
}

// Helper function to escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper function to generate brand name variations
function getBrandVariations(brand: string): string[] {
  const variations = [brand];

  // Add version without common suffixes
  const withoutSuffix = brand
    .replace(/\.(com|net|org|io|co)$/i, '')
    .trim();
  if (withoutSuffix !== brand) {
    variations.push(withoutSuffix);
  }

  // Add version with .com if not present
  if (!brand.toLowerCase().includes('.com')) {
    variations.push(`${brand}.com`);
  }

  return [...new Set(variations)]; // Remove duplicates
}

// Helper function to check if brand is mentioned in text
function isBrandMentioned(text: string, brand: string): boolean {
  if (!text || !brand) return false;

  const variations = getBrandVariations(brand);

  for (const variation of variations) {
    // Escape special regex characters and add word boundaries
    const escaped = escapeRegex(variation);
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');

    if (regex.test(text)) {
      return true;
    }
  }

  return false;
}

// Helper function to count mentions in text with word boundaries
function countMentions(text: string, term: string): number {
  if (!text || !term) return 0;

  const variations = getBrandVariations(term);
  let count = 0;

  for (const variation of variations) {
    const escaped = escapeRegex(variation);
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = text.match(regex) || [];
    count += matches.length;
  }

  return count;
}

// Helper function to extract text from SERP results
function extractTextFromResults(results: any[]): string {
  return results
    .map((result) => {
      const title = result.title || '';
      const snippet = result.snippet || '';
      const description = result.description || '';
      return `${title} ${snippet} ${description}`;
    })
    .join(' ');
}

// Helper function to create frequency vector from tokens
function createFrequencyVector(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();

  tokens.forEach(token => {
    freq.set(token, (freq.get(token) || 0) + 1);
  });

  return freq;
}

// Helper function to calculate topical relevance using simple cosine similarity
function calculateTopicalRelevance(
  topic: string,
  detailedResults: ResultDetail[],
  threshold: number = 0.2 // Threshold for word frequency cosine similarity (typical range: 0.15-0.35)
): { totalAnalyzed: number; highlyRelevant: number; threshold: number } {
  // Filter results that have content
  const resultsWithContent = detailedResults.filter(r => r.fullContent && r.fullContent.trim().length > 100);

  if (resultsWithContent.length === 0) {
    return { totalAnalyzed: 0, highlyRelevant: 0, threshold };
  }

  // Tokenize topic and documents
  const topicTokens = tokenize(topic);
  const topicVector = createFrequencyVector(topicTokens);

  // Calculate similarity for each document
  let highlyRelevantCount = 0;

  resultsWithContent.forEach((result) => {
    const docTokens = tokenize(result.fullContent!);
    const docVector = createFrequencyVector(docTokens);

    const similarity = cosineSimilarity(topicVector, docVector);

    if (similarity >= threshold) {
      highlyRelevantCount++;
    }
  });

  return {
    totalAnalyzed: resultsWithContent.length,
    highlyRelevant: highlyRelevantCount,
    threshold,
  };
}

// Helper function to analyze mentions in results
async function analyzeMentions(
  results: any[],
  brand: string,
  competitors: string[],
  anthropic: Anthropic,
  browser: Browser
): Promise<MentionData> {
  // Analyze each individual result by fetching full content
  const detailedResultsPromises = results.slice(0, 50).map(async (result) => {
    const url = result.link || '';

    // Fetch full article content using Playwright
    const articleContent = await fetchArticleContent(url, browser);

    // Check full content if available, otherwise fall back to snippet
    const textToAnalyze = articleContent || `${result.title || ''} ${result.snippet || ''} ${result.description || ''}`;

    // Use LLM verification if we have content
    let brandMentioned: boolean;
    let competitorsMentioned: string[];

    if (textToAnalyze && textToAnalyze.length > 100) {
      // Use LLM for more accurate detection
      const llmResult = await verifyBrandMentionsWithLLM(
        textToAnalyze,
        brand,
        competitors,
        anthropic
      );
      brandMentioned = llmResult.brandMentioned;
      competitorsMentioned = llmResult.competitorsMentioned;
    } else {
      // Fallback to regex for very short content
      brandMentioned = isBrandMentioned(textToAnalyze, brand);
      competitorsMentioned = competitors.filter((competitor) =>
        isBrandMentioned(textToAnalyze, competitor)
      );
    }

    return {
      title: result.title || 'Untitled',
      link: url,
      snippet: result.snippet || result.description || '',
      brandMentioned,
      competitorsMentioned,
      fullContent: textToAnalyze, // Store full content for sentiment analysis
    };
  });

  const detailedResults = await Promise.all(detailedResultsPromises);

  // Calculate overall mention counts from LLM-verified detailed results
  const brandMentions = detailedResults.filter((r) => r.brandMentioned).length;
  const competitorMentions: { [key: string]: number } = {};

  competitors.forEach((competitor) => {
    competitorMentions[competitor] = detailedResults.filter((r) =>
      r.competitorsMentioned.includes(competitor)
    ).length;
  });

  const totalCompetitorMentions = Object.values(competitorMentions).reduce(
    (sum, count) => sum + count,
    0
  );

  const topCompetitor =
    Object.entries(competitorMentions).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    'None';

  const sources = results.slice(0, 5).map((result) => ({
    title: result.title || 'Untitled',
    link: result.link || '',
    snippet: result.snippet || result.description || '',
  }));

  // Collect full content from articles that mention the brand
  // Limit each article to 3000 chars to keep total reasonable
  const brandRelevantContent = detailedResults
    .filter((r) => r.brandMentioned && r.fullContent)
    .map((r) => r.fullContent!.slice(0, 3000));

  return {
    brand: brandMentions,
    competitors: competitorMentions,
    topCompetitor,
    totalCompetitorMentions,
    sources,
    totalResults: results.length,
    detailedResults,
    brandRelevantContent,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequest = await request.json();
    const { topic, brand, competitors, userDomain } = body;

    if (!topic || !brand || !competitors || competitors.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: topic, brand, and competitors' },
        { status: 400 }
      );
    }

    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'SERPAPI_API_KEY not configured' },
        { status: 500 }
      );
    }

    // Helper function to fetch multiple pages of results
    async function fetchPaginatedResults(query: string, pages: number = 3) {
      const promises = [];
      for (let i = 0; i < pages; i++) {
        promises.push(
          getJson({
            engine: 'google',
            q: query,
            api_key: apiKey,
            num: 10,
            start: i * 10,
          })
        );
      }
      const results = await Promise.all(promises);
      // Combine all organic results from all pages
      return results.flatMap((r) => r.organic_results || []);
    }

    // Make paginated calls for each ecosystem (3 pages = ~30 results)
    const [googleResults, redditResults, youtubeResults, ownSiteResults] =
      await Promise.all([
        // 1. Top ranking articles (Google search) - targeting "best of" listicles for current year
        fetchPaginatedResults(`${topic} intitle:2026 intitle:best`, 5),

        // 2. Reddit
        fetchPaginatedResults(`site:reddit.com ${topic}`, 5),

        // 3. YouTube
        fetchPaginatedResults(`site:youtube.com ${topic} intitle:2026 intitle:best`, 5),

        // 4. Own site (if provided) - fetch 20 pages for topical relevance analysis
        userDomain
          ? fetchPaginatedResults(`site:${userDomain} ${topic}`, 20)
          : Promise.resolve([]),
      ]);

    // Filter out user's domain from top articles
    const filteredGoogleResults = userDomain
      ? googleResults.filter((result: any) => !result.link?.includes(userDomain))
      : googleResults;

    // Initialize Anthropic client for LLM verification
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Launch Playwright browser for content fetching
    console.log('Launching browser...');
    const browser = await chromium.launch({
      headless: true,
    });

    try {
      // Analyze mentions for each ecosystem in parallel
      const [ownSiteData, topArticlesData, redditData, youtubeData] = await Promise.all([
        analyzeMentions(ownSiteResults, brand, competitors, anthropic, browser),
        analyzeMentions(filteredGoogleResults, brand, competitors, anthropic, browser),
        analyzeMentions(redditResults, brand, competitors, anthropic, browser),
        analyzeMentions(youtubeResults, brand, competitors, anthropic, browser),
      ]);

      // Calculate topical relevance for owned content (if present)
      if (userDomain && ownSiteData.detailedResults.length > 0) {
        ownSiteData.topicalRelevance = calculateTopicalRelevance(
          topic,
          ownSiteData.detailedResults,
          0.2 // Meaningful threshold for word frequency cosine similarity
        );
      }

      const ecosystemResults: EcosystemResults = {
        ownSite: ownSiteData,
        topArticles: topArticlesData,
        reddit: redditData,
        youtube: youtubeData,
      };

      const sentimentPrompts = Object.entries(ecosystemResults).map(
        async ([ecosystem, data]) => {
          // Use full content from articles that mention the brand
          const brandContent = data.brandRelevantContent.join('\n\n---\n\n');

          // Check if we should analyze competitors when brand is not found
          const shouldAnalyzeCompetitors = !brandContent.trim() && (ecosystem === 'reddit' || ecosystem === 'youtube');

          if (!brandContent.trim() && !shouldAnalyzeCompetitors) {
            return {
              ecosystem,
              sentiment: `No articles mentioning ${brand} found in this ecosystem.`,
            };
          }

          try {
            let contentToAnalyze: string;
            let hasBrandContent: boolean;

            if (!brandContent.trim() && shouldAnalyzeCompetitors) {
              // Collect competitor content when brand is not found
              const competitorContent = data.detailedResults
                .filter((r) => r.competitorsMentioned.length > 0 && r.fullContent)
                .map((r) => r.fullContent!.slice(0, 3000))
                .join('\n\n---\n\n');

              contentToAnalyze = competitorContent.slice(0, 15000);
              hasBrandContent = false;

              if (!contentToAnalyze.trim()) {
                return {
                  ecosystem,
                  sentiment: `No content found for ${brand} or competitors in this ecosystem.`,
                };
              }
            } else {
              // Limit total content to 15k chars to stay within context limits
              contentToAnalyze = brandContent.slice(0, 15000);
              hasBrandContent = true;
            }

            const isPositioningAnalysis = ecosystem === 'topArticles' || ecosystem === 'youtube';

            // Get top 2 competitors from this ecosystem's data
            const topTwoCompetitors = Object.entries(data.competitors)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 2)
              .filter(([, mentions]) => mentions > 0)
              .map(([name]) => name);

            let promptContent: string;

            if (isPositioningAnalysis) {
              if (!hasBrandContent) {
                // Positioning analysis for competitors when brand not found
                promptContent = `You are analyzing comparison/review content from ${ecosystem}. Note: "${brand}" was NOT found in this content.

Your task: Analyze how competitors (${competitors.join(', ')}) are positioned in this content, with special focus on the top mentioned competitors: ${topTwoCompetitors.join(', ')}.

Content from ${ecosystem}:
${contentToAnalyze}

Provide your analysis in this EXACT format:

SUMMARY:
[Write exactly 3 sentences: (1) Note that ${brand} was not found in ${ecosystem} content, (2) What category/problem space these articles cover, (3) Overview of which competitors dominate this space.]

BEST FOR - ${brand}:
- ${brand} was not mentioned in the analyzed ${ecosystem} content

BEST FOR - Competitors:
- [Top competitor name]: [What they're positioned as "best for" - be specific about use cases]
- [Second top competitor]: [What they're positioned as "best for" - be specific about use cases]
- [Other competitor if mentioned]: [What they're positioned as "best for"]

IMPORTANT:
- Focus on the top 2 competitors: ${topTwoCompetitors.join(', ')}
- Be specific about use cases (e.g., "best for small teams", "best for enterprise", "best for budget-conscious users")
- Look for patterns across multiple articles/videos`;
              } else {
                // Positioning analysis for Top Articles and YouTube
                promptContent = `You are analyzing comparison/review content from ${ecosystem} that mentions "${brand}" and potentially its competitors (${competitors.join(', ')}).

Your task: Find what "${brand}" is recommended as "best for" across these articles/videos. Look for consensus and patterns. Also note what competitors are positioned as "best for".

Content from ${ecosystem}:
${contentToAnalyze}

Provide your analysis in this EXACT format:

SUMMARY:
[Write exactly 3 sentences: (1) What category/problem space these articles cover, (2) What consensus exists about what ${brand} is "best for", (3) Brief competitive landscape overview.]

BEST FOR - ${brand}:
- [First use case/scenario where ${brand} is recommended as "best" - note if mentioned in multiple sources]
- [Second use case/scenario where ${brand} is recommended as "best"]
- [Third use case/scenario where ${brand} is recommended as "best"]

BEST FOR - Competitors:
- [Competitor name]: [What they're positioned as "best for"]
- [Another competitor]: [What they're positioned as "best for"]
- [Another competitor]: [What they're positioned as "best for"]

IMPORTANT:
- If there's not enough data to identify clear positioning, write "Not enough data to identify clear positioning" in that section
- Focus on actual "best for" language and recommendations from the content
- Look for patterns across multiple articles/videos
- Be specific about use cases (e.g., "best for small teams", "best for enterprise", "best for budget-conscious users")`;
              }
            } else {
              if (!hasBrandContent) {
                // Sentiment analysis for competitors when brand not found (Reddit)
                promptContent = `You are analyzing content from ${ecosystem}. Note: "${brand}" was NOT found in this content.

Your task: Analyze how competitors (${competitors.join(', ')}) are discussed and positioned, with special focus on the top mentioned competitors: ${topTwoCompetitors.join(', ')}.

Content from ${ecosystem}:
${contentToAnalyze}

Provide your analysis in this EXACT format:

SUMMARY:
[Write exactly 3 sentences: (1) Note that ${brand} was not found in ${ecosystem} discussions, (2) Overall sentiment about competitors in this space, (3) Key themes and concerns discussed about competitor products.]

PROS:
- ${brand} was not mentioned in the analyzed ${ecosystem} discussions

CONS:
- ${brand} was not mentioned in the analyzed ${ecosystem} discussions

COMPETITOR INSIGHTS - Top 2:
- [Top competitor name]: [How they're discussed - sentiment, strengths, and weaknesses mentioned]
- [Second top competitor]: [How they're discussed - sentiment, strengths, and weaknesses mentioned]

IMPORTANT:
- Focus on the top 2 competitors: ${topTwoCompetitors.join(', ')}
- Summarize the general sentiment and key discussion points about each competitor
- Note any specific strengths or weaknesses mentioned`;
              } else {
                // Pros/Cons analysis for Own Site and Reddit
                promptContent = `You are analyzing content ONLY from ${ecosystem} that mentions "${brand}".

Your task: Analyze the sentiment and tone about how "${brand}" is portrayed in THIS SPECIFIC PLATFORM (${ecosystem}).

Content from ${ecosystem}:
${contentToAnalyze}

Provide your analysis in this EXACT format:

SUMMARY:
[Write exactly 3 sentences summarizing how ${brand} is portrayed on ${ecosystem}, including overall sentiment (positive/negative/neutral/mixed) and key themes discussed.]

PROS:
- [First positive aspect or strength mentioned about ${brand}]
- [Second positive aspect or strength mentioned about ${brand}]
- [Third positive aspect or strength mentioned about ${brand}]

CONS:
- [First negative aspect or criticism mentioned about ${brand}]
- [Second negative aspect or criticism mentioned about ${brand}]
- [Third negative aspect or criticism mentioned about ${brand}]

IMPORTANT:
- Focus ONLY on ${brand}, not competitors
- If there aren't enough pros or cons mentioned, write "Not enough discussion to identify" for that bullet point
- Be specific and quote themes/features mentioned in the content`;
              }
            }

            const message = await anthropic.messages.create({
              model: 'claude-sonnet-4-6',
              max_tokens: 800,
              messages: [
                {
                  role: 'user',
                  content: promptContent,
                },
              ],
            });

            const content = message.content[0];
            return {
              ecosystem,
              sentiment:
                content.type === 'text' ? content.text : 'Analysis unavailable',
            };
          } catch (error) {
            console.error(`Sentiment analysis error for ${ecosystem}:`, error);
            return {
              ecosystem,
              sentiment: 'Sentiment analysis unavailable.',
            };
          }
        }
      );

      const sentimentResults = await Promise.all(sentimentPrompts);

      return NextResponse.json({
        success: true,
        data: ecosystemResults,
        sentiment: sentimentResults,
      });
    } finally {
      // Always close the browser
      console.log('Closing browser...');
      await browser.close();
    }
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'An error occurred while analyzing brand coverage' },
      { status: 500 }
    );
  }
}
