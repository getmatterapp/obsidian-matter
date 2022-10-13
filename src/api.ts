export const CLIENT_TYPE = 'integration';
export const MATTER_API_VERSION = 'v11';
export const MATTER_API_DOMAIN = 'api.getmatter.app';
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

export interface ContentNote {
  note: string;
}

export interface Publisher {
  any_name: string | null;
}

export interface Tag {
  created_date: string;
  name: string;
}

export interface LibraryEntry {
  library_state: number;
}

export interface Content {
  author: Author;
  library: LibraryEntry | null;
  publisher: Publisher;
  my_annotations: Annotation[];
  my_note: ContentNote;
  publication_date: string;
  tags: Tag[];
  title: string;
  url: string;
}

export interface FeedEntry {
  annotations: Annotation[];
  content: Content;
  feed_context: null;
  id: string;
}

export interface FeedResponse {
  feed: FeedEntry[];
  id: string;
  next: string | null;
  previous: string | null;
}

export interface QRLoginExchangeResponse {
  access_token?: string | null;
  refresh_token?: string | null;
}

class RequestError extends Error {
  response: Response;

  public constructor(response: Response, message?: string,) {
    super(message);
    this.response = response;
  }
}

export async function authedRequest(
  accessToken: string,
  url: string,
  fetchArgs: RequestInit = {},
) {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Content-Type', 'application/json');

  const response = await fetch(url, {
    ...fetchArgs,
    headers,
  });

  if (!response.ok) {
    throw new RequestError(response, "Matter authenticated request failed");
  }

  return (await response.json());
}
