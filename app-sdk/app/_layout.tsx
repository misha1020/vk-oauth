import { Stack } from "expo-router";
import { AuthContext, useAuthProvider } from "../src/hooks/useAuth";

export default function RootLayout() {
  const auth = useAuthProvider();

  return (
    <AuthContext.Provider value={auth}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="home" />
      </Stack>
    </AuthContext.Provider>
  );
}
