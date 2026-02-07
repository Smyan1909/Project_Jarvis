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
const MAX_PANEL_HEIGHT = SCREEN_HEIGHT * 0.60; // 60% of screen (maximum)
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

    // Calculate required height based on transcription length
    const calculateRequiredHeight = useCallback((text: string) => {
      if (!text) return MIN_PANEL_HEIGHT;
      
      const charsPerLine = 35; // Slightly fewer chars accounting for padding
      const lineHeight = 22; // Line height for body text
      const numLines = Math.ceil(text.length / charsPerLine);
      const textHeight = Math.max(60, numLines * lineHeight); // Minimum text area height
      
      const dragHandleHeight = 50;
      const boxPadding = 32; // padding inside the box
      const micButtonArea = 120; // mic button + status text + margins
      const containerPadding = 40; // horizontal and bottom padding
      
      const requiredHeight = dragHandleHeight + textHeight + boxPadding + micButtonArea + containerPadding;
      
      return Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, requiredHeight));
    }, []);

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

    // Effect to auto-resize when transcription changes
    React.useEffect(() => {
      if (panelState !== 'collapsed' && !isResizing) {
        const newHeight = calculateRequiredHeight(transcription);
        // Only update if height changed significantly (avoid jitter)
        if (Math.abs(newHeight - panelHeight) > 10) {
          setPanelHeight(newHeight);
          // Snap instantly to new height without animation for responsiveness
          translateY.setValue(0); 
        }
      }
    }, [transcription, panelState, calculateRequiredHeight, panelHeight, isResizing, translateY]);

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
      // Stop any ongoing recording - Unconditionally to ensure safety
      stopListening();
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

    // Toggle recording - tap once to start, tap again to stop (keeps panel open)
    const handleMicPress = useCallback(async () => {
      if (panelState === 'recording' || isListening) {
        // Currently recording - stop and show confirm/cancel options
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

    // Track state in refs for PanResponder to avoid stale closures
    const panelHeightRef = useRef(panelHeight);
    const panelStateRef = useRef(panelState);
    const initialHeightRef = useRef(panelHeight);

    // Keep refs in sync
    React.useEffect(() => {
      panelHeightRef.current = panelHeight;
    }, [panelHeight]);

    React.useEffect(() => {
      panelStateRef.current = panelState;
    }, [panelState]);

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
          initialHeightRef.current = panelHeightRef.current;
          
          // Check if we're in resize zone when expanded
          if (panelStateRef.current !== 'collapsed' && panelStateRef.current !== 'recording') {
            setIsResizing(isInResizeZone(evt));
            setTempHeight(panelHeightRef.current);
          }
        },
        onPanResponderMove: (evt, gestureState) => {
          const currentPanelState = panelStateRef.current;
          const startH = initialHeightRef.current;
          
          if (currentPanelState === 'collapsed') {
            // Dragging up to expand
            const newY = Math.max(0, startH + gestureState.dy);
            translateY.setValue(newY);
          } else if (currentPanelState !== 'recording') {
             // Unified Resize Logic: Dragging UP or DOWN resizes first
             // Calculate potential new height
             const potentialHeight = startH - gestureState.dy;
             
             if (potentialHeight >= MIN_PANEL_HEIGHT) {
               // Resize territory
               const clampedHeight = Math.min(MAX_PANEL_HEIGHT, potentialHeight);
               setTempHeight(clampedHeight);
               translateY.setValue(0); // Keep anchored at bottom
             } else {
               // Collapse territory (dragged below MIN height)
               setTempHeight(MIN_PANEL_HEIGHT);
               // The amount we dragged past the minimum
               const overshoot = MIN_PANEL_HEIGHT - potentialHeight;
               translateY.setValue(overshoot);
             }
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          const currentPanelState = panelStateRef.current;
          const startH = initialHeightRef.current;

          if (currentPanelState === 'collapsed') {
            if (gestureState.dy < -DRAG_THRESHOLD) {
              expand();
            } else {
              Animated.spring(translateY, {
                toValue: startH,
                useNativeDriver: true,
              }).start();
            }
          } else if (currentPanelState !== 'recording') {
            const potentialHeight = startH - gestureState.dy;
            
            if (potentialHeight < MIN_PANEL_HEIGHT && (MIN_PANEL_HEIGHT - potentialHeight) > DRAG_THRESHOLD) {
               // Dragged significantly below MIN height -> Close/Cancel
               handleCancel();
            } else {
              // Commit the new height (clamped)
              const newHeight = Math.min(
                MAX_PANEL_HEIGHT,
                Math.max(MIN_PANEL_HEIGHT, potentialHeight)
              );
              setPanelHeight(newHeight);
              setTempHeight(newHeight);
              
              // Snap back to 0 translation (in case we were slightly in collapse territory but not enough to close)
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

    // Debug: Log transcription value
    if (transcription) {
      console.log('[SpeechPanel] Current transcription:', transcription);
    }

    // Use tempHeight during resize for smooth feedback, otherwise use panelHeight
    const currentHeight = isResizing ? tempHeight : panelHeight;

    // Calculate transcription box height explicitly
    // Panel height - (drag handle + margins + padding + confirm buttons if visible)
    // Drag handle area: ~50px
    // Margins/Padding: ~40px
    // Confirm buttons: ~80px (only when confirming)
    const transcriptionBoxHeight = isConfirming
      ? currentHeight - 170
      : currentHeight - 90;

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
            {/* Transcription Box - Contains text AND mic overlay */}
            <View style={[
              styles.transcriptionOverlayContainer,
              { height: transcriptionBoxHeight },
              isConfirming && { borderWidth: 2, borderColor: theme.colors.primary }
            ]}>
              <ScrollView
                style={styles.transcriptionScrollView}
                contentContainerStyle={styles.transcriptionScrollContent}
                showsVerticalScrollIndicator={true}
              >
                {error ? (
                  <Text style={styles.errorText}>{error}</Text>
                ) : transcription && transcription.length > 0 ? (
                  <Text style={styles.transcriptionOverlayText}>{transcription}</Text>
                ) : isRecording ? (
                  <Text style={styles.placeholderTextOverlay}>Listening...</Text>
                ) : (
                  <Text style={styles.placeholderTextOverlay}>Tap the mic to speak</Text>
                )}
              </ScrollView>

              {/* Mic Button Overlay - Visible when idle or recording */}
              {!isConfirming && (
                <Pressable onPress={handleMicPress} disabled={false} style={styles.micButtonWrapper}>
                  <Animated.View
                    style={[
                      styles.micButton,
                      isRecording && styles.micButtonTransparent,
                      { transform: [{ scale: micScale }] },
                    ]}
                  >
                    <Ionicons
                      name="mic"
                      size={36}
                      color={theme.colors.text}
                    />
                  </Animated.View>
                </Pressable>
              )}
            </View>

            {/* Confirm/Cancel Buttons (only show when confirming) */}
            {isConfirming && (
              <View style={styles.buttonContainer}>
                {/* Cancel Button */}
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
                    size={36}
                    color={theme.colors.error}
                  />
                </Pressable>

                {/* Confirm Button */}
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
                    size={36}
                    color={theme.colors.textInverse}
                  />
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
    paddingBottom: theme.spacing.sm,
  },
  transcriptionOverlayContainer: {
    width: '100%',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.backgroundSecondary,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    overflow: 'hidden',
  },
  transcriptionScrollView: {
    flex: 1,
    width: '100%',
  },
  transcriptionScrollContent: {
    paddingBottom: 120, // Add padding at bottom to avoid mic overlap
    flexGrow: 1,
  },
  transcriptionOverlayText: {
    ...theme.typography.body,
    color: theme.colors.text,
    textAlign: 'left',
  },
  placeholderTextOverlay: {
    ...theme.typography.body,
    color: theme.colors.textTertiary,
    textAlign: 'left',
    fontStyle: 'italic',
  },
  micButtonWrapper: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  micButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.border,
    elevation: 4,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  micButtonTransparent: {
    opacity: 0.5,
  },
  waveformContainer: {
    height: 50,
    width: '100%',
    justifyContent: 'center',
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
