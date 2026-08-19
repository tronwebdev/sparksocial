import type { Trend, TrendSource } from '../trend.js';
import { timedFetch, clamp01 } from './http.js';

/**
 * PRODUCT HUNT — API v2 (GraphQL), OAuth client-credentials grant. Free —
 * Product Hunt's developer API has no paid tier for this kind of read-only
 * access. Strong fit for `b2b_saas`/product-launch-shaped genomes.
 *
 * Same proxy/no-fabrication rules as every other source here. Product Hunt's
 * own `createdAt` plus `votesCount` stand in for age and score the same way
 * Reddit's `created_utc`/`score` do.
 */

export interface ProductHuntTrendSourceConfig {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

interface ProductHuntTokenResponse {
  access_token: string;
  expires_in: number;
}

interface ProductHuntPostNode {
  id: string;
  name: string;
  tagline: string;
  votesCount: number;
  commentsCount: number;
  createdAt: string;
  url: string;
  website?: string | null;
  topics: { edges: Array<{ node: { name: string } }> };
}

interface ProductHuntGraphQLResponse {
  data?: { posts: { edges: Array<{ node: ProductHuntPostNode }> } };
  errors?: Array<{ message: string }>;
}

const QUERY = `
  query TrendingPosts($first: Int!) {
    posts(order: RANKING, first: $first) {
      edges {
        node {
          id
          name
          tagline
          votesCount
          commentsCount
          createdAt
          url
          website
          topics { edges { node { name } } }
        }
      }
    }
  }
`;

export function createProductHuntTrendSource(config: ProductHuntTrendSourceConfig): TrendSource {
  const fetchImpl = config.fetchImpl ?? fetch;
  let cachedToken: { accessToken: string; expiresAt: number } | null = null;

  async function getAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.accessToken;
    const res = await timedFetch(
      'https://api.producthunt.com/v2/oauth/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'client_credentials',
        }),
      },
      fetchImpl,
    );
    if (!res.ok) throw new Error(`Product Hunt OAuth token request failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as ProductHuntTokenResponse;
    cachedToken = { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cachedToken.accessToken;
  }

  return {
    name: 'producthunt',

    async fetch({ limit }) {
      const token = await getAccessToken();
      const res = await timedFetch(
        'https://api.producthunt.com/v2/api/graphql',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: QUERY, variables: { first: Math.min(50, limit) } }),
        },
        fetchImpl,
      );
      if (!res.ok) throw new Error(`Product Hunt GraphQL request failed: ${res.status} ${res.statusText}`);
      const body = (await res.json()) as ProductHuntGraphQLResponse;
      if (body.errors?.length) throw new Error(`Product Hunt GraphQL error: ${body.errors[0]!.message}`);
      return (body.data?.posts.edges ?? []).map((e) => toTrend(e.node));
    },
  };
}

function toTrend(post: ProductHuntPostNode): Trend {
  const ageHours = Math.max(0.1, (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000);
  const velocity = clamp01(Math.log10(1 + post.votesCount / ageHours) / 3);
  // Launches are a 24h news cycle by design (Product Hunt's own "day" ranking) — a real, product-specific saturation proxy, not a generic guess.
  const saturation = clamp01(ageHours / 24);

  return {
    id: post.id,
    source: 'producthunt',
    topic: `${post.name} — ${post.tagline}`,
    tags: post.topics.edges.map((e) => e.node.name),
    metrics: {
      volume: post.votesCount + post.commentsCount,
      velocity,
      saturation,
      growth: 0,
    },
    samples: [{ url: post.url, caption: post.tagline }],
    language: 'en',
  };
}
