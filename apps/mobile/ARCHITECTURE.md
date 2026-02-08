# Project Jarvis Mobile - Week 1 Architecture Diagram

## Application Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         App.tsx                                 │
│                    (Entry Point)                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AppContainer.tsx                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  SafeAreaProvider                                       │   │
│  │  ├─ StatusBar Configuration                             │   │
│  │  └─ AuthProvider (Context)                              │   │
│  │     └─ RootNavigator                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Authentication Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                       RootNavigator                              │
└────────────────┬──────────────────────────────┬─────────────────┘
                 │                              │
         ┌───────▼────────┐          ┌──────────▼──────────┐
         │   isLoading?   │          │ isAuthenticated?   │
         └───────┬────────┘          └──────────┬─────────┘
                 │                               │
         ┌───────▼──────────────┐               │
         │  LoadingScreen       │               │
         │  (Token Check)       │               │
         └──────────────────────┘      ┌────────▼────────────┐
                                        │                    │
                              ┌─────────▼────────┐  ┌────────▼──────┐
                              │   AuthNavigator  │  │ MainNavigator │
                              │ ┌──────────────┐ │  │ ┌────────────┐│
                              │ │ LoginScreen  │ │  │ │ ChatScreen ││
                              │ │ SignupScreen │ │  │ ├────────────┤│
                              │ └──────────────┘ │  │ │HistoryScreen
                              └────────────────┘  │ ├────────────┤│
                                                  │ │Settings   ││
                                                  │ └────────────┘│
                                                  └────────────────┘
```

## State Management Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AuthContext                              │
│  (State: isAuthenticated, isLoading, user, error)          │
│  (Reducers: AUTH_START, AUTH_SUCCESS, AUTH_FAILURE, etc.)  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Actions:                                            │   │
│  │  • login(email, password)                           │   │
│  │  • register(email, password, displayName)           │   │
│  │  • logout()                                         │   │
│  │  • Token restoration on app load                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## API & Storage Layer

```
┌────────────────────────────────────────────────────────┐
│                  Services Layer                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │ api.ts (Axios Instance)                          │ │
│  │  • Request Interceptor (JWT header injection)    │ │
│  │  • Response Interceptor (Token refresh)          │ │
│  │                                                   │ │
│  │  APIs:                                            │ │
│  │  • authApi (login, register, logout)             │ │
│  │  • agentApi (startRun, getStatus, messages)      │ │
│  │  • secretsApi (list, create, update, delete)     │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │ websocket.ts (WebSocket Manager)                 │ │
│  │  • Connection management with auto-reconnect     │ │
│  │  • Event subscription system                     │ │
│  │  • Status tracking                               │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Token Storage (expo-secure-store)                │ │
│  │  • Secure token persistence                      │ │
│  │  • Token restoration on app load                 │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

## Design System

```
┌─────────────────────────────────────────────────────────┐
│                      Theme System                       │
│  (Centralized styling & design tokens)                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ colors.ts                                        │  │
│  │ • Primary: #007AFF (iOS Blue)                    │  │
│  │ • Text: Black, Secondary, Tertiary              │  │
│  │ • Chat bubbles: User (blue), Assistant (gray)   │  │
│  │ • Status: Success, Warning, Error, Info         │  │
│  │ • Light & Dark mode variants                    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ typography.ts                                    │  │
│  │ • Headings (h1, h2, h3)                         │  │
│  │ • Body text (regular, small)                    │  │
│  │ • Captions (regular, small)                     │  │
│  │ • Buttons (regular, small)                      │  │
│  │ • All with proper line heights & letter spacing │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ spacing.ts                                       │  │
│  │ • Scale: xs(4) → sm(8) → md(16) → lg(24) → ...  │  │
│  │ • Border radius: sm(4) → full(9999)             │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ index.ts                                         │  │
│  │ • Exports combined theme & darkTheme             │  │
│  │ • Type-safe theme object                        │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Hooks

```
┌──────────────────────────────────────────────┐
│ useAgentStream Hook                          │
│ (Real-time chat agent streaming)             │
├──────────────────────────────────────────────┤
│ State:                                       │
│  • messages (array)                          │
│  • isLoading (boolean)                       │
│  • error (string)                            │
│                                              │
│ Functions:                                   │
│  • sendMessage(content) - Start chat run     │
│  • cancelRun() - Cancel active run           │
│                                              │
│ Events handled:                              │
│  • agent.token (streaming tokens)            │
│  • agent.tool_call (tool execution)          │
│  • agent.tool_result (tool output)           │
│  • agent.final (final response)              │
│  • agent.error (error handling)              │
│  • agent.status (status updates)             │
└──────────────────────────────────────────────┘
```

## Directory Structure

```
apps/mobile/src/
├── App.tsx                          (Entry point)
├── AppContainer.tsx                 (Main container with providers)
├── config.ts                        (Environment config)
│
├── navigation/
│   ├── types.ts                    (Type definitions)
│   └── RootNavigator.tsx           (Navigation logic)
│
├── features/
│   └── auth/
│       └── AuthContext.tsx         (Auth state management)
│
├── screens/
│   ├── LoadingScreen.tsx           (Loading state)
│   ├── LoginScreen.tsx             (Placeholder)
│   ├── SignupScreen.tsx            (Placeholder)
│   ├── ChatScreen.tsx              (Placeholder)
│   ├── HistoryScreen.tsx           (Placeholder)
│   ├── SettingsScreen.tsx          (Placeholder)
│   ├── ConversationScreen.tsx      (Placeholder)
│   └── SecretManagementScreen.tsx  (Placeholder)
│
├── services/
│   ├── api.ts                      (Axios + token management)
│   └── websocket.ts                (WebSocket manager)
│
├── hooks/
│   └── useAgentStream.ts           (Chat streaming hook)
│
└── theme/
    ├── colors.ts                   (Color palette)
    ├── typography.ts               (Typography system)
    ├── spacing.ts                  (Spacing & border radius)
    └── index.ts                    (Theme exports)
```

## Data Flow Example: User Login

```
User Input (Email/Password)
         │
         ▼
    LoginScreen (Week 2)
         │
         ▼
    useAuth().login(email, password)
         │
         ▼
    authApi.login() → axios
         │
         ▼
    API_URL/v1/auth/login
         │
         ▼
    Response: { accessToken, refreshToken }
         │
         ▼
    SecureStore (expo-secure-store)
         │
         ▼
    AuthContext dispatch AUTH_SUCCESS
         │
         ▼
    isAuthenticated = true
         │
         ▼
    RootNavigator shows MainNavigator
         │
         ▼
    Bottom tabs visible (Chat, History, Settings)
```

## WebSocket Connection Flow

```
App Launch
    │
    ▼
useAgentStream hook mounts
    │
    ▼
wsManager.connect()
    │
    ├─ Retrieve access token
    │
    ├─ Create WebSocket connection to WS_URL
    │
    ├─ Send { type: 'auth', token }
    │
    ▼
Server responds with auth.success/auth.error
    │
    ├─ On success: status = 'connected'
    │
    ├─ On error: status = 'error'
    │
    └─ Auto-reconnect with exponential backoff
```

## Features Ready for Week 2

✓ Navigation structure fully set up
✓ Authentication context ready for implementation
✓ Token management and secure storage implemented
✓ API client with interceptors ready
✓ WebSocket streaming foundation ready
✓ Design system centralized and reusable
✓ All screen placeholders in place
✓ Loading state visualization
✓ Type-safe navigation throughout
