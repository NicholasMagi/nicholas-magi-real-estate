import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { respondToNova } from "@/features/nova/engine";
import type { NovaContext } from "@/features/nova/types";
import { theme } from "@/shared/theme";

type Message = {
  id: number;
  role: "assistant" | "user";
  text: string;
};

const QUICK_PROMPTS = [
  "Chi devo contattare per primo?",
  "Quali sono le mie priorità di oggi?",
  "Mostrami le schede incomplete",
  "Preparami una telefonata per un proprietario"
];

const INITIAL_MESSAGE =
  "Buongiorno. Sono NOVA, il Suo assistente operativo NMRE. Posso aiutarLa con le priorità, le opportunità e le attività commerciali. In questa versione mobile l'archivio non è ancora collegato.";

export function NovaScreen() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: "assistant", text: INITIAL_MESSAGE }
  ]);
  const [nextId, setNextId] = useState(2);

  // M3/M4 will replace this explicit disconnected state with the authenticated,
  // read-only repository context. No sample records or local PII are fabricated.
  const context = useMemo<NovaContext>(() => ({ status: "not_connected" }), []);

  function sendMessage(rawMessage: string) {
    const message = rawMessage.trim();
    if (!message || message.length > 1000) return;

    const reply = respondToNova(message, context);
    setMessages(current => [
      ...current,
      { id: nextId, role: "user", text: message },
      { id: nextId + 1, role: "assistant", text: reply.text }
    ]);
    setNextId(value => value + 2);
    setInput("");
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>✦</Text>
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>NMRE · INTELLIGENCE</Text>
              <Text style={styles.title}>NOVA</Text>
              <Text style={styles.subtitle}>Assistente operativo immobiliare</Text>
            </View>
            <View style={styles.modePill}>
              <View style={styles.modeDot} />
              <Text style={styles.modeText}>SENZA API AI</Text>
            </View>
          </View>
          <View style={styles.connectionNotice}>
            <View style={styles.connectionIcon}>
              <Text style={styles.connectionIconText}>i</Text>
            </View>
            <View style={styles.connectionCopy}>
              <Text style={styles.connectionTitle}>Archivio mobile non ancora collegato</Text>
              <Text style={styles.connectionBody}>
                NOVA è attiva. Per analizzare annunci, proprietari e richiami serve prima l&apos;accesso sicuro in sola lettura.
              </Text>
            </View>
          </View>
        </View>

        <ScrollView
          style={styles.conversation}
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {messages.map(message => (
            <View
              key={message.id}
              style={[
                styles.messageRow,
                message.role === "user" ? styles.userRow : styles.assistantRow
              ]}
            >
              {message.role === "assistant" ? (
                <View style={styles.assistantAvatar}>
                  <Text style={styles.assistantAvatarText}>✦</Text>
                </View>
              ) : null}
              <View
                style={[
                  styles.bubble,
                  message.role === "user" ? styles.userBubble : styles.assistantBubble
                ]}
              >
                <Text
                  style={[
                    styles.messageText,
                    message.role === "user" ? styles.userMessageText : styles.assistantMessageText
                  ]}
                >
                  {message.text}
                </Text>
              </View>
            </View>
          ))}

          <View style={styles.promptSection}>
            <Text style={styles.promptTitle}>PROVI A CHIEDERMI</Text>
            <View style={styles.promptList}>
              {QUICK_PROMPTS.map(prompt => (
                <Pressable
                  key={prompt}
                  accessibilityRole="button"
                  onPress={() => sendMessage(prompt)}
                  style={({ pressed }) => [styles.promptChip, pressed && styles.pressed]}
                >
                  <Text style={styles.promptText}>{prompt}</Text>
                  <Text style={styles.promptArrow}>›</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Text style={styles.disclosure}>
            NOVA usa regole e criteri verificabili. I messaggi restano nella memoria temporanea della schermata e non vengono inviati a OpenAI.
          </Text>
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Scriva un messaggio a NOVA…"
            placeholderTextColor="#8993A2"
            style={styles.input}
            maxLength={1000}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(input)}
            accessibilityLabel="Messaggio per NOVA"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Invia messaggio"
            disabled={!input.trim()}
            onPress={() => sendMessage(input)}
            style={({ pressed }) => [
              styles.sendButton,
              !input.trim() && styles.sendButtonDisabled,
              pressed && input.trim() ? styles.sendButtonPressed : null
            ]}
          >
            <Text style={styles.sendButtonText}>Invia</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: theme.colors.paper },
  header: {
    backgroundColor: theme.colors.navy,
    paddingHorizontal: 19,
    paddingTop: 12,
    paddingBottom: 16
  },
  headerTop: { flexDirection: "row", alignItems: "center" },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: theme.colors.gold,
    alignItems: "center",
    justifyContent: "center"
  },
  brandMarkText: { color: theme.colors.navy, fontSize: 23, fontWeight: "800" },
  headerCopy: { flex: 1, marginLeft: 12 },
  eyebrow: { color: theme.colors.gold, fontSize: 8, fontWeight: "800", letterSpacing: 1.6 },
  title: { color: theme.colors.white, fontSize: 22, fontWeight: "900", letterSpacing: 0.4, marginTop: 1 },
  subtitle: { color: "#C1C9D5", fontSize: 10, marginTop: 1 },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#40506A",
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginLeft: 7
  },
  modeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.gold, marginRight: 5 },
  modeText: { color: "#E5D6BA", fontSize: 7, fontWeight: "800", letterSpacing: 0.4 },
  connectionNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#202E43",
    borderWidth: 1,
    borderColor: "#35445A",
    borderRadius: 13,
    padding: 11,
    marginTop: 15
  },
  connectionIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#35445A",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
    marginTop: 1
  },
  connectionIconText: { color: theme.colors.gold, fontSize: 12, fontWeight: "800" },
  connectionCopy: { flex: 1 },
  connectionTitle: { color: theme.colors.white, fontSize: 11, fontWeight: "800" },
  connectionBody: { color: "#C1C9D5", fontSize: 10, lineHeight: 15, marginTop: 4 },
  conversation: { flex: 1 },
  messageList: { padding: 16, paddingBottom: 24 },
  messageRow: { flexDirection: "row", marginBottom: 13, alignItems: "flex-end" },
  assistantRow: { justifyContent: "flex-start" },
  userRow: { justifyContent: "flex-end" },
  assistantAvatar: {
    width: 25,
    height: 25,
    borderRadius: 9,
    backgroundColor: theme.colors.navy,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 7
  },
  assistantAvatarText: { color: theme.colors.gold, fontSize: 14 },
  bubble: { maxWidth: "88%", borderRadius: 15, paddingHorizontal: 13, paddingVertical: 11 },
  assistantBubble: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderBottomLeftRadius: 5 },
  userBubble: { backgroundColor: theme.colors.navy, borderBottomRightRadius: 5 },
  messageText: { fontSize: 12, lineHeight: 18 },
  assistantMessageText: { color: theme.colors.ink },
  userMessageText: { color: theme.colors.white },
  promptSection: { marginTop: 11 },
  promptTitle: { color: theme.colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.4, marginBottom: 9 },
  promptList: { gap: 7 },
  promptChip: {
    backgroundColor: theme.colors.white,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center"
  },
  promptText: { color: theme.colors.ink, fontSize: 11, fontWeight: "600", flex: 1 },
  promptArrow: { color: theme.colors.gold, fontSize: 19, marginLeft: 8 },
  pressed: { opacity: 0.72 },
  disclosure: { color: theme.colors.muted, fontSize: 9, lineHeight: 14, marginTop: 15, marginHorizontal: 2 },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.colors.white,
    borderTopWidth: 1,
    borderTopColor: theme.colors.line,
    paddingHorizontal: 13,
    paddingVertical: 10
  },
  input: {
    flex: 1,
    minHeight: 43,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: theme.colors.ink,
    fontSize: 12
  },
  sendButton: {
    backgroundColor: theme.colors.navy,
    borderRadius: 12,
    minHeight: 43,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  sendButtonDisabled: { opacity: 0.38 },
  sendButtonPressed: { opacity: 0.75 },
  sendButtonText: { color: theme.colors.gold, fontSize: 11, fontWeight: "800" }
});
