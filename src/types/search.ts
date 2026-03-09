export interface QuickSearchMatch {
  lineNumber: number;
  line: string;
}

export interface QuickSearchResult {
  workspaceName: string;
  title: string;
  lastModified: string;
  matches: QuickSearchMatch[];
}

export interface QuickSearchResponse {
  query: string;
  results: QuickSearchResult[];
  totalMatches: number;
}

export interface DeepSearchResult {
  workspaceName: string;
  title: string;
  excerpts: string[];
}

export interface DeepSearchResponse {
  query: string;
  results: DeepSearchResult[];
}
