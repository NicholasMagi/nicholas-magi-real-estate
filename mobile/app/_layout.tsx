import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "@/features/auth/AuthProvider";
import { theme } from "@/shared/theme";

function AuthNavigation() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const firstSegment = segments[0];

  useEffect(() => {
    if (status === "loading") return;
    const isSignInRoute = firstSegment === "sign-in";
    const isTabsRoute = firstSegment === "(tabs)";
    if (status === "signed_in" && !isTabsRoute) router.replace("/(tabs)");
    else if (status !== "signed_in" && !isSignInRoute) router.replace("/sign-in");
  }, [status, firstSegment, router]);

  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={theme.colors.gold} />
        <Text style={styles.loadingText}>Verifica della sessione protetta…</Text>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <AuthNavigation />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: theme.colors.paper, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: theme.colors.muted, fontSize: 12 }
});
