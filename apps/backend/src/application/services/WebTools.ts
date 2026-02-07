// =============================================================================
// Web Tools
// =============================================================================
// Tool registrations for web search (Tavily) and web fetching

import type { ToolRegistry } from './ToolRegistry.js';
import { logger } from '../../infrastructure/logging/logger.js';

// =============================================================================
// Web Search (Tavily API)
// =============================================================================

/**
 * Register web search tool using Tavily API
 *
 * Tavily provides AI-optimized search results that are perfect for LLM consumption.
 * Requires TAVILY_API_KEY environment variable to be set.
 */
export function registerWebSearchTool(registry: ToolRegistry): void {
  registry.register(
    {
      id: 'web_search',
      name: 'web_search',
      description:
        'Search the web for current information. Use this for real-time data, news, facts, or any information that might be more recent than your training data. Returns relevant snippets from web pages.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Search query. Be specific for better results (e.g., "latest iPhone release date 2024" instead of "iPhone").',
          },
          searchDepth: {
            type: 'string',
            description:
              '"basic" for quick results, "advanced" for more comprehensive search. Default: basic',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return (1-10). Default: 5',
          },
          includeAnswer: {
            type: 'boolean',
            description:
              'Include an AI-generated answer summarizing the results. Default: true',
          },
        },
        required: ['query'],
      },
    },
    async (_userId, input) => {
      const log = logger.child({ tool: 'web_search' });
      const query = input.query as string;
      const searchDepth = (input.searchDepth as string) || 'basic';
      const maxResults = Math.min(Math.max((input.maxResults as number) || 5, 1), 10);
      const includeAnswer = input.includeAnswer !== false;

      if (!query || query.trim().length === 0) {
        return { success: false, error: 'Query is required' };
      }

      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        log.warn('TAVILY_API_KEY not configured');
        return {
          success: false,
          error:
            'Web search is not configured. Please add TAVILY_API_KEY to your environment variables.',
          suggestion:
            'You can get a free API key at https://tavily.com',
        };
      }

      try {
        log.debug('Performing web search', { query, searchDepth, maxResults });

        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: searchDepth,
            max_results: maxResults,
            include_answer: includeAnswer,
            include_raw_content: false,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          log.error('Tavily API error', new Error(errorText), {
            status: response.status,
          });
          return {
            success: false,
            error: `Search failed: ${response.status} ${response.statusText}`,
          };
        }

        const data = (await response.json()) as TavilyResponse;

        log.info('Web search completed', {
          query,
          resultsCount: data.results?.length || 0,
        });

        return {
          success: true,
          query,
          answer: data.answer || null,
          results: (data.results || []).map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content,
            score: r.score,
          })),
          followUpQuestions: data.follow_up_questions || [],
        };
      } catch (error) {
        log.error('Web search failed', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Search failed',
        };
      }
    },
    { category: 'web' }
  );
}

interface TavilyResponse {
  answer?: string;
  results?: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
  follow_up_questions?: string[];
}

// =============================================================================
// Web Fetch
// =============================================================================

/**
 * Register web fetch tool for retrieving content from URLs
 *
 * Supports multiple output formats:
 * - html: Raw HTML content
 * - markdown: Converted to markdown (best for LLM consumption)
 * - text: Plain text with HTML stripped
 */
