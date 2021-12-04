
export const CLIENT_TYPE = 'web';  // TODO: create an integration client type with read access
export const MATTER_API_VERSION = 'v11';
export const MATTER_API_DOMAIN = 'api.getmatter.app'
export const MATTER_API_HOST = `https://${MATTER_API_DOMAIN}/api/${MATTER_API_VERSION}`;
export const ENDPOINTS = {
  QR_LOGIN_TRIGGER: `${MATTER_API_HOST}/qr_login/trigger/`,
  QR_LOGIN_EXCHANGE: `${MATTER_API_HOST}/qr_login/exchange/`,
  REFRESH_TOKEN_EXCHANGE: `${MATTER_API_HOST}/token/refresh/`,
  HIGHLIGHTS_FEED: `${MATTER_API_HOST}/library_items/highlights_feed/`
}

export interface Annotation {
  created_date: string;
  note: string | null;
  text: string;
  word_start: number;
  word_end: number;
}

export interface Author {
  any_name: string | null;
}

export interface Content {
  author: Author;
  my_annotations: Annotation[];
  publication_date: string;
  title: string;
  url: string;
}

export interface FeedEntry {
  annotations: Annotation[];
  content: Content;
  feed_context: null;
  id: string;
  recommendations: any[];
}

export interface FeedResponse {
  current_profile: any;
  feed: FeedEntry[];
  id: string;
  next: string | null;
  previous: string | null;
}

export interface QRLoginExchangeResponse {
  access_token?: string | null;
  refresh_token?: string | null;
}

export const authedRequest = async(
  accessToken: string,
  url: string,
  fetchArgs: RequestInit = {},
) => {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Content-Type', 'application/json');

  const response = await fetch(url, {
    ...fetchArgs,
    headers,
  });
  return response.json()
}
