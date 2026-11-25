import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";

const colors = {
  navy: "#101A2B",
  gold: "#C9A96E",
  muted: "#8B95A5",
  border: "#26344A"
};

function TabGlyph({ symbol, color }: { symbol: string; color: ColorValue | null | undefined }) {
  return <Text style={{ color: color ?? colors.muted, fontSize: 18, fontWeight: "700" }}>{symbol}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.navy,
          borderTopColor: colors.border,
          height: 66,
          paddingTop: 8,
          paddingBottom: 8
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" }
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Oggi", tabBarIcon: ({ color }) => <TabGlyph symbol="⌂" color={color} /> }} />
      <Tabs.Screen name="listings" options={{ title: "Immobili", tabBarIcon: ({ color }) => <TabGlyph symbol="▤" color={color} /> }} />
      <Tabs.Screen name="leads" options={{ title: "Opportunità", tabBarIcon: ({ color }) => <TabGlyph symbol="◎" color={color} /> }} />
      <Tabs.Screen name="crm" options={{ title: "CRM", tabBarIcon: ({ color }) => <TabGlyph symbol="♙" color={color} /> }} />
      <Tabs.Screen name="nova" options={{ title: "NOVA", tabBarIcon: ({ color }) => <TabGlyph symbol="✦" color={color} /> }} />
    </Tabs>
  );
}
