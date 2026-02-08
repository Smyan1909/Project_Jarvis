import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { theme } from '../theme';

interface WaveformBarProps {
  isActive: boolean;
  index: number;
  minHeight: number;
  maxHeight: number;
  barWidth: number;
  barSpacing: number;
  color: string;
}

function WaveformBar({
  isActive,
  index,
  minHeight,
  maxHeight,
  barWidth,
  barSpacing,
  color,
}: WaveformBarProps) {
  const heightAnim = useRef(new Animated.Value(minHeight)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isActive) {
      const randomDuration = 300 + Math.random() * 200;
      const targetHeight = maxHeight * (0.5 + Math.random() * 0.5);
      const lowHeight = minHeight + Math.random() * (maxHeight - minHeight) * 0.3;

      const animate = () => {
        animationRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(heightAnim, {
              toValue: targetHeight,
              duration: randomDuration,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: false,
            }),
            Animated.timing(heightAnim, {
              toValue: lowHeight,
              duration: randomDuration,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: false,
            }),
          ])
        );
        animationRef.current.start();
      };

      // Delay start based on index for wave effect
      const timeout = setTimeout(animate, index * 80);
      return () => {
        clearTimeout(timeout);
        animationRef.current?.stop();
      };
    } else {
      animationRef.current?.stop();
      Animated.timing(heightAnim, {
        toValue: minHeight,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  }, [isActive, minHeight, maxHeight, index]);

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          height: heightAnim,
          width: barWidth,
          marginHorizontal: barSpacing / 2,
          backgroundColor: color,
        },
      ]}
    />
  );
}

interface WaveformAnimationProps {
  isActive: boolean;
  barCount?: number;
  barWidth?: number;
  barSpacing?: number;
  minHeight?: number;
  maxHeight?: number;
  color?: string;
}

export function WaveformAnimation({
  isActive,
  barCount = 5,
  barWidth = 4,
  barSpacing = 3,
  minHeight = 8,
  maxHeight = 32,
  color = theme.colors.waveform,
}: WaveformAnimationProps) {
  return (
    <View style={styles.container}>
      {Array.from({ length: barCount }).map((_, index) => (
        <WaveformBar
          key={index}
          isActive={isActive}
          index={index}
          minHeight={minHeight}
          maxHeight={maxHeight}
          barWidth={barWidth}
          barSpacing={barSpacing}
          color={color}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
  },
  bar: {
    borderRadius: 2,
  },
});
