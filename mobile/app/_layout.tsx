// app/_layout.tsx
// Top-level Expo Router layout. Wraps everything in GestureHandlerRootView
// (required by react-native-gesture-handler and @gorhom/bottom-sheet).
// The (auth) and (app) route groups each have their own _layout.tsx.

import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Stack } from 'expo-router'

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </GestureHandlerRootView>
  )
}
