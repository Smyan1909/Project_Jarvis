import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAgentStream } from '../hooks/useAgentStream';
import { useTextToSpeech } from '../hooks/useTextToSpeech';
import { SpeechPanel, SpeechPanelRef } from '../components/SpeechPanel';
import { theme } from '../theme';
import { DEMO_MODE, SPEECH_CONFIG } from '../config';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export function ChatScreen() {
  const [input, setInput] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(SPEECH_CONFIG.autoPlayResponses);
  const { messages, isLoading, error, sendMessage } = useAgentStream();
  const { isSpeaking, speak, stop: stopSpeaking, error: ttsError } = useTextToSpeech();
  const flatListRef = useRef<FlatList>(null);
  const speechPanelRef = useRef<SpeechPanelRef>(null);
  const insets = useSafeAreaInsets();

  // Toggle speech panel
  const toggleSpeechPanel = useCallback(() => {
    if (speechPanelRef.current?.isOpen()) {
      speechPanelRef.current.close();
    } else {
      speechPanelRef.current?.open();
    }
  }, []);

  // Send message and trigger TTS immediately when response arrives
  const handleSend = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading) return;

    // Stop any ongoing TTS before sending new message
    if (isSpeaking) {
      stopSpeaking();
    }

    setInput('');
    
    // Pass TTS callback - will be called immediately when response is ready
    await sendMessage(trimmedInput, (responseText) => {
      if (ttsEnabled) {
        speak(responseText);
      }
    });
  };

  const toggleTts = useCallback(() => {
    if (isSpeaking) {
      stopSpeaking();
    }
    setTtsEnabled((prev) => !prev);
  }, [isSpeaking, stopSpeaking]);

  const handleTranscriptionConfirmed = useCallback((text: string) => {
    // Append transcribed text to existing input (or replace if empty)
    setInput((prev) => (prev.trim() ? `${prev} ${text}` : text));
  }, []);

  const handleTranscriptionCancelled = useCallback(() => {
    // Nothing to do - transcription was discarded
  }, []);

  const handlePlayMessage = useCallback((content: string) => {
    if (isSpeaking) {
      stopSpeaking();
    }
    speak(content);
  }, [isSpeaking, stopSpeaking, speak]);

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    const isStreaming = item.isStreaming && !item.content;
    const canPlay = !isUser && !isStreaming && item.content;

    return (
      <View
        style={[
          styles.messageWrapper,
          isUser ? styles.userMessageWrapper : styles.assistantMessageWrapper,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            isUser ? styles.userBubble : styles.assistantBubble,
          ]}
        >
          {isStreaming ? (
            <View style={styles.typingIndicator}>
              <ActivityIndicator size="small" color={theme.colors.textTertiary} />
              <Text style={styles.typingText}>Jarvis is thinking...</Text>
            </View>
          ) : (
            <Text
              style={[
                styles.messageText,
                isUser ? styles.userMessageText : styles.assistantMessageText,
              ]}
            >
              {item.content}
            </Text>
          )}
        </View>
        {/* Play button for assistant messages */}
        {canPlay && (
          <Pressable
            style={styles.playButton}
            onPress={() => handlePlayMessage(item.content)}
            hitSlop={8}
          >
            <Ionicons
              name={isSpeaking ? 'stop-circle-outline' : 'play-circle-outline'}
              size={20}
              color={theme.colors.textTertiary}
            />
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Text style={styles.headerTitle}>Jarvis</Text>
        {DEMO_MODE && (
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>DEMO</Text>
          </View>
        )}
        {/* TTS Toggle Button */}
        <Pressable
          style={styles.ttsToggle}
          onPress={toggleTts}
          hitSlop={8}
        >
          <Ionicons
            name={ttsEnabled ? 'volume-high' : 'volume-mute'}
            size={22}
            color={ttsEnabled ? theme.colors.primary : theme.colors.textTertiary}
          />
        </Pressable>
      </View>

      {/* Error Banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* TTS Error Banner */}
      {ttsError && (
        <View style={[styles.errorBanner, styles.ttsErrorBanner]}>
          <Text style={styles.errorText}>TTS: {ttsError}</Text>
        </View>
      )}

      {/* Messages List */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        style={styles.messagesList}
        contentContainerStyle={[
          styles.messagesContent,
          messages.length === 0 ? styles.emptyMessagesContent : undefined,
        ]}
        onContentSizeChange={() => {
          // Auto-scroll to bottom when new messages arrive
          if (messages.length > 0) {
            flatListRef.current?.scrollToEnd({ animated: true });
          }
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateTitle}>Welcome to Jarvis</Text>
            <Text style={styles.emptyStateSubtitle}>
              {DEMO_MODE
                ? 'Try saying "Hello" or "What can you do?"'
                : 'Start a conversation with your AI assistant'}
            </Text>
          </View>
        }
      />

      {/* Input Area */}
      <View style={[styles.inputContainer, { paddingBottom: insets.bottom + theme.spacing.sm }]}>
        {/* Mic Button to open Speech Panel */}
        <Pressable
          style={({ pressed }) => [
            styles.micButton,
            pressed && styles.micButtonPressed,
          ]}
          onPress={toggleSpeechPanel}
          hitSlop={8}
        >
          <Ionicons
            name="mic"
            size={24}
            color={theme.colors.primary}
          />
        </Pressable>
        
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message Jarvis..."
          placeholderTextColor={theme.colors.textTertiary}
          multiline
          maxLength={4000}
          editable={!isLoading}
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            (!input.trim() || isLoading) ? styles.sendButtonDisabled : undefined,
            (pressed && input.trim() && !isLoading) ? styles.sendButtonPressed : undefined,
          ]}
          onPress={handleSend}
          disabled={!input.trim() || isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={theme.colors.textInverse} />
          ) : (
            <Text style={styles.sendButtonText}>Send</Text>
          )}
        </Pressable>
      </View>
      </KeyboardAvoidingView>

      {/* Speech-to-Text Panel */}
      <SpeechPanel
        ref={speechPanelRef}
        onTranscriptionConfirmed={handleTranscriptionConfirmed}
        onTranscriptionCancelled={handleTranscriptionCancelled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  headerTitle: {
    ...theme.typography.h3,
    color: theme.colors.text,
  },
  demoBadge: {
    marginLeft: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    backgroundColor: theme.colors.warning,
    borderRadius: theme.borderRadius.sm,
  },
  demoBadgeText: {
    ...theme.typography.captionSmall,
    color: theme.colors.textInverse,
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: theme.colors.error,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  ttsErrorBanner: {
    backgroundColor: theme.colors.warning,
  },
  errorText: {
    ...theme.typography.bodySmall,
    color: theme.colors.textInverse,
    textAlign: 'center',
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  emptyMessagesContent: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  emptyStateTitle: {
    ...theme.typography.h2,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  messageWrapper: {
    marginVertical: theme.spacing.xs,
    maxWidth: '85%',
  },
  userMessageWrapper: {
    alignSelf: 'flex-end',
  },
  assistantMessageWrapper: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.lg,
  },
  userBubble: {
    backgroundColor: theme.colors.userBubble,
    borderBottomRightRadius: theme.borderRadius.sm,
  },
  assistantBubble: {
    backgroundColor: theme.colors.assistantBubble,
    borderBottomLeftRadius: theme.borderRadius.sm,
  },
  messageText: {
    ...theme.typography.body,
  },
  userMessageText: {
    color: theme.colors.userBubbleText,
  },
  assistantMessageText: {
    color: theme.colors.assistantBubbleText,
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typingText: {
    ...theme.typography.bodySmall,
    color: theme.colors.textTertiary,
    marginLeft: theme.spacing.sm,
    fontStyle: 'italic',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderLight,
    gap: theme.spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.backgroundSecondary,
    ...theme.typography.body,
    color: theme.colors.text,
  },
  sendButton: {
    height: 44,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.textTertiary,
  },
  sendButtonPressed: {
    backgroundColor: theme.colors.primaryDark,
  },
  sendButtonText: {
    ...theme.typography.button,
    color: theme.colors.textInverse,
  },
  ttsToggle: {
    position: 'absolute',
    right: theme.spacing.md,
    padding: theme.spacing.xs,
  },
  playButton: {
    marginTop: theme.spacing.xs,
    alignSelf: 'flex-start',
    padding: theme.spacing.xs,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  micButtonPressed: {
    backgroundColor: theme.colors.primaryLight,
  },
});
