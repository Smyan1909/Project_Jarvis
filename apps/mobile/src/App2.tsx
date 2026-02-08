import React from "react";
import { StyleSheet, View } from "react-native";

export default function App2() {
  return (
    <View style={styles.container}>
      <View style={styles.canvas}>
        {/* Face circle */}
        <View style={styles.face}>
          {/* Left eye */}
          <View style={[styles.eye, styles.leftEye]} />
          {/* Right eye */}
          <View style={[styles.eye, styles.rightEye]} />
          {/* Smile */}
          <View style={styles.mouth} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#B2E8E0",
    justifyContent: "center",
    alignItems: "center",
  },
  canvas: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#B2E8E0",
  },
  face: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "#FFD700",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  eye: {
    width: 20,
    height: 30,
    backgroundColor: "#333",
    borderRadius: 10,
    position: "absolute",
    top: 70,
  },
  leftEye: {
    left: 60,
  },
  rightEye: {
    right: 60,
  },
  mouth: {
    width: 60,
    height: 30,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    borderWidth: 3,
    borderColor: "#333",
    borderTopWidth: 0,
    position: "absolute",
    bottom: 50,
  },
});
