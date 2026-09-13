export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchPort {
  search(query: string, limit: number): Promise<WebSearchResult[]>;
}
