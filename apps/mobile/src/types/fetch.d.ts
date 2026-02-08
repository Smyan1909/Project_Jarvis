// =============================================================================
// Fetch Type Extensions
// =============================================================================
// Type declarations for react-native-fetch-api polyfill options.

declare global {
  interface RequestInit {
    /**
     * React Native specific fetch options from react-native-fetch-api polyfill.
     * @see https://github.com/react-native-community/fetch
     */
    reactNative?: {
      /**
       * Enable text streaming support for SSE responses.
       * When true, response.body will be a ReadableStream.
       */
      textStreaming?: boolean;
    };
  }
}

export {};
