// Fetch a URL and reduce it to plain text. We intentionally avoid jsdom /
// readability to keep the dep graph small — Claude is robust enough to parse
// noisy menu pages once script/style/comments are dropped.
import { fetchWithTimeout, HttpError, withRetry } from "./net";

export async function fetchUrlAsText(url: string): Promise<string> {
  const html = await withRetry(
    async () => {
      const res = await fetchWithTimeout(url, {
        method: "GET",
        timeoutMs: 15_000,
        label: `fetchUrl(${url})`,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "PathwayRfpBot/0.1 (+https://workwithpathway.com)",
        },
      });
      if (!res.ok) {
        throw new HttpError(`fetchUrl(${url})`, res.status, await safeBody(res));
      }
      return await res.text();
    },
    { attempts: 2, baseMs: 400, label: `fetchUrl(${url})` },
  );
  return stripHtml(html);
}

async function safeBody(res: Response): Promise<string | undefined> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return undefined;
  }
}

export function stripHtml(html: string): string {
  let s = html;
  // Drop entire noise blocks before generic tag stripping. Order matters:
  // these regexes are non-greedy so they only eat their own block.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  s = s.replace(/<picture[\s\S]*?<\/picture>/gi, " ");
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  s = s.replace(/<header[\s\S]*?<\/header>/gi, " ");
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  s = s.replace(/<aside[\s\S]*?<\/aside>/gi, " ");
  s = s.replace(/<form[\s\S]*?<\/form>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\/(p|div|li|tr|h\d|br)>/gi, "\n");
  s = s.replace(/<br\s*\/?>(\s)*/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/gi, " ");
  s = s.replace(/&amp;/gi, "&");
  s = s.replace(/&lt;/gi, "<");
  s = s.replace(/&gt;/gi, ">");
  s = s.replace(/&#39;/gi, "'");
  s = s.replace(/&quot;/gi, '"');
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n[ \t]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