export function registerWebFetchTool(registry: ToolRegistry): void {
  registry.register(
    {
      id: 'web_fetch',
      name: 'web_fetch',
      description:
        'Fetch content from a specific URL. Use this when you need to read the content of a web page. Supports different output formats.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch content from. Must be a valid HTTP/HTTPS URL.',
          },
          format: {
            type: 'string',
            description:
              'Output format: "text" (plain text, default), "markdown" (converted to markdown), "html" (raw HTML). Use "markdown" for best LLM readability.',
          },
          maxLength: {
            type: 'number',
            description:
              'Maximum content length to return in characters (default: 10000, max: 50000). Longer content will be truncated.',
          },
        },
        required: ['url'],
      },
    },
    async (_userId, input) => {
      const log = logger.child({ tool: 'web_fetch' });
      const url = input.url as string;
      const format = (input.format as 'html' | 'markdown' | 'text') || 'text';
      const maxLength = Math.min((input.maxLength as number) || 10000, 50000);

      if (!url || url.trim().length === 0) {
        return { success: false, error: 'URL is required' };
      }

      // Validate URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          return { success: false, error: 'URL must use HTTP or HTTPS protocol' };
        }
      } catch {
        return { success: false, error: 'Invalid URL format' };
      }

      try {
        log.debug('Fetching URL', { url, format });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

        const response = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; JarvisBot/1.0; +https://github.com/project-jarvis)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: controller.signal,
          redirect: 'follow',
        });

        clearTimeout(timeout);

        if (!response.ok) {
          return {
            success: false,
            error: `Failed to fetch: ${response.status} ${response.statusText}`,
            url,
          };
        }

        const contentType = response.headers.get('content-type') || '';
        let rawContent = await response.text();

        // Truncate if too long
        const wasTruncated = rawContent.length > maxLength;
        if (wasTruncated) {
          rawContent = rawContent.slice(0, maxLength);
        }

        let content: string;
        switch (format) {
          case 'html':
            content = rawContent;
            break;
          case 'markdown':
            content = htmlToMarkdown(rawContent);
            break;
          case 'text':
          default:
            content = htmlToText(rawContent);
            break;
        }

        log.info('URL fetched successfully', {
          url,
          format,
          contentLength: content.length,
          wasTruncated,
        });

        return {
          success: true,
          url: response.url, // Final URL after redirects
          format,
          content,
          contentType,
          wasTruncated,
          originalLength: wasTruncated ? rawContent.length : undefined,
        };
      } catch (error) {
        log.error('Web fetch failed', error, { url });

        if (error instanceof Error && error.name === 'AbortError') {
          return { success: false, error: 'Request timed out (30s limit)', url };
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Fetch failed',
          url,
        };
      }
    },
    { category: 'web' }
  );
}

// =============================================================================
// HTML Conversion Helpers
// =============================================================================

/**
 * Convert HTML to plain text
 * Strips all tags and decodes HTML entities
 */
function htmlToText(html: string): string {
  // Remove script and style elements
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Replace block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n');
  text = text.replace(/<(br|hr)[^>]*\/?>/gi, '\n');

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = decodeHtmlEntities(text);

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' '); // Collapse horizontal whitespace
  text = text.replace(/\n[ \t]+/g, '\n'); // Remove leading whitespace on lines
  text = text.replace(/[ \t]+\n/g, '\n'); // Remove trailing whitespace on lines
  text = text.replace(/\n{3,}/g, '\n\n'); // Collapse multiple newlines

  return text.trim();
}

/**
 * Convert HTML to Markdown (simplified conversion)
 * Preserves structure better than plain text
 */
function htmlToMarkdown(html: string): string {
  // Remove script and style elements
  let md = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  md = md.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove HTML comments
  md = md.replace(/<!--[\s\S]*?-->/g, '');

  // Headers
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  // Bold and italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, '*$2*');

  // Links
  md = md.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Images
  md = md.replace(
    /<img[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']+)["'][^>]*\/?>/gi,
    '![$2]($1)'
  );
  md = md.replace(/<img[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, '![]($1)');

  // Lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?[uo]l[^>]*>/gi, '\n');

  // Code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n');

  // Paragraphs and divs
  md = md.replace(/<\/(p|div)[^>]*>/gi, '\n\n');

  // Line breaks
  md = md.replace(/<br[^>]*\/?>/gi, '\n');
  md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n');

  // Remove remaining tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = decodeHtmlEntities(md);

  // Clean up whitespace
  md = md.replace(/[ \t]+/g, ' ');
  md = md.replace(/\n[ \t]+/g, '\n');
  md = md.replace(/[ \t]+\n/g, '\n');
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&copy;': '(c)',
    '&reg;': '(R)',
    '&trade;': '(TM)',
    '&ndash;': '-',
    '&mdash;': '--',
    '&lsquo;': "'",
    '&rsquo;': "'",
    '&ldquo;': '"',
    '&rdquo;': '"',
    '&bull;': '*',
    '&hellip;': '...',
  };

  let result = text;
  for (const [entity, replacement] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'gi'), replacement);
  }

  // Decode numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 10))
  );
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) =>
    String.fromCharCode(parseInt(code, 16))
  );

  return result;
}

// =============================================================================
// Combined Registration
// =============================================================================

/**
 * Register all web-related tools
 */
export function registerWebTools(registry: ToolRegistry): void {
  registerWebSearchTool(registry);
  registerWebFetchTool(registry);
}
