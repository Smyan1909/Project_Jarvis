import React, { useState, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  ScrollView,
  Animated,
  PanResponder,
  Easing,
  GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSpeechToText } from '../hooks/useSpeechToText';
import { WaveformAnimation } from './WaveformAnimation';
import { theme } from '../theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MIN_PANEL_HEIGHT = SCREEN_HEIGHT * 0.30; // 30% of screen (minimum)
const MAX_PANEL_HEIGHT = SCREEN_HEIGHT * 0.50; // 50% of screen (maximum)
const DRAG_THRESHOLD = 50;
const RESIZE_ZONE_HEIGHT = 40; // Top area where dragging resizes instead of collapses

type PanelState = 'collapsed' | 'idle' | 'recording' | 'confirming';

interface SpeechPanelProps {
  onTranscriptionConfirmed: (text: string) => void;
  onTranscriptionCancelled: () => void;
}

export interface SpeechPanelRef {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

export const SpeechPanel = forwardRef<SpeechPanelRef, SpeechPanelProps>(
  function SpeechPanel(
    { onTranscriptionConfirmed, onTranscriptionCancelled },
    ref
  ) {
    const insets = useSafeAreaInsets();
    const [panelState, setPanelState] = useState<PanelState>('collapsed');
    const [panelHeight, setPanelHeight] = useState(MIN_PANEL_HEIGHT);
    const [tempHeight, setTempHeight] = useState(MIN_PANEL_HEIGHT);
    const [isResizing, setIsResizing] = useState(false);

    const {
      isListening,
      transcription,
      error,
      provider,
      startListening,
      stopListening,
      resetTranscription,
    } = useSpeechToText();

    // Animation values
    const translateY = useRef(new Animated.Value(MIN_PANEL_HEIGHT)).current;
    const micScale = useRef(new Animated.Value(1)).current;
    const pulseAnimation = useRef<Animated.CompositeAnimation | null>(null);

    // Track starting position for resize
    const startY = useRef(0);

    const expand = useCallback(() => {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
      }).start();
      setPanelState('idle');
    }, [translateY]);

