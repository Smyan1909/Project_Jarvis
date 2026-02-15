// =============================================================================
// Chat Screen
// =============================================================================
// Main chat interface with Jarvis AI assistant.

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
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
import Markdown from 'react-native-markdown-display';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useAgentStream } from '../hooks/useAgentStream';
import { useTextToSpeech } from '../hooks/useTextToSpeech';
import { useChatQueue } from '../hooks/useChatQueue';
import { useTaskObservabilityContext } from '../features/observability/TaskObservabilityContext';
import { SpeechPanel, SpeechPanelRef } from '../components/SpeechPanel';
import { TaskObservabilityPanel } from '../components/TaskObservabilityPanel';
import { colors } from '../theme/colors';
import { DEMO_MODE, SPEECH_CONFIG } from '../config';
import { logger } from '../utils/logger';

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
  logger.info('ChatScreen', 'ChatScreen component rendering');
  
  const [input, setInput] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(SPEECH_CONFIG.autoPlayResponses);
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);
  const [showObservabilityPanel, setShowObservabilityPanel] = useState(false);

  const { messages, isLoading, error, sendMessage } = useAgentStream();
  const { isSpeaking, speak, stop: stopSpeaking, error: ttsError } = useTextToSpeech();
  const { state: observabilityState } = useTaskObservabilityContext();

  // Chat queue for handling multiple messages
  const { queue, pendingCount, isProcessing, enqueue } = useChatQueue({
    processMessage: async (content: string) => {
      await sendMessage(content, (responseText, messageId) => {
        if (ttsEnabled) {
          setCurrentlyPlayingId(messageId);
          speak(responseText);
        }
      });
    },
  });

  const flatListRef = useRef<FlatList>(null);
  const speechPanelRef = useRef<SpeechPanelRef>(null);
  const panelTranslateX = useRef(new Animated.Value(SCREEN_WIDTH * 0.85)).current;
  const insets = useSafeAreaInsets();

  // Clear currentlyPlayingId when audio finishes
  useEffect(() => {
    if (!isSpeaking && currentlyPlayingId) {
      logger.debug('ChatScreen', 'Audio finished, clearing currentlyPlayingId');
      setCurrentlyPlayingId(null);
    }
  }, [isSpeaking, currentlyPlayingId]);

  // Log messages changes
  useEffect(() => {
    logger.debug('ChatScreen', `Messages updated: ${messages.length} total`);
  }, [messages]);

  // Log error changes
  useEffect(() => {
    if (error) {
      logger.error('ChatScreen', `Error state: ${error}`);
    }
  }, [error]);

  // Toggle speech panel
  const toggleSpeechPanel = useCallback(() => {
    const isOpen = speechPanelRef.current?.isOpen();
    logger.info('ChatScreen', `Toggling speech panel: ${isOpen ? 'closing' : 'opening'}`);
    if (isOpen) {
      speechPanelRef.current?.close();
    } else {
      speechPanelRef.current?.open();
    }
  }, []);

  // Toggle observability panel
  const openObservabilityPanel = useCallback(() => {
    logger.info('ChatScreen', 'Opening observability panel');
    setShowObservabilityPanel(true);
    Animated.spring(panelTranslateX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [panelTranslateX]);

  const closeObservabilityPanel = useCallback(() => {
    logger.info('ChatScreen', 'Closing observability panel');
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
      'worklet';
      if (event.translationX < -50 && !showObservabilityPanel) {
        runOnJS(openObservabilityPanel)();
      }
    })
    .activeOffsetX([-20, 20]);

  // Send message via queue - allows sending while previous messages are processing
  const handleSend = () => {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      logger.warn('ChatScreen', 'Attempted to send empty message');
      return;
    }

    logger.info('ChatScreen', `Sending message (length: ${trimmedInput.length})`);

    // Stop any ongoing TTS before sending new message
    if (isSpeaking) {
      logger.debug('ChatScreen', 'Stopping TTS before sending new message');
      stopSpeaking();
      setCurrentlyPlayingId(null);
    }

    setInput('');

    // Add to queue - will be processed sequentially
    enqueue(trimmedInput);
  };

  const toggleTts = useCallback(() => {
    logger.info('ChatScreen', `Toggling TTS: ${ttsEnabled ? 'disabling' : 'enabling'}`);
    if (isSpeaking) {
      stopSpeaking();
    }
    setTtsEnabled((prev) => !prev);
  }, [isSpeaking, stopSpeaking, ttsEnabled]);

  const handleTranscriptionConfirmed = useCallback((text: string) => {
    logger.info('ChatScreen', `Transcription confirmed (length: ${text.length})`);
    setInput((prev) => (prev.trim() ? `${prev} ${text}` : text));
  }, []);

  const handleTranscriptionCancelled = useCallback(() => {
    logger.info('ChatScreen', 'Transcription cancelled');
  }, []);

  const handlePlayMessage = useCallback(
    (messageId: string, content: string) => {
      logger.info('ChatScreen', `Play message requested: ${messageId}`);
      // If this message is already playing, stop it
      if (currentlyPlayingId === messageId) {
        logger.debug('ChatScreen', 'Message already playing, stopping');
        if (isSpeaking) {
          stopSpeaking();
        }
        setCurrentlyPlayingId(null);
        return;
      }

      // Stop any other playing message and start this one
      if (isSpeaking) {
        logger.debug('ChatScreen', 'Stopping current playback');
        stopSpeaking();
      }
      setCurrentlyPlayingId(messageId);
      logger.info('ChatScreen', `Speaking message: ${messageId} (length: ${content.length})`);
      speak(content);
    },
    [currentlyPlayingId, isSpeaking, stopSpeaking, speak]
  );

  // Markdown styles for assistant messages
  const markdownStyles = useMemo(() => ({
    body: {
      color: colors.assistantBubbleText,
      fontSize: 15,
      lineHeight: 22,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 8,
    },
    heading1: {
      fontSize: 20,
      fontWeight: '700' as const,
      color: colors.text,
      marginBottom: 8,
      marginTop: 12,
    },
    heading2: {
      fontSize: 18,
      fontWeight: '600' as const,
      color: colors.text,
      marginBottom: 6,
      marginTop: 10,
    },
    heading3: {
      fontSize: 16,
      fontWeight: '600' as const,
      color: colors.text,
      marginBottom: 4,
      marginTop: 8,
    },
    code_inline: {
      backgroundColor: colors.backgroundTertiary,
      color: colors.primary,
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 4,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
    },
    code_block: {
      backgroundColor: colors.backgroundTertiary,
      padding: 12,
      borderRadius: 8,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      color: colors.text,
      marginVertical: 8,
    },
    fence: {
      backgroundColor: colors.backgroundTertiary,
      padding: 12,
      borderRadius: 8,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      color: colors.text,
      marginVertical: 8,
    },
    blockquote: {
      backgroundColor: colors.backgroundSecondary,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      paddingLeft: 12,
      paddingVertical: 4,
      marginVertical: 8,
    },
    bullet_list: {
      marginVertical: 4,
    },
    ordered_list: {
      marginVertical: 4,
    },
    list_item: {
      marginVertical: 2,
    },
    link: {
      color: colors.primary,
      textDecorationLine: 'underline' as const,
    },
    strong: {
      fontWeight: '600' as const,
    },
    em: {
      fontStyle: 'italic' as const,
    },
  }), []);

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
              <Text style={styles.typingText}>Processing...</Text>
            </View>
          ) : isUser ? (
            <Text style={[styles.messageText, styles.userMessageText]}>
              {item.content}
            </Text>
          ) : item.content ? (
            <Markdown style={markdownStyles}>
              {item.content}
            </Markdown>
          ) : (
            <Text style={[styles.messageText, styles.assistantMessageText]}>
              ...
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

          {/* Queue Status Indicator */}
          {pendingCount > 0 && (
            <View style={styles.queueIndicator}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.queueText}>
                {isProcessing
                  ? pendingCount > 1
                    ? `Processing... (${pendingCount - 1} queued)`
                    : 'Processing...'
                  : `${pendingCount} message${pendingCount > 1 ? 's' : ''} queued`}
              </Text>
            </View>
          )}

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
              placeholder={pendingCount > 0 ? "Queue another message..." : "Message Jarvis..."}
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={4000}
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />

            <TouchableOpacity
              style={[
                styles.sendButton,
                !input.trim() && styles.sendButtonDisabled,
              ]}
              onPress={handleSend}
              disabled={!input.trim()}
              activeOpacity={0.8}
            >
              <Ionicons name="send" size={18} color={colors.textInverse} />
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
  queueIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: colors.backgroundSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  queueText: {
    fontSize: 13,
    color: colors.textSecondary,
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
