export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedDate?: string;
  score?: number;
};

export type WebSearchOptions = {
  maxResults?: number;
  signal?: AbortSignal;
};

export type WebSearchProvider = {
  search: (query: string, options?: WebSearchOptions) => Promise<WebSearchResult[]>;
  close?: () => Promise<void>;
};

export type WebResearchContext = {
  query: string;
  provider: string;
  createdAt: string;
  results: WebSearchResult[];
};
