import React, { useState, useRef } from "react";
import { View, StyleSheet, PanResponder } from "react-native";
import ChatApp from "./ChatApp";
import App2 from "./App2";

export default function AppContainer() {
  const [currentScreen, setCurrentScreen] = useState(0); // 0: Chat, 1: Smile Canvas

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { dx } = gestureState;
        // Only activate if there's horizontal movement > 10 pixels
        return Math.abs(dx) > 10;
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dx } = gestureState;
        // Swipe left (negative dx) to go to Smile Canvas
        if (dx < -50) {
          setCurrentScreen(1);
        }
        // Swipe right (positive dx) to go back to Chat
        if (dx > 50) {
          setCurrentScreen(0);
        }
      },
    })
  ).current;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {currentScreen === 0 ? <ChatApp /> : <App2 />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
