// =============================================================================
// Polyfills - MUST be imported FIRST before any other imports
// =============================================================================
// React Native does not support ReadableStream/streaming fetch by default.
// These polyfills enable SSE streaming for the orchestrator API.

import { polyfill as polyfillReadableStream } from 'react-native-polyfill-globals/src/readable-stream';
import { polyfill as polyfillFetch } from 'react-native-polyfill-globals/src/fetch';
import { polyfill as polyfillEncoding } from 'react-native-polyfill-globals/src/encoding';

// Initialize polyfills before app loads
polyfillReadableStream();
polyfillEncoding();
polyfillFetch();

// =============================================================================
// App Entry Point
// =============================================================================

import { registerRootComponent } from "expo";
import App from "./src/App";

registerRootComponent(App);
