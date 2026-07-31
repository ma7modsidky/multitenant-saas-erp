export interface SearchResponse {
  query: string;
  results: Array<{
    moduleKey: string;
    labelKey: string;
    results: Array<{
      id: string;
      title: string;
      description?: string;
      href: string;
      icon?: string;
    }>;
  }>;
}
