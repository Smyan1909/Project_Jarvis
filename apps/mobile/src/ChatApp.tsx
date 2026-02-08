import React, { useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from "react-native";

// Get screen height for dynamic bottom padding
const { height: screenHeight } = Dimensions.get("window");

export default function ChatApp() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState("");

  const sendMessage = () => {
    if (input.trim() === "") return;
    setMessages([input, ...messages]);
    setInput("");
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "padding"}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Project Jarvis Chat</Text>
      </View>

      <FlatList
        data={messages}
        inverted
        keyExtractor={(item, index) => index.toString()}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.messageWrapper,
              index % 2 === 0 ? styles.userMessage : styles.botMessage,
            ]}
          >
            <View
              style={[
                styles.message,
                index % 2 === 0 ? styles.userBubble : styles.botBubble,
              ]}
            >
              <Text style={styles.messageText}>{item}</Text>
            </View>
          </View>
        )}
        style={styles.chatContainer}
        contentContainerStyle={styles.chatContent}
      />

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."
          placeholderTextColor="#999"
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            pressed && styles.sendButtonPressed,
          ]}
          onPress={sendMessage}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </Pressable>
      </View>

      <StatusBar style="auto" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#B2E8E0",
    paddingTop: 0,
  },
  header: {
    backgroundColor: "#20B2AA",
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  chatContainer: {
    flex: 1,
  },
  chatContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  messageWrapper: {
    marginVertical: 6,
    paddingHorizontal: 8,
  },
  userMessage: {
    alignItems: "flex-end",
  },
  botMessage: {
    alignItems: "flex-start",
  },
  message: {
    maxWidth: "85%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  userBubble: {
    backgroundColor: "#20B2AA",
    borderBottomRightRadius: 4,
  },
  botBubble: {
    backgroundColor: "#ffffff",
    borderBottomLeftRadius: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  inputContainer: {
    flexDirection: "row",
    padding: 12,
    backgroundColor: "#B2E8E0",
    borderTopWidth: 1,
    borderColor: "#A0DCd6",
    alignItems: "center",
    paddingBottom: screenHeight * 0.07,
    gap: 10,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#20B2AA",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#ffffff",
    fontSize: 16,
    color: "#333",
  },
  sendButton: {
    backgroundColor: "#20B2AA",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 4,
  },
  sendButtonPressed: {
    backgroundColor: "#1a9a92",
    opacity: 0.9,
  },
  sendButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