    const collapse = useCallback(() => {
      Animated.spring(translateY, {
        toValue: panelHeight,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
      }).start();
      setPanelState('collapsed');
      resetTranscription();
      // Stop any ongoing recording
      if (isListening) {
        stopListening();
      }
      // Stop pulse animation
      pulseAnimation.current?.stop();
      micScale.setValue(1);
    }, [resetTranscription, panelHeight, translateY, isListening, stopListening, micScale]);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      open: expand,
      close: collapse,
      isOpen: () => panelState !== 'collapsed',
    }), [expand, collapse, panelState]);

    const handleConfirm = useCallback(() => {
      if (transcription.trim()) {
        onTranscriptionConfirmed(transcription.trim());
      }
      collapse();
    }, [transcription, onTranscriptionConfirmed, collapse]);

    const handleCancel = useCallback(() => {
      onTranscriptionCancelled();
      collapse();
    }, [onTranscriptionCancelled, collapse]);

    // Start pulse animation
    const startPulse = useCallback(() => {
      pulseAnimation.current = Animated.loop(
        Animated.sequence([
          Animated.timing(micScale, {
            toValue: 1.1,
            duration: 500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(micScale, {
            toValue: 1.0,
            duration: 500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimation.current.start();
    }, [micScale]);

    // Stop pulse animation
    const stopPulse = useCallback(() => {
      pulseAnimation.current?.stop();
      Animated.timing(micScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }, [micScale]);

    // Toggle recording - tap once to start, tap again to stop
    const handleMicPress = useCallback(async () => {
      if (panelState === 'recording' || isListening) {
        // Currently recording - stop and go to confirming
        await stopListening();
        stopPulse();
        setPanelState('confirming');
      } else if (panelState === 'idle' || panelState === 'confirming') {
        // Not recording - start recording
        resetTranscription();
        setPanelState('recording');
        startPulse();
        await startListening();
      }
    }, [panelState, isListening, startListening, stopListening, startPulse, stopPulse, resetTranscription]);

    // Determine if touch started in resize zone (drag handle area)
    const isInResizeZone = useCallback((evt: GestureResponderEvent) => {
      const locationY = evt.nativeEvent.locationY;
      return locationY < RESIZE_ZONE_HEIGHT;
    }, []);

    // Pan responder for drag gesture (expand/collapse and resize)
    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 5;
        },
        onPanResponderGrant: (evt) => {
          startY.current = evt.nativeEvent.pageY;
          // Check if we're in resize zone when expanded
          if (panelState !== 'collapsed' && panelState !== 'recording') {
            setIsResizing(isInResizeZone(evt));
            setTempHeight(panelHeight);
          }
        },
        onPanResponderMove: (evt, gestureState) => {
          if (panelState === 'collapsed') {
            // Dragging up to expand
            const newY = Math.max(0, panelHeight + gestureState.dy);
            translateY.setValue(newY);
          } else if (panelState !== 'recording') {
            if (isResizing || gestureState.dy < 0) {
              // Resizing - dragging up makes panel taller
              const newHeight = Math.min(
                MAX_PANEL_HEIGHT,
                Math.max(MIN_PANEL_HEIGHT, panelHeight - gestureState.dy)
              );
              setTempHeight(newHeight);
            } else {
              // Dragging down to collapse
              const newY = Math.max(0, gestureState.dy);
              translateY.setValue(newY);
            }
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (panelState === 'collapsed') {
            if (gestureState.dy < -DRAG_THRESHOLD) {
              expand();
            } else {
              Animated.spring(translateY, {
                toValue: panelHeight,
                useNativeDriver: true,
              }).start();
            }
          } else if (panelState !== 'recording') {
            if (isResizing || gestureState.dy < -DRAG_THRESHOLD) {
              // Commit the new height
              const newHeight = Math.min(
                MAX_PANEL_HEIGHT,
                Math.max(MIN_PANEL_HEIGHT, panelHeight - gestureState.dy)
              );
              setPanelHeight(newHeight);
              setTempHeight(newHeight);
            } else if (gestureState.dy > DRAG_THRESHOLD) {
              handleCancel();
            } else {
              Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: true,
              }).start();
            }
          }
          setIsResizing(false);
        },
      })
    ).current;

    const isExpanded = panelState !== 'collapsed';
    const isRecording = panelState === 'recording' || isListening;
    const isConfirming = panelState === 'confirming';

    // Use tempHeight during resize for smooth feedback, otherwise use panelHeight
    const currentHeight = isResizing ? tempHeight : panelHeight;

    return (
      <Animated.View
        style={[
          styles.container,
          {
            paddingBottom: insets.bottom,
            transform: [{ translateY }],
            height: currentHeight,
          },
        ]}
        {...panResponder.panHandlers}
      >
        {/* Drag Handle */}
        <View style={styles.dragHandleContainer}>
          <View style={styles.dragHandle} />
          {/* Resize indicator - shows when expanded */}
          {isExpanded && (
            <Text style={styles.resizeHint}>Drag to resize</Text>
          )}
          {/* Provider Badge (only visible when expanded) */}
          {isExpanded && (
            <View style={styles.providerBadge}>
              <Text style={styles.providerBadgeText}>
                {provider === 'native' ? 'Device' : 'ElevenLabs'}
              </Text>
            </View>
          )}
        </View>

        {isExpanded && (
          <View style={styles.content}>
            {/* Mic Button - Tap to toggle recording */}
            <Pressable onPress={handleMicPress} disabled={false}>
              <Animated.View
                style={[
                  styles.micButton,
                  isRecording && styles.micButtonRecording,
                  { transform: [{ scale: micScale }] },
                ]}
              >
                <Ionicons
                  name={isRecording ? 'stop' : 'mic'}
                  size={36}
                  color={isRecording ? theme.colors.textInverse : theme.colors.text}
                />
              </Animated.View>
            </Pressable>

            {/* Recording status text */}
            <Text style={styles.statusText}>
              {isRecording ? 'Tap to stop' : 'Tap to speak'}
            </Text>

            {/* Waveform Animation */}
            <View style={styles.waveformContainer}>
              <WaveformAnimation
                isActive={isRecording}
                color={isRecording ? theme.colors.recording : theme.colors.waveform}
              />
            </View>

            {/* Transcription Display */}
            <ScrollView
              style={styles.transcriptionContainer}
              contentContainerStyle={styles.transcriptionContent}
            >
              {error ? (
                <Text style={styles.errorText}>{error}</Text>
              ) : transcription ? (
                <Text style={styles.transcriptionText}>{transcription}</Text>
              ) : isRecording ? (
                <Text style={styles.placeholderText}>Listening...</Text>
              ) : (
                <Text style={styles.placeholderText}>Tap the mic to speak</Text>
              )}
            </ScrollView>

            {/* Confirm/Cancel Buttons (only show when not recording and has transcription) */}
            {!isRecording && transcription.trim() && (
              <View style={styles.buttonContainer}>
                <Pressable
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.cancelButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={handleCancel}
                >
                  <Ionicons
                    name="close-circle"
                    size={24}
                    color={theme.colors.error}
                  />
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.confirmButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={handleConfirm}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={24}
                    color={theme.colors.textInverse}
                  />
                  <Text style={styles.confirmButtonText}>Confirm</Text>
                </Pressable>
              </View>
            )}

            {/* Show prompt to try again if no transcription after stopping */}
            {isConfirming && !transcription.trim() && !error && (
              <View style={styles.buttonContainer}>
                <Text style={styles.noSpeechText}>No speech detected</Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.cancelButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => setPanelState('idle')}
                >
                  <Ionicons
                    name="refresh"
                    size={24}
                    color={theme.colors.primary}
                  />
                  <Text style={[styles.cancelButtonText, { color: theme.colors.primary }]}>
                    Try Again
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </Animated.View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 10,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: theme.colors.borderLight,
    borderRadius: 2,
  },
  resizeHint: {
    ...theme.typography.captionSmall,
    color: theme.colors.textTertiary,
    marginTop: 4,
    opacity: 0.6,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  micButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.border,
  },
  micButtonRecording: {
    backgroundColor: theme.colors.recording,
    borderColor: theme.colors.recordingLight,
  },
  statusText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  waveformContainer: {
    height: 50,
    justifyContent: 'center',
    marginTop: theme.spacing.sm,
  },
  transcriptionContainer: {
    flex: 1,
    width: '100%',
    marginTop: theme.spacing.sm,
  },
  transcriptionContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  transcriptionText: {
    ...theme.typography.body,
    color: theme.colors.text,
    textAlign: 'center',
  },
  placeholderText: {
    ...theme.typography.body,
    color: theme.colors.textTertiary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  errorText: {
    ...theme.typography.body,
    color: theme.colors.error,
    textAlign: 'center',
  },
  noSpeechText: {
    ...theme.typography.body,
    color: theme.colors.textTertiary,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.borderRadius.lg,
    gap: theme.spacing.xs,
  },
  cancelButton: {
    backgroundColor: theme.colors.backgroundSecondary,
  },
  confirmButton: {
    backgroundColor: theme.colors.primary,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  cancelButtonText: {
    ...theme.typography.button,
    color: theme.colors.text,
  },
  confirmButtonText: {
    ...theme.typography.button,
    color: theme.colors.textInverse,
  },
  providerBadge: {
    position: 'absolute',
    right: theme.spacing.md,
    top: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    backgroundColor: theme.colors.backgroundTertiary,
    borderRadius: theme.borderRadius.sm,
  },
  providerBadgeText: {
    ...theme.typography.captionSmall,
    color: theme.colors.textTertiary,
  },
});
