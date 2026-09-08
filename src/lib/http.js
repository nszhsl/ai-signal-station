export const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json, text/html;q=0.9, application/rss+xml;q=0.8, */*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
};

export async function fetchText(url, fetchImpl = globalThis.fetch) {
  const resp = await fetchImpl(url, { headers: DEFAULT_HEADERS });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${url}`);
  return resp.text();
}
