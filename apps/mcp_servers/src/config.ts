// =============================================================================
// Composio Integration Configuration
// =============================================================================
// Environment variables and supported toolkit definitions

// =============================================================================
// Supported Toolkits
// =============================================================================

/**
 * Mapping of friendly app names to Composio toolkit slugs.
 * These are the integrations users can connect via OAuth.
 */
export const SUPPORTED_TOOLKITS = {
  slack: {
    slug: 'SLACK',
    name: 'Slack',
    description: 'Team messaging and collaboration',
    hasComposioManagedAuth: true,
  },
  teams: {
    slug: 'MICROSOFT_TEAMS',
    name: 'Microsoft Teams',
    description: 'Microsoft collaboration platform',
    hasComposioManagedAuth: true,
  },
  github: {
    slug: 'GITHUB',
    name: 'GitHub',
    description: 'Code hosting and version control',
    hasComposioManagedAuth: true,
  },
  spotify: {
    slug: 'SPOTIFY',
    name: 'Spotify',
    description: 'Music streaming service',
    // Spotify requires custom OAuth app credentials - not auto-managed by Composio
    hasComposioManagedAuth: false,
  },
  'google-drive': {
    slug: 'GOOGLEDRIVE',
    name: 'Google Drive',
    description: 'Cloud file storage and sharing',
    hasComposioManagedAuth: true,
  },
  outlook: {
    slug: 'OUTLOOK',
    name: 'Outlook',
    description: 'Microsoft email and calendar',
    hasComposioManagedAuth: true,
  },
  'google-calendar': {
    slug: 'GOOGLECALENDAR',
    name: 'Google Calendar',
    description: 'Calendar and scheduling',
    hasComposioManagedAuth: true,
  },
  gmail: {
    slug: 'GMAIL',
    name: 'Gmail',
    description: 'Google email service',
    hasComposioManagedAuth: true,
  },
} as const;

/**
 * Array of all supported toolkit slugs
 */
export const ENABLED_TOOLKIT_SLUGS = Object.values(SUPPORTED_TOOLKITS).map(
  (t) => t.slug
);

/**
 * Array of toolkit slugs that have Composio-managed OAuth (can be auto-enabled)
 */
export const MANAGED_AUTH_TOOLKIT_SLUGS = Object.values(SUPPORTED_TOOLKITS)
  .filter((t) => t.hasComposioManagedAuth)
  .map((t) => t.slug);

/**
 * Type for supported app keys (friendly names)
 */
export type SupportedAppKey = keyof typeof SUPPORTED_TOOLKITS;

/**
 * Type for Composio toolkit slugs
 */
export type ToolkitSlug = (typeof SUPPORTED_TOOLKITS)[SupportedAppKey]['slug'];

// =============================================================================
// Environment Configuration
// =============================================================================

export interface ComposioEnvConfig {
  /** Composio API key from environment */
  apiKey: string;
  /** Deep link callback URL scheme for mobile OAuth redirects */
  callbackScheme: string;
}

/**
 * Load and validate environment configuration.
 * Throws if required environment variables are missing.
 */
export function loadEnvConfig(): ComposioEnvConfig {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error(
      'COMPOSIO_API_KEY environment variable is required but not set'
    );
  }

  const callbackScheme =
    process.env.COMPOSIO_CALLBACK_SCHEME ?? 'projectjarvis://oauth/callback';

  return {
    apiKey,
    callbackScheme,
  };
}

/**
 * Get toolkit info by app key or slug.
 * Returns undefined if not found.
 * Matching is case-insensitive for slugs.
 */
export function getToolkitInfo(keyOrSlug: string) {
  // Try as app key first (case-sensitive for keys like 'slack', 'github')
  if (keyOrSlug in SUPPORTED_TOOLKITS) {
    return SUPPORTED_TOOLKITS[keyOrSlug as SupportedAppKey];
  }

  // Try as slug (case-insensitive to handle 'GITHUB' or 'github')
  const upperSlug = keyOrSlug.toUpperCase();
  const entry = Object.values(SUPPORTED_TOOLKITS).find(
    (t) => t.slug.toUpperCase() === upperSlug
  );
  return entry;
}

/**
 * Check if a toolkit is supported
 */
export function isToolkitSupported(keyOrSlug: string): boolean {
  return getToolkitInfo(keyOrSlug) !== undefined;
}
