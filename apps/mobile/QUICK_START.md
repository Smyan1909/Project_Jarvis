# Project Jarvis Mobile - Developer Quick Reference

## Running the App

```bash
cd apps/mobile

# Start Expo development server
pnpm start

# Run on iOS simulator
pnpm ios

# Run on Android emulator
pnpm android
```

## Project Structure Quick Links

### Core Files
- `App.tsx` - Entry point
- `AppContainer.tsx` - Provider setup
- `config.ts` - Environment URLs

### Authentication
- `features/auth/AuthContext.tsx` - Auth state & hooks
- Use `useAuth()` hook in any component to access auth

### Navigation
- `navigation/types.ts` - Type definitions
- `navigation/RootNavigator.tsx` - Main navigation logic

### API & WebSocket
- `services/api.ts` - Axios instance + API methods
- `services/websocket.ts` - WebSocket manager
- `hooks/useAgentStream.ts` - Chat streaming hook

### Styling
- `theme/index.ts` - Main theme export
- `theme/colors.ts` - Color palette
- `theme/typography.ts` - Font styles
- `theme/spacing.ts` - Layout tokens

### Screens
- All in `screens/` directory
- Currently placeholders, ready for implementation

## Common Tasks

### Use Authentication in a Component
```typescript
import { useAuth } from '../features/auth/AuthContext';

export function MyScreen() {
  const { login, isLoading, error } = useAuth();

  return (
    <Button onPress={() => login(email, password)}>
      Sign In
    </Button>
  );
}
```

### Use Chat Streaming
```typescript
import { useAgentStream } from '../hooks/useAgentStream';

export function ChatScreen() {
  const { messages, sendMessage, isLoading } = useAgentStream();

  return (
    // Render messages...
  );
}
```

### Use Navigation
```typescript
import { useNavigation } from '@react-navigation/native';
import type { RootStackScreenProps } from '../navigation/types';

export function MyScreen() {
  const navigation = useNavigation<RootStackScreenProps<'Main'>['navigation']>();

  return (
    <Button
      onPress={() => navigation.navigate('Settings')}
    >
      Go to Settings
    </Button>
  );
}
```

### Use Theme in Components
```typescript
import { StyleSheet } from 'react-native';
import { theme } from '../theme';

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
  },
  title: {
    ...theme.typography.h1,
    color: theme.colors.text,
  },
});
```

### Make API Calls
```typescript
import { agentApi } from '../services/api';

// Start a chat run
const response = await agentApi.startRun('Hello!');
const runId = response.data.data.id;

// Get run status
const status = await agentApi.getRunStatus(runId);

// List runs
const runs = await agentApi.listRuns(20, 0);
```

## Type Safety

The app is fully typed with TypeScript. Key type files:
- `navigation/types.ts` - Navigation types
- All service functions are typed
- All API responses are typed
- Theme object is typed as `Theme`

## Environment Configuration

Set these in `.env.local` or platform-specific env files:
```
EXPO_PUBLIC_API_URL=http://localhost:3000/api
EXPO_PUBLIC_WS_URL=ws://localhost:3000/ws
```

## Authentication Flow

1. App launches → checks for stored token
2. If token exists → shows main app (LoadingScreen briefly)
3. If no token → shows auth screen
4. User logs in → token stored securely
5. Login/signup → AuthContext updates → navigation changes
6. Any 401 error → auto-refresh token
7. If refresh fails → user logged out

## What's Built

✅ Navigation with React Navigation v6
✅ Auth state management (useReducer)
✅ Token storage (expo-secure-store)
✅ API client with interceptors (axios)
✅ WebSocket real-time streaming
✅ Design system (colors, typography, spacing)
✅ Type-safe navigation
✅ 8 screen placeholders

## What's Missing (Week 2+)

⏳ Login screen UI
⏳ Signup screen UI
⏳ Chat interface
⏳ Message bubbles
⏳ Tool visualization
⏳ Settings interface

## Key Dependencies

- `@react-navigation/native` - Navigation
- `axios` - HTTP client
- `expo-secure-store` - Secure token storage
- `react-native-safe-area-context` - Safe area handling

## Debugging

### Check Auth State
```javascript
import { useAuth } from '../features/auth/AuthContext';

// In component:
const auth = useAuth();
console.log('Auth state:', auth);
```

### Check WebSocket Status
```javascript
import { wsManager } from '../services/websocket';

console.log('WS Status:', wsManager.getStatus());
```

### Check Navigation
Use React Navigation DevTools (available in dev)

## Common Patterns

### Loading State
```typescript
if (isLoading) {
  return <LoadingScreen />;
}
```

### Error Handling
```typescript
const [error, setError] = useState<string | null>(null);

try {
  await authApi.login(email, password);
} catch (err: any) {
  setError(err.message);
}
```

### Form Validation
```typescript
if (!email.includes('@')) {
  setError('Invalid email');
  return;
}
```

## Testing Checklist (Week 2)

- [ ] Can log in with valid credentials
- [ ] Can sign up with new account
- [ ] Token persists across app restarts
- [ ] 401 triggers token refresh
- [ ] WebSocket connects after login
- [ ] Can send chat messages
- [ ] Chat messages stream in real-time
- [ ] Can view chat history
- [ ] Can manage API keys
- [ ] Logout clears token

## Resources

- React Native Docs: https://reactnative.dev
- React Navigation: https://reactnavigation.org
- Expo: https://docs.expo.dev
- TypeScript: https://www.typescriptlang.org
- Project Guide: `/docs/FRONTEND_DEV.md`
- Architecture: `ARCHITECTURE.md` (in mobile directory)
