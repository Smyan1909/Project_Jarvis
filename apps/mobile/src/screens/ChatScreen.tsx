// =============================================================================
// Chat Screen
// =============================================================================
// Main chat interface with Jarvis AI assistant.

import React, { useState, useRef, useCallback, useEffect } from 'react';
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
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useAgentStream } from '../hooks/useAgentStream';
import { useTextToSpeech } from '../hooks/useTextToSpeech';
import { useTaskObservabilityContext } from '../features/observability/TaskObservabilityContext';
import { SpeechPanel, SpeechPanelRef } from '../components/SpeechPanel';
import { TaskObservabilityPanel } from '../components/TaskObservabilityPanel';
import { colors } from '../theme/colors';
import { DEMO_MODE, SPEECH_CONFIG } from '../config';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// =============================================================================
// Types
// =============================================================================

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function ChatScreen() {
  const [input, setInput] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(SPEECH_CONFIG.autoPlayResponses);
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);
  const [showObservabilityPanel, setShowObservabilityPanel] = useState(false);

  const { messages, isLoading, error, sendMessage } = useAgentStream();
  const { isSpeaking, speak, stop: stopSpeaking, error: ttsError } = useTextToSpeech();
  const { state: observabilityState } = useTaskObservabilityContext();

  const flatListRef = useRef<FlatList>(null);
  const speechPanelRef = useRef<SpeechPanelRef>(null);
  const panelTranslateX = useRef(new Animated.Value(SCREEN_WIDTH * 0.85)).current;
  const insets = useSafeAreaInsets();

  // Clear currentlyPlayingId when audio finishes
  useEffect(() => {
    if (!isSpeaking && currentlyPlayingId) {
      setCurrentlyPlayingId(null);
    }
  }, [isSpeaking, currentlyPlayingId]);

  // Toggle speech panel
  const toggleSpeechPanel = useCallback(() => {
    if (speechPanelRef.current?.isOpen()) {
      speechPanelRef.current.close();
    } else {
      speechPanelRef.current?.open();
    }
  }, []);

  // Toggle observability panel
  const openObservabilityPanel = useCallback(() => {
    setShowObservabilityPanel(true);
    Animated.spring(panelTranslateX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [panelTranslateX]);

  const closeObservabilityPanel = useCallback(() => {
    Animated.spring(panelTranslateX, {
      toValue: SCREEN_WIDTH * 0.85,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start(() => {
      setShowObservabilityPanel(false);
    });
  }, [panelTranslateX]);

  // Swipe gesture to open panel
  const swipeGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (event.translationX < -50 && !showObservabilityPanel) {
        openObservabilityPanel();
      }
    })
    .activeOffsetX([-20, 20]);

  // Send message and trigger TTS immediately when response arrives
  const handleSend = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading) return;

    // Stop any ongoing TTS before sending new message
    if (isSpeaking) {
      stopSpeaking();
      setCurrentlyPlayingId(null);
    }

    setInput('');

    // Pass TTS callback - will be called immediately when response is ready
    await sendMessage(trimmedInput, (responseText, messageId) => {
      if (ttsEnabled) {
        setCurrentlyPlayingId(messageId);
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
    setInput((prev) => (prev.trim() ? `${prev} ${text}` : text));
  }, []);

  const handleTranscriptionCancelled = useCallback(() => {
    // Nothing to do - transcription was discarded
  }, []);

  const handlePlayMessage = useCallback(
    (messageId: string, content: string) => {
      // If this message is already playing, stop it
      if (currentlyPlayingId === messageId) {
        if (isSpeaking) {
          stopSpeaking();
        }
        setCurrentlyPlayingId(null);
        return;
      }

      // Stop any other playing message and start this one
      if (isSpeaking) {
        stopSpeaking();
      }
      setCurrentlyPlayingId(messageId);
      speak(content);
    },
    [currentlyPlayingId, isSpeaking, stopSpeaking, speak]
  );

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    const isStreaming = item.isStreaming && !item.content;
    const canPlay = !isUser && !isStreaming && item.content;
    const isThisMessagePlaying = currentlyPlayingId === item.id && isSpeaking;

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
              <ActivityIndicator size="small" color={colors.textTertiary} />
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
            onPress={() => handlePlayMessage(item.id, item.content)}
            hitSlop={8}
          >
            <Ionicons
              name={isThisMessagePlaying ? 'stop-circle-outline' : 'play-circle-outline'}
              size={20}
              color={colors.textTertiary}
            />
          </Pressable>
        )}
      </View>
    );
  };

  // Check if orchestrator is active
  const isOrchestratorActive = observabilityState.status !== 'idle';

  return (
    <GestureDetector gesture={swipeGesture}>
      <View style={styles.container}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          {/* Header */}
          <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
            <View style={styles.headerLeft}>
              <View style={styles.logoContainer}>
                <Ionicons name="hardware-chip" size={22} color={colors.primary} />
              </View>
              <Text style={styles.headerTitle}>Jarvis</Text>
              {DEMO_MODE && (
                <View style={styles.demoBadge}>
                  <Text style={styles.demoBadgeText}>DEMO</Text>
                </View>
              )}
            </View>
            <View style={styles.headerRight}>
              {/* TTS Toggle Button */}
              <TouchableOpacity style={styles.headerButton} onPress={toggleTts}>
                <Ionicons
                  name={ttsEnabled ? 'volume-high' : 'volume-mute'}
                  size={22}
                  color={ttsEnabled ? colors.primary : colors.textTertiary}
                />
              </TouchableOpacity>
              {/* Observability Panel Button */}
              <TouchableOpacity
                style={styles.headerButton}
                onPress={openObservabilityPanel}
              >
                <Ionicons
                  name="stats-chart"
                  size={22}
                  color={isOrchestratorActive ? colors.primary : colors.textSecondary}
                />
                {isOrchestratorActive && (
                  <View style={styles.activeDot} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Error Banner */}
          {error && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={18} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* TTS Error Banner */}
          {ttsError && (
            <View style={[styles.errorBanner, styles.ttsErrorBanner]}>
              <Ionicons name="volume-mute" size={18} color={colors.warning} />
              <Text style={[styles.errorText, styles.ttsErrorText]}>TTS: {ttsError}</Text>
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
              messages.length === 0 && styles.emptyMessagesContent,
            ]}
            onContentSizeChange={() => {
              if (messages.length > 0) {
                flatListRef.current?.scrollToEnd({ animated: true });
              }
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyIconContainer}>
                  <Ionicons name="hardware-chip" size={48} color={colors.primary} />
                </View>
                <Text style={styles.emptyStateTitle}>Welcome to Jarvis</Text>
                <Text style={styles.emptyStateSubtitle}>
                  {DEMO_MODE
                    ? 'Try saying "Hello" or "What can you do?"'
                    : 'Start a conversation with your AI assistant'}
                </Text>
                <View style={styles.swipeHint}>
                  <Ionicons name="arrow-back" size={16} color={colors.textTertiary} />
                  <Text style={styles.swipeHintText}>Swipe left to view task monitor</Text>
                </View>
              </View>
            }
            showsVerticalScrollIndicator={false}
          />

          {/* Input Area */}
          <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 8 }]}>
            {/* Mic Button */}
            <TouchableOpacity
              style={styles.micButton}
              onPress={toggleSpeechPanel}
              activeOpacity={0.7}
            >
              <Ionicons name="mic" size={22} color={colors.primary} />
            </TouchableOpacity>

            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Message Jarvis..."
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={4000}
              editable={!isLoading}
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />

            <TouchableOpacity
              style={[
                styles.sendButton,
                (!input.trim() || isLoading) && styles.sendButtonDisabled,
              ]}
              onPress={handleSend}
              disabled={!input.trim() || isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <Ionicons name="send" size={18} color={colors.textInverse} />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        {/* Speech-to-Text Panel */}
        <SpeechPanel
          ref={speechPanelRef}
          onTranscriptionConfirmed={handleTranscriptionConfirmed}
          onTranscriptionCancelled={handleTranscriptionCancelled}
        />

        {/* Task Observability Panel */}
        <TaskObservabilityPanel
          visible={showObservabilityPanel}
          onClose={closeObservabilityPanel}
          translateX={panelTranslateX}
        />
      </View>
    </GestureDetector>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.background,
  },
  demoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.warning,
    borderRadius: 6,
  },
  demoBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textInverse,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.error}15`,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.error,
  },
  ttsErrorBanner: {
    backgroundColor: `${colors.warning}15`,
    borderBottomColor: colors.warning,
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    flex: 1,
  },
  ttsErrorText: {
    color: colors.warning,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyMessagesContent: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  emptyStateTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 32,
    gap: 6,
  },
  swipeHintText: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  messageWrapper: {
    marginVertical: 4,
    maxWidth: '85%',
  },
  userMessageWrapper: {
    alignSelf: 'flex-end',
  },
  assistantMessageWrapper: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  userBubble: {
    backgroundColor: colors.userBubble,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: colors.assistantBubble,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  userMessageText: {
    color: colors.userBubbleText,
  },
  assistantMessageText: {
    color: colors.assistantBubbleText,
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typingText: {
    fontSize: 13,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 12,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.backgroundSecondary,
    fontSize: 15,
    color: colors.text,
  },
  sendButton: {
    width: 44,
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.backgroundTertiary,
  },
  playButton: {
    marginTop: 4,
    alignSelf: 'flex-start',
    padding: 4,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
