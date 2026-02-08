import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

// Auth stack (unauthenticated)
export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
};

// Main tabs (authenticated)
export type MainTabParamList = {
  Chat: undefined;
  History: undefined;
  Settings: undefined;
};

// Root stack
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Conversation: { runId: string };
  SecretManagement: undefined;
  Integrations: undefined;
  ToolDetails: { toolId: string };
};

// Screen props helpers
export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type AuthStackScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type MainTabScreenProps<T extends keyof MainTabParamList> =
  BottomTabScreenProps<MainTabParamList, T>;

// Navigation prop for useNavigation hook
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
