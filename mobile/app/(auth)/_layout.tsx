// app/(auth)/_layout.tsx
// Stack layout for unauthenticated screens (login, setup).

import { Stack } from 'expo-router'

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  )
}
