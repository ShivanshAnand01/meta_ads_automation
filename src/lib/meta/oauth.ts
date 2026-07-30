const GRAPH_API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export function getOAuthUrl(
  appId: string,
  redirectUri: string,
  scopes: string[]
): string {
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(','),
  })
  return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`
}

export async function exchangeCodeForToken(
  code: string,
  appId: string,
  appSecret: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  })

  const response = await fetch(
    `${BASE_URL}/oauth/access_token?${params.toString()}`
  )
  const data = await response.json()

  if (data.error) {
    throw new Error(data.error.message)
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  }
}

export async function getLongLivedToken(
  shortLivedToken: string,
  appId: string,
  appSecret: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  })

  const response = await fetch(
    `${BASE_URL}/oauth/access_token?${params.toString()}`
  )
  const data = await response.json()

  if (data.error) {
    throw new Error(data.error.message)
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  }
}

export const META_REQUIRED_SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_read_engagement',
  'pages_manage_ads',
  'read_insights',
]
